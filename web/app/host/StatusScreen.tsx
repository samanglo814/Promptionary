"use client";

import { useSecondsLeft } from "@/lib/useSecondsLeft";

// PLACEHOLDER: the in-between host screens the server now sends
// ("Next up: Sam", "Sam is describing… 12", "The AI is drawing…").
// Just enough to play a real game; restyle or replace freely.

type Props = {
  title: string; // big line, e.g. "Sam is describing…"
  subtitle?: string; // small line above it, e.g. "Round 2 of 5"
  endsAt?: number; // if set, shows a countdown to this time (epoch ms)
};

export default function StatusScreen({ title, subtitle, endsAt }: Props) {
  const secondsLeft = useSecondsLeft(endsAt);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8 text-center">
      {subtitle && <p className="text-xl uppercase tracking-widest opacity-60">{subtitle}</p>}
      <h1 className="text-6xl font-black animate-[pop_0.3s_ease-out]">{title}</h1>
      {secondsLeft !== null && <p className="text-8xl font-black text-pop">{secondsLeft}</p>}
    </main>
  );
}
