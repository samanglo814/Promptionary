import { Router, type ErrorRequestHandler } from "express";
import multer from "multer";
import type { GameConfig } from "../config.js";
import { SubmitError } from "../rooms/Room.js";
import type { RoomStore } from "../rooms/RoomStore.js";
import type { Description } from "../types.js";

// POST /submit: the describer's phone sends a recording (docs/data-contract.md, section 4).
// `text` instead of audio is for the bot game and tests only: players always talk, since the others guess
// from hearing them.
// Errors reply with { error: string } and the status codes from the contract.
export function submitRouter(rooms: RoomStore, config: GameConfig): Router {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxAudioBytes, files: 1, fields: 10 },
  });
  const router = Router();

  router.post("/submit", upload.single("audio"), async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const roomCode = typeof body.roomCode === "string" ? body.roomCode : "";
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    const text = typeof body.text === "string" ? body.text.trim() : undefined;
    const audio = req.file;

    if (!roomCode || !playerId) {
      res.status(400).json({ error: "roomCode and playerId are required." });
      return;
    }
    if (Boolean(audio) === (text !== undefined)) {
      res.status(400).json({ error: "Send exactly one of audio or text." });
      return;
    }
    if (text !== undefined && (text.length === 0 || text.length > config.maxTextLength)) {
      res.status(400).json({ error: `Text must be 1–${config.maxTextLength} characters.` });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      res.status(404).json({ error: "Room not found." });
      return;
    }

    const description: Description = audio
      ? { kind: "audio", audio: audio.buffer, mimeType: audio.mimetype }
      : { kind: "text", text: text! };

    try {
      res.json(await room.submit(playerId, description));
    } catch (err) {
      if (!(err instanceof SubmitError)) throw err;
      res.status(err.status).json({ error: err.message });
    }
  });

  return router;
}

// Upload problems (file too big, wrong field name) are the caller's fault: 400, not 500.
export const uploadErrors: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
};
