// The homepage (what you see at the bare domain or localhost:3000).
// It just points people to the right place: the big screen hosts, phones join.
//
// No "use client": nothing here needs the browser (no state, no window), so Next
// can build this page once ahead of time and serve it instantly.

// <Link> is Next's version of <a>. It switches pages without a full reload and
// preloads the page when the link scrolls into view, so clicking feels instant.
import Link from "next/link";
import { Badge, Brand } from "@/components/ui";

// How it works, in three steps.
const STEPS = [
  { title: "One secret.", text: "Only the describer sees the picture." },
  { title: "Everyone guesses.", text: "Listen, type, lock in one guess." },
  { title: "The AI draws it.", text: "Exactly what it thought you meant." },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-12 px-6 py-8 sm:px-12">
      <Brand size="lg" />

      <div className="flex flex-1 flex-col justify-center gap-10">
        {/* Title + one-line pitch */}
        <div className="flex flex-col gap-5 animate-[rise_0.5s_ease-out_both]">
          <div className="flex gap-2.5">
            <Badge tone="human">Humans vs. AI</Badge>
            <Badge tone="ai">Party game</Badge>
          </div>
          <h1 className="font-display text-6xl leading-[1.02] sm:text-[96px]">
            A little art.
            <br />
            A lot of chaos.
          </h1>
          <p className="max-w-xl text-xl text-muted sm:text-2xl">
            Describe a secret picture out loud. The AI draws what it heard. Everyone else guesses.
          </p>
        </div>

        {/* The two choices. Stacked on phones, side by side on bigger screens. */}
        <div className="flex flex-col gap-4 sm:flex-row" style={{ animation: "rise 0.5s ease-out 200ms both" }}>
          <Link
            href="/host"
            className="flex flex-1 flex-col gap-1 rounded-panel border-2 border-action-edge bg-action px-6 py-5"
          >
            <span className="font-display text-3xl">Host a game →</span>
            <span className="text-sm text-text/80">On the big screen</span>
          </Link>
          <Link href="/play" className="flex flex-1 flex-col gap-1 rounded-panel border-2 border-line bg-panel px-6 py-5">
            <span className="font-display text-3xl">Join a game →</span>
            <span className="text-sm text-muted">On your phone</span>
          </Link>
        </div>

        {/* How it works. Each step rises in a bit after the last. */}
        <ol className="grid gap-6 border-t-2 border-line pt-6 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-2" style={{ animation: `rise 0.4s ease-out ${400 + i * 120}ms both` }}>
              <span className="text-xs font-extrabold text-action-edge">0{i + 1} /</span>
              <span className="font-display text-[26px] leading-none">{step.title}</span>
              <span className="text-[15px] text-muted">{step.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
