import {
  GoogleGenAI,
  Modality,
  Type,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import { readLocalTargetImage } from "../targets.js";
import type { Target } from "../types.js";
import type { ImageStore } from "./images.js";
import { toJpeg } from "./jpeg.js";
import type { Ai, Drawing } from "./index.js";

// The real AI pipeline (README, "AI pipeline"): transcribe → draw → score + caption.
// Banned words are checked by the Room between transcribe and draw.

// Every Gemini call gets this long per attempt, and one retry if it fails.
const CALL_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 500;

const refusalCaptions = [
  "Too spicy for the robot. Zero points, infinite respect.",
  "The AI took one look at that and called HR.",
  "Banned from the art studio. Again.",
];

const silenceCaption = "Total silence. The AI drew exactly what you said.";
const silenceImage = "https://placehold.co/512x512/png?text=*crickets*";

// Finish reasons that mean the image was blocked rather than something going wrong.
const blockedReasons = new Set([
  "SAFETY",
  "IMAGE_SAFETY",
  "PROHIBITED_CONTENT",
  "IMAGE_PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_RECITATION",
  "IMAGE_OTHER",
  "NO_IMAGE",
]);

export type Generate = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;

export type GeminiOptions = {
  textModel: string;
  imageModel: string;
  images: ImageStore;
  // Calls Gemini. Tests pass a fake; the server passes geminiClient(apiKey).
  generate: Generate;
  // Loads the target image so Gemini can compare it. Defaults to reading it from disk, or fetching imageUrl.
  loadImage?: (url: string) => Promise<{ data: Buffer; mimeType: string }>;
};

export function geminiClient(apiKey: string): Generate {
  const client = new GoogleGenAI({ apiKey });
  return (params) => client.models.generateContent(params);
}

export function createGeminiAi(options: GeminiOptions): Ai {
  const { textModel, imageModel, images } = options;
  const loadImage = cached(options.loadImage ?? (async (url) => readLocalTargetImage(url) ?? fetchImage(url)));

  // One retry, each attempt with its own timeout. Errors that won't go away (bad key, no credits) aren't retried.
  const generate: Generate = async (params) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await options.generate({
          ...params,
          config: { ...params.config, abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS) },
        });
      } catch (err) {
        const status = (err as { status?: unknown }).status;
        const permanent = typeof status === "number" && status >= 400 && status < 500 && status !== 429;
        if (attempt >= 2 || permanent) throw err;
        console.warn(`Gemini call failed, retrying:`, err);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  };

  return {
    async transcribe(description) {
      if (description.kind === "text") return description.text;
      const res = await generate({
        model: textModel,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: baseMimeType(description.mimeType), data: description.audio.toString("base64") } },
              {
                text:
                  "Transcribe exactly what the speaker says, word for word, including mistakes and filler words. " +
                  "Output only the transcript. If nobody speaks, output nothing.",
              },
            ],
          },
        ],
        config: { temperature: 0 },
      });
      return (res.text ?? "").trim();
    },

    async draw(transcript, target) {
      if (!transcript) {
        return { imageUrl: silenceImage, score: 0, gotRight: [], gotWrong: [], caption: silenceCaption };
      }

      // Start loading the target while the image is drawn.
      const targetImage = loadImage(target.imageUrl);
      targetImage.catch(() => {}); // awaited below; don't crash on an early rejection

      const drawn = await drawImage(generate, imageModel, transcript);
      if (!drawn) return refusal(transcript);

      const imageUrl = images.add(drawn.data, drawn.mimeType);
      const judged = await judge(generate, textModel, transcript, await targetImage, drawn, target);
      return { imageUrl, ...judged };
    },
  };
}

// Draws the transcript nearly verbatim, so the describer's mistakes stay in the picture.
// Returns undefined when Gemini refuses.
async function drawImage(generate: Generate, model: string, transcript: string) {
  const res = await generate({
    model,
    contents: `Draw this, exactly as described, as a single colorful illustration with no text: ${transcript}`,
    config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: "1:1" } },
  });

  const candidate = res.candidates?.[0];
  const image = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (image?.data) {
    return { data: await toJpeg(Buffer.from(image.data, "base64")), mimeType: "image/jpeg" };
  }
  // No image: blocked by safety filters, or the model answered in words instead (also a refusal).
  if (res.promptFeedback?.blockReason || blockedReasons.has(String(candidate?.finishReason)) || candidate) {
    return undefined;
  }
  throw new Error("Gemini returned no image and no reason.");
}

// Compares the two images and writes the roast, in one call.
async function judge(
  generate: Generate,
  model: string,
  transcript: string,
  original: { data: Buffer; mimeType: string },
  drawn: { data: Buffer; mimeType: string },
  target: Target,
): Promise<Omit<Drawing, "imageUrl">> {
  const parts: Part[] = [
    { text: "Image A, the secret original:" },
    { inlineData: { mimeType: original.mimeType, data: original.data.toString("base64") } },
    { text: `Image B, what an AI drew from the player's description: "${transcript}"` },
    { inlineData: { mimeType: drawn.mimeType, data: drawn.data.toString("base64") } },
    {
      text:
        "This is a party game: a player described image A without seeing B, and the AI drew B from their words. " +
        `For reference, image A shows: ${target.id.replace(/-/g, " ")}.\n` +
        "- score: 0–100, how well B matches A's subject, action, and setting. Be honest; most rounds land 20–70.\n" +
        "- what_it_got_right / what_it_got_wrong: up to 3 short phrases each (2–5 words), about the images.\n" +
        "- caption: one playful roast line, at most 15 words, about the mismatch. Tease the AI or the description, " +
        "never insult the player.",
    },
  ];

  const res = await generate({
    model,
    contents: [{ role: "user", parts }],
    config: {
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.INTEGER },
          what_it_got_right: { type: Type.ARRAY, items: { type: Type.STRING } },
          what_it_got_wrong: { type: Type.ARRAY, items: { type: Type.STRING } },
          caption: { type: Type.STRING },
        },
        required: ["score", "what_it_got_right", "what_it_got_wrong", "caption"],
      },
    },
  });

  return parseJudgement(res.text ?? "");
}

// Gemini's snake_case JSON → the contract's camelCase, with anything odd cleaned up.
export function parseJudgement(json: string): Omit<Drawing, "imageUrl"> {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const phrases = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()).slice(0, 3)
      : [];
  const score = Number(raw.score);
  return {
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    gotRight: phrases(raw.what_it_got_right),
    gotWrong: phrases(raw.what_it_got_wrong),
    caption: typeof raw.caption === "string" && raw.caption.trim() ? raw.caption.trim() : "The AI has no words.",
  };
}

function refusal(transcript: string): Drawing {
  let h = 0;
  for (const ch of transcript) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    imageUrl: "",
    score: 0,
    gotRight: [],
    gotWrong: [],
    caption: refusalCaptions[h % refusalCaptions.length]!,
    refused: true,
  };
}

// Phones send e.g. "audio/webm;codecs=opus"; Gemini wants just "audio/webm".
function baseMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0]!.trim();
  return base === "video/webm" ? "audio/webm" : base || "audio/webm";
}

async function fetchImage(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Couldn't load target image ${url}: ${res.status}`);
  return {
    data: Buffer.from(await res.arrayBuffer()),
    mimeType: res.headers.get("content-type")?.split(";")[0] ?? "image/png",
  };
}

// Target images are reused every game, so load each once (and try again if loading failed).
function cached<T>(load: (url: string) => Promise<T>): (url: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return (url) => {
    let promise = cache.get(url);
    if (!promise) {
      promise = load(url);
      cache.set(url, promise);
      promise.catch(() => cache.delete(url));
    }
    return promise;
  };
}
