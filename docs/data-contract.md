# Data contract

Everything the server and the web app send each other. **Both sides build to this file.** If something needs to change, change it here first (in a PR), then in code.

- Types live in [`web/lib/mocks.ts`](../web/lib/mocks.ts) (web) and [`server/src/types.ts`](../server/src/types.ts) (server, where the socket events are typed too). The shapes below match both; change all three in the same PR.
- Realtime messages use **Socket.io**. Describing a round uses one **HTTP** call: `POST /submit`.
- All field names are **camelCase**. The server converts Gemini's snake_case JSON (`what_it_got_right`, etc.) before sending anything.
- Times are **epoch milliseconds** (`Date.now()`), so every screen can count down to the same moment.

---

## Contents

1. [Shared types](#1-shared-types)
2. [Game flow](#2-game-flow)
3. [Socket events](#3-socket-events)
4. [POST /submit](#4-post-submit)
5. [Environment variables](#5-environment-variables)
6. [Open questions](#6-open-questions)

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
  transcript: string;     // what Gemini heard
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

// The night's worst moments, built by the server from the rounds it keeps in memory.
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

// One page of the end-of-game storybook: one turn, told as a picture book.
type StoryPage = {
  round: number;             // 1-based
  playerName: string;        // who described it
  targetImageUrl: string;    // the secret image
  imageUrl: string;          // what the AI drew; "" when refused
  transcript: string;        // what they said ("" if they stayed silent)
  score: number;             // 0–100 match
  caption: string;           // the reveal's roast line
  narration: string;         // the storyteller's line for this page (the caption if the AI couldn't write one)
  bestGuess: { playerName: string; text: string } | null; // the most accurate guess, if it scored 50 or more
  refused?: boolean;
};

// The whole game as a picture book. Kept by the server for 6 hours after the game (GET /stories/:id).
type Storybook = {
  id: string;
  title: string;             // written by the AI, or "The Night the AI Tried Its Best"
  createdAt: number;         // epoch ms
  winner: string | null;     // null when the top spot was tied
  pages: StoryPage[];        // one per turn, in the order played
};
```

**Room codes** are 4 uppercase letters (`FROG`). Players type or scan them; the web app uppercases input before sending.

---

## 2. Game flow

The server owns the game state ([`server/src/rooms/Room.ts`](../server/src/rooms/Room.ts)). Screens only show what the server says; they never decide on their own when to move on.

```
lobby ─► round_start ─► intro ─► describing ─► processing ─► reveal ─► scoreboard ─┐
              ▲            ▲                                                         │
              │            └──────────── next turn in this round ◄──────────────────┤
              └──────────────────────── round over: next round ◄────────────────────┘
                                         last turn of the last round: game_over (podium) ─► hall_of_shame ─► storybook
```

**Rounds and turns:** a game is **2 rounds**. In each round, every player describes once (one **turn** each), so a game has 2 × players turns. Round 1 goes in join order. Round 2 goes **lowest score first**, so the leader describes last (ties keep join order). Every point earned in round 2 is worth **1.5×**.

**Guessing:** while someone describes, everyone else can type **one** guess at what the secret image shows. Guessing opens when `describing` starts. The **guess clock** starts when the describer says their **first word** (their phone sends `speaking`; a `/submit` without it counts as the first word), so a describer who hesitates doesn't cost the guessers speed. Guessing closes `guessMs` (25s) after that, or as soon as every connected player but the describer has guessed. Guesses before the first word keep 100% speed. If the describer never says a word, guessing closes when the turn times out. It can stay open into `processing`. The reveal waits for both the AI's drawing and the guess scores.

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
| `storybook` | `Storybook`: cover, one page per turn, then "The End" with a QR code to the shareable page | "Open the storybook" link | "Open the storybook" link |

**Timing (server-controlled):**

| Phase | Lasts | Ends when |
|---|---|---|
| `round_start` | 4s | timer or host sends `next` |
| `intro` | 3s | timer |
| `describing` | 20s | `/submit` arrives, or timer runs out (then 0 points, caption about the silence) |
| `processing` | as long as Gemini takes, and until guessing closes | the drawing is ready and guessing has closed, then one AI call judges both |
| `reveal` | ~8s | timer (the reveal animation takes ~5s) or host sends `next` |
| `scoreboard` | ~6s | timer or host sends `next` |
| `game_over` | ~10s | timer or host sends `next`, then `hall_of_shame` |
| `hall_of_shame` | ~15s | timer or host sends `next`, then `storybook` (stays until the host starts again) |

All of these live in [`server/src/config.ts`](../server/src/config.ts).

**Points** (every number lives in `config.ts`):

- **Describer**, per turn, before the multiplier (a perfect turn is 1000, or 1500 in round 2):
  - **Accuracy:** `700 × score / 100`, from the AI's match score.
  - **Clarity:** `200 × average guess accuracy / 100`. If nobody guessed, the match score is used instead, so a quiet room doesn't cost the describer.
  - **Speed:** `100 × share of the 20s left` when they first sent it. Only counts when the match score is **40 or more**.
  - **Banned words:** −100 for each banned word said (each counts once).
  - `total = round(max(0, accuracy + clarity + speed − bannedPenalty) × multiplier)`. A timed-out turn earns 0.
- **Guessers**, per guess: `round(max × accuracy/100 × speed/100)`. `speed` is 100 for a guess before or right at the describer's first word and drops evenly to 70 at the end of the 25s window. The AI scores `accuracy` 0–100 against the target's description (`prompt` in `targets.json`). If that call fails, shared words decide.
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
- If **transcribing** fails because the AI is **out of requests**, or fails a **second time** in the same turn, the turn ends right away (0 points for the describer, guesses still scored). The first other failure gives the describer their turn back with 10s more, guesses already locked in stay, and guessing stays open at least as long as the describing deadline. If **drawing or judging** fails, the turn still ends: the description and guesses are scored by shared words, with a placeholder image and a caption saying the AI ran out of ink.
- A guesser who **refreshes** and rejoins mid-turn gets `describing` again (to reopen the guess box) and `guess_locked` if they already guessed.
- If a **describer disconnects** before submitting, they have 5s to rejoin (see `join`) before their turn is skipped.
- **Dropped connections** (a locked phone, a Wi-Fi or tunnel blip) use Socket.io connection state recovery: a socket that reconnects within 2 minutes comes back with the same id (`socket.recovered` is true) and gets the events it missed, so it doesn't rejoin.
- If the **host** closes the page, the room ends and everyone gets `error`. If the host's connection only drops, the room waits 2 minutes for it to come back first.
- The **storybook** is written when `game_over` starts, in one AI call (a title and one narration line per turn), so it's usually ready before the Hall of Shame ends. `storybook` is sent once the phase starts and the book is ready, whichever comes later. If the AI can't write it, each page's caption is its narration and the title is a fixed one; the game never waits on it for long.
- The host can send `start_game` again from `game_over`, `hall_of_shame` or `storybook` to **play again** (scores reset, Hall of Shame keeps the whole night). Players whose phones dropped less than 2 minutes ago stay in, and can rejoin with their `playerId`.

---

## 3. Socket events

Connect to `NEXT_PUBLIC_SERVER_URL` with Socket.io. Event names are **snake_case**. "Room" means the Socket.io room named after the room code.

### Host → server

| Event | Payload | When |
|---|---|---|
| `create_room` | *(none)* | Host page opens |
| `start_game` | ack callback: `{ error: string \| null }` | Host clicks Start (needs 2+ players). The server answers through the callback (`null` = started), so the host page can tell a refusal from a click that never arrived. A refusal is also sent as `error`. |
| `next` | *(none)* | Optional: host skips ahead from `round_start`, `reveal`, `scoreboard`, `game_over`, or `hall_of_shame` |

### Player → server

| Event | Payload | When |
|---|---|---|
| `join` | `{ code: string, name: string, playerId?: string }` | Player taps Join. To **rejoin after a refresh**, send the `player.id` from the earlier `joined` (e.g. saved in `localStorage`); the player keeps their score and, if it's their turn, gets `your_turn` again. |
| `guess` | `{ text: string }` | Everyone but the describer, once per turn, while guessing is open. 1–60 characters (extra spaces are trimmed). The server answers that player with `guess_locked` or `guess_error`. |
| `speaking` | none | The describer's phone, when it first hears them talk (first word from speech-to-text, or the mic level when recording). Starts the guess clock; only the first one per turn counts. |

### Server → host only

| Event | Payload | Notes |
|---|---|---|
| `room_created` | `{ code: string }` | The lobby shows the code and QR. |

### Server → one player only

| Event | Payload | Notes |
|---|---|---|
| `joined` | `{ player: Player, code: string }` | The phone saves `player.id` for rejoining. |
| `join_error` | `{ reason: "room_not_found" \| "name_taken" \| "game_started" \| "room_full" \| "invalid_name" }` | Shown on the join form. `invalid_name`: blank or over 16 characters. |
| `your_turn` | `{ target: Target, endsAt: number }` | Opens `DescribeScreen` with the secret image. |
| `guess_locked` | `{ text: string, speed: number }` | The guess was taken. `speed` is how much of its value it kept (70–100). |
| `guess_error` | `{ reason: "not_now" \| "describer" \| "already_guessed" \| "invalid_guess" }` | `not_now`: guessing isn't open. `invalid_guess`: blank or over 60 characters. |

### Server → everyone in the room

| Event | Payload | Notes |
|---|---|---|
| `players` | `{ players: Player[] }` | Sent on every join/leave. |
| `round_start` | `{ round: number, totalRounds: number, multiplier: number, leader: Player \| null, gap: number }` | Start of each round. `leader` is null when nobody leads (round 1, or a tie for first); `gap` is their lead over second place. |
| `turn_intro` | `{ round: number, totalRounds: number, turn: number, turnsInRound: number, multiplier: number, describer: Player }` | "Next up: Sam" before every turn. `turn` counts from 1 within the round. |
| `describing` | `{ describer: Player, endsAt: number, guessEndsAt: number, guessClockStarted: boolean }` | Describing and guessing start. `endsAt` is the describer's deadline, `guessEndsAt` when guessing closes (at the latest). Until `guessClockStarted`, `guessEndsAt` is only a placeholder: phones show "waiting for them to start talking" instead of a countdown. Sent again if the AI fails and the describer gets more time. |
| `guess_clock` | `{ guessEndsAt: number }` | The describer said their first word: guessing now closes at `guessEndsAt`. |
| `guesses_locked` | `{ playerIds: string[], open: boolean }` | After every guess (who has guessed, never what), and once more with `open: false` when guessing closes. |
| `banned_buzz` | `{ playerId: string, word: string }` | The host flashes the word and plays the buzzer. |
| `processing` | `{ describer: Player }` | Host shows "The AI is drawing…". |
| `round_result` | `{ playerName: string, result: SubmitResult, breakdown: PrompterBreakdown, guesses: GuessResult[] }` | Host plays `RevealScreen` (or the refusal card); phones show their points. Sent once the drawing and the guess scores are both ready. |
| `scoreboard` | `{ standings: Standing[] }` | `Scoreboard` with `final={false}`. |
| `game_over` | `{ standings: Standing[], awards: Award[] }` | `Scoreboard` with `final={true}` (podium). Awards with nobody to give them to are left out. |
| `hall_of_shame` | `{ data: HallOfShame }` | `HallOfShame` screen. |
| `storybook` | `{ story: Storybook }` | Host plays the `Storybook` screen, ending on a QR code to `/story?id=<story.id>`. Phones show an "Open the storybook" link to the same page. |
| `error` | `{ message: string }` | Shown as a message on the host or phone (e.g. "Need at least 2 players", or the room closed). |

Notes:
- `standings` arrive sorted with `rank` set; the scoreboard still sorts by `rank`, so mock data works too.
- Without `NEXT_PUBLIC_SERVER_URL`, the web app runs on the mocks in `web/lib/mocks.ts` instead of these events, for working on screens without a server.
- The describer gets `your_turn` **and** everyone gets `describing`. Only `your_turn` contains the target image, so other phones can't peek.
- `banned_buzz` is sent while processing the transcript (the server does the banned-word check, [`server/src/bannedWords.ts`](../server/src/bannedWords.ts)).

---

## 4. POST /submit

Called by the describer's phone during `describing`. The server transcribes (if audio), checks banned words, and generates the image. Once guessing has closed too, one AI call scores the image, writes the caption, and scores the guesses; the server broadcasts `round_result` and answers the phone with the same `result`. So the response arrives **with** the reveal, which can take until the guessing window closes.

**Request:** `multipart/form-data` (built with `FormData` in [`web/lib/submit.ts`](../web/lib/submit.ts)).

| Field | Type | Notes |
|---|---|---|
| `roomCode` | text | e.g. `FROG` |
| `playerId` | text | from `joined.player.id` |
| `audio` | file | **voice, recorded**: `description.wav`, 16 kHz mono 16-bit PCM ([`web/lib/mic.ts`](../web/lib/mic.ts)), from phones whose browser can't turn speech into text. Up to 20s (about 640 KB). |
| `text` | text | **voice, transcribed on the phone** (browser speech recognition, e.g. iPhone Safari and Android Chrome): up to 500 characters, used as the transcript, so the server skips its transcription call. Never typed: players always talk, because the others guess from hearing them. The bot game and tests send it too. |

Exactly one of `audio` or `text` is sent.

**Response `200`:** a `SubmitResult` (JSON).

**Errors:**

| Status | When | Phone does |
|---|---|---|
| `400` | missing fields, both/neither of `audio` and `text` | shows the server's `error` |
| `403` | not this player's turn, already submitted, or describing time is over | shows the server's `error` |
| `404` | room not found, or the turn was skipped | shows the server's `error` |
| `502` | transcribing failed (the first time this turn) | shows the `error`, with **Send again** (same recording) and **Record again**. The server re-sends `your_turn` with 10s more. |
| `503` | the AI is out of free requests, or transcribing failed a second time this turn | shows the `error`. The turn is already over: `round_result` follows right away with 0 points for the describer (no penalty), and the guesses scored by shared words. |

Error responses have the body `{ error: string }`, a message ready to show the player.

A blocked image is **not** an error: return `200` with `refused: true`, `imageUrl: ""`, `score: 0`, empty `gotRight`/`gotWrong`, and a caption.

**CORS:** the server must allow `CLIENT_ORIGIN` (the web app's URL) for Socket.io, `/submit`, and `/stories/:id`.

### GET /stories/:id

The shareable storybook page (`/story?id=<id>` in the web app) loads the book from here, so it works on any phone after the room is gone.

- **`200`:** the `Storybook` (JSON), the same object the `storybook` event sent.
- **`404`:** `{ error: string }` for an unknown id, or a book older than 6 hours. The server keeps at most 200 books, and the 500 newest AI drawings they show.

---

## 5. Environment variables

**`server/.env`** (each one is explained in [`server/.env.example`](../server/.env.example)): `PORT`, `CLIENT_ORIGIN`, `PUBLIC_URL` (the server's address as browsers see it, for target and AI image URLs; defaults to `http://localhost:PORT`), `GEMINI_API_KEY` (one or more, comma-separated), `VERTEX_PROJECT`, `VERTEX_LOCATION`, `GEMINI_TEXT_MODEL`, `GEMINI_TRANSCRIBE_MODEL`, `GEMINI_IMAGE_MODEL`, `IMAGE_PROVIDER`, `POLLINATIONS_TOKEN`

**`web/.env`**: `NEXT_PUBLIC_SERVER_URL` (when unset, the web app uses mocks). `TUNNEL_DOMAIN` is set by `dev-tunnel.sh` when it runs with a custom domain, so Next.js dev accepts it.

---

## 6. Open questions

Decide these together, then update this file.

Decided (see [Game flow](#2-game-flow)):
- **Rounds per game:** 2 rounds, everyone describes once per round; round 2 is lowest score first and worth 1.5×.
- **Scoring:** describer points out of 1000 (accuracy, clarity, speed, −100 per banned word); guessers earn points for accuracy and speed.
- **Who gets points:** everyone. Guessing is about 40% of a perfect game.
- **Reconnects:** a refreshed phone rejoins as the same player (`playerId` on `join`, saved by the phone).
- **Awards:** sent with `game_over` as `awards: Award[]` (Closest Drawing, Most Wrong Masterpiece, Sharpest Guesser).
- **Storybook:** after the Hall of Shame, the host pages through the game as a picture book, and its last page has a QR code to a shareable copy (`/story?id=`), kept for 6 hours.
- **Storage:** no database. Rounds are kept in memory for the room's lifetime, which is all the Hall of Shame needs.

Still open:
*(none right now)*
