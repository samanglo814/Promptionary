// "use client" makes this run in the browser.
// Needed because we use state, timers, and window.
"use client";

// useState             = values that re-draw the screen when they change
// useEffect            = run code after the screen draws (we start the fake timer here)
// useSyncExternalStore = read something from outside React (here: the site's address) safely
import { useEffect, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  mockAwards,
  mockBreakdown,
  mockGuesses,
  mockRoomCode,
  mockPlayers,
  mockResult,
  mockRefusedResult,
  mockStandings,
  mockHallOfShame,
  type Award,
  type GuessResult,
  type HallOfShame as HallOfShameData,
  type Player,
  type PrompterBreakdown,
  type Standing,
  type SubmitResult,
} from "@/lib/mocks";
import { SERVER_URL, connect, type GameSocket } from "@/lib/socket";
import { Avatar, Badge, Button, Label, TextButton } from "@/components/ui";
import HostShell from "./HostShell";
import RevealScreen from "./RevealScreen";
import Scoreboard from "./Scoreboard";
import HallOfShame from "./HallOfShame";
import { Describing, Processing, RoundIntro, TurnIntro } from "./StageScreens";
import { playBuzzer, playPop, setMuted } from "@/lib/sounds";

// The site's address, for the QR code link. window only exists in the browser,
// so on the server useSyncExternalStore uses "" instead (and no QR is drawn yet).
const originFromWindow = () => window.location.origin;
// The address never changes while the page is open, so there's nothing to subscribe to.
const noSubscribe = () => () => {};

const MAX_PLAYERS = 8;
const TOTAL_ROUNDS = 2;

// Which screen the big screen is showing.
// With a server, socket events decide this (e.g. "round_result", "game_over").
//   lobby       = room code, QR, players joining
//   round       = "Round 2 · points x1.5"
//   turn        = "Next up: Sam"
//   describing  = Sam talks, everyone else guesses
//   processing  = the AI is drawing
//   reveal      = one turn's result
//   scoreboard  = ranked list between turns
//   podium      = final results at the end of the game
//   shame       = Hall of Shame: the night's worst moments
type Phase = "lobby" | "round" | "turn" | "describing" | "processing" | "reveal" | "scoreboard" | "podium" | "shame";

// Where we are in the game, for the header and the intro screens.
type Progress = { round: number; totalRounds: number; turn: number; turnsInRound: number; multiplier: number };

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

  // ---------- What each screen shows. Mock data until the server sends the real thing. ----------
  const [progress, setProgress] = useState<Progress>({ round: 2, totalRounds: TOTAL_ROUNDS, turn: 1, turnsInRound: 3, multiplier: 1.5 });
  const [roundLeader, setRoundLeader] = useState<{ leader: Player | null; gap: number }>({ leader: mockPlayers[0], gap: 480 });
  const [describer, setDescriber] = useState<Player>(mockPlayers[0]);
  const [endsAt, setEndsAt] = useState<number | undefined>(undefined);
  const [guessEndsAt, setGuessEndsAt] = useState<number | undefined>(undefined);
  // Who has locked in a guess this turn (never what they guessed), and whether guessing is still open.
  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const [guessOpen, setGuessOpen] = useState(true);
  // Changes on every banned-word buzz, which flashes the screen edge.
  const [buzz, setBuzz] = useState(0);
  const [revealResult, setRevealResult] = useState<SubmitResult>(mockResult);
  const [revealName, setRevealName] = useState("Sam");
  const [breakdown, setBreakdown] = useState<PrompterBreakdown | null>(mockBreakdown);
  const [guesses, setGuesses] = useState<GuessResult[]>(mockGuesses);
  const [standings, setStandings] = useState<Standing[]>(mockStandings);
  // Each player's rank before the latest scoreboard, for the ▲ / ▼ arrows.
  const [prevRanks, setPrevRanks] = useState<Record<string, number>>({});
  const [awards, setAwards] = useState<Award[]>(mockAwards);
  const [shame, setShame] = useState<HallOfShameData>(mockHallOfShame);
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
  // Who's hosting, when they signed in with Auth0 (see proxy.ts). Stays "" when sign-in is off.
  const [hostName, setHostName] = useState("");

  useEffect(() => {
    // Auth0's /auth/profile answers with the signed-in user, or an error when there's no session
    // or sign-in is off; either way the header just leaves the name out.
    fetch("/auth/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((user: { given_name?: string; name?: string; nickname?: string } | null) => {
        if (user) setHostName(user.given_name || user.nickname || user.name || "");
      })
      .catch(() => {});
  }, []);

  // Switch screens and restart the new screen's animation.
  function show(next: Phase) {
    // Mock mode: give the describing screen a clock to count down.
    if (!SERVER_URL && next === "describing") {
      setEndsAt(Date.now() + 20_000);
      setGuessEndsAt(Date.now() + 25_000);
    }
    setPlayCount((n) => n + 1);
    setPhase(next);
  }

  // A new scoreboard: remember everyone's old rank first, so rows can show how they moved.
  function updateStandings(next: Standing[]) {
    setStandings((prev) => {
      setPrevRanks(Object.fromEntries(prev.map((p) => [p.id, p.rank])));
      return next;
    });
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
      setProgress((p) => ({ ...p, round, totalRounds, multiplier, turn: 0 }));
      setRoundLeader({ leader, gap });
      // A new game starts at round 1: forget the last game's ranks.
      if (round === 1) setPrevRanks({});
      show("round");
    });
    s.on("turn_intro", ({ round, totalRounds, turn, turnsInRound, multiplier, describer }) => {
      setProgress({ round, totalRounds, turn, turnsInRound, multiplier });
      setDescriber(describer);
      setLockedIds([]);
      setGuessOpen(true);
      show("turn");
    });
    s.on("describing", ({ describer, endsAt, guessEndsAt }) => {
      setDescriber(describer);
      setEndsAt(endsAt);
      setGuessEndsAt(guessEndsAt);
      show("describing");
    });
    // Who has locked in a guess (never what they guessed). Updates the screen in place.
    s.on("guesses_locked", ({ playerIds, open }) => {
      setLockedIds(playerIds);
      setGuessOpen(open);
    });
    s.on("banned_buzz", () => {
      playBuzzer();
      setBuzz(Date.now());
    });
    s.on("processing", ({ describer }) => {
      setDescriber(describer);
      show("processing");
    });
    s.on("round_result", ({ playerName, result, breakdown, guesses }) => {
      setRevealName(playerName);
      setRevealResult(result);
      setBreakdown(breakdown);
      setGuesses(guesses);
      show("reveal");
    });
    s.on("scoreboard", ({ standings }) => {
      updateStandings(standings);
      show("scoreboard");
    });
    s.on("game_over", ({ standings, awards }) => {
      updateStandings(standings);
      setAwards(awards);
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
    // FAKE: add one mock player every 1.5 seconds so you can see the roster fill in.
    let i = 0;
    const timer = setInterval(() => {
      if (i >= mockPlayers.length) return clearInterval(timer);
      const next = mockPlayers[i++];
      setPlayers((prev) => [...prev, next]);
      playPop(); // silent until someone has clicked the page once (browser rule)
    }, 1500);

    return () => clearInterval(timer); // cleanup if the page closes
  }, []);

  // ---------- Header and footer text ----------
  const inGame = phase !== "lobby" && phase !== "shame";
  const context =
    phase === "lobby"
      ? `${TOTAL_ROUNDS} rounds · everyone describes once per round`
      : phase === "shame"
        ? "The night in review"
        : phase === "podium"
          ? "Final results"
          : progress.turn > 0
            ? `Round ${progress.round} / ${progress.totalRounds} · Turn ${progress.turn} / ${progress.turnsInRound}${progress.multiplier > 1 ? ` · x${progress.multiplier}` : ""}`
            : `Round ${progress.round} / ${progress.totalRounds}`;
  const footer = `${players.length} ${players.length === 1 ? "player" : "players"} / ${TOTAL_ROUNDS} rounds / everyone describes once per round`;
  // Everyone except the describer guesses.
  const guessers = players.filter((p) => p.id !== describer.id);

  return (
    <HostShell
      context={context}
      code={code}
      muted={muted}
      onToggleMute={() => {
        setMuted(!muted); // tell the sound module
        setMutedState(!muted); // update the icon
      }}
      footer={footer}
      hostName={hostName}
      buzz={phase === "describing" || phase === "processing" ? buzz : undefined}
    >
      {phase === "lobby" && (
        <Lobby
          code={code}
          joinUrl={joinUrl}
          players={players}
          canStart={players.length >= 2}
          onStart={socket ? startGame : () => show("round")}
        />
      )}
      {phase === "round" && <RoundIntro key={playCount} {...progress} {...roundLeader} />}
      {phase === "turn" && <TurnIntro key={playCount} describer={describer} {...progress} />}
      {phase === "describing" && (
        <Describing key={playCount} describer={describer} endsAt={endsAt} guessers={guessers} lockedIds={lockedIds} guessOpen={guessOpen} />
      )}
      {phase === "processing" && (
        <Processing key={playCount} describer={describer} guessEndsAt={guessEndsAt} guessers={guessers} lockedIds={lockedIds} guessOpen={guessOpen} />
      )}
      {phase === "reveal" && (
        <RevealScreen key={playCount} playerName={revealName} result={revealResult} breakdown={breakdown} guesses={guesses} />
      )}
      {phase === "scoreboard" && <Scoreboard key={playCount} standings={standings} prevRanks={prevRanks} final={false} />}
      {phase === "podium" && <Scoreboard key={playCount} standings={standings} prevRanks={prevRanks} awards={awards} final={true} />}
      {phase === "shame" && <HallOfShame key={playCount} data={shame} />}

      {/* Live mode: host controls, pinned to the bottom corner */}
      {socket && inGame && (phase === "reveal" || phase === "scoreboard" || phase === "podium") && (
        <div className="fixed bottom-14 right-12">
          <TextButton onClick={() => socket.emit("next")}>Skip ▶</TextButton>
        </div>
      )}
      {socket && phase === "shame" && (
        <div className="fixed bottom-14 right-12 w-64">
          <Button onClick={startGame} disabled={starting}>
            {starting ? "Starting…" : "Play again →"}
          </Button>
        </div>
      )}

      {(error || !connected) && (
        <p className="fixed left-1/2 top-24 z-40 -translate-x-1/2 rounded-inner bg-ai px-5 py-2.5 font-bold text-stage">
          {connected ? error : "Connection lost. Reconnecting…"}
        </p>
      )}

      {/* TEMP test controls (mock mode only), so every screen can be checked without a server */}
      {!socket && phase !== "lobby" && (
        <div className="fixed bottom-14 right-12 flex gap-4">
          <TextButton onClick={() => show(phase)}>Replay</TextButton>
          {NEXT_TEST_PHASE[phase] && <TextButton onClick={() => show(NEXT_TEST_PHASE[phase]!)}>Next screen</TextButton>}
          <TextButton onClick={() => setPhase("lobby")}>Lobby</TextButton>
        </div>
      )}
      {!socket && phase === "lobby" && (
        <div className="fixed bottom-14 left-12 flex gap-4">
          <TextButton
            onClick={() => {
              setRevealResult(mockResult);
              show("reveal");
            }}
          >
            Test reveal
          </TextButton>
          <TextButton
            onClick={() => {
              setRevealResult(mockRefusedResult);
              show("reveal");
            }}
          >
            Test refusal
          </TextButton>
        </div>
      )}
    </HostShell>
  );
}

// Mock mode's "Next screen" button walks through the whole game in order.
const NEXT_TEST_PHASE: Partial<Record<Phase, Phase>> = {
  round: "turn",
  turn: "describing",
  describing: "processing",
  processing: "reveal",
  reveal: "scoreboard",
  scoreboard: "podium",
  podium: "shame",
};

// ---------- Lobby ----------

const STEPS = [
  { title: "One secret.", text: "Only the describer sees it." },
  { title: "Everyone guesses.", text: "Listen, type, lock one guess." },
  { title: "Points for you.", text: "Accuracy first. Speed helps." },
];

function Lobby({
  code,
  joinUrl,
  players,
  canStart,
  onStart,
}: {
  code: string;
  joinUrl: string;
  players: Player[];
  canStart: boolean;
  onStart: () => void;
}) {
  // The address to type in, without "https://", for anyone who can't scan.
  const shortUrl = joinUrl.replace(/^https?:\/\//, "").replace(/\?.*$/, "");
  const emptySlots = Math.max(0, Math.min(MAX_PLAYERS, Math.max(4, players.length + 1)) - players.length);

  return (
    <div className="flex flex-1 gap-8">
      {/* Left: the pitch and how to play */}
      <div className="flex flex-1 flex-col justify-center gap-6">
        <div className="flex gap-2.5">
          <Badge tone="human">Humans vs. AI</Badge>
          <Badge tone="ai">Individual points</Badge>
        </div>
        <h1 className="font-display text-[96px] leading-[1.02]">
          A little art.
          <br />
          A lot of chaos.
        </h1>
        <p className="text-2xl">Describe it. Guess it. Outsmart the machine.</p>
        <ol className="mt-6 grid grid-cols-3 gap-6 border-t-2 border-line pt-6">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-2">
              <span className="text-xs font-extrabold text-action-edge">0{i + 1} /</span>
              <span className="font-display text-[26px] leading-none">{step.title}</span>
              <span className="text-[15px] text-muted">{step.text}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Right: how to join, who's in, start */}
      <div className="flex w-[490px] shrink-0 flex-col justify-center gap-[18px]">
        <div className="flex items-center gap-6 rounded-panel border-2 border-action bg-panel p-6">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-lg">Grab your phone. Join the room.</p>
            <p className="font-display text-[88px] leading-none tracking-wide text-point">{code || "····"}</p>
            <p className="truncate text-sm text-muted">{shortUrl || "Starting the room…"}</p>
          </div>
          {/* QR codes need a light background to scan, so it gets a white tile. */}
          <div className="shrink-0 rounded-inner bg-text p-2.5">
            {joinUrl ? <QRCodeSVG value={joinUrl} size={150} bgColor="#f8f8fc" fgColor="#101018" /> : <div className="size-[150px]" />}
          </div>
        </div>

        <div className="flex justify-between text-xs font-extrabold uppercase">
          <span>The usual suspects</span>
          <span className="text-point">
            {players.length} / {MAX_PLAYERS} in
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {players.map((p) => (
            <div key={p.id} className="flex flex-col items-center gap-2 rounded-[18px] bg-panel p-3 animate-[pop_0.3s_ease-out]">
              <Avatar id={p.id} name={p.name} />
              <span className="max-w-full truncate text-[15px] font-bold">{p.name}</span>
              <span className="text-[11px] text-point">✓ Ready</span>
            </div>
          ))}
          {Array.from({ length: emptySlots }, (_, i) => (
            <div key={i} className="flex min-h-[110px] items-center justify-center rounded-[18px] border-2 border-dashed border-line text-xs text-dim">
              Open seat
            </div>
          ))}
        </div>

        <p className="text-[15px] text-muted">
          {TOTAL_ROUNDS} rounds. Everyone describes once per round
          {players.length >= 2 ? `: ${players.length * TOTAL_ROUNDS} turns tonight.` : "."}
        </p>
        <Label>Host controls</Label>
        <Button onClick={onStart} disabled={!canStart}>
          {canStart ? "Everybody in? Let's play →" : "Waiting for at least 2 players"}
        </Button>
      </div>
    </div>
  );
}
