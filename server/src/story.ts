import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Ai, StoryTurn } from "./ai/index.js";
import type { StoryPage, Storybook } from "./types.js";

// The end-of-game storybook (docs/data-contract.md, "Storybook"): every turn as a picture-book page,
// narrated by one AI call. The host shows it after the Hall of Shame, and its link (a QR code on the
// last page) opens it on anyone's phone for a few hours after the game.

const fallbackTitle = "The Night the AI Tried Its Best";

// A turn as the Room hands it over: the page without its narration, plus what the storyteller needs.
export type StoryDraft = Omit<StoryPage, "narration"> & { target: string };

// Writes the storybook. If the AI can't (down, out of requests, a bad answer), each page's caption
// becomes its narration, so the storybook never costs the game anything.
export async function writeStory(ai: Ai, drafts: StoryDraft[], winner: string | null): Promise<Storybook> {
  let story: { title: string; lines: string[] } | undefined;
  if (drafts.length > 0) {
    try {
      const turns: StoryTurn[] = drafts.map(({ playerName, target, transcript, caption, score, refused }) => ({
        playerName,
        target,
        transcript,
        caption,
        score,
        refused: Boolean(refused),
      }));
      story = await ai.narrate(turns);
      if (story.lines.length !== drafts.length) throw new Error(`got ${story.lines.length} lines for ${drafts.length} pages`);
    } catch (err) {
      console.error("Narrating the storybook failed, using the captions:", err);
      story = undefined;
    }
  }
  return {
    id: randomUUID(),
    title: story?.title || fallbackTitle,
    createdAt: Date.now(),
    winner,
    pages: drafts.map((d, i) => ({
      round: d.round,
      playerName: d.playerName,
      targetImageUrl: d.targetImageUrl,
      imageUrl: d.imageUrl,
      transcript: d.transcript,
      score: d.score,
      caption: d.caption,
      narration: story?.lines[i] ?? d.caption,
      bestGuess: d.bestGuess,
      ...(d.refused ? { refused: true } : {}),
    })),
  };
}

// Finished storybooks, in memory, served at GET /stories/:id. Each is kept for `ttlMs`, and only the
// newest `limit` are kept. The drawings they show live in the ImageStore, which keeps enough for them.
export class StoryStore {
  private stories = new Map<string, { story: Storybook; expiresAt: number }>();

  constructor(
    private ttlMs: number,
    private limit: number,
  ) {}

  add(story: Storybook) {
    this.stories.set(story.id, { story, expiresAt: Date.now() + this.ttlMs });
    while (this.stories.size > this.limit) this.stories.delete(this.stories.keys().next().value!);
  }

  get(id: string): Storybook | undefined {
    const entry = this.stories.get(id);
    if (entry && Date.now() > entry.expiresAt) this.stories.delete(id);
    return this.stories.get(id)?.story;
  }

  router(): Router {
    const router = Router();
    router.get("/stories/:id", (req, res) => {
      const story = this.get(req.params.id);
      if (!story) {
        res.status(404).json({ error: "This storybook has closed." });
        return;
      }
      res.json(story);
    });
    return router;
  }
}
