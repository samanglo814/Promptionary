import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Target } from "./types.js";

// One entry in data/targets.json. `difficulty` and `prompt` stay on the server; phones only get a Target.
// `prompt` is what `npm run generate:images` draws. `imageUrl` is optional and overrides the generated image.
export type TargetEntry = Target & { difficulty: number; prompt: string };

// Generated target images: data/images/<id>.jpg, served at /targets/<id>.jpg.
export const targetImagesDir = fileURLToPath(new URL("../data/images/", import.meta.url));

export function targetImageFile(id: string): string {
  return `${targetImagesDir}${id}.jpg`;
}

// `publicUrl` is the server's address as browsers see it, for the image URLs.
export function loadTargets(publicUrl: string): TargetEntry[] {
  const file = new URL("../data/targets.json", import.meta.url);
  const targets = JSON.parse(readFileSync(file, "utf8")) as (Omit<TargetEntry, "imageUrl"> & { imageUrl?: string })[];
  return targets.map((t) => {
    if (!t.id || !/^[a-z0-9-]+$/.test(t.id) || !t.prompt || !Array.isArray(t.bannedWords)) {
      throw new Error(`Bad entry in data/targets.json: ${JSON.stringify(t)}`);
    }
    return {
      ...t,
      imageUrl: t.imageUrl ?? targetImageUrl(t.id, publicUrl),
      bannedWords: t.bannedWords.map((w) => w.toLowerCase()),
    };
  });
}

// Until `npm run generate:images` has drawn a target, it shows a placeholder with its id.
function targetImageUrl(id: string, publicUrl: string): string {
  if (existsSync(targetImageFile(id))) return `${publicUrl.replace(/\/$/, "")}/targets/${id}.jpg`;
  return `https://placehold.co/512x512/png?text=${encodeURIComponent(id.replace(/-/g, " "))}`;
}

// Reads a target image from disk when the URL points at /targets/, so the AI doesn't have to fetch it over HTTP.
export function readLocalTargetImage(url: string): { data: Buffer; mimeType: string } | undefined {
  const id = /\/targets\/([a-z0-9-]+)\.jpg$/.exec(url)?.[1];
  if (!id || !existsSync(targetImageFile(id))) return undefined;
  return { data: readFileSync(targetImageFile(id)), mimeType: "image/jpeg" };
}

// A random target this room hasn't seen yet (starts over once all are used).
// The server keeps the whole entry (guesses are scored against `prompt`); phones get publicTarget().
export function pickTarget(targets: TargetEntry[], used: Set<string>): TargetEntry {
  let fresh = targets.filter((t) => !used.has(t.id));
  if (fresh.length === 0) {
    used.clear();
    fresh = targets;
  }
  const t = fresh[Math.floor(Math.random() * fresh.length)]!;
  used.add(t.id);
  return t;
}

// What the describer's phone sees: no prompt, so the answer isn't sitting in the page.
export function publicTarget({ id, imageUrl, bannedWords }: TargetEntry): Target {
  return { id, imageUrl, bannedWords };
}
