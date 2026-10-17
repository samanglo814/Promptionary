/*
  GAME RULES
  Every number you might want to tweak while playtesting lives here.
  Change a value, restart the server, play again.
*/

export type GameConfig = {
  // How long each phase lasts (ms). Phases with a timer can also be skipped by the host's "next".
  roundIntroMs: number; // "Round 2: points x1.5" between rounds
  introMs: number; // "Next up: Sam" before each turn
  describeMs: number;
  // Extra time after describeMs for an upload that started before the buzzer to still count.
  submitGraceMs: number;
  // If the AI fails, the describer gets at least this long to try again.
  retryMs: number;
  // A describer who disconnects (e.g. their phone refreshed) has this long to rejoin before their turn is skipped.
  reconnectGraceMs: number;
  // Playing again keeps players who disconnected less than this long ago (a locked phone), so they can rejoin.
  dropPlayerAfterMs: number;
  // A host page whose connection drops (not closed on purpose) has this long to reconnect before the room closes.
  hostGraceMs: number;
  revealMs: number;
  scoreboardMs: number;
  gameOverMs: number; // podium, then the Hall of Shame

  minPlayers: number;
  maxPlayers: number;

  // ROUNDS: everyone describes once per round. Round 1 goes in join order; later rounds go
  // lowest score first, so the leader describes last.
  // Every point earned in a round (describing and guessing) is multiplied by its multiplier.
  roundMultipliers: number[]; // one per round, e.g. [1, 1.5] = 2 rounds

  // DESCRIBER points for one turn, before the multiplier:
  //   accuracy = accuracyPoints × match score (0–100%)
  //   clarity  = clarityPoints × the guessers' average accuracy (match score if nobody guessed)
  //   speed    = speedPoints × share of describing time left, only if the match score is at least speedMinScore
  //   minus bannedWordPenalty per banned word said. Never below 0.
  accuracyPoints: number;
  clarityPoints: number;
  speedPoints: number;
  speedMinScore: number;
  bannedWordPenalty: number;

  // GUESSER points: everyone else types one guess per turn, until guessMs after describing starts
  // (or until everyone has guessed). A guess is worth: max × accuracy × speed, where speed drops
  // from 100% (instant) to (100% − guessSpeedWeight) at the end of the window.
  guessMs: number;
  guessSpeedWeight: number;
  // Guessing's share of a perfect game (the rest is describing). The max per guess shrinks
  // as the room grows, since bigger rooms mean more guesses per round.
  spectatorShare: number;
  // ...but one guess is never worth more than this (before the multiplier), so in a 2-player
  // game a single guess can't count almost as much as describing.
  maxGuessPoints: number;
  maxGuessLength: number;

  maxNameLength: number;
  maxTextLength: number;
  maxAudioBytes: number;

  // Pretend thinking time for the fake AI, so the "processing" screen is visible.
  fakeAiDelayMs: number;
};

export const defaultConfig: GameConfig = {
  roundIntroMs: 4_000,
  introMs: 3_000,
  describeMs: 20_000,
  submitGraceMs: 3_000,
  retryMs: 10_000,
  reconnectGraceMs: 5_000,
  dropPlayerAfterMs: 2 * 60_000,
  hostGraceMs: 2 * 60_000,
  revealMs: 8_000,
  scoreboardMs: 6_000,
  gameOverMs: 10_000,

  minPlayers: 2,
  maxPlayers: 8,

  roundMultipliers: [1, 1.5],

  accuracyPoints: 700,
  clarityPoints: 200,
  speedPoints: 100,
  speedMinScore: 40,
  bannedWordPenalty: 100,

  guessMs: 25_000,
  guessSpeedWeight: 0.3,
  spectatorShare: 0.4,
  maxGuessPoints: 400,
  maxGuessLength: 60,

  maxNameLength: 16,
  maxTextLength: 500,
  maxAudioBytes: 5 * 1024 * 1024,

  fakeAiDelayMs: 1_500,
};
