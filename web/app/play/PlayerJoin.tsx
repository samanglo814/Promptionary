// "use client" makes this run in the browser.
// Needed because we use state, form input, and window.
"use client";

// useState             = values that re-draw the screen when they change
// useRef               = a handle on a real DOM element (we use it to focus the name box)
// useEffect            = run code after the screen draws
// useSyncExternalStore = read something from outside React (here: the URL) safely
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { mockTarget, type Player, type SubmitResult } from "@/lib/mocks";
import DescribeScreen from "./DescribeScreen";

// Read ?code= from the URL. Only works in the browser (window doesn't exist on the
// server), so useSyncExternalStore below uses "" on the server and this in the browser.
const codeFromUrl = () =>
  (new URLSearchParams(window.location.search).get("code") ?? "").toUpperCase().slice(0, 4);
// The URL never changes while you're on this page, so there's nothing to subscribe to.
const noSubscribe = () => () => {};

// Which screen the phone is showing after joining.
// Later the server decides this with socket events (e.g. "your_turn", "reveal").
type Phase = "waiting" | "describing" | "sent";

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

  // Came from the QR code? Jump straight to the name field.
  useEffect(() => {
    if (urlCode) nameRef.current?.focus();
  }, [urlCode]);

  // Join is only allowed with a 4-letter code and a name.
  const canJoin = code.trim().length === 4 && name.trim().length > 0;

  function join(e: React.FormEvent) {
    e.preventDefault(); // stop the browser from reloading the page on form submit
    if (!canJoin) return;

    // FAKE: pretend the server accepted us.
    // Replace with socket.emit("join", { code, name }) once the server exists.
    setMe({ id: crypto.randomUUID(), name: name.trim(), score: 0 });
  }

  // ---------- Screens after joining ----------
  // Early returns: whichever `if` matches first is the screen that shows.

  // It's my turn: secret image, banned words, mic.
  if (me && phase === "describing") {
    return (
      <DescribeScreen
        // FAKE: the server will send the real target with a "your_turn" event.
        target={mockTarget}
        roomCode={code}
        playerId={me.id}
        onSubmitted={(r) => {
          setResult(r);
          setPhase("sent");
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
        <button onClick={() => setPhase("waiting")} className="underline opacity-60">
          Back to waiting (test)
        </button>
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
        <p className="text-lg opacity-60 animate-pulse">Waiting for the host to start…</p>

        {/* TEMP: stands in for the server's "your turn" event so you can test the
            describe screen. Remove once the socket is wired up. */}
        <button
          onClick={() => setPhase("describing")}
          className="mt-6 border-2 border-ink/20 rounded-card px-5 py-2 font-bold opacity-60"
        >
          Pretend it&apos;s my turn (test)
        </button>
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