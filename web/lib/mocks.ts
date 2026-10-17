/*
  MOCK DATA
  Fake data so the frontend can be built before the server exists.
  The types here are also the "data contract": the shapes the server will send.
*/

// A person in the room.
export type Player = { id: string; name: string; score: number };

// A player on the scoreboard: their total plus what they earned in the round that just ended.
export type Standing = Player & { lastRound: number };

// The secret image a player has to describe, and the words they can't say.
// The server picks one per round from the image bank (server/data/targets.json).
export type Target = {
  id: string;
  imageUrl: string;
  bannedWords: string[];
};

// What /submit sends back after a player describes the image.
export type SubmitResult = {
  transcript: string; // what Gemini heard the player say
  imageUrl: string; // what the AI drew from that
  targetImageUrl: string; // the original secret image
  score: number; // 0–100, how close the AI got
  gotRight: string[]; // things the AI drew correctly
  gotWrong: string[]; // things it got wrong
  caption: string; // short roast line
  refused?: boolean; // true if the image generator refused to draw it
};

export const mockRoomCode = "FROG";

export const mockPlayers: Player[] = [
  { id: "1", name: "Sam", score: 0 },
  { id: "2", name: "Jordan", score: 0 },
  { id: "3", name: "Priya", score: 0 },
];

// Scores partway through a game. Deliberately NOT in order, because the
// scoreboard has to sort them itself (the server may send them in any order).
export const mockStandings: Standing[] = [
  { id: "1", name: "Sam", score: 142, lastRound: 42 },
  { id: "2", name: "Gabriel", score: 188, lastRound: 71 },
  { id: "3", name: "Chadrick", score: 97, lastRound: 12 },
  { id: "4", name: "Charisse", score: 163, lastRound: 0 },
  { id: "5", name: "Abigail", score: 120, lastRound: 55 },
];

export const mockTarget: Target = {
  id: "dog-skateboard",
  imageUrl: "https://placehold.co/512x512/png?text=Dog+on+a+skateboard",
  bannedWords: ["dog", "puppy", "skateboard", "wheels"],
};

export const mockResult: SubmitResult = {
  transcript: "a cat... no wait, a fluffy thing on a skateboard",
  imageUrl: "https://placehold.co/512x512?text=AI+drew",
  targetImageUrl: "https://placehold.co/512x512?text=Target",
  score: 42,
  gotRight: ["skateboard"],
  gotWrong: ["it's a dog, not a cat"],
  caption: "Bold of you to call that a cat.",
};