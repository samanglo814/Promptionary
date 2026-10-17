import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wordMatchScore } from "../src/ai/wordMatch.js";
import { defaultConfig as config } from "../src/config.js";
import { guessPoints, maxGuessPoints, noPoints, prompterPoints, rankStandings, speedPercent } from "../src/scoring.js";

const turn = (score: number, guessAccuracies: number[], timeLeft: number, bannedWords: number, multiplier: number) =>
  prompterPoints(config, { score, guessAccuracies, timeLeft, bannedWords, multiplier });

describe("scoring", () => {
  // The worked example from the design: 4 players, two rounds.
  test("describer points: the worked example", () => {
    // Round 1. A: 80% match, guessers average 60%, a quarter of the time left.
    assert.deepEqual(turn(80, [50, 60, 70], 0.25, 0, 1), {
      accuracy: 560, clarity: 120, speed: 25, bannedPenalty: 0, multiplier: 1, total: 705,
    });
    // B: 35% match, one banned word, guessers average 30%. Under 40%, so no speed bonus.
    assert.deepEqual(turn(35, [30], 0.9, 1, 1), {
      accuracy: 245, clarity: 60, speed: 0, bannedPenalty: 100, multiplier: 1, total: 205,
    });
    // Round 2 (x1.5). B comes back: 525 + 140 + 20 = 685 → 1027.5 → 1028.
    assert.equal(turn(75, [70], 0.2, 0, 1.5).total, 1028);
    assert.equal(turn(50, [50], 0.1, 0, 1.5).total, 690);
  });

  test("a perfect turn is worth 1000, or 1500 in round 2", () => {
    assert.equal(turn(100, [100], 1, 0, 1).total, 1000);
    assert.equal(turn(100, [100], 1, 0, 1.5).total, 1500);
  });

  test("nobody guessing doesn't punish the describer: clarity uses the match score", () => {
    assert.equal(turn(60, [], 0, 0, 1).clarity, 120);
  });

  test("banned words can't push a turn below 0, and the penalty is multiplied too", () => {
    assert.equal(turn(10, [0], 0, 3, 1).total, 0);
    assert.equal(turn(50, [50], 0, 1, 1.5).total, Math.round((350 + 100 - 100) * 1.5));
  });

  test("the speed bonus needs at least 40% and is clamped to the describing time", () => {
    assert.equal(turn(39, [], 1, 0, 1).speed, 0);
    assert.equal(turn(40, [], 1, 0, 1).speed, 100);
    assert.equal(turn(90, [], -0.2, 0, 1).speed, 0, "sent during the grace period");
    assert.equal(turn(90, [], 1.3, 0, 1).speed, 100);
  });

  test("a timed-out turn earns nothing", () => {
    assert.deepEqual(noPoints(1.5), { accuracy: 0, clarity: 0, speed: 0, bannedPenalty: 0, multiplier: 1.5, total: 0 });
  });

  test("a guess is worth less in bigger rooms, capped at 400 (600 in round 2)", () => {
    const table = [2, 3, 4, 6, 8].map((n) => [n, maxGuessPoints(config, n, 1), maxGuessPoints(config, n, 1.5)]);
    assert.deepEqual(table, [
      [2, 400, 600],
      [3, 335, 500],
      [4, 220, 335],
      [6, 135, 200],
      [8, 95, 145],
    ]);
  });

  test("guessing is 40% of a perfect game in rooms of 3 or more", () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const guessing = (n - 1) * (maxGuessPoints(config, n, 1) + maxGuessPoints(config, n, 1.5));
      const share = guessing / (guessing + 2500);
      assert.ok(Math.abs(share - 0.4) < 0.01, `${n} players: guessing is ${(share * 100).toFixed(1)}%`);
    }
  });

  test("a guess keeps 100% of its value instantly and 70% at the end of the window", () => {
    assert.equal(speedPercent(config, 0), 100);
    assert.equal(speedPercent(config, config.guessMs * 0.4), 88);
    assert.equal(speedPercent(config, config.guessMs), 70);
    assert.equal(speedPercent(config, config.guessMs * 2), 70, "late guesses after an AI retry");
    // The worked example: 4 players, round 2, 80% accurate, locked in 40% into the window.
    assert.equal(guessPoints(335, 80, 88), 236);
    assert.equal(guessPoints(335, 0, 100), 0, "a fast wrong guess earns nothing");
  });

  test("standings: best first, ties broken by the final round, then by guessing", () => {
    const p = (name: string, score: number, finalRoundPoints: number, spectatorPoints: number) => ({
      id: name, name, score, lastTurn: 0, prompterPoints: score - spectatorPoints, spectatorPoints, finalRoundPoints,
    });
    const ranked = rankStandings([p("A", 900, 400, 100), p("B", 1200, 0, 0), p("C", 900, 500, 0), p("D", 900, 400, 100)]);
    assert.deepEqual(ranked.map((s) => [s.name, s.rank]), [["B", 1], ["C", 2], ["A", 3], ["D", 3]]);
  });
});

describe("word match (fake AI and fallback guess scoring)", () => {
  const prompt = "A scruffy dog wearing sunglasses riding a skateboard down a steep city street";

  test("naming the subject and the action scores high, wording differences still match", () => {
    assert.equal(wordMatchScore(prompt, "a dog riding a skateboard"), 100);
    assert.equal(wordMatchScore(prompt, "Dogs on skateboards!"), 67);
  });

  test("nothing in common, or nothing typed, scores 0", () => {
    assert.equal(wordMatchScore(prompt, "a cat in a bathtub"), 0);
    assert.equal(wordMatchScore(prompt, ""), 0);
  });

  test("listing lots of guesses scores lower than one good guess", () => {
    const list = wordMatchScore(prompt, "dog cat horse goose bird fish skateboard bike car");
    assert.ok(list < wordMatchScore(prompt, "dog skateboard"), `a list scored ${list}`);
  });
});
