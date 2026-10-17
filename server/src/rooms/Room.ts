import { AiOutOfQuotaError, type Ai, type Drawing, type Judgement, type Sketch } from "../ai/index.js";
import { wordMatchScore } from "../ai/wordMatch.js";
import type { GameIo, GameSocket } from "../app.js";
import { findBannedWords } from "../bannedWords.js";
import type { GameConfig } from "../config.js";
import { guessPoints, maxGuessPoints, noPoints, prompterPoints, rankStandings, speedPercent } from "../scoring.js";
import { pickTarget, publicTarget, type TargetEntry } from "../targets.js";
import type {
  Award,
  Description,
  GuessErrorReason,
  GuessResult,
  JoinErrorReason,
  Player,
  Standing,
  SubmitResult,
} from "../types.js";
import { buildHallOfShame, type RoundRecord } from "./hallOfShame.js";

/*
  ONE GAME ROOM
  The server owns the game: this class decides when every phase starts and ends,
  and tells the screens with socket events (see docs/data-contract.md, "Game flow").

  A game is a few rounds (config.roundMultipliers); in each round everyone describes once.

  lobby → round_start → intro → describing → processing → reveal → scoreboard → (next turn's intro)
                                                                   ↘ end of a round: next round_start
                                                                   ↘ last turn of the game: game_over → hall_of_shame

  While someone describes, everyone else can type one guess, until config.guessMs after describing
  started (or until everyone has guessed). Once both the drawing and the guesses are in, one AI call
  judges them together (fewer calls, for the free tier), and the reveal follows.

  If the AI can't help (down, or out of free requests), the game keeps going: drawings and guesses are
  scored by shared words instead (wordMatchScore). If it can't even transcribe, the describer gets one
  retry; out of requests, the turn ends with 0 points for them (guesses still score).
*/

export type Phase =
  | "lobby"
  | "round_start"
  | "intro"
  | "describing"
  | "processing"
  | "reveal"
  | "scoreboard"
  | "game_over"
  | "hall_of_shame";

// Phases the host's "next" button can cut short.
const skippable: Phase[] = ["round_start", "reveal", "scoreboard", "game_over"];

type PlayerState = Player & {
  socketId: string | null; // null while disconnected
  leftAt?: number; // when they disconnected
  lastTurn: number;
  prompterPoints: number;
  spectatorPoints: number;
  finalRoundPoints: number;
};

type Guess = { playerId: string; text: string; speed: number };

// Everything about the turn being played. A fresh object every turn, so nothing leaks into the next one.
type Turn = {
  round: number; // 1-based
  describerId: string;
  target: TargetEntry;
  startedAt: number; // when describing started
  endsAt: number; // the describer's deadline (moves later if the AI fails)
  firstSubmitAt?: number; // for the speed bonus, so an AI failure doesn't change it
  guessEndsAt: number;
  guessesOpen: boolean;
  guessTimer?: NodeJS.Timeout;
  guesses: Map<string, Guess>; // by player id, in the order they came in
  drawing?: { transcript: string; sketch: Sketch; bannedHits: number; described: boolean }; // set once drawn
  retried: boolean; // the describer already got extra time after an AI failure (only once per turn)
  judging: boolean; // the AI is judging the drawing and the guesses
  // Settles with the turn's result, for the describer's /submit request.
  result: Deferred<SubmitResult>;
};

// One finished turn of this game, for the awards.
type TurnRecord = { playerName: string; score: number; imageUrl: string; drawn: boolean };

// Thrown by submit(); the HTTP route turns it into a status code.
export class SubmitError extends Error {
  constructor(
    readonly status: 403 | 404 | 502 | 503,
    message: string,
  ) {
    super(message);
  }
}

export type RoomDeps = {
  io: GameIo;
  config: GameConfig;
  ai: Ai;
  targets: TargetEntry[];
};

export class Room {
  phase: Phase = "lobby";

  // Map keeps insertion order, which is the join order (round 1's turn order).
  private players = new Map<string, PlayerState>();
  // How many played when the game started. Sets what a guess is worth, so it can't change mid-game.
  private playerCount = 0;
  private roundIndex = -1; // 0-based
  private roundOrder: string[] = []; // who describes this round, in order
  private turnIndex = -1; // 0-based, within the round
  private describerId: string | null = null;
  private turn: Turn | null = null;
  private turnLog: TurnRecord[] = [];
  private usedTargets = new Set<string>();
  // Every turn played in this room tonight, across games, for the Hall of Shame.
  private rounds: RoundRecord[] = [];
  private timer: NodeJS.Timeout | undefined;
  private pending: (() => void) | undefined; // what the timer will do; "next" runs it early
  private skipTimer: NodeJS.Timeout | undefined; // skips a disconnected describer's turn
  private closed = false;

  constructor(
    readonly code: string,
    private deps: RoomDeps,
  ) {}

  // ---------- Joining and leaving ----------

  join(socket: GameSocket, rawName: string, rejoinId?: string): JoinErrorReason | null {
    // Rejoin after a refresh: same player, same score, new socket.
    const existing = rejoinId ? this.players.get(rejoinId) : undefined;
    if (existing) {
      existing.socketId = socket.id;
      existing.leftAt = undefined;
      this.attach(socket, existing);
      this.catchUp(socket, existing.id);
      return null;
    }

    const name = rawName.trim();
    if (this.phase !== "lobby") return "game_started";
    if (name.length < 1 || name.length > this.deps.config.maxNameLength) return "invalid_name";
    const taken = [...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) return "name_taken";
    if (this.players.size >= this.deps.config.maxPlayers) return "room_full";

    const player: PlayerState = {
      id: crypto.randomUUID(),
      name,
      score: 0,
      lastTurn: 0,
      prompterPoints: 0,
      spectatorPoints: 0,
      finalRoundPoints: 0,
      socketId: socket.id,
    };
    this.players.set(player.id, player);
    this.attach(socket, player);
    return null;
  }

  private attach(socket: GameSocket, player: PlayerState) {
    socket.data = { role: "player", code: this.code, playerId: player.id };
    void socket.join(this.code);
    socket.emit("joined", { player: publicPlayer(player), code: this.code });
    this.broadcastPlayers();
  }

  // A rejoining phone gets back what it missed: the describer their target, a guesser the guess box.
  private catchUp(socket: GameSocket, playerId: string) {
    const turn = this.turn;
    if (!turn) return;
    if (playerId === turn.describerId) {
      if (this.phase === "describing") {
        socket.emit("your_turn", { target: publicTarget(turn.target), endsAt: turn.endsAt });
      }
      return;
    }
    if (!turn.guessesOpen) return;
    const describer = this.describer();
    socket.emit("describing", { describer: publicPlayer(describer), endsAt: turn.endsAt, guessEndsAt: turn.guessEndsAt });
    const guess = turn.guesses.get(playerId);
    if (guess) socket.emit("guess_locked", { text: guess.text, speed: guess.speed });
  }

  // A player's connection came back by itself (Socket.io connection state recovery) with the
  // same socket id. Events they missed are replayed by Socket.io, so there's nothing to catch up on.
  // Returns false if the player is gone (e.g. a new game started without them).
  resume(socket: GameSocket, playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    player.socketId = socket.id;
    player.leftAt = undefined;
    this.broadcastPlayers();
    return true;
  }

  // A player's socket disconnected. `onPurpose` = they closed the page (not a dropped connection).
  leave(playerId: string, socketId: string, onPurpose = true) {
    const player = this.players.get(playerId);
    // Ignore if they already came back on a newer socket.
    if (!player || player.socketId !== socketId) return;

    if (this.phase === "lobby" && onPurpose) {
      this.players.delete(playerId);
    } else {
      // A dropped connection (e.g. a locked phone) may come back, so keep the player.
      player.socketId = null;
      player.leftAt = Date.now();
      if (this.phase === "lobby") return this.broadcastPlayers();
      // If it's their turn and they haven't submitted, give them a moment to come back, then skip them.
      // (If they already submitted, the turn finishes without them.)
      if (this.describerId === playerId && this.awaitingDescriber()) {
        const turnIndex = this.turnIndex;
        const roundIndex = this.roundIndex;
        clearTimeout(this.skipTimer);
        this.skipTimer = setTimeout(() => {
          if (this.closed || this.turnIndex !== turnIndex || this.roundIndex !== roundIndex) return;
          if (player.socketId || !this.awaitingDescriber()) return;
          this.nextTurn();
        }, this.deps.config.reconnectGraceMs);
      } else {
        // Everyone still here may have guessed already.
        this.closeGuessesIfAllIn();
      }
    }
    this.broadcastPlayers();
  }

  // The host left: end the game for everyone.
  close() {
    this.closed = true;
    this.clearTimer();
    this.clearTurn();
    clearTimeout(this.skipTimer);
    this.deps.io.to(this.code).emit("error", { message: "The host left, so the game ended." });
  }

  // ---------- Host controls ----------

  // Returns an error message for the host, or null if the game started.
  start(): string | null {
    if (!["lobby", "game_over", "hall_of_shame"].includes(this.phase)) return "The game is already running.";

    // Playing again: reset scores, and drop anyone who's been gone a while. Phones that only just
    // dropped (a locked screen) stay in, and rejoin as themselves when they wake up.
    const now = Date.now();
    for (const [id, p] of this.players) {
      if (!p.socketId && now - (p.leftAt ?? 0) > this.deps.config.dropPlayerAfterMs) this.players.delete(id);
      Object.assign(p, { score: 0, lastTurn: 0, prompterPoints: 0, spectatorPoints: 0, finalRoundPoints: 0 });
    }
    const connected = [...this.players.values()].filter((p) => p.socketId).length;
    if (connected < this.deps.config.minPlayers) {
      return `Need at least ${this.deps.config.minPlayers} players to start.`;
    }

    this.playerCount = connected;
    this.turnLog = [];
    this.roundIndex = -1;
    this.nextRound();
    return null;
  }

  next() {
    if (!skippable.includes(this.phase) || !this.pending) return;
    const run = this.pending;
    this.clearTimer();
    run();
  }

  // ---------- Rounds and turns ----------

  private nextRound(): void {
    this.clearTimer();
    this.roundIndex++;
    const { roundMultipliers } = this.deps.config;
    if (this.roundIndex >= roundMultipliers.length) return this.gameOver();

    const joinOrder = [...this.players.keys()];
    // Round 1 goes in join order. After that, lowest score first, so the leader describes last
    // and everyone behind knows what they need. (sort is stable, so ties keep join order.)
    this.roundOrder =
      this.roundIndex === 0
        ? joinOrder
        : [...joinOrder].sort((a, b) => this.players.get(a)!.score - this.players.get(b)!.score);
    this.turnIndex = -1;

    const [first, second] = this.standings();
    const gap = first ? first.score - (second?.score ?? 0) : 0;
    this.phase = "round_start";
    this.toRoom("round_start", {
      round: this.roundIndex + 1,
      totalRounds: roundMultipliers.length,
      multiplier: this.multiplier(),
      leader: first && gap > 0 ? publicPlayer(first) : null,
      gap,
    });
    this.after(this.deps.config.roundIntroMs, () => this.nextTurn());
  }

  private nextTurn(): void {
    this.clearTimer();
    this.clearTurn();
    clearTimeout(this.skipTimer);
    this.turnIndex++;
    if (this.turnIndex >= this.roundOrder.length) return this.nextRound();

    const describer = this.players.get(this.roundOrder[this.turnIndex]!);
    // Skip players who left.
    if (!describer?.socketId) return this.nextTurn();

    for (const p of this.players.values()) p.lastTurn = 0;
    this.describerId = describer.id;
    this.phase = "intro";
    this.toRoom("turn_intro", {
      round: this.roundIndex + 1,
      totalRounds: this.deps.config.roundMultipliers.length,
      turn: this.turnIndex + 1,
      turnsInRound: this.roundOrder.length,
      multiplier: this.multiplier(),
      describer: publicPlayer(describer),
    });
    this.after(this.deps.config.introMs, () => this.startDescribing());
  }

  private startDescribing() {
    const describer = this.describer();
    const { config } = this.deps;
    const now = Date.now();
    const turn: Turn = {
      round: this.roundIndex + 1,
      describerId: describer.id,
      target: pickTarget(this.deps.targets, this.usedTargets),
      startedAt: now,
      endsAt: now + config.describeMs,
      guessEndsAt: now + config.guessMs,
      guessesOpen: true,
      guesses: new Map(),
      retried: false,
      judging: false,
      result: deferred(),
    };
    this.turn = turn;
    this.phase = "describing";

    // Only the describer's phone gets the target, so nobody else can peek.
    if (describer.socketId) {
      this.deps.io.to(describer.socketId).emit("your_turn", { target: publicTarget(turn.target), endsAt: turn.endsAt });
    }
    this.toRoom("describing", { describer: publicPlayer(describer), endsAt: turn.endsAt, guessEndsAt: turn.guessEndsAt });
    turn.guessTimer = setTimeout(() => this.closeGuesses(turn), config.guessMs);
    this.after(config.describeMs + config.submitGraceMs, () => this.timeUp());
    this.closeGuessesIfAllIn(); // e.g. nobody else is connected
  }

  // ---------- Guessing ----------

  // Called by the "guess" socket event. Returns why the guess wasn't taken, or null.
  guess(playerId: string, rawText: string): GuessErrorReason | null {
    const turn = this.turn;
    if (!turn?.guessesOpen || !this.players.has(playerId)) return "not_now";
    if (playerId === turn.describerId) return "describer";
    if (turn.guesses.has(playerId)) return "already_guessed";
    const text = rawText.trim().replace(/\s+/g, " ");
    if (text.length < 1 || text.length > this.deps.config.maxGuessLength) return "invalid_guess";

    const speed = speedPercent(this.deps.config, Date.now() - turn.startedAt);
    turn.guesses.set(playerId, { playerId, text, speed });
    const socketId = this.players.get(playerId)!.socketId;
    if (socketId) this.deps.io.to(socketId).emit("guess_locked", { text, speed });
    // The host lights up who has guessed, never what they guessed.
    this.toRoom("guesses_locked", { playerIds: [...turn.guesses.keys()], open: true });
    this.closeGuessesIfAllIn();
    return null;
  }

  // Close guessing early once everyone still connected (except the describer) has guessed.
  private closeGuessesIfAllIn() {
    const turn = this.turn;
    if (!turn?.guessesOpen) return;
    const waitingOn = [...this.players.values()].filter(
      (p) => p.socketId && p.id !== turn.describerId && !turn.guesses.has(p.id),
    );
    if (waitingOn.length === 0) this.closeGuesses(turn);
  }

  // Stops taking guesses. They're scored with the drawing, once that's ready too.
  private closeGuesses(turn: Turn) {
    if (!turn.guessesOpen) return;
    turn.guessesOpen = false;
    clearTimeout(turn.guessTimer);
    this.toRoom("guesses_locked", { playerIds: [...turn.guesses.keys()], open: false });
    this.judgeIfReady(turn);
  }

  // ---------- Describing ----------

  // Called by POST /submit. Resolves with the turn's result once it's revealed (the drawing and the
  // guesses are judged together, so this waits for guessing to close too).
  async submit(playerId: string, description: Description): Promise<SubmitResult> {
    const { config, ai } = this.deps;
    const turn = this.turn;
    if (this.phase !== "describing" || !turn) throw new SubmitError(403, "Nobody is describing right now.");
    if (playerId !== turn.describerId) throw new SubmitError(403, "It's not your turn.");
    if (Date.now() > turn.endsAt + config.submitGraceMs) throw new SubmitError(403, "Time's up.");

    const describer = this.describer();
    const target = turn.target;
    turn.firstSubmitAt ??= Date.now();
    this.clearTimer();
    this.phase = "processing";
    this.toRoom("processing", { describer: publicPlayer(describer) });

    // Transcribing is the one step with no fallback: without it there's nothing to score.
    let transcript: string;
    try {
      transcript = (await ai.transcribe(description)).trim();
    } catch (err) {
      if (this.closed || this.turn !== turn) throw new SubmitError(404, "The room closed.");
      console.error(`[${this.code}] Transcribing failed:`, err);
      // Out of requests: retrying can't help, so end the turn now instead of making everyone wait.
      if (err instanceof AiOutOfQuotaError) {
        this.endUndescribed(turn, "The AI is out of free requests, so it couldn't hear a thing. No points lost!");
        throw new SubmitError(503, "The AI is out of free requests for now, so this turn can't be scored. Sorry!");
      }
      this.retryDescribing(turn);
      throw new SubmitError(502, "The AI couldn't listen to that. Send it again!");
    }
    if (this.closed || this.turn !== turn) throw new SubmitError(404, "The room closed.");

    const bannedSaid = findBannedWords(transcript, target.bannedWords);
    for (const word of bannedSaid) this.toRoom("banned_buzz", { playerId, word });

    let sketch: Sketch;
    try {
      sketch = await ai.draw(transcript, publicTarget(target));
    } catch (err) {
      // No drawing, but the description is fine: score its words instead of making them redo it.
      console.error(`[${this.code}] Drawing failed, scoring the words instead:`, err);
      sketch = { kind: "final", drawing: noDrawing(target.prompt, transcript) };
    }
    if (this.closed || this.turn !== turn) throw new SubmitError(404, "The room closed.");

    turn.drawing = { transcript, sketch, bannedHits: bannedSaid.length, described: true };
    this.judgeIfReady(turn);
    return turn.result.promise;
  }

  // The AI failed: give the describer back their turn. The first time with enough time to try again;
  // after that the clock keeps running, so a broken AI can't keep one turn going forever.
  // Guesses stay, and anyone who hasn't guessed gets at least as long as the describer.
  private retryDescribing(turn: Turn) {
    const { config } = this.deps;
    const describer = this.describer();
    if (!turn.retried) {
      turn.retried = true;
      turn.endsAt = Math.max(turn.endsAt, Date.now() + config.retryMs);
    }
    if (turn.guessesOpen && turn.guessEndsAt < turn.endsAt) {
      turn.guessEndsAt = turn.endsAt;
      clearTimeout(turn.guessTimer);
      turn.guessTimer = setTimeout(() => this.closeGuesses(turn), turn.guessEndsAt - Date.now());
    }
    this.phase = "describing";
    if (describer.socketId) {
      this.deps.io.to(describer.socketId).emit("your_turn", { target: publicTarget(turn.target), endsAt: turn.endsAt });
    }
    this.toRoom("describing", { describer: publicPlayer(describer), endsAt: turn.endsAt, guessEndsAt: turn.guessEndsAt });
    this.after(Math.max(0, turn.endsAt - Date.now()) + config.submitGraceMs, () => this.timeUp());
  }

  // The describer didn't submit in time. Guessers still get scored.
  private timeUp() {
    const turn = this.turn;
    if (!turn) return;
    this.endUndescribed(turn, "Total silence. The AI drew exactly what you said.");
  }

  // Ends a turn with no description: 0 points for the describer, guesses still scored.
  private endUndescribed(turn: Turn, caption: string) {
    this.clearTimer();
    const drawing: Drawing = {
      imageUrl: "https://placehold.co/512x512/png?text=*crickets*",
      score: 0,
      gotRight: [],
      gotWrong: [],
      caption,
    };
    turn.drawing = { transcript: "", sketch: { kind: "final", drawing }, bannedHits: 0, described: false };
    this.phase = "processing";
    this.toRoom("processing", { describer: publicPlayer(this.describer()) });
    this.judgeIfReady(turn);
  }

  // Once the drawing and the guesses are both in, judge them in one AI call (or by shared words if the AI can't).
  private judgeIfReady(turn: Turn) {
    if (turn.judging || !turn.drawing || turn.guessesOpen || this.turn !== turn) return;
    turn.judging = true;
    void this.judge(turn, turn.drawing);
  }

  private async judge(turn: Turn, drawn: NonNullable<Turn["drawing"]>) {
    const { transcript, sketch } = drawn;
    const target = turn.target;
    const guesses = [...turn.guesses.values()];
    let judgement: Judgement | undefined;
    let scores: number[];
    try {
      const judged = await this.deps.ai.judge({
        target,
        transcript,
        image: sketch.kind === "drawn" ? sketch.image : undefined,
        guesses: guesses.map((g) => g.text),
      });
      if (judged.guessScores.length !== guesses.length) {
        throw new Error(`got ${judged.guessScores.length} scores for ${guesses.length} guesses`);
      }
      if (sketch.kind === "drawn" && !judged.judgement) throw new Error("the drawing wasn't judged");
      judgement = judged.judgement;
      scores = judged.guessScores;
    } catch (err) {
      console.error(`[${this.code}] Judging failed, using word matching:`, err);
      scores = guesses.map((g) => wordMatchScore(target.prompt, g.text));
    }
    if (this.closed || this.turn !== turn) return; // the turn was skipped meanwhile

    const drawing: Drawing =
      sketch.kind === "final"
        ? sketch.drawing
        : { imageUrl: sketch.imageUrl, ...(judgement ?? noDrawing(target.prompt, transcript)) };
    const score = drawing.refused ? 0 : clampPercent(drawing.score);
    const result: SubmitResult = { transcript, targetImageUrl: target.imageUrl, ...drawing, score };
    const accuracies = new Map(guesses.map((g, i) => [g.playerId, clampPercent(scores[i]!)]));
    this.finishTurn(turn, { result, bannedHits: drawn.bannedHits, described: drawn.described }, accuracies);
    turn.result.resolve(result);
  }

  private finishTurn(
    turn: Turn,
    drawing: { result: SubmitResult; bannedHits: number; described: boolean },
    accuracies: Map<string, number>,
  ) {
    const { config } = this.deps;
    const multiplier = this.multiplier();
    const finalRound = this.roundIndex === config.roundMultipliers.length - 1;
    const describer = this.describer();
    const { result, bannedHits, described } = drawing;

    // Guessers first: the describer's clarity bonus is how well they did.
    const maxPoints = maxGuessPoints(config, this.playerCount, multiplier);
    const guesses: GuessResult[] = [...turn.guesses.values()].map(({ playerId, text, speed }) => {
      const accuracy = accuracies.get(playerId) ?? 0;
      const player = this.players.get(playerId)!;
      return { playerId, playerName: player.name, text, accuracy, speed, points: guessPoints(maxPoints, accuracy, speed) };
    });
    const timeLeft = (turn.startedAt + config.describeMs - (turn.firstSubmitAt ?? Infinity)) / config.describeMs;
    const breakdown = described
      ? prompterPoints(config, {
          score: result.score,
          guessAccuracies: guesses.map((g) => g.accuracy),
          timeLeft,
          bannedWords: bannedHits,
          multiplier,
        })
      : noPoints(multiplier);

    const award = (player: PlayerState, points: number, kind: "prompterPoints" | "spectatorPoints") => {
      player.score += points;
      player[kind] += points;
      player.lastTurn = points;
      if (finalRound) player.finalRoundPoints += points;
    };
    award(describer, breakdown.total, "prompterPoints");
    for (const g of guesses) award(this.players.get(g.playerId)!, g.points, "spectatorPoints");

    const drawn = described && !result.refused;
    this.turnLog.push({ playerName: describer.name, score: result.score, imageUrl: result.imageUrl, drawn });
    this.rounds.push({
      playerName: describer.name,
      transcript: result.transcript,
      imageUrl: result.refused ? "" : result.imageUrl,
      score: result.score,
      bannedHits,
      refused: Boolean(result.refused),
    });

    this.phase = "reveal";
    this.toRoom("round_result", { playerName: describer.name, result, breakdown, guesses });
    const isLast = finalRound && this.turnIndex >= this.roundOrder.length - 1;
    this.after(config.revealMs, () => (isLast ? this.gameOver() : this.showScoreboard()));
  }

  private showScoreboard() {
    this.phase = "scoreboard";
    this.toRoom("scoreboard", { standings: this.standings() });
    this.after(this.deps.config.scoreboardMs, () => this.nextTurn());
  }

  private gameOver() {
    this.clearTimer();
    this.clearTurn();
    this.describerId = null;
    this.phase = "game_over";
    this.toRoom("game_over", { standings: this.standings(), awards: this.awards() });
    this.after(this.deps.config.gameOverMs, () => this.showHallOfShame());
  }

  private showHallOfShame() {
    this.phase = "hall_of_shame";
    this.toRoom("hall_of_shame", { data: buildHallOfShame(this.rounds) });
  }

  // The best and worst drawings of the game, and the best guesser. Skipped when nobody qualifies.
  private awards(): Award[] {
    const awards: Award[] = [];
    const drawn = this.turnLog.filter((t) => t.drawn);
    const best = drawn.reduce<TurnRecord | undefined>((top, t) => (!top || t.score > top.score ? t : top), undefined);
    const worst = drawn.reduce<TurnRecord | undefined>((low, t) => (!low || t.score < low.score ? t : low), undefined);
    if (best) awards.push({ title: "Closest Drawing", playerName: best.playerName, imageUrl: best.imageUrl });
    if (worst && worst !== best) {
      awards.push({ title: "Most Wrong Masterpiece", playerName: worst.playerName, imageUrl: worst.imageUrl });
    }
    const guesser = [...this.players.values()].reduce<PlayerState | undefined>(
      (top, p) => (p.spectatorPoints > (top?.spectatorPoints ?? 0) ? p : top),
      undefined,
    );
    if (guesser) awards.push({ title: "Sharpest Guesser", playerName: guesser.name, imageUrl: "" });
    return awards;
  }

  // ---------- Helpers ----------

  private multiplier(): number {
    return this.deps.config.roundMultipliers[this.roundIndex] ?? 1;
  }

  private awaitingDescriber(): boolean {
    return this.phase === "intro" || this.phase === "describing";
  }

  private describer(): PlayerState {
    const p = this.describerId ? this.players.get(this.describerId) : undefined;
    if (!p) throw new Error(`[${this.code}] no describer in phase ${this.phase}`);
    return p;
  }

  // Sorted best first, ties broken (see rankStandings).
  private standings(): Standing[] {
    return rankStandings(
      [...this.players.values()].map(({ id, name, score, lastTurn, prompterPoints, spectatorPoints, finalRoundPoints }) => ({
        id,
        name,
        score,
        lastTurn,
        prompterPoints,
        spectatorPoints,
        finalRoundPoints,
      })),
    );
  }

  private broadcastPlayers() {
    const connected = [...this.players.values()].filter((p) => p.socketId).map(publicPlayer);
    this.toRoom("players", { players: connected });
  }

  private toRoom: GameIo["emit"] = (event, ...args) => this.deps.io.to(this.code).emit(event, ...args);

  // Run `fn` after `ms`, unless the host skips ahead or the phase changes first.
  private after(ms: number, fn: () => void) {
    this.clearTimer();
    this.pending = fn;
    this.timer = setTimeout(() => {
      this.pending = undefined;
      fn();
    }, ms);
  }

  private clearTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  // Drops the current turn: no more guesses, and any AI answer still on its way is ignored.
  private clearTurn() {
    if (!this.turn) return;
    clearTimeout(this.turn.guessTimer);
    this.turn.guessesOpen = false;
    this.turn.result.reject(new SubmitError(404, "That turn is over."));
    this.turn = null;
  }
}

function publicPlayer({ id, name, score }: Player): Player {
  return { id, name, score };
}

// When there's no drawing to judge (the AI couldn't draw or judge), the description's words are scored instead.
function noDrawing(prompt: string, transcript: string): Drawing {
  return {
    imageUrl: "https://placehold.co/512x512/png?text=The+AI+ran+out+of+ink",
    score: wordMatchScore(prompt, transcript),
    gotRight: [],
    gotWrong: [],
    caption: "The AI ran out of ink, so your words were scored instead.",
  };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void };

// A promise settled from outside. Rejections nobody waits for (no /submit came) are ignored.
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}
