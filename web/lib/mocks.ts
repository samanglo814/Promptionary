/*
  MOCK DATA
*/

export type Player = { id: string; name: string; score: number };

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

export const mockRoomCode = "FROG";

export const mockPlayers: Player[] = [
  { id: "1", name: "Sam", score: 0 },
  { id: "2", name: "Jordan", score: 0 },
  { id: "3", name: "Priya", score: 0 },
];

export const mockResult: SubmitResult = {
  transcript: "a cat... no wait, a fluffy thing on a skateboard",
  imageUrl: "https://placehold.co/512x512?text=AI+drew",
  targetImageUrl: "https://placehold.co/512x512?text=Target",
  score: 42,
  gotRight: ["skateboard"],
  gotWrong: ["it's a dog, not a cat"],
  caption: "Bold of you to call that a cat.",
};