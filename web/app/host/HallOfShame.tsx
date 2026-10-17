// No "use client" needed: no state or browser APIs, only CSS animations.
// (It still runs in the browser because the host page is a client component.)

import { type HallOfShame as HallOfShameData } from "@/lib/mocks";
// ^ The type is renamed on import because this component is also called HallOfShame.
import { Label, Panel } from "@/components/ui";

// ---------- Timing (ms) ----------
// Order: title → 4 stat cards → worst misses slide in → words pop in.
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

  // The 4 stat cards. Kept in a list so they can all be drawn by one loop below.
  const cards = [
    { value: stats.roundsPlayed, label: "Turns played", color: "text-text" },
    { value: `${stats.avgScore}%`, label: "Average match", color: "text-point" },
    { value: stats.bannedBuzzes, label: "Banned-word buzzes", color: "text-ai" },
    { value: stats.refusals, label: "Times the AI refused", color: "text-human" },
  ];

  return (
    <div className="flex flex-1 flex-col justify-center gap-7">
      {/* Title */}
      <div className="flex flex-col gap-2" style={anim("rise", 0, 0.5)}>
        <Label tone="ai">Hall of Shame</Label>
        <h1 className="font-display text-[64px] leading-none">Tonight&apos;s finest failures.</h1>
      </div>

      {/* ---------- Stat cards ---------- */}
      <div className="grid grid-cols-4 gap-[18px]">
        {cards.map((card, i) => (
          <Panel key={card.label} className="flex flex-col gap-1" style={anim("pop", CARD_DELAY + i * CARD_STAGGER)}>
            <span className={`font-display text-[64px] leading-none tabular-nums ${card.color}`}>{card.value}</span>
            <Label>{card.label}</Label>
          </Panel>
        ))}
      </div>

      {/* ---------- Two columns: worst misses (wider) | worst words ---------- */}
      <div className="grid grid-cols-5 gap-[18px]">
        {/* Worst misses: the lowest scores of the night */}
        <section className="col-span-3 flex flex-col gap-3">
          <span style={anim("rise", MISSES_DELAY - 100)}>
            <Label tone="ai">Worst misses</Label>
          </span>

          {worstMisses.map((miss, i) => (
            <div
              key={`${miss.playerName}-${i}`}
              className="flex items-center gap-4 rounded-panel border-2 border-line bg-panel p-3"
              style={anim("rise", MISSES_DELAY + i * MISS_STAGGER)}
            >
              {/* Small thumbnail of what the AI drew (plain <img>: images come from the game server) */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={miss.imageUrl}
                alt={`What the AI drew for ${miss.playerName}`}
                className="size-16 shrink-0 rounded-inner bg-raised object-cover"
              />

              {/* Who said what. min-w-0 lets the quote shrink and wrap instead of
                  pushing the score off the edge (a flexbox quirk). */}
              <div className="min-w-0 flex-1">
                <p className="text-lg font-extrabold">{miss.playerName}</p>
                <p className="leading-snug text-muted">“{miss.transcript}”</p>
              </div>

              {/* The shameful score */}
              <span className="font-display text-[40px] tabular-nums text-ai">{miss.score}%</span>
            </div>
          ))}
        </section>

        {/* Worst words: words that kept showing up in low-scoring descriptions */}
        <section className="col-span-2 flex flex-col gap-3">
          <span style={anim("rise", WORDS_DELAY - 100)}>
            <Label tone="ai">Words that broke the AI</Label>
          </span>

          <div className="flex flex-wrap gap-2">
            {worstWords.map((w, i) => (
              <span
                key={w.word}
                className="flex items-baseline gap-2 rounded-full border border-line bg-raised px-4 py-2"
                style={anim("pop", WORDS_DELAY + i * WORD_STAGGER, 0.3)}
              >
                {/* The word, in quotes */}
                <span className="text-xl font-extrabold">“{w.word}”</span>
                {/* Its average score when used */}
                <span className="text-sm font-bold tabular-nums text-ai">{w.avgScore}% avg</span>
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
