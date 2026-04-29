# MaxPreps Rating Reproduction — Design

## Status

- [x] Phase 1: Eval harness on `main` (this commit chain)
- [ ] Phase 2: Worktree A — Refined OLS (Plan 2 — to be written)
- [ ] Phase 3: Worktree B — Massey iteration (Plan 3 — to be written)
- [ ] Phase 4: Worktree C — Residual reverse-engineering (Plan 4 — to be written)
- [ ] Phase 5: Compare results, merge winner (Plan 5 — to be written)

Baseline (current OLS) — see `scripts/eval/BASELINE.md`:
- Utah-2026 (training): MAE=0.93, MaxErr=2.67, R²=0.986
- Texas-2026 (held-out): MAE=4.39, MaxErr=17.36, R²=-0.62
- Acceptance bar for new approaches: MAE < 4.19 on Texas held-out

## Background

We currently compute a MaxPreps-style rating via an OLS formula:

```
rating = 0.8809*(W-L) + 0.9183*strength + 1.6813*gdCap + 0.0552
```

It achieves R²=0.989 / MAE=0.75 / MaxErr~2.8 on Utah 4A/5A/6A 2026 data, but produces visible errors on individual teams. Examples (Utah 4A, 12-3-0 records):

| Team       | strength | Our calc | Official | Error |
|------------|----------|----------|----------|-------|
| Timpanogos | 3.0      | 13.41    | 12.2918  | +1.12 |
| East       | 3.2      | 15.29    | 13.9808  | +1.31 |

Goal: produce a formula that *reproduces* MaxPreps's rating, not merely approximates it.

## What MaxPreps publishes about their rating

From maxpreps.com:

- Inputs: results from any given game, playoff wins/losses, opponents' strength of schedule.
- Updated twice per week (Sundays & Thursdays).
- Minimum 3 games before a team appears in rankings.
- State association does not factor in — every team in the MaxPreps database is treated the same. No class weighting.
- Two values are published per team: `rating` and `strength`. The `strength` field is described as the avg opponent published rating, suggesting a fixed-point iteration.

A consequence: our current `compute-rpi.ts` filters out post-season games (`C_GAME_TYPE === 4`). MaxPreps includes them. **The snapshot fetcher in this design must include playoff games.**

## Goal

Produce a formula `f(scheduleCache, strengthMap?) → ratings` that minimises MAE against MaxPreps's official ratings on a *held-out* test set the formula was not fit on.

## Approach

Three independent approaches, each developed in its own git worktree off `main`. A shared evaluation harness scores each approach against the same training and held-out snapshots. The best-scoring approach replaces the production formula.

Sequencing: the shared evaluation harness (snapshots + scorer) is built and merged to `main` first. Only after `main` has both snapshot files committed do the three worktrees branch off. This guarantees all three approaches see identical inputs.

```
main
├── worktree A: refined-ols    → calculateAllMaxPrepsRatings_v1
├── worktree B: massey-rating  → calculateAllMaxPrepsRatings_v2
└── worktree C: residual-rev   → calculateAllMaxPrepsRatings_v3
                                       ↓
                            shared evaluation harness
                                       ↓
                          merge winner; close the other two
```

Each worktree implements its formula as a NEW function, alongside the existing `calculateAllMaxPrepsRatings`. The existing function is not modified during this work.

## Shared evaluation harness (built on `main` first)

Lives at `scripts/eval/`.

### Snapshots (committed to `main`)

- `scripts/eval/data/utah-2026.json` — training set. Frozen `scheduleCache` for all Utah 4A/5A/6A teams + their opponents/opp-of-opp, plus `officialRatings` and `strengthMap` from the rankings API. Built by `scripts/eval/fetch-snapshot.ts` once, immediately after a Sun/Thu publish.
- `scripts/eval/data/texas-2026.json` — held-out test. Same structure, for Texas boys soccer (current spring season). Approaches do not fit on this set.

Snapshot file shape:

```typescript
{
  capturedAt: string;          // ISO timestamp
  scheduleCache: Record<string, TeamSchedule>;  // includes playoff games
  officialRatings: Record<string, number>;      // slug → MaxPreps rating
  strengthMap: Record<string, number>;          // slug → MaxPreps strength
}
```

`fetch-snapshot.ts` is a one-off script. Snapshots are JSON files committed to git. Approaches read them, never re-fetch.

### Predictions contract

Each worktree adds its own predict script (`scripts/eval/predict-v{1,2,3}.ts`) wired up via an npm script `predict:v{N}`:

```
npm run predict:v1 -- --snapshot scripts/eval/data/utah-2026.json --out predictions.json
```

`predictions.json` shape:

```typescript
Record<string, number>   // slug → predicted rating
```

Approaches may use any internals (closed-form, iterative, ML model). Only the contract matters.

### Scorer

`scripts/eval/score.ts`:

```
npm run score -- --snapshot <snapshot.json> --predictions <predictions.json> --out score.json
```

`score.json` contents:

- `mae`, `rmse`, `maxErr`, `r2`
- `residualHistogram` — 10 buckets from min residual to max
- `byClass` — same metrics per class (4A/5A/6A/OOS)
- `worst10` — array of `{ slug, predicted, official, residual }` sorted by |residual| desc

The scorer is run twice per approach: once on training (`utah-2026`), once on held-out (`texas-2026`). Both results go in the worktree's `RESULT.md`.

## Approach 1 — Refined OLS (worktree A)

Closed-form `rating = f(W, L, T, strength, margin_features)`. Search over functional forms; pick the one with best held-out MAE.

Search space:
- Margin variants:
  - Capped per-game GD with cap ∈ {±2, ±3, ±4}
  - Pythagorean per-game: `GF^p / (GF^p + GA^p)` for p ∈ {1, 2, 2.5, 3}, then averaged
  - Log-margin: `log(1 + GF) − log(1 + GA)` per game, averaged
- Interaction terms: `strength × (W-L)`, `strength × margin`
- Class-specific intercepts (likely no help per MaxPreps docs, but worth confirming)
- T (ties) coefficient distinct from W and L (current formula collapses ties into W-L)

Implementation: a small fitting script using least-squares regression (sufficient — no need for heavy ML). Try each candidate functional form, compute training and held-out scores, pick the best.

Output: `src/rpi.ts` gains `calculateAllMaxPrepsRatings_v1` exporting the chosen form.

## Approach 2 — Massey iteration (worktree B)

Every game produces an equation `r_A − r_B ≈ capped_margin(A, B)`. Solve via least squares across all teams in the snapshot.

Network handling: every team appearing in the snapshot's `scheduleCache` becomes a node in the linear system, including out-of-network opponents reached via opp-of-opp. The system is under-determined for poorly-connected teams, so the harness applies a final affine transform `r_final = a * r_raw + b` with `a, b` chosen to match the mean and variance of the training set's official ratings. The exact treatment of teams with very few in-network games (e.g., excluding them from the fit, vs. soft-anchoring to a published `strength`-derived prior) is a design choice explored within the worktree.

Search space:
- Margin caps {±2, ±3, ±4}
- Binary win/loss (margin = ±1) as a baseline
- Optional ridge term λ ∈ {0, 0.1, 1.0} to stabilise weakly-connected teams

Implementation:
- Build sparse linear system from `scheduleCache` (one row per game).
- Solve via iterative method (Gauss-Seidel with damping is sufficient for this problem size).
- Apply affine calibration: `r_calibrated = a * r_raw + b` with `a, b` chosen so training residuals have zero mean and matching std.

Output: `src/rpi.ts` gains `calculateAllMaxPrepsRatings_v2`.

## Approach 3 — Residual reverse-engineering (worktree C)

Treat the current OLS as a baseline. Compute residuals on Utah-2026. Identify what's systematically missing; build a model based on findings.

Workflow:
1. Compute per-team residuals using current OLS.
2. Generate diagnostic tables: residual vs class, vs # games, vs # losses to top-25 opponents, vs strength magnitude, vs margin distribution shape (variance, skew), vs # opponents in our network.
3. Form hypotheses from patterns. Examples of likely findings:
   - "Residual correlates with GD variance → margin should not just be the mean"
   - "Residual correlates with strength × margin → there's an interaction"
   - "Residual is bimodal by class → coefficients vary"
4. Test each hypothesis by adding the corresponding term and refitting.
5. Iterate until residuals look like noise or held-out MAE stops improving.

**Timebox: 1 day of work.** If residuals don't yield to analysis within the timebox, ship the best-found model and document remaining patterns.

Output: `src/rpi.ts` gains `calculateAllMaxPrepsRatings_v3`. Diagnostic notebooks/scripts go in `scripts/eval/v3-diagnostics/`.

## Decision criteria

Primary metric: **MAE on Texas held-out**. Lowest wins.

Tiebreakers (within 0.05 MAE on held-out):
1. Lower MaxErr on held-out
2. Lower MAE on Utah-2026 training
3. Simpler implementation (closed-form preferred over iterative when both work)

**Acceptance bar:** the winner must beat the current OLS by at least **0.20 MAE** on the Texas held-out set. If no approach clears the bar, we keep the current formula and document why.

## Merge plan

1. Each worktree opens a PR into `main`.
2. After all three complete and produce `RESULT.md`, decide the winner per criteria above.
3. Merge the winning PR. Its `calculateAllMaxPrepsRatings_v{N}` is renamed to `calculateAllMaxPrepsRatings`, replacing the existing function.
4. Close the other two PRs. Their branches remain as refs for future reference; their `RESULT.md` files document failed experiments.
5. Bump `mpRating` output precision in `compute-rpi.ts` from 2 decimals to 4 to match the official format.
6. Update memory: `maxpreps-rating-formula.md` with the new formula, accuracy figures, and notes on what was tried and rejected.

## What this design intentionally does NOT do

- Does NOT switch the public page to display `mpOfficialRating` instead of `mpRating`. Even with a better formula, the page continues to show our calculated value as the headline.
- Does NOT change the RPI calculation (only the MaxPreps-style rating).
- Does NOT change the iterative fallback for teams without a strength value, except as a side effect if Approach 2 wins (Massey doesn't need a separate fallback).
- Does NOT add new data sources beyond MaxPreps. Held-out test is also MaxPreps data, just from a different state.
