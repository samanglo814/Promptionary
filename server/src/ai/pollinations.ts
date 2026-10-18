import { createHash } from "node:crypto";
import { toJpeg } from "./jpeg.js";

// A free image generator that needs no key or billing (pollinations.ai), for when the Gemini
// image model isn't available. Gemini still transcribes, scores, and writes the caption.
// Turn it on with IMAGE_PROVIDER=pollinations.
const BASE_URL = "https://image.pollinations.ai/prompt/";
// It's slower than Gemini: a drawing can take 10–30s. Longer than this, and the fallback drawer is faster.
const TIMEOUT_MS = 30_000;
// Without a token, requests too close together get a 402 or 429. Wait and try once more.
const RATE_LIMITED = new Set([402, 429]);
const RETRY_DELAY_MS = 10_000;

// When it's rate limiting, Pollinations can answer 200 with its own notice picture instead of a drawing,
// the same one whatever the prompt. Each drawing's fingerprint and prompt are kept, so the same picture
// coming back for a different prompt counts as a failure instead of being shown as the AI's drawing.
const recentDrawings = new Map<string, string>();
const RECENT_LIMIT = 50;

export type PollinationsOptions = {
  // A free token from auth.pollinations.ai raises the rate limit. Optional.
  token?: string;
  fetchImage?: typeof fetch;
  retryDelayMs?: number;
  recent?: Map<string, string>; // fingerprint → prompt; tests pass their own
  // Wait and try again when rate limited. Off when another drawer can take over, which is faster.
  retry?: boolean;
};

export async function drawWithPollinations(prompt: string, options: PollinationsOptions = {}) {
  const { token, fetchImage = fetch, retryDelayMs = RETRY_DELAY_MS, recent = recentDrawings, retry = true } = options;
  const url = `${BASE_URL}${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  for (let attempt = 1; ; attempt++) {
    const res = await fetchImage(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) {
      const data = Buffer.from(await res.arrayBuffer());
      const fingerprint = createHash("sha256").update(data).digest("hex");
      const earlierPrompt = recent.get(fingerprint);
      if (earlierPrompt !== undefined && earlierPrompt !== prompt) {
        throw new Error("Pollinations sent the same picture for a different prompt (probably its rate-limit notice)");
      }
      recent.set(fingerprint, prompt);
      if (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value!);
      return { data: await toJpeg(data), mimeType: "image/jpeg" };
    }
    if (!retry || attempt >= 2 || !RATE_LIMITED.has(res.status)) throw new Error(`Pollinations returned ${res.status}`);
    console.warn(`Pollinations returned ${res.status}, retrying in ${retryDelayMs / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
