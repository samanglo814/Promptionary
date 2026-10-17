// Checks that every payload matches docs/data-contract.md exactly: right keys, right types,
// no extras (so a stray snake_case field like `got_right` fails loudly).

type Shape = Record<string, (v: unknown) => boolean>;

const str = (v: unknown) => typeof v === "string";
const int = (v: unknown) => Number.isInteger(v);
const bool = (v: unknown) => typeof v === "boolean";
const strings = (v: unknown) => Array.isArray(v) && v.every(str);
const optional = (check: (v: unknown) => boolean) => (v: unknown) => v === undefined || check(v);
const listOf = (shape: Shape) => (v: unknown) => Array.isArray(v) && v.every((item) => matches(item, shape));
const obj = (shape: Shape) => (v: unknown) => matches(v, shape);
const percent = (v: unknown) => int(v) && (v as number) >= 0 && (v as number) <= 100;

function matches(value: unknown, shape: Shape): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const extra = Object.keys(value).filter((k) => !(k in shape));
  if (extra.length) return false;
  return Object.entries(shape).every(([key, check]) => check((value as Record<string, unknown>)[key]));
}

const player: Shape = { id: str, name: str, score: int };
const standing: Shape = { ...player, lastRound: int };
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
const hallOfShame: Shape = {
  stats: obj({ roundsPlayed: int, avgScore: int, bannedBuzzes: int, refusals: int }),
  worstMisses: listOf({ playerName: str, transcript: str, imageUrl: str, score: int }),
  worstWords: listOf({ word: str, avgScore: int }),
};

// Payload shape for every server → client event.
export const eventShapes: Record<string, Shape> = {
  room_created: { code: (v) => str(v) && /^[A-Z]{4}$/.test(v as string) },
  joined: { player: obj(player), code: str },
  join_error: {
    reason: (v) => ["room_not_found", "name_taken", "game_started", "room_full", "invalid_name"].includes(v as string),
  },
  your_turn: { target: obj(target), endsAt: int },
  players: { players: listOf(player) },
  round_intro: { round: int, totalRounds: int, describer: obj(player) },
  describing: { describer: obj(player), endsAt: int },
  banned_buzz: { playerId: str, word: str },
  processing: { describer: obj(player) },
  round_result: { playerName: str, result: obj(submitResult) },
  scoreboard: { standings: listOf(standing) },
  game_over: { standings: listOf(standing) },
  hall_of_shame: { data: obj(hallOfShame) },
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
