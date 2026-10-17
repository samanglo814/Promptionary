"use client";

import { useState } from "react";
import { MAX_GUESS_CHARS } from "@/lib/socket";
import { useSecondsLeft } from "@/lib/useSecondsLeft";

// PLACEHOLDER: the phone screen for everyone who isn't describing.
// One typed guess per turn; faster guesses are worth more. Just enough to play a real game;
// restyle or replace freely (see docs/figma-brief.txt).

type Props = {
  describerName: string;
  guessEndsAt?: number; // when guessing closes (epoch ms)
  locked: { text: string; speed: number } | null; // from "guess_locked"
  sending: boolean; // sent, waiting for the server to lock it in
  error: string;
  onGuess: (text: string) => void;
};

export default function GuessScreen({ describerName, guessEndsAt, locked, sending, error, onGuess }: Props) {
  const secondsLeft = useSecondsLeft(guessEndsAt);
  const [text, setText] = useState("");

  if (locked) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-5 p-6 text-center">
        <p className="text-sm uppercase tracking-widest opacity-60">Locked in</p>
        <p className="text-3xl font-black">“{locked.text}”</p>
        <p className="text-xl font-bold text-cool">Worth {locked.speed}% for speed</p>
        <p className="text-lg opacity-60">Look at the big screen for the reveal</p>
      </main>
    );
  }

  const canSend = text.trim().length > 0 && !sending;
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-5 p-6 text-center">
      <p className="text-sm uppercase tracking-widest opacity-60">{describerName} is describing</p>
      <h1 className="text-3xl font-black">What&apos;s in the picture?</h1>
      {secondsLeft !== null && <p className="text-6xl font-black text-pop">{secondsLeft}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault(); // stop the browser from reloading the page
          if (canSend) onGuess(text.trim());
        }}
        className="w-full max-w-sm flex flex-col gap-3"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_GUESS_CHARS}
          autoComplete="off"
          placeholder="A dog on a skateboard"
          className="text-2xl font-bold text-center border-2 border-ink/10 rounded-card py-3 outline-none focus:border-pop"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="bg-pop text-white text-2xl font-bold py-4 rounded-card disabled:opacity-40"
        >
          {sending ? "Locking in…" : "Lock it in"}
        </button>
        <p className="text-sm opacity-60">One guess only. The sooner you lock in, the more it&apos;s worth.</p>
        {error && <p className="text-pop font-bold">{error}</p>}
      </form>
    </main>
  );
}
