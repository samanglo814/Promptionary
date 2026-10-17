// "use client" makes this run in the browser.
// Needed because we use state, form input, and window.
"use client";

// useState             = values that re-draw the screen when they change
// useRef               = a handle on a real DOM element (we use it to focus the name box)
// useEffect            = run code after the screen draws
// useSyncExternalStore = read something from outside React (here: the URL) safely
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { warmUpMic } from "@/lib/mic";
import {
  mockBreakdown,
  mockGuesses,
  mockResult,
  mockTarget,
  type Award,
  type GuessResult,
  type Player,
  type PrompterBreakdown,
  type SubmitResult,
  type Target,
} from "@/lib/mocks";
import { SERVER_URL, connect, guessErrorText, joinErrorText, type GameSocket } from "@/lib/socket";
import { Avatar, Button, Delta, Label, Panel, TextButton, type Tone } from "@/components/ui";
import DescribeScreen from "./DescribeScreen";
import GuessScreen from "./GuessScreen";
import { hasSpeechToText } from "./MicRecorder";
import PhoneShell from "./PhoneShell";

// Read ?code= from the URL. Only works in the browser (window doesn't exist on the
// server), so useSyncExternalStore below uses "" on the server and this in the browser.
const codeFromUrl = () =>
  (new URLSearchParams(window.location.search).get("code") ?? "").toUpperCase().slice(0, 4);
// The URL never changes while you're on this page, so there's nothing to subscribe to.
const noSubscribe = () => () => {};

// Which screen the phone is showing after joining.
// With a server, socket events decide this (e.g. "your_turn", "turn_intro").
//   waiting    = between things: "Get ready to guess", "The AI is drawing…"
//   describing = my turn: secret image + mic
//   sent       = I've described it
//   guessing   = someone else's turn: type one guess
//   result     = my points for the turn that was just revealed
//   standing   = where I am on the scoreboard
//   final      = game over: my final rank and points
type Phase = "waiting" | "describing" | "sent" | "guessing" | "result" | "standing" | "final";

// What the waiting screen says.
type Waiting = { label: string; title: string; text: string; tone?: Tone };

// My points for one turn: as the describer, or as a guesser (guess is null if I didn't guess).
type Receipt =
  | { kind: "describer"; breakdown: PrompterBreakdown | null; score: number; caption: string }
  | { kind: "guesser"; describerName: string; guess: GuessResult | null; caption: string };

// Where I am on the scoreboard. gap = points behind the player one place up (0 if I lead).
type MyStanding = { rank: number; score: number; players: number; gap: number; aheadName: string; lastTurn: number; tied: boolean };

// Game over, from my side.
type FinalSummary = MyStanding & { prompterPoints: number; spectatorPoints: number; awards: Award[] };

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
  const [waiting, setWaiting] = useState<Waiting>(LOBBY_WAITING);
  // "R1 / 2" in the corner, once the game starts.
  const [round, setRound] = useState<{ round: number; totalRounds: number } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [standing, setStanding] = useState<MyStanding | null>(null);
  const [final, setFinal] = useState<FinalSummary | null>(null);
  // Why joining failed (or why the game ended), shown on the join form.
  const [joinError, setJoinError] = useState("");
  // Guessing on someone else's turn: who's describing, when guessing closes, and my locked-in guess.
  const [describerName, setDescriberName] = useState("");
  const [guessEndsAt, setGuessEndsAt] = useState<number | undefined>(undefined);
  // The guess clock only starts once the describer says their first word.
  const [guessClockStarted, setGuessClockStarted] = useState(false);
  const [lockedGuess, setLockedGuess] = useState<{ text: string; speed: number } | null>(null);
  const [guessSending, setGuessSending] = useState(false);
  const [guessError, setGuessError] = useState("");

  useEffect(() => {
    if (!SERVER_URL) return;
    const s = connect();
    // The player's id and name, once joined. Plain variables so every handler below sees the latest ones.
    let myId: string | null = null;
    let myName = "";
    // True while an automatic rejoin is in flight, so its failure can be silent.
    let rejoining = false;
    // True once my guess for this turn is locked in. A plain variable for the same reason as myId.
    let guessed = false;

    // On first connect, and again after any reconnect (new socket), rejoin if we were in a room.
    // A saved session for a different room (e.g. scanned a new QR code) is ignored.
    // A short drop (e.g. a locked screen) comes back "recovered": same connection, missed events
    // replayed, nothing to do.
    s.on("connect", () => {
      if (s.recovered) return;
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
      myName = player.name;
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
    s.on("round_start", ({ round, totalRounds, multiplier, leader, gap }) => {
      setRound({ round, totalRounds });
      setPhase("waiting");
      setWaiting({
        label: `Round ${round} of ${totalRounds}`,
        title: multiplier > 1 ? `Round ${round}. Points x${multiplier}.` : `Round ${round}.`,
        text:
          leader && gap > 0
            ? `${leader.id === myId ? "You lead" : `${leader.name} leads`} by ${gap.toLocaleString()}. Anyone can catch up.`
            : "Everyone describes once. Everyone else guesses.",
        tone: multiplier > 1 ? "point" : "human",
      });
    });
    s.on("turn_intro", ({ round, totalRounds, describer }) => {
      setRound({ round, totalRounds });
      setPhase("waiting");
      guessed = false;
      setLockedGuess(null);
      setGuessSending(false);
      setGuessError("");
      setWaiting(
        describer.id === myId
          ? {
              label: "You're up",
              title: "Your turn. Get ready.",
              text: "Your secret image is coming. Describe it out loud, and don't say the banned words.",
              tone: "action",
            }
          : {
              label: `${describer.name} is up`,
              title: "Get ready to guess.",
              text: `Listen to ${describer.name}, then lock in one guess. Faster is worth more.`,
              tone: "human",
            },
      );
    });
    s.on("describing", ({ describer, guessEndsAt, guessClockStarted }) => {
      if (describer.id === myId) return;
      setDescriberName(describer.name);
      setGuessEndsAt(guessEndsAt);
      setGuessClockStarted(guessClockStarted);
      setPhase("guessing");
    });
    s.on("guess_clock", ({ guessEndsAt }) => {
      setGuessEndsAt(guessEndsAt);
      setGuessClockStarted(true);
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
      // Guessing closed. Keep showing a locked-in guess; otherwise say so.
      if (open || guessed) return;
      setPhase((p) => (p === "guessing" ? "waiting" : p));
      setWaiting({ label: "Guessing closed", title: "No guess. 0 points.", text: "Look at the big screen for the reveal.", tone: "ai" });
    });
    s.on("processing", ({ describer }) => {
      if (describer.id === myId) return;
      // Still guessing? Keep the guess screen. Otherwise, point at the big screen.
      setPhase((p) => (p === "guessing" ? p : "waiting"));
      setWaiting((w) =>
        w.title === "No guess. 0 points."
          ? w
          : { label: "What AI heard", title: "The AI is drawing…", text: "Look at the big screen.", tone: "ai" },
      );
    });
    s.on("round_result", ({ playerName, result, breakdown, guesses }) => {
      // My turn ran out before I sent anything, or guessing is over: show my points for this turn.
      setReceipt(
        playerName === myName
          ? { kind: "describer", breakdown, score: result.score, caption: result.caption }
          : { kind: "guesser", describerName: playerName, guess: guesses.find((g) => g.playerId === myId) ?? null, caption: result.caption },
      );
      setPhase("result");
    });
    s.on("scoreboard", ({ standings }) => {
      const mine = myStanding(standings, myId);
      if (mine) setStanding(mine);
      setPhase("standing");
    });
    s.on("game_over", ({ standings, awards }) => {
      const mine = myStanding(standings, myId);
      const me = standings.find((p) => p.id === myId);
      if (mine && me) {
        setFinal({
          ...mine,
          prompterPoints: me.prompterPoints,
          spectatorPoints: me.spectatorPoints,
          awards: awards.filter((a) => a.playerName === myName),
        });
      }
      setPhase("final");
    });
    s.on("error", ({ message }) => {
      // Players only get this when the host left: the room is gone, so back to the join form.
      saveSession(null);
      setMe(null);
      setPhase("waiting");
      setWaiting(LOBBY_WAITING);
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
    // Unlock audio now, during the tap. Phones that record audio (no speech-to-text) also get asked
    // for the mic now, so the popup doesn't eat into anyone's turn.
    warmUpMic({ openMic: !hasSpeechToText() });

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
  // Every screen sits in the same phone frame: brand on the left, round and room on the right.
  const context = round ? `R${round.round} / ${round.totalRounds} · ${code}` : code;
  return <PhoneShell context={me ? context : undefined}>{screen()}</PhoneShell>;

  // Early returns: whichever `if` matches first is the screen that shows.
  function screen() {
    // It's my turn: secret image, banned words, mic.
    if (me && phase === "describing") {
      return (
        <DescribeScreen
          myName={me.name}
          // From "your_turn" (mockTarget in mock mode).
          target={target}
          roomCode={code}
          playerId={me.id}
          endsAt={endsAt}
          onSpeaking={() => socket?.emit("speaking")}
          onSubmitted={(r) => {
            setResult(r);
            // The reveal can arrive before /submit answers (everyone locked in fast).
            // Only show "Sent!" if the result screen hasn't already taken over.
            setPhase((p) => (p === "describing" ? "sent" : p));
          }}
        />
      );
    }

    // Someone else's turn: guess what they're describing (or show my locked-in guess).
    if (me && phase === "guessing") {
      return (
        <GuessScreen
          myName={me.name}
          describerName={describerName}
          guessEndsAt={guessEndsAt}
          // Mock mode has no describer, so the clock just runs.
          clockStarted={guessClockStarted || !socket}
          locked={lockedGuess}
          sending={guessSending}
          error={guessError}
          onGuess={(text) => {
            setGuessError("");
            setGuessSending(true);
            if (socket) socket.emit("guess", { text });
            // FAKE (mock mode): lock it in right away.
            else {
              setLockedGuess({ text, speed: 92 });
              setGuessSending(false);
            }
          }}
        />
      );
    }

    // I've described it: point everyone at the big screen for the reveal.
    if (me && phase === "sent") {
      return (
        <StateScreen label={`${me.name} · Describer`} tone="action" title="Sent! Look at the big screen." text="The AI is drawing what it heard. Fingers crossed.">
          {/* Mock mode only: shows what /submit sent back, so you can check it worked. */}
          {!socket && result && (
            <Panel className="text-sm text-muted">
              “{result.transcript}” → {result.score}% · {result.caption}
            </Panel>
          )}
        </StateScreen>
      );
    }

    // My points for the turn that was just revealed.
    if (me && phase === "result" && receipt) return <ReceiptScreen receipt={receipt} />;

    // Where I am after the turn.
    if (me && phase === "standing" && standing) return <StandingScreen standing={standing} />;

    // Game over.
    if (me && phase === "final" && final) return <FinalScreen final={final} />;

    // Joined, waiting for the host (or for my turn).
    if (me) {
      const inLobby = waiting === LOBBY_WAITING;
      return (
        <>
          {inLobby ? (
            <div className="flex flex-col items-center gap-4 pt-6 text-center">
              <Avatar id={me.id} name={me.name} size={96} />
              <Label tone="point">Room {code} · ✓ Ready</Label>
              <h1 className="font-display text-[44px] leading-[1.04]">You&apos;re in, {me.name}.</h1>
              <p className="text-[15px] text-muted">{waiting.text}</p>
              <Panel className="mt-4 flex w-full flex-col gap-3 text-left">
                <Label>How it works</Label>
                <p className="text-[15px] leading-relaxed">
                  <span className="font-bold text-action-edge">Your turn:</span> describe the secret image out loud. Don&apos;t say the banned words.
                </p>
                <p className="text-[15px] leading-relaxed">
                  <span className="font-bold text-human">Everyone else&apos;s turn:</span> listen, type one guess, lock it in. Faster is worth more.
                </p>
              </Panel>
            </div>
          ) : (
            <StateScreen {...waiting} />
          )}

          {/* Mock mode only: stand-ins for the server's events, so each phone screen can be checked. */}
          {!socket && (
            <div className="mt-auto flex flex-wrap justify-center gap-x-4 gap-y-2 pt-6">
              <TextButton onClick={() => setPhase("describing")}>Test: my turn</TextButton>
              <TextButton
                onClick={() => {
                  setDescriberName("Jordan");
                  setGuessEndsAt(Date.now() + 25_000);
                  setLockedGuess(null);
                  setPhase("guessing");
                }}
              >
                Test: guessing
              </TextButton>
              <TextButton
                onClick={() => {
                  setReceipt({ kind: "guesser", describerName: "Sam", guess: { ...mockGuesses[0], playerName: me.name }, caption: mockResult.caption });
                  setPhase("result");
                }}
              >
                Test: guess result
              </TextButton>
              <TextButton
                onClick={() => {
                  setReceipt({ kind: "describer", breakdown: mockBreakdown, score: mockResult.score, caption: mockResult.caption });
                  setPhase("result");
                }}
              >
                Test: my turn result
              </TextButton>
              <TextButton
                onClick={() => {
                  setStanding({ rank: 3, score: 1420, players: 5, gap: 210, aheadName: "Charisse", lastTurn: 190, tied: false });
                  setPhase("standing");
                }}
              >
                Test: standing
              </TextButton>
              <TextButton
                onClick={() => {
                  setFinal({
                    rank: 1,
                    score: 1880,
                    players: 5,
                    gap: 0,
                    aheadName: "",
                    lastTurn: 0,
                    tied: false,
                    prompterPoints: 1600,
                    spectatorPoints: 280,
                    awards: [{ title: "Sharpest guesser", playerName: me.name, imageUrl: "" }],
                  });
                  setPhase("final");
                }}
              >
                Test: final
              </TextButton>
            </div>
          )}
        </>
      );
    }

    // ---------- Join form (not joined yet) ----------
    return (
      <>
        <Label tone="human" className="pt-4">
          Humans vs. AI · Party game
        </Label>
        <h1 className="font-display text-[52px] leading-[1.02]">Join the chaos.</h1>
        <p className="text-[15px] text-muted">Describe it. Guess it. Outsmart the machine.</p>

        {/* onSubmit fires on the Join button AND on pressing Enter/Go on the keyboard */}
        <form onSubmit={join} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-2 rounded-panel border-[1.5px] border-line bg-panel p-[18px] focus-within:border-point">
            <Label>Room code</Label>
            <input
              value={code}
              onChange={(e) => setTypedCode(e.target.value.toUpperCase())}
              maxLength={4}
              autoCapitalize="characters" // phone keyboard starts in caps
              autoComplete="off" // no browser autofill suggestions
              placeholder="ABCD"
              className="w-full bg-transparent font-display text-[56px] leading-none tracking-[0.12em] text-point outline-none placeholder:text-line"
            />
          </label>

          <label className="flex flex-col gap-2 rounded-panel border-[1.5px] border-line bg-panel p-[18px] focus-within:border-human">
            <Label>Your name</Label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={16}
              autoComplete="off"
              ref={nameRef}
              placeholder="Sam"
              className="w-full bg-transparent text-[26px] font-bold text-text outline-none placeholder:text-line"
            />
          </label>

          {joinError && <p className="text-center font-bold text-ai">{joinError}</p>}

          <Button type="submit" disabled={!canJoin}>
            Join the room →
          </Button>
          <p className="text-center text-[13px] text-muted">No account. No artistic ability required.</p>
        </form>
      </>
    );
  }
}

// What the waiting screen says before the game starts. Compared by identity to tell the lobby apart.
const LOBBY_WAITING: Waiting = { label: "Lobby", title: "", text: "Waiting for the host to start…" };

// My place in the standings, and how far behind the next player up I am.
function myStanding(standings: { id: string; name: string; score: number; rank: number; lastTurn: number }[], myId: string | null): MyStanding | null {
  const sorted = [...standings].sort((a, b) => a.rank - b.rank);
  const i = sorted.findIndex((p) => p.id === myId);
  if (i < 0) return null;
  const me = sorted[i];
  // The closest player above me with more points (ties share a rank).
  const ahead = sorted
    .slice(0, i)
    .reverse()
    .find((p) => p.score > me.score);
  return {
    rank: me.rank,
    score: me.score,
    players: sorted.length,
    gap: ahead ? ahead.score - me.score : 0,
    aheadName: ahead?.name ?? "",
    lastTurn: me.lastTurn,
    // Someone else shares my rank.
    tied: sorted.some((p) => p.id !== me.id && p.rank === me.rank),
  };
}

// ---------- Small full-screen states: label, big title, a line of text ----------

function StateScreen({ label, title, text, tone = "human", children }: Waiting & { children?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 pb-16">
      <Label tone={tone}>{label}</Label>
      <h1 className="font-display text-[44px] leading-[1.04]">{title}</h1>
      <p className="text-[17px] leading-relaxed text-muted">{text}</p>
      {children}
    </div>
  );
}

// ---------- My points for one turn ----------

function ReceiptScreen({ receipt }: { receipt: Receipt }) {
  if (receipt.kind === "describer") {
    const b = receipt.breakdown;
    const lines = b
      ? [
          { label: `Accuracy · ${receipt.score}% match`, value: b.accuracy },
          { label: "Clarity · how well they guessed", value: b.clarity },
          { label: "Speed bonus", value: b.speed },
          ...(b.bannedPenalty > 0 ? [{ label: "Banned words", value: -b.bannedPenalty }] : []),
        ]
      : [];
    return (
      <>
        <Label tone="action">Your turn · score receipt</Label>
        <h1 className="font-display text-[40px] leading-[1.04]">{b ? `+${b.total.toLocaleString()} points.` : `${receipt.score}% match.`}</h1>
        {b && (
          <Panel className="flex flex-col gap-3">
            {lines.map((line) => (
              <div key={line.label} className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] text-muted">{line.label}</span>
                <Delta value={line.value} className="text-lg font-extrabold" />
              </div>
            ))}
            {b.multiplier > 1 && (
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] text-muted">Round 2 multiplier</span>
                <span className="text-lg font-extrabold text-point">x{b.multiplier}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="font-bold">Turn total</span>
              <span className="font-display text-[32px] leading-none text-point">{b.total.toLocaleString()}</span>
            </div>
          </Panel>
        )}
        <p className="font-display text-2xl leading-snug">{receipt.caption}</p>
      </>
    );
  }

  const g = receipt.guess;
  if (!g) {
    return <StateScreen label={`${receipt.describerName}'s turn`} tone="ai" title="No guess. 0 points." text="Lock in a guess next time. Even a wild one can score." />;
  }
  return (
    <>
      <Label tone="human">{receipt.describerName}&apos;s turn · your guess</Label>
      <h1 className="font-display text-[40px] leading-[1.04]">{g.points > 0 ? `+${g.points} points.` : "Missed it. 0 points."}</h1>
      <Panel tone="human" className="flex flex-col gap-3">
        <p className="text-[22px] leading-snug">“{g.text}”</p>
        <div className="flex justify-between border-t border-line pt-3 text-[15px]">
          <span className="text-muted">Accuracy</span>
          <span className="font-extrabold text-human">{g.accuracy}%</span>
        </div>
        <div className="flex justify-between text-[15px]">
          <span className="text-muted">Speed kept</span>
          <span className="font-extrabold text-human">{g.speed}%</span>
        </div>
        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <span className="font-bold">Points</span>
          <span className="font-display text-[32px] leading-none text-point">{g.points}</span>
        </div>
      </Panel>
      <p className="font-display text-2xl leading-snug">{receipt.caption}</p>
    </>
  );
}

// ---------- Where I am on the scoreboard ----------

function StandingScreen({ standing }: { standing: MyStanding }) {
  const { rank, score, players, gap, aheadName, lastTurn, tied } = standing;
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 pb-16">
      <Label tone="human">Standings</Label>
      <p className="font-display text-[120px] leading-[0.9] text-point">#{rank}</p>
      <h1 className="font-display text-[34px] leading-[1.08]">
        {gap > 0 ? `${gap.toLocaleString()} behind ${aheadName}.` : tied ? (rank === 1 ? "Tied for the lead." : "Tied with the player above you.") : "You're in the lead."}
      </h1>
      <Panel className="flex justify-between">
        <div className="flex flex-col gap-1">
          <Label>Total</Label>
          <span className="font-display text-[32px] leading-none">{score.toLocaleString()}</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Label>This turn</Label>
          <Delta value={lastTurn} className="font-display text-[32px] leading-none" />
        </div>
      </Panel>
      <p className="text-[15px] text-muted">
        {rank} of {players} players.
      </p>
    </div>
  );
}

// ---------- Game over ----------

function FinalScreen({ final }: { final: FinalSummary }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 pb-10">
      <Label tone="point">Game over</Label>
      <p className="font-display text-[120px] leading-[0.9] text-point">#{final.rank}</p>
      <h1 className="font-display text-[34px] leading-[1.08]">
        {final.rank === 1 ? (final.tied ? "Joint champions of the night." : "Champion of the night.") : `${final.score.toLocaleString()} points. Respectable chaos.`}
      </h1>
      <Panel className="flex flex-col gap-3">
        <div className="flex justify-between text-[15px]">
          <span className="text-muted">Describing</span>
          <span className="font-extrabold text-action-edge">{final.prompterPoints.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-[15px]">
          <span className="text-muted">Guessing</span>
          <span className="font-extrabold text-human">{final.spectatorPoints.toLocaleString()}</span>
        </div>
        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <span className="font-bold">Final score</span>
          <span className="font-display text-[32px] leading-none text-point">{final.score.toLocaleString()}</span>
        </div>
      </Panel>
      {final.awards.map((award) => (
        <Panel key={award.title} tone="point" className="flex flex-col gap-1">
          <Label tone="point">Award</Label>
          <span className="font-display text-2xl">{award.title}</span>
        </Panel>
      ))}
      <p className="text-[15px] text-muted">Check the big screen for the Hall of Shame.</p>
    </div>
  );
}
