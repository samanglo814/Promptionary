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

// A player on the scoreboard.
type Standing = Player & {
  lastRound: number; // points earned in the round that just ended (0 if none)
};

// The secret image for a round. Sent ONLY to the describer's phone.
type Target = {
  id: string;            // matches server/data/targets.json
  imageUrl: string;      // absolute URL the browser can load
  bannedWords: string[]; // lowercase, whole words
};

// One round's result. Returned by POST /submit and broadcast as round_result.
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
lobby ─► intro ─► describing ─► processing ─► reveal ─► scoreboard ─┐
            ▲                                                         │
            └─────────────── next round (until all rounds played) ◄───┘
                                                                      │
                                                      game_over (podium) ─► hall_of_shame
```

| Phase | Host screen (`/host`) | Describer's phone | Everyone else's phone |
|---|---|---|---|
| `lobby` | Room code, QR, player list | Waiting | Waiting |
| `intro` | "Next up: Sam" *(not built yet)* | Waiting | Waiting |
| `describing` | "Sam is describing…" + timer *(not built yet)* | `DescribeScreen`: image, banned words, mic | Waiting |
| `processing` | "The AI is drawing…" *(not built yet)* | "Sending to the AI…" | Waiting |
| `reveal` | `RevealScreen` | "Sent! Look at the big screen" | Waiting |
| `scoreboard` | `Scoreboard` (ranked list) | Waiting | Waiting |
| `game_over` | `Scoreboard` with `final` (podium) | Waiting | Waiting |
| `hall_of_shame` | `HallOfShame` | Waiting | Waiting |

**Rounds:** each player describes once per game, in join order, so a game has as many rounds as players. (See [open questions](#7-open-questions) if we want something else.)

**Timing (server-controlled):**

| Phase | Lasts | Ends when |
|---|---|---|
| `intro` | 3s | timer |
| `describing` | 20s | `/submit` arrives, or timer runs out (then 0 points, caption about the silence) |
| `processing` | as long as Gemini takes | result is ready |
| `reveal` | ~8s | timer (the reveal animation takes ~5s) or host sends `next` |
| `scoreboard` | ~6s | timer or host sends `next` |

---

## 3. Socket events

Connect to `NEXT_PUBLIC_SERVER_URL` with Socket.io. Event names are **snake_case**. "Room" means the Socket.io room named after the room code.

### Host → server

| Event | Payload | When |
|---|---|---|
| `create_room` | *(none)* | Host page opens |
| `start_game` | *(none)* | Host clicks Start (needs 2+ players) |
| `next` | *(none)* | Optional: host skips ahead from `reveal` or `scoreboard` |

### Player → server

| Event | Payload | When |
|---|---|---|
| `join` | `{ code: string, name: string }` | Player taps Join |

### Server → host only

| Event | Payload | Replaces in the web app |
|---|---|---|
| `room_created` | `{ code: string }` | `mockRoomCode` in `host/page.tsx` |

### Server → one player only

| Event | Payload | Replaces in the web app |
|---|---|---|
| `joined` | `{ player: Player, code: string }` | the `FAKE` `setMe(...)` in `PlayerJoin.join()` |
| `join_error` | `{ reason: "room_not_found" \| "name_taken" \| "game_started" \| "room_full" }` | *(join form needs an error message)* |
| `your_turn` | `{ target: Target, endsAt: number }` | `mockTarget` and the "Pretend it's my turn" button |

### Server → everyone in the room

| Event | Payload | Replaces in the web app |
|---|---|---|
| `players` | `{ players: Player[] }` | the fake `setInterval` adding `mockPlayers` on `/host`. Sent on every join/leave. |
| `round_intro` | `{ round: number, totalRounds: number, describer: Player }` | *(intro screen not built yet)* |
| `describing` | `{ describer: Player, endsAt: number }` | *(host "describing" screen not built yet)* |
| `banned_buzz` | `{ playerId: string, word: string }` | → `playBuzzer()` on the host |
| `processing` | `{ describer: Player }` | *(host "drawing" screen not built yet)* |
| `round_result` | `{ playerName: string, result: SubmitResult }` | `mockResult` / `mockRefusedResult` on `/host` |
| `scoreboard` | `{ standings: Standing[] }` | `mockStandings` (`final={false}`) |
| `game_over` | `{ standings: Standing[] }` | `mockStandings` (`final={true}`) |
| `hall_of_shame` | `{ data: HallOfShame }` | `mockHallOfShame` |
| `error` | `{ message: string }` | *(generic toast, not built yet)* |

Notes:
- `standings` can arrive in any order; the scoreboard sorts them.
- The describer gets `your_turn` **and** everyone gets `describing`. Only `your_turn` contains the target image, so other phones can't peek.
- `banned_buzz` is sent while processing the transcript (the server does the real banned-word check, #12). The phone's typed-mode warning is a convenience only.

---

## 4. POST /submit

Called by the describer's phone during `describing`. The server transcribes (if audio), checks banned words, generates the image, scores it, writes the caption, logs the round, broadcasts `round_result`, **and** returns the same result to the phone.

**Request:** `multipart/form-data` (built with `FormData` in [`web/lib/submit.ts`](../web/lib/submit.ts)).

| Field | Type | Notes |
|---|---|---|
| `roomCode` | text | e.g. `FROG` |
| `playerId` | text | from `joined.player.id` |
| `audio` | file | **voice**: `description.webm` (Chrome/Android) or `description.m4a` (iPhone Safari). Up to 20s. |
| `text` | text | **typed fallback**: up to 200 characters. If present, skip transcription and use it as the transcript. |

Exactly one of `audio` or `text` is sent.

**Response `200`:** a `SubmitResult` (JSON).

**Errors:**

| Status | When | Phone does |
|---|---|---|
| `400` | missing fields, both/neither of `audio` and `text` | "Couldn't send that. Try again!" |
| `403` | not this player's turn, or describing time is over | same message |
| `404` | room not found | same message |
| `500` / `502` | Gemini failed after retries | same message, player can retry |

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

**`server/.env`**: `PORT`, `CLIENT_ORIGIN`, `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `DATABASE_URL`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `DEMO_MODE`

**`web/.env`**: `NEXT_PUBLIC_SERVER_URL` (when unset, the web app uses mocks), `NEXT_PUBLIC_AUTH0_DOMAIN`, `NEXT_PUBLIC_AUTH0_CLIENT_ID`, `NEXT_PUBLIC_AUTH0_AUDIENCE`

---

## 7. Open questions

Decide these together, then update this file:

1. **Rounds per game:** one turn per player (current assumption), or a fixed number like 5 with turns cycling?
2. **Scoring:** is a round's points just the 0–100 match score? Penalty for a banned word (e.g. −10 per buzz)?
3. **Who gets points:** only the describer, or does everyone get something?
4. **Reconnects:** if a phone refreshes, should it rejoin as the same player? (Would need the phone to store `player.id` and send it with `join`.)
5. **Awards (#21):** "Closest" and "Most Wrong Masterpiece". Send them with `game_over` as `awards: { title: string, playerName: string, imageUrl: string }[]`?
6. **Storybook (#37):** shape of the storybook data, to be added before the storybook page (#38) is built.
