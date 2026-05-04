# MaxPreps Refined OLS (Worktree A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search over closed-form OLS variants of the MaxPreps rating formula and pick the one that best generalizes to the held-out Texas snapshot. Beat the current baseline (Texas MAE=4.39) by at least 0.20.

**Architecture:** A separate worktree off `main`. The eval harness (snapshots + scorer) is unchanged. This adds a small OLS solver, a feature extractor with several margin and interaction variants, a `fit-v1` script that searches the space, and a `predict-v1` script that applies the winning form. Results are committed to a `RESULT.md` for comparison against worktrees B and C.

**Tech Stack:** TypeScript + tsx (existing). Adds a hand-rolled OLS solver (~50 lines of Gaussian elimination + tests). No ML libraries.

**Spec:** `docs/superpowers/specs/2026-04-29-maxpreps-rating-reproduction-design.md` § "Approach 1 — Refined OLS"

**Prerequisites:**
- The eval harness (Plan 1) must be merged to `main`.
- `scripts/eval/data/utah-2026.json` and `scripts/eval/data/texas-2026.json` must exist.
- The branch `eval-harness` should be deleted (it's already merged).

**Out of scope (future plans):**
- Plan 3: Massey iteration (worktree B)
- Plan 4: Residual reverse-engineering (worktree C)
- Plan 5: Compare results, merge winner

---

## Methodology note (read first)

The spec calls for picking the form with "best held-out MAE." We'll fit each form's coefficients on Utah training, then score on Texas held-out, and pick the form with the lowest Texas MAE. This technically uses Texas as both *validation* (model selection) and *test* (final reporting), which can inflate the apparent generalization quality across many candidates. With ~10 candidate forms this is acceptable — a real cross-validation split is overkill at this scale. **Worktree authors should resist adding more candidate forms during the search just to chase Texas MAE; that turns Texas into a training set.**

If Worktree A's search produces N candidates with Texas MAE within 0.05 of each other, prefer the simpler form (fewer features) as the tiebreaker.

---

## File Structure

| File | Purpose |
|------|---------|
| `src/eval/ols.ts` (new) | Hand-rolled OLS solver: `solve(X, y) → β` via Gaussian elimination |
| `src/eval/ols.test.ts` (new) | Unit tests for the solver |
| `src/eval/features-v1.ts` (new) | `extractFeatures(scheduleCache, slug, formSpec) → number[]` |
| `src/eval/features-v1.test.ts` (new) | Unit tests for feature extraction |
| `src/eval/form-spec-v1.ts` (new) | The catalog of candidate `FormSpec`s |
| `scripts/eval/fit-v1.ts` (new) | Searches forms, fits each, scores, writes `v1-model.json` |
| `scripts/eval/predict-v1.ts` (new) | Loads `v1-model.json`, predicts for any snapshot |
| `scripts/eval/v1-model.json` (new, generated) | Winning form spec + coefficients |
| `RESULT.md` (new, in worktree root) | Search results + final scores |
| `package.json` | Add `predict:v1` script |

---

## Task 1: Set up worktree A

**Files:**
- Create: `.worktrees/refined-ols/` (via `git worktree add`)

This task runs on `main` and is done by hand because subagents have permission issues with `git worktree`.

- [ ] **Step 1: Verify pre-conditions on main**

```bash
cd /Users/brett/brett-dev/rpi
git checkout main
git pull --ff-only
ls scripts/eval/data/utah-2026.json scripts/eval/data/texas-2026.json scripts/eval/BASELINE.md
```

Expected: all three files exist, no errors.

- [ ] **Step 2: Create worktree**

```bash
git worktree add .worktrees/refined-ols -b refined-ols
cd .worktrees/refined-ols
```

- [ ] **Step 3: Copy local settings into worktree**

(Subagent permissions only resolve from the worktree's own `.claude/settings.local.json`.)

```bash
mkdir -p .claude
cp ../../.claude/settings.local.json .claude/settings.local.json
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

- [ ] **Step 5: Verify clean baseline**

```bash
npm run test && npm run typecheck && npm run baseline
```

Expected:
- 8/8 tests pass
- typecheck clean
- baseline output: `Utah-2026: MAE=0.9293, MaxErr=2.6675` and `Texas-2026: MAE=4.3937, MaxErr=17.3553`

- [ ] **Step 6: Confirm branch**

```bash
git rev-parse --abbrev-ref HEAD
```

Expected: `refined-ols`. All subsequent tasks happen in this worktree.

---

## Task 2: OLS solver with TDD

**Files:**
- Create: `src/eval/ols.ts`
- Create: `src/eval/ols.test.ts`

A least-squares solver: given an n×p design matrix X (rows = samples, columns = features) and an n-vector y, return the p-vector β minimising ||Xβ − y||².

We solve the normal equations `(X^T X) β = X^T y` via Gaussian elimination with partial pivoting. Sufficient for p ≤ 20 and n ≤ ~1000.

- [ ] **Step 1: Write failing tests**

Create `src/eval/ols.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm run test
```

Expected: failure — `solveOls` is not defined.

- [ ] **Step 3: Implement solveOls**

Create `src/eval/ols.ts`:

```typescript
/**
 * Solve the OLS problem min_β ||Xβ − y||² via the normal equations.
 * Returns β. Uses Gaussian elimination with partial pivoting.
 *
 * Inputs:
 *   X: n×p matrix as an array of n rows, each of length p
 *   y: n-vector
 * Returns:
 *   β: p-vector
 *
 * Throws if X is shape-mismatched with y, or if X^T X is singular.
 */
export function solveOls(X: number[][], y: number[]): number[] {
  const n = X.length;
  if (n === 0) throw new Error("solveOls: empty design matrix");
  const p = X[0].length;
  if (y.length !== n) throw new Error(`solveOls: shape mismatch (n=${n}, |y|=${y.length})`);
  for (const row of X) {
    if (row.length !== p) throw new Error("solveOls: ragged design matrix");
  }

  // A = X^T X (p×p), b = X^T y (p)
  const A: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const b: number[] = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += X[i][j] * y[i];
      for (let k = 0; k <= j; k++) {
        A[j][k] += X[i][j] * X[i][k];
      }
    }
  }
  // A is symmetric — mirror upper triangle
  for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) A[k][j] = A[j][k];

  return gaussianElim(A, b);
}

function gaussianElim(A: number[][], b: number[]): number[] {
  const n = A.length;
  // Augment
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot: find row with max |M[r][col]| for r >= col
    let pivot = col;
    let pivotMag = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const mag = Math.abs(M[r][col]);
      if (mag > pivotMag) {
        pivot = r;
        pivotMag = mag;
      }
    }
    if (pivotMag < 1e-12) throw new Error("solveOls: singular matrix");
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    // Eliminate
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  // Back-substitute
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}
```

- [ ] **Step 4: Run tests to verify success**

```bash
npm run test
```

Expected: all 5 new tests pass (plus the 8 existing scorer tests = 13 total).

- [ ] **Step 5: Commit**

```bash
git add src/eval/ols.ts src/eval/ols.test.ts
git commit -m "Add OLS solver with Gaussian elimination + tests"
```

---

## Task 3: Feature extractor with TDD

**Files:**
- Create: `src/eval/features-v1.ts`
- Create: `src/eval/features-v1.test.ts`

A feature extractor that produces a row of a design matrix from a team's schedule, parameterized by a `FormSpec`. The spec declares which margin function to use, whether to include interaction terms, whether to use a separate ties coefficient, etc.

- [ ] **Step 1: Write failing tests**

Create `src/eval/features-v1.test.ts`:

```typescript
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
    // Single game, gf=3, ga=1 → 3²/(3²+1²) = 9/10 = 0.9
    const sched = team([{ won: true, gf: 3, ga: 1 }]);
    const feats = extractFeatures(sched, spec, 0);
    expect(feats[3]).toBeCloseTo(0.9, 6);
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
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm run test
```

Expected: failure — `extractFeatures` is not defined.

- [ ] **Step 3: Implement features-v1**

Create `src/eval/features-v1.ts`:

```typescript
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
  // Played, non-playoff games — the same set MaxPreps's rating uses.
  // (Playoffs are included per spec; if you intentionally want to exclude them,
  // do so before calling this function.)
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
```

- [ ] **Step 4: Run tests to verify success**

```bash
npm run test
```

Expected: all 8 new feature tests pass (plus 5 OLS + 8 scorer = 21 total).

- [ ] **Step 5: Commit**

```bash
git add src/eval/features-v1.ts src/eval/features-v1.test.ts
git commit -m "Add v1 feature extractor with margin/interaction variants + tests"
```

---

## Task 4: Form catalog

**Files:**
- Create: `src/eval/form-spec-v1.ts`

The list of candidate forms to search over. Keep this focused — the methodology note says: don't pad the list to chase Texas MAE.

- [ ] **Step 1: Write the catalog**

Create `src/eval/form-spec-v1.ts`:

```typescript
import type { FormSpec } from "./features-v1";

export const CANDIDATE_FORMS: FormSpec[] = [
  // Baseline — matches the current production formula structure.
  {
    name: "current",
    intercept: true,
    margin: { kind: "cappedGd", cap: 3 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },

  // Margin cap variants
  {
    name: "gdCap2",
    intercept: true,
    margin: { kind: "cappedGd", cap: 2 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },
  {
    name: "gdCap4",
    intercept: true,
    margin: { kind: "cappedGd", cap: 4 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },

  // Pythagorean margin
  {
    name: "pyth1",
    intercept: true,
    margin: { kind: "pythagorean", exponent: 1 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },
  {
    name: "pyth2",
    intercept: true,
    margin: { kind: "pythagorean", exponent: 2 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },
  {
    name: "pyth2.5",
    intercept: true,
    margin: { kind: "pythagorean", exponent: 2.5 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },
  {
    name: "pyth3",
    intercept: true,
    margin: { kind: "pythagorean", exponent: 3 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },

  // Log margin
  {
    name: "logMargin",
    intercept: true,
    margin: { kind: "log" },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },

  // Best margin so far + interactions (decided after first sweep, listed up front for stable search)
  {
    name: "current+strengthXwml",
    intercept: true,
    margin: { kind: "cappedGd", cap: 3 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: ["strengthTimesWinLoss"],
  },
  {
    name: "current+strengthXmargin",
    intercept: true,
    margin: { kind: "cappedGd", cap: 3 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: ["strengthTimesMargin"],
  },

  // Class-specific intercepts (spec predicts no help; verify)
  {
    name: "current+classIntercepts",
    intercept: false,
    margin: { kind: "cappedGd", cap: 3 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: true,
    interactions: [],
  },

  // Ties-separate
  {
    name: "current+tiesSeparate",
    intercept: true,
    margin: { kind: "cappedGd", cap: 3 },
    strength: true,
    tiesSeparate: true,
    classIntercepts: false,
    interactions: [],
  },
];
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/eval/form-spec-v1.ts
git commit -m "Add v1 candidate form catalog (12 specs)"
```

---

## Task 5: Fit script — search the form space

**Files:**
- Create: `scripts/eval/fit-v1.ts`

For each form: extract a feature row per ranked Utah team, fit OLS, then predict on Utah AND Texas. Score both. Print summary table sorted by Texas MAE. Save the winning form's spec + coefficients to `scripts/eval/v1-model.json`.

- [ ] **Step 1: Write the fit script**

Create `scripts/eval/fit-v1.ts`:

```typescript
import { readFileSync, writeFileSync } from "fs";
import { solveOls } from "../../src/eval/ols";
import { extractFeatures, type FormSpec } from "../../src/eval/features-v1";
import { CANDIDATE_FORMS } from "../../src/eval/form-spec-v1";
import { score } from "../../src/eval/score";
import type { Snapshot, Score } from "../../src/eval/types";

interface FitResult {
  formName: string;
  spec: FormSpec;
  coefficients: number[];
  utah: { mae: number; maxErr: number; r2: number };
  texas: { mae: number; maxErr: number; r2: number };
}

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function buildDesignMatrix(snap: Snapshot, spec: FormSpec): { X: number[][]; y: number[]; slugs: string[] } {
  const slugs: string[] = [];
  const X: number[][] = [];
  const y: number[] = [];
  for (const [slug, official] of Object.entries(snap.officialRatings)) {
    const sched = snap.scheduleCache[slug];
    if (!sched) continue;
    const strength = snap.strengthMap[slug];
    if (strength === undefined) continue; // skip if no strength
    slugs.push(slug);
    X.push(extractFeatures(sched, spec, strength));
    y.push(official);
  }
  return { X, y, slugs };
}

function predictAll(snap: Snapshot, spec: FormSpec, beta: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [slug, sched] of Object.entries(snap.scheduleCache)) {
    const strength = snap.strengthMap[slug] ?? 0; // fall back to 0 for unranked teams
    const feats = extractFeatures(sched, spec, strength);
    let pred = 0;
    for (let i = 0; i < feats.length; i++) pred += beta[i] * feats[i];
    out[slug] = pred;
  }
  return out;
}

function pick(s: Score) {
  return { mae: s.mae, maxErr: s.maxErr, r2: s.r2 };
}

async function main() {
  const utah = loadSnapshot("scripts/eval/data/utah-2026.json");
  const texas = loadSnapshot("scripts/eval/data/texas-2026.json");

  const results: FitResult[] = [];

  for (const spec of CANDIDATE_FORMS) {
    const { X, y } = buildDesignMatrix(utah, spec);
    let beta: number[];
    try {
      beta = solveOls(X, y);
    } catch (e) {
      console.error(`SKIP ${spec.name}: ${(e as Error).message}`);
      continue;
    }
    const utahPreds = predictAll(utah, spec, beta);
    const texasPreds = predictAll(texas, spec, beta);
    const utahScore = score(utah, utahPreds);
    const texasScore = score(texas, texasPreds);
    results.push({
      formName: spec.name,
      spec,
      coefficients: beta,
      utah: pick(utahScore),
      texas: pick(texasScore),
    });
  }

  results.sort((a, b) => a.texas.mae - b.texas.mae);

  // Console summary
  console.log("\nForm                          | Utah MAE | Utah MaxErr | Texas MAE | Texas MaxErr | Texas R²");
  console.log("------------------------------|----------|-------------|-----------|--------------|---------");
  for (const r of results) {
    console.log(
      `${r.formName.padEnd(30)}| ${r.utah.mae.toFixed(4).padStart(8)} | ${r.utah.maxErr.toFixed(4).padStart(11)} | ${r.texas.mae.toFixed(4).padStart(9)} | ${r.texas.maxErr.toFixed(4).padStart(12)} | ${r.texas.r2.toFixed(4).padStart(7)}`
    );
  }

  const winner = results[0];
  console.log(`\nWinner: ${winner.formName}  (Texas MAE=${winner.texas.mae.toFixed(4)})`);

  writeFileSync(
    "scripts/eval/v1-model.json",
    JSON.stringify(
      {
        formName: winner.formName,
        spec: winner.spec,
        coefficients: winner.coefficients,
        utah: winner.utah,
        texas: winner.texas,
        allResults: results.map((r) => ({
          formName: r.formName,
          utah: r.utah,
          texas: r.texas,
        })),
      },
      null,
      2
    )
  );
  console.log("Wrote scripts/eval/v1-model.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json`, locate the `scripts` block and add `"fit:v1"`:

```json
"scripts": {
  "typecheck": "tsc",
  "deploy": "wrangler deploy",
  "dev": "wrangler dev",
  "test": "vitest run",
  "test:watch": "vitest",
  "fetch-snapshot": "tsx scripts/eval/fetch-snapshot.ts",
  "score": "tsx scripts/eval/score-cli.ts",
  "baseline": "tsx scripts/eval/baseline.ts",
  "fit:v1": "tsx scripts/eval/fit-v1.ts",
  "predict:v1": "tsx scripts/eval/predict-v1.ts"
}
```

- [ ] **Step 3: Run the fit**

```bash
npm run fit:v1
```

Expected output: a summary table showing 12 forms with Utah MAE, Texas MAE, etc., sorted by Texas MAE ascending. The winner row is identified at the bottom. `scripts/eval/v1-model.json` is written.

If the run prints `SKIP <form>: singular matrix`, that form has collinear features (e.g., both intercept and class intercepts redundantly). That's expected for some forms (e.g., the spec catalog should not produce singular matrices in practice; if it does, that's a bug to fix).

- [ ] **Step 4: Inspect results**

```bash
cat scripts/eval/v1-model.json | head -40
```

Expected: a JSON file with `formName`, `spec`, `coefficients`, `utah`, `texas`, `allResults`.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval/fit-v1.ts package.json scripts/eval/v1-model.json
git commit -m "Add fit-v1 search script; record winning form to v1-model.json

Searches 12 candidate forms (margin variants, interactions,
class intercepts, ties-separate). Picks the form with lowest
held-out Texas MAE. Logs all candidates' scores."
```

---

## Task 6: Predict script — apply the winning form

**Files:**
- Create: `scripts/eval/predict-v1.ts`

Loads `v1-model.json` and applies its spec + coefficients to a target snapshot. Output shape conforms to the predictions contract: `Record<string, number>`.

- [ ] **Step 1: Write the predict script**

Create `scripts/eval/predict-v1.ts`:

```typescript
import { readFileSync, writeFileSync } from "fs";
import { extractFeatures, type FormSpec } from "../../src/eval/features-v1";
import type { Snapshot } from "../../src/eval/types";

interface ModelFile {
  formName: string;
  spec: FormSpec;
  coefficients: number[];
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { snapshot: snapshotPath, out, model: modelPath } = args;
  if (!snapshotPath || !out) {
    console.error(
      "Usage: tsx scripts/eval/predict-v1.ts --snapshot <path> --out <path> [--model <path>]"
    );
    process.exit(1);
  }

  const model = JSON.parse(
    readFileSync(modelPath ?? "scripts/eval/v1-model.json", "utf8")
  ) as ModelFile;
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

  const predictions: Record<string, number> = {};
  for (const [slug, sched] of Object.entries(snapshot.scheduleCache)) {
    const strength = snapshot.strengthMap[slug] ?? 0;
    const feats = extractFeatures(sched, model.spec, strength);
    let pred = 0;
    for (let i = 0; i < feats.length; i++) pred += model.coefficients[i] * feats[i];
    predictions[slug] = pred;
  }

  writeFileSync(out, JSON.stringify(predictions, null, 2));
  console.log(
    `Wrote ${Object.keys(predictions).length} predictions to ${out} using model "${model.formName}"`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run predict on both snapshots**

```bash
npm run predict:v1 -- --snapshot scripts/eval/data/utah-2026.json --out /tmp/predictions-utah.json
npm run predict:v1 -- --snapshot scripts/eval/data/texas-2026.json --out /tmp/predictions-texas.json
```

Expected: each prints `Wrote N predictions to ... using model "<winner-name>"`.

- [ ] **Step 3: Score both predictions**

```bash
npm run score -- --snapshot scripts/eval/data/utah-2026.json --predictions /tmp/predictions-utah.json --out /tmp/score-utah.json
npm run score -- --snapshot scripts/eval/data/texas-2026.json --predictions /tmp/predictions-texas.json --out /tmp/score-texas.json
```

Expected: each prints `Scored N teams. MAE=..., RMSE=..., MaxErr=..., R²=...`. The numbers should match the `utah` / `texas` blocks inside `v1-model.json`.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval/predict-v1.ts
git commit -m "Add predict-v1 CLI matching the predictions contract"
```

---

## Task 7: Write RESULT.md

**Files:**
- Create: `RESULT.md` (in worktree root)

Captures all the search results, the winner, and notable failed experiments. This is the artifact that lets future-you compare worktrees A, B, C.

- [ ] **Step 1: Inspect the search results**

```bash
cat scripts/eval/v1-model.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
print('Winner:', data['formName'])
print('Coefficients:', data['coefficients'])
print()
print('All results (sorted by Texas MAE):')
for r in data['allResults']:
    print(f'  {r[\"formName\"]:30s} Utah MAE={r[\"utah\"][\"mae\"]:.4f} Texas MAE={r[\"texas\"][\"mae\"]:.4f}')
"
```

(If `python3` isn't available, just `cat scripts/eval/v1-model.json` and read the JSON.)

- [ ] **Step 2: Read the baseline for comparison**

```bash
head -20 scripts/eval/BASELINE.md
```

Expected: shows current OLS baseline (Utah MAE ≈ 0.93, Texas MAE ≈ 4.39).

- [ ] **Step 3: Write the report**

Create `RESULT.md` in the worktree root (replacing the `<...>` placeholders with values from the previous steps):

```markdown
# Refined OLS — Worktree A Result

**Approach:** Closed-form OLS rating = β · features. Searched 12 candidate
functional forms; selected the one with the lowest MAE on the Texas
held-out snapshot.

## Final formula

Form name: `<winner-name>`

Features (in order, with fitted coefficients):

<list each feature term and coefficient. e.g.>

- intercept: <β₀>
- (W − L): <β₁>
- strength: <β₂>
- gdCap (margin function): <β₃>
- ...

Model file: `scripts/eval/v1-model.json`

## Scores vs. baseline

| Metric | Baseline (current OLS) | This approach (v1) | Δ |
|--------|-----------------------:|-------------------:|--:|
| Utah-2026 MAE | 0.9293 | <utah-mae> | <±delta> |
| Utah-2026 MaxErr | 2.6675 | <utah-max> | |
| Texas-2026 MAE | 4.3937 | <texas-mae> | <±delta> |
| Texas-2026 MaxErr | 17.3553 | <texas-max> | |
| Texas-2026 R² | -0.6192 | <texas-r2> | |

**Acceptance bar (Texas MAE < 4.19):** <PASS / FAIL>.

## Search results — all 12 forms

| Form | Utah MAE | Texas MAE | Texas R² |
|------|---------:|----------:|---------:|
<one row per form, sorted by Texas MAE asc>

## Notable failures and observations

<2-4 bullets summarising what didn't work and why. Examples:>

- Class intercepts (`current+classIntercepts`) did not improve held-out
  performance, confirming the spec's prediction (MaxPreps treats every
  team uniformly).
- The Pythagorean margin variants (pyth1..pyth3) <improved/regressed>
  Texas MAE by <X> compared to the capped-GD baseline.
- ...

## How to reproduce

```bash
git checkout refined-ols
npm install
npm run fit:v1
npm run predict:v1 -- --snapshot scripts/eval/data/texas-2026.json --out /tmp/preds.json
npm run score -- --snapshot scripts/eval/data/texas-2026.json --predictions /tmp/preds.json --out /tmp/score.json
```
```

The angled-bracket placeholders should be filled in with actual numbers from the search output. If the report contains placeholders after writing, the task is incomplete.

- [ ] **Step 4: Verify no placeholders remain**

```bash
grep -nE '<[a-zA-Z-]+>' RESULT.md && echo "PLACEHOLDERS REMAIN — fix them" || echo "OK"
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add RESULT.md
git commit -m "Add Worktree A RESULT.md: refined OLS search outcome"
```

---

## Task 8: Final verification and PR

**Files:**
- (no new files; this is a verification task)

- [ ] **Step 1: Re-run all tests and typecheck**

```bash
npm run test && npm run typecheck
```

Expected: 21 tests pass; typecheck clean.

- [ ] **Step 2: Re-run fit and confirm `v1-model.json` matches RESULT.md**

```bash
npm run fit:v1
```

Expected: same winner and same coefficients as in `RESULT.md`. (If there's a mismatch, RESULT.md is stale — regenerate.)

- [ ] **Step 3: Verify branch state**

```bash
git rev-parse --abbrev-ref HEAD
git log main..HEAD --oneline
```

Expected: branch is `refined-ols`; ~7 commits ahead of main.

- [ ] **Step 4: Decide whether to PR**

If `RESULT.md` shows the acceptance bar passed (Texas MAE < 4.19), open a PR:

```bash
git push -u origin refined-ols
gh pr create --title "Worktree A: Refined OLS" --body "$(cat RESULT.md)"
```

If the acceptance bar failed, **do not open a PR**. Document the failure in `RESULT.md` (already done in Task 7), commit, and report back. The plan is complete either way — the experiment ran and produced a verdict.

- [ ] **Step 5: Report back**

Print a one-paragraph summary:

- Winning form name
- Texas MAE (and pass/fail vs. acceptance bar)
- Anything surprising in the search
- PR URL if opened
