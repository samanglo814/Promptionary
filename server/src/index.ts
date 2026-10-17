import "dotenv/config";
import { createGameServer } from "./app.js";
import { createGeminiAi, geminiClient, vertexClient } from "./ai/gemini.js";
import { ImageStore } from "./ai/images.js";
import { drawWithPollinations } from "./ai/pollinations.js";

const port = Number(process.env.PORT ?? 4000);
const clientOrigin = (process.env.CLIENT_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
// The server's own address as browsers see it, for the URLs of images the AI draws.
const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;

// Real Gemini through Vertex AI (VERTEX_PROJECT) or an AI Studio key (GEMINI_API_KEY),
// otherwise the fake AI.
const apiKey = process.env.GEMINI_API_KEY;
const vertexProject = process.env.VERTEX_PROJECT;
const vertexLocation = process.env.VERTEX_LOCATION || "global";
const generate = vertexProject ? vertexClient(vertexProject, vertexLocation) : apiKey ? geminiClient(apiKey) : undefined;
const images = new ImageStore(publicUrl);
const ai = generate
  ? createGeminiAi({
      generate,
      textModel: process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest",
      imageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
      drawImage: process.env.IMAGE_PROVIDER === "pollinations"
        ? (prompt) => drawWithPollinations(prompt, { token: process.env.POLLINATIONS_TOKEN })
        : undefined,
      images,
    })
  : undefined;

const server = createGameServer({ clientOrigin, ai, images, publicUrl });
const actualPort = await server.listen(port);
console.log(`Server listening on http://localhost:${actualPort} (web app: ${clientOrigin.join(", ")})`);
const drawer = process.env.IMAGE_PROVIDER === "pollinations" ? "Pollinations" : "Gemini";
const via = vertexProject ? `Vertex AI, project ${vertexProject}` : "AI Studio key";
console.log(
  generate
    ? `AI: Gemini via ${via}, drawn by ${drawer} (images served from ${publicUrl})`
    : "AI: fake (set GEMINI_API_KEY or VERTEX_PROJECT for the real one)",
);
