// No "use client" needed: no state or browser APIs, only CSS animations.
// (It still runs in the browser because the host page is a client component.)

import { type HallOfShame as HallOfShameData } from "@/lib/mocks";
// ^ The type is renamed on import because this component is also called HallOfShame.

// ---------- Timing (ms) ----------
// Order: title → 4 stat cards pop in → worst misses slide in → words pop in.
const CARD_DELAY = 300;
const CARD_STAGGER = 120;
const MISSES_DELAY = CARD_DELAY + 4 * CARD_STAGGER + 300;
const MISS_STAGGER = 200;
const WORDS_DELAY = MISSES_DELAY + 3 * MISS_STAGGER + 200;
const WORD_STAGGER = 100;

// Shorthand so every animated element reads the same way:
// anim("pop", 300) → "pop 0.4s ease-out 300ms both"
// ("both" = hidden before the delay, stays visible after).
const anim = (name: string, delay: number, duration = 0.4) => ({
  animation: `${name} ${duration}s ease-out ${delay}ms both`,
});

// The host's "worst moments of the night" screen.
export default function HallOfShame({ data }: { data: HallOfShameData }) {
  const { stats, worstMisses, worstWords } = data;

  // The 4 big stat cards. Each has a number, a label, and a card color.
  // Kept in a list so they can all be drawn by one loop below.
  const cards = [
    { value: stats.roundsPlayed, label: "rounds played", color: "bg-white" },
    { value: `${stats.avgScore}%`, label: "average match", color: "bg-zap" },
    { value: stats.bannedBuzzes, label: "banned-word buzzes", color: "bg-pop text-white" },
    { value: stats.refusals, label: "times the AI refused", color: "bg-ink text-paper" },
  ];

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8">
      {/* Title */}
      <div className="text-center" style={anim("rise", 0, 0.5)}>
        <h1 className="text-6xl font-black tracking-tight">Hall of Shame</h1>
        <p className="text-xl opacity-60">Tonight&apos;s finest failures</p>
      </div>

      {/* ---------- Stat cards ---------- */}
      {/* grid-cols-2 on small screens (2×2), grid-cols-4 on wide screens (one row) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-5xl">
        {cards.map((card, i) => (
          <div
            key={card.label}
            className={`${card.color} rounded-card shadow-lg p-5 flex flex-col items-center`}
            style={anim("pop", CARD_DELAY + i * CARD_STAGGER)}
          >
            <span className="text-6xl font-black tabular-nums">{card.value}</span>
            <span className="text-sm uppercase tracking-widest opacity-70 text-center">
              {card.label}
            </span>
          </div>
        ))}
      </div>

      {/* ---------- Two columns: worst misses (wider) | worst words ---------- */}
      {/* On wide screens the left column takes 3 parts of the width, the right takes 2. */}
      <div className="grid lg:grid-cols-5 gap-8 w-full max-w-5xl">
        {/* Worst misses: the lowest scores of the night */}
        <section className="lg:col-span-3 flex flex-col gap-3">
          <h2
            className="text-lg uppercase tracking-widest opacity-60"
            style={anim("rise", MISSES_DELAY - 100)}
          >
            Worst misses
          </h2>

          {worstMisses.map((miss, i) => (
            <div
              key={`${miss.playerName}-${i}`}
              className="bg-white rounded-card shadow p-3 flex items-center gap-4"
              style={anim("rise", MISSES_DELAY + i * MISS_STAGGER)}
            >
              {/* Small thumbnail of what the AI drew (plain <img>: images come from other sites) */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={miss.imageUrl}
                alt={`What the AI drew for ${miss.playerName}`}
                className="size-16 shrink-0 rounded-xl object-cover bg-ink/5"
              />

              {/* Who said what. min-w-0 lets the quote shrink and wrap instead of
                  pushing the score off the edge (a flexbox quirk). */}
              <div className="flex-1 min-w-0">
                <p className="font-black text-lg">{miss.playerName}</p>
                <p className="italic opacity-70 leading-snug">“{miss.transcript}”</p>
              </div>

              {/* The shameful score, in pink */}
              <span className="text-4xl font-black text-pop tabular-nums">{miss.score}%</span>
            </div>
          ))}
        </section>

        {/* Worst words: words that kept showing up in low-scoring descriptions */}
        <section className="lg:col-span-2 flex flex-col gap-3">
          <h2
            className="text-lg uppercase tracking-widest opacity-60"
            style={anim("rise", WORDS_DELAY - 100)}
          >
            Words that broke the AI
          </h2>

          <div className="flex flex-wrap gap-2">
            {worstWords.map((w, i) => (
              <span
                key={w.word}
                className="bg-pop/10 rounded-full px-4 py-2 flex items-baseline gap-2"
                style={anim("pop", WORDS_DELAY + i * WORD_STAGGER, 0.3)}
              >
                {/* The word, in quotes */}
                <span className="text-xl font-black">“{w.word}”</span>
                {/* Its average score when used */}
                <span className="text-sm font-bold text-pop tabular-nums">{w.avgScore}% avg</span>
              </span>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}