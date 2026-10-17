import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Ai } from "../src/ai/index.js";
import { createFakeAi } from "../src/ai/fake.js";
import { Client, startTestServer, submit } from "../scripts/lib.js";
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
    await host.waitFor("round_intro");
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
    const intro = await host.waitFor("round_intro", (r) => r.round === 2);
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
    const slow = await startTestServer({ config: { introMs: 50, revealMs: 60_000, fakeAiDelayMs: 0 } });
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

  test("if the AI fails, the describer gets a 502 and can try again", async () => {
    let failNext = true;
    const fake = createFakeAi(0);
    const flaky: Ai = {
      ...fake,
      draw: async (transcript, target) => {
        if (failNext) {
          failNext = false;
          throw new Error("Gemini is down");
        }
        return fake.draw(transcript, target);
      },
    };
    const flakyServer = await startTestServer({ ai: flaky });
    const { host, code, players, closeAll } = await setUp(flakyServer.url, ["Sam", "Ana"]);
    host.socket.emit("start_game");
    await players[0]!.client.waitFor("your_turn");

    const originalError = console.error;
    console.error = () => {}; // the server logs the failure; keep test output clean
    const first = await submit(flakyServer.url, { roomCode: code, playerId: players[0]!.id, text: "a dog" });
    console.error = originalError;
    assert.equal(first.status, 502);

    const retry = await submit(flakyServer.url, { roomCode: code, playerId: players[0]!.id, text: "a dog" });
    assert.equal(retry.status, 200);
    await host.waitFor("round_result");
    closeAll();
    await flakyServer.close();
  });

  test("playing again resets scores", async () => {
    const { host, closeAll } = await setUp(server.url, ["Sam", "Ana"]);
    host.socket.emit("start_game");
    await host.waitFor("hall_of_shame", undefined, 15_000);
    host.socket.emit("start_game");
    await host.waitFor("round_intro", (r) => r.round === 1 && host.all("round_intro").length > 2);
    closeAll();
  });
});
