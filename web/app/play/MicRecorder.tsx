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
  // Called instead, with the words, when the phone turned the speech into text itself.
  onTranscript: (text: string) => void;
};

// The four screens the button can be in.
type Status = "idle" | "recording" | "done" | "error";

// ---------- Speech-to-text on the phone ----------
// Most phone browsers (iPhone Safari, Android Chrome) can turn speech into text themselves.
// That's free and has no daily limit, so when it works the server gets text and never
// spends an AI call on transcribing. Browsers without it record audio instead (lib/mic.ts).
type SpeechResultList = ArrayLike<ArrayLike<{ transcript: string }>>;
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: SpeechResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

// Set when the phone's speech-to-text failed for good (blocked, unavailable): later turns record instead.
let speechToTextBroken = false;

export function hasSpeechToText(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return !speechToTextBroken && Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

function newRecognition(): Recognition | null {
  if (speechToTextBroken) return null;
  const w = window as unknown as Record<string, (new () => Recognition) | undefined>;
  const SpeechRecognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return SpeechRecognition ? new SpeechRecognition() : null;
}

export default function MicRecorder({ maxSeconds = 20, onRecorded, onTranscript }: Props) {
  // Which screen we're on.
  const [status, setStatus] = useState<Status>("idle");
  // Countdown number shown on the button.
  const [secondsLeft, setSecondsLeft] = useState(maxSeconds);
  // Friendly error message if the mic doesn't work.
  const [error, setError] = useState("");

  // The audio recording in progress (browsers without speech-to-text). Kept in a ref so stop() can reach it.
  const recordingRef = useRef<Recording | null>(null);
  // The countdown timer's id, so we can cancel it.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Speech-to-text, when the phone has it: the recognizer, the words so far, and whether
  // we're still listening (it can stop on its own after a pause, and then we restart it).
  const recognitionRef = useRef<Recognition | null>(null);
  const [words, setWords] = useState("");
  const wordsRef = useRef("");
  const listeningRef = useRef(false);

  // Cleanup: if the player leaves the screen mid-recording, cancel the timer, the recording and the listening.
  // (A recording's mic stays open for the next turn, see lib/mic.ts, so the phone doesn't ask again.)
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recordingRef.current?.cancel();
      listeningRef.current = false;
      recognitionRef.current?.abort();
    };
  }, []);

  // Runs when the player taps the button to start talking.
  // Speech-to-text on the phone if it has it, otherwise an audio recording.
  function start() {
    setError("");
    const recognition = newRecognition();
    if (recognition) listen(recognition);
    else void record();
  }

  // Countdown. We compare against the real start time instead of just
  // subtracting 1 each tick, because phones can delay timers and drift.
  // Ticking every 250ms keeps the number feeling responsive.
  function startCountdown() {
    setStatus("recording");
    setSecondsLeft(maxSeconds);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const left = maxSeconds - Math.floor((Date.now() - startedAt) / 1000);
      setSecondsLeft(Math.max(left, 0));
      if (left <= 0) stop(); // time's up, stop automatically
    }, 250);
  }

  // Speech-to-text: words appear live while the player talks, and the text is sent when they stop.
  function listen(recognition: Recognition) {
    recognition.continuous = true;
    recognition.interimResults = true; // show words while they're still being spoken
    recognition.lang = "en-US";
    recognitionRef.current = recognition;
    wordsRef.current = "";
    setWords("");
    // Words from earlier listening sessions (after a restart), so they aren't lost.
    let earlier = "";

    recognition.onresult = (e) => {
      const heard = Array.from(e.results, (result) => result[0]?.transcript ?? "").join(" ");
      wordsRef.current = `${earlier} ${heard}`.replace(/\s+/g, " ").trim();
      setWords(wordsRef.current);
    };
    recognition.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // just a pause; onend handles it
      // Blocked or unavailable: fall back to recording audio, if nothing was heard yet,
      // and record straight away on later turns.
      speechToTextBroken = true;
      listeningRef.current = false;
      recognition.onend = null;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      if (e.error === "not-allowed" && !wordsRef.current) {
        setStatus("error");
        setError("Couldn't use the mic. Allow microphone access and try again.");
      } else if (!wordsRef.current) {
        void record();
      } else {
        finishListening();
      }
    };
    recognition.onend = () => {
      // Phones stop listening after a pause. Still the player's turn? Keep listening.
      if (listeningRef.current) {
        earlier = wordsRef.current;
        try {
          recognition.start();
          return;
        } catch {
          // Couldn't restart: send what we have.
        }
      }
      finishListening();
    };

    try {
      recognition.start();
    } catch {
      void record();
      return;
    }
    listeningRef.current = true;
    startCountdown();
  }

  function finishListening() {
    listeningRef.current = false;
    recognitionRef.current = null;
    const text = wordsRef.current.trim();
    if (text) {
      setStatus("done");
      onTranscript(text);
    } else {
      // Speech-to-text heard nothing (it can fail silently): record audio on the next try instead.
      speechToTextBroken = true;
      setStatus("error");
      setError("Didn't catch any words. Tap and try again!");
    }
  }

  // Audio recording (WAV), for browsers without speech-to-text. The server transcribes it.
  async function record() {
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
      startCountdown();
    } catch {
      // Usually means the player tapped "Don't allow", or another app is using the mic.
      setStatus("error");
      setError("Couldn't use the mic. Allow microphone access and try again.");
    }
  }

  // Stops the countdown and the listening or recording. Safe to call more than once.
  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    // Listening: stopping triggers recognition.onend above, which sends the words.
    if (recognitionRef.current && listeningRef.current) {
      listeningRef.current = false;
      recognitionRef.current.stop();
      return;
    }

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
    <div className="flex flex-col items-center gap-3">
      <button
        // Same button does two jobs: start when idle, stop (= done, send it) while recording.
        onClick={status === "recording" ? stop : start}
        // Can't press it again once we've got a recording (the parent takes over).
        disabled={status === "done"}
        // Big round button. Turns pink and pulses while recording, lime once it's sent.
        className={`flex size-40 flex-col items-center justify-center gap-1 rounded-full border-4 font-bold text-text ${
          status === "recording"
            ? "animate-pulse border-ai bg-ai/20"
            : status === "done"
              ? "border-point bg-point text-stage"
              : "border-action-edge bg-action"
        }`}
      >
        {status === "recording" ? (
          <>
            {/* Countdown while talking */}
            <span className="font-display text-6xl leading-none text-ai">{secondsLeft}</span>
            <span className="text-sm">Tap when done</span>
          </>
        ) : status === "done" ? (
          <span className="font-display text-3xl">Got it!</span>
        ) : (
          <>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            <span className="text-base">Tap to talk</span>
          </>
        )}
      </button>

      {/* The words so far, when the phone is doing speech-to-text */}
      {words && status !== "error" && <p className="max-w-xs text-center text-[17px] leading-snug text-text">“{words}”</p>}

      {/* Error message, only shown if something went wrong */}
      {error && <p className="max-w-xs text-center font-bold text-ai">{error}</p>}
    </div>
  );
}
