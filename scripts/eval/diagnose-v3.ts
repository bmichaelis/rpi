import { readFileSync, existsSync } from "fs";
import { predictBaseline } from "../../src/eval/baseline-formula";
import { computeResiduals, correlate, perTeamMetrics } from "../../src/eval/diagnostics";
import { extractFeaturesV3 } from "../../src/eval/features-v3";
import type { Snapshot } from "../../src/eval/types";

interface ModelFile {
  featureNames: string[];
  coefficients: number[];
}

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function main() {
  const utah = loadSnapshot("scripts/eval/data/utah-2026.json");

  // Use v3-model.json if available; otherwise fall back to baseline.
  const modelPath = "scripts/eval/v3-model.json";
  let predictFn: (slug: string, snap: Snapshot) => number;
  let modelLabel: string;

  if (existsSync(modelPath)) {
    const model = JSON.parse(readFileSync(modelPath, "utf8")) as ModelFile;
    modelLabel = `v3-model (${model.featureNames.join(", ")})`;
    predictFn = (slug, snap) => {
      const sched = snap.scheduleCache[slug];
      if (!sched) return 0;
      const strength = snap.strengthMap[slug] ?? 0;
      const feats = extractFeaturesV3(sched, strength);
      let p = 0;
      for (let i = 0; i < feats.length; i++) p += model.coefficients[i] * feats[i];
      return p;
    };
  } else {
    modelLabel = "baseline OLS";
    predictFn = (slug, snap) => {
      const sched = snap.scheduleCache[slug];
      if (!sched) return 0;
      const strength = snap.strengthMap[slug] ?? 0;
      return predictBaseline(sched, strength);
    };
  }

  // Baseline predictions for ranked teams only
  const predictions: Record<string, number> = {};
  for (const slug of Object.keys(utah.officialRatings)) {
    predictions[slug] = predictFn(slug, utah);
  }
  const residuals = computeResiduals(predictions, utah.officialRatings);

  console.log(`Utah residuals (${modelLabel}): n=${residuals.length}`);
  console.log(`Mean residual: ${(residuals.reduce((s, r) => s + r.residual, 0) / residuals.length).toFixed(4)}`);
  console.log(`Mean |residual|: ${(residuals.reduce((s, r) => s + Math.abs(r.residual), 0) / residuals.length).toFixed(4)}`);

  // Per-team metrics
  const metricsBySlug = new Map<string, ReturnType<typeof perTeamMetrics>>();
  for (const r of residuals) {
    const sched = utah.scheduleCache[r.slug];
    if (!sched) continue;
    metricsBySlug.set(r.slug, perTeamMetrics(sched, utah.strengthMap[r.slug] ?? 0));
  }

  // Correlate residual with each metric
  const features: Array<{ name: string; getter: (m: ReturnType<typeof perTeamMetrics>) => number }> = [
    { name: "nGames", getter: (m) => m.nGames },
    { name: "W − L", getter: (m) => m.W - m.L },
    { name: "T (ties)", getter: (m) => m.T },
    { name: "gdMean", getter: (m) => m.gdMean },
    { name: "|gdMean|", getter: (m) => Math.abs(m.gdMean) },
    { name: "gdVar", getter: (m) => m.gdVar },
    { name: "gdMax", getter: (m) => m.gdMax },
    { name: "gdMin (most-negative game)", getter: (m) => m.gdMin },
    { name: "strength", getter: (m) => m.strength },
    { name: "|strength|", getter: (m) => Math.abs(m.strength) },
    { name: "strength × (W − L)", getter: (m) => m.strength * (m.W - m.L) },
    { name: "strength × gdMean", getter: (m) => m.strength * m.gdMean },
    { name: "log(1+W)", getter: (m) => Math.log(1 + m.W) },
    { name: "L²", getter: (m) => m.L * m.L },
    { name: "(W−L)/nGames", getter: (m) => m.nGames > 0 ? (m.W - m.L) / m.nGames : 0 },
    { name: "W/nGames (win rate)", getter: (m) => m.nGames > 0 ? m.W / m.nGames : 0 },
  ];

  console.log("\nCorrelation of residual with team-level features:");
  console.log("Feature                         | Pearson r");
  console.log("--------------------------------|----------");
  const correlations: Array<{ name: string; r: number }> = [];
  for (const f of features) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const res of residuals) {
      const m = metricsBySlug.get(res.slug);
      if (!m) continue;
      xs.push(f.getter(m));
      ys.push(res.residual);
    }
    const r = correlate(xs, ys);
    correlations.push({ name: f.name, r });
  }
  correlations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  for (const c of correlations) {
    console.log(`${c.name.padEnd(32)}| ${c.r.toFixed(4).padStart(8)}`);
  }

  // Residuals binned by class
  console.log("\nResiduals by class:");
  const byClass = new Map<string, number[]>();
  for (const r of residuals) {
    const cls = metricsBySlug.get(r.slug)?.classLabel ?? "?";
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push(r.residual);
  }
  for (const [cls, arr] of [...byClass].sort()) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const meanAbs = arr.reduce((a, b) => a + Math.abs(b), 0) / arr.length;
    console.log(`${cls}: n=${arr.length}, mean=${mean.toFixed(4)}, mean |residual|=${meanAbs.toFixed(4)}`);
  }

  // Top 10 worst residuals
  console.log("\nTop 10 worst |residuals|:");
  const top = [...residuals].sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)).slice(0, 10);
  for (const r of top) {
    const m = metricsBySlug.get(r.slug);
    console.log(
      `  ${r.slug.padEnd(40)} pred=${r.predicted.toFixed(2).padStart(7)} off=${r.official.toFixed(2).padStart(7)} res=${r.residual.toFixed(2).padStart(7)}` +
        `  [${m?.classLabel ?? "?"} W=${m?.W} L=${m?.L} T=${m?.T} n=${m?.nGames} gd=${m?.gdMean.toFixed(2)}]`
    );
  }
}

main();
