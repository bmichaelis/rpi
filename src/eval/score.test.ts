import { describe, it, expect } from "vitest";
import { score } from "./score";
import type { Snapshot } from "./types";

function makeSnapshot(officialRatings: Record<string, number>, classifications: Record<string, number | "oos"> = {}): Snapshot {
  const scheduleCache: Snapshot["scheduleCache"] = {};
  for (const slug of Object.keys(officialRatings)) {
    scheduleCache[slug] = {
      games: [],
      upcoming: [],
      classification: classifications[slug] ?? 4,
      teamName: slug,
      fetchedAt: "2026-01-01T00:00:00Z",
    };
  }
  return {
    capturedAt: "2026-01-01T00:00:00Z",
    source: "test",
    scheduleCache,
    officialRatings,
    strengthMap: {},
  };
}

describe("score", () => {
  it("returns zero error when predictions match", () => {
    const snap = makeSnapshot({ a: 5, b: 10, c: 15 });
    const preds = { a: 5, b: 10, c: 15 };
    const s = score(snap, preds);
    expect(s.mae).toBe(0);
    expect(s.rmse).toBe(0);
    expect(s.maxErr).toBe(0);
    expect(s.r2).toBe(1);
    expect(s.n).toBe(3);
  });

  it("computes MAE, RMSE, MaxErr correctly", () => {
    const snap = makeSnapshot({ a: 10, b: 10, c: 10 });
    const preds = { a: 11, b: 12, c: 7 };
    const s = score(snap, preds);
    // residuals: +1, +2, -3 → |residuals|: 1, 2, 3
    expect(s.mae).toBeCloseTo((1 + 2 + 3) / 3, 6);
    expect(s.rmse).toBeCloseTo(Math.sqrt((1 + 4 + 9) / 3), 6);
    expect(s.maxErr).toBe(3);
  });

  it("ignores teams missing from predictions", () => {
    const snap = makeSnapshot({ a: 5, b: 10, c: 15 });
    const preds = { a: 5, b: 10 }; // no c
    const s = score(snap, preds);
    expect(s.n).toBe(2);
  });

  it("ignores teams missing from officialRatings", () => {
    const snap = makeSnapshot({ a: 5 });
    const preds = { a: 5, b: 999 }; // b not in official
    const s = score(snap, preds);
    expect(s.n).toBe(1);
  });

  it("breaks down metrics by class", () => {
    const snap = makeSnapshot(
      { a: 10, b: 10, c: 10, d: 10 },
      { a: 4, b: 4, c: 5, d: 5 }
    );
    const preds = { a: 12, b: 12, c: 11, d: 11 };
    const s = score(snap, preds);
    expect(s.byClass["4A"].mae).toBeCloseTo(2, 6);
    expect(s.byClass["4A"].n).toBe(2);
    expect(s.byClass["5A"].mae).toBeCloseTo(1, 6);
    expect(s.byClass["5A"].n).toBe(2);
  });

  it("returns worst10 sorted by absolute residual descending", () => {
    const snap = makeSnapshot({ a: 0, b: 0, c: 0, d: 0 });
    const preds = { a: 0.5, b: -2, c: 1, d: -3 };
    const s = score(snap, preds);
    const order = s.worst10.map((w) => w.slug);
    expect(order).toEqual(["d", "b", "c", "a"]);
  });

  it("computes R² = 1 - SS_res/SS_tot", () => {
    // Mean of officials (1, 2, 3) = 2. SS_tot = 1 + 0 + 1 = 2.
    // Predictions (1.5, 2, 2.5). Residuals (0.5, 0, 0.5). SS_res = 0.25 + 0 + 0.25 = 0.5.
    // R² = 1 - 0.5/2 = 0.75.
    const snap = makeSnapshot({ a: 1, b: 2, c: 3 });
    const preds = { a: 1.5, b: 2, c: 2.5 };
    const s = score(snap, preds);
    expect(s.r2).toBeCloseTo(0.75, 6);
  });

  it("produces a residual histogram with 10 buckets", () => {
    const snap = makeSnapshot(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`t${i}`, 0])));
    // Predictions span -1 to +1 in 0.1 increments
    const preds = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`t${i}`, -1 + i * 0.1]));
    const s = score(snap, preds);
    expect(s.residualHistogram).toHaveLength(10);
    const total = s.residualHistogram.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(20);
  });
});
