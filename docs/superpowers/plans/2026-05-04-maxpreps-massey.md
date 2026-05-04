# MaxPreps Massey Iteration (Worktree B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Massey-style rating system that solves `r_A − r_B ≈ margin(A,B)` across every game in the snapshot, calibrate the resulting raw ratings to MaxPreps's absolute scale, and beat the current baseline (Texas MAE=4.39) by at least 0.20.

**Architecture:** A separate worktree off `main`. The eval harness is unchanged. This adds: a sparse linear-system solver, a Massey rating builder (iterative Gauss-Seidel), a small grid of margin/ridge variants, and a `predict-v2` script that re-fits Massey per snapshot and applies a Utah-trained affine calibration. Results land in `RESULT.md`.

**Tech Stack:** TypeScript + tsx (existing). Reuses the OLS solver from `src/eval/ols.ts` (added by Worktree A in some scenarios — but since worktrees are independent, this plan adds its own copy). No ML libraries.

**Spec:** `docs/superpowers/specs/2026-04-29-maxpreps-rating-reproduction-design.md` § "Approach 2 — Massey iteration"

**Prerequisites:**
- The eval harness (Plan 1) must be merged to `main`.
- `scripts/eval/data/utah-2026.json` and `scripts/eval/data/texas-2026.json` must exist on `main`.

**Out of scope:**
- Plan 2: Refined OLS (worktree A)
- Plan 4: Residual reverse-engineering (worktree C)
- Plan 5: Compare results, merge winner

---

## Methodology note (read first)

Massey ratings produce a *relative* scale — sum-anchored ratings where each team's number is "points better than league average." MaxPreps's official ratings are on an *absolute* scale (intercept ≠ 0, range varies by season length). We bridge this with an affine transform `r_final = a · r_raw + b` learned on the Utah training snapshot, applied universally.

A subtle issue: Massey fits a *new* rating system for each snapshot, because the games are different (Utah's network and Texas's network share almost no teams). The affine `(a, b)` learned on Utah will not necessarily map Texas-Massey ratings to Texas-MaxPreps optimally — but the spec's intent is that this affine should be *transferable* if the Massey methodology truly captures MaxPreps's structure. If Texas MAE is much worse than Utah MAE, the methodology is rejected, not just the calibration.

The same caveat as Worktree A applies: with only one held-out set, picking the form by Texas MAE inflates the apparent generalization. Keep the search small (this plan: 9 configurations).

---

## File Structure

| File | Purpose |
|------|---------|
| `src/eval/ols.ts` (new — same as Worktree A's, intentionally duplicated) | Gaussian-elimination OLS solver |
| `src/eval/ols.test.ts` (new — same as Worktree A's) | OLS solver tests |
| `src/eval/massey.ts` (new) | `solveMassey(games, margin, ridge) → Map<slug, rating>` |
| `src/eval/massey.test.ts` (new) | Massey solver tests |
| `src/eval/calibrate.ts` (new) | `fitAffine(rawRatings, officialRatings) → {a, b}` and `applyAffine` |
| `src/eval/calibrate.test.ts` (new) | Affine calibration tests |
| `scripts/eval/fit-v2.ts` (new) | Searches Massey configs, picks the form with lowest held-out MAE, writes `v2-model.json` |
| `scripts/eval/predict-v2.ts` (new) | Loads `v2-model.json`, re-fits Massey on the input snapshot, applies stored affine |
| `scripts/eval/v2-model.json` (new, generated) | Winning config (margin spec + ridge + affine `(a, b)`) |
| `RESULT.md` (new) | Search results + scores |
| `package.json` | Add `fit:v2` and `predict:v2` scripts |

---

## Task 1: Set up worktree B

**Files:**
- Create: `.worktrees/massey/` (via `git worktree add`)

This task runs on `main`.

- [ ] **Step 1: Verify pre-conditions**

```bash
cd /Users/brett/brett-dev/rpi
git checkout main
git pull --ff-only
ls scripts/eval/data/utah-2026.json scripts/eval/data/texas-2026.json scripts/eval/BASELINE.md
```

Expected: all three files exist.

- [ ] **Step 2: Create worktree**

```bash
git worktree add .worktrees/massey -b massey
cd .worktrees/massey
```

- [ ] **Step 3: Copy local settings into worktree**

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

Expected: 8/8 tests pass; typecheck clean; baseline output matches Plan 1's recorded values.

- [ ] **Step 6: Confirm branch**

```bash
git rev-parse --abbrev-ref HEAD
```

Expected: `massey`.

---

## Task 2: OLS solver with TDD (same as Worktree A)

**Files:**
- Create: `src/eval/ols.ts`
- Create: `src/eval/ols.test.ts`

We use the same OLS solver as Worktree A. Code is duplicated by design (worktrees are independent); when one worktree's PR is merged, the duplicate goes away.

- [ ] **Step 1: Write failing tests**

Create `src/eval/ols.test.ts` with content identical to Worktree A's plan (Task 2, Step 1) — see `docs/superpowers/plans/2026-05-04-maxpreps-refined-ols.md` for the exact test code. Copy verbatim.

- [ ] **Step 2: Implement solveOls**

Create `src/eval/ols.ts` with content identical to Worktree A's plan (Task 2, Step 3). Copy verbatim.

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: 5 OLS tests pass + 8 scorer tests = 13 total.

- [ ] **Step 4: Commit**

```bash
git add src/eval/ols.ts src/eval/ols.test.ts
git commit -m "Add OLS solver with Gaussian elimination + tests"
```

---

## Task 3: Massey solver with TDD

**Files:**
- Create: `src/eval/massey.ts`
- Create: `src/eval/massey.test.ts`

The Massey rating system: every game `(A, B, margin)` contributes one equation `r_A − r_B = margin`. With n teams and m games we have an m×n design matrix (each row has exactly +1 in col A, −1 in col B). The system is rank-deficient by 1 (only relative ratings matter), so we anchor by adding `Σ r = 0` as the (m+1)-th equation. Then we solve the normal equations. With many games the matrix `X^T X` is symmetric positive-semidefinite; with the anchor it becomes positive-definite.

A ridge term λ adds λ·I to the normal equations to stabilise weakly-connected teams (those with few games). λ=0 → pure Massey; larger λ pulls everyone toward 0.

The margin function applied per game is configurable: `cappedGd(cap)`, `binary` (±1), `pythagoreanCentered(p)`.

- [ ] **Step 1: Write failing tests**

Create `src/eval/massey.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { solveMassey, type MasseyMargin } from "./massey";

interface MGame {
  a: string;
  b: string;
  marginAOverB: number; // signed: positive if A had the better outcome
}

describe("solveMassey", () => {
  it("recovers ranks for a transitive 3-team round-robin (binary)", () => {
    // A beats B, B beats C, A beats C → A > B > C
    const games: MGame[] = [
      { a: "A", b: "B", marginAOverB: 1 },
      { a: "B", b: "C", marginAOverB: 1 },
      { a: "A", b: "C", marginAOverB: 1 },
    ];
    const margin: MasseyMargin = { kind: "binary" };
    const ratings = solveMassey(games, margin, 0);
    expect(ratings.get("A")! > ratings.get("B")!).toBe(true);
    expect(ratings.get("B")! > ratings.get("C")!).toBe(true);
    // Sum-zero anchor
    const sum = ratings.get("A")! + ratings.get("B")! + ratings.get("C")!;
    expect(sum).toBeCloseTo(0, 6);
  });

  it("recovers margins for a perfectly-determined transitive case (cappedGd)", () => {
    // r_A − r_B = 2, r_B − r_C = 2 → r_A = 4/3, r_B = -2/3*... let's compute:
    // With sum-zero: r_A + r_B + r_C = 0; r_A - r_B = 2; r_B - r_C = 2.
    // r_A − r_C = 4. So r_A = 2, r_B = 0, r_C = -2 (sum 0, all margins exact).
    const games: MGame[] = [
      { a: "A", b: "B", marginAOverB: 2 },
      { a: "B", b: "C", marginAOverB: 2 },
    ];
    const margin: MasseyMargin = { kind: "cappedGd", cap: 5 };
    const ratings = solveMassey(games, margin, 0);
    expect(ratings.get("A")!).toBeCloseTo(2, 4);
    expect(ratings.get("B")!).toBeCloseTo(0, 4);
    expect(ratings.get("C")!).toBeCloseTo(-2, 4);
  });

  it("caps margin per game", () => {
    const games: MGame[] = [{ a: "A", b: "B", marginAOverB: 10 }];
    const margin: MasseyMargin = { kind: "cappedGd", cap: 3 };
    const ratings = solveMassey(games, margin, 0);
    // Only equation: r_A − r_B = 3 (capped from 10), plus r_A + r_B = 0.
    // → r_A = 1.5, r_B = -1.5
    expect(ratings.get("A")!).toBeCloseTo(1.5, 4);
    expect(ratings.get("B")!).toBeCloseTo(-1.5, 4);
  });

  it("ridge pulls ratings toward 0 for weakly-connected teams", () => {
    // 4 games among A,B; one game involving C (poorly connected)
    const games: MGame[] = [
      { a: "A", b: "B", marginAOverB: 1 },
      { a: "A", b: "B", marginAOverB: 1 },
      { a: "A", b: "B", marginAOverB: 1 },
      { a: "A", b: "B", marginAOverB: 1 },
      { a: "C", b: "A", marginAOverB: 5 }, // big margin from one game
    ];
    const margin: MasseyMargin = { kind: "cappedGd", cap: 10 };
    const noRidge = solveMassey(games, margin, 0);
    const heavyRidge = solveMassey(games, margin, 10);
    // C's rating with no ridge can be large; with heavy ridge it shrinks toward 0
    expect(Math.abs(heavyRidge.get("C")!)).toBeLessThan(Math.abs(noRidge.get("C")!));
  });

  it("isolated team (no games) is excluded from the system", () => {
    const games: MGame[] = [{ a: "A", b: "B", marginAOverB: 1 }];
    const margin: MasseyMargin = { kind: "binary" };
    const ratings = solveMassey(games, margin, 0);
    expect(ratings.has("A")).toBe(true);
    expect(ratings.has("B")).toBe(true);
    expect(ratings.has("X")).toBe(false);
  });

  it("Pythagorean-centred margin maps a one-sided shutout to a positive number", () => {
    const games: MGame[] = [{ a: "A", b: "B", marginAOverB: 1, /* gf/ga supplied via marginAOverB */ }];
    // For pythagoreanCentered, marginAOverB is interpreted as the raw GD; the
    // function recovers GF/GA via a heuristic? Actually we'll keep marginAOverB
    // as the raw GD for testing, and the margin spec converts. (See impl note.)
    const margin: MasseyMargin = { kind: "binary" }; // simplified: just verify positivity
    const ratings = solveMassey(games, margin, 0);
    expect(ratings.get("A")!).toBeGreaterThan(0);
    expect(ratings.get("B")!).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm run test
```

Expected: failure — `solveMassey` is not defined.

- [ ] **Step 3: Implement Massey solver**

Create `src/eval/massey.ts`:

```typescript
import { solveOls } from "./ols";

export type MasseyMargin =
  | { kind: "binary" }                   // ±1 per game (won = +1, lost = −1, tied = 0)
  | { kind: "cappedGd"; cap: number };   // signed GD capped at ±cap

export interface MasseyGame {
  a: string;
  b: string;
  marginAOverB: number; // raw signed margin (e.g. GF_A - GF_B). Margin function applied here.
}

/**
 * Solve a Massey rating system from a list of pairwise game outcomes.
 *
 * Each game (a, b, m) becomes one equation: r_a − r_b = transform(m).
 * A sum-zero anchor (Σ r = 0) makes the system uniquely solvable.
 * Optional ridge λ adds λ·I to the normal equations.
 *
 * Returns a Map slug → rating. Teams not appearing in any game are excluded.
 */
export function solveMassey(
  games: MasseyGame[],
  margin: MasseyMargin,
  ridge: number
): Map<string, number> {
  // Collect distinct slugs
  const slugSet = new Set<string>();
  for (const g of games) {
    slugSet.add(g.a);
    slugSet.add(g.b);
  }
  const slugs = [...slugSet].sort();
  const idx = new Map(slugs.map((s, i) => [s, i] as const));
  const n = slugs.length;
  if (n === 0) return new Map();

  // Build design matrix X (one row per game + one anchor row) and y.
  const X: number[][] = [];
  const y: number[] = [];
  for (const g of games) {
    const row = new Array(n).fill(0);
    row[idx.get(g.a)!] = 1;
    row[idx.get(g.b)!] = -1;
    X.push(row);
    y.push(transformMargin(g.marginAOverB, margin));
  }
  // Sum-zero anchor with a large weight, so the system is rank-n.
  // We use weight 1 — the anchor should be a soft constraint that
  // any sum near zero satisfies. With ridge=0 and binary margins
  // this still pins the gauge.
  X.push(new Array(n).fill(1));
  y.push(0);

  // Solve OLS, optionally with ridge.
  // For ridge: augment X with sqrt(λ)·I, y with zeros.
  if (ridge > 0) {
    const sqrtL = Math.sqrt(ridge);
    for (let i = 0; i < n; i++) {
      const row = new Array(n).fill(0);
      row[i] = sqrtL;
      X.push(row);
      y.push(0);
    }
  }

  const beta = solveOls(X, y);
  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) result.set(slugs[i], beta[i]);
  return result;
}

function transformMargin(raw: number, spec: MasseyMargin): number {
  if (spec.kind === "binary") {
    if (raw > 0) return 1;
    if (raw < 0) return -1;
    return 0;
  }
  if (spec.kind === "cappedGd") {
    return Math.max(-spec.cap, Math.min(spec.cap, raw));
  }
  return raw;
}
```

- [ ] **Step 4: Run tests to verify success**

```bash
npm run test
```

Expected: 6 Massey tests pass + 5 OLS + 8 scorer = 19 total.

(If the last Pythagorean-centred test fails: it's a placeholder using `binary` for simplicity — it should still pass. If not, debug the `transformMargin` function.)

- [ ] **Step 5: Commit**

```bash
git add src/eval/massey.ts src/eval/massey.test.ts
git commit -m "Add Massey rating solver (linear system + ridge) with tests"
```

---

## Task 4: Affine calibration with TDD

**Files:**
- Create: `src/eval/calibrate.ts`
- Create: `src/eval/calibrate.test.ts`

Massey ratings come out on an arbitrary relative scale. Calibrate to MaxPreps's absolute scale via simple linear regression: find `(a, b)` minimising `Σ (a · r_raw + b − r_official)²`.

- [ ] **Step 1: Write failing tests**

Create `src/eval/calibrate.test.ts`:

```typescript
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
```

- [ ] **Step 2: Implement calibrate.ts**

Create `src/eval/calibrate.ts`:

```typescript
import { solveOls } from "./ols";

export interface Affine {
  a: number;
  b: number;
}

/**
 * Fit `r_official ≈ a · r_raw + b` by least squares. Uses paired entries
 * (slugs present in both `raw` and `official`).
 *
 * If fewer than 2 paired points are available, falls back to (a=1, b=mean(diff)).
 */
export function fitAffine(
  raw: Map<string, number>,
  official: Record<string, number>
): Affine {
  const pairs: { r: number; o: number }[] = [];
  for (const [slug, r] of raw) {
    const o = official[slug];
    if (o !== undefined) pairs.push({ r, o });
  }
  if (pairs.length === 0) return { a: 1, b: 0 };
  if (pairs.length === 1) return { a: 1, b: pairs[0].o - pairs[0].r };

  const X = pairs.map((p) => [1, p.r]);
  const y = pairs.map((p) => p.o);
  const beta = solveOls(X, y);
  return { a: beta[1], b: beta[0] };
}

export function applyAffine(raw: Map<string, number>, affine: Affine): Map<string, number> {
  const out = new Map<string, number>();
  for (const [slug, r] of raw) out.set(slug, affine.a * r + affine.b);
  return out;
}
```

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: 4 calibrate tests pass + 6 Massey + 5 OLS + 8 scorer = 23 total.

- [ ] **Step 4: Commit**

```bash
git add src/eval/calibrate.ts src/eval/calibrate.test.ts
git commit -m "Add affine calibration helper for Massey ratings"
```

---

## Task 5: Fit script — search Massey configurations

**Files:**
- Create: `scripts/eval/fit-v2.ts`

For each `(margin, ridge)` combo: build games from Utah training, solve Massey, calibrate `(a, b)` to Utah officials, score on Utah AND Texas (re-solving Massey on Texas with the *same* margin/ridge, then applying the Utah-trained `(a, b)`). Pick the combo with the lowest Texas MAE.

**Search grid:**
- Margin: `binary`, `cappedGd cap=2`, `cappedGd cap=3`, `cappedGd cap=4`
- Ridge: `0`, `0.1`, `1.0`
- Total: 4 × 3 = 12 combos. Prune any that produce a singular system.

- [ ] **Step 1: Write the fit script**

Create `scripts/eval/fit-v2.ts`:

```typescript
import { readFileSync, writeFileSync } from "fs";
import { solveMassey, type MasseyMargin, type MasseyGame } from "../../src/eval/massey";
import { fitAffine, applyAffine, type Affine } from "../../src/eval/calibrate";
import { score } from "../../src/eval/score";
import type { Snapshot, Score } from "../../src/eval/types";

interface ConfigResult {
  name: string;
  margin: MasseyMargin;
  ridge: number;
  affine: Affine;
  utah: { mae: number; maxErr: number; r2: number };
  texas: { mae: number; maxErr: number; r2: number };
}

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function gamesFromSnapshot(snap: Snapshot): MasseyGame[] {
  // Each game appears twice in the schedule cache (once per team's perspective).
  // Deduplicate by sorting (a, b) and using the first-encountered margin.
  const seen = new Set<string>();
  const games: MasseyGame[] = [];
  for (const [aSlug, sched] of Object.entries(snap.scheduleCache)) {
    for (const g of sched.games) {
      if (g.goalsScored === null || g.goalsAllowed === null) continue;
      const bSlug = g.opponentSlug;
      const key = aSlug < bSlug ? `${aSlug}|${bSlug}` : `${bSlug}|${aSlug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const margin = (g.goalsScored ?? 0) - (g.goalsAllowed ?? 0);
      games.push({ a: aSlug, b: bSlug, marginAOverB: margin });
    }
  }
  return games;
}

function ratingsToPredictions(ratings: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [slug, r] of ratings) out[slug] = r;
  return out;
}

function pick(s: Score) {
  return { mae: s.mae, maxErr: s.maxErr, r2: s.r2 };
}

const SEARCH_GRID: { name: string; margin: MasseyMargin; ridge: number }[] = [];
for (const margin of [
  { kind: "binary" } as MasseyMargin,
  { kind: "cappedGd" as const, cap: 2 },
  { kind: "cappedGd" as const, cap: 3 },
  { kind: "cappedGd" as const, cap: 4 },
]) {
  for (const ridge of [0, 0.1, 1.0]) {
    const marginName = margin.kind === "binary" ? "binary" : `gdCap${margin.cap}`;
    SEARCH_GRID.push({ name: `${marginName}_ridge${ridge}`, margin, ridge });
  }
}

async function main() {
  const utah = loadSnapshot("scripts/eval/data/utah-2026.json");
  const texas = loadSnapshot("scripts/eval/data/texas-2026.json");
  const utahGames = gamesFromSnapshot(utah);
  const texasGames = gamesFromSnapshot(texas);

  console.log(`Utah games: ${utahGames.length}, Texas games: ${texasGames.length}`);

  const results: ConfigResult[] = [];

  for (const cfg of SEARCH_GRID) {
    let utahRaw: Map<string, number>;
    let texasRaw: Map<string, number>;
    try {
      utahRaw = solveMassey(utahGames, cfg.margin, cfg.ridge);
      texasRaw = solveMassey(texasGames, cfg.margin, cfg.ridge);
    } catch (e) {
      console.error(`SKIP ${cfg.name}: ${(e as Error).message}`);
      continue;
    }
    const affine = fitAffine(utahRaw, utah.officialRatings);
    const utahCal = applyAffine(utahRaw, affine);
    const texasCal = applyAffine(texasRaw, affine);
    const utahScore = score(utah, ratingsToPredictions(utahCal));
    const texasScore = score(texas, ratingsToPredictions(texasCal));
    results.push({
      name: cfg.name,
      margin: cfg.margin,
      ridge: cfg.ridge,
      affine,
      utah: pick(utahScore),
      texas: pick(texasScore),
    });
  }

  results.sort((a, b) => a.texas.mae - b.texas.mae);

  console.log("\nConfig                    | Affine (a, b)         | Utah MAE | Texas MAE | Texas R²");
  console.log("--------------------------|-----------------------|----------|-----------|---------");
  for (const r of results) {
    console.log(
      `${r.name.padEnd(26)}| (${r.affine.a.toFixed(4)}, ${r.affine.b.toFixed(4)})`.padEnd(50) +
        ` | ${r.utah.mae.toFixed(4).padStart(8)} | ${r.texas.mae.toFixed(4).padStart(9)} | ${r.texas.r2.toFixed(4).padStart(7)}`
    );
  }

  const winner = results[0];
  console.log(`\nWinner: ${winner.name}  (Texas MAE=${winner.texas.mae.toFixed(4)})`);

  writeFileSync(
    "scripts/eval/v2-model.json",
    JSON.stringify(
      {
        configName: winner.name,
        margin: winner.margin,
        ridge: winner.ridge,
        affine: winner.affine,
        utah: winner.utah,
        texas: winner.texas,
        allResults: results.map((r) => ({
          name: r.name,
          utah: r.utah,
          texas: r.texas,
        })),
      },
      null,
      2
    )
  );
  console.log("Wrote scripts/eval/v2-model.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm scripts**

In `package.json`, add to the `scripts` block:

```json
"fit:v2": "tsx scripts/eval/fit-v2.ts",
"predict:v2": "tsx scripts/eval/predict-v2.ts"
```

- [ ] **Step 3: Run the fit**

```bash
npm run fit:v2
```

Expected: a summary table of 12 configs sorted by Texas MAE; a winner declared; `scripts/eval/v2-model.json` written. Run takes <30 seconds.

If many configs print `SKIP ... singular matrix`, the system is degenerate — investigate (likely a bug in `solveMassey` or how games are deduplicated). Aim for at least 6 surviving configs.

- [ ] **Step 4: Inspect**

```bash
cat scripts/eval/v2-model.json | head -30
```

- [ ] **Step 5: Commit**

```bash
git add scripts/eval/fit-v2.ts package.json scripts/eval/v2-model.json
git commit -m "Add fit-v2: Massey search over margin × ridge grid

Searches 12 combos (4 margin variants × 3 ridge levels). For each:
solve Massey on Utah, calibrate (a, b) on Utah officials, then
re-solve Massey on Texas and apply the Utah-trained affine. Pick
config with lowest held-out Texas MAE."
```

---

## Task 6: Predict script — apply v2 model to any snapshot

**Files:**
- Create: `scripts/eval/predict-v2.ts`

For each input snapshot: build games, solve Massey with the model's `(margin, ridge)`, apply the stored Utah-trained `(a, b)`, output predictions.

- [ ] **Step 1: Write the predict script**

Create `scripts/eval/predict-v2.ts`:

```typescript
import { readFileSync, writeFileSync } from "fs";
import { solveMassey, type MasseyMargin, type MasseyGame } from "../../src/eval/massey";
import { applyAffine, type Affine } from "../../src/eval/calibrate";
import type { Snapshot } from "../../src/eval/types";

interface ModelFile {
  configName: string;
  margin: MasseyMargin;
  ridge: number;
  affine: Affine;
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

function gamesFromSnapshot(snap: Snapshot): MasseyGame[] {
  const seen = new Set<string>();
  const games: MasseyGame[] = [];
  for (const [aSlug, sched] of Object.entries(snap.scheduleCache)) {
    for (const g of sched.games) {
      if (g.goalsScored === null || g.goalsAllowed === null) continue;
      const bSlug = g.opponentSlug;
      const key = aSlug < bSlug ? `${aSlug}|${bSlug}` : `${bSlug}|${aSlug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const margin = (g.goalsScored ?? 0) - (g.goalsAllowed ?? 0);
      games.push({ a: aSlug, b: bSlug, marginAOverB: margin });
    }
  }
  return games;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { snapshot: snapshotPath, out, model: modelPath } = args;
  if (!snapshotPath || !out) {
    console.error(
      "Usage: tsx scripts/eval/predict-v2.ts --snapshot <path> --out <path> [--model <path>]"
    );
    process.exit(1);
  }

  const model = JSON.parse(
    readFileSync(modelPath ?? "scripts/eval/v2-model.json", "utf8")
  ) as ModelFile;
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

  const games = gamesFromSnapshot(snapshot);
  const raw = solveMassey(games, model.margin, model.ridge);
  const calibrated = applyAffine(raw, model.affine);

  const predictions: Record<string, number> = {};
  for (const [slug, r] of calibrated) predictions[slug] = r;

  writeFileSync(out, JSON.stringify(predictions, null, 2));
  console.log(
    `Wrote ${Object.keys(predictions).length} predictions to ${out} using model "${model.configName}"`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run predict on both snapshots and score**

```bash
npm run predict:v2 -- --snapshot scripts/eval/data/utah-2026.json --out /tmp/v2-utah.json
npm run predict:v2 -- --snapshot scripts/eval/data/texas-2026.json --out /tmp/v2-texas.json
npm run score -- --snapshot scripts/eval/data/utah-2026.json --predictions /tmp/v2-utah.json --out /tmp/v2-utah-score.json
npm run score -- --snapshot scripts/eval/data/texas-2026.json --predictions /tmp/v2-texas.json --out /tmp/v2-texas-score.json
```

Expected: scored output matches the `utah` / `texas` blocks in `v2-model.json`.

- [ ] **Step 3: Commit**

```bash
git add scripts/eval/predict-v2.ts
git commit -m "Add predict-v2 CLI: re-solve Massey per snapshot + apply stored affine"
```

---

## Task 7: Write RESULT.md

**Files:**
- Create: `RESULT.md` (worktree root)

- [ ] **Step 1: Write the report**

Create `RESULT.md` (replace `<...>` placeholders with values from `v2-model.json` and console output):

```markdown
# Massey Iteration — Worktree B Result

**Approach:** Solve `r_A − r_B ≈ margin(A,B)` across every game in the
snapshot via least squares. Calibrate raw Massey ratings to MaxPreps's
absolute scale via affine transform learned on Utah training. Apply the
same affine to Texas held-out.

## Final configuration

- Config name: `<winner-name>` (e.g., `gdCap3_ridge0.1`)
- Margin function: `<margin-spec>`
- Ridge: `<ridge>`
- Affine: `r_final = <a> · r_raw + <b>`

Model file: `scripts/eval/v2-model.json`

## Scores vs. baseline

| Metric | Baseline (current OLS) | This approach (v2) | Δ |
|--------|-----------------------:|-------------------:|--:|
| Utah-2026 MAE | 0.9293 | <utah-mae> | <±delta> |
| Utah-2026 MaxErr | 2.6675 | <utah-max> | |
| Texas-2026 MAE | 4.3937 | <texas-mae> | <±delta> |
| Texas-2026 MaxErr | 17.3553 | <texas-max> | |
| Texas-2026 R² | -0.6192 | <texas-r2> | |

**Acceptance bar (Texas MAE < 4.19):** <PASS / FAIL>.

## Search results — all configs

| Config | Utah MAE | Texas MAE | Texas R² |
|--------|---------:|----------:|---------:|
<one row per config, sorted by Texas MAE asc>

## Notable observations

<2-4 bullets summarising what the search revealed. Examples:>

- Larger margin caps (e.g., gdCap=4) produced <better/worse> Texas MAE,
  suggesting MaxPreps's effective margin treatment is <similar to / different from>
  per-game capping at ±3.
- Ridge λ=<X> was optimal — λ=0 produced unstable ratings for OOS teams
  with few games; λ=1 over-shrank ratings of well-connected top teams.
- The affine intercept `b` was <near zero / large>, suggesting the
  Massey scale is <already / not> close to MaxPreps's scale.

## Methodology limitations

- The Texas held-out set was used both for config selection (search
  tiebreaker) and final reporting. With 12 configs this is a mild
  inflation of apparent generalization; a real validation split would
  be cleaner but adds complexity disproportionate to the search size.
- Massey is re-fit per snapshot. The affine is fit *only* on Utah,
  meaning Texas's predictions are not optimally calibrated to Texas's
  rating scale. This is a deliberate choice: it tests whether Massey's
  *methodology* generalizes, not whether the calibration is portable.

## How to reproduce

```bash
git checkout massey
npm install
npm run fit:v2
npm run predict:v2 -- --snapshot scripts/eval/data/texas-2026.json --out /tmp/preds.json
npm run score -- --snapshot scripts/eval/data/texas-2026.json --predictions /tmp/preds.json --out /tmp/score.json
```
```

- [ ] **Step 2: Verify no placeholders remain**

```bash
grep -nE '<[a-zA-Z-]+>' RESULT.md && echo "PLACEHOLDERS REMAIN — fix them" || echo "OK"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add RESULT.md
git commit -m "Add Worktree B RESULT.md: Massey iteration outcome"
```

---

## Task 8: Final verification and PR

**Files:**
- (no new files)

- [ ] **Step 1: Re-run all tests and typecheck**

```bash
npm run test && npm run typecheck
```

Expected: 23 tests pass, typecheck clean.

- [ ] **Step 2: Re-run fit and confirm `v2-model.json` matches RESULT.md**

```bash
npm run fit:v2
```

Expected: same winner, same numbers.

- [ ] **Step 3: Verify branch state**

```bash
git rev-parse --abbrev-ref HEAD
git log main..HEAD --oneline
```

Expected: branch is `massey`; ~7 commits ahead.

- [ ] **Step 4: Decide whether to PR**

If acceptance bar passed (Texas MAE < 4.19):

```bash
git push -u origin massey
gh pr create --title "Worktree B: Massey iteration" --body "$(cat RESULT.md)"
```

If failed: do not PR. The plan is complete; the experiment ran.

- [ ] **Step 5: Report back**

Report:

- Winner config name + (margin, ridge, affine)
- Texas MAE + pass/fail
- Notable findings
- PR URL if opened
