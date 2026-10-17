import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { createGeminiAi, geminiClient } from "../src/ai/gemini.js";
import { ImageStore } from "../src/ai/images.js";
import { loadTargets } from "../src/targets.js";

// Live smoke test of the Gemini pipeline: npm run live:gemini [-- out-dir]
// Needs GEMINI_API_KEY and the target images (npm run generate:images). Runs a few text rounds
// and a silent one, and saves what Gemini drew.
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("Set GEMINI_API_KEY");
const outDir = process.argv[2] ?? "live-output";
mkdirSync(outDir, { recursive: true });

const targets = loadTargets("http://localhost");
const target = (id: string) => targets.find((t) => t.id === id)!;
const images = new ImageStore("http://localhost");
const ai = createGeminiAi({
  generate: geminiClient(apiKey),
  textModel: process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest",
  imageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
  images,
});

const cases = [
  { target: target("dog-skateboard"), text: "a furry four-legged pet riding a wooden plank with little rollers down a hill" },
  { target: target("astronaut-bath"), text: "a man in a big puffy white suit sitting in a tub full of bubbles" },
  { target: target("goose-attack"), text: "" },
];

for (const c of cases) {
  const started = Date.now();
  const transcript = await ai.transcribe({ kind: "text", text: c.text });
  const drawing = await ai.draw(transcript, c.target);
  const ms = Date.now() - started;
  const id = drawing.imageUrl.split("/images/")[1];
  const stored = id && (images as unknown as { images: Map<string, { data: Buffer }> }).images.get(id);
  if (stored) writeFileSync(`${outDir}/${c.target.id}.jpg`, stored.data);
  console.log(JSON.stringify({ target: c.target.id, transcript, ms, ...drawing }, null, 1));
}
