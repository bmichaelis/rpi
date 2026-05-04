# MaxPreps Residual Reverse-Engineering (Worktree C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the current OLS as a baseline; analyse its residuals on the Utah training set; identify systematic patterns; iteratively add corrective terms until the held-out Texas MAE stops improving. Beat the baseline (Texas MAE=4.39) by at least 0.20.

**Architecture:** A separate worktree off `main`. The eval harness is unchanged. This plan is *more research than implementation* — the engineer runs a diagnostic tool, reads its output, forms hypotheses, and iterates. The deliverable is the best discovered formula plus a `RESULT.md` describing the search.

**Tech Stack:** TypeScript + tsx (existing). Reuses the OLS solver pattern from Worktree A. No ML libraries.

**Spec:** `docs/superpowers/specs/2026-04-29-maxpreps-rating-reproduction-design.md` § "Approach 3 — Residual reverse-engineering"

**Prerequisites:**
- The eval harness (Plan 1) must be merged to `main`.
- `scripts/eval/data/utah-2026.json` and `scripts/eval/data/texas-2026.json` must exist on `main`.

**Out of scope:**
- Plan 2: Refined OLS (worktree A)
- Plan 3: Massey iteration (worktree B)
- Plan 5: Compare results, merge winner

**Timebox:** 1 day of work. If after Tasks 5–7's iterative loop has run for 8 hours of iteration time, ship the best-found model whether or not it clears the bar, document remaining patterns in RESULT.md, and stop.

---

## Methodology note (read first)

The other two approaches search a **fixed grid** of configurations. This approach is **adaptive**: each iteration's findings inform the next iteration. That makes it easier to overfit to the held-out test set, because the engineer can keep adding terms until Texas MAE drops.

**To mitigate this:**
1. Form hypotheses from *Utah residuals only*. Texas held-out is consulted only at the end of each iteration to decide whether to keep the change.
2. Stop iterating when Utah residuals look like noise OR Texas MAE has not improved by ≥ 0.05 in two consecutive iterations.
3. Cap iteration count at **5** total. If you have not converged in 5 iterations, the methodology is failing and the final model should be the best from those 5.
4. Document every hypothesis tested and its outcome — including failures — in `RESULT.md`. Negative results matter for comparing approaches.

---

## File Structure

| File | Purpose |
|------|---------|
| `src/eval/ols.ts` (new — same as Worktree A) | Gaussian-elimination OLS solver |
| `src/eval/ols.test.ts` (new — same as Worktree A) | OLS tests |
| `src/eval/baseline-formula.ts` (new) | Re-implements current OLS predictions as a function (so we can compute residuals against it) |
| `src/eval/diagnostics.ts` (new) | Per-team residuals + correlation analyses + summary report |
| `src/eval/diagnostics.test.ts` (new) | Tests for the diagnostic helpers |
| `src/eval/features-v3.ts` (new) | Feature extractor that grows iteratively (starts as a copy of features-v1 from spec) |
| `scripts/eval/diagnose-v3.ts` (new) | CLI: prints residual analysis for the current model (baseline OR a custom form) |
| `scripts/eval/fit-v3.ts` (new) | Fits a chosen form on Utah, scores on both snapshots, writes `v3-model.json` |
| `scripts/eval/predict-v3.ts` (new) | Loads `v3-model.json`, predicts for any snapshot |
| `scripts/eval/v3-model.json` (new, generated) | Final winning form + coefficients |
| `RESULT.md` (new) | Iteration log + final scores |
| `package.json` | Add `diagnose:v3`, `fit:v3`, `predict:v3` scripts |

---

## Task 1: Set up worktree C

**Files:**
- Create: `.worktrees/residual/` (via `git worktree add`)

- [ ] **Step 1: Pre-conditions on main**

```bash
cd /Users/brett/brett-dev/rpi
git checkout main
git pull --ff-only
ls scripts/eval/data/utah-2026.json scripts/eval/data/texas-2026.json scripts/eval/BASELINE.md
```

- [ ] **Step 2: Create worktree**

```bash
git worktree add .worktrees/residual -b residual
cd .worktrees/residual
```

- [ ] **Step 3: Copy local settings**

```bash
mkdir -p .claude
cp ../../.claude/settings.local.json .claude/settings.local.json
```

- [ ] **Step 4: Install + verify**

```bash
npm install
npm run test
npm run typecheck
npm run baseline
```

Expected: 8/8 tests, typecheck clean, baseline shows Utah MAE≈0.93 / Texas MAE≈4.39.

- [ ] **Step 5: Confirm branch**

```bash
git rev-parse --abbrev-ref HEAD
```

Expected: `residual`.

---

## Task 2: OLS solver (same as Worktree A)

**Files:**
- Create: `src/eval/ols.ts`
- Create: `src/eval/ols.test.ts`

Same code as Worktree A — see `docs/superpowers/plans/2026-05-04-maxpreps-refined-ols.md` Task 2 for verbatim contents.

- [ ] **Step 1: Copy tests verbatim from Worktree A's plan**
- [ ] **Step 2: Run tests, verify failure**

```bash
npm run test
```

- [ ] **Step 3: Copy implementation verbatim from Worktree A's plan**
- [ ] **Step 4: Run tests**

```bash
npm run test
```

Expected: 5 OLS + 8 scorer = 13 passing.

- [ ] **Step 5: Commit**

```bash
git add src/eval/ols.ts src/eval/ols.test.ts
git commit -m "Add OLS solver with Gaussian elimination + tests"
```

---

## Task 3: Baseline formula module

**Files:**
- Create: `src/eval/baseline-formula.ts`

A small module that exposes the current production formula as a pure function — so the diagnostic tool can compute predictions and residuals without re-fitting. The current formula is:

```
rating = 0.8809*(W − L) + 0.9183*strength + 1.6813*gdCap + 0.0552
```

with `gdCap` = mean per-game GD capped at ±3.

- [ ] **Step 1: Implement baseline**

Create `src/eval/baseline-formula.ts`:

```typescript
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
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/eval/baseline-formula.ts
git commit -m "Add baseline-formula module exposing current production OLS"
```

---

## Task 4: Diagnostic infrastructure with TDD

**Files:**
- Create: `src/eval/diagnostics.ts`
- Create: `src/eval/diagnostics.test.ts`

Computes per-team residuals against ANY prediction function, then correlates them with team-level features (n_games, # losses to top-rated, strength magnitude, margin variance, ...). The output is a structured report we render in `diagnose-v3.ts`.

- [ ] **Step 1: Write failing tests**

Create `src/eval/diagnostics.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm run test
```

- [ ] **Step 3: Implement diagnostics.ts**

Create `src/eval/diagnostics.ts`:

```typescript
import type { TeamSchedule } from "../types";

export interface Residual {
  slug: string;
  predicted: number;
  official: number;
  residual: number;
}

export function computeResiduals(
  predictions: Record<string, number>,
  official: Record<string, number>
): Residual[] {
  const out: Residual[] = [];
  for (const [slug, p] of Object.entries(predictions)) {
    const o = official[slug];
    if (o === undefined) continue;
    out.push({ slug, predicted: p, official: o, residual: p - o });
  }
  return out;
}

/** Pearson correlation coefficient. Returns 0 for fewer than 2 points or zero variance. */
export function correlate(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

export interface TeamMetrics {
  nGames: number;
  W: number;
  L: number;
  T: number;
  gdMean: number;
  gdVar: number;       // sample variance of per-game GD
  gdMax: number;
  gdMin: number;
  strength: number;
  classLabel: string;  // "4A" / "5A" / "6A" / "OOS"
}

export function perTeamMetrics(schedule: TeamSchedule, strength: number): TeamMetrics {
  const played = schedule.games.filter(
    (g) => g.goalsScored !== null && g.goalsAllowed !== null
  );
  let W = 0, L = 0, T = 0;
  const gds: number[] = [];
  for (const g of played) {
    if (g.won === true) W++;
    else if (g.won === false) L++;
    else T++;
    gds.push((g.goalsScored ?? 0) - (g.goalsAllowed ?? 0));
  }
  const n = gds.length;
  const gdMean = n > 0 ? gds.reduce((a, b) => a + b, 0) / n : 0;
  let gdVar = 0;
  if (n > 1) {
    let sq = 0;
    for (const v of gds) sq += (v - gdMean) ** 2;
    gdVar = sq / (n - 1);
  }
  const gdMax = n > 0 ? Math.max(...gds) : 0;
  const gdMin = n > 0 ? Math.min(...gds) : 0;
  const cls = schedule.classification;
  const classLabel = cls === "oos" ? "OOS" : `${cls}A`;
  return { nGames: n, W, L, T, gdMean, gdVar, gdMax, gdMin, strength, classLabel };
}
```

- [ ] **Step 4: Run tests to verify success**

```bash
npm run test
```

Expected: 7 diagnostic tests pass + 5 OLS + 8 scorer = 20 total.

- [ ] **Step 5: Commit**

```bash
git add src/eval/diagnostics.ts src/eval/diagnostics.test.ts
git commit -m "Add diagnostic helpers (residuals, Pearson correlation, per-team metrics)"
```

---

## Task 5: diagnose-v3 CLI — first iteration

**Files:**
- Create: `scripts/eval/diagnose-v3.ts`

Print a residual analysis for the baseline OLS on Utah training. Use it to form the *first* set of hypotheses.

- [ ] **Step 1: Write the diagnostic CLI**

Create `scripts/eval/diagnose-v3.ts`:

```typescript
import { readFileSync } from "fs";
import { predictBaseline } from "../../src/eval/baseline-formula";
import { computeResiduals, correlate, perTeamMetrics } from "../../src/eval/diagnostics";
import type { Snapshot } from "../../src/eval/types";

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function main() {
  const utah = loadSnapshot("scripts/eval/data/utah-2026.json");

  // Baseline predictions for ranked teams only
  const predictions: Record<string, number> = {};
  for (const slug of Object.keys(utah.officialRatings)) {
    const sched = utah.scheduleCache[slug];
    if (!sched) continue;
    const strength = utah.strengthMap[slug] ?? 0;
    predictions[slug] = predictBaseline(sched, strength);
  }
  const residuals = computeResiduals(predictions, utah.officialRatings);

  console.log(`Utah residuals (baseline OLS): n=${residuals.length}`);
  console.log(`Mean residual: ${(residuals.reduce((s, r) => s + r.residual, 0) / residuals.length).toFixed(4)}`);
  console.log(`Mean |residual|: ${(residuals.reduce((s, r) => s + Math.abs(r.residual), 0) / residuals.length).toFixed(4)}`);

  // Per-team metrics
  const metricsBySlug = new Map<string, ReturnType<typeof perTeamMetrics>>();
  for (const r of residuals) {
    const sched = utah.scheduleCache[r.slug];
    if (!sched) continue;
    metricsBySlug.set(r.slug, perTeamMetrics(sched, utah.strengthMap[r.slug] ?? 0));
  }

  // Correlate residual with each metric
  const features: Array<{ name: string; getter: (m: ReturnType<typeof perTeamMetrics>) => number }> = [
    { name: "nGames", getter: (m) => m.nGames },
    { name: "W − L", getter: (m) => m.W - m.L },
    { name: "T (ties)", getter: (m) => m.T },
    { name: "gdMean", getter: (m) => m.gdMean },
    { name: "|gdMean|", getter: (m) => Math.abs(m.gdMean) },
    { name: "gdVar", getter: (m) => m.gdVar },
    { name: "gdMax", getter: (m) => m.gdMax },
    { name: "gdMin (most-negative game)", getter: (m) => m.gdMin },
    { name: "strength", getter: (m) => m.strength },
    { name: "|strength|", getter: (m) => Math.abs(m.strength) },
    { name: "strength × (W − L)", getter: (m) => m.strength * (m.W - m.L) },
    { name: "strength × gdMean", getter: (m) => m.strength * m.gdMean },
    { name: "log(1+W)", getter: (m) => Math.log(1 + m.W) },
    { name: "L²", getter: (m) => m.L * m.L },
  ];

  console.log("\nCorrelation of residual with team-level features:");
  console.log("Feature                         | Pearson r");
  console.log("--------------------------------|----------");
  const correlations: Array<{ name: string; r: number }> = [];
  for (const f of features) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const res of residuals) {
      const m = metricsBySlug.get(res.slug);
      if (!m) continue;
      xs.push(f.getter(m));
      ys.push(res.residual);
    }
    const r = correlate(xs, ys);
    correlations.push({ name: f.name, r });
  }
  correlations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  for (const c of correlations) {
    console.log(`${c.name.padEnd(32)}| ${c.r.toFixed(4).padStart(8)}`);
  }

  // Residuals binned by class
  console.log("\nResiduals by class:");
  const byClass = new Map<string, number[]>();
  for (const r of residuals) {
    const cls = metricsBySlug.get(r.slug)?.classLabel ?? "?";
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push(r.residual);
  }
  for (const [cls, arr] of [...byClass].sort()) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const meanAbs = arr.reduce((a, b) => a + Math.abs(b), 0) / arr.length;
    console.log(`${cls}: n=${arr.length}, mean=${mean.toFixed(4)}, mean |residual|=${meanAbs.toFixed(4)}`);
  }

  // Top 10 worst residuals
  console.log("\nTop 10 worst |residuals|:");
  const top = [...residuals].sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)).slice(0, 10);
  for (const r of top) {
    const m = metricsBySlug.get(r.slug);
    console.log(
      `  ${r.slug.padEnd(40)} pred=${r.predicted.toFixed(2).padStart(7)} off=${r.official.toFixed(2).padStart(7)} res=${r.residual.toFixed(2).padStart(7)}` +
        `  [${m?.classLabel ?? "?"} W=${m?.W} L=${m?.L} T=${m?.T} n=${m?.nGames} gd=${m?.gdMean.toFixed(2)}]`
    );
  }
}

main();
```

- [ ] **Step 2: Add npm script**

In `package.json`, add to `scripts`:

```json
"diagnose:v3": "tsx scripts/eval/diagnose-v3.ts",
"fit:v3": "tsx scripts/eval/fit-v3.ts",
"predict:v3": "tsx scripts/eval/predict-v3.ts"
```

- [ ] **Step 3: Run the diagnostic**

```bash
npm run diagnose:v3
```

Expected: a printed report with residual statistics, sorted feature-correlations, by-class breakdown, and top-10 worst.

- [ ] **Step 4: Read the output and form 2-3 hypotheses**

Look at the printed correlations. The feature with the strongest |Pearson r| is the most promising starting point. Common patterns to look for:

- Strong correlation with `nGames` → the W−L coefficient is sensitive to season length (likely, given the Texas baseline result).
- Strong correlation with `gdVar` → margin treatment should not be just the mean — variance carries information.
- Strong correlation with `strength × (W−L)` → there's a missing interaction term.
- Bimodal residual distribution by class → class-specific intercepts may help (the spec predicts otherwise; verify).
- Worst residuals concentrated in teams with very few losses to elite opponents → "Farmington effect"; non-linear penalty for elite losses.

Write your top 2–3 hypotheses in a temporary file `iterations.md` (worktree root) — this becomes the iteration log:

```bash
cat > iterations.md <<'EOF'
# Residual analysis — iteration log

## Iteration 0 (baseline)
- Utah MAE: 0.93
- Texas MAE: 4.39
- Strongest residual correlations:
  1. <feature>: r = <value>
  2. <feature>: r = <value>
  3. <feature>: r = <value>

## Hypothesis A
- ...
- Add term: ...
- Predicted impact on Utah MAE: ...

## Hypothesis B
- ...

## Hypothesis C
- ...
EOF
```

Fill in the actual values from the diagnostic output.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval/diagnose-v3.ts package.json iterations.md
git commit -m "Add diagnose-v3 + initial iteration log

Diagnostic output prints residual correlations against team-level
features so we can form data-driven hypotheses about what's missing
from the baseline OLS."
```

---

## Task 6: features-v3 + fit-v3 (iterative refinement)

**Files:**
- Create: `src/eval/features-v3.ts`
- Create: `scripts/eval/fit-v3.ts`

The `features-v3.ts` module starts as a feature-extractor with the SAME features as the baseline (intercept, W−L, strength, gdCap), then grows iteratively as we test hypotheses. `fit-v3.ts` fits OLS on Utah training and scores on both snapshots; rerun it after each feature change.

- [ ] **Step 1: Implement features-v3 (initial copy of baseline structure)**

Create `src/eval/features-v3.ts`:

```typescript
import type { TeamSchedule, Game } from "../types";

/**
 * Iteratively-grown feature extractor for Worktree C.
 *
 * Start: same feature set as the production baseline (intercept, W−L, strength, gdCap).
 * Each iteration's hypothesis test adds (or removes) a feature here, then re-runs fit-v3.
 *
 * The order of features in the returned array is significant — it matches the
 * coefficient order produced by `solveOls`. Update `FEATURE_NAMES` whenever you
 * change the feature list.
 */
export const FEATURE_NAMES = ["intercept", "W − L", "strength", "gdCap"];

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
  const gdCap = played.length > 0 ? gdSum / played.length : 0;
  return [1, W - L, strength, gdCap];
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
```

- [ ] **Step 2: Implement fit-v3**

Create `scripts/eval/fit-v3.ts`:

```typescript
import { readFileSync, writeFileSync } from "fs";
import { solveOls } from "../../src/eval/ols";
import { extractFeaturesV3, FEATURE_NAMES } from "../../src/eval/features-v3";
import { score } from "../../src/eval/score";
import type { Snapshot } from "../../src/eval/types";

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function buildXY(snap: Snapshot): { X: number[][]; y: number[] } {
  const X: number[][] = [];
  const y: number[] = [];
  for (const [slug, official] of Object.entries(snap.officialRatings)) {
    const sched = snap.scheduleCache[slug];
    if (!sched) continue;
    const strength = snap.strengthMap[slug];
    if (strength === undefined) continue;
    X.push(extractFeaturesV3(sched, strength));
    y.push(official);
  }
  return { X, y };
}

function predict(snap: Snapshot, beta: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [slug, sched] of Object.entries(snap.scheduleCache)) {
    const strength = snap.strengthMap[slug] ?? 0;
    const feats = extractFeaturesV3(sched, strength);
    let p = 0;
    for (let i = 0; i < feats.length; i++) p += beta[i] * feats[i];
    out[slug] = p;
  }
  return out;
}

async function main() {
  const utah = loadSnapshot("scripts/eval/data/utah-2026.json");
  const texas = loadSnapshot("scripts/eval/data/texas-2026.json");

  const { X, y } = buildXY(utah);
  const beta = solveOls(X, y);

  const utahPreds = predict(utah, beta);
  const texasPreds = predict(texas, beta);

  const utahScore = score(utah, utahPreds);
  const texasScore = score(texas, texasPreds);

  console.log("Features:", FEATURE_NAMES);
  console.log("Coefficients:", beta.map((b) => b.toFixed(4)));
  console.log(`Utah-2026:  MAE=${utahScore.mae.toFixed(4)}, MaxErr=${utahScore.maxErr.toFixed(4)}`);
  console.log(`Texas-2026: MAE=${texasScore.mae.toFixed(4)}, MaxErr=${texasScore.maxErr.toFixed(4)}, R²=${texasScore.r2.toFixed(4)}`);

  writeFileSync(
    "scripts/eval/v3-model.json",
    JSON.stringify(
      {
        featureNames: FEATURE_NAMES,
        coefficients: beta,
        utah: { mae: utahScore.mae, maxErr: utahScore.maxErr, r2: utahScore.r2 },
        texas: { mae: texasScore.mae, maxErr: texasScore.maxErr, r2: texasScore.r2 },
      },
      null,
      2
    )
  );
  console.log("Wrote scripts/eval/v3-model.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Run fit-v3 (initial — same features as baseline)**

```bash
npm run fit:v3
```

Expected: Utah MAE close to baseline (~0.93). Texas MAE close to baseline (~4.39). The numbers will differ slightly because the solver re-fits coefficients on the snapshot, but they should be within 0.05.

Append to `iterations.md`:

```markdown
## Iteration 0 — re-fit with same features
- Utah MAE: <X>, Texas MAE: <Y>
- Coefficients: <list>
```

- [ ] **Step 4: Commit baseline state**

```bash
git add src/eval/features-v3.ts scripts/eval/fit-v3.ts scripts/eval/v3-model.json iterations.md
git commit -m "Add features-v3 (baseline copy) + fit-v3; iteration 0 = baseline reproduction"
```

---

## Task 7: Iterative hypothesis testing

**This task is the heart of the approach.** Iterate up to 5 times. Each iteration:

1. Pick the strongest correlation from the most recent diagnose output.
2. Modify `src/eval/features-v3.ts` to add (or remove) the corresponding feature.
3. Update `FEATURE_NAMES` to match.
4. Run `npm run fit:v3`. Record Utah and Texas MAE in `iterations.md`.
5. Run `npm run diagnose:v3` (using the *new* model — see step 7 below for how). Look at the new residual correlations.
6. **Decision:**
   - If Texas MAE improved by ≥ 0.05 vs the previous iteration, *keep* the feature.
   - If Texas MAE worsened, *revert* the feature.
   - If Texas MAE was within ±0.05 (no clear signal), *revert* (YAGNI).
7. **Stop** when:
   - 5 iterations completed.
   - OR two consecutive iterations failed to improve Texas MAE.
   - OR Utah residuals look like noise (no |r| > 0.20 against any feature).

Each iteration gets ONE git commit (regardless of keep/revert). Commit message format: `Iteration N: <hypothesis description> — kept | reverted`.

**Important:** `diagnose:v3` currently always uses the baseline OLS. Before iteration 2, you'll want to extend it to use the *current* `v3-model.json` if one exists, so that residuals are computed against the current model. Modify `scripts/eval/diagnose-v3.ts` to:

1. If `scripts/eval/v3-model.json` exists, load it and predict using `extractFeaturesV3` + the model coefficients.
2. Otherwise, fall back to baseline.

This is a self-modifying step — don't be afraid to edit `diagnose-v3.ts` once you start iterating.

### Iteration 1 example

Suppose iteration 0's diagnose showed strongest correlation: `nGames` with r=−0.45.

- [ ] **Step 1.1: Form hypothesis**

> The W−L coefficient is too aggressive for long seasons. Add `(W−L) / nGames` (normalised win-loss) as an extra feature. The negative correlation suggests we over-credit each marginal win in a long season.

Update `iterations.md`:

```markdown
## Iteration 1 — hypothesis: normalise (W−L) by season length
- Strongest residual correlation in iteration 0: nGames, r=−0.45
- Add feature: (W − L) / nGames
- Predicted impact: smaller MAE on Texas (longer seasons)
```

- [ ] **Step 1.2: Modify features-v3**

Edit `src/eval/features-v3.ts`:

```typescript
export const FEATURE_NAMES = ["intercept", "W − L", "strength", "gdCap", "(W−L)/nGames"];

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
  return [1, W - L, strength, gdCap, wlNorm];
}
```

- [ ] **Step 1.3: Refit and score**

```bash
npm run fit:v3
```

Record results in `iterations.md`:

```markdown
- Iteration 1 results: Utah MAE = <X>, Texas MAE = <Y>
- Δ vs iteration 0: Utah <±>, Texas <±>
- Decision: <KEEP / REVERT> because <reason>
```

If KEPT: leave the file as-is. If REVERTED: edit `features-v3.ts` back to the previous state and re-run `fit:v3` to confirm.

- [ ] **Step 1.4: Run diagnose:v3** (after extending it to read v3-model.json — see Step 7 above)

Use the new residuals to choose iteration 2's hypothesis.

- [ ] **Step 1.5: Commit**

```bash
git add -A
git commit -m "Iteration 1: normalise (W−L) by nGames — <kept | reverted>"
```

### Iterations 2–5

Repeat the same five-step pattern (form hypothesis → modify features → refit → diagnose → commit). Document each in `iterations.md`. Stop when the stopping criteria fire.

- [ ] **Track progress through iterations 2, 3, 4, 5 (or stop earlier)**

After each iteration, your `iterations.md` should grow with one new section per iteration. Your final `v3-model.json` should reflect the best feature set found.

---

## Task 8: predict-v3

**Files:**
- Create: `scripts/eval/predict-v3.ts`

Loads `v3-model.json` + a snapshot, applies the model.

- [ ] **Step 1: Write the predict script**

Create `scripts/eval/predict-v3.ts`:

```typescript
import { readFileSync, writeFileSync } from "fs";
import { extractFeaturesV3 } from "../../src/eval/features-v3";
import type { Snapshot } from "../../src/eval/types";

interface ModelFile {
  featureNames: string[];
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
    console.error("Usage: tsx scripts/eval/predict-v3.ts --snapshot <path> --out <path> [--model <path>]");
    process.exit(1);
  }
  const model = JSON.parse(
    readFileSync(modelPath ?? "scripts/eval/v3-model.json", "utf8")
  ) as ModelFile;
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

  const predictions: Record<string, number> = {};
  for (const [slug, sched] of Object.entries(snapshot.scheduleCache)) {
    const strength = snapshot.strengthMap[slug] ?? 0;
    const feats = extractFeaturesV3(sched, strength);
    if (feats.length !== model.coefficients.length) {
      throw new Error(
        `Feature count mismatch: model has ${model.coefficients.length}, extractor produces ${feats.length}. ` +
          `Re-run fit:v3 to regenerate the model.`
      );
    }
    let p = 0;
    for (let i = 0; i < feats.length; i++) p += model.coefficients[i] * feats[i];
    predictions[slug] = p;
  }

  writeFileSync(out, JSON.stringify(predictions, null, 2));
  console.log(`Wrote ${Object.keys(predictions).length} predictions to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it runs**

```bash
npm run predict:v3 -- --snapshot scripts/eval/data/texas-2026.json --out /tmp/v3.json
npm run score -- --snapshot scripts/eval/data/texas-2026.json --predictions /tmp/v3.json --out /tmp/v3-score.json
```

Expected: predictions match the `texas` block in `v3-model.json`.

- [ ] **Step 3: Commit**

```bash
git add scripts/eval/predict-v3.ts
git commit -m "Add predict-v3 CLI for the iteratively-discovered formula"
```

---

## Task 9: Write RESULT.md

**Files:**
- Create: `RESULT.md` (worktree root)

Distil `iterations.md` into a clean comparison report.

- [ ] **Step 1: Write RESULT.md** (replace `<...>` placeholders):

```markdown
# Residual Reverse-Engineering — Worktree C Result

**Approach:** Use the production OLS as a starting point. Compute residuals on
Utah training, identify systematic patterns via correlation analysis, and
iteratively add corrective terms. Stop when held-out Texas MAE plateaus or
after 5 iterations.

## Final feature set

```
<paste FEATURE_NAMES from final features-v3.ts>
```

Coefficients (from `scripts/eval/v3-model.json`):

| Feature | Coefficient |
|---------|------------:|
<one row per feature>

## Scores vs. baseline

| Metric | Baseline (current OLS) | This approach (v3) | Δ |
|--------|-----------------------:|-------------------:|--:|
| Utah-2026 MAE | 0.9293 | <utah-mae> | <±delta> |
| Utah-2026 MaxErr | 2.6675 | <utah-max> | |
| Texas-2026 MAE | 4.3937 | <texas-mae> | <±delta> |
| Texas-2026 MaxErr | 17.3553 | <texas-max> | |
| Texas-2026 R² | -0.6192 | <texas-r2> | |

**Acceptance bar (Texas MAE < 4.19):** <PASS / FAIL>.

## Iteration log

(Distilled from `iterations.md` — see that file for full details.)

| # | Hypothesis | Δ Texas MAE | Decision |
|---|-----------|------------:|----------|
| 1 | <one-line hypothesis> | <±X> | KEPT / REVERTED |
| 2 | ... | | |
| 3 | ... | | |
| ... | | | |

## What worked

<2–3 bullets describing the features that improved held-out performance.>

## What didn't work

<2–4 bullets on hypotheses that failed and what we learned. Negative results matter.>

## Methodology limitations

- Used Texas held-out for iteration decisions. With ≤ 5 iterations this is mild
  inflation, but a true validation split would be cleaner.
- Stopping was driven by held-out plateau — a more principled stopping criterion
  (e.g., AIC / cross-validation) was out of scope.

## How to reproduce

```bash
git checkout residual
npm install
npm run fit:v3
npm run predict:v3 -- --snapshot scripts/eval/data/texas-2026.json --out /tmp/preds.json
npm run score -- --snapshot scripts/eval/data/texas-2026.json --predictions /tmp/preds.json --out /tmp/score.json
```
```

- [ ] **Step 2: Verify no placeholders remain**

```bash
grep -nE '<[a-zA-Z-]+>' RESULT.md && echo "PLACEHOLDERS REMAIN — fix them" || echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add RESULT.md
git commit -m "Add Worktree C RESULT.md: residual reverse-engineering outcome"
```

---

## Task 10: Final verification and PR

- [ ] **Step 1: Tests + typecheck**

```bash
npm run test && npm run typecheck
```

- [ ] **Step 2: Re-run fit:v3 — confirm `v3-model.json` matches RESULT.md**

```bash
npm run fit:v3
```

- [ ] **Step 3: Branch state**

```bash
git rev-parse --abbrev-ref HEAD
git log main..HEAD --oneline
```

Expected: branch `residual`; ~10–14 commits ahead of main (more than other worktrees due to per-iteration commits).

- [ ] **Step 4: PR if acceptance bar passed**

```bash
git push -u origin residual
gh pr create --title "Worktree C: Residual reverse-engineering" --body "$(cat RESULT.md)"
```

- [ ] **Step 5: Report back**

Report:

- Final feature set
- Number of iterations completed
- Texas MAE + pass/fail vs acceptance bar
- Most-impactful iteration (which hypothesis moved the needle most)
- PR URL if opened
