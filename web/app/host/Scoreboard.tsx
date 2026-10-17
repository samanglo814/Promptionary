// No "use client" needed here: this component has no state, timers, or browser APIs.
// All the motion is CSS animation. (It still runs in the browser, because the
// host page that uses it is a client component.)

import { type Award, type Standing } from "@/lib/mocks";
import { Avatar, Delta, Label, Panel } from "@/components/ui";

// What the host page passes in.
type Props = {
  standings: Standing[]; // every player's total + last-turn points, in any order
  prevRanks: Record<string, number>; // each player's rank on the previous scoreboard (empty at the start)
  awards?: Award[]; // end of game only
  final: boolean; // false = between turns (ranked list), true = end of game (podium)
};

// Sorts by the server's rank (ties are already broken there). [...standings] makes a copy,
// because .sort() changes the array it's called on, and we shouldn't change data we were handed.
function rank(standings: Standing[]) {
  return [...standings].sort((a, b) => a.rank - b.rank);
}

const anim = (name: string, delay: number, duration = 0.45) => ({ animation: `${name} ${duration}s ease-out ${delay}ms both` });

export default function Scoreboard({ standings, prevRanks, awards = [], final }: Props) {
  const ranked = rank(standings);
  return final ? <Podium ranked={ranked} awards={awards} /> : <RankedList ranked={ranked} prevRanks={prevRanks} />;
}

// How far a player moved since the last scoreboard: ▲2, ▼1, or a dash.
function Movement({ before, now }: { before?: number; now: number }) {
  if (!before || before === now) return <span className="w-10 text-center text-dim">–</span>;
  const up = before > now;
  return (
    <span className={`w-10 text-center text-sm font-extrabold ${up ? "text-point" : "text-ai"}`}>
      {up ? "▲" : "▼"}
      {Math.abs(before - now)}
    </span>
  );
}

// Describing points vs guessing points, as one bar split in two.
// The full width is the leader's total, so bars compare across rows.
function SplitBar({ player, top, delay }: { player: Standing; top: number; delay: number }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
      <div
        className="h-full origin-left bg-action"
        style={{ width: `${(player.prompterPoints / top) * 100}%`, ...anim("fill", delay, 0.7) }}
      />
      <div
        className="h-full origin-left bg-human"
        style={{ width: `${(player.spectatorPoints / top) * 100}%`, ...anim("fill", delay + 150, 0.7) }}
      />
    </div>
  );
}

function BarKey() {
  return (
    <div className="flex gap-5 text-xs font-bold text-muted">
      <span className="flex items-center gap-2">
        <span className="size-2.5 rounded-full bg-action" /> Describing
      </span>
      <span className="flex items-center gap-2">
        <span className="size-2.5 rounded-full bg-human" /> Guessing
      </span>
    </div>
  );
}

// ---------- Between turns: ranked list ----------

const ROW_HEIGHT = 64;
const ROW_GAP = 10;

function RankedList({ ranked, prevRanks }: { ranked: Standing[]; prevRanks: Record<string, number> }) {
  // Math.max(..., 1) avoids dividing by zero if everyone has 0 points.
  const top = Math.max(ranked[0]?.score ?? 0, 1);
  // Where each player sat on the last scoreboard, so their row can slide from there to here.
  const prevOrder = Object.entries(prevRanks)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);

  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <div className="flex items-end justify-between" style={anim("rise", 0)}>
        <div className="flex flex-col gap-2">
          <Label tone="human">Standings</Label>
          <h1 className="font-display text-[64px] leading-none">The scoreboard.</h1>
        </div>
        <BarKey />
      </div>

      <ol className="flex flex-col" style={{ gap: ROW_GAP }}>
        {ranked.map((p, i) => {
          const was = prevOrder.indexOf(p.id);
          // Rows start where they were last time and slide into their new spot.
          const from = was >= 0 ? (was - i) * (ROW_HEIGHT + ROW_GAP) : 0;
          const leader = p.rank === 1;
          return (
            <li
              key={p.id}
              className={`flex items-center gap-5 rounded-panel border-2 bg-panel px-5 ${leader ? "border-point" : "border-line"}`}
              style={{
                height: ROW_HEIGHT,
                // A transition from the old spot: start offset by `from`, then move to 0.
                animation: `slide-${p.id} 0.8s cubic-bezier(.2,.8,.2,1) 400ms both`,
              }}
            >
              {/* Keyframes per row, since each starts from a different place. */}
              <style>{`@keyframes slide-${p.id} { from { transform: translateY(${from}px); } to { transform: none; } }`}</style>
              <span className={`w-8 font-display text-3xl ${leader ? "text-point" : "text-muted"}`}>{p.rank}</span>
              <Movement before={prevRanks[p.id]} now={p.rank} />
              <Avatar id={p.id} name={p.name} size={40} />
              <span className="w-48 truncate text-2xl font-bold">{p.name}</span>
              <div className="flex-1">
                <SplitBar player={p} top={top} delay={900 + i * 80} />
              </div>
              <Delta value={p.lastTurn} className="w-20 text-right text-xl font-extrabold" />
              <span className="w-28 text-right font-display text-4xl tabular-nums">{p.score.toLocaleString()}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- End of game: podium ----------

// The three podium spots, in the order they're shown left to right.
// Classic podium layout: 2nd on the left, 1st in the middle (tallest), 3rd on the right.
const PLACES = [
  { place: 2, height: "h-40", color: "bg-human" },
  { place: 1, height: "h-56", color: "bg-point" },
  { place: 3, height: "h-28", color: "bg-ai" },
];

// Drama: 3rd place appears first, then 2nd, then 1st.
// place 3 → 0ms, place 2 → 600ms, place 1 → 1200ms.
const placeDelay = (place: number) => (3 - place) * 600;

function Podium({ ranked, awards }: { ranked: Standing[]; awards: Award[] }) {
  // Everyone after the top 3 gets a small list underneath.
  const rest = ranked.slice(3);
  const top = Math.max(ranked[0]?.score ?? 0, 1);
  // When the rest appears: after 1st place has finished growing.
  const restDelay = placeDelay(1) + 1000;

  return (
    <div className="flex flex-1 gap-10">
      {/* Left: the podium */}
      <div className="flex flex-1 flex-col justify-between gap-6">
        <div className="flex flex-col gap-2" style={anim("rise", 0)}>
          <Label tone="point">Game over</Label>
          <h1 className="font-display text-[64px] leading-none">Tonight&apos;s champions.</h1>
        </div>

        {/* items-end lines the blocks up along the floor, so they rise to different heights */}
        <div className="flex items-end justify-center gap-5">
          {PLACES.map(({ place, height, color }) => {
            const player = ranked[place - 1]; // place 1 = index 0, and so on
            if (!player) return null; // fewer than 3 players: skip the empty spot
            const delay = placeDelay(place);

            return (
              <div key={place} className="flex w-56 flex-col items-center gap-3">
                {/* Name, score and point split appear just after their block finishes growing */}
                <div className="flex w-full flex-col items-center gap-2" style={anim("rise", delay + 500)}>
                  <Avatar id={player.id} name={player.name} size={place === 1 ? 72 : 56} />
                  <p className="max-w-full truncate font-display text-[32px] leading-none">{player.name}</p>
                  <p className="font-display text-2xl tabular-nums text-point">{player.score.toLocaleString()}</p>
                  <SplitBar player={player} top={top} delay={delay + 700} />
                  <p className="text-xs text-muted tabular-nums">
                    {player.prompterPoints.toLocaleString()} describing · {player.spectatorPoints.toLocaleString()} guessing
                  </p>
                </div>

                {/* The block. origin-bottom + `grow` = rises up from the floor. */}
                <div
                  className={`w-full ${height} ${color} flex origin-bottom justify-center rounded-t-panel pt-3`}
                  style={anim("grow", delay, 0.6)}
                >
                  <span className="font-display text-6xl text-stage">{place}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 4th place and below, once the podium is done */}
        {rest.length > 0 && (
          <ol className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-lg" style={anim("rise", restDelay)}>
            {rest.map((p) => (
              <li key={p.id}>
                <span className="text-dim">{p.rank}.</span> <span className="font-bold">{p.name}</span>{" "}
                <span className="text-muted tabular-nums">{p.score.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Right: awards */}
      {awards.length > 0 && (
        <div className="flex w-[380px] shrink-0 flex-col justify-center gap-3">
          <Label tone="point" className="mb-1">
            Awards
          </Label>
          {awards.map((award, i) => (
            <Panel key={award.title} className="flex items-center gap-4" style={anim("rise", restDelay + 200 + i * 200)}>
              {award.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={award.imageUrl} alt="" className="size-16 shrink-0 rounded-inner bg-raised object-cover" />
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <Label tone="point">{award.title}</Label>
                <span className="truncate font-display text-[28px] leading-none">{award.playerName}</span>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
