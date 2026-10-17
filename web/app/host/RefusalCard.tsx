// No "use client" needed: no state or browser APIs.
// (It still runs in the browser because the host page is a client component.)

import { type CSSProperties } from "react";

// Shown in place of the AI's image when the image generator refused to draw it
// (safety filters). "The AI refused to draw that" is funny, so we lean into it
// instead of showing an error.

// A few lines to pick from so it doesn't feel repetitive across rounds.
const LINES = [
  "The AI took one look and said no.",
  "Our robot has standards, apparently.",
  "Even the AI didn't want to see that.",
  "Request denied. The AI needs a minute.",
  "That one's going in the AI's diary.",
];

type Props = {
  // Used to pick a line. The same transcript always gets the same line, so the
  // card doesn't change if the screen re-draws. (Math.random() here would pick
  // a new line on every re-draw.)
  transcript: string;
  // Size classes from the parent, so the card matches the image it replaces.
  className?: string;
  // Lets the parent pass in its animation (the reveal's wipe).
  style?: CSSProperties;
};

export default function RefusalCard({ transcript, className = "", style }: Props) {
  // % = remainder after dividing, which always lands between 0 and LINES.length - 1.
  const line = LINES[transcript.length % LINES.length];

  return (
    <div
      className={`bg-ink text-paper rounded-card shadow-lg flex flex-col items-center justify-center gap-4 p-6 text-center ${className}`}
      style={style}
    >
      <span className="text-7xl">🙅</span>

      {/* The stamp. -rotate-6 tilts it like a rubber stamp. It slams in at 2.1s,
          right as the reveal's wipe finishes uncovering the card.
          It's nested inside a wrapper that does the `pop` animation, because
          `pop` uses transform too, and an element can only have one transform at a
          time: the animation would wipe out the tilt. */}
      <div style={{ animation: "pop 0.3s ease-out 2.1s both" }}>
        <p className="-rotate-6 border-4 border-pop text-pop text-4xl font-black tracking-widest px-4 py-1 rounded-xl">
          REFUSED
        </p>
      </div>

      <p className="text-lg opacity-80">{line}</p>
    </div>
  );
}