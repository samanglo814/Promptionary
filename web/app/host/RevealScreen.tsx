// "use client" makes this run in the browser.
// Needed because the score counter uses animation frames and state.
"use client";

import { useEffect, useState } from "react";
import { type SubmitResult } from "@/lib/mocks";
import RefusalCard from "./RefusalCard";

// What the host page passes in.
type Props = {
  playerName: string; // who described it
  result: SubmitResult; // what /submit returned: images, transcript, score, caption, right/wrong
};

// ---------- Timing ----------
// Everything is in milliseconds. The reveal plays in this order:
//   0ms     original image + transcript appear
//   900ms   the AI image starts wiping in (takes 1200ms)
//   2100ms  the score starts counting up (takes 1500ms)
//   3800ms  the roast caption lands, then the right/wrong chips pop in one by one
// Change these to speed up or slow down the whole reveal.
const WIPE_DELAY = 900;
const WIPE_DURATION = 1200;
const SCORE_DELAY = WIPE_DELAY + WIPE_DURATION;
const SCORE_DURATION = 1500;
const CAPTION_DELAY = SCORE_DELAY + SCORE_DURATION + 200; // small beat after the score settles
const CHIPS_DELAY = CAPTION_DELAY + 600;
const CHIP_STAGGER = 150; // gap between each chip popping in

// Counts a number up from 0 to `to`, starting after `delay` ms.
// Returns the current number to show. Re-renders about 60 times a second while counting.
function useCountUp(to: number, duration: number, delay: number) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frame = 0; // id of the next animation frame, so we can cancel it
    let start = 0; // when counting actually started

    // requestAnimationFrame calls `tick` right before the browser draws the next frame.
    // `now` is a timestamp in ms.
    function tick(now: number) {
      if (!start) start = now + delay; // first frame: schedule the start `delay` ms from now
      // How far through the count we are, from 0 (not started) to 1 (done).
      const progress = Math.min(Math.max((now - start) / duration, 0), 1);
      // "Ease out": fast at first, slows down near the end, like a slot machine settling.
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * to));
      if (progress < 1) frame = requestAnimationFrame(tick); // keep going until done
    }

    frame = requestAnimationFrame(tick);
    // Cleanup: stop the animation if the reveal disappears mid-count.
    return () => cancelAnimationFrame(frame);
  }, [to, duration, delay]);

  return value;
}

// Score color: blue for great, yellow for okay, pink for a miss.
function scoreColor(score: number) {
  if (score >= 70) return "text-cool";
  if (score >= 40) return "text-zap";
  return "text-pop";
}

// The host's big-screen reveal: what the player saw vs what the AI drew,
// then the score, the roast caption, and what the AI got right and wrong.
export default function RevealScreen({ playerName, result }: Props) {
  const shownScore = useCountUp(result.score, SCORE_DURATION, SCORE_DELAY);

  // Right and wrong go in one list so they can pop in one after another.
  // `good` decides the color and the ✓ / ✗ symbol.
  const chips = [
    ...result.gotRight.map((text) => ({ text, good: true })),
    ...result.gotWrong.map((text) => ({ text, good: false })),
  ];

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      {/* What the player said, in quotes. Fades up first. */}
      <div className="text-center animate-[rise_0.5s_ease-out_both] max-w-3xl">
        <p className="text-lg uppercase tracking-widest opacity-60">{playerName} said</p>
        <p className="text-4xl font-bold italic">“{result.transcript}”</p>
      </div>

      {/* The two images side by side (stacked on narrow screens) */}
      <div className="flex flex-col md:flex-row gap-8 items-center">
        {/* Left: the original secret image. Shows right away. */}
        <figure className="flex flex-col items-center gap-3">
          {/* Plain <img> because the images come from other sites (see DescribeScreen). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.targetImageUrl}
            alt="The original image"
            className="size-72 lg:size-80 object-cover rounded-card shadow-lg bg-white"
          />
          <figcaption className="text-lg uppercase tracking-widest opacity-60">
            The real thing
          </figcaption>
        </figure>

        {/* Right: what the AI drew. Wipes in from left to right after a pause.
            The animation shorthand is: name, duration, easing, delay, fill-mode.
            "both" = stay hidden during the delay and stay visible after it ends.
            If the AI refused to draw it, a refusal card wipes in instead. */}
        <figure className="flex flex-col items-center gap-3">
          {result.refused ? (
            <RefusalCard
              transcript={result.transcript}
              className="size-72 lg:size-80"
              style={{ animation: `wipe ${WIPE_DURATION}ms ease-in-out ${WIPE_DELAY}ms both` }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.imageUrl}
              alt="What the AI drew"
              className="size-72 lg:size-80 object-cover rounded-card shadow-lg bg-white"
              style={{
                animation: `wipe ${WIPE_DURATION}ms ease-in-out ${WIPE_DELAY}ms both`,
              }}
            />
          )}
          {/* The animation goes on the outer tag and opacity-60 on the inner one,
              because the animation's ending opacity (1) would override opacity-60. */}
          <figcaption style={{ animation: `rise 0.5s ease-out ${WIPE_DELAY}ms both` }}>
            <span className="text-lg uppercase tracking-widest opacity-60">What the AI drew</span>
          </figcaption>
        </figure>
      </div>

      {/* Bottom row: score on the left, caption + right/wrong on the right
          (stacked on narrow screens). Side by side keeps everything on one screen. */}
      <div className="flex flex-col md:flex-row items-center gap-6 md:gap-10">
        {/* The score. Fades in, then counts up from 0. */}
        <div
          className="flex flex-col items-center"
          style={{ animation: `rise 0.5s ease-out ${SCORE_DELAY}ms both` }}
        >
          <p className={`text-8xl font-black tabular-nums ${scoreColor(result.score)}`}>
            {shownScore}%
          </p>
          <p className="text-lg uppercase tracking-widest opacity-60">match</p>
        </div>

        <div className="flex flex-col items-center md:items-start gap-3 max-w-xl">
          {/* The roast caption. Lands with the same bounce as players joining (pop). */}
          <p
            className="text-3xl font-black text-center md:text-left"
            style={{ animation: `pop 0.4s ease-out ${CAPTION_DELAY}ms both` }}
          >
            {result.caption}
          </p>

          {/* What the AI got right (blue ✓) and wrong (pink ✗).
              Each chip waits a little longer than the one before it (the "stagger"). */}
          <div className="flex flex-wrap justify-center md:justify-start gap-2">
            {chips.map((chip, i) => (
              <span
                key={`${chip.good}-${chip.text}`}
                className={`font-bold px-3 py-1 rounded-full ${
                  chip.good ? "bg-cool/15 text-cool" : "bg-pop/10 text-pop"
                }`}
                style={{
                  animation: `pop 0.3s ease-out ${CHIPS_DELAY + i * CHIP_STAGGER}ms both`,
                }}
              >
                {chip.good ? "✓" : "✗"} {chip.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}