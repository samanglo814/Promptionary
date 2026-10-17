/*
  GAME RULES
  Every number you might want to tweak while playtesting lives here.
  Change a value, restart the server, play again.
*/

export type GameConfig = {
  // How long each phase lasts (ms). Phases with a timer can also be skipped by the host's "next".
  introMs: number;
  describeMs: number;
  // Extra time after describeMs for an upload that started before the buzzer to still count.
  submitGraceMs: number;
  // If the AI fails, the describer gets at least this long to try again.
  retryMs: number;
  // A describer who disconnects (e.g. their phone refreshed) has this long to rejoin before their turn is skipped.
  reconnectGraceMs: number;
  revealMs: number;
  scoreboardMs: number;
  gameOverMs: number; // podium, then the Hall of Shame

  minPlayers: number;
  maxPlayers: number;
  // Turns per player. 1 means everyone describes once, in join order.
  roundsPerPlayer: number;

  // Points for a round = match score (0–100) minus this per banned word said, never below 0.
  // Only the describer earns points.
  bannedWordPenalty: number;

  maxNameLength: number;
  maxTextLength: number;
  maxAudioBytes: number;

  // Pretend thinking time for the fake AI, so the "processing" screen is visible.
  fakeAiDelayMs: number;
};

export const defaultConfig: GameConfig = {
  introMs: 3_000,
  describeMs: 20_000,
  submitGraceMs: 3_000,
  retryMs: 10_000,
  reconnectGraceMs: 5_000,
  revealMs: 8_000,
  scoreboardMs: 6_000,
  gameOverMs: 10_000,

  minPlayers: 2,
  maxPlayers: 8,
  roundsPerPlayer: 1,

  bannedWordPenalty: 10,

  maxNameLength: 16,
  maxTextLength: 200,
  maxAudioBytes: 5 * 1024 * 1024,

  fakeAiDelayMs: 1_500,
};
