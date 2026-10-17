import assert from "node:assert/strict";
import { test } from "node:test";
import { drawWithPollinations } from "../src/ai/pollinations.js";

// A real 1×1 PNG, since drawings are converted to JPEG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

test("pollinations sends the prompt in the URL and returns a JPEG", async () => {
  let requested = "";
  const fakeFetch = (async (url: string) => {
    requested = url;
    return new Response(png);
  }) as typeof fetch;
  const drawn = await drawWithPollinations("a dog & a plank", fakeFetch);
  assert.match(requested, /^https:\/\/image\.pollinations\.ai\/prompt\/a%20dog%20%26%20a%20plank\?/);
  assert.equal(drawn.mimeType, "image/jpeg");
  assert.equal(drawn.data[0], 0xff); // JPEG magic bytes
});

test("pollinations errors are thrown, so the describer gets their turn back", async () => {
  const fakeFetch = (async () => new Response("busy", { status: 429 })) as typeof fetch;
  await assert.rejects(drawWithPollinations("a dog", fakeFetch), /Pollinations returned 429/);
});
