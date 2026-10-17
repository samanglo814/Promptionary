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

Testing with phones? Set `PUBLIC_URL` in `server/.env` to the same address as `NEXT_PUBLIC_SERVER_URL` (e.g. `http://192.168.1.20:4000`), or the describer's phone can't load the target image.

## Check it

| Command | What it does |
|---|---|
| `npm run bots` | Plays a full 5-bot game against a fast in-process server and checks every payload against the contract. **Run this after any gameplay change.** |
| `npm run bots -- http://localhost:4000` | Same, against a server you already started (real timings, takes a few minutes). |
| `npm test` | Unit and edge-case tests (join errors, status codes, rejoin, AI failure, ...). |
| `npm run check` | Typecheck + lint + tests + bots. CI runs this on every PR. |

## Tweak the game

Every rule (phase timings, player limits, rounds, banned-word penalty) is in [`src/config.ts`](src/config.ts).
Targets (image prompt, banned words, difficulty) are in [`data/targets.json`](data/targets.json).

## Target images

Each target's image is `data/images/<id>.jpg`, drawn by Gemini from its `prompt` and served at `/targets/<id>.jpg` (using `PUBLIC_URL`). The images are committed, so you only need a key to make new ones:

```bash
npm run generate:images                    # targets that don't have an image yet
npm run generate:images -- frog-wedding    # redraw specific ones
npm run generate:images -- --all           # redraw everything
```

To add a target, add an entry to `targets.json` (`id` in kebab-case, since Gemini reads it as a hint when scoring), run the script, and look at the image before committing. If the image has words in it that give the answer away, add something like "no labels" to the prompt and redraw. A target without an image shows a placeholder.

## The AI

With `GEMINI_API_KEY` set in `.env`, rounds go through Gemini ([`src/ai/gemini.ts`](src/ai/gemini.ts)):

1. **Transcribe** the recording (typed text skips this).
2. The room checks **banned words**.
3. **Draw** the transcript nearly verbatim with the image model. A blocked image becomes a refusal (`refused: true`), not an error.
4. **Score and caption** in one call: the text model compares the target and the drawing and returns JSON.

Each call has a 30s timeout and one retry (not for errors like a bad key or no credits). If it still fails, `/submit` returns 502 and the describer gets their turn back.
Drawn images are shrunk to 768px JPEGs (about 100 KB instead of a 1 MB PNG), kept in memory, and served at `GET /images/:id`, using `PUBLIC_URL` as the address. Model names come from `GEMINI_TEXT_MODEL` / `GEMINI_IMAGE_MODEL`.

The Gemini image model has no free tier. Without billing, set `IMAGE_PROVIDER=pollinations` to draw with [Pollinations](https://pollinations.ai) instead ([`src/ai/pollinations.ts`](src/ai/pollinations.ts)): free, no key, slower (10–30s a drawing). Without a token it rate-limits requests close together; a free token from [auth.pollinations.ai](https://auth.pollinations.ai) in `POLLINATIONS_TOKEN` raises the limit. Gemini still does everything else.

`npm run live:gemini` plays a few rounds against the real API and saves the drawings to `live-output/`.

Without a key, the **fake AI** ([`src/ai/fake.ts`](src/ai/fake.ts)) runs instead. Typed text is used as the transcript, audio gets a canned one, the score is a hash of the words, and the image is a placeholder. Say **"goose"** to make it refuse. Tests and `npm run bots` always use the fake AI.

## What's fake for now

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
data/               targets.json and the target images
scripts/            bot game, generate:images, live:gemini, helpers shared with tests
test/
```
