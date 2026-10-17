import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHallOfShame, type RoundRecord } from "../src/rooms/hallOfShame.js";

const round = (playerName: string, transcript: string, score: number, extra: Partial<RoundRecord> = {}): RoundRecord => ({
  playerName,
  transcript,
  imageUrl: `https://example.com/${playerName}.png`,
  score,
  bannedHits: 0,
  refused: false,
  ...extra,
});

test("stats, worst misses, and worst words", () => {
  const shame = buildHallOfShame([
    round("Sam", "basically a horse but sadder", 3),
    round("Ana", "a red apple on a table", 90, { bannedHits: 2 }),
    round("Kim", "basically soup", 9),
    round("Lee", "", 0), // timed out: no transcript, so not a "miss" worth showing
    round("Max", "a goose", 0, { refused: true, imageUrl: "" }),
  ]);
  assert.deepEqual(shame.stats, { roundsPlayed: 5, avgScore: 20, bannedBuzzes: 2, refusals: 1 });
  assert.deepEqual(shame.worstMisses.map((m) => m.playerName), ["Max", "Sam", "Kim"]);
  assert.equal(shame.worstWords[0]?.word, "goose");
  assert.deepEqual(shame.worstWords.find((w) => w.word === "basically"), { word: "basically", avgScore: 6 });
});

test("an empty night", () => {
  assert.deepEqual(buildHallOfShame([]), {
    stats: { roundsPlayed: 0, avgScore: 0, bannedBuzzes: 0, refusals: 0 },
    worstMisses: [],
    worstWords: [],
  });
});
