import { describe, it, expect } from "vitest";
import { fitAffine, applyAffine } from "./calibrate";

describe("fitAffine", () => {
  it("recovers exact (a, b) for a perfect linear relation", () => {
    // r_official = 2 * r_raw + 5
    const raw = new Map([
      ["x", 0],
      ["y", 1],
      ["z", -1],
      ["w", 3],
    ]);
    const official: Record<string, number> = { x: 5, y: 7, z: 3, w: 11 };
    const { a, b } = fitAffine(raw, official);
    expect(a).toBeCloseTo(2, 6);
    expect(b).toBeCloseTo(5, 6);
  });

  it("ignores teams missing from one side", () => {
    const raw = new Map([
      ["x", 0],
      ["y", 1],
      ["z", -1],
    ]);
    const official: Record<string, number> = { x: 5, y: 7 }; // no z
    const { a, b } = fitAffine(raw, official);
    expect(a).toBeCloseTo(2, 6);
    expect(b).toBeCloseTo(5, 6);
  });

  it("falls back gracefully when there are < 2 paired points", () => {
    const raw = new Map([["x", 1]]);
    const official: Record<string, number> = { x: 10 };
    const { a, b } = fitAffine(raw, official);
    // Single point: a=1, b=10−1 (preserve scale, shift to match)
    expect(a).toBe(1);
    expect(b).toBeCloseTo(9, 6);
  });
});

describe("applyAffine", () => {
  it("transforms each rating by a · r + b", () => {
    const raw = new Map([
      ["x", 1],
      ["y", 2],
    ]);
    const out = applyAffine(raw, { a: 3, b: 4 });
    expect(out.get("x")).toBe(7);
    expect(out.get("y")).toBe(10);
  });
});
