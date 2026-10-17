import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import cors from "cors";
import express from "express";
import { Server, type Socket } from "socket.io";
import type { Ai } from "./ai/index.js";
import { createFakeAi } from "./ai/fake.js";
import type { ImageStore } from "./ai/images.js";
import { defaultConfig, type GameConfig } from "./config.js";
import { submitRouter, uploadErrors } from "./http/submit.js";
import { RoomStore } from "./rooms/RoomStore.js";
import { registerSockets } from "./sockets.js";
import { loadTargets } from "./targets.js";
import type { ClientToServerEvents, ServerToClientEvents } from "./types.js";

// What the server remembers about each connection.
export type SocketData = {
  role?: "host" | "player";
  code?: string;
  playerId?: string;
};

export type GameIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export type ServerOptions = {
  // The web app's URL(s), for CORS on both HTTP and Socket.io.
  clientOrigin: string[];
  config?: Partial<GameConfig>;
  // Defaults to the fake AI.
  ai?: Ai;
  // Where the AI keeps the images it draws; served at /images/:id.
  images?: ImageStore;
};

export type GameServer = {
  httpServer: HttpServer;
  io: GameIo;
  // Resolves with the port actually used (pass 0 for a random free port, handy in tests).
  listen: (port: number) => Promise<number>;
  close: () => Promise<void>;
};

export function createGameServer(options: ServerOptions): GameServer {
  const config: GameConfig = { ...defaultConfig, ...options.config };
  const corsOptions = { origin: options.clientOrigin };

  const app = express();
  app.use(cors(corsOptions));
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const httpServer = createServer(app);
  const io: GameIo = new Server(httpServer, { cors: corsOptions });
  const rooms = new RoomStore({
    io,
    config,
    ai: options.ai ?? createFakeAi(config.fakeAiDelayMs),
    targets: loadTargets(),
  });
  registerSockets(io, rooms);
  if (options.images) app.use(options.images.router());
  app.use(submitRouter(rooms, config));
  app.use(uploadErrors);

  return {
    httpServer,
    io,
    listen: (port) =>
      new Promise((resolve) => {
        httpServer.listen(port, () => resolve((httpServer.address() as AddressInfo).port));
      }),
    close: () =>
      new Promise((resolve) => {
        io.close(() => resolve());
      }),
  };
}
