# Data contract

Everything the server and the web app send each other. **Both sides build to this file.** If something needs to change, change it here first (in a PR), then in code.

- Frontend types live in [`web/lib/mocks.ts`](../web/lib/mocks.ts). The shapes below are copied from there.
- Realtime messages use **Socket.io**. Describing a round uses one **HTTP** call: `POST /submit`.
- All field names are **camelCase**. The server converts Gemini's snake_case JSON (`what_it_got_right`, etc.) before sending anything.
- Times are **epoch milliseconds** (`Date.now()`), so every screen can count down to the same moment.

---

## Contents

1. [Shared types](#1-shared-types)
2. [Game flow](#2-game-flow)
3. [Socket events](#3-socket-events)
4. [POST /submit](#4-post-submit)
5. [Tiger Data](#5-tiger-data)
6. [Environment variables](#6-environment-variables)
7. [Open questions](#7-open-questions)

---

## 1. Shared types

```ts
// A person in the room.
type Player = {
  id: string;     // server-generated, stable for the whole game
  name: string;   // 1–16 characters, unique within the room
  score: number;  // running total
};

// A player on the scoreboard. Standings are sent SORTED, best first, with ties broken.
type Standing = Player & {
  lastTurn: number;         // points earned in the turn that just ended, describing or guessing (0 if none)
  prompterPoints: number;   // all points from describing
  spectatorPoints: number;  // all points from guessing
  finalRoundPoints: number; // points earned in the last round (the first tiebreak)
  rank: number;             // 1 = first; players tied on score and both tiebreaks share a rank
};

// The secret image for a round. Sent ONLY to the describer's phone.
type Target = {
  id: string;            // matches server/data/targets.json
  imageUrl: string;      // absolute URL the browser can load
  bannedWords: string[]; // lowercase, whole words
};

// What the AI made of one description. Returned by POST /submit and sent inside round_result.
type SubmitResult = {
  transcript: string;     // what Gemini heard (or the typed text)
  imageUrl: string;       // what the AI drew; "" when refused
  targetImageUrl: string; // the original secret image
  score: number;          // 0–100 integer; 0 when refused
  gotRight: string[];     // short phrases, can be empty
  gotWrong: string[];     // short phrases, can be empty
  caption: string;        // roast line, max ~15 words, never mean to the player
  refused?: boolean;      // true if image generation was blocked by safety filters
};

// How the describer's points for one turn add up (see "Points" below).
// Each line is before the multiplier; total = (accuracy + clarity + speed − bannedPenalty, never below 0) × multiplier.
type PrompterBreakdown = {
  accuracy: number;      // up to 700
  clarity: number;       // up to 200
  speed: number;         // up to 100
  bannedPenalty: number; // 100 per banned word said
  multiplier: number;    // 1 in round 1, 1.5 in round 2
  total: number;
};

// One guess, scored. points = (max for this turn) × accuracy/100 × speed/100, rounded.
type GuessResult = {
  playerId: string;
  playerName: string;
  text: string;
  accuracy: number; // 0–100 integer, how close the guess is to the secret image
  speed: number;    // 70–100 integer, how much of its value the guess kept by being early
  points: number;
};

// An end-of-game award, sent with game_over.
type Award = {
  title: string;      // "Closest Drawing", "Most Wrong Masterpiece", "Sharpest Guesser"
  playerName: string;
  imageUrl: string;   // the AI drawing, or "" for awards without a picture
};

// The night's worst moments, built from Tiger Data.
type HallOfShame = {
  stats: {
    roundsPlayed: number;
    avgScore: number;     // integer %, across all rounds tonight
    bannedBuzzes: number;
    refusals: number;
  };
  worstMisses: {          // lowest scores first; the screen fits 3
    playerName: string;
    transcript: string;
    imageUrl: string;     // what the AI drew ("" if refused)
    score: number;
  }[];
  worstWords: {           // worst first; the screen fits ~5
    word: string;
    avgScore: number;
  }[];
};
```

**Room codes** are 4 uppercase letters (`FROG`). Players type or scan them; the web app uppercases input before sending.

---

## 2. Game flow

The server owns the game state (#11 `feat/server-round-state-machine`). Screens only show what the server says; they never decide on their own when to move on.

```
lobby ─► round_start ─► intro ─► describing ─► processing ─► reveal ─► scoreboard ─┐
              ▲            ▲                                                         │
              │            └──────────── next turn in this round ◄──────────────────┤
              └──────────────────────── round over: next round ◄────────────────────┘
                                         last turn of the last round: game_over (podium) ─► hall_of_shame
```

**Rounds and turns:** a game is **2 rounds**. In each round, every player describes once (one **turn** each), so a game has 2 × players turns. Round 1 goes in join order. Round 2 goes **lowest score first**, so the leader describes last (ties keep join order). Every point earned in round 2 is worth **1.5×**.

**Guessing:** while someone describes, everyone else can type **one** guess at what the secret image shows. Guessing opens when `describing` starts and closes `guessMs` (25s) later, or as soon as every connected player but the describer has guessed. It can stay open into `processing`. The reveal waits for both the AI's drawing and the guess scores.

| Phase | Host screen (`/host`) | Describer's phone | Everyone else's phone |
|---|---|---|---|
| `lobby` | Room code, QR, player list | Waiting | Waiting |
| `round_start` | "Round 2 · Points x1.5!", who leads and by how much | Waiting | Waiting |
| `intro` | "Next up: Sam" | Waiting | "Get ready to guess" |
| `describing` | "Sam is describing…" + timer, how many guesses are locked in | `DescribeScreen`: image, banned words, mic | `GuessScreen`: one guess, then "Locked in" |
| `processing` | "The AI is drawing…" | "Sending to the AI…" | `GuessScreen` until guessing closes |
| `reveal` | `RevealScreen` | "Sent! Look at the big screen" | Waiting |
| `scoreboard` | `Scoreboard` (ranked list) | Waiting | Waiting |
| `game_over` | `Scoreboard` with `final` (podium) | Waiting | Waiting |
| `hall_of_shame` | `HallOfShame` | Waiting | Waiting |

**Timing (server-controlled):**

| Phase | Lasts | Ends when |
|---|---|---|
| `round_start` | 4s | timer or host sends `next` |
| `intro` | 3s | timer |
| `describing` | 20s | `/submit` arrives, or timer runs out (then 0 points, caption about the silence) |
| `processing` | as long as Gemini takes, and until guessing closes | drawing and guess scores are both ready |
| `reveal` | ~8s | timer (the reveal animation takes ~5s) or host sends `next` |
| `scoreboard` | ~6s | timer or host sends `next` |
| `game_over` | ~10s | timer or host sends `next`, then `hall_of_shame` (stays until the host starts again) |

All of these live in [`server/src/config.ts`](../server/src/config.ts).

**Points** (every number lives in `config.ts`):

- **Describer**, per turn, before the multiplier (a perfect turn is 1000, or 1500 in round 2):
  - **Accuracy:** `700 × score / 100`, from the AI's match score.
  - **Clarity:** `200 × average guess accuracy / 100`. If nobody guessed, the match score is used instead, so a quiet room doesn't cost the describer.
  - **Speed:** `100 × share of the 20s left` when they first sent it. Only counts when the match score is **40 or more**.
  - **Banned words:** −100 for each banned word said (each counts once).
  - `total = round(max(0, accuracy + clarity + speed − bannedPenalty) × multiplier)`. A timed-out turn earns 0.
- **Guessers**, per guess: `round(max × accuracy/100 × speed/100)`. `speed` is 100 for an instant guess and drops evenly to 70 at the end of the 25s window. The AI scores `accuracy` 0–100 against the target's description (`prompt` in `targets.json`). If that call fails, shared words decide.
- **What one guess is worth (`max`)** depends on the number of players when the game started, so guessing stays about **40%** of a perfect game in any room size. `max = min(400, 666.7 / (players − 1)) × multiplier`, rounded to the nearest 5:

  | Players | Round 1 | Round 2 |
  |---|---|---|
  | 2 | 400 | 600 |
  | 3 | 335 | 500 |
  | 4 | 220 | 335 |
  | 6 | 135 | 200 |
  | 8 | 95 | 145 |

  The cap of 400 keeps one guess from counting almost as much as describing in a 2-player game.
- **Ranking:** highest `score` wins. Ties go to more `finalRoundPoints`, then more `spectatorPoints`.

**Server behavior worth knowing:**
- After the **last** turn's reveal, the server goes straight to `game_over` (no plain scoreboard first; the podium replaces it).
- `/submit` is accepted until `endsAt` plus a 3s grace, so an upload that started before the buzzer still counts.
- A **timed-out** turn still sends `round_result`: `transcript: ""`, `score: 0`, a placeholder `imageUrl` ("*crickets*"), a caption about the silence, and the guesses (which still score).
- `SubmitResult.score` is always the raw 0–100 match score; points are in `breakdown`.
- If the AI fails and the describer gets their turn back, guesses already locked in stay, and guessing stays open at least as long as the new describing deadline.
- A guesser who **refreshes** and rejoins mid-turn gets `describing` again (to reopen the guess box) and `guess_locked` if they already guessed.
- If a **describer disconnects** before submitting, they have 5s to rejoin (see `join`) before their turn is skipped.
- If the **host disconnects**, the room ends and everyone gets `error`.
- The host can send `start_game` again from `game_over` or `hall_of_shame` to **play again** (scores reset, Hall of Shame keeps the whole night).

---

## 3. Socket events

Connect to `NEXT_PUBLIC_SERVER_URL` with Socket.io. Event names are **snake_case**. "Room" means the Socket.io room named after the room code.

### Host → server

| Event | Payload | When |
|---|---|---|
| `create_room` | *(none)* | Host page opens |
| `start_game` | *(none)* | Host clicks Start (needs 2+ players) |
| `next` | *(none)* | Optional: host skips ahead from `round_start`, `reveal`, `scoreboard`, or `game_over` |

### Player → server

| Event | Payload | When |
|---|---|---|
| `join` | `{ code: string, name: string, playerId?: string }` | Player taps Join. To **rejoin after a refresh**, send the `player.id` from the earlier `joined` (e.g. saved in `localStorage`); the player keeps their score and, if it's their turn, gets `your_turn` again. |
| `guess` | `{ text: string }` | Everyone but the describer, once per turn, while guessing is open. 1–60 characters (extra spaces are trimmed). The server answers that player with `guess_locked` or `guess_error`. |

### Server → host only

| Event | Payload | Replaces in the web app |
|---|---|---|
| `room_created` | `{ code: string }` | `mockRoomCode` in `host/page.tsx` |

### Server → one player only

| Event | Payload | Replaces in the web app |
|---|---|---|
| `joined` | `{ player: Player, code: string }` | the `FAKE` `setMe(...)` in `PlayerJoin.join()` |
| `join_error` | `{ reason: "room_not_found" \| "name_taken" \| "game_started" \| "room_full" \| "invalid_name" }` (`invalid_name`: blank or over 16 characters) | *(join form needs an error message)* |
| `your_turn` | `{ target: Target, endsAt: number }` | `mockTarget` and the "Pretend it's my turn" button |
| `guess_locked` | `{ text: string, speed: number }` | The guess was taken. `speed` is how much of its value it kept (70–100). |
| `guess_error` | `{ reason: "not_now" \| "describer" \| "already_guessed" \| "invalid_guess" }` | `not_now`: guessing isn't open. `invalid_guess`: blank or over 60 characters. |

### Server → everyone in the room

| Event | Payload | Replaces in the web app |
|---|---|---|
| `players` | `{ players: Player[] }` | the fake `setInterval` adding `mockPlayers` on `/host`. Sent on every join/leave. |
| `round_start` | `{ round: number, totalRounds: number, multiplier: number, leader: Player \| null, gap: number }` | Start of each round. `leader` is null when nobody leads (round 1, or a tie for first); `gap` is their lead over second place. |
| `turn_intro` | `{ round: number, totalRounds: number, turn: number, turnsInRound: number, multiplier: number, describer: Player }` | "Next up: Sam" before every turn. `turn` counts from 1 within the round. |
| `describing` | `{ describer: Player, endsAt: number, guessEndsAt: number }` | Describing and guessing start. `endsAt` is the describer's deadline, `guessEndsAt` when guessing closes (at the latest). Sent again if the AI fails and the describer gets more time. |
| `guesses_locked` | `{ playerIds: string[], open: boolean }` | After every guess (who has guessed, never what), and once more with `open: false` when guessing closes. |
| `banned_buzz` | `{ playerId: string, word: string }` | → `playBuzzer()` on the host |
| `processing` | `{ describer: Player }` | *(host "drawing" screen not built yet)* |
| `round_result` | `{ playerName: string, result: SubmitResult, breakdown: PrompterBreakdown, guesses: GuessResult[] }` | `mockResult` / `mockRefusedResult` on `/host`. Sent once the drawing and the guess scores are both ready. |
| `scoreboard` | `{ standings: Standing[] }` | `mockStandings` (`final={false}`) |
| `game_over` | `{ standings: Standing[], awards: Award[] }` | `mockStandings` (`final={true}`). Awards with nobody to give them to are left out. |
| `hall_of_shame` | `{ data: HallOfShame }` | `mockHallOfShame` |
| `error` | `{ message: string }` | *(generic toast, not built yet)* |

Notes:
- `standings` arrive sorted with `rank` set; the scoreboard still sorts by `rank`, so mock data works too.
- The describer gets `your_turn` **and** everyone gets `describing`. Only `your_turn` contains the target image, so other phones can't peek.
- `banned_buzz` is sent while processing the transcript (the server does the real banned-word check, #12). The phone's typed-mode warning is a convenience only.

---

## 4. POST /submit

Called by the describer's phone during `describing`. The server transcribes (if audio), checks banned words, generates the image, scores it, writes the caption, and returns the `SubmitResult` to the phone. Once guessing has closed too, it logs the turn and broadcasts `round_result` with the same `result` plus the points. So the phone's response can arrive **before** `round_result`.

**Request:** `multipart/form-data` (built with `FormData` in [`web/lib/submit.ts`](../web/lib/submit.ts)).

| Field | Type | Notes |
|---|---|---|
| `roomCode` | text | e.g. `FROG` |
| `playerId` | text | from `joined.player.id` |
| `audio` | file | **voice**: `description.webm` (Chrome/Android) or `description.m4a` (iPhone Safari). Up to 20s. |
| `text` | text | **typed, or transcribed on the phone** (browser speech recognition): up to 500 characters. If present, skip transcription and use it as the transcript. |

Exactly one of `audio` or `text` is sent.

**Response `200`:** a `SubmitResult` (JSON).

**Errors:**

| Status | When | Phone does |
|---|---|---|
| `400` | missing fields, both/neither of `audio` and `text` | "Couldn't send that. Try again!" |
| `403` | not this player's turn, already submitted, or describing time is over | same message |
| `404` | room not found | same message |
| `500` / `502` | Gemini failed after retries | same message, player can retry (the server gives back the turn with at least 10s left and re-sends `your_turn`) |

Error responses have the body `{ error: string }`.

A blocked image is **not** an error: return `200` with `refused: true`, `imageUrl: ""`, `score: 0`, empty `gotRight`/`gotWrong`, and a caption.

**CORS:** the server must allow `CLIENT_ORIGIN` (the web app's URL) for both Socket.io and `/submit`.

---

## 5. Tiger Data

From the README. One row per round, written by the server after scoring (#22).

```sql
CREATE TABLE rounds (
  time          TIMESTAMPTZ NOT NULL DEFAULT now(),
  room_code     TEXT NOT NULL,
  round_index   INT NOT NULL,
  player_id     TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  transcript    TEXT,
  banned_hits   INT DEFAULT 0,
  score         INT,
  latency_ms    INT,
  refused       BOOLEAN DEFAULT false
);
SELECT create_hypertable('rounds', 'time');
```

`HallOfShame` needs two things this table doesn't have yet:
- **`player_name`** for `worstMisses[].playerName` (or join against a players table)
- **`image_url`** for `worstMisses[].imageUrl`

Suggest adding both columns. `worstWords` can be computed from `transcript` + `score` (split into words, drop short/common words, average the score per word).

---

## 6. Environment variables

**`server/.env`**: `PORT`, `CLIENT_ORIGIN`, `PUBLIC_URL` (the server's address as browsers see it, for AI image URLs; defaults to `http://localhost:PORT`), `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `DATABASE_URL`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `DEMO_MODE`

**`web/.env`**: `NEXT_PUBLIC_SERVER_URL` (when unset, the web app uses mocks), `NEXT_PUBLIC_AUTH0_DOMAIN`, `NEXT_PUBLIC_AUTH0_CLIENT_ID`, `NEXT_PUBLIC_AUTH0_AUDIENCE`

---

## 7. Open questions

Decide these together, then update this file.

Decided (see [Game flow](#2-game-flow)):
- **Rounds per game:** 2 rounds, everyone describes once per round; round 2 is lowest score first and worth 1.5×.
- **Scoring:** describer points out of 1000 (accuracy, clarity, speed, −100 per banned word); guessers earn points for accuracy and speed.
- **Who gets points:** everyone. Guessing is about 40% of a perfect game.
- **Reconnects:** a refreshed phone rejoins as the same player (`playerId` on `join`, saved by the phone).
- **Awards (#21):** sent with `game_over` as `awards: Award[]`.

Still open:
1. **Storybook (#37):** shape of the storybook data, to be added before the storybook page (#38) is built.
