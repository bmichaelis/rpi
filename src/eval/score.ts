import type { Snapshot, Score, ClassMetrics, ResidualBucket } from "./types";

function classLabel(cls: number | "oos"): string {
  return cls === "oos" ? "OOS" : `${cls}A`;
}

function metricsFor(
  pairs: { predicted: number; official: number }[]
): { mae: number; rmse: number; maxErr: number; r2: number } {
  if (pairs.length === 0) return { mae: 0, rmse: 0, maxErr: 0, r2: 0 };

  let sumAbs = 0;
  let sumSq = 0;
  let maxErr = 0;
  let sumOfficial = 0;
  for (const { predicted, official } of pairs) {
    const residual = predicted - official;
    const absR = Math.abs(residual);
    sumAbs += absR;
    sumSq += residual * residual;
    if (absR > maxErr) maxErr = absR;
    sumOfficial += official;
  }
  const n = pairs.length;
  const meanOfficial = sumOfficial / n;
  let ssTot = 0;
  for (const { official } of pairs) {
    const d = official - meanOfficial;
    ssTot += d * d;
  }
  const r2 = ssTot === 0 ? 1 : 1 - sumSq / ssTot;
  return {
    mae: sumAbs / n,
    rmse: Math.sqrt(sumSq / n),
    maxErr,
    r2,
  };
}

function histogram(residuals: number[], buckets = 10): ResidualBucket[] {
  if (residuals.length === 0) return [];
  const min = Math.min(...residuals);
  const max = Math.max(...residuals);
  // Edge case: all residuals identical → put them all in one bucket
  if (min === max) {
    return [{ binStart: min, binEnd: min, count: residuals.length }];
  }
  const width = (max - min) / buckets;
  const result: ResidualBucket[] = [];
  for (let i = 0; i < buckets; i++) {
    const binStart = min + i * width;
    const binEnd = i === buckets - 1 ? max : min + (i + 1) * width;
    result.push({ binStart, binEnd, count: 0 });
  }
  for (const r of residuals) {
    let idx = Math.floor((r - min) / width);
    if (idx >= buckets) idx = buckets - 1; // include max in last bucket
    result[idx].count++;
  }
  return result;
}

export function score(
  snapshot: Snapshot,
  predictions: Record<string, number>
): Score {
  const pairs: { slug: string; predicted: number; official: number; cls: string }[] = [];
  for (const [slug, official] of Object.entries(snapshot.officialRatings)) {
    const predicted = predictions[slug];
    if (predicted === undefined) continue;
    const cls = classLabel(snapshot.scheduleCache[slug]?.classification ?? "oos");
    pairs.push({ slug, predicted, official, cls });
  }

  const overall = metricsFor(pairs);

  const residualHistogram = histogram(
    pairs.map((p) => p.predicted - p.official)
  );

  const byClass: Record<string, ClassMetrics> = {};
  const classes = [...new Set(pairs.map((p) => p.cls))];
  for (const cls of classes) {
    const subset = pairs.filter((p) => p.cls === cls);
    const m = metricsFor(subset);
    byClass[cls] = { n: subset.length, ...m };
  }

  const worst10 = [...pairs]
    .sort((a, b) => Math.abs(b.predicted - b.official) - Math.abs(a.predicted - a.official))
    .slice(0, 10)
    .map((p) => ({
      slug: p.slug,
      predicted: p.predicted,
      official: p.official,
      residual: p.predicted - p.official,
    }));

  return {
    n: pairs.length,
    ...overall,
    residualHistogram,
    byClass,
    worst10,
  };
}
