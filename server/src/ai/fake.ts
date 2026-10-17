import type { Ai } from "./index.js";
import { wordMatchScore } from "./wordMatch.js";

// A stand-in for Gemini so the whole game can run without an API key.
// - Typed text is used as-is; audio becomes a canned transcript.
// - The score is a stable hash of the transcript, so the same words always score the same.
// - Mentioning "goose" makes the AI "refuse", to test the refusal card.
// - Guesses score by the words they share with the target's description.

const captions = [
  "Bold of you to call that a description.",
  "The AI tried. You tried. Nobody won.",
  "Picasso would be proud. Confused, but proud.",
  "Close enough for government work.",
  "That's... technically a drawing.",
];

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function createFakeAi(delayMs: number): Ai {
  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));

  return {
    async transcribe(description) {
      await wait();
      return description.kind === "text"
        ? description.text
        : "a fluffy thing... on wheels? kind of like a small horse";
    },

    async draw(transcript, target) {
      await wait();
      if (/\bgoose\b/i.test(transcript)) {
        return {
          imageUrl: "",
          score: 0,
          gotRight: [],
          gotWrong: [],
          caption: "Too spicy for the robot. Zero points, infinite respect.",
          refused: true,
        };
      }
      const h = hash(transcript + target.id);
      const label = encodeURIComponent(`AI drew: ${transcript.slice(0, 40)}`);
      return {
        imageUrl: `https://placehold.co/512x512/png?text=${label}`,
        score: h % 101,
        gotRight: ["the general vibe"],
        gotWrong: ["literally everything else"],
        caption: captions[h % captions.length]!,
      };
    },

    async scoreGuesses(target, guesses) {
      await wait();
      return guesses.map((guess) => wordMatchScore(target.prompt, guess));
    },
  };
}
