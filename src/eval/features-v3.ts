import type { TeamSchedule, Game } from "../types";

/**
 * Iteratively-grown feature extractor for Worktree C.
 *
 * Iterations completed:
 *   1. Added (W−L)/nGames — season-normalised net win rate. KEPT: −0.57 Texas MAE.
 *   2. Tried dropping raw W−L. REVERTED: Utah worsened by 0.06.
 *   3. Added strength × (W−L)/nGames interaction. KEPT: −0.02 Texas MAE.
 *   4. Tried gdVar. REVERTED: Texas worsened by 0.03.
 *   5. Tried gdMean instead of gdCap. REVERTED: both sets worsened.
 *
 * Final feature set (after iterations 1 and 3 kept):
 *   intercept, W−L, strength, gdCap, (W−L)/nGames, strength×(W−L)/nGames
 *
 * The order of features in the returned array is significant — it matches the
 * coefficient order produced by `solveOls`. Update `FEATURE_NAMES` whenever you
 * change the feature list.
 */
export const FEATURE_NAMES = [
  "intercept",
  "W − L",
  "strength",
  "gdCap",
  "(W−L)/nGames",
  "strength×(W−L)/nGames",
];

export function extractFeaturesV3(schedule: TeamSchedule, strength: number): number[] {
  const played = schedule.games.filter(
    (g) => g.goalsScored !== null && g.goalsAllowed !== null
  );
  let W = 0, L = 0;
  let gdSum = 0;
  for (const g of played) {
    if (g.won === true) W++;
    else if (g.won === false) L++;
    const gd = (g.goalsScored ?? 0) - (g.goalsAllowed ?? 0);
    gdSum += Math.max(-3, Math.min(3, gd));
  }
  const n = played.length;
  const gdCap = n > 0 ? gdSum / n : 0;
  const wlNorm = n > 0 ? (W - L) / n : 0;
  return [1, W - L, strength, gdCap, wlNorm, strength * wlNorm];
}

// Helpers callable when adding new features. Use them when iterating.
export function gdVariance(played: Game[]): number {
  if (played.length < 2) return 0;
  const gds = played.map((g) => (g.goalsScored ?? 0) - (g.goalsAllowed ?? 0));
  const mean = gds.reduce((a, b) => a + b, 0) / gds.length;
  let sq = 0;
  for (const v of gds) sq += (v - mean) ** 2;
  return sq / (gds.length - 1);
}

export function pythagoreanGoalRatio(played: Game[], exponent: number): number {
  if (played.length === 0) return 0;
  const ratios = played.map((g) => {
    const gf = g.goalsScored ?? 0;
    const ga = g.goalsAllowed ?? 0;
    const num = Math.pow(gf, exponent);
    const den = Math.pow(gf, exponent) + Math.pow(ga, exponent);
    return den === 0 ? 0.5 : num / den;
  });
  return ratios.reduce((a, b) => a + b, 0) / ratios.length - 0.5; // centred
}
