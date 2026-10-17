// The banned-word check, run on the transcript.

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

// "dog" also catches "dogs"; "puppy" also catches "puppies"; "bus" catches "buses".
function sameWord(said: string, banned: string): boolean {
  if (said === banned || said === `${banned}s` || said === `${banned}es`) return true;
  return banned.endsWith("y") && said === `${banned.slice(0, -1)}ies`;
}

// Which banned words (or phrases like "hot dog") appear in the transcript.
// Each banned word counts once, however many times it was said.
export function findBannedWords(transcript: string, bannedWords: string[]): string[] {
  const said = words(transcript);
  return bannedWords.filter((banned) => {
    const parts = words(banned);
    if (parts.length === 0) return false;
    for (let i = 0; i + parts.length <= said.length; i++) {
      const matches = parts.every((part, j) =>
        j === parts.length - 1 ? sameWord(said[i + j]!, part) : said[i + j] === part,
      );
      if (matches) return true;
    }
    return false;
  });
}
