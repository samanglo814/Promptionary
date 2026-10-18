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

Phone browsers only allow the mic on `https://` pages, so for voice on phones run `./dev-tunnel.sh` from the repo root instead (needs `brew install cloudflared`). It starts both apps behind free Cloudflare tunnels and prints an `https://` host address; phones can join from any network. Your `.env` files aren't changed. It runs the server with `npm start`, not `npm run dev`: the dev server restarts whenever a file is saved, which ends every game in progress.

**Mic permission on iPhones.** The phone asks for the mic once, when the player taps Join, and keeps it open for the whole visit (the mic indicator stays on), so it doesn't ask again every turn. Each `./dev-tunnel.sh` run gets a new random `trycloudflare.com` address, though, and Safari remembers the permission per address, so players get asked once per run. To stop the asking entirely: Settings → Apps → Safari → Microphone → Allow, or host the game at a fixed address.

## Check it

| Command | What it does |
|---|---|
| `npm run bots` | Plays a full 5-bot game against a fast in-process server and checks every payload against the contract. **Run this after any gameplay change.** |
| `npm run bots -- http://localhost:4000` | Same, against a server you already started (real timings, takes a few minutes). |
| `npm test` | Unit and edge-case tests (join errors, status codes, rejoin, AI failure, ...). |
| `npm run check` | Typecheck + lint + tests + bots. CI runs this on every PR. |

## Tweak the game

Every rule (phase timings, player limits, rounds, every number in the points) is in [`src/config.ts`](src/config.ts). The points math is in [`src/scoring.ts`](src/scoring.ts), with unit tests in `test/scoring.test.ts`.
Targets (image prompt, banned words, difficulty) are in [`data/targets.json`](data/targets.json).

## Target images

Each target's image is `data/images/<id>.jpg`, drawn by Gemini from its `prompt` and served at `/targets/<id>.jpg` (using `PUBLIC_URL`). The images are committed, so you only need a key to make new ones:

```bash
npm run generate:images                    # targets that don't have an image yet
npm run generate:images -- frog-wedding    # redraw specific ones
npm run generate:images -- --all           # redraw everything
```

To add a target, add an entry to `targets.json` (`id` in kebab-case), run the script, and look at the image before committing. If the image has words in it that give the answer away, add something like "no labels" to the prompt and redraw. A target without an image shows a placeholder.

## The AI

With `GEMINI_API_KEY` set in `.env`, rounds go through Gemini ([`src/ai/gemini.ts`](src/ai/gemini.ts)):

1. **Transcribe** the recording with `GEMINI_TRANSCRIBE_MODEL`, unless the phone already turned the speech into text. Phones without speech-to-text record WAV (16 kHz mono, [`web/lib/mic.ts`](../web/lib/mic.ts)), a format Gemini accepts.
2. The room checks **banned words**.
3. **Draw** the transcript nearly verbatim with the image model. A blocked image becomes a refusal (`refused: true`), not an error.
4. **Judge** in one call per turn, once guessing has closed: the text model compares the target and the drawing (score and caption) and rates every guess 0–100 against the target's `prompt`. A turn with nothing drawn (silence, a refusal) only needs the guesses scored, and a turn with no guesses and nothing drawn needs no call.

**Free quota.** Free keys allow about 20 requests a day per model. To stretch it:
- Phones turn speech into text themselves when the browser can (iPhone Safari, Android Chrome), so those turns skip the transcription call. Other browsers record WAV and the server transcribes it with `GEMINI_TRANSCRIBE_MODEL` (the lighter `gemini-flash-lite-latest` by default, which has its own allowance; the text model takes over if it's missing or out of quota).
- Judging is one call per turn (`GEMINI_TEXT_MODEL`).
- `GEMINI_API_KEY` takes several keys, comma-separated, each from its own Google Cloud project. When one runs out, the next takes over.
- Pick models with a bigger free allowance in `GEMINI_TEXT_MODEL` / `GEMINI_TRANSCRIBE_MODEL` (see https://ai.dev/rate-limit).

**When the AI fails.** Each call has a 30s timeout and one retry, except errors that won't go away: a bad key, no credits, or out of quota (`429`). After a `429` the server stops calling that model until Google says it's back (no wasted requests) and the game falls back:
- **Transcribing fails:** `/submit` returns `502`, the phone offers **Send again**, and the describer gets 10 more seconds. A second failure in the same turn ends it, so a broken AI can't loop a turn forever.
- **Out of requests while transcribing:** retrying can't help, so `/submit` returns `503` and the turn ends right away. Either way: 0 points for the describer (no penalty), guesses still scored.
- **Drawing or judging fails:** the turn still ends. The description and the guesses are scored by shared words with the target's `prompt` ([`src/ai/wordMatch.ts`](src/ai/wordMatch.ts)), with an "ran out of ink" placeholder and caption.

Drawn images are shrunk to 768px JPEGs (about 100 KB instead of a 1 MB PNG), kept in memory, and served at `GET /images/:id`, using `PUBLIC_URL` as the address. Model names come from `GEMINI_TEXT_MODEL` / `GEMINI_TRANSCRIBE_MODEL` / `GEMINI_IMAGE_MODEL`.

The Gemini image model has no free tier. Without billing, set `IMAGE_PROVIDER=pollinations` to draw with [Pollinations](https://pollinations.ai) instead ([`src/ai/pollinations.ts`](src/ai/pollinations.ts)): free, no key, slower (10–30s a drawing). Without a token it rate-limits requests close together; a free token from [auth.pollinations.ai](https://auth.pollinations.ai) in `POLLINATIONS_TOKEN` raises the limit. Gemini still does everything else. If you leave it unset and the Gemini image model fails, Pollinations draws instead.

`npm run live:gemini` plays a few rounds against the real API and saves the drawings to `live-output/`. It spends about 6 requests of the daily allowance.

**Storybook.** When the game ends, one more text-model call writes a title and one narration line per turn ([`src/story.ts`](src/story.ts)), while the podium and the Hall of Shame are on screen. If it fails, each page's caption is its narration. Finished storybooks are kept in memory for 6 hours (`storyTtlMs`) and served at `GET /stories/:id` for the shareable page; the image store keeps the newest 500 drawings so their pictures stay up too.

Without a key, the **fake AI** ([`src/ai/fake.ts`](src/ai/fake.ts)) runs instead. Text (sent by the bots and tests, never by phones) is used as the transcript, audio gets a canned one, the score is a hash of the words, guesses score by the words they share with the target's `prompt`, and the image is a placeholder. Say **"goose"** to make it refuse. Tests and `npm run bots` always use the fake AI.

## Layout

```
src/
  index.ts          starts the server (reads .env)
  app.ts            wires Express, Socket.io, rooms, /submit, and /stories together
  config.ts         game rules
  types.ts          shared types (copied from web/lib/mocks.ts)
  sockets.ts        socket events → Room methods
  rooms/Room.ts     one game: players, phases, timers, scoring
  rooms/RoomStore.ts  room codes
  rooms/hallOfShame.ts
  http/submit.ts    POST /submit
  story.ts          the end-of-game storybook and GET /stories/:id
  ai/               the AI interface, Gemini, the fake AI, and the drawn-image store
  bannedWords.ts
  targets.ts
data/               targets.json and the target images
scripts/            bot game, generate:images, live:gemini, helpers shared with tests
test/
```
