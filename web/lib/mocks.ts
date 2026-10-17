/*
  MOCK DATA
  Fake data so the frontend can be built before the server exists.
  The types here are also the "data contract": the shapes the server will send.
*/

// A person in the room.
export type Player = { id: string; name: string; score: number };

// A player on the scoreboard. The server sends standings sorted, best first, with ties already broken.
export type Standing = Player & {
  lastTurn: number; // points earned in the turn that just ended (describing or guessing)
  prompterPoints: number; // all points from describing
  spectatorPoints: number; // all points from guessing
  finalRoundPoints: number; // points earned in the last round (the first tiebreak)
  rank: number; // 1 = first; players tied on score and both tiebreaks share a rank
};

// The secret image a player has to describe, and the words they can't say.
// The server picks one per round from the image bank (server/data/targets.json).
export type Target = {
  id: string;
  imageUrl: string;
  bannedWords: string[];
};

// What /submit sends back after a player describes the image.
export type SubmitResult = {
  transcript: string; // what Gemini heard the player say
  imageUrl: string; // what the AI drew from that
  targetImageUrl: string; // the original secret image
  score: number; // 0–100, how close the AI got
  gotRight: string[]; // things the AI drew correctly
  gotWrong: string[]; // things it got wrong
  caption: string; // short roast line
  refused?: boolean; // true if the image generator refused to draw it
};

// How the describer's points for one turn add up. Each line is before the multiplier;
// total = (accuracy + clarity + speed − bannedPenalty, never below 0) × multiplier.
export type PrompterBreakdown = {
  accuracy: number; // up to 700: how close the AI's drawing is
  clarity: number; // up to 200: how well the guessers did
  speed: number; // up to 100: time left when they sent it
  bannedPenalty: number; // 100 per banned word said
  multiplier: number; // 1 in round 1, 1.5 in round 2
  total: number;
};

// One guess, scored. points = max for this turn × accuracy × speed.
export type GuessResult = {
  playerId: string;
  playerName: string;
  text: string;
  accuracy: number; // 0–100, how close the guess is to the secret image
  speed: number; // 70–100, how much of its value the guess kept by being early
  points: number;
};

// An end-of-game award. imageUrl is "" for awards without a picture.
export type Award = { title: string; playerName: string; imageUrl: string };

// The night's worst moments, for the Hall of Shame screen.
// The server builds this from the rounds logged in Tiger Data (#23).
export type HallOfShame = {
  // Headline numbers for the big stat cards.
  stats: {
    roundsPlayed: number;
    avgScore: number; // average match % across every round tonight
    bannedBuzzes: number; // how many times someone said a banned word
    refusals: number; // how many times the AI refused to draw
  };
  // The lowest-scoring rounds of the night, worst first.
  worstMisses: {
    playerName: string;
    transcript: string;
    imageUrl: string; // what the AI drew
    score: number;
  }[];
  // Words that showed up in the worst-scoring descriptions, worst first.
  worstWords: { word: string; avgScore: number }[];
};

export const mockRoomCode = "FROG";

export const mockPlayers: Player[] = [
  { id: "1", name: "Sam", score: 0 },
  { id: "2", name: "Jordan", score: 0 },
  { id: "3", name: "Priya", score: 0 },
];

// Scores partway through a game. Deliberately NOT in order: the scoreboard sorts by rank itself,
// so mock data and old servers still show the right order.
export const mockStandings: Standing[] = [
  { id: "1", name: "Sam", score: 1420, lastTurn: 42, prompterPoints: 1200, spectatorPoints: 220, finalRoundPoints: 0, rank: 3 },
  { id: "2", name: "Gabriel", score: 1880, lastTurn: 705, prompterPoints: 1600, spectatorPoints: 280, finalRoundPoints: 0, rank: 1 },
  { id: "3", name: "Chadrick", score: 970, lastTurn: 120, prompterPoints: 850, spectatorPoints: 120, finalRoundPoints: 0, rank: 5 },
  { id: "4", name: "Charisse", score: 1630, lastTurn: 0, prompterPoints: 1300, spectatorPoints: 330, finalRoundPoints: 0, rank: 2 },
  { id: "5", name: "Abigail", score: 1200, lastTurn: 155, prompterPoints: 1000, spectatorPoints: 200, finalRoundPoints: 0, rank: 4 },
];

export const mockTarget: Target = {
  id: "dog-skateboard",
  imageUrl: "https://placehold.co/512x512/png?text=Dog+on+a+skateboard",
  bannedWords: ["dog", "puppy", "skateboard", "wheels"],
};

export const mockResult: SubmitResult = {
  transcript: "a cat... no wait, a fluffy thing on a skateboard",
  imageUrl: "https://placehold.co/512x512?text=AI+drew",
  targetImageUrl: "https://placehold.co/512x512?text=Target",
  score: 42,
  gotRight: ["skateboard"],
  gotWrong: ["it's a dog, not a cat"],
  caption: "Bold of you to call that a cat.",
};

// A round where the image generator refused to draw (safety filters).
// The server still sends a caption; there's no AI image, and the score is 0.
export const mockRefusedResult: SubmitResult = {
  transcript: "a guy getting absolutely destroyed by a goose",
  imageUrl: "",
  targetImageUrl: "https://placehold.co/512x512?text=Goose+attack",
  score: 0,
  gotRight: [],
  gotWrong: [],
  caption: "Too spicy for the robot. Zero points, infinite respect.",
  refused: true,
};

export const mockHallOfShame: HallOfShame = {
  stats: { roundsPlayed: 15, avgScore: 38, bannedBuzzes: 7, refusals: 2 },
  worstMisses: [
    {
      playerName: "Chadrick",
      transcript: "it's like a horse but sadder and it lives in a box",
      imageUrl: "https://placehold.co/256x256?text=Sad+box+horse",
      score: 3,
    },
    {
      playerName: "Abigail",
      transcript: "the thing you put soup in but it's a hat",
      imageUrl: "https://placehold.co/256x256?text=Soup+hat",
      score: 8,
    },
    {
      playerName: "Sam",
      transcript: "a cat... no wait, a fluffy thing on a skateboard",
      imageUrl: "https://placehold.co/256x256?text=AI+drew",
      score: 12,
    },
  ],
  worstWords: [
    { word: "basically", avgScore: 9 },
    { word: "vibes", avgScore: 14 },
    { word: "kinda", avgScore: 17 },
    { word: "thingy", avgScore: 21 },
    { word: "sadder", avgScore: 23 },
  ],
};
// The describer's points for mockResult (round 2, so the x1.5 line shows).
export const mockBreakdown: PrompterBreakdown = {
  accuracy: 294,
  clarity: 120,
  speed: 25,
  bannedPenalty: 100,
  multiplier: 1.5,
  total: 509,
};

// Everyone else's guesses for mockResult, best first.
export const mockGuesses: GuessResult[] = [
  { playerId: "2", playerName: "Jordan", text: "a dog riding a skateboard", accuracy: 90, speed: 96, points: 190 },
  { playerId: "3", playerName: "Priya", text: "fluffy pet on wheels", accuracy: 60, speed: 82, points: 108 },
  { playerId: "4", playerName: "Abigail", text: "a cat doing tricks", accuracy: 20, speed: 74, points: 33 },
];

export const mockAwards: Award[] = [
  { title: "Closest drawing", playerName: "Gabriel", imageUrl: "" },
  { title: "Sharpest guesser", playerName: "Charisse", imageUrl: "" },
  { title: "Most wrong masterpiece", playerName: "Chadrick", imageUrl: "" },
];
