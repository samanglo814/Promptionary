// Scores a typed guess against the secret image's description by shared words, 0–100.
// Used by the fake AI, and by the server when Gemini can't score the guesses.

const filler = new Set([
  "the", "and", "with", "its", "his", "her", "their", "while", "through", "down", "near", "every",
  "one", "some", "from", "into", "like", "that", "this", "are", "has", "for", "out", "all", "off",
]);

// "riding" → "rid", "dogs" → "dog", so small differences in wording still match.
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function contentWords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return [...new Set(words.filter((w) => w.length >= 3 && !filler.has(w)).map(stem))];
}

// Naming 3 of the image's words is a perfect match. Extra words that miss lower the score,
// so listing every animal you can think of doesn't pay.
export function wordMatchScore(prompt: string, guess: string): number {
  const wanted = new Set(contentWords(prompt));
  const said = contentWords(guess);
  if (wanted.size === 0 || said.length === 0) return 0;
  const hits = said.filter((w) => wanted.has(w)).length;
  const coverage = Math.min(1, hits / Math.min(3, wanted.size));
  const precision = hits / said.length;
  return Math.round(100 * coverage * (0.5 + 0.5 * precision));
}
