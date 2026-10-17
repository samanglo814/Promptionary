import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { AiOutOfQuotaError, type Ai } from "../src/ai/index.js";
import { createFakeAi } from "../src/ai/fake.js";
import { Client, fakeAudio, fastConfig, startTestServer, submit } from "../scripts/lib.js";
import { playGame } from "../scripts/playGame.js";

// Opens a room with a host and the given players, all joined.
async function setUp(url: string, names: string[]) {
  const host = new Client(url, "host");
  host.socket.emit("create_room");
  const { code } = await host.waitFor("room_created");
  const players: { client: Client; id: string }[] = [];
  for (const name of names) {
    const client = new Client(url, name);
    client.socket.emit("join", { code, name });
    const { player } = await client.waitFor("joined");
    players.push({ client, id: player.id });
  }
  const closeAll = () => [host, ...players.map((p) => p.client)].forEach((c) => c.close());
  return { host, code, players, closeAll };
}

describe("game server", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  test("a full 5-player game follows the contract", async () => {
    const { problems } = await playGame({ url: server.url });
    assert.deepEqual(problems, []);
  });

  test("health check", async () => {
    const res = await fetch(`${server.url}/health`);
    assert.deepEqual(await res.json(), { ok: true });
  });

  test("join errors", async () => {
    const { host, code, closeAll } = await setUp(server.url, ["Sam"]);
    const tryJoin = async (payload: { code: string; name: string }) => {
      const c = new Client(server.url, payload.name);
      c.socket.emit("join", payload);
      const { reason } = await c.waitFor("join_error");
      c.close();
      return reason;
    };
    assert.equal(await tryJoin({ code: "ZZZZ", name: "Ana" }), "room_not_found");
    assert.equal(await tryJoin({ code, name: "sam" }), "name_taken");
    assert.equal(await tryJoin({ code, name: "   " }), "invalid_name");
    assert.equal(await tryJoin({ code, name: "x".repeat(17) }), "invalid_name");

    // Lowercase codes work too.
    const late = new Client(server.url, "Ana");
    late.socket.emit("join", { code: code.toLowerCase(), name: "Ana" });
    await late.waitFor("joined");

    host.socket.emit("start_game");
    await host.waitFor("turn_intro");
    assert.equal(await tryJoin({ code, name: "Lee" }), "game_started");
    late.close();
    closeAll();
  });

  test("can't start with one player", async () => {
    const { host, closeAll } = await setUp(server.url, ["Sam"]);
    host.socket.emit("start_game");
    const { message } = await host.waitFor("error");
    assert.match(message, /at least 2/);
    closeAll();
  });

  test("/submit rejects bad requests with the contract's status codes", async () => {
    const { host, code, players, closeAll } = await setUp(server.url, ["Sam", "Ana"]);
    const [sam, ana] = [players[0]!, players[1]!];

    assert.equal((await submit(server.url, { roomCode: "ZZZZ", playerId: sam.id, text: "hi" })).status, 404);
    assert.equal((await submit(server.url, { roomCode: code, playerId: sam.id })).status, 400);
    assert.equal((await submit(server.url, { roomCode: code, playerId: sam.id, text: "hi", audio: new Blob(["x"]) })).status, 400);
    assert.equal((await submit(server.url, { roomCode: code, playerId: sam.id, text: "x".repeat(201) })).status, 400);
    assert.equal((await submit(server.url, { roomCode: code, playerId: sam.id, text: "hi" })).status, 403, "lobby");

    host.socket.emit("start_game");
    await sam.client.waitFor("your_turn");
    assert.equal((await submit(server.url, { roomCode: code, playerId: ana.id, text: "hi" })).status, 403, "not her turn");
    const ok = await submit(server.url, { roomCode: code, playerId: sam.id, text: "a dog" });
    assert.equal(ok.status, 200);
    assert.equal((await submit(server.url, { roomCode: code, playerId: sam.id, text: "again" })).status, 403, "already submitted");
    closeAll();
  });

  test("a player who refreshes rejoins as the same player and gets their turn back", async () => {
    const { host, code, players, closeAll } = await setUp(server.url, ["Sam", "Ana"]);
    host.socket.emit("start_game");
    await players[0]!.client.waitFor("your_turn");

    players[0]!.client.close(); // phone refreshed
    const again = new Client(server.url, "Sam again");
    again.socket.emit("join", { code, name: "Sam", playerId: players[0]!.id });
    const { player } = await again.waitFor("joined");
    assert.equal(player.id, players[0]!.id);
    await again.waitFor("your_turn");
    again.close();
    closeAll();
  });

  test("a describer who leaves before submitting is skipped", async () => {
    const { host, players, closeAll } = await setUp(server.url, ["Sam", "Ana"]);
    host.socket.emit("start_game");
    await players[0]!.client.waitFor("your_turn");
    players[0]!.client.close();
    const intro = await host.waitFor("turn_intro", (t) => t.turn === 2);
    assert.equal(intro.describer.name, "Ana");
    closeAll();
  });

  test("players in the lobby disappear from the list when they leave", async () => {
    const { host, players, closeAll } = await setUp(server.url, ["Sam", "Ana"]);
    players[1]!.client.close();
    await host.waitFor("players", (p) => p.players.length === 1 && p.players[0]!.name === "Sam");
    closeAll();
  });

  test("when the host leaves, players are told", async () => {
    const { host, players, closeAll } = await setUp(server.url, ["Sam"]);
    host.close();
    const { message } = await players[0]!.client.waitFor("error");
    assert.match(message, /host left/);
    closeAll();
  });

  test("the host can skip the reveal", async () => {
    const slow = await startTestServer({ config: { ...fastConfig, revealMs: 60_000, fakeAiDelayMs: 0 } });
    const { host, code, players, closeAll } = await setUp(slow.url, ["Sam", "Ana"]);
    host.socket.emit("start_game");
    await players[0]!.client.waitFor("your_turn");
    await submit(slow.url, { roomCode: code, playerId: players[0]!.id, text: "a dog" });
    await host.waitFor("round_result");
    host.socket.emit("next");
    await host.waitFor("scoreboard", undefined, 1_000);
    closeAll();
    await slow.close();
  });

  test("if transcribing fails, the describer gets a 502 and extra time, but only once", async () => {
    let failures = 2;
    const fake = createFakeAi(0);
    const flaky: Ai = {
      ...fake,
      transcribe: async (description) => {
        if (failures-- > 0) throw new Error("Gemini is down");
        return fake.transcribe(description);
      },
    };
    const flakyServer = await startTestServer({ ai: flaky, config: { ...fastConfig, retryMs: 5_000 } });
    const { host, code, players, closeAll } = await setUp(flakyServer.url, ["Sam", "Ana"]);
    host.socket.emit("start_game");
    const { endsAt } = await players[0]!.client.waitFor("your_turn");
    const send = () => submit(flakyServer.url, { roomCode: code, playerId: players[0]!.id, audio: fakeAudio() });

    const originalError = console.error;
    console.error = () => {}; // the server logs the failures; keep test output clean
    assert.equal((await send()).status, 502);
    const retry = players[0]!.client.all("your_turn").at(-1)!;
    assert.ok(retry.endsAt > endsAt, "the first failure buys more time");
    assert.equal((await send()).status, 502);
    console.error = originalError;
    assert.equal(players[0]!.client.all("your_turn").at(-1)!.endsAt, retry.endsAt, "the second one doesn't");

    assert.equal((await send()).status, 200);
    await host.waitFor("round_result");
    closeAll();
    await flakyServer.close();
  });

  test("when the AI is out of quota, the describer is asked to type, and typing still works", async () => {
    const fake = createFakeAi(0);
    const outOfQuota = () => Promise.reject(new AiOutOfQuotaError("text-model", Date.now() + 60_000));
    const broke: Ai = {
      ...fake,
      transcribe: async (description) => (description.kind === "audio" ? outOfQuota() : fake.transcribe(description)),
      draw: outOfQuota,
      judge: outOfQuota,
    };
    const brokeServer = await startTestServer({ ai: broke });
    const { host, code, players, closeAll } = await setUp(brokeServer.url, ["Sam", "Ana"]);
    host.socket.emit("start_game");
    const { target } = await players[0]!.client.waitFor("your_turn");

    const originalError = console.error;
    console.error = () => {};
    const voice = await submit(brokeServer.url, { roomCode: code, playerId: players[0]!.id, audio: fakeAudio() });
    assert.equal(voice.status, 503);
    assert.match((voice.body as { error: string }).error, /Type/);

    const typed = await submit(brokeServer.url, { roomCode: code, playerId: players[0]!.id, text: target.id.replace(/-/g, " ") });
    console.error = originalError;
    assert.equal(typed.status, 200);
    const turn = await host.waitFor("round_result");
    assert.ok(turn.result.score > 0, "scored by shared words");
    assert.match(turn.result.caption, /ran out of ink/);
    closeAll();
    await brokeServer.close();
  });

  test("start_game answers, so the host page knows the click arrived", async () => {
    const { host, closeAll } = await setUp(server.url, ["Sam"]);
    const answer = await host.socket.timeout(2_000).emitWithAck("start_game");
    assert.match(answer.error ?? "", /at least 2/);
    closeAll();
  });

  test("playing again keeps a player whose phone just dropped, and they can rejoin", async () => {
    const { host, code, players, closeAll } = await setUp(server.url, ["Sam", "Ana", "Bo"]);
    host.socket.emit("start_game");
    await host.waitFor("hall_of_shame", undefined, 15_000);
    players[2]!.client.close(); // Bo's phone locked during the Hall of Shame
    await host.waitFor("players", (p) => p.players.length === 2);

    host.socket.emit("start_game");
    await host.waitFor("round_start", () => host.all("round_start").length > 2);
    const bo = new Client(server.url, "Bo again");
    bo.socket.emit("join", { code, name: "Bo", playerId: players[2]!.id });
    assert.equal((await bo.waitFor("joined")).player.id, players[2]!.id, "same player, not \"game started\"");
    bo.close();
    closeAll();
  });

  test("a dropped connection comes back as the same socket, and a host blip doesn't close the room", async () => {
    const { host, code, closeAll } = await setUp(server.url, ["Sam", "Ana"]);
    // A real phone: reconnects by itself after a dropped connection.
    const phone = new Client(server.url, "Bo", { reconnection: true });
    phone.socket.emit("join", { code, name: "Bo" });
    await phone.waitFor("joined");
    await host.waitFor("players", (p) => p.players.length === 3);

    phone.socket.io.engine.close(); // the connection drops (not closed on purpose)
    await host.waitFor("players", (p) => p.players.length === 2);
    await new Promise((resolve) => phone.socket.once("connect", () => resolve(null)));
    assert.equal(phone.socket.recovered, true);
    await host.waitFor("players", () => host.all("players").at(-1)!.players.length === 3);

    // The host page blips too; the room survives and still starts.
    const hostPage = new Client(server.url, "host page", { reconnection: true });
    hostPage.socket.emit("create_room");
    const room = await hostPage.waitFor("room_created");
    const sam = new Client(server.url, "Sam2");
    sam.socket.emit("join", { code: room.code, name: "Sam" });
    await sam.waitFor("joined");
    hostPage.socket.io.engine.close();
    await new Promise((resolve) => hostPage.socket.once("connect", () => resolve(null)));
    assert.equal(hostPage.socket.recovered, true);
    const answer = await hostPage.socket.timeout(2_000).emitWithAck("start_game");
    assert.match(answer.error ?? "", /at least 2/, "same room, still there");
    assert.equal(sam.all("error").length, 0, "players weren't told the host left");

    [phone, hostPage, sam].forEach((c) => c.close());
    closeAll();
  });

  test("playing again resets scores", async () => {
    const { host, closeAll } = await setUp(server.url, ["Sam", "Ana"]);
    host.socket.emit("start_game");
    await host.waitFor("hall_of_shame", undefined, 15_000);
    host.socket.emit("start_game");
    // 2 players × 2 rounds = 4 turns in the first game.
    await host.waitFor("turn_intro", (t) => t.round === 1 && host.all("turn_intro").length > 4);
    const restart = host.all("round_start").at(-1)!;
    assert.deepEqual([restart.round, restart.leader, restart.gap], [1, null, 0], "scores were reset");
    closeAll();
  });
});

describe("guessing", () => {
  // Long describing and guessing windows, so anything that ends a turn early is the code under test.
  const slowWindows = { ...fastConfig, describeMs: 60_000, guessMs: 60_000, fakeAiDelayMs: 0 };

  test("one guess per player, only while someone is describing, never by the describer", async () => {
    const server = await startTestServer({ config: slowWindows });
    const { host, players, closeAll } = await setUp(server.url, ["Sam", "Ana", "Bo"]);
    const [sam, ana] = [players[0]!, players[1]!];
    const guess = async (player: { client: Client }, text: string) => {
      const before = player.client.all("guess_error").length;
      player.client.socket.emit("guess", { text });
      await Promise.race([
        player.client.waitFor("guess_error", () => player.client.all("guess_error").length > before),
        player.client.waitFor("guess_locked", (g) => g.text === text.trim().replace(/\s+/g, " ")),
      ]);
      return player.client.all("guess_error").slice(before)[0]?.reason ?? "ok";
    };

    assert.equal(await guess(ana, "a dog"), "not_now", "lobby");
    host.socket.emit("start_game");
    await sam.client.waitFor("your_turn");
    assert.equal(await guess(sam, "a dog"), "describer");
    assert.equal(await guess(ana, "   "), "invalid_guess");
    assert.equal(await guess(ana, "x".repeat(61)), "invalid_guess");
    assert.equal(await guess(ana, "  a   dog on wheels "), "ok");
    const locked = ana.client.all("guess_locked")[0]!;
    assert.equal(locked.text, "a dog on wheels", "whitespace is tidied");
    assert.ok(locked.speed > 95 && locked.speed <= 100, `an instant guess keeps its value (${locked.speed})`);
    assert.equal(await guess(ana, "a cat"), "already_guessed");

    const lit = await host.waitFor("guesses_locked", (g) => g.playerIds.length === 1);
    assert.deepEqual(lit, { playerIds: [ana.id], open: true }, "the host sees who guessed, not what");
    assert.equal(host.log.some((e) => JSON.stringify(e.payload).includes("dog on wheels")), false);
    closeAll();
    await server.close();
  });

  test("the reveal waits for the guess window, and guesses earn points", async () => {
    const server = await startTestServer({ config: { ...fastConfig, guessMs: 1_000, fakeAiDelayMs: 0 } });
    const { host, code, players, closeAll } = await setUp(server.url, ["Sam", "Ana", "Bo"]);
    const [sam, ana] = [players[0]!, players[1]!];
    host.socket.emit("start_game");
    const { target } = await sam.client.waitFor("your_turn");
    const started = Date.now();
    ana.client.socket.emit("guess", { text: target.id.replace(/-/g, " ") }); // e.g. "dog skateboard": close
    await ana.client.waitFor("guess_locked");
    const res = await submit(server.url, { roomCode: code, playerId: sam.id, text: "a dog" });
    assert.equal(res.status, 200, "/submit answers with the reveal");

    const turn = await host.waitFor("round_result"); // Bo never guesses, so the window runs out
    assert.ok(Date.now() - started >= 900, "the reveal waited for the guess window");
    assert.equal(turn.guesses.length, 1);
    const [g] = turn.guesses;
    assert.equal(g!.playerName, "Ana");
    assert.ok(g!.accuracy > 0 && g!.points > 0, `a close guess earns points: ${JSON.stringify(g)}`);
    // 3 players: one guess is worth up to 335 in round 1.
    assert.equal(g!.points, Math.round((335 * g!.accuracy * g!.speed) / 10_000));
    assert.equal(turn.breakdown.clarity, Math.round(2 * g!.accuracy), "clarity comes from the guesses");

    const { standings } = await host.waitFor("scoreboard");
    assert.equal(standings.find((s) => s.id === ana.id)!.spectatorPoints, g!.points);
    assert.equal(standings.find((s) => s.id === sam.id)!.prompterPoints, turn.breakdown.total);
    closeAll();
    await server.close();
  });

  test("guessing closes early once everyone has guessed, or the last one waiting leaves", async () => {
    const server = await startTestServer({ config: slowWindows });
    const { host, code, players, closeAll } = await setUp(server.url, ["Sam", "Ana", "Bo"]);
    const [sam, ana, bo] = [players[0]!, players[1]!, players[2]!];
    host.socket.emit("start_game");
    await sam.client.waitFor("your_turn");
    // /submit answers with the reveal, which waits for the guesses, so don't wait for it here.
    void submit(server.url, { roomCode: code, playerId: sam.id, text: "a dog" });
    ana.client.socket.emit("guess", { text: "a dog" });
    bo.client.socket.emit("guess", { text: "a cat" });
    // Without the early close this would take a minute.
    const first = await host.waitFor("round_result", undefined, 3_000);
    assert.equal(first.guesses.length, 2);

    // Ana's turn: Sam guesses, Bo leaves, nobody is left to wait for.
    await host.waitFor("describing", (d) => d.describer.id === ana.id, 5_000);
    void submit(server.url, { roomCode: code, playerId: ana.id, text: "a dog" });
    sam.client.socket.emit("guess", { text: "a dog" });
    await sam.client.waitFor("guess_locked");
    bo.client.close();
    await host.waitFor("round_result", (r) => r.playerName === "Ana", 3_000);
    closeAll();
    await server.close();
  });

  test("a guesser who refreshes gets the guess box and their guess back", async () => {
    const server = await startTestServer({ config: slowWindows });
    const { host, code, players, closeAll } = await setUp(server.url, ["Sam", "Ana", "Bo"]);
    host.socket.emit("start_game");
    await players[0]!.client.waitFor("your_turn");
    players[1]!.client.socket.emit("guess", { text: "a dog" });
    await players[1]!.client.waitFor("guess_locked");

    players[1]!.client.close(); // phone refreshed
    const again = new Client(server.url, "Ana again");
    again.socket.emit("join", { code, name: "Ana", playerId: players[1]!.id });
    const describing = await again.waitFor("describing");
    assert.equal(describing.describer.name, "Sam");
    assert.equal((await again.waitFor("guess_locked")).text, "a dog");
    again.close();
    closeAll();
    await server.close();
  });

  test("if the AI can't judge, shared words score the guesses and the description instead", async () => {
    const fake = createFakeAi(0);
    const broken: Ai = { ...fake, judge: async () => Promise.reject(new Error("Gemini is down")) };
    const server = await startTestServer({ ai: broken, config: { ...slowWindows, describeMs: 1_000 } });
    const { host, code, players, closeAll } = await setUp(server.url, ["Sam", "Ana"]);
    host.socket.emit("start_game");
    const { target } = await players[0]!.client.waitFor("your_turn");

    const originalError = console.error;
    console.error = () => {}; // the server logs the failure; keep test output clean
    players[1]!.client.socket.emit("guess", { text: target.id.replace(/-/g, " ") });
    await submit(server.url, { roomCode: code, playerId: players[0]!.id, text: "a dog" });
    const turn = await host.waitFor("round_result", undefined, 3_000);
    console.error = originalError;
    assert.ok(turn.guesses[0]!.accuracy > 0, "the target's own words still match its description");
    assert.match(turn.result.caption, /ran out of ink/);
    closeAll();
    await server.close();
  });

  test("round 2 is worth 1.5x and goes lowest score first", async () => {
    const server = await startTestServer({ config: { ...fastConfig, fakeAiDelayMs: 0 } });
    const { host, code, players, closeAll } = await setUp(server.url, ["Sam", "Ana", "Bo"]);
    // Only Sam describes in round 1, so Ana and Bo (0 points) go before him in round 2.
    players[0]!.client.socket.once("your_turn", () => {
      void submit(server.url, { roomCode: code, playerId: players[0]!.id, text: "a scruffy dog riding a skateboard" });
    });
    host.socket.emit("start_game");
    const round2 = await host.waitFor("round_start", (r) => r.round === 2, 15_000);
    assert.equal(round2.multiplier, 1.5);
    const samScore = host.all("scoreboard").at(-1)!.standings.find((s) => s.name === "Sam")!.score;
    if (samScore > 0) assert.deepEqual([round2.leader?.name, round2.gap], ["Sam", samScore]);

    await host.waitFor("turn_intro", (t) => t.round === 2 && t.turn === 3, 15_000);
    const order = host.all("turn_intro").filter((t) => t.round === 2).map((t) => t.describer.name);
    assert.deepEqual(order, samScore > 0 ? ["Ana", "Bo", "Sam"] : ["Sam", "Ana", "Bo"]);
    closeAll();
    await server.close();
  });
});
