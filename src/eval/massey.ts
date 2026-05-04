import { solveOls } from "./ols";

export type MasseyMargin =
  | { kind: "binary" }                   // ±1 per game (won = +1, lost = −1, tied = 0)
  | { kind: "cappedGd"; cap: number };   // signed GD capped at ±cap

export interface MasseyGame {
  a: string;
  b: string;
  marginAOverB: number; // raw signed margin (e.g. GF_A - GF_B). Margin function applied here.
}

/**
 * Solve a Massey rating system from a list of pairwise game outcomes.
 *
 * Each game (a, b, m) becomes one equation: r_a − r_b = transform(m).
 * A sum-zero anchor (Σ r = 0) makes the system uniquely solvable.
 * Optional ridge λ adds λ·I to the normal equations.
 *
 * Returns a Map slug → rating. Teams not appearing in any game are excluded.
 */
export function solveMassey(
  games: MasseyGame[],
  margin: MasseyMargin,
  ridge: number
): Map<string, number> {
  // Collect distinct slugs
  const slugSet = new Set<string>();
  for (const g of games) {
    slugSet.add(g.a);
    slugSet.add(g.b);
  }
  const slugs = [...slugSet].sort();
  const idx = new Map(slugs.map((s, i) => [s, i] as const));
  const n = slugs.length;
  if (n === 0) return new Map();

  // Build design matrix X (one row per game + one anchor row) and y.
  const X: number[][] = [];
  const y: number[] = [];
  for (const g of games) {
    const row = new Array(n).fill(0);
    row[idx.get(g.a)!] = 1;
    row[idx.get(g.b)!] = -1;
    X.push(row);
    y.push(transformMargin(g.marginAOverB, margin));
  }
  // Sum-zero anchor with a large weight, so the system is rank-n.
  // We use weight 1 — the anchor should be a soft constraint that
  // any sum near zero satisfies. With ridge=0 and binary margins
  // this still pins the gauge.
  X.push(new Array(n).fill(1));
  y.push(0);

  // Solve OLS, optionally with ridge.
  // For ridge: augment X with sqrt(λ)·I, y with zeros.
  if (ridge > 0) {
    const sqrtL = Math.sqrt(ridge);
    for (let i = 0; i < n; i++) {
      const row = new Array(n).fill(0);
      row[i] = sqrtL;
      X.push(row);
      y.push(0);
    }
  }

  const beta = solveOls(X, y);
  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) result.set(slugs[i], beta[i]);
  return result;
}

function transformMargin(raw: number, spec: MasseyMargin): number {
  if (spec.kind === "binary") {
    if (raw > 0) return 1;
    if (raw < 0) return -1;
    return 0;
  }
  if (spec.kind === "cappedGd") {
    return Math.max(-spec.cap, Math.min(spec.cap, raw));
  }
  return raw;
}
