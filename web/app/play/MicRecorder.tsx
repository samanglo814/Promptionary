// "use client" makes this run in the browser.
// Needed because the microphone, timers, and state only exist in the browser.
"use client";

// useState = values that re-draw the screen when they change.
// useRef   = values we need to keep around but that should NOT re-draw the screen
//            (the recording, the timer id).
// useEffect = run code when the component appears/disappears (we use it for cleanup).
import { useEffect, useRef, useState } from "react";
import { micAvailable, startRecording, type Recording } from "@/lib/mic";

// What the parent page passes in.
type Props = {
  // How long the player gets to talk. The game rule is 20 seconds.
  maxSeconds?: number;
  // Called once with the finished recording. The parent decides what to do with it
  // (send it to /submit, play it back, etc.). This keeps the recorder reusable.
  onRecorded: (audio: Blob) => void;
};

// The four screens the button can be in.
type Status = "idle" | "recording" | "done" | "error";

export default function MicRecorder({ maxSeconds = 20, onRecorded }: Props) {
  // Which screen we're on.
  const [status, setStatus] = useState<Status>("idle");
  // Countdown number shown on the button.
  const [secondsLeft, setSecondsLeft] = useState(maxSeconds);
  // Friendly error message if the mic doesn't work.
  const [error, setError] = useState("");

  // The recording in progress. Kept in a ref so stop() can reach it later.
  const recordingRef = useRef<Recording | null>(null);
  // The countdown timer's id, so we can cancel it.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup: if the player leaves the screen mid-recording, cancel the timer and the recording.
  // The mic itself stays open for the next turn (see lib/mic.ts), so the phone doesn't ask again.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recordingRef.current?.cancel();
    };
  }, []);

  // Runs when the player taps the button to start talking.
  async function start() {
    setError("");

    // On a phone hitting http://192.168.x.x the mic API is missing, so explain instead of crashing.
    if (!micAvailable()) {
      setStatus("error");
      setError("The mic only works over https. Try the deployed site.");
      return;
    }

    try {
      // The first time, the phone shows an "Allow microphone?" popup.
      // If the player says no, this throws and we land in the catch below.
      recordingRef.current = await startRecording();
      setStatus("recording");
      setSecondsLeft(maxSeconds);

      // Countdown. We compare against the real start time instead of just
      // subtracting 1 each tick, because phones can delay timers and drift.
      // Ticking every 250ms keeps the number feeling responsive.
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const left = maxSeconds - Math.floor((Date.now() - startedAt) / 1000);
        setSecondsLeft(Math.max(left, 0));
        if (left <= 0) stop(); // time's up, stop automatically
      }, 250);
    } catch {
      // Usually means the player tapped "Don't allow", or another app is using the mic.
      setStatus("error");
      setError("Couldn't use the mic. Allow microphone access and try again.");
    }
  }

  // Stops the countdown and the recording, and hands the audio to the parent. Safe to call more than once.
  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) return;
    try {
      const audio = recording.stop();
      setStatus("done");
      onRecorded(audio);
    } catch {
      // Stopped right away, or the mic picked up nothing: let them go again without spending an AI call.
      setStatus("error");
      setError("Didn't catch that. Tap and talk again!");
    }
  }

  // ---------- What the player sees ----------

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        // Same button does two jobs: start when idle, stop while recording.
        onClick={status === "recording" ? stop : start}
        // Can't press it again once we've got a recording (the parent takes over).
        disabled={status === "done"}
        // Big round button. Turns pink and pulses while recording.
        className={`size-48 rounded-full text-white text-2xl font-black shadow-lg flex flex-col items-center justify-center gap-1 disabled:opacity-40 ${
          status === "recording" ? "bg-pop animate-pulse" : "bg-ink"
        }`}
      >
        {status === "recording" ? (
          <>
            {/* Countdown while talking */}
            <span className="text-6xl">{secondsLeft}</span>
            <span className="text-base font-bold">Tap to stop</span>
          </>
        ) : status === "done" ? (
          "Got it!"
        ) : (
          "Tap to talk"
        )}
      </button>

      {/* Error message, only shown if something went wrong */}
      {error && <p className="text-pop font-bold text-center max-w-xs">{error}</p>}
    </div>
  );
}
