import { Modality } from "@google/genai";
import { writeFileSync, mkdirSync } from "node:fs";
import { createGeminiAi, geminiClient } from "../src/ai/gemini.js";
import { ImageStore } from "../src/ai/images.js";
import { loadTargets } from "../src/targets.js";

// Live smoke test of the Gemini pipeline: npm run live:gemini [-- out-dir]
// Needs GEMINI_API_KEY. Runs a few text rounds and saves the drawn images (and stand-in targets).
// Set LIVE_REAL_TARGETS=1 to compare against the real target URLs instead.
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("Set GEMINI_API_KEY");
const outDir = process.argv[2] ?? "live-output";
mkdirSync(outDir, { recursive: true });

const targets = loadTargets();
const images = new ImageStore("http://localhost");
const generate = geminiClient(apiKey);
const imageModel = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

// Targets are still placeholders, so draw a stand-in for each one from its id.
async function drawTarget(url: string) {
  const t = targets.find((t) => t.imageUrl === url)!;
  const res = await generate({
    model: imageModel,
    contents: `A funny, colorful illustration of: ${t.id.replace(/-/g, " ")}. No text.`,
    config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: "1:1" } },
  });
  const image = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!image?.data) throw new Error(`No target image for ${t.id}`);
  const data = Buffer.from(image.data, "base64");
  writeFileSync(`${outDir}/${t.id}.target.png`, data);
  return { data, mimeType: image.mimeType ?? "image/png" };
}

const ai = createGeminiAi({
  generate,
  loadImage: process.env.LIVE_REAL_TARGETS ? undefined : drawTarget,
  textModel: process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest",
  imageModel,
  images,
});
const target = (id: string) => targets.find((t) => t.id === id)!;

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
  if (stored) writeFileSync(`${outDir}/${c.target.id}.png`, stored.data);
  console.log(JSON.stringify({ target: c.target.id, transcript, ms, ...drawing }, null, 1));
}
