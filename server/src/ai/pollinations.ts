import { toJpeg } from "./jpeg.js";

// A free image generator that needs no key or billing (pollinations.ai), for when the Gemini
// image model isn't available. Gemini still transcribes, scores, and writes the caption.
// Turn it on with IMAGE_PROVIDER=pollinations.
const BASE_URL = "https://image.pollinations.ai/prompt/";
// It's slower than Gemini: a drawing can take 10–30s.
const TIMEOUT_MS = 60_000;

export async function drawWithPollinations(prompt: string, fetchImage: typeof fetch = fetch) {
  const url = `${BASE_URL}${encodeURIComponent(prompt)}?width=768&height=768&nologo=true`;
  const res = await fetchImage(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Pollinations returned ${res.status}`);
  return { data: await toJpeg(Buffer.from(await res.arrayBuffer())), mimeType: "image/jpeg" };
}
