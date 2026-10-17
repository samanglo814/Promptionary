/*
  MOCK DATA
  Fake data so the frontend can be built before the server exists.
  The types here are also the "data contract": the shapes the server will send.
*/

// A person in the room.
export type Player = { id: string; name: string; score: number };

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