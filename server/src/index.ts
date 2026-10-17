import "dotenv/config";
import { createGameServer } from "./app.js";
import { createGeminiAi, geminiClient } from "./ai/gemini.js";
import { ImageStore } from "./ai/images.js";
import { drawWithPollinations } from "./ai/pollinations.js";

const port = Number(process.env.PORT ?? 4000);
const clientOrigin = (process.env.CLIENT_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
// The server's own address as browsers see it, for the URLs of images the AI draws.
const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;

// Real Gemini when there's a key, otherwise the fake AI.
const apiKey = process.env.GEMINI_API_KEY;
const images = new ImageStore(publicUrl);
const pollinations = (prompt: string) => drawWithPollinations(prompt, { token: process.env.POLLINATIONS_TOKEN });
const usePollinations = process.env.IMAGE_PROVIDER === "pollinations";
const ai = apiKey
  ? createGeminiAi({
      generate: geminiClient(apiKey),
      textModel: process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest",
      transcribeModel: process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-flash-lite-latest",
      imageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
      drawImage: usePollinations ? pollinations : undefined,
      // The Gemini image model needs billing; without it, Pollinations draws instead.
      fallbackDrawImage: usePollinations ? undefined : pollinations,
      images,
    })
  : undefined;

const server = createGameServer({ clientOrigin, ai, images, publicUrl });
const actualPort = await server.listen(port);
console.log(`Server listening on http://localhost:${actualPort} (web app: ${clientOrigin.join(", ")})`);
const drawer = process.env.IMAGE_PROVIDER === "pollinations" ? "Pollinations" : "Gemini";
console.log(
  apiKey
    ? `AI: Gemini, drawn by ${drawer} (images served from ${publicUrl})`
    : "AI: fake (set GEMINI_API_KEY for the real one)",
);
