// "use client" makes this run in the browser.
// Needed because we use state and the microphone.
"use client";

import { useState } from "react";
import { type SubmitResult, type Target } from "@/lib/mocks";
import { submitAudio, submitText } from "@/lib/submit";
import MicRecorder from "./MicRecorder";

// What the parent (PlayerJoin) passes in.
type Props = {
  target: Target; // the secret image + banned words for this round
  roomCode: string; // sent along with the description so the server knows which room
  playerId: string; // ...and which player
  onSubmitted: (result: SubmitResult) => void; // called when /submit answers
};

// How the player is describing: talking (default) or typing (fallback).
type Mode = "voice" | "type";

// Longest typed description allowed. About what you could say in 20 seconds.
const MAX_CHARS = 200;

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
export default function DescribeScreen({ target, roomCode, playerId, onSubmitted }: Props) {
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
    <main className="min-h-screen flex flex-col items-center gap-5 p-6 text-center">
      <p className="text-sm uppercase tracking-widest opacity-60">Your turn! Describe this:</p>

      {/* The secret image. Only this phone sees it.
          Plain <img> instead of next/image because the images come from other
          websites, and next/image would need each site listed in next.config.ts. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={target.imageUrl}
        alt="Your secret image"
        className="w-full max-w-xs aspect-square object-cover rounded-card shadow-lg"
      />

      {/* Banned words. Saying one gets you buzzed (the server checks the transcript).
          In typing mode, a word you've typed turns solid pink as a warning. */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm uppercase tracking-widest opacity-60">Don&apos;t say</p>
        <div className="flex flex-wrap justify-center gap-2">
          {target.bannedWords.map((word) => (
            <span
              key={word}
              className={`font-bold px-3 py-1 rounded-full line-through ${
                typedBanned.includes(word) ? "bg-pop text-white" : "bg-pop/10 text-pop"
              }`}
            >
              {word}
            </span>
          ))}
        </div>
      </div>

      {sending ? (
        // While /submit is working. Later this can be a funnier "AI is drawing…" state.
        <p className="text-2xl font-black animate-pulse mt-4">Sending to the AI…</p>
      ) : mode === "voice" ? (
        // ---------- Voice (default) ----------
        <>
          {/* The 20-second timer lives inside MicRecorder: it counts down while recording
              and stops on its own at 0. `key` lets us reset it after an error. */}
          <MicRecorder
            key={attempt}
            onRecorded={(audio) => sendDescription(() => submitAudio(audio, roomCode, playerId))}
          />

          {/* The escape hatch: always visible, so a broken mic never blocks the round */}
          <button onClick={() => setMode("type")} className="underline opacity-60">
            Mic not working? Type it instead
          </button>
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
          className="w-full max-w-xs flex flex-col gap-3"
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_CHARS}
            rows={3}
            autoFocus // keyboard pops up right away when switching to typing
            placeholder="Describe it without the banned words…"
            className="w-full text-lg border-2 border-ink/10 rounded-card p-3 outline-none focus:border-pop resize-none"
          />

          {/* Banned-word warning (left) and characters left (right) */}
          <div className="flex justify-between text-sm">
            <span className="text-pop font-bold">
              {typedBanned.length > 0 && `⚠️ “${typedBanned[0]}” will get you buzzed`}
            </span>
            <span className="opacity-60 tabular-nums">{MAX_CHARS - text.length}</span>
          </div>

          <button
            type="submit"
            disabled={!text.trim()}
            className="bg-pop text-white text-2xl font-bold py-4 rounded-card disabled:opacity-40"
          >
            Send
          </button>

          {/* type="button" so this doesn't submit the form */}
          <button type="button" onClick={() => setMode("voice")} className="underline opacity-60">
            Use the mic instead
          </button>
        </form>
      )}

      {/* Shown if sending failed, in either mode */}
      {error && !sending && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-pop font-bold">{error}</p>
          {/* In voice mode, reset the recorder so they can record again.
              In typing mode their text is still there; they just tap Send again. */}
          {mode === "voice" && (
            <button
              onClick={() => {
                setError("");
                setAttempt((n) => n + 1); // fresh MicRecorder
              }}
              className="underline font-bold"
            >
              Record again
            </button>
          )}
        </div>
      )}
    </main>
  );
}