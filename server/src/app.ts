import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { defaultConfig, type GameConfig } from "./config.js";
import type { ClientToServerEvents, ServerToClientEvents } from "./types.js";

export type GameIo = Server<ClientToServerEvents, ServerToClientEvents>;

export type ServerOptions = {
  // The web app's URL(s), for CORS on both HTTP and Socket.io.
  clientOrigin: string[];
  config?: Partial<GameConfig>;
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
  void config;

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
