// "use client" makes this run in the browser.
// Needed because we use state and the microphone.
"use client";

import { useState } from "react";
import { type SubmitResult, type Target } from "@/lib/mocks";
import { submitAudio } from "@/lib/submit";
import MicRecorder from "./MicRecorder";

// What the parent (PlayerJoin) passes in.
type Props = {
  target: Target; // the secret image + banned words for this round
  roomCode: string; // sent along with the audio so the server knows which room
  playerId: string; // ...and which player
  onSubmitted: (result: SubmitResult) => void; // called when /submit answers
};

// The phone screen for the player whose turn it is.
// Shows the secret image and banned words, records their description,
// and sends it to /submit.
export default function DescribeScreen({ target, roomCode, playerId, onSubmitted }: Props) {
  // true while we're waiting for /submit to answer.
  const [sending, setSending] = useState(false);
  // Error message if sending failed.
  const [error, setError] = useState("");
  // Changing a component's `key` makes React throw it away and build a fresh one.
  // We bump this to reset MicRecorder back to "Tap to talk" after an error.
  const [attempt, setAttempt] = useState(0);

  // Runs when MicRecorder hands us the finished recording.
  async function send(audio: Blob) {
    setSending(true);
    setError("");
    try {
      // Send the audio (or get mock data back if there's no server yet).
      const result = await submitAudio(audio, roomCode, playerId);
      // Tell the parent we're done. It switches to the "sent" screen.
      onSubmitted(result);
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

      {/* Banned words. Saying one gets you buzzed (the server checks the transcript). */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm uppercase tracking-widest opacity-60">Don&apos;t say</p>
        <div className="flex flex-wrap justify-center gap-2">
          {target.bannedWords.map((word) => (
            <span
              key={word}
              className="bg-pop/10 text-pop font-bold px-3 py-1 rounded-full line-through"
            >
              {word}
            </span>
          ))}
        </div>
      </div>

      {sending ? (
        // While /submit is working. Later this can be a funnier "AI is drawing…" state.
        <p className="text-2xl font-black animate-pulse mt-4">Sending to the AI…</p>
      ) : (
        <>
          {/* The 20-second timer lives inside MicRecorder: it counts down while recording
              and stops on its own at 0. `key` lets us reset it after an error. */}
          <MicRecorder key={attempt} onRecorded={send} />
          {error && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-pop font-bold">{error}</p>
              <button
                onClick={() => {
                  setError("");
                  setAttempt((n) => n + 1); // fresh MicRecorder
                }}
                className="underline font-bold"
              >
                Record again
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}