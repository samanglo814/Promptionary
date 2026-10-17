import { isDeepStrictEqual } from "node:util";
import type { SubmitResult } from "../src/types.js";
import { Client, fakeAudio, submit } from "./lib.js";
import { checkEvent, checkSubmitResult } from "./validate.js";

// A scripted game: one host screen and five phones, each describing a different way,
// so one run covers typed text, voice, a banned word, a refusal, and a timeout.
type Plan = "text" | "banned" | "audio" | "refuse" | "silent";
const bots: { name: string; plan: Plan }[] = [
  { name: "Alice", plan: "text" },
  { name: "Bob", plan: "banned" },
  { name: "Cara", plan: "audio" },
  { name: "Dan", plan: "refuse" },
  { name: "Eve", plan: "silent" },
];

type Options = {
  url: string;
  bannedWordPenalty?: number;
  timeoutMs?: number;
  log?: (line: string) => void;
};

// Plays a whole game and returns every problem found (empty means it all worked).
export async function playGame({ url, bannedWordPenalty = 10, timeoutMs = 30_000, log = () => {} }: Options) {
  const problems: string[] = [];
  const expect = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };

  const host = new Client(url, "host");
  host.socket.onAny((event: string, payload: unknown) => {
    log(`[host] ${event} ${JSON.stringify(payload).slice(0, 110)}`);
  });
  const phones: { name: string; plan: Plan; client: Client; id: string; responses: { status: number; body: unknown }[] }[] = [];

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
        const fields =
          bot.plan === "audio"
            ? { roomCode: code, playerId: player.id, audio: fakeAudio() }
            : { roomCode: code, playerId: player.id, text: said[bot.plan] };
        phone.responses.push(await submit(url, fields));
      });
    }

    await host.waitFor("players", (p) => p.players.length === bots.length);
    host.socket.emit("start_game");
    await host.waitFor("hall_of_shame", undefined, timeoutMs);
    for (const phone of phones) await phone.client.waitFor("hall_of_shame");
  } catch (err) {
    problems.push(String(err));
    return { problems };
  } finally {
    host.close();
    for (const phone of phones) phone.client.close();
  }

  // 1. Every payload anyone received matches the contract.
  for (const client of [host, ...phones.map((p) => p.client)]) {
    for (const { event, payload } of client.log) {
      const problem = checkEvent(event, payload);
      if (problem) problems.push(`${client.label}: ${problem}`);
    }
  }

  // 2. Turns go in join order, one each.
  const intros = host.all("round_intro");
  expect(
    isDeepStrictEqual(intros.map((i) => [i.round, i.totalRounds, i.describer.name]), bots.map((b, i) => [i + 1, bots.length, b.name])),
    `rounds out of order: ${JSON.stringify(intros)}`,
  );
  const results = host.all("round_result");
  expect(isDeepStrictEqual(results.map((r) => r.playerName), bots.map((b) => b.name)), "round_result order is wrong");
  expect(host.all("scoreboard").length === bots.length - 1, "expected a scoreboard between every round");

  // 3. Only the describer ever sees the target.
  for (const phone of phones) {
    expect(phone.client.all("your_turn").length === 1, `${phone.name} got ${phone.client.all("your_turn").length} your_turn events`);
  }

  // 4. Each plan did what it should.
  const resultOf = (name: string) => results.find((r) => r.playerName === name)?.result;
  for (const phone of phones) {
    const result = resultOf(phone.name);
    if (!result) continue;
    if (phone.plan !== "silent") {
      const res = phone.responses[0];
      expect(res?.status === 200, `${phone.name}: /submit returned ${res?.status} ${JSON.stringify(res?.body)}`);
      const problem = checkSubmitResult(res?.body);
      if (problem) problems.push(`${phone.name}: ${problem}`);
      expect(isDeepStrictEqual(res?.body, result), `${phone.name}: /submit response differs from round_result`);
    }
    if (phone.plan === "banned") {
      expect(host.all("banned_buzz").some((b) => b.playerId === phone.id), "Bob said a banned word but there was no banned_buzz");
    }
    if (phone.plan === "refuse") {
      expect(result.refused === true && result.score === 0 && result.imageUrl === "", `refusal looks wrong: ${JSON.stringify(result)}`);
    }
    if (phone.plan === "silent") {
      expect(result.transcript === "" && result.score === 0, `timeout looks wrong: ${JSON.stringify(result)}`);
    }
    if (phone.plan === "audio") {
      expect(result.transcript.length > 0, "audio produced an empty transcript");
    }
  }

  // 5. Final scores = match score minus the banned-word penalty.
  const final = host.all("game_over")[0]?.standings ?? [];
  for (const phone of phones) {
    const result: SubmitResult | undefined = resultOf(phone.name);
    const buzzes = host.all("banned_buzz").filter((b) => b.playerId === phone.id).length;
    const expected = Math.max(0, (result?.score ?? 0) - bannedWordPenalty * buzzes);
    const actual = final.find((s) => s.id === phone.id)?.score;
    expect(actual === expected, `${phone.name}: final score ${actual}, expected ${expected}`);
  }

  // 6. Hall of Shame counted the night.
  const shame = host.all("hall_of_shame")[0]?.data;
  expect(shame?.stats.roundsPlayed === bots.length, `Hall of Shame counted ${shame?.stats.roundsPlayed} rounds`);
  expect((shame?.stats.refusals ?? 0) >= 1 && (shame?.stats.bannedBuzzes ?? 0) >= 1, "Hall of Shame missed the refusal or the buzz");

  return { problems, results, standings: final };
}
