// Sends a player's description to the server's /submit endpoint and gets back the
// round result (transcript, AI image, score, caption).
// A description can be a voice recording (submitAudio) or typed text (submitText).
//
// Until the server exists, both return the mock result instead, so the frontend
// can be built and tested on its own.

import { mockResult, type SubmitResult } from "./mocks";

// Where the server lives, read from web/.env (e.g. NEXT_PUBLIC_SERVER_URL=http://localhost:4000).
// The NEXT_PUBLIC_ prefix is what makes it available in the browser.
// If it's not set yet, we use mocks.
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;

// Pretend to be the server: wait 1.5s like the AI is "thinking", then return fake data.
async function fakeSubmit(transcript?: string): Promise<SubmitResult> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  // If we know what they said (typed text), show it back so testing feels real.
  return transcript ? { ...mockResult, transcript } : mockResult;
}

// The part both kinds of description share: add the room + player, send, read the reply.
async function send(form: FormData, roomCode: string, playerId: string): Promise<SubmitResult> {
  // Tell the server which room and player this description belongs to.
  form.append("roomCode", roomCode);
  form.append("playerId", playerId);

  // Send it. Don't set Content-Type yourself; the browser adds the right one for FormData.
  const res = await fetch(`${SERVER_URL}/submit`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`/submit failed: ${res.status}`);

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
  const form = new FormData();
  // Name the file by its format so the server knows what it's getting:
  // iPhone gives mp4 audio (.m4a), Chrome/Android gives .webm.
  const ext = audio.type.includes("mp4") ? "m4a" : "webm";
  form.append("audio", audio, `description.${ext}`);
  return send(form, roomCode, playerId);
}

// Typed: sends the text instead of a file. Same endpoint, so the server only
// needs one /submit: if there's a "text" field it skips transcription.
export async function submitText(
  text: string,
  roomCode: string,
  playerId: string,
): Promise<SubmitResult> {
  if (!SERVER_URL) return fakeSubmit(text);

  const form = new FormData();
  form.append("text", text);
  return send(form, roomCode, playerId);
}