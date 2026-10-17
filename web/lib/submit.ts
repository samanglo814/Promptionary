// Sends a player's description to the server's /submit endpoint and gets back the
// round result (transcript, AI image, score, caption).
// A description is always a voice recording: the other players guess from hearing it.
//
// Until the server exists, both return the mock result instead, so the frontend
// can be built and tested on its own.

import { mockResult, type SubmitResult } from "./mocks";

// Where the server lives, read from web/.env (e.g. NEXT_PUBLIC_SERVER_URL=http://localhost:4000).
// The NEXT_PUBLIC_ prefix is what makes it available in the browser.
// If it's not set yet, we use mocks.
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;

// Pretend to be the server: wait 1.5s like the AI is "thinking", then return fake data.
async function fakeSubmit(): Promise<SubmitResult> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return mockResult;
}

// /submit said no. `status` is the HTTP status: 503 = the AI is out of free requests (the turn
// is over), 502 = the AI had a problem (send again), 403 = not your turn or time's up.
// `message` is the server's own explanation, ready to show the player.
export class SubmitError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// The part both kinds of description share: add the room + player, send, read the reply.
async function send(form: FormData, roomCode: string, playerId: string): Promise<SubmitResult> {
  // Tell the server which room and player this description belongs to.
  form.append("roomCode", roomCode);
  form.append("playerId", playerId);

  // Send it. Don't set Content-Type yourself; the browser adds the right one for FormData.
  // The server answers once the turn is revealed (it waits for the guesses), so this can take a while.
  const res = await fetch(`${SERVER_URL}/submit`, { method: "POST", body: form });
  if (!res.ok) {
    // Errors come back as { error: "..." }; fall back to a generic line if they don't.
    const body = await res.json().catch(() => null);
    const message = typeof body?.error === "string" ? body.error : "Couldn't send that. Try again!";
    throw new SubmitError(res.status, message);
  }

  // The server replies with JSON shaped like SubmitResult (see lib/mocks.ts).
  return res.json();
}

// Voice: sends the recording as a file.
export async function submitAudio(
  audio: Blob,
  roomCode: string,
  playerId: string,
): Promise<SubmitResult> {
  if (!SERVER_URL) return fakeSubmit();

  // FormData is how browsers send files over HTTP (same as a file upload form).
  // The recording is always WAV (see lib/mic.ts).
  const form = new FormData();
  form.append("audio", audio, "description.wav");
  return send(form, roomCode, playerId);
}
