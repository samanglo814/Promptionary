import type { Ai } from "./index.js";
import { wordMatchScore } from "./wordMatch.js";

// A stand-in for Gemini so the whole game can run without an API key.
// - Text (bots and tests only) is used as-is; audio becomes a canned transcript.
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

    async draw(transcript) {
      await wait();
      if (/\bgoose\b/i.test(transcript)) {
        return {
          kind: "final",
          drawing: {
            imageUrl: "",
            score: 0,
            gotRight: [],
            gotWrong: [],
            caption: "Too spicy for the robot. Zero points, infinite respect.",
            refused: true,
          },
        };
      }
      const label = encodeURIComponent(`AI drew: ${transcript.slice(0, 40)}`);
      // The fake "image" is the transcript, so judge() can score it.
      return {
        kind: "drawn",
        imageUrl: `https://placehold.co/512x512/png?text=${label}`,
        image: { data: Buffer.from(transcript), mimeType: "text/plain" },
      };
    },

    async judge({ target, image, guesses }) {
      await wait();
      const guessScores = guesses.map((guess) => wordMatchScore(target.prompt, guess));
      if (!image) return { guessScores };
      const h = hash(image.data.toString() + target.id);
      return {
        judgement: {
          score: h % 101,
          gotRight: ["the general vibe"],
          gotWrong: ["literally everything else"],
          caption: captions[h % captions.length]!,
        },
        guessScores,
      };
    },
  };
}
