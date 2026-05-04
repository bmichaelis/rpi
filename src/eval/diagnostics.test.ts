import { describe, it, expect } from "vitest";
import { computeResiduals, correlate, perTeamMetrics } from "./diagnostics";

describe("computeResiduals", () => {
  it("returns predicted − official per slug, only where both exist", () => {
    const predictions = { a: 5, b: 10, c: 7 };
    const official = { a: 4, b: 11 }; // no c
    const out = computeResiduals(predictions, official);
    expect(out).toEqual([
      { slug: "a", predicted: 5, official: 4, residual: 1 },
      { slug: "b", predicted: 10, official: 11, residual: -1 },
    ]);
  });
});

describe("correlate", () => {
  it("returns Pearson r ∈ [−1, 1]", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [2, 4, 6, 8, 10]; // perfect positive
    expect(correlate(xs, ys)).toBeCloseTo(1, 6);

    const ys2 = [10, 8, 6, 4, 2]; // perfect negative
    expect(correlate(xs, ys2)).toBeCloseTo(-1, 6);
  });

  it("returns 0 for uncorrelated data (constant ys)", () => {
    expect(correlate([1, 2, 3], [5, 5, 5])).toBe(0);
  });

  it("handles fewer than 2 points by returning 0", () => {
    expect(correlate([1], [1])).toBe(0);
    expect(correlate([], [])).toBe(0);
  });
});

describe("perTeamMetrics", () => {
  it("computes nGames, recordTuple, gdMean, gdVar, strength", () => {
    const games = [
      { won: true, gf: 3, ga: 1, isPlayoff: false },
      { won: true, gf: 2, ga: 0, isPlayoff: false },
      { won: false, gf: 0, ga: 1, isPlayoff: false },
      { won: null, gf: 1, ga: 1, isPlayoff: false },
      { won: true, gf: 4, ga: 0, isPlayoff: true }, // playoff — included
    ];
    const m = perTeamMetrics(
      {
        games: games.map((g) => ({
          opponentSlug: "x",
          opponentName: "X",
          won: g.won,
          goalsScored: g.gf,
          goalsAllowed: g.ga,
          isPlayoff: g.isPlayoff,
        })),
        upcoming: [],
        classification: 4,
        teamName: "T",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
      3.0
    );
    expect(m.nGames).toBe(5);
    expect(m.W).toBe(3);
    expect(m.L).toBe(1);
    expect(m.T).toBe(1);
    expect(m.gdMean).toBeCloseTo((2 + 2 + -1 + 0 + 4) / 5, 6);
    // gdVar is sample variance (n-1 denom); assert finite > 0
    expect(m.gdVar).toBeGreaterThan(0);
    expect(m.strength).toBe(3.0);
  });
});
