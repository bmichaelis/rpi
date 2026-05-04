import { readFileSync, writeFileSync } from "fs";
import { solveMassey, type MasseyMargin, type MasseyGame } from "../../src/eval/massey";
import { applyAffine, type Affine } from "../../src/eval/calibrate";
import type { Snapshot } from "../../src/eval/types";

interface ModelFile {
  configName: string;
  margin: MasseyMargin;
  ridge: number;
  affine: Affine;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function gamesFromSnapshot(snap: Snapshot): MasseyGame[] {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { snapshot: snapshotPath, out, model: modelPath } = args;
  if (!snapshotPath || !out) {
    console.error(
      "Usage: tsx scripts/eval/predict-v2.ts --snapshot <path> --out <path> [--model <path>]"
    );
    process.exit(1);
  }

  const model = JSON.parse(
    readFileSync(modelPath ?? "scripts/eval/v2-model.json", "utf8")
  ) as ModelFile;
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

  const games = gamesFromSnapshot(snapshot);
  const raw = solveMassey(games, model.margin, model.ridge);
  const calibrated = applyAffine(raw, model.affine);

  const predictions: Record<string, number> = {};
  for (const [slug, r] of calibrated) predictions[slug] = r;

  writeFileSync(out, JSON.stringify(predictions, null, 2));
  console.log(
    `Wrote ${Object.keys(predictions).length} predictions to ${out} using model "${model.configName}"`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
