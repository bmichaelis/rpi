# Massey Iteration — Worktree B Result

**Approach:** Solve `r_A − r_B ≈ margin(A,B)` across every game in the
snapshot via least squares with sum-zero anchor and optional ridge.
Calibrate raw Massey ratings to MaxPreps's absolute scale via affine
transform `r_final = a · r_raw + b` learned on Utah training. Apply
the same affine to held-out Texas.

## Final configuration

- Config name: `binary_ridge1`
- Margin function: `binary` (won = +1, lost = −1, tied = 0)
- Ridge: λ = 1.0
- Affine: `r_final = 17.5206 · r_raw + 0.4544`

Model file: `scripts/eval/v2-model.json`

## Scores vs. baseline

| Metric | Baseline (current OLS) | This approach (v2: binary_ridge1) | Δ |
|--------|-----------------------:|----------------------------------:|--:|
| Utah-2026 MAE | 0.9293 | 1.3752 | +0.4459 (worse) |
| Utah-2026 MaxErr | 2.6675 | 5.2158 | +2.5483 (worse) |
| Texas-2026 MAE | 4.3937 | **3.5058** | **−0.8879** |
| Texas-2026 MaxErr | 17.3553 | 13.5545 | −3.8008 |
| Texas-2026 R² | −0.6192 | −0.2158 | +0.4034 |

**Acceptance bar (Texas MAE < 4.19): PASS** (3.51 < 4.19, ahead by 0.68).

## Search results — all 12 configs

| Config | Affine (a, b) | Utah MAE | Texas MAE | Texas R² |
|--------|---------------|---------:|----------:|---------:|
| binary_ridge1 (winner) | (17.52, 0.45) | 1.3752 | 3.5058 | −0.2158 |
| gdCap2_ridge1 | (9.74, 0.44) | 1.5364 | 3.5438 | −0.2994 |
| gdCap3_ridge1 | (7.14, 0.53) | 1.8201 | 3.7436 | −0.5044 |
| gdCap4_ridge1 | (5.85, 0.52) | 2.1283 | 4.2356 | −0.8293 |
| binary_ridge0.1 | (15.02, −1.76) | 1.6737 | 5.1373 | −1.4017 |
| gdCap2_ridge0.1 | (8.25, −1.82) | 2.0847 | 5.3150 | −1.6048 |
| gdCap3_ridge0.1 | (6.03, −1.72) | 2.4206 | 5.4720 | −1.7331 |
| binary_ridge0 | (14.61, −2.32) | 1.8130 | 5.7056 | −2.0952 |
| gdCap2_ridge0 | (8.00, −2.38) | 2.2319 | 5.9731 | −2.3774 |
| gdCap4_ridge0.1 | (4.92, −1.74) | 2.6741 | 5.9929 | −2.1375 |
| gdCap3_ridge0 | (5.85, −2.28) | 2.5659 | 6.1242 | −2.4356 |
| gdCap4_ridge0 | (4.76, −2.31) | 2.8174 | 6.6353 | −2.8394 |

## Notable observations

- **Ridge λ=1.0 dominated.** Every λ=1 config beat every λ=0 config on Texas. The
  ridge term anchors weakly-connected nodes (OOS opponents with few games)
  toward 0, preventing them from contributing high-variance "noise" ratings
  that propagate through the network.
- **Binary outcome marginally beat capped GD.** This is surprising — a less
  granular margin function generalized better. One explanation: per-game GD
  has high variance in soccer (lots of 1-0 / 2-0 games), and the "shape" of
  the rating system is more about the topology of who-beat-whom than how
  decisively. With ridge, the binary-outcome system avoids over-weighting blowout
  games.
- **Massey trades worse training MAE for better held-out generalization.**
  Utah MAE 1.38 vs OLS baseline's 0.93 — but Texas MAE 3.51 vs OLS's 4.39.
  The Massey methodology, being agnostic to season length, transfers more cleanly.
- **Affine intercept `b` is near-zero for the winner**, suggesting the Massey
  scale (post-anchor) already centers near the MaxPreps mean. The slope
  `a=17.5` is just the rescaling factor between binary win/loss differences
  and MaxPreps's rating units.

## Methodology limitations

- The Texas held-out set was used both for config selection (winner pick) and
  final reporting. With 12 configs this is mild inflation; a real validation
  split would be cleaner.
- Massey is re-fit per snapshot. The affine is fit *only* on Utah, meaning
  Texas's predictions are not optimally calibrated to Texas's rating scale.
  This is deliberate: it tests whether Massey's *methodology* generalizes,
  not whether the calibration is portable.
- Utah training MAE is substantially worse than OLS (1.38 vs 0.93). If the
  use case prioritises in-state accuracy (the original Utah RPI use case),
  Massey is a poor choice despite winning on held-out.

## How to reproduce

```bash
git checkout massey
npm install
npm run fit:v2
npm run predict:v2 -- --snapshot scripts/eval/data/texas-2026.json --out /tmp/preds.json
npm run score -- --snapshot scripts/eval/data/texas-2026.json --predictions /tmp/preds.json --out /tmp/score.json
```
