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
  mockRefusedResult,
  mockStandings,
  mockHallOfShame,
  type HallOfShame as HallOfShameData,
  type Player,
  type Standing,
  type SubmitResult,
} from "@/lib/mocks";
import { SERVER_URL, connect, type GameSocket } from "@/lib/socket";
import RevealScreen from "./RevealScreen";
import Scoreboard from "./Scoreboard";
import HallOfShame from "./HallOfShame";
import StatusScreen from "./StatusScreen";
import { playBuzzer, playPop, setMuted } from "@/lib/sounds";

// The site's address, for the QR code link. window only exists in the browser,
// so on the server useSyncExternalStore uses "" instead (and no QR is drawn yet).
const originFromWindow = () => window.location.origin;
// The address never changes while the page is open, so there's nothing to subscribe to.
const noSubscribe = () => () => {};

// Which screen the big screen is showing.
// With a server, socket events decide this (e.g. "round_result", "game_over").
//   lobby      = room code, QR, players joining
//   status     = between screens: "Next up", "describing…", "the AI is drawing…"
//   reveal     = one round's result
//   scoreboard = ranked list between rounds
//   podium     = final results at the end of the game
//   shame      = Hall of Shame: the night's worst moments
type Phase = "lobby" | "status" | "reveal" | "scoreboard" | "podium" | "shame";

// What the status screen says (see StatusScreen).
type Status = { title: string; subtitle?: string; endsAt?: number; detail?: string };

export default function HostPage() {
  // Players currently in the room. Starts empty, fills in over time.
  const [players, setPlayers] = useState<Player[]>([]);
  // The room code. With a server it arrives in "room_created"; until then it's "".
  const [code, setCode] = useState(SERVER_URL ? "" : mockRoomCode);

  const origin = useSyncExternalStore(noSubscribe, originFromWindow, () => "");
  const joinUrl = origin && code ? `${origin}/play?code=${code}` : "";

  const [phase, setPhase] = useState<Phase>("lobby");
  // Bumped every time a screen (re)starts. Used as the screen's `key`, so React builds
  // a fresh one and its animation plays from the start again.
  const [playCount, setPlayCount] = useState(0);
  // What each screen shows. Mock data until the server sends the real thing.
  const [revealResult, setRevealResult] = useState<SubmitResult>(mockResult);
  const [revealName, setRevealName] = useState("Sam");
  const [standings, setStandings] = useState<Standing[]>(mockStandings);
  const [shame, setShame] = useState<HallOfShameData>(mockHallOfShame);
  const [status, setStatus] = useState<Status>({ title: "" });
  // Message from the server (e.g. "Need at least 2 players"), shown as a banner.
  const [error, setError] = useState("");
  // The live connection. null in mock mode.
  const [socket, setSocket] = useState<GameSocket | null>(null);
  // false while the connection to the server is down (it reconnects by itself).
  const [connected, setConnected] = useState(true);
  // true between clicking Start/Play again and the server answering.
  const [starting, setStarting] = useState(false);
  // Sound on/off. The state drives the button's icon; setMuted tells the sound module.
  const [muted, setMutedState] = useState(false);

  // Switch screens and restart the new screen's animation.
  function show(next: Phase) {
    setPlayCount((n) => n + 1);
    setPhase(next);
  }

  // ---------- Live mode: the server drives every screen ----------
  useEffect(() => {
    if (!SERVER_URL) return;
    const s = connect();
    // A short drop (a Wi-Fi or tunnel blip) comes back "recovered": same room, missed events replayed.
    // Anything longer and the server has closed the room, so make a new one.
    let hadRoom = false;
    s.on("connect", () => {
      setConnected(true);
      if (!s.recovered) s.emit("create_room");
    });
    s.on("disconnect", () => setConnected(false));
    s.on("room_created", ({ code }) => {
      setCode(code);
      if (hadRoom) {
        // The old room is gone, and its players with it: back to the lobby to rejoin.
        setPlayers([]);
        setPhase("lobby");
        setError("The connection dropped for too long, so this is a new room. Everyone: scan the new code!");
      }
      hadRoom = true;
    });
    s.on("players", ({ players }) => {
      setPlayers((prev) => {
        if (players.length > prev.length) playPop(); // someone joined
        return players;
      });
    });
    s.on("round_start", ({ round, totalRounds, multiplier, leader, gap }) => {
      setStatus({
        subtitle: `Round ${round} of ${totalRounds}`,
        title: multiplier > 1 ? `Points x${multiplier}!` : `Round ${round}`,
        detail: leader ? `${leader.name} leads by ${gap}. Anyone can catch up!` : "Everyone describes once. Everyone else guesses!",
      });
      show("status");
    });
    s.on("turn_intro", ({ round, turn, turnsInRound, multiplier, describer }) => {
      const bonus = multiplier > 1 ? ` · x${multiplier}` : "";
      setStatus({ subtitle: `Round ${round} · Turn ${turn} of ${turnsInRound}${bonus}`, title: `Next up: ${describer.name}` });
      show("status");
    });
    s.on("describing", ({ describer, endsAt }) => {
      setStatus({
        subtitle: "Shh! No peeking",
        title: `${describer.name} is describing…`,
        endsAt,
        detail: "Type your guess on your phone!",
      });
      show("status");
    });
    // Who has locked in a guess (never what they guessed). Updates the status screen in place.
    s.on("guesses_locked", ({ playerIds, open }) => {
      const locked = `${playerIds.length} ${playerIds.length === 1 ? "guess" : "guesses"} locked in`;
      setStatus((prev) => ({ ...prev, detail: open ? locked : `${locked}. Guessing closed!` }));
    });
    s.on("banned_buzz", () => playBuzzer());
    s.on("processing", ({ describer }) => {
      // Keep the "guesses locked in" line: guessing can still be open while the AI draws.
      setStatus((prev) => ({
        subtitle: `${describer.name}'s description is in`,
        title: "The AI is drawing… 🎨",
        detail: prev.detail,
      }));
      show("status");
    });
    s.on("round_result", ({ playerName, result }) => {
      setRevealName(playerName);
      setRevealResult(result);
      show("reveal");
    });
    s.on("scoreboard", ({ standings }) => {
      setStandings(standings);
      show("scoreboard");
    });
    s.on("game_over", ({ standings }) => {
      setStandings(standings);
      show("podium");
    });
    s.on("hall_of_shame", ({ data }) => {
      setShame(data);
      show("shame");
    });
    s.on("error", ({ message }) => setError(message));
    // Keep the connection so the buttons below can send events.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s);
    return () => {
      s.close();
    };
  }, []);

  // Ask the server to start (or restart) the game. The server answers, so a click that never
  // arrives (the connection is down) shows an error instead of doing nothing.
  function startGame() {
    if (!socket || starting) return;
    setError("");
    if (!socket.connected) {
      setError("Not connected to the game server. Check the connection, then try again.");
      return;
    }
    setStarting(true);
    socket.timeout(5_000).emit("start_game", (err) => {
      setStarting(false);
      // A refusal (e.g. "Need at least 2 players") arrives as an "error" event too, shown above.
      if (err) setError("The game server didn't answer. Check the connection, or refresh this page.");
    });
  }

  // ---------- Mock mode ----------
  useEffect(() => {
    if (SERVER_URL) return;
    // FAKE: add one mock player every 1.5 seconds so you can
    // see the list animate.
    let i = 0;
    const timer = setInterval(() => {
      if (i >= mockPlayers.length) return clearInterval(timer);
      const next = mockPlayers[i++];
      setPlayers((prev) => [...prev, next]);
      playPop(); // silent until someone has clicked the page once (browser rule)
    }, 1500);

    return () => clearInterval(timer); // cleanup if the page closes
  }, []);

  // Mute toggle, pinned to the top-right corner of every host screen.
  // Defined once here and dropped into both returns below.
  const muteButton = (
    <button
      onClick={() => {
        setMuted(!muted); // tell the sound module
        setMutedState(!muted); // update the icon
      }}
      className="fixed top-4 right-4 text-2xl opacity-60 hover:opacity-100"
      aria-label={muted ? "Unmute sounds" : "Mute sounds"}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );

  // ---------- Game screens (everything except the lobby) ----------
  if (phase !== "lobby") {
    return (
      <>
        {muteButton}
        {phase === "status" && <StatusScreen key={playCount} {...status} />}
        {phase === "reveal" && (
          <RevealScreen key={playCount} playerName={revealName} result={revealResult} />
        )}
        {phase === "scoreboard" && (
          <Scoreboard key={playCount} standings={standings} final={false} />
        )}
        {phase === "podium" && <Scoreboard key={playCount} standings={standings} final={true} />}
        {phase === "shame" && <HallOfShame key={playCount} data={shame} />}

        {/* Live mode: host controls, pinned to the bottom corner */}
        {socket && (
          <div className="fixed bottom-4 right-4 flex gap-3 text-sm opacity-60">
            {(phase === "reveal" || phase === "scoreboard" || phase === "podium") && (
              <button onClick={() => socket.emit("next")} className="underline">
                Skip ▶
              </button>
            )}
            {phase === "shame" && (
              <button onClick={startGame} disabled={starting} className="underline">
                {starting ? "Starting…" : "Play again"}
              </button>
            )}
          </div>
        )}
        {(error || !connected) && (
          <p className="fixed top-4 left-1/2 -translate-x-1/2 bg-pop text-white font-bold px-5 py-2 rounded-card">
            {connected ? error : "Connection lost. Reconnecting…"}
          </p>
        )}

        {/* TEMP test controls (mock mode only), pinned to the bottom corner so they stay out of the way */}
        {!socket && (
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
        )}
      </>
    );
  }

  // ---------- Lobby screen ----------
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 p-8">
      {muteButton}
      <h1 className="text-6xl font-black tracking-tight">Reverse Charades</h1>

      <div className="flex flex-col md:flex-row items-center gap-12">
        {/* Room code + QR */}
        <div className="bg-white rounded-card shadow-lg p-8 flex flex-col items-center gap-4">
          <p className="text-lg uppercase tracking-widest opacity-60">Room code</p>
          <p className="text-7xl font-black text-pop">{code || "····"}</p>
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

      {!connected && <p className="text-pop font-bold">Connection lost. Reconnecting…</p>}
      {error && <p className="text-pop font-bold">{error}</p>}

      <button
        onClick={startGame}
        disabled={players.length < 2 || starting}
        className="bg-pop text-white text-2xl font-bold px-10 py-4 rounded-card disabled:opacity-40"
      >
        Start game
      </button>

      {/* TEMP: jump straight to any screen with mock data so you can test it (mock mode only) */}
      {!socket && (
        <div className="flex gap-4 text-sm opacity-60">
          <button
            onClick={() => {
              setRevealResult(mockResult);
              show("reveal");
            }}
            className="underline"
          >
            Test reveal
          </button>
          <button
            onClick={() => {
              setRevealResult(mockRefusedResult);
              show("reveal");
            }}
            className="underline"
          >
            Test refusal
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
      )}
    </main>
  );
}