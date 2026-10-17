// "use client" makes this run in the browser.
// Needed because the microphone, timers, and state only exist in the browser.
"use client";

// useState = values that re-draw the screen when they change.
// useRef   = values we need to keep around but that should NOT re-draw the screen
//            (the recorder object, the audio chunks, the timer id).
// useEffect = run code when the component appears/disappears (we use it for cleanup).
import { useEffect, useRef, useState } from "react";

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

// Phones don't all record the same audio format:
// Chrome/Android record "webm", iPhone Safari records "mp4".
// This picks the first format the current browser supports.
// An empty string means "let the browser pick its default".
function pickMimeType() {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export default function MicRecorder({ maxSeconds = 20, onRecorded }: Props) {
  // Which screen we're on.
  const [status, setStatus] = useState<Status>("idle");
  // Countdown number shown on the button.
  const [secondsLeft, setSecondsLeft] = useState(maxSeconds);
  // Friendly error message if the mic doesn't work.
  const [error, setError] = useState("");

  // The browser's recorder object. Kept in a ref so stop() can reach it later.
  const recorderRef = useRef<MediaRecorder | null>(null);
  // The recorder hands us audio in small pieces ("chunks"). We collect them here
  // and glue them together into one file when recording stops.
  const chunksRef = useRef<Blob[]>([]);
  // The countdown timer's id, so we can cancel it.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup: if the player leaves the screen mid-recording, cancel the timer and
  // turn the mic off. Without this, the phone's "mic in use" indicator stays on.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Runs when the player taps the button to start talking.
  async function start() {
    setError("");

    // getUserMedia (the mic API) only exists on secure pages: https:// or localhost.
    // On a phone hitting http://192.168.x.x it's missing, so explain instead of crashing.
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("The mic only works over https. Try the deployed site.");
      return;
    }

    try {
      // Ask for the mic. The first time, the phone shows an "Allow microphone?" popup.
      // If the player says no, this throws and we land in the catch below.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create the recorder for that mic stream, using a format this phone supports.
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      // Start with an empty list of chunks for this new recording.
      chunksRef.current = [];

      // Every time the recorder has a piece of audio ready, save it.
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // When recording stops (player tapped Stop, or time ran out):
      recorder.onstop = () => {
        // Turn the mic off.
        stream.getTracks().forEach((track) => track.stop());
        // Glue all the chunks into one audio file (a Blob).
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType });
        setStatus("done");
        // Hand the file to the parent page.
        onRecorded(audio);
      };

      // Go!
      recorder.start();
      recorderRef.current = recorder;
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

  // Stops the countdown and the recording. Safe to call more than once.
  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    const recorder = recorderRef.current;
    // Calling stop() triggers recorder.onstop above, which builds the file.
    if (recorder && recorder.state === "recording") recorder.stop();
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