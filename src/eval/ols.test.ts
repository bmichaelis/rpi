import { describe, it, expect } from "vitest";
import { solveOls } from "./ols";

describe("solveOls", () => {
  it("recovers a known linear function (no noise)", () => {
    // y = 2*x1 + 3*x2 - 1
    const X = [
      [1, 1, 1],
      [1, 2, 1],
      [1, 1, 2],
      [1, 3, 4],
    ];
    const y = X.map((row) => -1 * row[0] + 2 * row[1] + 3 * row[2]);
    const beta = solveOls(X, y);
    expect(beta[0]).toBeCloseTo(-1, 6);
    expect(beta[1]).toBeCloseTo(2, 6);
    expect(beta[2]).toBeCloseTo(3, 6);
  });

  it("handles an exactly-determined 2×2 system", () => {
    const X = [
      [1, 1],
      [1, 2],
    ];
    const y = [3, 5]; // y = 1 + 2x
    const beta = solveOls(X, y);
    expect(beta[0]).toBeCloseTo(1, 6);
    expect(beta[1]).toBeCloseTo(2, 6);
  });

  it("minimises sum of squares for over-determined noisy data", () => {
    // Fit y = a + b*x with noise; n=5, p=2
    const xs = [1, 2, 3, 4, 5];
    const X = xs.map((x) => [1, x]);
    // True params: a=1, b=2; add tiny noise
    const y = [3.1, 4.9, 7.1, 8.9, 11.1];
    const beta = solveOls(X, y);
    expect(beta[0]).toBeCloseTo(1.0, 1);
    expect(beta[1]).toBeCloseTo(2.0, 1);
  });

  it("throws on singular matrix", () => {
    const X = [
      [1, 2],
      [2, 4], // collinear
      [3, 6],
    ];
    const y = [1, 2, 3];
    expect(() => solveOls(X, y)).toThrow(/singular/i);
  });

  it("throws on shape mismatch", () => {
    const X = [
      [1, 1],
      [1, 2],
    ];
    const y = [1]; // wrong length
    expect(() => solveOls(X, y)).toThrow(/shape/i);
  });
});
