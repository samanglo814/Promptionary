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
  // Called instead, with the words, when the phone turned the speech into text itself.
  onTranscript: (text: string) => void;
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

// ---------- Speech-to-text on the phone ----------
// Most phone browsers (iPhone Safari, Android Chrome) can turn speech into text themselves.
// That's free and has no daily limit, so when it works the server gets text and never
// spends an AI call on transcribing. Browsers without it record audio instead.
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

function newRecognition(): Recognition | null {
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

  // The browser's recorder object. Kept in a ref so stop() can reach it later.
  const recorderRef = useRef<MediaRecorder | null>(null);
  // The recorder hands us audio in small pieces ("chunks"). We collect them here
  // and glue them together into one file when recording stops.
  const chunksRef = useRef<Blob[]>([]);
  // The countdown timer's id, so we can cancel it.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Speech-to-text, when the phone has it: the recognizer, the words so far, and whether
  // we're still listening (it can stop on its own after a pause, and then we restart it).
  const recognitionRef = useRef<Recognition | null>(null);
  const [words, setWords] = useState("");
  const wordsRef = useRef("");
  const listeningRef = useRef(false);

  // Cleanup: if the player leaves the screen mid-recording, cancel the timer and
  // turn the mic off. Without this, the phone's "mic in use" indicator stays on.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
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
      // Blocked or unavailable: fall back to recording audio, if nothing was heard yet.
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
      setStatus("error");
      setError("Didn't catch any words. Tap and try again, or type it.");
    }
  }

  // Audio recording, for browsers without speech-to-text. The server transcribes it.
  async function record() {
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
      startCountdown();
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

    // Listening: stopping triggers recognition.onend above, which sends the words.
    if (recognitionRef.current && listeningRef.current) {
      listeningRef.current = false;
      recognitionRef.current.stop();
      return;
    }

    const recorder = recorderRef.current;
    // Calling stop() triggers recorder.onstop above, which builds the file.
    if (recorder && recorder.state === "recording") recorder.stop();
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
