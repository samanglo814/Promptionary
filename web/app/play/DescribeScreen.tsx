// "use client" makes this run in the browser.
// Needed because we use state and the microphone.
"use client";

import { useState } from "react";
import { type SubmitResult, type Target } from "@/lib/mocks";
import { submitAudio, submitText } from "@/lib/submit";
import { useMsLeft, useSecondsLeft } from "@/lib/useSecondsLeft";
import { Button, Label, Meter, TextButton } from "@/components/ui";
import MicRecorder from "./MicRecorder";

// How long a turn is (server config describeMs), for the speed bonus meter.
const DESCRIBE_MS = 20_000;
const SPEED_POINTS = 100;

// What the parent (PlayerJoin) passes in.
type Props = {
  myName: string;
  target: Target; // the secret image + banned words for this round
  roomCode: string; // sent along with the description so the server knows which room
  playerId: string; // ...and which player
  endsAt?: number; // when the server stops accepting descriptions (epoch ms); unset with mocks
  onSubmitted: (result: SubmitResult) => void; // called when /submit answers
};

// How the player is describing: talking (default) or typing (fallback).
type Mode = "voice" | "type";

// Longest typed description allowed. About what you could say in 20 seconds.
const MAX_CHARS = 200;
// Spoken descriptions run longer than typed ones; the server takes up to 500 characters.
const MAX_SPOKEN_CHARS = 500;

// Finds which banned words appear in what the player typed.
// \b means "word boundary", so "dog" matches "a dog" but not "dogma".
// The "i" flag ignores upper/lower case.
// Special characters are escaped so a banned word like "c++" can't break the pattern.
function bannedWordsIn(text: string, banned: string[]) {
  return banned.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  });
}

// The phone screen for the player whose turn it is.
// Shows the secret image and banned words, takes their description (voice or typed),
// and sends it to /submit.
export default function DescribeScreen({ myName, target, roomCode, playerId, endsAt, onSubmitted }: Props) {
  // Seconds left in the turn. The round clock starts when the turn starts, not when the
  // player taps the mic, so the recording must stop by then too. null with mocks.
  const turnSecondsLeft = useSecondsLeft(endsAt);
  // The speed bonus drains with the clock: finish early, keep more of it.
  const msLeft = useMsLeft(endsAt);
  const speedBonus = msLeft === null ? SPEED_POINTS : Math.round((SPEED_POINTS * msLeft) / DESCRIBE_MS);
  const [mode, setMode] = useState<Mode>("voice");
  // What they've typed so far (typing mode only).
  const [text, setText] = useState("");
  // true while we're waiting for /submit to answer.
  const [sending, setSending] = useState(false);
  // Error message if sending failed.
  const [error, setError] = useState("");
  // Changing a component's `key` makes React throw it away and build a fresh one.
  // We bump this to reset MicRecorder back to "Tap to talk" after an error.
  const [attempt, setAttempt] = useState(0);

  // Banned words in the typed text, checked on every keystroke.
  // This is only a warning: the server still does the real check and the buzz.
  const typedBanned = bannedWordsIn(text, target.bannedWords);

  // Shared by voice and typing: show "Sending…", wait for the result, handle errors.
  // `submit` is whichever send function fits (audio or text).
  async function sendDescription(submit: () => Promise<SubmitResult>) {
    setSending(true);
    setError("");
    try {
      onSubmitted(await submit());
    } catch {
      // Network problem or server error: let them try again.
      setSending(false);
      setError("Couldn't send that. Try again!");
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <Label tone="action">{myName} · Describer</Label>
        {turnSecondsLeft !== null && (
          <span className={`font-display text-[34px] leading-none tabular-nums ${turnSecondsLeft <= 5 ? "text-ai" : "text-point"}`}>
            {turnSecondsLeft}s
          </span>
        )}
      </div>
      <h1 className="font-display text-[40px] leading-[1.04]">Describe this. Out loud.</h1>

      {/* The secret image. Only this phone sees it.
          Plain <img> instead of next/image because the images come from the game server,
          and next/image would need each address listed in next.config.ts. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={target.imageUrl}
        alt="Your secret image"
        className="aspect-[4/3] w-full rounded-inner border-2 border-action bg-raised object-cover"
      />

      {/* Banned words. Saying one gets you buzzed (the server checks the transcript).
          In typing mode, a word you've typed turns solid pink as a warning. */}
      <div className="flex flex-col gap-2">
        <Label tone="ai">Don&apos;t say · −100 each</Label>
        <div className="flex flex-wrap gap-2">
          {target.bannedWords.map((word) => (
            <span
              key={word}
              className={`rounded-full border px-3 py-1 text-sm font-bold line-through ${
                typedBanned.includes(word) ? "border-ai bg-ai text-stage" : "border-ai/60 bg-raised text-ai"
              }`}
            >
              {word}
            </span>
          ))}
        </div>
      </div>

      {!sending && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-xs">
            <span className="font-bold text-muted">Speed bonus if you finish now</span>
            <span className="font-extrabold text-point">+{speedBonus}</span>
          </div>
          <Meter value={speedBonus / SPEED_POINTS} />
        </div>
      )}

      {sending ? (
        // While /submit is working.
        <p className="mt-4 text-center font-display text-3xl animate-pulse">Sending to the AI…</p>
      ) : mode === "voice" ? (
        // ---------- Voice (default) ----------
        <>
          {/* The timer lives inside MicRecorder: it counts down while recording
              and stops on its own at 0. `key` lets us reset it after an error. */}
          <div className="mt-1">
            <MicRecorder
              key={attempt}
              maxSeconds={turnSecondsLeft === null ? undefined : Math.max(1, turnSecondsLeft)}
              onRecorded={(audio) => sendDescription(() => submitAudio(audio, roomCode, playerId))}
              onTranscript={(words) => sendDescription(() => submitText(words.slice(0, MAX_SPOKEN_CHARS), roomCode, playerId))}
            />
          </div>

          {/* The escape hatch: always visible, so a broken mic never blocks the round */}
          <TextButton onClick={() => setMode("type")}>Mic not working? Type it instead</TextButton>
        </>
      ) : (
        // ---------- Typing (fallback) ----------
        <form
          // onSubmit fires on the Send button and on the keyboard's Go/Enter key
          onSubmit={(e) => {
            e.preventDefault(); // stop the browser from reloading the page
            const description = text.trim();
            if (description) sendDescription(() => submitText(description, roomCode, playerId));
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-2 rounded-panel border-[1.5px] border-action bg-panel p-4 focus-within:border-action-edge">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_CHARS}
              rows={3}
              autoFocus // keyboard pops up right away when switching to typing
              placeholder="Describe it without the banned words…"
              className="resize-none bg-transparent text-lg text-text outline-none placeholder:text-dim"
            />
            {/* Banned-word warning (left) and characters left (right) */}
            <div className="flex justify-between text-xs">
              <span className="font-bold text-ai">
                {typedBanned.length > 0 && `“${typedBanned[0]}” will get you buzzed`}
              </span>
              <span className="tabular-nums text-muted">{MAX_CHARS - text.length}</span>
            </div>
          </label>

          <Button type="submit" disabled={!text.trim()}>
            Done. Send it →
          </Button>

          {/* type="button" so this doesn't submit the form */}
          <TextButton type="button" onClick={() => setMode("voice")}>
            Use the mic instead
          </TextButton>
        </form>
      )}

      {/* Shown if sending failed, in either mode */}
      {error && !sending && (
        <div className="flex flex-col items-center gap-2">
          <p className="font-bold text-ai">{error}</p>
          {/* In voice mode, reset the recorder so they can record again.
              In typing mode their text is still there; they just tap Send again. */}
          {mode === "voice" && (
            <TextButton
              onClick={() => {
                setError("");
                setAttempt((n) => n + 1); // fresh MicRecorder
              }}
            >
              Record again
            </TextButton>
          )}
        </div>
      )}
    </>
  );
}
