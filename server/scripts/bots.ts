import { playGame } from "./playGame.js";
import { startTestServer } from "./lib.js";

/*
  npm run bots                 plays a full game against a fast in-process server (no setup needed)
  npm run bots -- <url>        plays against a server you already started, e.g. http://localhost:4000
                               (uses that server's real timings, so a game takes a few minutes)
*/

const url = process.argv[2];
const server = url ? undefined : await startTestServer();
const target = url ?? server!.url;

console.log(`Playing a 5-bot game against ${target}${url ? "" : " (in-process, fast timings)"}\n`);
const started = Date.now();
const { problems, results, standings } = await playGame({
  url: target,
  timeoutMs: url ? 10 * 60_000 : 30_000,
  log: (line) => console.log(line),
});
await server?.close();

if (results) {
  console.log("\nTurns (match score → describer points, then each guess):");
  for (const r of results) {
    const tag = r.result.refused ? " (refused)" : r.result.transcript ? "" : " (timed out)";
    const guesses = r.guesses.map((g) => `${g.playerName} +${g.points}`).join(", ");
    console.log(
      `  ${r.playerName.padEnd(6)} ${String(r.result.score).padStart(3)}% → ${String(r.breakdown.total).padStart(4)}` +
        ` (x${r.breakdown.multiplier})${tag}  guesses: ${guesses || "none"}`,
    );
  }
  console.log("\nFinal standings (total = describing + guessing):");
  for (const s of standings) {
    console.log(`  ${s.rank}. ${s.name.padEnd(6)} ${String(s.score).padStart(5)} = ${s.prompterPoints} + ${s.spectatorPoints}`);
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s) in ${seconds}s:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\n✓ Full game played, every event matched the contract (${seconds}s)`);
process.exit(0);
