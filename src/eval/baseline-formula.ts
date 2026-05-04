import type { TeamSchedule } from "../types";

export const BASELINE_COEFFICIENTS = {
  intercept: 0.0552,
  winLoss: 0.8809,
  strength: 0.9183,
  gdCap: 1.6813,
};

export function baselineFeatures(schedule: TeamSchedule, strength: number): {
  W: number; L: number; T: number; gdCap: number; strength: number;
} {
  const played = schedule.games.filter((g) => g.goalsScored !== null && g.goalsAllowed !== null);
  let W = 0, L = 0, T = 0;
  let gdSum = 0;
  for (const g of played) {
    if (g.won === true) W++;
    else if (g.won === false) L++;
    else T++;
    const gd = (g.goalsScored ?? 0) - (g.goalsAllowed ?? 0);
    gdSum += Math.max(-3, Math.min(3, gd));
  }
  const gdCap = played.length > 0 ? gdSum / played.length : 0;
  return { W, L, T, gdCap, strength };
}

export function predictBaseline(schedule: TeamSchedule, strength: number): number {
  const f = baselineFeatures(schedule, strength);
  return (
    BASELINE_COEFFICIENTS.intercept +
    BASELINE_COEFFICIENTS.winLoss * (f.W - f.L) +
    BASELINE_COEFFICIENTS.strength * f.strength +
    BASELINE_COEFFICIENTS.gdCap * f.gdCap
  );
}
