import type { TeamSchedule } from "../types";

export interface Residual {
  slug: string;
  predicted: number;
  official: number;
  residual: number;
}

export function computeResiduals(
  predictions: Record<string, number>,
  official: Record<string, number>
): Residual[] {
  const out: Residual[] = [];
  for (const [slug, p] of Object.entries(predictions)) {
    const o = official[slug];
    if (o === undefined) continue;
    out.push({ slug, predicted: p, official: o, residual: p - o });
  }
  return out;
}

/** Pearson correlation coefficient. Returns 0 for fewer than 2 points or zero variance. */
export function correlate(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

export interface TeamMetrics {
  nGames: number;
  W: number;
  L: number;
  T: number;
  gdMean: number;
  gdVar: number;       // sample variance of per-game GD
  gdMax: number;
  gdMin: number;
  strength: number;
  classLabel: string;  // "4A" / "5A" / "6A" / "OOS"
}

export function perTeamMetrics(schedule: TeamSchedule, strength: number): TeamMetrics {
  const played = schedule.games.filter(
    (g) => g.goalsScored !== null && g.goalsAllowed !== null
  );
  let W = 0, L = 0, T = 0;
  const gds: number[] = [];
  for (const g of played) {
    if (g.won === true) W++;
    else if (g.won === false) L++;
    else T++;
    gds.push((g.goalsScored ?? 0) - (g.goalsAllowed ?? 0));
  }
  const n = gds.length;
  const gdMean = n > 0 ? gds.reduce((a, b) => a + b, 0) / n : 0;
  let gdVar = 0;
  if (n > 1) {
    let sq = 0;
    for (const v of gds) sq += (v - gdMean) ** 2;
    gdVar = sq / (n - 1);
  }
  const gdMax = n > 0 ? Math.max(...gds) : 0;
  const gdMin = n > 0 ? Math.min(...gds) : 0;
  const cls = schedule.classification;
  const classLabel = cls === "oos" ? "OOS" : `${cls}A`;
  return { nGames: n, W, L, T, gdMean, gdVar, gdMax, gdMin, strength, classLabel };
}
