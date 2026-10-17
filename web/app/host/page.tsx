// "use client" makes this run in the browser.
// Needed because we use state, timers, and window.
"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { mockRoomCode, mockPlayers, type Player } from "@/lib/mocks";

export default function HostLobby() {
  // Players currently in the room. Starts empty, fills in over time.
  const [players, setPlayers] = useState<Player[]>([]);

  // The link the QR code points to. Built in the browser
  // because window doesn't exist on the server.
  const [joinUrl, setJoinUrl] = useState("");

  useEffect(() => {
    setJoinUrl(`${window.location.origin}/play?code=${mockRoomCode}`);

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
    </main>
  );
}