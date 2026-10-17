import "dotenv/config";
import { createGameServer } from "./app.js";
import { createGeminiAi, geminiClient } from "./ai/gemini.js";
import { ImageStore } from "./ai/images.js";

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
const ai = apiKey
  ? createGeminiAi({
      generate: geminiClient(apiKey),
      textModel: process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest",
      imageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
      images,
    })
  : undefined;

const server = createGameServer({ clientOrigin, ai, images, publicUrl });
const actualPort = await server.listen(port);
console.log(`Server listening on http://localhost:${actualPort} (web app: ${clientOrigin.join(", ")})`);
console.log(apiKey ? `AI: Gemini (images served from ${publicUrl})` : "AI: fake (set GEMINI_API_KEY for the real one)");
