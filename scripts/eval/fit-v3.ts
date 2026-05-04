import { readFileSync, writeFileSync } from "fs";
import { solveOls } from "../../src/eval/ols";
import { extractFeaturesV3, FEATURE_NAMES } from "../../src/eval/features-v3";
import { score } from "../../src/eval/score";
import type { Snapshot } from "../../src/eval/types";

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function buildXY(snap: Snapshot): { X: number[][]; y: number[] } {
  const X: number[][] = [];
  const y: number[] = [];
  for (const [slug, official] of Object.entries(snap.officialRatings)) {
    const sched = snap.scheduleCache[slug];
    if (!sched) continue;
    const strength = snap.strengthMap[slug];
    if (strength === undefined) continue;
    X.push(extractFeaturesV3(sched, strength));
    y.push(official);
  }
  return { X, y };
}

function predict(snap: Snapshot, beta: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [slug, sched] of Object.entries(snap.scheduleCache)) {
    const strength = snap.strengthMap[slug] ?? 0;
    const feats = extractFeaturesV3(sched, strength);
    let p = 0;
    for (let i = 0; i < feats.length; i++) p += beta[i] * feats[i];
    out[slug] = p;
  }
  return out;
}

async function main() {
  const utah = loadSnapshot("scripts/eval/data/utah-2026.json");
  const texas = loadSnapshot("scripts/eval/data/texas-2026.json");

  const { X, y } = buildXY(utah);
  const beta = solveOls(X, y);

  const utahPreds = predict(utah, beta);
  const texasPreds = predict(texas, beta);

  const utahScore = score(utah, utahPreds);
  const texasScore = score(texas, texasPreds);

  console.log("Features:", FEATURE_NAMES);
  console.log("Coefficients:", beta.map((b) => b.toFixed(4)));
  console.log(`Utah-2026:  MAE=${utahScore.mae.toFixed(4)}, MaxErr=${utahScore.maxErr.toFixed(4)}`);
  console.log(`Texas-2026: MAE=${texasScore.mae.toFixed(4)}, MaxErr=${texasScore.maxErr.toFixed(4)}, R²=${texasScore.r2.toFixed(4)}`);

  writeFileSync(
    "scripts/eval/v3-model.json",
    JSON.stringify(
      {
        featureNames: FEATURE_NAMES,
        coefficients: beta,
        utah: { mae: utahScore.mae, maxErr: utahScore.maxErr, r2: utahScore.r2 },
        texas: { mae: texasScore.mae, maxErr: texasScore.maxErr, r2: texasScore.r2 },
      },
      null,
      2
    )
  );
  console.log("Wrote scripts/eval/v3-model.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
