import type { Description, Target } from "../types.js";

// What the AI produces for one round, before the server adds the transcript and target.
export type Drawing = {
  imageUrl: string; // "" when refused
  score: number; // 0–100
  gotRight: string[];
  gotWrong: string[];
  caption: string;
  refused?: boolean;
};

// What the AI needs to score guesses: the secret image's description from data/targets.json.
export type GuessTarget = { id: string; prompt: string };

// The whole AI pipeline, split at the point where the server checks banned words.
// The fake version (fake.ts) runs without an API key; gemini.ts is the real one.
export type Ai = {
  transcribe: (description: Description) => Promise<string>;
  draw: (transcript: string, target: Target) => Promise<Drawing>;
  // How close each typed guess is to the secret image, 0–100, in the same order as `guesses`.
  scoreGuesses: (target: GuessTarget, guesses: string[]) => Promise<number[]>;
};
