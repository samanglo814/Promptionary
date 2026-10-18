import assert from "node:assert/strict";
import { test } from "node:test";
import { firstDrawing } from "../src/ai/race.js";

const picture = (name: string) => ({ data: Buffer.from(name), mimeType: "image/jpeg" });
const after = <T>(ms: number, value: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(value()), ms));

test("the first drawing back is used", async () => {
  const draw = firstDrawing([() => after(50, () => picture("slow")), () => after(5, () => picture("fast"))]);
  assert.equal((await draw("a dog"))!.data.toString(), "fast");
});

test("a failing drawer drops out and the other one's drawing is used", async () => {
  const draw = firstDrawing([() => Promise.reject(new Error("no billing")), () => after(20, () => picture("ok"))]);
  assert.equal((await draw("a dog"))!.data.toString(), "ok");
});

test("when every drawer fails, the first one's error is thrown", async () => {
  const draw = firstDrawing([() => Promise.reject(new Error("no billing")), () => Promise.reject(new Error("429"))]);
  await assert.rejects(draw("a dog"), /no billing/);
});
