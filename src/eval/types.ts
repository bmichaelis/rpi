import type { TeamSchedule } from "../types";

export interface Snapshot {
  capturedAt: string;
  source: string; // e.g. "utah-4a5a6a-2026" or "texas-uil-6a-2026"
  scheduleCache: Record<string, TeamSchedule>;
  officialRatings: Record<string, number>; // slug → MaxPreps rating
  strengthMap: Record<string, number>;     // slug → MaxPreps strength
}

export interface ResidualBucket {
  binStart: number;
  binEnd: number;
  count: number;
}

export interface ClassMetrics {
  n: number;
  mae: number;
  rmse: number;
  maxErr: number;
  r2: number;
}

export interface Score {
  n: number;
  mae: number;
  rmse: number;
  maxErr: number;
  r2: number;
  residualHistogram: ResidualBucket[];
  byClass: Record<string, ClassMetrics>;
  worst10: { slug: string; predicted: number; official: number; residual: number }[];
}
