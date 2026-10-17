import { io, type Socket } from "socket.io-client";
import { createGameServer, type ServerOptions } from "../src/app.js";
import type { GameConfig } from "../src/config.js";
import type { ClientToServerEvents, ServerToClientEvents, SubmitResult } from "../src/types.js";

// Helpers shared by the bot script and the tests: fake phones and a fast in-process server.

// Short timings so a whole game takes a few seconds.
export const fastConfig: Partial<GameConfig> = {
  roundIntroMs: 50,
  introMs: 50,
  describeMs: 1_000,
  guessMs: 1_200,
  submitGraceMs: 200,
  retryMs: 1_000,
  reconnectGraceMs: 300,
  hostGraceMs: 5_000,
  revealMs: 50,
  scoreboardMs: 50,
  gameOverMs: 50,
  fakeAiDelayMs: 20,
};

export async function startTestServer(options: Partial<ServerOptions> = {}) {
  const server = createGameServer({ clientOrigin: ["http://localhost:3000"], config: fastConfig, ...options });
  const port = await server.listen(0);
  return { url: `http://localhost:${port}`, close: server.close };
}

type EventName = keyof ServerToClientEvents;
type Payload<E extends EventName> = Parameters<ServerToClientEvents[E]>[0];
export type LoggedEvent = { event: EventName; payload: unknown; at: number };

// A fake phone or host screen that remembers every event it received.
export class Client {
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  readonly log: LoggedEvent[] = [];
  private listeners: (() => void)[] = [];

  constructor(
    readonly url: string,
    readonly label: string,
    options: { reconnection?: boolean } = {},
  ) {
    this.socket = io(url, { forceNew: true, reconnection: options.reconnection ?? false });
    this.socket.onAny((event: EventName, payload: unknown) => {
      this.log.push({ event, payload, at: Date.now() });
      for (const check of this.listeners) check();
    });
  }

  all<E extends EventName>(event: E): Payload<E>[] {
    return this.log.filter((e) => e.event === event).map((e) => e.payload as Payload<E>);
  }

  // Resolves with the first event (already received or still to come) that matches.
  waitFor<E extends EventName>(
    event: E,
    match: (payload: Payload<E>) => boolean = () => true,
    timeoutMs = 10_000,
  ): Promise<Payload<E>> {
    return new Promise((resolve, reject) => {
      const find = () => this.all(event).find(match);
      const found = find();
      if (found !== undefined) return resolve(found);

      const check = () => {
        const hit = find();
        if (hit === undefined) return;
        cleanup();
        resolve(hit);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${this.label}: timed out waiting for "${event}"`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== check);
      };
      this.listeners.push(check);
    });
  }

  close() {
    this.socket.close();
  }
}

// What the phone does: POST /submit, the same way web/lib/submit.ts does.
export async function submit(
  url: string,
  fields: { roomCode: string; playerId: string; text?: string; audio?: Blob },
): Promise<{ status: number; body: SubmitResult | { error: string } }> {
  const form = new FormData();
  form.append("roomCode", fields.roomCode);
  form.append("playerId", fields.playerId);
  if (fields.text !== undefined) form.append("text", fields.text);
  if (fields.audio) form.append("audio", fields.audio, "description.wav");
  const res = await fetch(`${url}/submit`, { method: "POST", body: form });
  return { status: res.status, body: await res.json() };
}

export function fakeAudio(): Blob {
  return new Blob([new Uint8Array(2048)], { type: "audio/wav" });
}
