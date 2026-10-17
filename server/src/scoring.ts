import type { GameConfig } from "./config.js";
import type { PrompterBreakdown, Standing } from "./types.js";

/*
  POINTS
  Pure math, no game state, so every rule here is unit-tested (test/scoring.test.ts).
  The rules and their numbers are explained in config.ts.
*/

type ScoringConfig = Pick<
  GameConfig,
  | "accuracyPoints"
  | "clarityPoints"
  | "speedPoints"
  | "speedMinScore"
  | "bannedWordPenalty"
  | "guessMs"
  | "guessSpeedWeight"
  | "spectatorShare"
  | "maxGuessPoints"
>;

export type TurnInput = {
  score: number; // the AI's match score, 0–100
  guessAccuracies: number[]; // 0–100, one per guess (empty if nobody guessed)
  timeLeft: number; // share of describing time left when the describer sent it, 0–1
  bannedWords: number; // how many different banned words they said
  multiplier: number;
};

// The describer's points for one turn, line by line, so the reveal can show how the total adds up.
// Each line is before the multiplier; total = (lines added up, never below 0) × multiplier.
export function prompterPoints(config: ScoringConfig, turn: TurnInput): PrompterBreakdown {
  const { score, guessAccuracies } = turn;
  const clarityPercent = guessAccuracies.length
    ? guessAccuracies.reduce((sum, a) => sum + a, 0) / guessAccuracies.length
    : score; // nobody guessed: don't punish the describer for a quiet room

  const accuracy = Math.round((config.accuracyPoints * score) / 100);
  const clarity = Math.round((config.clarityPoints * clarityPercent) / 100);
  // Only a decent description earns the speed bonus, so mumbling two words and sending doesn't pay.
  const speed = score >= config.speedMinScore ? Math.round(config.speedPoints * clamp(turn.timeLeft)) : 0;
  const bannedPenalty = config.bannedWordPenalty * turn.bannedWords;
  const total = Math.round(Math.max(0, accuracy + clarity + speed - bannedPenalty) * turn.multiplier);
  return { accuracy, clarity, speed, bannedPenalty, multiplier: turn.multiplier, total };
}

// A turn where nothing was described (the describer ran out of time).
export function noPoints(multiplier: number): PrompterBreakdown {
  return { accuracy: 0, clarity: 0, speed: 0, bannedPenalty: 0, multiplier, total: 0 };
}

// The most one guess can earn this round, multiplier included, rounded to a multiple of 5.
// Guessing's share of the game stays the same in any room size: one round of guessing is worth
// up to spectatorShare / (1 − spectatorShare) of one perfect turn of describing, split across the
// playerCount − 1 guesses a player makes per round. Capped at maxGuessPoints.
export function maxGuessPoints(config: ScoringConfig, playerCount: number, multiplier: number): number {
  const perfectTurn = config.accuracyPoints + config.clarityPoints + config.speedPoints;
  const perRound = (perfectTurn * config.spectatorShare) / (1 - config.spectatorShare);
  const perGuess = Math.min(config.maxGuessPoints, perRound / Math.max(1, playerCount - 1));
  return Math.round((perGuess * multiplier) / 5) * 5;
}

// How much of a guess's value is left, as a whole percent: 100 for an instant guess,
// down to 100 − guessSpeedWeight × 100 at the end of the guess window.
export function speedPercent(config: ScoringConfig, msSinceStart: number): number {
  return Math.round(100 * (1 - config.guessSpeedWeight * clamp(msSinceStart / config.guessMs)));
}

// Points for one guess. Uses the same whole percents the reveal shows, so the math on screen adds up.
export function guessPoints(maxPoints: number, accuracy: number, speed: number): number {
  return Math.round((maxPoints * accuracy * speed) / 10_000);
}

type Totals = Omit<Standing, "rank">;

// Highest score first. Ties go to whoever scored more in the final round, then to the better guesser.
// Players tied on all three share a rank (1, 1, 3).
export function rankStandings(players: Totals[]): Standing[] {
  const compare = (a: Totals, b: Totals) =>
    b.score - a.score || b.finalRoundPoints - a.finalRoundPoints || b.spectatorPoints - a.spectatorPoints;
  const sorted = [...players].sort(compare);
  return sorted.map((p, i) => {
    let rank = i + 1;
    while (rank > 1 && compare(sorted[rank - 2]!, p) === 0) rank--;
    return { ...p, rank };
  });
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
