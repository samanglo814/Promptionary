import { isDeepStrictEqual } from "node:util";
import { defaultConfig } from "../src/config.js";
import type { Standing } from "../src/types.js";
import { Client, fakeAudio, submit } from "./lib.js";
import { checkEvent, checkSubmitResult } from "./validate.js";

// A scripted game: one host screen and five phones, each describing a different way,
// so one run covers typed text, voice, a banned word, a refusal, and a timeout.
// Everyone but Eve guesses on every turn, so most turns wait for the guess window and
// Eve's own turn closes it early. Alice cheats (the script tells her the answer), so some
// guesses always score; the others guess the same thing every time.
type Plan = "text" | "banned" | "audio" | "refuse" | "silent";
const bots: { name: string; plan: Plan; guess?: string }[] = [
  { name: "Alice", plan: "text", guess: "the answer" },
  { name: "Bob", plan: "banned", guess: "some animal doing a sport" },
  { name: "Cara", plan: "audio", guess: "a cat in a business suit" },
  { name: "Dan", plan: "refuse", guess: "a giant cake volcano" },
  { name: "Eve", plan: "silent" },
];

// The scoring rules, written out again here (not imported from src/scoring.ts) so a mistake
// there can't hide here. They assume the server runs the default rules from config.ts.
const rules = defaultConfig;
const rounds = rules.roundMultipliers.length;
// What one guess is worth with 5 players: a round of guessing is worth 2/3 of a perfect turn
// (1000 × 0.4 / 0.6), split over 4 guesses = 166.7, times the multiplier, to the nearest 5.
const maxGuess = [165, 250];

type Options = {
  url: string;
  timeoutMs?: number;
  log?: (line: string) => void;
};

// Plays a whole game and returns every problem found (empty means it all worked).
export async function playGame({ url, timeoutMs = 30_000, log = () => {} }: Options) {
  const problems: string[] = [];
  const expect = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };

  const host = new Client(url, "host");
  host.socket.onAny((event: string, payload: unknown) => {
    log(`[host] ${event} ${JSON.stringify(payload).slice(0, 110)}`);
  });
  const phones: { name: string; plan: Plan; guess?: string; client: Client; id: string; responses: { status: number; body: unknown }[] }[] = [];

  try {
    host.socket.emit("create_room");
    const { code } = await host.waitFor("room_created");

    for (const bot of bots) {
      const client = new Client(url, bot.name);
      client.socket.emit("join", { code, name: bot.name });
      const { player } = await client.waitFor("joined");
      const phone = { ...bot, client, id: player.id, responses: [] as { status: number; body: unknown }[] };
      phones.push(phone);

      client.socket.on("your_turn", async ({ target }) => {
        const said = {
          text: "a small furry animal riding a plank with tiny circles under it",
          banned: `it's a ${target.bannedWords[0]} doing something weird`,
          refuse: "a goose being extremely dramatic",
        };
        if (bot.plan === "silent") return;
        // A phone says when it hears the first word; the audio bot doesn't, so /submit starts the guess clock.
        if (bot.plan !== "audio") client.socket.emit("speaking");
        const fields =
          bot.plan === "audio"
            ? { roomCode: code, playerId: player.id, audio: fakeAudio() }
            : { roomCode: code, playerId: player.id, text: said[bot.plan] };
        phone.responses.push(await submit(url, fields));
      });

      client.socket.on("describing", async ({ describer, endsAt }) => {
        if (!bot.guess || describer.id === player.id) return;
        let text = bot.guess;
        if (bot.name === "Alice") {
          const describerPhone = phones.find((p) => p.id === describer.id)!;
          const { target } = await describerPhone.client.waitFor("your_turn", (t) => t.endsAt === endsAt);
          text = target.id.replace(/-/g, " "); // e.g. "dog skateboard"
        }
        client.socket.emit("guess", { text });
      });
    }

    await host.waitFor("players", (p) => p.players.length === bots.length);
    host.socket.emit("start_game");
    await host.waitFor("storybook", undefined, timeoutMs);
    for (const phone of phones) await phone.client.waitFor("storybook", undefined, timeoutMs);
  } catch (err) {
    problems.push(String(err));
    return { problems };
  } finally {
    host.close();
    for (const phone of phones) phone.client.close();
  }
  const nameOf = (id: string) => phones.find((p) => p.id === id)?.name;

  // 1. Every payload anyone received matches the contract, and nobody's guess was refused.
  for (const client of [host, ...phones.map((p) => p.client)]) {
    for (const { event, payload } of client.log) {
      const problem = checkEvent(event, payload);
      if (problem) problems.push(`${client.label}: ${problem}`);
    }
    expect(client.all("guess_error").length === 0, `${client.label} got guess_error: ${JSON.stringify(client.all("guess_error"))}`);
  }

  // 2. Two rounds, the second worth more. Round 1 in join order; round 2 lowest score first.
  const roundStarts = host.all("round_start");
  expect(
    isDeepStrictEqual(roundStarts.map((r) => [r.round, r.totalRounds, r.multiplier]), [[1, 2, 1], [2, 2, 1.5]]),
    `round_start looks wrong: ${JSON.stringify(roundStarts)}`,
  );
  expect(roundStarts[0]?.leader === null && roundStarts[0]?.gap === 0, "round 1 shouldn't have a leader");

  const intros = host.all("turn_intro");
  const order = (round: number) => intros.filter((i) => i.round === round).map((i) => i.describer.name);
  expect(isDeepStrictEqual(order(1), bots.map((b) => b.name)), `round 1 out of order: ${order(1)}`);
  // The scoreboard after the last turn of round 1 has the scores round 2 is ordered by.
  const afterRound1 = host.all("scoreboard")[bots.length - 1]?.standings ?? [];
  const joinIndex = (name: string) => bots.findIndex((b) => b.name === name);
  const expectedRound2 = [...afterRound1]
    .sort((a, b) => a.score - b.score || joinIndex(a.name) - joinIndex(b.name))
    .map((s) => s.name);
  expect(isDeepStrictEqual(order(2), expectedRound2), `round 2 should go lowest score first: ${order(2)} vs ${expectedRound2}`);
  expect(
    intros.every((i) => i.turnsInRound === bots.length && i.multiplier === rules.roundMultipliers[i.round - 1]),
    "turn_intro has the wrong turn count or multiplier",
  );
  expect(roundStarts[1]?.leader?.id === afterRound1[0]?.id || roundStarts[1]?.leader === null, "round 2 leader is wrong");

  const results = host.all("round_result");
  expect(isDeepStrictEqual(results.map((r) => r.playerName), intros.map((i) => i.describer.name)), "round_result order is wrong");
  expect(results.length === bots.length * rounds, `expected ${bots.length * rounds} turns, got ${results.length}`);
  expect(host.all("scoreboard").length === results.length - 1, "expected a scoreboard after every turn but the last");

  // 3. Only the describer ever sees the target: one your_turn per round each.
  for (const phone of phones) {
    expect(phone.client.all("your_turn").length === rounds, `${phone.name} got ${phone.client.all("your_turn").length} your_turn events`);
  }

  // 4. Each plan did what it should, every round.
  for (const phone of phones) {
    const mine = results.filter((r) => r.playerName === phone.name);
    expect(mine.length === rounds, `${phone.name} described ${mine.length} times`);
    if (phone.plan !== "silent") {
      expect(phone.responses.length === rounds, `${phone.name} submitted ${phone.responses.length} times`);
    }
    mine.forEach(({ result }, i) => {
      if (phone.plan !== "silent") {
        const res = phone.responses[i];
        expect(res?.status === 200, `${phone.name}: /submit returned ${res?.status} ${JSON.stringify(res?.body)}`);
        const problem = checkSubmitResult(res?.body);
        if (problem) problems.push(`${phone.name}: ${problem}`);
        expect(isDeepStrictEqual(res?.body, result), `${phone.name}: /submit response differs from round_result`);
      }
      if (phone.plan === "refuse") {
        expect(result.refused === true && result.score === 0 && result.imageUrl === "", `refusal looks wrong: ${JSON.stringify(result)}`);
      }
      if (phone.plan === "silent") {
        expect(result.transcript === "" && result.score === 0, `timeout looks wrong: ${JSON.stringify(result)}`);
      }
      if (phone.plan === "audio") expect(result.transcript.length > 0, "audio produced an empty transcript");
    });
    if (phone.plan === "banned") {
      const buzzes = host.all("banned_buzz").filter((b) => b.playerId === phone.id).length;
      expect(buzzes === rounds, `Bob said a banned word each round but got ${buzzes} banned_buzz`);
    }
  }

  // 5. Every point adds up, recomputed from scratch.
  // Banned words said in each turn (the buzzes between its turn_intro and its round_result).
  const buzzesPerTurn: number[] = [];
  for (const { event } of host.log) {
    if (event === "turn_intro") buzzesPerTurn.push(0);
    if (event === "banned_buzz") buzzesPerTurn[buzzesPerTurn.length - 1]!++;
  }
  const earned = new Map<string, { prompter: number; spectator: number; finalRound: number }>();
  for (const phone of phones) earned.set(phone.id, { prompter: 0, spectator: 0, finalRound: 0 });
  results.forEach(({ playerName, result, breakdown: b, guesses }, i) => {
    const round = intros[i]!.round;
    const multiplier = rules.roundMultipliers[round - 1]!;
    const describer = phones.find((p) => p.name === playerName)!;
    const label = `${playerName} (round ${round})`;

    // Guesses: everyone but the describer and Eve, once each.
    const expectedGuessers = phones.filter((p) => p.guess && p.id !== describer.id).map((p) => p.name).sort();
    expect(isDeepStrictEqual(guesses.map((g) => g.playerName).sort(), expectedGuessers), `${label}: wrong guessers ${JSON.stringify(guesses)}`);
    for (const g of guesses) {
      const guesser = phones.find((p) => p.id === g.playerId)!;
      expect(g.text === (guesser.name === "Alice" ? g.text : guesser.guess) && g.text !== "", `${label}: guess text changed`);
      expect(g.speed >= 70 && g.speed <= 100, `${label}: speed ${g.speed} out of range`);
      const points = Math.round((maxGuess[round - 1]! * g.accuracy * g.speed) / 10_000);
      expect(g.points === points, `${label}: ${g.playerName}'s guess earned ${g.points}, expected ${points}`);
      const e = earned.get(g.playerId)!;
      e.spectator += g.points;
      if (round === rounds) e.finalRound += g.points;
    }

    // The describer.
    expect(b.multiplier === multiplier, `${label}: multiplier ${b.multiplier}`);
    if (describer.plan === "silent") {
      expect(b.accuracy + b.clarity + b.speed + b.bannedPenalty + b.total === 0, `${label}: a timeout should earn nothing`);
    } else {
      const avg = guesses.length ? guesses.reduce((sum, g) => sum + g.accuracy, 0) / guesses.length : result.score;
      expect(b.accuracy === Math.round(7 * result.score), `${label}: accuracy ${b.accuracy} for score ${result.score}`);
      expect(b.clarity === Math.round(2 * avg), `${label}: clarity ${b.clarity}, expected ${Math.round(2 * avg)}`);
      expect(result.score >= 40 ? b.speed >= 0 && b.speed <= 100 : b.speed === 0, `${label}: speed bonus ${b.speed} for score ${result.score}`);
      // (Bob always says one. The fake AI's voice transcript says "wheels", banned for dog-skateboard.)
      expect(b.bannedPenalty === 100 * buzzesPerTurn[i]!, `${label}: banned penalty ${b.bannedPenalty}, ${buzzesPerTurn[i]} buzzes`);
      if (describer.plan === "banned") expect(b.bannedPenalty === 100, `${label}: Bob said a banned word`);
      const total = Math.round(Math.max(0, b.accuracy + b.clarity + b.speed - b.bannedPenalty) * multiplier);
      expect(b.total === total, `${label}: total ${b.total}, expected ${total}`);
    }
    const e = earned.get(describer.id)!;
    e.prompter += b.total;
    if (round === rounds) e.finalRound += b.total;
  });

  // 6. Final standings: the sums above, sorted best first with ranks, plus awards.
  const final: Standing[] = host.all("game_over")[0]?.standings ?? [];
  for (const phone of phones) {
    const s = final.find((x) => x.id === phone.id);
    const e = earned.get(phone.id)!;
    expect(
      s?.prompterPoints === e.prompter && s.spectatorPoints === e.spectator && s.finalRoundPoints === e.finalRound,
      `${phone.name}: standings ${JSON.stringify(s)} don't match points earned ${JSON.stringify(e)}`,
    );
    expect(s?.score === e.prompter + e.spectator, `${phone.name}: final score ${s?.score}, expected ${e.prompter + e.spectator}`);
  }
  expect(
    final.every((s, i) => i === 0 || s.score <= final[i - 1]!.score) && final[0]?.rank === 1,
    `standings aren't sorted: ${JSON.stringify(final.map((s) => [s.name, s.score, s.rank]))}`,
  );
  const awards = host.all("game_over")[0]?.awards ?? [];
  expect(awards.some((a) => a.title === "Closest Drawing"), `no Closest Drawing award: ${JSON.stringify(awards)}`);
  expect(awards.some((a) => a.title === "Sharpest Guesser"), `no Sharpest Guesser award: ${JSON.stringify(awards)}`);
  const alice = final.find((s) => s.name === "Alice");
  expect((alice?.spectatorPoints ?? 0) > 0, "Alice knew every answer but earned nothing guessing");

  // 7. The host saw who locked in, and every turn's guessing closed.
  const locks = host.all("guesses_locked");
  expect(locks.filter((l) => !l.open).length === results.length, "every turn should close guessing once");
  expect(locks.every((l) => l.playerIds.every((id) => nameOf(id) && nameOf(id) !== "Eve")), "guesses_locked lists the wrong players");

  // 8. Hall of Shame counted the night.
  const shame = host.all("hall_of_shame")[0]?.data;
  expect(shame?.stats.roundsPlayed === results.length, `Hall of Shame counted ${shame?.stats.roundsPlayed} turns`);
  expect((shame?.stats.refusals ?? 0) >= 1 && (shame?.stats.bannedBuzzes ?? 0) >= 1, "Hall of Shame missed the refusal or the buzz");

  // 9. The storybook tells every turn in order, and its link opens the same book.
  const story = host.all("storybook")[0]?.story;
  expect(story?.pages.length === results.length, `the storybook has ${story?.pages.length} pages for ${results.length} turns`);
  expect(
    story?.pages.every((page, i) => page.playerName === results[i]?.playerName && page.caption === results[i]?.result.caption) ?? false,
    "storybook pages don't match the turns played",
  );
  expect(story?.pages.some((page) => page.refused) ?? false, "the storybook lost the refusal");
  if (story) {
    const res = await fetch(`${url}/stories/${story.id}`);
    const body: unknown = res.ok ? await res.json() : undefined;
    expect(res.ok && isDeepStrictEqual(body, story), `GET /stories/${story.id} answered ${res.status} with a different storybook`);
    expect(checkEvent("storybook", { story: body }) === null, "GET /stories/:id doesn't match the contract");
  }

  return { problems, results, standings: final };
}
