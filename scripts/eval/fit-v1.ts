import { readFileSync, writeFileSync } from "fs";
import { solveOls } from "../../src/eval/ols";
import { extractFeatures, type FormSpec } from "../../src/eval/features-v1";
import { CANDIDATE_FORMS } from "../../src/eval/form-spec-v1";
import { score } from "../../src/eval/score";
import type { Snapshot, Score } from "../../src/eval/types";

interface FitResult {
  formName: string;
  spec: FormSpec;
  coefficients: number[];
  utah: { mae: number; maxErr: number; r2: number };
  texas: { mae: number; maxErr: number; r2: number };
}

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function buildDesignMatrix(snap: Snapshot, spec: FormSpec): { X: number[][]; y: number[]; slugs: string[] } {
  const slugs: string[] = [];
  const X: number[][] = [];
  const y: number[] = [];
  for (const [slug, official] of Object.entries(snap.officialRatings)) {
    const sched = snap.scheduleCache[slug];
    if (!sched) continue;
    const strength = snap.strengthMap[slug];
    if (strength === undefined) continue; // skip if no strength
    slugs.push(slug);
    X.push(extractFeatures(sched, spec, strength));
    y.push(official);
  }
  return { X, y, slugs };
}

function predictAll(snap: Snapshot, spec: FormSpec, beta: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [slug, sched] of Object.entries(snap.scheduleCache)) {
    const strength = snap.strengthMap[slug] ?? 0; // fall back to 0 for unranked teams
    const feats = extractFeatures(sched, spec, strength);
    let pred = 0;
    for (let i = 0; i < feats.length; i++) pred += beta[i] * feats[i];
    out[slug] = pred;
  }
  return out;
}

function pick(s: Score) {
  return { mae: s.mae, maxErr: s.maxErr, r2: s.r2 };
}

async function main() {
  const utah = loadSnapshot("scripts/eval/data/utah-2026.json");
  const texas = loadSnapshot("scripts/eval/data/texas-2026.json");

  const results: FitResult[] = [];

  for (const spec of CANDIDATE_FORMS) {
    const { X, y } = buildDesignMatrix(utah, spec);
    let beta: number[];
    try {
      beta = solveOls(X, y);
    } catch (e) {
      console.error(`SKIP ${spec.name}: ${(e as Error).message}`);
      continue;
    }
    const utahPreds = predictAll(utah, spec, beta);
    const texasPreds = predictAll(texas, spec, beta);
    const utahScore = score(utah, utahPreds);
    const texasScore = score(texas, texasPreds);
    results.push({
      formName: spec.name,
      spec,
      coefficients: beta,
      utah: pick(utahScore),
      texas: pick(texasScore),
    });
  }

  results.sort((a, b) => a.texas.mae - b.texas.mae);

  // Console summary
  console.log("\nForm                          | Utah MAE | Utah MaxErr | Texas MAE | Texas MaxErr | Texas R²");
  console.log("------------------------------|----------|-------------|-----------|--------------|---------");
  for (const r of results) {
    console.log(
      `${r.formName.padEnd(30)}| ${r.utah.mae.toFixed(4).padStart(8)} | ${r.utah.maxErr.toFixed(4).padStart(11)} | ${r.texas.mae.toFixed(4).padStart(9)} | ${r.texas.maxErr.toFixed(4).padStart(12)} | ${r.texas.r2.toFixed(4).padStart(7)}`
    );
  }

  const winner = results[0];
  console.log(`\nWinner: ${winner.formName}  (Texas MAE=${winner.texas.mae.toFixed(4)})`);

  writeFileSync(
    "scripts/eval/v1-model.json",
    JSON.stringify(
      {
        formName: winner.formName,
        spec: winner.spec,
        coefficients: winner.coefficients,
        utah: winner.utah,
        texas: winner.texas,
        allResults: results.map((r) => ({
          formName: r.formName,
          utah: r.utah,
          texas: r.texas,
        })),
      },
      null,
      2
    )
  );
  console.log("Wrote scripts/eval/v1-model.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
