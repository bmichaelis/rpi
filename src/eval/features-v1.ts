import type { TeamSchedule, Game } from "../types";

export type MarginSpec =
  | { kind: "cappedGd"; cap: number }
  | { kind: "pythagorean"; exponent: number }
  | { kind: "log" };

export type Interaction = "strengthTimesWinLoss" | "strengthTimesMargin";

export interface FormSpec {
  name: string;
  intercept: boolean;            // single intercept term
  margin: MarginSpec;
  strength: boolean;             // include strength as a feature
  tiesSeparate: boolean;         // split (W, L, T) instead of just (W − L); replaces W−L term
  classIntercepts: boolean;      // one-hot 4A/5A/6A/OOS replaces single intercept
  interactions: Interaction[];
}

const CLASS_LABELS = ["4A", "5A", "6A", "OOS"] as const;
type ClassLabel = (typeof CLASS_LABELS)[number];

function classLabel(cls: number | "oos"): ClassLabel {
  if (cls === "oos") return "OOS";
  if (cls === 4) return "4A";
  if (cls === 5) return "5A";
  if (cls === 6) return "6A";
  return "OOS";
}

function avgMargin(playedGames: Game[], spec: MarginSpec): number {
  if (playedGames.length === 0) return 0;
  const margins: number[] = [];
  for (const g of playedGames) {
    const gf = g.goalsScored ?? 0;
    const ga = g.goalsAllowed ?? 0;
    if (spec.kind === "cappedGd") {
      const gd = gf - ga;
      margins.push(Math.max(-spec.cap, Math.min(spec.cap, gd)));
    } else if (spec.kind === "pythagorean") {
      const e = spec.exponent;
      const num = Math.pow(gf, e);
      const den = Math.pow(gf, e) + Math.pow(ga, e);
      // Centred around 0.5 so that even matchups → 0
      margins.push(den === 0 ? 0 : num / den - 0.5);
    } else if (spec.kind === "log") {
      margins.push(Math.log(1 + gf) - Math.log(1 + ga));
    }
  }
  return margins.reduce((a, b) => a + b, 0) / margins.length;
}

export function extractFeatures(
  schedule: TeamSchedule,
  spec: FormSpec,
  strength: number
): number[] {
  // Played games only (goalsScored !== null means the game was played)
  const played = schedule.games.filter((g) => g.goalsScored !== null && g.goalsAllowed !== null);

  let W = 0;
  let L = 0;
  let T = 0;
  for (const g of played) {
    if (g.won === true) W++;
    else if (g.won === false) L++;
    else T++;
  }

  const features: number[] = [];

  // Intercepts
  if (spec.classIntercepts) {
    const cls = classLabel(schedule.classification);
    for (const c of CLASS_LABELS) features.push(c === cls ? 1 : 0);
  } else if (spec.intercept) {
    features.push(1);
  }

  // Record terms
  if (spec.tiesSeparate) {
    features.push(W, L, T);
  } else {
    features.push(W - L);
  }

  // Strength
  if (spec.strength) features.push(strength);

  // Margin
  const margin = avgMargin(played, spec.margin);
  features.push(margin);

  // Interactions
  for (const inter of spec.interactions) {
    if (inter === "strengthTimesWinLoss") features.push(strength * (W - L));
    else if (inter === "strengthTimesMargin") features.push(strength * margin);
  }

  return features;
}
