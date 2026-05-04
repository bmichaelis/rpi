import { describe, it, expect } from "vitest";
import { extractFeatures, type FormSpec } from "./features-v1";
import type { TeamSchedule } from "../types";

function team(games: Array<{ won: boolean | null; gf: number; ga: number; isPlayoff?: boolean }>): TeamSchedule {
  return {
    games: games.map((g) => ({
      opponentSlug: "opp",
      opponentName: "Opp",
      won: g.won,
      goalsScored: g.gf,
      goalsAllowed: g.ga,
      isPlayoff: g.isPlayoff ?? false,
    })),
    upcoming: [],
    classification: 4,
    teamName: "Test",
    fetchedAt: "2026-01-01T00:00:00Z",
  };
}

describe("extractFeatures", () => {
  const baseSpec: FormSpec = {
    name: "base",
    intercept: true,
    margin: { kind: "cappedGd", cap: 3 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  };

  it("includes intercept, W−L, strength, and capped GD", () => {
    // 3-1-1 record, gd per game = 1.0, strength = 5.0
    const sched = team([
      { won: true, gf: 3, ga: 1 },   // gd=2
      { won: true, gf: 2, ga: 0 },   // gd=2
      { won: true, gf: 5, ga: 0 },   // gd=5 → capped 3
      { won: false, gf: 0, ga: 1 },  // gd=-1
      { won: null, gf: 1, ga: 1 },   // gd=0
    ]);
    const feats = extractFeatures(sched, baseSpec, 5.0);
    // Order: [intercept, W−L, strength, gdCap]
    expect(feats).toEqual([1, 2, 5.0, (2 + 2 + 3 + -1 + 0) / 5]);
  });

  it("excludes intercept when spec disables it", () => {
    const spec: FormSpec = { ...baseSpec, intercept: false };
    const sched = team([{ won: true, gf: 1, ga: 0 }]);
    const feats = extractFeatures(sched, spec, 0);
    // [W−L, strength, gdCap]
    expect(feats).toHaveLength(3);
    expect(feats[0]).toBe(1); // W−L
  });

  it("uses Pythagorean margin when spec selects it", () => {
    const spec: FormSpec = {
      ...baseSpec,
      margin: { kind: "pythagorean", exponent: 2 },
    };
    // Single game, gf=3, ga=1 → 3²/(3²+1²) = 9/10 = 0.9; centred: 0.9 - 0.5 = 0.4
    const sched = team([{ won: true, gf: 3, ga: 1 }]);
    const feats = extractFeatures(sched, spec, 0);
    expect(feats[3]).toBeCloseTo(0.4, 6);
  });

  it("uses log margin when spec selects it", () => {
    const spec: FormSpec = {
      ...baseSpec,
      margin: { kind: "log" },
    };
    // log(1+gf) - log(1+ga); avg over 1 game with gf=3, ga=1 → log(4)-log(2) = log(2)
    const sched = team([{ won: true, gf: 3, ga: 1 }]);
    const feats = extractFeatures(sched, spec, 0);
    expect(feats[3]).toBeCloseTo(Math.log(2), 6);
  });

  it("splits ties when tiesSeparate is true", () => {
    const spec: FormSpec = { ...baseSpec, tiesSeparate: true };
    const sched = team([
      { won: true, gf: 1, ga: 0 },
      { won: false, gf: 0, ga: 1 },
      { won: null, gf: 1, ga: 1 },
    ]);
    const feats = extractFeatures(sched, spec, 0);
    // Order: [intercept, W, L, T, strength, gdCap]
    expect(feats).toEqual([1, 1, 1, 1, 0, expect.any(Number)]);
  });

  it("includes class intercepts (one-hot 4A/5A/6A/OOS)", () => {
    const spec: FormSpec = { ...baseSpec, classIntercepts: true };
    const sched = team([{ won: true, gf: 1, ga: 0 }]);
    const feats = extractFeatures(sched, spec, 0);
    // [intercept_4A, intercept_5A, intercept_6A, intercept_OOS, W−L, strength, gdCap]
    // (intercept replaced by class one-hot when classIntercepts=true)
    expect(feats).toHaveLength(7);
    expect(feats[0]).toBe(1); // 4A
    expect(feats[1]).toBe(0);
    expect(feats[2]).toBe(0);
    expect(feats[3]).toBe(0);
  });

  it("adds strength × (W−L) interaction", () => {
    const spec: FormSpec = {
      ...baseSpec,
      interactions: ["strengthTimesWinLoss"],
    };
    const sched = team([
      { won: true, gf: 1, ga: 0 },
      { won: true, gf: 1, ga: 0 },
      { won: false, gf: 0, ga: 1 },
    ]);
    // W−L = 1, strength = 4.0, interaction = 4.0
    const feats = extractFeatures(sched, spec, 4.0);
    // [intercept, W−L, strength, gdCap, strength*WmL]
    expect(feats).toHaveLength(5);
    expect(feats[4]).toBe(4.0);
  });

  it("filters out unplayed games (goalsScored null)", () => {
    const sched = team([{ won: true, gf: 1, ga: 0 }]);
    sched.games.push({
      opponentSlug: "x",
      opponentName: "X",
      won: null,
      goalsScored: null,
      goalsAllowed: null,
      isPlayoff: false,
    });
    const feats = extractFeatures(sched, baseSpec, 0);
    // Only the played game's GD contributes: gd=1, capped=1
    expect(feats[3]).toBe(1);
  });
});
