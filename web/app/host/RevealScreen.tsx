// "use client" makes this run in the browser.
// Needed because the score counter uses animation frames and state.
"use client";

import { useEffect, useState } from "react";
import { type GuessResult, type PrompterBreakdown, type SubmitResult } from "@/lib/mocks";
import { Delta, Label, Panel } from "@/components/ui";
import RefusalCard from "./RefusalCard";
import { playBuzzer, playDrumroll, playSting } from "@/lib/sounds";

// What the host page passes in.
type Props = {
  playerName: string; // who described it
  result: SubmitResult; // images, transcript, score, caption
  breakdown: PrompterBreakdown | null; // how the describer's points add up (null with old servers)
  guesses: GuessResult[]; // everyone else's guesses, scored
};

// ---------- Timing ----------
// Everything is in milliseconds. The reveal plays in this order (about 6.5s, inside the 8s the
// server gives it):
//   0ms      01 the original image
//   500ms    02 the room's guesses, one after another
//   ~1.6s    03 what the AI drew wipes in, then its match % counts up
//   ~4.2s    the describer's points stack up, line by line, into a total
//   ~5.8s    the roast caption lands
const GUESS_DELAY = 500;
const GUESS_STAGGER = 220;
const WIPE_DURATION = 900;
const SCORE_DURATION = 1100;
const LINE_STAGGER = 180;

// Counts a number up from 0 to `to`, starting after `delay` ms.
// Returns the current number to show. Re-renders about 60 times a second while counting.
function useCountUp(to: number, duration: number, delay: number) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frame = 0; // id of the next animation frame, so we can cancel it
    let start = 0; // when counting actually started

    // requestAnimationFrame calls `tick` right before the browser draws the next frame.
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

// Shorthand: anim("rise", 300) → "rise 0.45s ease-out 300ms both"
// ("both" = hidden before the delay, stays visible after).
const anim = (name: string, delay: number, duration = 0.45) => ({ animation: `${name} ${duration}s ease-out ${delay}ms both` });

export default function RevealScreen({ playerName, result, breakdown, guesses }: Props) {
  // When each step starts depends on how many guesses there are to show.
  const shownGuesses = guesses.slice(0, 4);
  const wipeDelay = GUESS_DELAY + Math.max(shownGuesses.length, 1) * GUESS_STAGGER + 300;
  const scoreDelay = wipeDelay + WIPE_DURATION;
  const pointsDelay = scoreDelay + SCORE_DURATION + 200;
  const shownScore = useCountUp(result.score, SCORE_DURATION, scoreDelay);

  // Sound, timed to the animation:
  //   normal round → drumroll while the match % counts, then a sting when it lands
  //   refused      → a buzzer when the REFUSED stamp slams down
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []; // so cleanup can cancel them
    let stopRoll = () => {}; // replaced with the real stop() once the drumroll starts

    if (result.refused) {
      timers.push(setTimeout(playBuzzer, scoreDelay));
    } else {
      timers.push(
        setTimeout(() => {
          stopRoll = playDrumroll(SCORE_DURATION / 1000); // Web Audio wants seconds
        }, scoreDelay),
      );
      timers.push(setTimeout(() => playSting(result.score), scoreDelay + SCORE_DURATION));
    }

    // Cleanup: if the screen changes mid-reveal, cancel sounds that haven't started yet
    // and cut off a drumroll that's playing.
    return () => {
      timers.forEach(clearTimeout);
      stopRoll();
    };
  }, [result, scoreDelay]);

  // The best guess gets highlighted (only if it actually scored).
  const best = shownGuesses.reduce<GuessResult | null>((top, g) => (g.points > (top?.points ?? 0) ? g : top), null);

  // The describer's points, one line each, then the total.
  const lines = breakdown
    ? [
        { label: "Accuracy", value: breakdown.accuracy },
        { label: "Clarity", value: breakdown.clarity },
        { label: "Speed", value: breakdown.speed },
        ...(breakdown.bannedPenalty > 0 ? [{ label: "Banned words", value: -breakdown.bannedPenalty }] : []),
      ]
    : [];
  const totalDelay = pointsDelay + (lines.length + (breakdown && breakdown.multiplier > 1 ? 1 : 0)) * LINE_STAGGER;

  return (
    <div className="flex flex-1 flex-col gap-5">
      {/* What the describer said */}
      <div className="flex flex-col gap-2" style={anim("rise", 0)}>
        <Label tone="human">{playerName} said</Label>
        <p className="font-display text-[44px] leading-[1.08] line-clamp-2">
          {result.transcript ? `“${result.transcript}”` : "…nothing at all. Crickets."}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px_1fr] gap-[18px]">
        {/* 01 · The original */}
        <Panel tone="human" className="flex flex-col gap-3.5" style={anim("rise", 0)}>
          <Label tone="human">01 · The secret image</Label>
          {/* Plain <img> because the images come from the game server, not this site. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.targetImageUrl} alt="The secret image" className="aspect-[4/3] w-full rounded-inner bg-raised object-cover" />
        </Panel>

        {/* 02 · The room's guesses */}
        <Panel tone="human" className="flex flex-col gap-2.5">
          <Label tone="human">02 · Human guesses</Label>
          <p className="font-display text-[28px] leading-none">The room&apos;s receipts.</p>
          {shownGuesses.length === 0 && (
            <p className="text-[17px] text-muted" style={anim("rise", GUESS_DELAY)}>
              Nobody locked in a guess.
            </p>
          )}
          {shownGuesses.map((g, i) => {
            const isBest = g === best;
            return (
              <div
                key={g.playerId}
                className={`flex flex-col gap-1.5 rounded-inner border bg-raised p-3.5 ${isBest ? "border-point" : "border-human"}`}
                style={anim("rise", GUESS_DELAY + i * GUESS_STAGGER)}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-extrabold">{g.playerName}</span>
                  <span className={`text-[10px] font-extrabold ${isBest ? "text-point" : "text-human"}`}>
                    {isBest ? "BEST GUESS" : g.points > 0 ? "SCORED" : "MISSED"}
                  </span>
                </div>
                <p className="line-clamp-2 text-[17px] leading-snug">{g.text}</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-human">{g.accuracy}% accuracy</span>
                  <Delta value={g.points} className="text-[17px] font-extrabold" />
                </div>
              </div>
            );
          })}
          {guesses.length > shownGuesses.length && (
            <p className="text-sm text-muted">+{guesses.length - shownGuesses.length} more</p>
          )}
        </Panel>

        {/* 03 · What the AI drew */}
        <Panel tone="ai" className="flex flex-col gap-3.5">
          <Label tone="ai">03 · What AI heard</Label>
          {result.refused ? (
            <RefusalCard
              transcript={result.transcript}
              stampDelay={wipeDelay + WIPE_DURATION}
              className="aspect-[4/3] w-full"
              style={{ animation: `wipe ${WIPE_DURATION}ms ease-in-out ${wipeDelay}ms both` }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.imageUrl}
              alt="What the AI drew"
              className="aspect-[4/3] w-full rounded-inner bg-raised object-cover"
              style={{ animation: `wipe ${WIPE_DURATION}ms ease-in-out ${wipeDelay}ms both` }}
            />
          )}
          <div className="flex items-center gap-3" style={anim("rise", scoreDelay)}>
            <span className={`font-display text-[56px] leading-none tabular-nums ${result.score >= 40 ? "text-point" : "text-ai"}`}>
              {shownScore}%
            </span>
            <span className="text-sm leading-snug text-muted">
              AI image match
              <br />
              {breakdown ? `= ${breakdown.accuracy} accuracy points` : "How close the AI got"}
            </span>
          </div>
        </Panel>
      </div>

      {/* The describer's points adding up, then the roast */}
      <div className="flex min-h-[96px] items-center gap-8 rounded-panel border border-line bg-raised px-[22px] py-3.5">
        {breakdown && (
          <div className="flex shrink-0 items-end gap-6">
            {lines.map((line, i) => (
              <div key={line.label} className="flex flex-col gap-1" style={anim("rise", pointsDelay + i * LINE_STAGGER)}>
                <Label tone={line.value < 0 ? "ai" : "line"}>{line.label}</Label>
                <Delta value={line.value} className="text-[28px] font-extrabold leading-none" />
              </div>
            ))}
            {breakdown.multiplier > 1 && (
              <div className="flex flex-col gap-1" style={anim("rise", pointsDelay + lines.length * LINE_STAGGER)}>
                <Label tone="point">Round 2</Label>
                <span className="text-[28px] font-extrabold leading-none text-point">x{breakdown.multiplier}</span>
              </div>
            )}
            <div className="flex flex-col gap-1 border-l-2 border-line pl-6" style={anim("pop", totalDelay, 0.35)}>
              <Label tone="point">{playerName}&apos;s turn</Label>
              <span className="font-display text-[44px] leading-none tabular-nums text-point">
                {breakdown.total.toLocaleString()}
              </span>
            </div>
          </div>
        )}
        <p className="font-display text-[30px] leading-[1.1]" style={anim("pop", totalDelay + 500, 0.4)}>
          {result.caption}
        </p>
      </div>
    </div>
  );
}
