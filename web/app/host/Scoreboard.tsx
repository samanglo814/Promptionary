// No "use client" needed here: this component has no state, timers, or browser APIs.
// All the motion is CSS animation. (It still runs in the browser, because the
// host page that uses it is a client component.)

import { type Standing } from "@/lib/mocks";

// What the host page passes in.
type Props = {
  standings: Standing[]; // every player's total + last-round points, in any order
  final: boolean; // false = between rounds (ranked list), true = end of game (podium)
};

// Sorts highest score first. [...standings] makes a copy, because .sort() changes
// the array it's called on, and we shouldn't change data we were handed.
function rank(standings: Standing[]) {
  return [...standings].sort((a, b) => b.score - a.score);
}

export default function Scoreboard({ standings, final }: Props) {
  const ranked = rank(standings);
  return final ? <Podium ranked={ranked} /> : <RankedList ranked={ranked} />;
}

// ---------- Between rounds: ranked list with bars ----------

const ROW_STAGGER = 120; // ms between each row sliding in

function RankedList({ ranked }: { ranked: Standing[] }) {
  // The leader's score is the "full" bar; everyone else is a fraction of it.
  // Math.max(..., 1) avoids dividing by zero if everyone has 0 points.
  const top = Math.max(ranked[0]?.score ?? 0, 1);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-6xl font-black tracking-tight animate-[rise_0.5s_ease-out_both]">
        Scoreboard
      </h1>

      <ol className="w-full max-w-3xl flex flex-col gap-3">
        {ranked.map((p, i) => {
          const delay = 300 + i * ROW_STAGGER; // each row waits a bit longer than the one above
          const leader = i === 0;

          return (
            <li
              key={p.id}
              className="flex items-center gap-4"
              style={{ animation: `rise 0.4s ease-out ${delay}ms both` }}
            >
              {/* Rank number in a circle. The leader's circle is yellow. */}
              <span
                className={`size-12 shrink-0 rounded-full flex items-center justify-center text-2xl font-black ${
                  leader ? "bg-zap" : "bg-ink/10"
                }`}
              >
                {i + 1}
              </span>

              {/* The bar. `relative` lets the colored fill sit behind the name.
                  overflow-hidden clips the fill to the rounded corners. */}
              <div className="relative flex-1 h-14 rounded-card bg-ink/5 overflow-hidden">
                {/* The fill: its width is this player's share of the leader's score.
                    `fill` (in globals.css) grows it from the left edge. */}
                <div
                  className={`absolute inset-y-0 left-0 origin-left ${leader ? "bg-zap" : "bg-cool/30"}`}
                  style={{
                    width: `${(p.score / top) * 100}%`,
                    animation: `fill 0.8s ease-out ${delay + 200}ms both`,
                  }}
                />
                {/* The name sits on top of the fill (relative + z-10 puts it in front) */}
                <span className="relative z-10 h-full flex items-center px-5 text-2xl font-bold">
                  {p.name}
                </span>
              </div>

              {/* Points earned in the round that just ended. Hidden if they got 0. */}
              <span className="w-16 text-right text-xl font-bold text-cool">
                {p.lastRound > 0 && `+${p.lastRound}`}
              </span>

              {/* Total score. tabular-nums makes every digit the same width so numbers line up. */}
              <span className="w-20 text-right text-3xl font-black tabular-nums">{p.score}</span>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

// ---------- End of game: podium ----------

// The three podium spots, in the order they're shown left to right.
// Classic podium layout: 2nd on the left, 1st in the middle (tallest), 3rd on the right.
const PLACES = [
  { place: 2, medal: "🥈", height: "h-44", color: "bg-cool" },
  { place: 1, medal: "🥇", height: "h-64", color: "bg-zap" },
  { place: 3, medal: "🥉", height: "h-32", color: "bg-pop" },
];

// Drama: 3rd place appears first, then 2nd, then 1st.
// place 3 → 0ms, place 2 → 600ms, place 1 → 1200ms.
const placeDelay = (place: number) => (3 - place) * 600;

function Podium({ ranked }: { ranked: Standing[] }) {
  // Everyone after the top 3 gets a small list underneath.
  const rest = ranked.slice(3);
  // When the rest list appears: after 1st place has finished growing.
  const restDelay = placeDelay(1) + 1000;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 p-8">
      <h1 className="text-6xl font-black tracking-tight animate-[rise_0.5s_ease-out_both]">
        Final results
      </h1>

      {/* items-end lines the blocks up along the floor, so they rise to different heights */}
      <div className="flex items-end gap-4">
        {PLACES.map(({ place, medal, height, color }) => {
          const player = ranked[place - 1]; // place 1 = index 0, and so on
          if (!player) return null; // fewer than 3 players: skip the empty spot
          const delay = placeDelay(place);

          return (
            <div key={place} className="w-48 flex flex-col items-center gap-3">
              {/* Name + score appear just after their block finishes growing */}
              <div
                className="text-center"
                style={{ animation: `rise 0.4s ease-out ${delay + 500}ms both` }}
              >
                <p className="text-3xl font-black">{player.name}</p>
                <p className="text-xl font-bold opacity-60 tabular-nums">{player.score} pts</p>
              </div>

              {/* The block. origin-bottom + `grow` = rises up from the floor. */}
              <div
                className={`w-full ${height} ${color} rounded-t-card origin-bottom flex flex-col items-center pt-4 gap-1`}
                style={{ animation: `grow 0.6s ease-out ${delay}ms both` }}
              >
                <span className="text-5xl">{medal}</span>
                <span className="text-4xl font-black text-white">{place}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4th place and below, once the podium is done */}
      {rest.length > 0 && (
        <ol
          className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-xl"
          style={{ animation: `rise 0.4s ease-out ${restDelay}ms both` }}
        >
          {rest.map((p, i) => (
            <li key={p.id}>
              {/* i starts at 0 here, but these players start at 4th place */}
              <span className="opacity-60">{i + 4}.</span>{" "}
              <span className="font-bold">{p.name}</span>{" "}
              <span className="opacity-60 tabular-nums">{p.score}</span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}