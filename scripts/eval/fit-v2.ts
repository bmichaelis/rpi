import { readFileSync, writeFileSync } from "fs";
import { solveMassey, type MasseyMargin, type MasseyGame } from "../../src/eval/massey";
import { fitAffine, applyAffine, type Affine } from "../../src/eval/calibrate";
import { score } from "../../src/eval/score";
import type { Snapshot, Score } from "../../src/eval/types";

interface ConfigResult {
  name: string;
  margin: MasseyMargin;
  ridge: number;
  affine: Affine;
  utah: { mae: number; maxErr: number; r2: number };
  texas: { mae: number; maxErr: number; r2: number };
}

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function gamesFromSnapshot(snap: Snapshot): MasseyGame[] {
  // Each game appears twice in the schedule cache (once per team's perspective).
  // Deduplicate by sorting (a, b) and using the first-encountered margin.
  const seen = new Set<string>();
  const games: MasseyGame[] = [];
  for (const [aSlug, sched] of Object.entries(snap.scheduleCache)) {
    for (const g of sched.games) {
      if (g.goalsScored === null || g.goalsAllowed === null) continue;
      const bSlug = g.opponentSlug;
      const key = aSlug < bSlug ? `${aSlug}|${bSlug}` : `${bSlug}|${aSlug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const margin = (g.goalsScored ?? 0) - (g.goalsAllowed ?? 0);
      games.push({ a: aSlug, b: bSlug, marginAOverB: margin });
    }
  }
  return games;
}

function ratingsToPredictions(ratings: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [slug, r] of ratings) out[slug] = r;
  return out;
}

function pick(s: Score) {
  return { mae: s.mae, maxErr: s.maxErr, r2: s.r2 };
}

const SEARCH_GRID: { name: string; margin: MasseyMargin; ridge: number }[] = [];
for (const margin of [
  { kind: "binary" } as MasseyMargin,
  { kind: "cappedGd" as const, cap: 2 },
  { kind: "cappedGd" as const, cap: 3 },
  { kind: "cappedGd" as const, cap: 4 },
]) {
  for (const ridge of [0, 0.1, 1.0]) {
    const marginName = margin.kind === "binary" ? "binary" : `gdCap${margin.cap}`;
    SEARCH_GRID.push({ name: `${marginName}_ridge${ridge}`, margin, ridge });
  }
}

async function main() {
  const utah = loadSnapshot("scripts/eval/data/utah-2026.json");
  const texas = loadSnapshot("scripts/eval/data/texas-2026.json");
  const utahGames = gamesFromSnapshot(utah);
  const texasGames = gamesFromSnapshot(texas);

  console.log(`Utah games: ${utahGames.length}, Texas games: ${texasGames.length}`);

  const results: ConfigResult[] = [];

  for (const cfg of SEARCH_GRID) {
    let utahRaw: Map<string, number>;
    let texasRaw: Map<string, number>;
    try {
      utahRaw = solveMassey(utahGames, cfg.margin, cfg.ridge);
      texasRaw = solveMassey(texasGames, cfg.margin, cfg.ridge);
    } catch (e) {
      console.error(`SKIP ${cfg.name}: ${(e as Error).message}`);
      continue;
    }
    const affine = fitAffine(utahRaw, utah.officialRatings);
    const utahCal = applyAffine(utahRaw, affine);
    const texasCal = applyAffine(texasRaw, affine);
    const utahScore = score(utah, ratingsToPredictions(utahCal));
    const texasScore = score(texas, ratingsToPredictions(texasCal));
    results.push({
      name: cfg.name,
      margin: cfg.margin,
      ridge: cfg.ridge,
      affine,
      utah: pick(utahScore),
      texas: pick(texasScore),
    });
  }

  results.sort((a, b) => a.texas.mae - b.texas.mae);

  console.log("\nConfig                    | Affine (a, b)         | Utah MAE | Texas MAE | Texas R²");
  console.log("--------------------------|-----------------------|----------|-----------|---------");
  for (const r of results) {
    console.log(
      `${r.name.padEnd(26)}| (${r.affine.a.toFixed(4)}, ${r.affine.b.toFixed(4)})`.padEnd(50) +
        ` | ${r.utah.mae.toFixed(4).padStart(8)} | ${r.texas.mae.toFixed(4).padStart(9)} | ${r.texas.r2.toFixed(4).padStart(7)}`
    );
  }

  const winner = results[0];
  console.log(`\nWinner: ${winner.name}  (Texas MAE=${winner.texas.mae.toFixed(4)})`);

  writeFileSync(
    "scripts/eval/v2-model.json",
    JSON.stringify(
      {
        configName: winner.name,
        margin: winner.margin,
        ridge: winner.ridge,
        affine: winner.affine,
        utah: winner.utah,
        texas: winner.texas,
        allResults: results.map((r) => ({
          name: r.name,
          utah: r.utah,
          texas: r.texas,
        })),
      },
      null,
      2
    )
  );
  console.log("Wrote scripts/eval/v2-model.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
