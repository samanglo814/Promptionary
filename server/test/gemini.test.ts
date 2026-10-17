import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { createGeminiAi, parseJudgement, type Generate } from "../src/ai/gemini.js";
import { ImageStore } from "../src/ai/images.js";

const target = { id: "dog-skateboard", imageUrl: "https://example.com/dog.png", bannedWords: ["dog"] };
// A real 1×1 PNG, since drawn images are converted to JPEG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

const imageResponse = {
  candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }],
} as unknown as GenerateContentResponse;

const textResponse = (text: string) => ({ text }) as unknown as GenerateContentResponse;

const judgement = JSON.stringify({
  score: 42,
  what_it_got_right: ["skateboard"],
  what_it_got_wrong: ["it's a cat, not a dog"],
  caption: "Close, if you squint.",
});

// A fake Gemini: image calls get `image`, text calls get `text`. Records every call.
function fakeGemini(
  responses: { image?: () => GenerateContentResponse; text?: () => GenerateContentResponse },
  drawImage?: (prompt: string) => Promise<{ data: Buffer; mimeType: string } | undefined>,
) {
  const calls: GenerateContentParameters[] = [];
  const generate: Generate = async (params) => {
    calls.push(params);
    const respond = params.model === "image-model" ? responses.image : responses.text;
    if (!respond) throw new Error(`unexpected call to ${params.model}`);
    return respond();
  };
  const images = new ImageStore("http://server.test/");
  const ai = createGeminiAi({
    generate,
    textModel: "text-model",
    imageModel: "image-model",
    drawImage,
    images,
    loadImage: async () => ({ data: png, mimeType: "image/png" }),
  });
  return { ai, calls, images };
}

describe("gemini ai", () => {
  test("typed text skips transcription", async () => {
    const { ai, calls } = fakeGemini({});
    assert.equal(await ai.transcribe({ kind: "text", text: "a furry thing" }), "a furry thing");
    assert.equal(calls.length, 0);
  });

  test("audio is sent with a plain mime type and the transcript is trimmed", async () => {
    const { ai, calls } = fakeGemini({ text: () => textResponse("  a dog on wheels \n") });
    const transcript = await ai.transcribe({ kind: "audio", audio: Buffer.from("audio"), mimeType: "audio/webm;codecs=opus" });
    assert.equal(transcript, "a dog on wheels");
    assert.match(JSON.stringify(calls[0]!.contents), /"mimeType":"audio\/webm"/);
  });

  test("a custom drawImage draws instead of the Gemini image model", async () => {
    const prompts: string[] = [];
    const drawImage = async (prompt: string) => {
      prompts.push(prompt);
      return { data: png, mimeType: "image/png" };
    };
    const { ai, calls } = fakeGemini({ text: () => textResponse(judgement) }, drawImage);
    const drawing = await ai.draw("a furry barking friend on a plank", target);
    assert.equal(drawing.score, 42);
    assert.match(prompts[0]!, /a furry barking friend on a plank/);
    assert.deepEqual(calls.map((c) => c.model), ["text-model"]);
  });

  test("draws, stores the image, and scores it", async () => {
    const { ai, calls } = fakeGemini({ image: () => imageResponse, text: () => textResponse(judgement) });
    const drawing = await ai.draw("a furry barking friend on a plank", target);
    assert.match(drawing.imageUrl, /^http:\/\/server\.test\/images\/[\w-]+$/);
    assert.deepEqual(
      { ...drawing, imageUrl: "" },
      { imageUrl: "", score: 42, gotRight: ["skateboard"], gotWrong: ["it's a cat, not a dog"], caption: "Close, if you squint." },
    );
    assert.match(String(calls[0]!.contents), /a furry barking friend on a plank/);
    assert.match(JSON.stringify(calls[1]!.contents), /"mimeType":"image\/jpeg"/);
  });

  test("a blocked image is a refusal, not an error", async () => {
    const blocked = { candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] } as unknown as GenerateContentResponse;
    const { ai, calls } = fakeGemini({ image: () => blocked });
    const drawing = await ai.draw("something spicy", target);
    assert.equal(drawing.refused, true);
    assert.equal(drawing.imageUrl, "");
    assert.equal(drawing.score, 0);
    assert.ok(drawing.caption);
    assert.equal(calls.length, 1, "no scoring call for a refusal");
  });

  test("a blocked prompt is a refusal too", async () => {
    const blocked = { promptFeedback: { blockReason: "SAFETY" } } as unknown as GenerateContentResponse;
    const { ai } = fakeGemini({ image: () => blocked });
    assert.equal((await ai.draw("something spicy", target)).refused, true);
  });

  test("an empty transcript scores 0 without calling Gemini", async () => {
    const { ai, calls } = fakeGemini({});
    const drawing = await ai.draw("", target);
    assert.equal(drawing.score, 0);
    assert.equal(calls.length, 0);
  });

  test("retries a failed call once", async () => {
    let failures = 1;
    const { ai, calls } = fakeGemini({
      image: () => {
        if (failures-- > 0) throw Object.assign(new Error("overloaded"), { status: 503 });
        return imageResponse;
      },
      text: () => textResponse(judgement),
    });
    assert.equal((await ai.draw("a dog", target)).score, 42);
    assert.equal(calls.length, 3);
  });

  test("doesn't retry errors that won't go away", async () => {
    const { ai, calls } = fakeGemini({
      image: () => {
        throw Object.assign(new Error("credits depleted"), { status: 402 });
      },
    });
    await assert.rejects(ai.draw("a dog", target), /credits depleted/);
    assert.equal(calls.length, 1);
  });

  test("parseJudgement cleans up odd values", () => {
    assert.deepEqual(
      parseJudgement(JSON.stringify({ score: 140.6, what_it_got_right: ["a", "", 3, "b", "c", "d"], what_it_got_wrong: "nope", caption: " " })),
      { score: 100, gotRight: ["a", "b", "c"], gotWrong: [], caption: "The AI has no words." },
    );
  });

  test("serves stored images and drops the oldest past the limit", async () => {
    const images = new ImageStore("http://server.test", 1);
    const first = images.add(Buffer.from("1"), "image/png");
    const second = images.add(Buffer.from("2"), "image/png");
    const router = images.router();
    const express = (await import("express")).default;
    const app = express().use(router);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    const get = (url: string) => fetch(url.replace("http://server.test", `http://localhost:${port}`));
    try {
      assert.equal((await get(first)).status, 404);
      const res = await get(second);
      assert.equal(res.headers.get("content-type"), "image/png");
      assert.equal(await res.text(), "2");
    } finally {
      server.close();
    }
  });
});
