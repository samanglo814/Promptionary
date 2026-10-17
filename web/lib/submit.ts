// Sends a recording to the server's /submit endpoint and gets back the round result
// (transcript, AI image, score, caption).
//
// Until the server exists, it returns the mock result instead, so the frontend
// can be built and tested on its own.

import { mockResult, type SubmitResult } from "./mocks";

// Where the server lives, read from web/.env (e.g. NEXT_PUBLIC_SERVER_URL=http://localhost:4000).
// The NEXT_PUBLIC_ prefix is what makes it available in the browser.
// If it's not set yet, we use mocks.
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;

export async function submitAudio(
  audio: Blob,
  roomCode: string,
  playerId: string,
): Promise<SubmitResult> {
  // No server yet: wait 1.5s to feel like the AI is "thinking", then return fake data.
  if (!SERVER_URL) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return mockResult;
  }

  // FormData is how browsers send files over HTTP (same as a file upload form).
  const form = new FormData();
  // Name the file by its format so the server knows what it's getting:
  // iPhone gives mp4 audio (.m4a), Chrome/Android gives .webm.
  const ext = audio.type.includes("mp4") ? "m4a" : "webm";
  form.append("audio", audio, `description.${ext}`);
  // Tell the server which room and player this recording belongs to.
  form.append("roomCode", roomCode);
  form.append("playerId", playerId);

  // Send it. Don't set Content-Type yourself; the browser adds the right one for FormData.
  const res = await fetch(`${SERVER_URL}/submit`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`/submit failed: ${res.status}`);

  // The server replies with JSON shaped like SubmitResult (see lib/mocks.ts).
  return res.json();
}