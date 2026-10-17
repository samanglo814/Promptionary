import { randomUUID } from "node:crypto";
import { Router } from "express";

// Images Gemini drew, kept in memory and served at GET /images/:id so the big screen can load them.
// Only the newest `limit` are kept (enough for the Hall of Shame); older ones are dropped.
export class ImageStore {
  private images = new Map<string, { data: Buffer; mimeType: string }>();

  constructor(
    private publicUrl: string,
    private limit = 100,
  ) {}

  // Stores an image and returns the absolute URL browsers can load it from.
  add(data: Buffer, mimeType: string): string {
    const id = randomUUID();
    this.images.set(id, { data, mimeType });
    while (this.images.size > this.limit) {
      this.images.delete(this.images.keys().next().value!);
    }
    return `${this.publicUrl.replace(/\/$/, "")}/images/${id}`;
  }

  router(): Router {
    const router = Router();
    router.get("/images/:id", (req, res) => {
      const image = this.images.get(req.params.id);
      if (!image) {
        res.status(404).end();
        return;
      }
      res.type(image.mimeType).set("Cache-Control", "public, max-age=86400").send(image.data);
    });
    return router;
  }
}
