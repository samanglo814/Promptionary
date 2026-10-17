// "use client" makes this run in the browser.
// Needed because we use state and the microphone.
"use client";

import { useState } from "react";
import { type SubmitResult, type Target } from "@/lib/mocks";
import { SubmitError, submitAudio, submitText } from "@/lib/submit";
import { useMsLeft, useSecondsLeft } from "@/lib/useSecondsLeft";
import { Label, Meter, TextButton } from "@/components/ui";
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
  onSpeaking: () => void; // the mic heard the first word (starts the guessers' clock)
  onSubmitted: (result: SubmitResult) => void; // called when /submit answers
};

// Spoken descriptions run long; the server takes up to 500 characters.
const MAX_SPOKEN_CHARS = 500;

// The phone screen for the player whose turn it is.
// Shows the secret image and banned words, and sends their spoken description to /submit:
// as text when the phone turned the speech into text itself, otherwise as a recording.
// Voice only: the other players guess from hearing it out loud, so there's no typing.
export default function DescribeScreen({ myName, target, roomCode, playerId, endsAt, onSpeaking, onSubmitted }: Props) {
  // Seconds left in the turn. The round clock starts when the turn starts, not when the
  // player taps the mic, so the recording must stop by then too. null with mocks.
  const turnSecondsLeft = useSecondsLeft(endsAt);
  // The speed bonus drains with the clock: finish early, keep more of it.
  const msLeft = useMsLeft(endsAt);
  const speedBonus = msLeft === null ? SPEED_POINTS : Math.round((SPEED_POINTS * msLeft) / DESCRIBE_MS);
  // true while we're waiting for /submit to answer.
  const [sending, setSending] = useState(false);
  // Error message if sending failed.
  const [error, setError] = useState("");
  // false once the server says this turn can't be described any more (e.g. the AI is out of requests).
  const [canRetry, setCanRetry] = useState(true);
  // Changing a component's `key` makes React throw it away and build a fresh one.
  // We bump this to reset MicRecorder back to "Tap to talk" after an error.
  const [attempt, setAttempt] = useState(0);
  // The last description, kept so a failed send can be sent again without saying it all again.
  const [lastSend, setLastSend] = useState<(() => Promise<SubmitResult>) | null>(null);

  // Show "The AI is drawing…", wait for the result, handle errors.
  // `submit` is whichever send function fits (the recording, or the words the phone heard).
  async function sendDescription(submit: () => Promise<SubmitResult>) {
    setLastSend(() => submit);
    setSending(true);
    setError("");
    try {
      onSubmitted(await submit());
    } catch (err) {
      // Show the server's reason (e.g. "Time's up."), or a generic line for network problems.
      setSending(false);
      setError(err instanceof SubmitError ? err.message : "Couldn't send that. Check your connection and try again!");
      // 503: the AI gave up and the turn is over; 403: time's up or not your turn.
      if (err instanceof SubmitError && (err.status === 503 || err.status === 403)) setCanRetry(false);
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

      {/* Banned words. Saying one gets you buzzed (the server checks the transcript). */}
      <div className="flex flex-col gap-2">
        <Label tone="ai">Don&apos;t say · −100 each</Label>
        <div className="flex flex-wrap gap-2">
          {target.bannedWords.map((word) => (
            <span key={word} className="rounded-full border border-ai/60 bg-raised px-3 py-1 text-sm font-bold text-ai line-through">
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
        // While /submit is working. It answers with the reveal, so point them at the big screen.
        <div className="mt-4 flex flex-col items-center gap-2 text-center">
          <p className="font-display text-3xl animate-pulse">The AI is drawing… 🎨</p>
          <p className="text-muted">Look at the big screen!</p>
        </div>
      ) : (
        // The timer lives inside MicRecorder: it counts down while recording
        // and stops on its own at 0. `key` lets us reset it after an error.
        canRetry && (
          <div className="mt-1">
            <MicRecorder
              key={attempt}
              maxSeconds={turnSecondsLeft === null ? undefined : Math.max(1, turnSecondsLeft)}
              onSpeaking={onSpeaking}
              onRecorded={(audio) => sendDescription(() => submitAudio(audio, roomCode, playerId))}
              onTranscript={(words) => sendDescription(() => submitText(words.slice(0, MAX_SPOKEN_CHARS), roomCode, playerId))}
            />
          </div>
        )
      )}

      {/* Shown if sending failed */}
      {error && !sending && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-center font-bold text-ai">{error}</p>
          {/* Send the same description again, or reset the recorder to say it again. */}
          {canRetry && (
            <div className="flex gap-6">
              {lastSend && <TextButton onClick={() => sendDescription(lastSend)}>Send again</TextButton>}
              <TextButton
                onClick={() => {
                  setError("");
                  setAttempt((n) => n + 1); // fresh MicRecorder
                }}
              >
                Record again
              </TextButton>
            </div>
          )}
        </div>
      )}
    </>
  );
}
