// "use client" makes this run in the browser.
// Needed because we use state, form input, and window.
"use client";

// useState             = values that re-draw the screen when they change
// useRef               = a handle on a real DOM element (we use it to focus the name box)
// useEffect            = run code after the screen draws
// useSyncExternalStore = read something from outside React (here: the URL) safely
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { mockTarget, type Player, type SubmitResult, type Target } from "@/lib/mocks";
import { SERVER_URL, connect, guessErrorText, joinErrorText, type GameSocket } from "@/lib/socket";
import DescribeScreen from "./DescribeScreen";
import GuessScreen from "./GuessScreen";

// Read ?code= from the URL. Only works in the browser (window doesn't exist on the
// server), so useSyncExternalStore below uses "" on the server and this in the browser.
const codeFromUrl = () =>
  (new URLSearchParams(window.location.search).get("code") ?? "").toUpperCase().slice(0, 4);
// The URL never changes while you're on this page, so there's nothing to subscribe to.
const noSubscribe = () => () => {};

// Which screen the phone is showing after joining.
// With a server, socket events decide this (e.g. "your_turn", "turn_intro").
//   describing = my turn: secret image + mic
//   sent       = I've described it
//   guessing   = someone else's turn: type one guess
type Phase = "waiting" | "describing" | "sent" | "guessing";

// Saved in the browser after joining, so a refreshed phone rejoins as the same player.
type Session = { code: string; name: string; playerId: string };
const SESSION_KEY = "reverse-charades-session";

function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
  } catch {
    return null; // private browsing or corrupted value: just join fresh
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage unavailable: rejoining after a refresh won't work, everything else does.
  }
}

export default function PlayerJoin() {
  // ---------- Joining ----------

  // Room code: from the QR link, unless the player types their own.
  // typedCode is null until they type, so the URL code shows by default.
  const urlCode = useSyncExternalStore(noSubscribe, codeFromUrl, () => "");
  const [typedCode, setTypedCode] = useState<string | null>(null);
  const code = typedCode ?? urlCode;

  const [name, setName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null); // the name <input>, so we can focus it

  // The joined player. null = still on the join form.
  const [me, setMe] = useState<Player | null>(null);

  // ---------- After joining ----------

  const [phase, setPhase] = useState<Phase>("waiting");
  // What /submit sent back, shown on the "sent" screen.
  const [result, setResult] = useState<SubmitResult | null>(null);

  // ---------- Live mode (server connected) ----------

  // The live connection. null in mock mode.
  const [socket, setSocket] = useState<GameSocket | null>(null);
  // My secret image and when my turn ends, from "your_turn".
  const [target, setTarget] = useState<Target>(mockTarget);
  const [endsAt, setEndsAt] = useState<number | undefined>(undefined);
  // What the waiting screen says, e.g. "Sam is describing…".
  const [waitingText, setWaitingText] = useState("Waiting for the host to start…");
  // Why joining failed (or why the game ended), shown on the join form.
  const [joinError, setJoinError] = useState("");
  // Guessing on someone else's turn: who's describing, when guessing closes, and my locked-in guess.
  const [describerName, setDescriberName] = useState("");
  const [guessEndsAt, setGuessEndsAt] = useState<number | undefined>(undefined);
  const [lockedGuess, setLockedGuess] = useState<{ text: string; speed: number } | null>(null);
  const [guessSending, setGuessSending] = useState(false);
  const [guessError, setGuessError] = useState("");

  useEffect(() => {
    if (!SERVER_URL) return;
    const s = connect();
    // The player's id, once joined. A plain variable so every handler below sees the latest one.
    let myId: string | null = null;
    // True while an automatic rejoin is in flight, so its failure can be silent.
    let rejoining = false;
    // True once my guess for this turn is locked in. A plain variable for the same reason as myId.
    let guessed = false;

    // On first connect, and again after any reconnect (new socket), rejoin if we were in a room.
    // A saved session for a different room (e.g. scanned a new QR code) is ignored.
    s.on("connect", () => {
      const saved = loadSession();
      const linkCode = codeFromUrl();
      if (saved && (!linkCode || linkCode === saved.code)) {
        rejoining = true;
        s.emit("join", { code: saved.code, name: saved.name, playerId: saved.playerId });
      }
    });
    s.on("joined", ({ player, code }) => {
      rejoining = false;
      myId = player.id;
      saveSession({ code, name: player.name, playerId: player.id });
      setTypedCode(code);
      setJoinError("");
      setMe(player);
    });
    s.on("join_error", ({ reason }) => {
      saveSession(null);
      // An old room that's gone isn't worth a message; just show the join form.
      if (rejoining) {
        rejoining = false;
        return;
      }
      setJoinError(joinErrorText[reason]);
    });
    s.on("your_turn", ({ target, endsAt }) => {
      setTarget(target);
      setEndsAt(endsAt);
      setPhase("describing");
    });
    s.on("round_start", ({ round, totalRounds, multiplier }) => {
      setPhase("waiting");
      setWaitingText(`Round ${round} of ${totalRounds}${multiplier > 1 ? `: points x${multiplier}!` : ""}`);
    });
    s.on("turn_intro", ({ round, describer }) => {
      setPhase("waiting");
      guessed = false;
      setLockedGuess(null);
      setGuessSending(false);
      setGuessError("");
      setWaitingText(
        describer.id === myId ? `Round ${round}: you're up! Get ready…` : `Round ${round}: ${describer.name} is up. Get ready to guess!`,
      );
    });
    s.on("describing", ({ describer, guessEndsAt }) => {
      if (describer.id === myId) return;
      setDescriberName(describer.name);
      setGuessEndsAt(guessEndsAt);
      setPhase("guessing");
    });
    s.on("guess_locked", (guess) => {
      guessed = true;
      setLockedGuess(guess);
      setGuessSending(false);
    });
    s.on("guess_error", ({ reason }) => {
      setGuessSending(false);
      setGuessError(guessErrorText[reason]);
    });
    s.on("guesses_locked", ({ open }) => {
      // Guessing closed. Keep showing a locked-in guess; otherwise go back to waiting.
      if (open || guessed) return;
      setPhase((p) => (p === "guessing" ? "waiting" : p));
      setWaitingText("Guessing closed. Look at the big screen!");
    });
    s.on("round_result", () => {
      // My turn ran out before I sent anything, or guessing is over: back to waiting.
      setPhase((p) => (p === "describing" || p === "guessing" ? "waiting" : p));
      setWaitingText("Look at the big screen!");
    });
    s.on("processing", ({ describer }) => {
      if (describer.id !== myId) setWaitingText("The AI is drawing… look at the big screen!");
    });
    s.on("game_over", () => {
      setPhase("waiting");
      setWaitingText("Game over! Check the big screen 🏆");
    });
    s.on("error", ({ message }) => {
      // Players only get this when the host left: the room is gone, so back to the join form.
      saveSession(null);
      setMe(null);
      setPhase("waiting");
      setJoinError(message);
    });
    // Keep the connection so join() can send events.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s);
    return () => {
      s.close();
    };
  }, []);

  // Came from the QR code? Jump straight to the name field.
  useEffect(() => {
    if (urlCode) nameRef.current?.focus();
  }, [urlCode]);

  // Join is only allowed with a 4-letter code and a name.
  const canJoin = code.trim().length === 4 && name.trim().length > 0;

  function join(e: React.FormEvent) {
    e.preventDefault(); // stop the browser from reloading the page on form submit
    if (!canJoin) return;

    if (socket) {
      // The server answers with "joined" or "join_error" (handled above).
      setJoinError("");
      socket.emit("join", { code: code.trim().toUpperCase(), name: name.trim() });
      return;
    }

    // FAKE (mock mode): pretend the server accepted us.
    setMe({ id: crypto.randomUUID(), name: name.trim(), score: 0 });
  }

  // ---------- Screens after joining ----------
  // Early returns: whichever `if` matches first is the screen that shows.

  // It's my turn: secret image, banned words, mic.
  if (me && phase === "describing") {
    return (
      <DescribeScreen
        // From "your_turn" (mockTarget in mock mode).
        target={target}
        roomCode={code}
        playerId={me.id}
        endsAt={endsAt}
        onSubmitted={(r) => {
          setResult(r);
          setPhase("sent");
        }}
      />
    );
  }

  // Someone else's turn: guess what they're describing (or show my locked-in guess).
  if (me && phase === "guessing") {
    return (
      <GuessScreen
        describerName={describerName}
        guessEndsAt={guessEndsAt}
        locked={lockedGuess}
        sending={guessSending}
        error={guessError}
        onGuess={(text) => {
          setGuessError("");
          setGuessSending(true);
          socket?.emit("guess", { text });
        }}
      />
    );
  }

  // I've described it: point everyone at the big screen for the reveal.
  if (me && phase === "sent") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 text-center">
        <h1 className="text-4xl font-black">Sent! 🎨</h1>
        <p className="text-xl opacity-60">Look at the big screen for the reveal</p>

        {/* TEMP: shows the (mock) result here so you can check /submit worked.
            The real reveal happens on the host screen (#16). */}
        {result && (
          <p className="opacity-60 max-w-xs">
            “{result.transcript}” → {result.score}% · {result.caption}
          </p>
        )}

        {/* TEMP: lets you replay the flow without a server */}
        {!socket && (
          <button onClick={() => setPhase("waiting")} className="underline opacity-60">
            Back to waiting (test)
          </button>
        )}
      </main>
    );
  }

  // Joined, waiting for the host (or for my turn).
  if (me) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 text-center">
        <p className="text-lg uppercase tracking-widest opacity-60">Room {code}</p>
        <div className="bg-zap rounded-card px-8 py-5 text-4xl font-black animate-[pop_0.3s_ease-out]">
          {me.name}
        </div>
        <h1 className="text-3xl font-black">You&apos;re in!</h1>
        <p className="text-lg opacity-60 animate-pulse">{waitingText}</p>

        {/* TEMP (mock mode only): stands in for the server's "your_turn" event so you can
            test the describe screen. */}
        {!socket && (
          <button
            onClick={() => setPhase("describing")}
            className="mt-6 border-2 border-ink/20 rounded-card px-5 py-2 font-bold opacity-60"
          >
            Pretend it&apos;s my turn (test)
          </button>
        )}
      </main>
    );
  }

  // ---------- Join form (not joined yet) ----------

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-4xl font-black tracking-tight text-center">Reverse Charades</h1>

      {/* onSubmit fires on the Join button AND on pressing Enter/Go on the keyboard */}
      <form
        onSubmit={join}
        className="bg-white rounded-card shadow-lg p-6 w-full max-w-sm flex flex-col gap-5"
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm uppercase tracking-widest opacity-60">Room code</span>
          <input
            value={code}
            onChange={(e) => setTypedCode(e.target.value.toUpperCase())}
            maxLength={4}
            autoCapitalize="characters" // phone keyboard starts in caps
            autoComplete="off" // no browser autofill suggestions
            placeholder="ABCD"
            className="text-4xl font-black text-pop tracking-widest text-center border-2 border-ink/10 rounded-card py-3 outline-none focus:border-pop"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm uppercase tracking-widest opacity-60">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            autoComplete="off"
            ref={nameRef}
            placeholder="Sam"
            className="text-2xl font-bold text-center border-2 border-ink/10 rounded-card py-3 outline-none focus:border-pop"
          />
        </label>

        {joinError && <p className="text-pop font-bold text-center">{joinError}</p>}

        <button
          type="submit"
          disabled={!canJoin}
          className="bg-pop text-white text-2xl font-bold py-4 rounded-card disabled:opacity-40"
        >
          Join
        </button>
      </form>
    </main>
  );
}