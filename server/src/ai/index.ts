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

// How a drawing compares to the secret image.
export type Judgement = Omit<Drawing, "imageUrl" | "refused">;

// What draw() hands back. A drawn image still needs judging (in the same AI call as the guesses);
// silence and refusals are already final.
export type Sketch =
  | { kind: "drawn"; imageUrl: string; image: { data: Buffer; mimeType: string } }
  | { kind: "final"; drawing: Drawing };

// What the AI needs to judge a turn: the secret image and its description from data/targets.json.
export type JudgeTarget = { id: string; prompt: string; imageUrl: string };

// The whole AI pipeline, split at the point where the server checks banned words.
// The fake version (fake.ts) runs without an API key; gemini.ts is the real one.
export type Ai = {
  transcribe: (description: Description) => Promise<string>;
  draw: (transcript: string, target: Target) => Promise<Sketch>;
  // One call for the whole turn: how well the drawn image matches (when there is one), and how close
  // each typed guess is (0–100, in the same order as `guesses`). Halves the AI calls per turn.
  judge: (turn: {
    target: JudgeTarget;
    transcript: string;
    image?: { data: Buffer; mimeType: string };
    guesses: string[];
  }) => Promise<{ judgement?: Judgement; guessScores: number[] }>;
};

// The AI is out of requests for now (e.g. the free tier's daily limit). Not worth retrying:
// the server falls back to word matching, and asks voice describers to type instead.
export class AiOutOfQuotaError extends Error {
  constructor(
    readonly model: string,
    readonly until: number, // epoch ms when requests should work again
  ) {
    super(`${model} is out of requests until ${new Date(until).toLocaleTimeString()}`);
  }
}
