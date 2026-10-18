// Checks that every payload matches docs/data-contract.md exactly: right keys, right types,
// no extras (so a stray snake_case field like `got_right` fails loudly).

type Shape = Record<string, (v: unknown) => boolean>;

const str = (v: unknown) => typeof v === "string";
const int = (v: unknown) => Number.isInteger(v);
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const bool = (v: unknown) => typeof v === "boolean";
const strings = (v: unknown) => Array.isArray(v) && v.every(str);
const optional = (check: (v: unknown) => boolean) => (v: unknown) => v === undefined || check(v);
const listOf = (shape: Shape) => (v: unknown) => Array.isArray(v) && v.every((item) => matches(item, shape));
const obj = (shape: Shape) => (v: unknown) => matches(v, shape);
const percent = (v: unknown) => int(v) && (v as number) >= 0 && (v as number) <= 100;
const nonNegative = (v: unknown) => int(v) && (v as number) >= 0;
const nullable = (check: (v: unknown) => boolean) => (v: unknown) => v === null || check(v);

function matches(value: unknown, shape: Shape): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const extra = Object.keys(value).filter((k) => !(k in shape));
  if (extra.length) return false;
  return Object.entries(shape).every(([key, check]) => check((value as Record<string, unknown>)[key]));
}

const player: Shape = { id: str, name: str, score: int };
const standing: Shape = {
  ...player,
  lastTurn: nonNegative,
  prompterPoints: nonNegative,
  spectatorPoints: nonNegative,
  finalRoundPoints: nonNegative,
  rank: (v) => int(v) && (v as number) >= 1,
};
const target: Shape = { id: str, imageUrl: str, bannedWords: strings };
export const submitResult: Shape = {
  transcript: str,
  imageUrl: str,
  targetImageUrl: str,
  score: percent,
  gotRight: strings,
  gotWrong: strings,
  caption: str,
  refused: optional(bool),
};
export const breakdown: Shape = {
  accuracy: nonNegative,
  clarity: nonNegative,
  speed: nonNegative,
  bannedPenalty: nonNegative,
  multiplier: (v) => num(v) && (v as number) > 0,
  total: nonNegative,
};
export const guessResult: Shape = {
  playerId: str,
  playerName: str,
  text: str,
  accuracy: percent,
  speed: percent,
  points: nonNegative,
};
const award: Shape = { title: str, playerName: str, imageUrl: str };
const hallOfShame: Shape = {
  stats: obj({ roundsPlayed: int, avgScore: int, bannedBuzzes: int, refusals: int }),
  worstMisses: listOf({ playerName: str, transcript: str, imageUrl: str, score: int }),
  worstWords: listOf({ word: str, avgScore: int }),
};
const storyPage: Shape = {
  round: int,
  playerName: str,
  targetImageUrl: str,
  imageUrl: str,
  transcript: str,
  score: percent,
  caption: str,
  narration: (v) => str(v) && (v as string).length > 0,
  bestGuess: nullable(obj({ playerName: str, text: str })),
  refused: optional(bool),
};
export const storybook: Shape = {
  id: str,
  title: (v) => str(v) && (v as string).length > 0,
  createdAt: int,
  winner: nullable(str),
  pages: listOf(storyPage),
};

// Payload shape for every server → client event.
export const eventShapes: Record<string, Shape> = {
  room_created: { code: (v) => str(v) && /^[A-Z]{4}$/.test(v as string) },
  joined: { player: obj(player), code: str },
  join_error: {
    reason: (v) => ["room_not_found", "name_taken", "game_started", "room_full", "invalid_name"].includes(v as string),
  },
  your_turn: { target: obj(target), endsAt: int },
  guess_locked: { text: str, speed: percent },
  guess_error: { reason: (v) => ["not_now", "describer", "already_guessed", "invalid_guess"].includes(v as string) },
  players: { players: listOf(player) },
  round_start: { round: int, totalRounds: int, multiplier: num, leader: nullable(obj(player)), gap: nonNegative },
  turn_intro: { round: int, totalRounds: int, turn: int, turnsInRound: int, multiplier: num, describer: obj(player) },
  describing: { describer: obj(player), endsAt: int, guessEndsAt: int, guessClockStarted: bool },
  guess_clock: { guessEndsAt: int },
  guesses_locked: { playerIds: strings, open: bool },
  banned_buzz: { playerId: str, word: str },
  processing: { describer: obj(player) },
  round_result: { playerName: str, result: obj(submitResult), breakdown: obj(breakdown), guesses: listOf(guessResult) },
  scoreboard: { standings: listOf(standing) },
  game_over: { standings: listOf(standing), awards: listOf(award) },
  hall_of_shame: { data: obj(hallOfShame) },
  storybook: { story: obj(storybook) },
  error: { message: str },
};

// Returns a problem description, or null if the payload is fine.
export function checkEvent(event: string, payload: unknown): string | null {
  const shape = eventShapes[event];
  if (!shape) return `unknown event "${event}"`;
  return matches(payload, shape) ? null : `bad "${event}" payload: ${JSON.stringify(payload)}`;
}

export function checkSubmitResult(payload: unknown): string | null {
  return matches(payload, submitResult) ? null : `bad /submit response: ${JSON.stringify(payload)}`;
}
