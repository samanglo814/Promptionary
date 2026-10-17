import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import { loadTargets, readLocalTargetImage, targetImageFile } from "../src/targets.js";

describe("targets", () => {
  const targets = loadTargets("http://server.test/");

  test("every target has a prompt, banned words, and an image URL", () => {
    assert.ok(targets.length >= 20);
    assert.equal(new Set(targets.map((t) => t.id)).size, targets.length, "ids are unique");
    for (const t of targets) {
      assert.ok(t.prompt && t.bannedWords.length > 0, t.id);
      const expected = existsSync(targetImageFile(t.id)) ? `http://server.test/targets/${t.id}.jpg` : /^https:\/\/placehold\.co\//;
      if (typeof expected === "string") assert.equal(t.imageUrl, expected);
      else assert.match(t.imageUrl, expected);
    }
  });

  test("generated images are read from disk, other URLs aren't", () => {
    const local = targets.find((t) => existsSync(targetImageFile(t.id)));
    if (local) assert.equal(readLocalTargetImage(local.imageUrl)?.mimeType, "image/jpeg");
    assert.equal(readLocalTargetImage("https://example.com/dog.png"), undefined);
    assert.equal(readLocalTargetImage("http://server.test/targets/not-a-target.jpg"), undefined);
  });
});
