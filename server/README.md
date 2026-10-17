# Server

Realtime game server: rooms, the round state machine, and `POST /submit`. Built to [`docs/data-contract.md`](../docs/data-contract.md).

## Run it

```bash
cd server
npm install
cp .env.example .env   # defaults work as-is for local play
npm run dev            # http://localhost:4000, restarts on save
```

Then point the web app at it: set `NEXT_PUBLIC_SERVER_URL=http://localhost:4000` in `web/.env`.

## Check it

| Command | What it does |
|---|---|
| `npm run bots` | Plays a full 5-bot game against a fast in-process server and checks every payload against the contract. **Run this after any gameplay change.** |
| `npm run bots -- http://localhost:4000` | Same, against a server you already started (real timings, takes a few minutes). |
| `npm test` | Unit and edge-case tests (join errors, status codes, rejoin, AI failure, ...). |
| `npm run check` | Typecheck + lint + tests + bots. CI runs this on every PR. |

## Tweak the game

Every rule (phase timings, player limits, rounds, banned-word penalty) is in [`src/config.ts`](src/config.ts).
Target images and banned words are in [`data/targets.json`](data/targets.json).

## The AI

With `GEMINI_API_KEY` set in `.env`, rounds go through Gemini ([`src/ai/gemini.ts`](src/ai/gemini.ts)):

1. **Transcribe** the recording (typed text skips this).
2. The room checks **banned words**.
3. **Draw** the transcript nearly verbatim with the image model. A blocked image becomes a refusal (`refused: true`), not an error.
4. **Score and caption** in one call: the text model compares the target and the drawing and returns JSON.

Each call has a 30s timeout and one retry (not for errors like a bad key or no credits). If it still fails, `/submit` returns 502 and the describer gets their turn back.
Drawn images are kept in memory and served at `GET /images/:id`, using `PUBLIC_URL` as the address. Model names come from `GEMINI_TEXT_MODEL` / `GEMINI_IMAGE_MODEL`.

Without a key, the **fake AI** ([`src/ai/fake.ts`](src/ai/fake.ts)) runs instead. Typed text is used as the transcript, audio gets a canned one, the score is a hash of the words, and the image is a placeholder. Say **"goose"** to make it refuse. Tests and `npm run bots` always use the fake AI.

## What's fake for now

- **Target images** are placeholders.
- **Hall of Shame** is built from rounds kept in memory, not Tiger Data yet.

## Layout

```
src/
  index.ts          starts the server (reads .env)
  app.ts            wires Express, Socket.io, rooms, and /submit together
  config.ts         game rules
  types.ts          shared types (copied from web/lib/mocks.ts)
  sockets.ts        socket events → Room methods
  rooms/Room.ts     one game: players, phases, timers, scoring
  rooms/RoomStore.ts  room codes
  rooms/hallOfShame.ts
  http/submit.ts    POST /submit
  ai/               the AI interface, Gemini, the fake AI, and the drawn-image store
  bannedWords.ts
  targets.ts
scripts/            bot game + helpers shared with tests
test/
```
