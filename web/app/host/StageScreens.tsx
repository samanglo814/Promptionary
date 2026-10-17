"use client";

// The host screens between the lobby and the reveal:
//   RoundIntro  "ROUND 2 · POINTS x1.5 · Sam leads by 480"
//   TurnIntro   "Next up: Sam"
//   Describing  Sam talks, everyone else locks in a guess, big countdown
//   Processing  the AI draws; guesses can still come in until the window closes

import type { Player } from "@/lib/mocks";
import { useSecondsLeft } from "@/lib/useSecondsLeft";
import { Avatar, Badge, Label, Panel, type AvatarState } from "@/components/ui";

const anim = (name: string, delay = 0, duration = 0.45) => ({ animation: `${name} ${duration}s ease-out ${delay}ms both` });

// ---------- Round intro ----------

export function RoundIntro({
  round,
  totalRounds,
  multiplier,
  leader,
  gap,
}: {
  round: number;
  totalRounds: number;
  multiplier: number;
  leader: Player | null;
  gap: number;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
      <Label tone="human">
        Round {round} of {totalRounds}
      </Label>
      <h1 className="font-display text-[180px] leading-[0.9]" style={anim("pop", 0, 0.4)}>
        Round {round}
      </h1>
      {multiplier > 1 && (
        <div style={anim("pop", 350, 0.35)}>
          <Badge big>Points x{multiplier}</Badge>
        </div>
      )}
      <p className="max-w-3xl text-[28px] leading-snug text-muted" style={anim("rise", 600)}>
        {leader && gap > 0
          ? `${leader.name} leads by ${gap.toLocaleString()}. Anyone can catch up.`
          : leader
            ? `It's tied at the top. Anything can happen.`
            : "Everyone describes once. Everyone else guesses."}
      </p>
    </div>
  );
}

// ---------- Turn intro ----------

export function TurnIntro({
  describer,
  round,
  turn,
  turnsInRound,
  multiplier,
}: {
  describer: Player;
  round: number;
  turn: number;
  turnsInRound: number;
  multiplier: number;
}) {
  return (
    <div className="flex flex-1 items-center justify-center gap-14">
      <div style={anim("pop", 0, 0.4)}>
        <Avatar id={describer.id} name={describer.name} size={200} state="prompting" />
      </div>
      <div className="flex flex-col gap-5">
        <div className="flex gap-2.5" style={anim("rise", 100)}>
          <Badge tone="human">
            Round {round} · Turn {turn} / {turnsInRound}
          </Badge>
          {multiplier > 1 && <Badge tone="point">Points x{multiplier}</Badge>}
        </div>
        <p className="font-display text-[44px] leading-none text-muted" style={anim("rise", 150)}>
          Next up
        </p>
        <h1 className="font-display text-[120px] leading-[0.95]" style={anim("rise", 250)}>
          {describer.name}
        </h1>
        <p className="text-2xl text-muted" style={anim("rise", 400)}>
          Phones out. Everyone else, get ready to guess.
        </p>
      </div>
    </div>
  );
}

// ---------- Who has locked in a guess (never what they guessed) ----------

function LockRow({ guessers, lockedIds, open }: { guessers: Player[]; lockedIds: string[]; open: boolean }) {
  const lockedCount = guessers.filter((p) => lockedIds.includes(p.id)).length;
  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <Label tone="human">The room&apos;s guesses</Label>
        <span className="text-sm font-extrabold text-point">
          {lockedCount} / {guessers.length} locked in{!open && " · guessing closed"}
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {guessers.map((p) => {
          const locked = lockedIds.includes(p.id);
          const state: AvatarState = locked ? "locked" : open ? "thinking" : "missed";
          return (
            <div key={p.id} className="flex w-[118px] flex-col items-center gap-2 rounded-[18px] bg-raised px-2 py-3">
              <Avatar id={p.id} name={p.name} state={state} />
              <span className="max-w-full truncate text-[15px] font-bold">{p.name}</span>
              <span className={`text-[11px] font-bold ${locked ? "text-point" : "text-dim"}`}>
                {locked ? "✓ Locked in" : open ? "Thinking…" : "No guess"}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ---------- Describing ----------

export function Describing({
  describer,
  endsAt,
  guessers,
  lockedIds,
  guessOpen,
}: {
  describer: Player;
  endsAt?: number;
  guessers: Player[];
  lockedIds: string[];
  guessOpen: boolean;
}) {
  const secondsLeft = useSecondsLeft(endsAt);
  const urgent = secondsLeft !== null && secondsLeft <= 5;
  return (
    <div className="flex flex-1 flex-col justify-between gap-6">
      <div className="flex flex-1 items-center gap-10">
        <Avatar id={describer.id} name={describer.name} size={120} state="prompting" />
        <div className="flex flex-1 flex-col gap-3">
          <Label tone="human">Live description · no peeking</Label>
          <h1 className="font-display text-[72px] leading-[1.02]">{describer.name} is describing.</h1>
          <p className="text-2xl text-muted">Listen closely, then lock in one guess on your phone.</p>
        </div>
        {secondsLeft !== null && (
          <div className="flex flex-col items-center">
            <span className={`font-display text-[200px] leading-none tabular-nums ${urgent ? "text-ai" : "text-point"}`}>{secondsLeft}</span>
            <Label>seconds to describe</Label>
          </div>
        )}
      </div>
      <LockRow guessers={guessers} lockedIds={lockedIds} open={guessOpen} />
    </div>
  );
}

// ---------- The AI is drawing ----------

export function Processing({
  describer,
  guessEndsAt,
  guessers,
  lockedIds,
  guessOpen,
}: {
  describer: Player;
  guessEndsAt?: number;
  guessers: Player[];
  lockedIds: string[];
  guessOpen: boolean;
}) {
  const guessSecondsLeft = useSecondsLeft(guessOpen ? guessEndsAt : undefined);
  return (
    <div className="flex flex-1 flex-col justify-between gap-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <Label tone="ai">What AI heard · {describer.name}&apos;s description is in</Label>
        <h1 className="font-display text-[96px] leading-none">
          The AI is drawing
          <span className="text-ai">
            <span className="animate-[blink_1.2s_infinite]">.</span>
            <span className="animate-[blink_1.2s_0.2s_infinite]">.</span>
            <span className="animate-[blink_1.2s_0.4s_infinite]">.</span>
          </span>
        </h1>
        <p className="text-2xl text-muted">
          {guessOpen && guessSecondsLeft !== null
            ? `Still guessing? ${guessSecondsLeft}s left to lock in.`
            : "Brace yourselves. It is very confident."}
        </p>
      </div>
      <LockRow guessers={guessers} lockedIds={lockedIds} open={guessOpen} />
    </div>
  );
}
