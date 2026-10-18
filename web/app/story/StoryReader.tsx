// "use client" makes this run in the browser.
// Needed because the storybook is fetched from the game server after the page loads.
"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { mockStorybook, type StoryPage, type Storybook } from "@/lib/mocks";
import { SERVER_URL } from "@/lib/socket";
import { Badge, Brand, Button, Label, Panel } from "@/components/ui";
import { formatDate } from "../host/Storybook";

// ?id= from the link. window only exists in the browser, so on the server it's "".
const idFromUrl = () => new URLSearchParams(window.location.search).get("id") ?? "";
const noSubscribe = () => () => {};

type Load = { state: "loading" } | { state: "missing" } | { state: "ready"; story: Storybook };

export default function StoryReader() {
  const id = useSyncExternalStore(noSubscribe, idFromUrl, () => "");
  // Mock mode (no server) always shows the mock book.
  const [load, setLoad] = useState<Load>(SERVER_URL ? { state: "loading" } : { state: "ready", story: mockStorybook });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!SERVER_URL || !id) return;
    let cancelled = false;
    fetch(`${SERVER_URL}/stories/${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? (res.json() as Promise<Storybook>) : null))
      .then((story) => !cancelled && setLoad(story ? { state: "ready", story } : { state: "missing" }))
      .catch(() => !cancelled && setLoad({ state: "missing" }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The phone's share sheet where there is one, otherwise copy the link.
  async function share(story: Storybook) {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: story.title, text: "Our night of Promptionary, as a storybook", url }).catch(() => {});
      return;
    }
    await navigator.clipboard?.writeText(url);
    setCopied(true);
  }

  if (load.state !== "ready") {
    const waiting = load.state === "loading" && Boolean(id);
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-4 px-5 py-10">
        <Brand />
        <h1 className="font-display text-[34px] leading-[1.08]">{waiting ? "Opening the storybook…" : "This storybook has closed."}</h1>
        {!waiting && <p className="text-muted">Storybooks are kept for 6 hours after the game. Play again to make a new one.</p>}
        {!waiting && <PlayLink />}
      </main>
    );
  }

  const { story } = load;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-5 py-10">
      <Brand />

      {/* Cover */}
      <header className="flex flex-col gap-3">
        <Label tone="point">The Storybook</Label>
        <h1 className="font-display text-[44px] leading-[1.05]">{story.title}</h1>
        <p className="text-muted">
          {story.pages.length} pages · {formatDate(story.createdAt)}
        </p>
        {story.winner && (
          <span>
            <Badge tone="point">Starring champion {story.winner}</Badge>
          </span>
        )}
        <Button onClick={() => share(story)} className="mt-2">
          {copied ? "Link copied" : "Share the storybook"}
        </Button>
      </header>

      {story.pages.map((page, i) => (
        <StoryPageCard key={i} page={page} number={i + 1} />
      ))}

      <footer className="flex flex-col gap-3 border-t-2 border-line pt-6">
        <p className="font-display text-[34px] leading-none">The End.</p>
        <PlayLink />
      </footer>
    </main>
  );
}

function StoryPageCard({ page, number }: { page: StoryPage; number: number }) {
  return (
    <Panel className="flex flex-col gap-4">
      <Label>
        Page {number} · Round {page.round} · {page.playerName}
      </Label>
      <div className="grid grid-cols-2 gap-3">
        <figure className="flex flex-col gap-1.5">
          <Label tone="human">What they saw</Label>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.targetImageUrl} alt="The secret image" className="aspect-square w-full rounded-inner bg-raised object-cover" />
        </figure>
        <figure className="flex flex-col gap-1.5">
          <Label tone="ai">What the AI drew</Label>
          {page.refused || !page.imageUrl ? (
            <div className="flex aspect-square w-full items-center justify-center rounded-inner border-2 border-ai bg-raised p-3 text-center font-display text-xl text-ai">
              The AI refused.
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.imageUrl} alt={`What the AI drew for ${page.playerName}`} className="aspect-square w-full rounded-inner bg-raised object-cover" />
          )}
        </figure>
      </div>
      <p className="font-display text-2xl leading-[1.15]">{page.narration}</p>
      <p className="text-[15px] leading-snug text-muted">{page.transcript ? `“${page.transcript}”` : "(not a word was spoken)"}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge tone={page.score >= 50 ? "point" : "ai"}>{page.score}% match</Badge>
        {/* Plain text, not a badge: a long guess has to wrap on a phone. */}
        {page.bestGuess && (
          <span className="text-[15px] text-human">
            {page.bestGuess.playerName} guessed “{page.bestGuess.text}”
          </span>
        )}
      </div>
    </Panel>
  );
}

function PlayLink() {
  return (
    <Link href="/" className="text-sm font-bold text-muted underline underline-offset-4">
      Play Promptionary
    </Link>
  );
}
