import { readFileSync } from "node:fs";
import type { Target } from "./types.js";

// One entry in data/targets.json. `difficulty` stays on the server; phones only get a Target.
export type TargetEntry = Target & { difficulty: number };

export function loadTargets(): TargetEntry[] {
  const file = new URL("../data/targets.json", import.meta.url);
  const targets = JSON.parse(readFileSync(file, "utf8")) as TargetEntry[];
  for (const t of targets) {
    if (!t.id || !t.imageUrl || !Array.isArray(t.bannedWords)) {
      throw new Error(`Bad entry in data/targets.json: ${JSON.stringify(t)}`);
    }
    t.bannedWords = t.bannedWords.map((w) => w.toLowerCase());
  }
  return targets;
}

// A random target this room hasn't seen yet (starts over once all are used).
export function pickTarget(targets: TargetEntry[], used: Set<string>): Target {
  let fresh = targets.filter((t) => !used.has(t.id));
  if (fresh.length === 0) {
    used.clear();
    fresh = targets;
  }
  const t = fresh[Math.floor(Math.random() * fresh.length)]!;
  used.add(t.id);
  return { id: t.id, imageUrl: t.imageUrl, bannedWords: t.bannedWords };
}
