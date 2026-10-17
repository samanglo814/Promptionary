"use client";

// The phone screen for everyone who isn't describing.
// One typed guess per turn, locked in once. Faster guesses keep more of their value
// (100% at the start, down to 70% when guessing closes). Matches the Figma's
// "Spectator guess entry" and "Spectator locked" frames.

import { useState } from "react";
import { MAX_GUESS_CHARS } from "@/lib/socket";
import { useMsLeft } from "@/lib/useSecondsLeft";
import { Button, Label, Meter, Panel, TextButton } from "@/components/ui";

// The guess window (server config guessMs) and how much speed is worth (guessSpeedWeight).
const GUESS_MS = 25_000;
const SPEED_WEIGHT = 0.3;

type Props = {
  myName: string;
  describerName: string;
  guessEndsAt?: number; // when guessing closes (epoch ms)
  locked: { text: string; speed: number } | null; // from "guess_locked"
  sending: boolean; // sent, waiting for the server to lock it in
  error: string;
  onGuess: (text: string) => void;
};

export default function GuessScreen({ myName, describerName, guessEndsAt, locked, sending, error, onGuess }: Props) {
  const msLeft = useMsLeft(guessEndsAt);
  const [text, setText] = useState("");
  // One try only, so locking takes two taps: the first asks "sure?".
  const [confirming, setConfirming] = useState(false);

  if (locked) {
    return (
      <>
        <Label tone="human">{myName} · Guesser</Label>
        <h1 className="font-display text-[40px] leading-[1.04]">Locked in.</h1>
        <Panel tone="human" className="flex flex-col gap-3">
          <Label tone="human">Your guess · final</Label>
          <p className="text-[22px] leading-snug">“{locked.text}”</p>
        </Panel>
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] text-muted">Speed kept</span>
          <span className="font-display text-[42px] leading-none text-point">{locked.speed}%</span>
        </div>
        <Meter value={(locked.speed - 70) / 30} />
        <p className="text-sm leading-relaxed text-muted">
          Your points = how close your guess is × {locked.speed}%. Everyone finds out together on the big screen.
        </p>
      </>
    );
  }

  // What a guess is worth right now, from 100% (just started) to 70% (closing).
  const share = msLeft === null ? 1 : msLeft / GUESS_MS;
  const speedNow = Math.round(100 - SPEED_WEIGHT * 100 * (1 - Math.min(1, share)));
  const secondsLeft = msLeft === null ? null : Math.ceil(msLeft / 1000);
  const guess = text.trim();
  const canSend = guess.length > 0 && !sending;

  return (
    <>
      <Label tone="human">{myName} · Guesser</Label>
      <h1 className="font-display text-[40px] leading-[1.04]">What&apos;s the secret?</h1>
      <div className="flex items-center justify-between">
        <p className="text-[15px] text-muted">{describerName} is describing.</p>
        {secondsLeft !== null && (
          <span className={`font-display text-[42px] leading-none tabular-nums ${secondsLeft <= 5 ? "text-ai" : "text-point"}`}>
            {secondsLeft}s
          </span>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault(); // stop the browser from reloading the page
          if (!canSend) return;
          if (!confirming) return setConfirming(true);
          onGuess(guess);
        }}
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-3 rounded-panel border-[1.5px] border-human bg-panel p-[18px] focus-within:border-point">
          <Label tone="human">Your guess · {confirming ? "final?" : "editable"}</Label>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value.replace(/\n/g, ""));
              setConfirming(false); // changed it: ask again
            }}
            onKeyDown={(e) => {
              // Enter sends instead of adding a new line.
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={MAX_GUESS_CHARS}
            rows={2}
            autoFocus
            autoComplete="off"
            placeholder="A dog on a skateboard"
            className="resize-none bg-transparent text-[22px] leading-snug text-text outline-none placeholder:text-dim"
          />
          <span className="self-end text-xs text-muted">
            {text.length} / {MAX_GUESS_CHARS}
          </span>
        </label>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-xs">
            <span className="font-bold text-muted">Worth if you lock it now</span>
            <span className="font-extrabold text-point">{speedNow}%</span>
          </div>
          <Meter value={(speedNow - 70) / 30} />
        </div>
        <p className="text-sm leading-relaxed text-muted">Accuracy × speed. Being fast only helps if your guess is close.</p>

        <Button type="submit" disabled={!canSend} variant={confirming ? "confirm" : "primary"}>
          {sending ? "Locking in…" : confirming ? `Lock in “${guess.length > 22 ? guess.slice(0, 22) + "…" : guess}”` : "Lock my one guess"}
        </Button>
        {confirming && !sending ? (
          <TextButton type="button" onClick={() => setConfirming(false)}>
            Keep editing
          </TextButton>
        ) : (
          <p className="text-center text-[13px] text-muted">You can edit before locking. You can&apos;t change it after.</p>
        )}
        {error && <p className="text-center font-bold text-ai">{error}</p>}
      </form>

      <Panel className="mt-1 flex flex-col gap-2 border-[1.5px] p-4 text-muted">
        <Label>No feedback until the reveal</Label>
        <p className="text-sm leading-relaxed">Banned words are fine here. They only count against {describerName}.</p>
      </Panel>
    </>
  );
}
