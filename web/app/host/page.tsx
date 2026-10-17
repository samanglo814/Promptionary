// "use client" makes this run in the browser.
// Needed because we use state, timers, and window.
"use client";

// useState             = values that re-draw the screen when they change
// useEffect            = run code after the screen draws (we start the fake timer here)
// useSyncExternalStore = read something from outside React (here: the site's address) safely
import { useEffect, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { mockRoomCode, mockPlayers, mockResult, type Player } from "@/lib/mocks";
import RevealScreen from "./RevealScreen";

// The link the QR code points to. window only exists in the browser,
// so on the server useSyncExternalStore uses "" instead (and no QR is drawn yet).
const joinUrlFromWindow = () => `${window.location.origin}/play?code=${mockRoomCode}`;
// The address never changes while the page is open, so there's nothing to subscribe to.
const noSubscribe = () => () => {};

// Which screen the big screen is showing.
// Later the server decides this with socket events (e.g. "round_result").
type Phase = "lobby" | "reveal";

export default function HostPage() {
  // Players currently in the room. Starts empty, fills in over time.
  const [players, setPlayers] = useState<Player[]>([]);

  const joinUrl = useSyncExternalStore(noSubscribe, joinUrlFromWindow, () => "");

  const [phase, setPhase] = useState<Phase>("lobby");
  // Bumped every time a reveal starts. Used as RevealScreen's `key`, so React builds
  // a fresh one and the animation plays from the start again.
  const [revealCount, setRevealCount] = useState(0);

  useEffect(() => {
    // FAKE: add one mock player every 1.5 seconds so you can
    // see the list animate. Replace with a real socket event later.
    let i = 0;
    const timer = setInterval(() => {
      if (i >= mockPlayers.length) return clearInterval(timer);
      const next = mockPlayers[i++];
      setPlayers((prev) => [...prev, next]);
    }, 1500);

    return () => clearInterval(timer); // cleanup if the page closes
  }, []);

  // ---------- Reveal screen ----------
  if (phase === "reveal") {
    return (
      <>
        {/* FAKE: the server will send the real result + player with a "round_result" event */}
        <RevealScreen key={revealCount} playerName="Sam" result={mockResult} />

        {/* TEMP test controls, pinned to the bottom corner so they stay out of the way */}
        <div className="fixed bottom-4 right-4 flex gap-3 text-sm opacity-60">
          <button onClick={() => setRevealCount((n) => n + 1)} className="underline">
            Replay reveal (test)
          </button>
          <button onClick={() => setPhase("lobby")} className="underline">
            Back to lobby (test)
          </button>
        </div>
      </>
    );
  }

  // ---------- Lobby screen ----------
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 p-8">
      <h1 className="text-6xl font-black tracking-tight">Reverse Charades</h1>

      <div className="flex flex-col md:flex-row items-center gap-12">
        {/* Room code + QR */}
        <div className="bg-white rounded-card shadow-lg p-8 flex flex-col items-center gap-4">
          <p className="text-lg uppercase tracking-widest opacity-60">Room code</p>
          <p className="text-7xl font-black text-pop">{mockRoomCode}</p>
          {joinUrl && <QRCodeSVG value={joinUrl} size={200} />}
          <p className="text-sm opacity-60">Scan to join</p>
        </div>

        {/* Player list */}
        <div className="flex flex-col gap-3 min-w-64">
          <p className="text-lg uppercase tracking-widest opacity-60">
            Players ({players.length})
          </p>
          {players.length === 0 && <p className="opacity-40">Waiting for players…</p>}
          {players.map((p) => (
            <div
              key={p.id}
              className="bg-zap rounded-card px-5 py-3 text-2xl font-bold animate-[pop_0.3s_ease-out]"
            >
              {p.name}
            </div>
          ))}
        </div>
      </div>

      {/* Start button: does nothing yet, wired up once the server exists */}
      <button
        disabled={players.length < 2}
        className="bg-pop text-white text-2xl font-bold px-10 py-4 rounded-card disabled:opacity-40"
      >
        Start game
      </button>

      {/* TEMP: jump straight to a reveal with mock data so you can test the animation */}
      <button
        onClick={() => {
          setRevealCount((n) => n + 1);
          setPhase("reveal");
        }}
        className="text-sm underline opacity-60"
      >
        Test reveal
      </button>
    </main>
  );
}