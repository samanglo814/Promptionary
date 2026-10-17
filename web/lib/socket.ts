// The live connection to the game server (Socket.io).
// Event names and payloads are in docs/data-contract.md, section 3.
//
// When NEXT_PUBLIC_SERVER_URL isn't set, SERVER_URL is undefined and the pages
// fall back to mock data, so the frontend still works on its own.

import { io, type Socket } from "socket.io-client";
import type { HallOfShame, Player, Standing, SubmitResult, Target } from "./mocks";

export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;

// Messages the server sends us.
type ServerEvents = {
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

// Messages we send the server.
type ClientEvents = {
  create_room: () => void;
  start_game: () => void;
  next: () => void;
  join: (p: { code: string; name: string; playerId?: string }) => void;
};

export type JoinErrorReason =
  | "room_not_found"
  | "name_taken"
  | "game_started"
  | "room_full"
  | "invalid_name";

export type GameSocket = Socket<ServerEvents, ClientEvents>;

// Opens a new connection. Each page opens one when it loads and closes it when it goes away.
export function connect(): GameSocket {
  return io(SERVER_URL!);
}

// What to show when joining fails.
export const joinErrorText: Record<JoinErrorReason, string> = {
  room_not_found: "No room with that code. Check the big screen!",
  name_taken: "Someone already has that name. Try another!",
  game_started: "That game already started. Wait for the next one!",
  room_full: "That room is full.",
  invalid_name: "Names can be 1 to 16 characters.",
};
