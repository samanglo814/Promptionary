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
  const drawn = await drawWithPollinations("a dog & a plank", { fetchImage: fakeFetch });
  assert.match(requested, /^https:\/\/image\.pollinations\.ai\/prompt\/a%20dog%20%26%20a%20plank\?/);
  assert.equal(drawn.mimeType, "image/jpeg");
  assert.equal(drawn.data[0], 0xff); // JPEG magic bytes
});

test("pollinations retries once when rate limited", async () => {
  const statuses = [402, 200];
  const fakeFetch = (async () => {
    const status = statuses.shift()!;
    return status === 200 ? new Response(png) : new Response("slow down", { status });
  }) as typeof fetch;
  const drawn = await drawWithPollinations("a dog", { fetchImage: fakeFetch, retryDelayMs: 0 });
  assert.equal(drawn.mimeType, "image/jpeg");
});

test("pollinations sends the token when there is one", async () => {
  let auth: string | null = null;
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    auth = new Headers(init?.headers).get("authorization");
    return new Response(png);
  }) as typeof fetch;
  await drawWithPollinations("a dog", { fetchImage: fakeFetch, token: "secret" });
  assert.equal(auth, "Bearer secret");
});

test("pollinations errors are thrown, so the describer gets their turn back", async () => {
  let calls = 0;
  const fakeFetch = (async () => {
    calls++;
    return new Response("busy", { status: 429 });
  }) as typeof fetch;
  await assert.rejects(drawWithPollinations("a dog", { fetchImage: fakeFetch, retryDelayMs: 0 }), /Pollinations returned 429/);
  assert.equal(calls, 2);
});
