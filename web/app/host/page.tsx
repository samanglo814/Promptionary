// "use client" makes this run in the browser.
// Needed because we use state, timers, and window.
"use client";

// useState             = values that re-draw the screen when they change
// useEffect            = run code after the screen draws (we start the fake timer here)
// useSyncExternalStore = read something from outside React (here: the site's address) safely
import { useEffect, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  mockRoomCode,
  mockPlayers,
  mockResult,
  mockStandings,
  mockHallOfShame,
  type Player,
} from "@/lib/mocks";
import RevealScreen from "./RevealScreen";
import Scoreboard from "./Scoreboard";
import HallOfShame from "./HallOfShame";

// The link the QR code points to. window only exists in the browser,
// so on the server useSyncExternalStore uses "" instead (and no QR is drawn yet).
const joinUrlFromWindow = () => `${window.location.origin}/play?code=${mockRoomCode}`;
// The address never changes while the page is open, so there's nothing to subscribe to.
const noSubscribe = () => () => {};

// Which screen the big screen is showing.
// Later the server decides this with socket events (e.g. "round_result", "game_over").
//   lobby      = room code, QR, players joining
//   reveal     = one round's result
//   scoreboard = ranked list between rounds
//   podium     = final results at the end of the game
//   shame      = Hall of Shame: the night's worst moments
type Phase = "lobby" | "reveal" | "scoreboard" | "podium" | "shame";

export default function HostPage() {
  // Players currently in the room. Starts empty, fills in over time.
  const [players, setPlayers] = useState<Player[]>([]);

  const joinUrl = useSyncExternalStore(noSubscribe, joinUrlFromWindow, () => "");

  const [phase, setPhase] = useState<Phase>("lobby");
  // Bumped every time a screen (re)starts. Used as the screen's `key`, so React builds
  // a fresh one and its animation plays from the start again.
  const [playCount, setPlayCount] = useState(0);

  // Switch screens and restart the new screen's animation.
  function show(next: Phase) {
    setPlayCount((n) => n + 1);
    setPhase(next);
  }

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

  // ---------- Game screens (everything except the lobby) ----------
  if (phase !== "lobby") {
    return (
      <>
        {/* FAKE: the server will send the real data with socket events */}
        {phase === "reveal" && (
          <RevealScreen key={playCount} playerName="Sam" result={mockResult} />
        )}
        {phase === "scoreboard" && (
          <Scoreboard key={playCount} standings={mockStandings} final={false} />
        )}
        {phase === "podium" && (
          <Scoreboard key={playCount} standings={mockStandings} final={true} />
        )}
        {phase === "shame" && <HallOfShame key={playCount} data={mockHallOfShame} />}

        {/* TEMP test controls, pinned to the bottom corner so they stay out of the way */}
        <div className="fixed bottom-4 right-4 flex gap-3 text-sm opacity-60">
          <button onClick={() => show(phase)} className="underline">
            Replay (test)
          </button>
          {phase === "reveal" && (
            <button onClick={() => show("scoreboard")} className="underline">
              Scoreboard (test)
            </button>
          )}
          {phase === "scoreboard" && (
            <button onClick={() => show("podium")} className="underline">
              Podium (test)
            </button>
          )}
          {phase === "podium" && (
            <button onClick={() => show("shame")} className="underline">
              Hall of Shame (test)
            </button>
          )}
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

      {/* TEMP: jump straight to any screen with mock data so you can test it */}
      <div className="flex gap-4 text-sm opacity-60">
        <button onClick={() => show("reveal")} className="underline">
          Test reveal
        </button>
        <button onClick={() => show("scoreboard")} className="underline">
          Test scoreboard
        </button>
        <button onClick={() => show("podium")} className="underline">
          Test podium
        </button>
        <button onClick={() => show("shame")} className="underline">
          Test hall of shame
        </button>
      </div>
    </main>
  );
}