/*
  SHARED TYPES
  The shapes the server and the web app send each other.
  Copied from web/lib/mocks.ts; docs/data-contract.md is the source of truth.
  If you change one, change the other two in the same PR.
*/

// A person in the room.
export type Player = { id: string; name: string; score: number };

// A player on the scoreboard: their total plus what they earned in the round that just ended.
export type Standing = Player & { lastRound: number };

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
  players: (p: { players: Player[] }) => void;
  round_intro: (p: { round: number; totalRounds: number; describer: Player }) => void;
  describing: (p: { describer: Player; endsAt: number }) => void;
  banned_buzz: (p: { playerId: string; word: string }) => void;
  processing: (p: { describer: Player }) => void;
  round_result: (p: { playerName: string; result: SubmitResult }) => void;
  scoreboard: (p: { standings: Standing[] }) => void;
  game_over: (p: { standings: Standing[] }) => void;
  hall_of_shame: (p: { data: HallOfShame }) => void;
  error: (p: { message: string }) => void;
};

export type ClientToServerEvents = {
  create_room: () => void;
  start_game: () => void;
  next: () => void;
  // playerId is optional: send the id from an earlier `joined` to rejoin after a refresh.
  join: (p: { code: string; name: string; playerId?: string }) => void;
};

// What a player handed in: a recording or typed text (exactly one).
export type Description =
  | { kind: "audio"; audio: Buffer; mimeType: string }
  | { kind: "text"; text: string };
