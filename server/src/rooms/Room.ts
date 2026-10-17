import type { Ai } from "../ai/index.js";
import type { GameIo, GameSocket } from "../app.js";
import { findBannedWords } from "../bannedWords.js";
import type { GameConfig } from "../config.js";
import { pickTarget, type TargetEntry } from "../targets.js";
import type { Description, JoinErrorReason, Player, Standing, SubmitResult, Target } from "../types.js";
import { buildHallOfShame, type RoundRecord } from "./hallOfShame.js";

/*
  ONE GAME ROOM
  The server owns the game: this class decides when every phase starts and ends,
  and tells the screens with socket events (see docs/data-contract.md, "Game flow").

  lobby → intro → describing → processing → reveal → scoreboard → (next round's intro)
                                                   ↘ last round: game_over → hall_of_shame
*/

export type Phase =
  | "lobby"
  | "intro"
  | "describing"
  | "processing"
  | "reveal"
  | "scoreboard"
  | "game_over"
  | "hall_of_shame";

// Phases the host's "next" button can cut short.
const skippable: Phase[] = ["reveal", "scoreboard", "game_over"];

type PlayerState = Standing & {
  socketId: string | null; // null while disconnected
};

// Thrown by submit(); the HTTP route turns it into a status code.
export class SubmitError extends Error {
  constructor(
    readonly status: 403 | 404 | 502,
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

  // Map keeps insertion order, which is the join order (and the turn order).
  private players = new Map<string, PlayerState>();
  private turnOrder: string[] = [];
  private roundIndex = -1;
  private describerId: string | null = null;
  private target: Target | null = null;
  private endsAt = 0;
  private usedTargets = new Set<string>();
  // Every round played in this room tonight, across games, for the Hall of Shame.
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
      this.attach(socket, existing);
      if (this.phase === "describing" && this.describerId === existing.id && this.target) {
        socket.emit("your_turn", { target: this.target, endsAt: this.endsAt });
      }
      return null;
    }

    const name = rawName.trim();
    if (this.phase !== "lobby") return "game_started";
    if (name.length < 1 || name.length > this.deps.config.maxNameLength) return "invalid_name";
    const taken = [...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) return "name_taken";
    if (this.players.size >= this.deps.config.maxPlayers) return "room_full";

    const player: PlayerState = { id: crypto.randomUUID(), name, score: 0, lastRound: 0, socketId: socket.id };
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

  // A player's socket disconnected.
  leave(playerId: string, socketId: string) {
    const player = this.players.get(playerId);
    // Ignore if they already came back on a newer socket.
    if (!player || player.socketId !== socketId) return;

    if (this.phase === "lobby") {
      this.players.delete(playerId);
    } else {
      player.socketId = null;
      // If it's their turn and they haven't submitted, give them a moment to come back, then skip them.
      // (If they already submitted, the round finishes without them.)
      if (this.describerId === playerId && this.awaitingDescriber()) {
        const round = this.roundIndex;
        clearTimeout(this.skipTimer);
        this.skipTimer = setTimeout(() => {
          if (this.closed || this.roundIndex !== round || player.socketId || !this.awaitingDescriber()) return;
          this.nextRound();
        }, this.deps.config.reconnectGraceMs);
      }
    }
    this.broadcastPlayers();
  }

  // The host left: end the game for everyone.
  close() {
    this.closed = true;
    this.clearTimer();
    clearTimeout(this.skipTimer);
    this.deps.io.to(this.code).emit("error", { message: "The host left, so the game ended." });
  }

  // ---------- Host controls ----------

  // Returns an error message for the host, or null if the game started.
  start(): string | null {
    if (!["lobby", "game_over", "hall_of_shame"].includes(this.phase)) return "The game is already running.";

    // Playing again: drop anyone who left, reset scores.
    for (const [id, p] of this.players) {
      if (!p.socketId) this.players.delete(id);
      p.score = 0;
      p.lastRound = 0;
    }
    const ids = [...this.players.keys()];
    if (ids.length < this.deps.config.minPlayers) {
      return `Need at least ${this.deps.config.minPlayers} players to start.`;
    }

    this.turnOrder = [];
    for (let i = 0; i < this.deps.config.roundsPerPlayer; i++) this.turnOrder.push(...ids);
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

  // ---------- The round loop ----------

  private nextRound(): void {
    this.clearTimer();
    clearTimeout(this.skipTimer);
    this.roundIndex++;
    if (this.roundIndex >= this.turnOrder.length) return this.gameOver();

    const describer = this.players.get(this.turnOrder[this.roundIndex]!);
    // Skip players who left.
    if (!describer?.socketId) return this.nextRound();

    for (const p of this.players.values()) p.lastRound = 0;
    this.describerId = describer.id;
    this.target = null;
    this.phase = "intro";
    this.toRoom("round_intro", {
      round: this.roundIndex + 1,
      totalRounds: this.turnOrder.length,
      describer: publicPlayer(describer),
    });
    this.after(this.deps.config.introMs, () => this.startDescribing());
  }

  private startDescribing() {
    const describer = this.describer();
    const { config } = this.deps;
    this.target = pickTarget(this.deps.targets, this.usedTargets);
    this.endsAt = Date.now() + config.describeMs;
    this.phase = "describing";

    // Only the describer's phone gets the target, so nobody else can peek.
    if (describer.socketId) {
      this.deps.io.to(describer.socketId).emit("your_turn", { target: this.target, endsAt: this.endsAt });
    }
    this.toRoom("describing", { describer: publicPlayer(describer), endsAt: this.endsAt });
    this.after(config.describeMs + config.submitGraceMs, () => this.timeUp());
  }

  // Called by POST /submit. Resolves with the same result everyone sees on the big screen.
  async submit(playerId: string, description: Description): Promise<SubmitResult> {
    const { config, ai } = this.deps;
    if (this.phase !== "describing") throw new SubmitError(403, "Nobody is describing right now.");
    if (playerId !== this.describerId) throw new SubmitError(403, "It's not your turn.");
    if (Date.now() > this.endsAt + config.submitGraceMs) throw new SubmitError(403, "Time's up.");

    const describer = this.describer();
    const target = this.target!;
    this.clearTimer();
    this.phase = "processing";
    this.toRoom("processing", { describer: publicPlayer(describer) });

    let transcript: string;
    let bannedSaid: string[];
    let drawing: Awaited<ReturnType<Ai["draw"]>>;
    try {
      transcript = (await ai.transcribe(description)).trim();
      bannedSaid = findBannedWords(transcript, target.bannedWords);
      if (this.closed) throw new SubmitError(404, "The room closed.");
      for (const word of bannedSaid) this.toRoom("banned_buzz", { playerId, word });
      drawing = await ai.draw(transcript, target);
    } catch (err) {
      if (err instanceof SubmitError || this.closed) throw err;
      console.error(`[${this.code}] AI pipeline failed:`, err);
      this.retryDescribing();
      throw new SubmitError(502, "The AI had a problem. Try again!");
    }
    if (this.closed) throw new SubmitError(404, "The room closed.");

    const score = drawing.refused ? 0 : Math.max(0, Math.min(100, Math.round(drawing.score)));
    const result: SubmitResult = { transcript, targetImageUrl: target.imageUrl, ...drawing, score };
    const points = Math.max(0, score - config.bannedWordPenalty * bannedSaid.length);
    this.finishRound(result, bannedSaid.length, points);
    return result;
  }

  // The AI failed: give the describer back their turn, with enough time to try again.
  private retryDescribing() {
    const { config } = this.deps;
    const describer = this.describer();
    this.endsAt = Math.max(this.endsAt, Date.now() + config.retryMs);
    this.phase = "describing";
    if (describer.socketId && this.target) {
      this.deps.io.to(describer.socketId).emit("your_turn", { target: this.target, endsAt: this.endsAt });
    }
    this.toRoom("describing", { describer: publicPlayer(describer), endsAt: this.endsAt });
    this.after(this.endsAt - Date.now() + config.submitGraceMs, () => this.timeUp());
  }

  // Nobody submitted in time.
  private timeUp() {
    this.finishRound(
      {
        transcript: "",
        imageUrl: "https://placehold.co/512x512/png?text=*crickets*",
        targetImageUrl: this.target?.imageUrl ?? "",
        score: 0,
        gotRight: [],
        gotWrong: [],
        caption: "Total silence. The AI drew exactly what you said.",
      },
      0,
      0,
    );
  }

  private finishRound(result: SubmitResult, bannedHits: number, points: number) {
    const describer = this.describer();
    describer.score += points;
    describer.lastRound = points;
    this.rounds.push({
      playerName: describer.name,
      transcript: result.transcript,
      imageUrl: result.refused ? "" : result.imageUrl,
      score: result.score,
      bannedHits,
      refused: Boolean(result.refused),
    });

    this.phase = "reveal";
    this.toRoom("round_result", { playerName: describer.name, result });
    const isLast = this.roundIndex >= this.turnOrder.length - 1;
    this.after(this.deps.config.revealMs, () => (isLast ? this.gameOver() : this.showScoreboard()));
  }

  private showScoreboard() {
    this.phase = "scoreboard";
    this.toRoom("scoreboard", { standings: this.standings() });
    this.after(this.deps.config.scoreboardMs, () => this.nextRound());
  }

  private gameOver() {
    this.clearTimer();
    this.describerId = null;
    this.phase = "game_over";
    this.toRoom("game_over", { standings: this.standings() });
    this.after(this.deps.config.gameOverMs, () => this.showHallOfShame());
  }

  private showHallOfShame() {
    this.phase = "hall_of_shame";
    this.toRoom("hall_of_shame", { data: buildHallOfShame(this.rounds) });
  }

  // ---------- Helpers ----------

  private awaitingDescriber(): boolean {
    return this.phase === "intro" || this.phase === "describing";
  }

  private describer(): PlayerState {
    const p = this.describerId ? this.players.get(this.describerId) : undefined;
    if (!p) throw new Error(`[${this.code}] no describer in phase ${this.phase}`);
    return p;
  }

  private standings(): Standing[] {
    return [...this.players.values()].map(({ id, name, score, lastRound }) => ({ id, name, score, lastRound }));
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
}

function publicPlayer({ id, name, score }: Player): Player {
  return { id, name, score };
}
