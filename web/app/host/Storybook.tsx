// "use client" makes this run in the browser.
// Needed because the pages turn by themselves on a timer.
"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { type StoryPage, type Storybook as StorybookData } from "@/lib/mocks";
import { Badge, Label, TextButton } from "@/components/ui";

// ---------- Timing (ms) ----------
// The book reads itself: the cover, then one page per turn, then "The End" with the QR code,
// where it stays until the host plays again. The arrows turn pages by hand.
const COVER_MS = 6_000;
const PAGE_MS = 9_000;

const anim = (name: string, delay: number, duration = 0.5) => ({ animation: `${name} ${duration}s ease-out ${delay}ms both` });

// The host's last screen after the Hall of Shame: the whole game as a picture book.
// `url` is where the QR code on the last page leads (the shareable /story page).
export default function Storybook({ story, url }: { story: StorybookData; url: string }) {
  // -1 = cover, 0…n-1 = the turns, n = "The End".
  const [page, setPage] = useState(-1);
  const last = story.pages.length;

  useEffect(() => {
    if (page >= last) return;
    const timer = setTimeout(() => setPage((p) => p + 1), page < 0 ? COVER_MS : PAGE_MS);
    return () => clearTimeout(timer);
  }, [page, last]);

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Re-keyed on every page turn so its animation plays again. */}
      <div key={page} className="flex flex-1 flex-col">
        {page < 0 && <Cover story={story} />}
        {page >= 0 && page < last && <Page page={story.pages[page]!} number={page + 1} total={last} />}
        {page >= last && <TheEnd story={story} url={url} />}
      </div>

      {/* Page turns. Kept on the left: the host's Play again button sits bottom right. */}
      <div className="flex items-center gap-6">
        <TextButton onClick={() => setPage((p) => Math.max(-1, p - 1))} disabled={page < 0}>
          ◀ Back
        </TextButton>
        <div className="flex gap-1.5" aria-hidden>
          {Array.from({ length: last + 2 }, (_, i) => (
            <span key={i} className={`h-2 rounded-full transition-all ${i === page + 1 ? "w-6 bg-point" : "w-2 bg-line"}`} />
          ))}
        </div>
        <TextButton onClick={() => setPage((p) => Math.min(last, p + 1))} disabled={page >= last}>
          Next ▶
        </TextButton>
      </div>
    </div>
  );
}

function Cover({ story }: { story: StorybookData }) {
  const players = new Set(story.pages.map((p) => p.playerName)).size;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <span style={anim("rise", 0)}>
        <Label tone="point">The Storybook</Label>
      </span>
      <h1 className="max-w-[1100px] font-display text-[96px] leading-[1.02]" style={anim("pop", 200, 0.6)}>
        {story.title}
      </h1>
      <p className="text-2xl text-muted" style={anim("rise", 700)}>
        {players} storytellers · {story.pages.length} pages · {formatDate(story.createdAt)}
      </p>
      {story.winner && (
        <span style={anim("pop", 1100)}>
          <Badge big>Starring champion {story.winner}</Badge>
        </span>
      )}
    </div>
  );
}

function Page({ page, number, total }: { page: StoryPage; number: number; total: number }) {
  return (
    <div className="flex flex-1 items-center gap-10">
      {/* Left: the two pictures, what they saw and what the AI made of it */}
      <div className="grid w-[860px] shrink-0 grid-cols-2 gap-5">
        <figure className="flex flex-col gap-2" style={anim("rise", 0)}>
          <Label tone="human">What {page.playerName} saw</Label>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.targetImageUrl} alt="The secret image" className="aspect-square w-full rounded-panel border-2 border-human bg-raised object-cover" />
        </figure>
        <figure className="flex flex-col gap-2" style={anim("rise", 250)}>
          <Label tone="ai">What the AI drew</Label>
          {page.refused || !page.imageUrl ? (
            <div className="flex aspect-square w-full items-center justify-center rounded-panel border-2 border-ai bg-raised p-8 text-center font-display text-4xl text-ai">
              The AI refused to draw this.
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.imageUrl} alt={`What the AI drew for ${page.playerName}`} className="aspect-square w-full rounded-panel border-2 border-ai bg-raised object-cover" />
          )}
        </figure>
      </div>

      {/* Right: the story */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <Label>
          Page {number} of {total} · Round {page.round}
        </Label>
        <p className="font-display text-[46px] leading-[1.12]" style={anim("rise", 600)}>
          {page.narration}
        </p>
        <p className="text-xl leading-snug text-muted" style={anim("rise", 1100)}>
          {page.transcript ? `“${page.transcript}”` : "(not a word was spoken)"}
          <span className="text-dim"> · {page.playerName}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3" style={anim("rise", 1500)}>
          <Badge tone={page.score >= 50 ? "point" : "ai"}>{page.score}% match</Badge>
          {page.bestGuess && (
            <Badge tone="human">
              Closest guess: {page.bestGuess.playerName}, “{page.bestGuess.text}”
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function TheEnd({ story, url }: { story: StorybookData; url: string }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-16">
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-[120px] leading-none" style={anim("pop", 0, 0.6)}>
          The End.
        </h1>
        <p className="max-w-[640px] text-2xl" style={anim("rise", 400)}>
          Scan to keep <span className="font-extrabold">{story.title}</span> on your phone, and share the night&apos;s art.
        </p>
        <p className="text-[15px] text-muted" style={anim("rise", 700)}>
          The link works for 6 hours.
        </p>
      </div>
      {/* QR codes need a light background to scan, so it gets a white tile. */}
      <div className="shrink-0 rounded-panel bg-text p-4" style={anim("pop", 300)}>
        {url ? <QRCodeSVG value={url} size={300} bgColor="#f8f8fc" fgColor="#101018" /> : <div className="size-[300px]" />}
      </div>
    </div>
  );
}

export function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}
