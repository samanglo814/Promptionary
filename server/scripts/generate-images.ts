import "dotenv/config";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { Modality } from "@google/genai";
import { geminiClient } from "../src/ai/gemini.js";
import { toJpeg } from "../src/ai/jpeg.js";
import { loadTargets, targetImageFile, targetImagesDir } from "../src/targets.js";

// Draws the target images in data/targets.json with Gemini, into data/images/<id>.jpg.
//   npm run generate:images                      only targets without an image yet
//   npm run generate:images -- frog-wedding      just these ids (redraws them)
//   npm run generate:images -- --all             redraws everything
// Look at the results before committing; rerun an id until you like it.
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("Set GEMINI_API_KEY (in .env or the environment)");
const generate = geminiClient(apiKey);
const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

const args = process.argv.slice(2);
const targets = loadTargets("http://localhost");
const unknown = args.filter((a) => a !== "--all" && !targets.some((t) => t.id === a));
if (unknown.length) throw new Error(`No such target: ${unknown.join(", ")}`);
const todo = args.includes("--all")
  ? targets
  : args.length
    ? targets.filter((t) => args.includes(t.id))
    : targets.filter((t) => !existsSync(targetImageFile(t.id)));

const style =
  "A bright, funny cartoon illustration with bold shapes and clear details, one scene filling the square frame, " +
  "no text, letters or signs. The scene: ";

mkdirSync(targetImagesDir, { recursive: true });
console.log(todo.length ? `Drawing ${todo.length} target(s) with ${model}...` : "Every target has an image. Pass ids or --all to redraw.");

const failed: string[] = [];
// A few at a time, to stay under the rate limit.
for (let i = 0; i < todo.length; i += 3) {
  await Promise.all(
    todo.slice(i, i + 3).map(async (t) => {
      try {
        const res = await generate({
          model,
          contents: style + t.prompt,
          config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: "1:1" } },
        });
        const image = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
        if (!image?.data) throw new Error(`no image (${res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason})`);
        writeFileSync(targetImageFile(t.id), await toJpeg(Buffer.from(image.data, "base64")));
        console.log(`  ✓ ${t.id}`);
      } catch (err) {
        failed.push(t.id);
        console.log(`  ✗ ${t.id}: ${err instanceof Error ? err.message : err}`);
      }
    }),
  );
}
if (failed.length) {
  console.log(`\nFailed: ${failed.join(" ")}  (rerun with those ids, or reword their prompts)`);
  process.exitCode = 1;
}
