import assert from "node:assert/strict";
import { test } from "node:test";
import { findBannedWords } from "../src/bannedWords.js";

test("catches whole words regardless of case and punctuation", () => {
  assert.deepEqual(findBannedWords("It's a DOG! On a skateboard.", ["dog", "skateboard", "wheels"]), ["dog", "skateboard"]);
});

test("catches simple plurals", () => {
  assert.deepEqual(findBannedWords("two dogs, three puppies, some buses", ["dog", "puppy", "bus"]), ["dog", "puppy", "bus"]);
});

test("does not match inside other words", () => {
  assert.deepEqual(findBannedWords("a hotdog and some catalogs", ["dog", "cat"]), []);
});

test("matches multi-word phrases", () => {
  assert.deepEqual(findBannedWords("I ate two hot dogs", ["hot dog"]), ["hot dog"]);
  assert.deepEqual(findBannedWords("hot sauce on a dog", ["hot dog"]), []);
});

test("each banned word counts once", () => {
  assert.deepEqual(findBannedWords("dog dog dog", ["dog"]), ["dog"]);
});

test("empty transcript says nothing banned", () => {
  assert.deepEqual(findBannedWords("", ["dog"]), []);
});
