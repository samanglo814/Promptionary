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

// The whole AI pipeline, split at the point where the server checks banned words.
// The fake version (fake.ts) is used until the Gemini version exists.
export type Ai = {
  transcribe: (description: Description) => Promise<string>;
  draw: (transcript: string, target: Target) => Promise<Drawing>;
};
