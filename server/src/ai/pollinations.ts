import { toJpeg } from "./jpeg.js";

// A free image generator that needs no key or billing (pollinations.ai), for when the Gemini
// image model isn't available. Gemini still transcribes, scores, and writes the caption.
// Turn it on with IMAGE_PROVIDER=pollinations.
const BASE_URL = "https://image.pollinations.ai/prompt/";
// It's slower than Gemini: a drawing can take 10–30s.
const TIMEOUT_MS = 60_000;
// Without a token, requests too close together get a 402 or 429. Wait and try once more.
const RATE_LIMITED = new Set([402, 429]);
const RETRY_DELAY_MS = 10_000;

export type PollinationsOptions = {
  // A free token from auth.pollinations.ai raises the rate limit. Optional.
  token?: string;
  fetchImage?: typeof fetch;
  retryDelayMs?: number;
};

export async function drawWithPollinations(prompt: string, options: PollinationsOptions = {}) {
  const { token, fetchImage = fetch, retryDelayMs = RETRY_DELAY_MS } = options;
  const url = `${BASE_URL}${encodeURIComponent(prompt)}?width=768&height=768&nologo=true`;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  for (let attempt = 1; ; attempt++) {
    const res = await fetchImage(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) return { data: await toJpeg(Buffer.from(await res.arrayBuffer())), mimeType: "image/jpeg" };
    if (attempt >= 2 || !RATE_LIMITED.has(res.status)) throw new Error(`Pollinations returned ${res.status}`);
    console.warn(`Pollinations returned ${res.status}, retrying in ${retryDelayMs / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
