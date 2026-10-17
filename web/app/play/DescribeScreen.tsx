// "use client" makes this run in the browser.
// Needed because we use state and the microphone.
"use client";

import { useState } from "react";
import { type SubmitResult, type Target } from "@/lib/mocks";
import { SubmitError, submitAudio } from "@/lib/submit";
import { useSecondsLeft } from "@/lib/useSecondsLeft";
import MicRecorder from "./MicRecorder";

// What the parent (PlayerJoin) passes in.
type Props = {
  target: Target; // the secret image + banned words for this round
  roomCode: string; // sent along with the description so the server knows which room
  playerId: string; // ...and which player
  endsAt?: number; // when the server stops accepting descriptions (epoch ms); unset with mocks
  onSubmitted: (result: SubmitResult) => void; // called when /submit answers
};

// The phone screen for the player whose turn it is.
// Shows the secret image and banned words, records their spoken description, and sends it to /submit.
// Voice only: the other players guess from hearing it out loud, so there's no typing.
export default function DescribeScreen({ target, roomCode, playerId, endsAt, onSubmitted }: Props) {
  // Seconds left in the turn. The round clock starts when the turn starts, not when the
  // player taps the mic, so the recording must stop by then too. null with mocks.
  const turnSecondsLeft = useSecondsLeft(endsAt);
  // true while we're waiting for /submit to answer.
  const [sending, setSending] = useState(false);
  // Error message if sending failed.
  const [error, setError] = useState("");
  // false once the server says this turn can't be described any more (e.g. the AI is out of requests).
  const [canRetry, setCanRetry] = useState(true);
  // Changing a component's `key` makes React throw it away and build a fresh one.
  // We bump this to reset MicRecorder back to "Tap to talk" after an error.
  const [attempt, setAttempt] = useState(0);
  // The last recording, kept so a failed send can be sent again without re-recording.
  const [lastAudio, setLastAudio] = useState<Blob | null>(null);

  // Show "The AI is drawing…", wait for the result, handle errors.
  async function sendAudio(audio: Blob) {
    setLastAudio(audio);
    setSending(true);
    setError("");
    try {
      onSubmitted(await submitAudio(audio, roomCode, playerId));
    } catch (err) {
      // Show the server's reason (e.g. "Time's up."), or a generic line for network problems.
      setSending(false);
      setError(err instanceof SubmitError ? err.message : "Couldn't send that. Check your connection and try again!");
      // 503: the AI is out of requests and the turn is over; 403: time's up or not your turn.
      if (err instanceof SubmitError && (err.status === 503 || err.status === 403)) setCanRetry(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center gap-5 p-6 text-center">
      <p className="text-sm uppercase tracking-widest opacity-60">Your turn! Describe this out loud:</p>

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
            <span key={word} className="font-bold px-3 py-1 rounded-full line-through bg-pop/10 text-pop">
              {word}
            </span>
          ))}
        </div>
      </div>

      {sending ? (
        // While /submit is working. It answers with the reveal, so point them at the big screen.
        <div className="flex flex-col items-center gap-2 mt-4">
          <p className="text-2xl font-black animate-pulse">The AI is drawing… 🎨</p>
          <p className="opacity-60">Look at the big screen!</p>
        </div>
      ) : (
        canRetry && (
          // The timer lives inside MicRecorder: it counts down while recording
          // and stops on its own at 0. `key` lets us reset it after an error.
          <MicRecorder
            key={attempt}
            maxSeconds={turnSecondsLeft === null ? undefined : Math.max(1, turnSecondsLeft)}
            onRecorded={sendAudio}
          />
        )
      )}

      {/* Shown if sending failed */}
      {error && !sending && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-pop font-bold">{error}</p>
          {/* Send the same recording again, or reset the recorder to record a new one. */}
          {canRetry && (
            <div className="flex gap-6">
              {lastAudio && (
                <button onClick={() => sendAudio(lastAudio)} className="underline font-bold">
                  Send again
                </button>
              )}
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
        </div>
      )}
    </main>
  );
}
