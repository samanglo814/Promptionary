/*
  SHARED TYPES
  The shapes the server and the web app send each other.
  Copied from web/lib/mocks.ts; docs/data-contract.md is the source of truth.
  If you change one, change the other two in the same PR.
*/

// A person in the room.
export type Player = { id: string; name: string; score: number };

// A player on the scoreboard. Standings are sent sorted, best first, with ties already broken.
export type Standing = Player & {
  lastTurn: number; // points earned in the turn that just ended (describing or guessing)
  prompterPoints: number; // all points from describing
  spectatorPoints: number; // all points from guessing
  finalRoundPoints: number; // points earned in the last round (the first tiebreak)
  rank: number; // 1 = first; players tied on score and both tiebreaks share a rank
};

// The secret image a player has to describe, and the words they can't say.
export type Target = {
  id: string;
  imageUrl: string;
  bannedWords: string[];
};

// What /submit sends back after a player describes the image.
export type SubmitResult = {
  transcript: string;
  imageUrl: string;
  targetImageUrl: string;
  score: number;
  gotRight: string[];
  gotWrong: string[];
  caption: string;
  refused?: boolean;
};

// How the describer's points for one turn add up. Each line is before the multiplier;
// total = (accuracy + clarity + speed − bannedPenalty, never below 0) × multiplier.
export type PrompterBreakdown = {
  accuracy: number;
  clarity: number;
  speed: number;
  bannedPenalty: number;
  multiplier: number;
  total: number;
};

// One guess, scored. points = max for this turn × accuracy × speed.
export type GuessResult = {
  playerId: string;
  playerName: string;
  text: string;
  accuracy: number; // 0–100, how close the guess is to the secret image
  speed: number; // 70–100, how much of its value the guess kept by being early
  points: number;
};

// An end-of-game award. imageUrl is "" for awards without a picture.
export type Award = { title: string; playerName: string; imageUrl: string };

// The night's worst moments, for the Hall of Shame screen.
export type HallOfShame = {
  stats: {
    roundsPlayed: number;
    avgScore: number;
    bannedBuzzes: number;
    refusals: number;
  };
  worstMisses: {
    playerName: string;
    transcript: string;
    imageUrl: string;
    score: number;
  }[];
  worstWords: { word: string; avgScore: number }[];
};

export type GuessErrorReason =
  | "not_now" // no guessing open (between turns, or the window closed)
  | "describer" // the describer can't guess their own image
  | "already_guessed" // one guess per turn
  | "invalid_guess"; // blank or too long

export type JoinErrorReason =
  | "room_not_found"
  | "name_taken"
  | "game_started"
  | "room_full"
  | "invalid_name";

// Socket events, typed so the compiler checks every emit against the contract.
export type ServerToClientEvents = {
  room_created: (p: { code: string }) => void;
  joined: (p: { player: Player; code: string }) => void;
  join_error: (p: { reason: JoinErrorReason }) => void;
  your_turn: (p: { target: Target; endsAt: number }) => void;
  guess_locked: (p: { text: string; speed: number }) => void;
  guess_error: (p: { reason: GuessErrorReason }) => void;
  players: (p: { players: Player[] }) => void;
  round_start: (p: {
    round: number;
    totalRounds: number;
    multiplier: number;
    leader: Player | null; // null when nobody leads (round 1, or a tie for first)
    gap: number; // leader's lead over second place
  }) => void;
  turn_intro: (p: {
    round: number;
    totalRounds: number;
    turn: number;
    turnsInRound: number;
    multiplier: number;
    describer: Player;
  }) => void;
  describing: (p: { describer: Player; endsAt: number; guessEndsAt: number }) => void;
  guesses_locked: (p: { playerIds: string[]; open: boolean }) => void;
  banned_buzz: (p: { playerId: string; word: string }) => void;
  processing: (p: { describer: Player }) => void;
  round_result: (p: {
    playerName: string;
    result: SubmitResult;
    breakdown: PrompterBreakdown;
    guesses: GuessResult[];
  }) => void;
  scoreboard: (p: { standings: Standing[] }) => void;
  game_over: (p: { standings: Standing[]; awards: Award[] }) => void;
  hall_of_shame: (p: { data: HallOfShame }) => void;
  error: (p: { message: string }) => void;
};

export type ClientToServerEvents = {
  create_room: () => void;
  // ack answers with why it didn't start (null = started). Older pages may not send one.
  start_game: (ack?: (p: { error: string | null }) => void) => void;
  next: () => void;
  // playerId is optional: send the id from an earlier `joined` to rejoin after a refresh.
  join: (p: { code: string; name: string; playerId?: string }) => void;
  // Everyone but the describer: one guess per turn.
  guess: (p: { text: string }) => void;
};

// What a player handed in: a recording or typed text (exactly one).
export type Description =
  | { kind: "audio"; audio: Buffer; mimeType: string }
  | { kind: "text"; text: string };
