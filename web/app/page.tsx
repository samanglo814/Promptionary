// The homepage (what you see at the bare domain or localhost:3000).
// It just points people to the right place: the big screen hosts, phones join.
//
// No "use client": nothing here needs the browser (no state, no window), so Next
// can build this page once ahead of time and serve it instantly.

// <Link> is Next's version of <a>. It switches pages without a full reload and
// preloads the page when the link scrolls into view, so clicking feels instant.
import Link from "next/link";

// The three steps shown under the buttons.
const STEPS = [
  { emoji: "🖼️", text: "You get a secret picture" },
  { emoji: "🗣️", text: "Describe it out loud" },
  { emoji: "🤖", text: "The AI draws what it heard" },
];

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 p-6 text-center">
      {/* Title + one-line pitch */}
      <div className="flex flex-col items-center gap-3 animate-[rise_0.5s_ease-out_both]">
        <h1 className="text-5xl sm:text-7xl font-black tracking-tight">Reverse Charades</h1>
        <p className="text-xl sm:text-2xl opacity-70 max-w-xl">
          Charades, but you describe it and the AI draws what it{" "}
          <em className="text-pop not-italic font-bold">thought</em> you meant.
        </p>
      </div>

      {/* The two choices. Stacked on phones, side by side on bigger screens.
          The host button is pink (main action on a laptop); join is yellow. */}
      <div
        className="flex flex-col sm:flex-row gap-4 w-full max-w-md sm:max-w-xl"
        style={{ animation: "rise 0.5s ease-out 200ms both" }}
      >
        <Link
          href="/host"
          className="flex-1 bg-pop text-white rounded-card shadow-lg px-6 py-5 flex flex-col items-center"
        >
          <span className="text-2xl font-black">Host a game</span>
          <span className="text-sm opacity-80">On the big screen</span>
        </Link>

        <Link
          href="/play"
          className="flex-1 bg-zap rounded-card shadow-lg px-6 py-5 flex flex-col items-center"
        >
          <span className="text-2xl font-black">Join a game</span>
          <span className="text-sm opacity-70">On your phone</span>
        </Link>
      </div>

      {/* How it works, in three tiny steps. Each one rises in a bit after the last.
          opacity-70 goes on the text, not the <li>, because the rise animation ends
          at full opacity and would override it (same trick as on the reveal). */}
      <ol className="flex flex-col sm:flex-row gap-4 sm:gap-8">
        {STEPS.map((step, i) => (
          <li
            key={step.text}
            className="flex items-center gap-2"
            style={{ animation: `rise 0.4s ease-out ${400 + i * 120}ms both` }}
          >
            <span className="text-2xl">{step.emoji}</span>
            <span className="font-bold opacity-70">{step.text}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}