// The look of the target cards in data/images/. Every drawing gets the same style preface, so the AI's
// drawing and the secret image look like they came from the same deck, and the judge compares what's in
// them (subject, action, setting) instead of marking a photo-real drawing down for not being a cartoon.
// `npm run generate:images` uses it too, so new cards match the old ones.
export const cardStyle =
  "Style: a bright, funny cartoon illustration, like a page from a children's picture book. " +
  "Clean, confident black ink outlines; flat, saturated colors with soft cel shading; " +
  "cute, expressive characters with big round eyes and exaggerated, readable poses; " +
  "a cheerful, detailed background that shows the setting. One scene filling the square frame. " +
  "Not a photo, not 3D, not realistic. No text, letters, words, numbers or signs anywhere in the image.";

// What the drawing models get: the style first, then the scene.
export function styledPrompt(scene: string): string {
  return `${cardStyle}\nThe scene: ${scene}`;
}
