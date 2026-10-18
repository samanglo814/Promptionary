import type { HallOfShame } from "../types.js";

// One finished round, kept in memory for the Hall of Shame.
// There is no database: a room keeps its rounds for as long as it exists.
export type RoundRecord = {
  playerName: string;
  transcript: string;
  imageUrl: string;
  score: number;
  bannedHits: number;
  refused: boolean;
};

// Too common to blame for a bad score. (Words under 4 letters are skipped anyway.)
const boring = new Set([
  "that", "this", "there", "they", "with", "like", "it's", "have", "from",
  "what", "just", "then", "some", "kind", "sort", "thing", "about",
]);

export function buildHallOfShame(rounds: RoundRecord[]): HallOfShame {
  const roundsPlayed = rounds.length;
  const avgScore = roundsPlayed
    ? Math.round(rounds.reduce((sum, r) => sum + r.score, 0) / roundsPlayed)
    : 0;

  const worstMisses = [...rounds]
    .filter((r) => r.transcript)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(({ playerName, transcript, imageUrl, score }) => ({ playerName, transcript, imageUrl, score }));

  // Average the score of every round each word appeared in, worst first.
  const byWord = new Map<string, number[]>();
  for (const r of rounds) {
    const unique = new Set(r.transcript.toLowerCase().match(/[a-z']+/g) ?? []);
    for (const word of unique) {
      if (word.length < 4 || boring.has(word)) continue;
      byWord.set(word, [...(byWord.get(word) ?? []), r.score]);
    }
  }
  const worstWords = [...byWord]
    .map(([word, scores]) => ({
      word,
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }))
    .sort((a, b) => a.avgScore - b.avgScore)
    .slice(0, 5);

  return {
    stats: {
      roundsPlayed,
      avgScore,
      bannedBuzzes: rounds.reduce((sum, r) => sum + r.bannedHits, 0),
      refusals: rounds.filter((r) => r.refused).length,
    },
    worstMisses,
    worstWords,
  };
}
