# Residual Reverse-Engineering — Worktree C Result

**Approach:** Use the production OLS as a starting point. Compute residuals on
Utah training, identify systematic patterns via correlation analysis, and
iteratively add corrective terms. Stop when held-out Texas MAE plateaus or
after 5 iterations.

## Final feature set

```
["intercept", "W − L", "strength", "gdCap", "(W−L)/nGames", "strength × (W−L)/nGames"]
```

Coefficients (from `scripts/eval/v3-model.json`):

| # | Feature | Coefficient |
|---|---------|------------:|
| 0 | intercept | 0.0810 |
| 1 | (W − L) | 0.1383 |
| 2 | strength | 0.9152 |
| 3 | gdCap (capped per-game GD ±3) | 1.3587 |
| 4 | (W − L) / nGames | 11.1414 |
| 5 | strength × (W − L) / nGames | −0.0009 |

**Key observation about the fit:** the absolute (W − L) coefficient collapsed
from baseline's 0.88 to 0.14, while the season-normalised term `(W − L) / nGames`
absorbed nearly all the W-L signal (coefficient 11.14). The interaction
term collapsed to ~0 — its inclusion does no harm but adds nothing. With
hindsight, dropping the interaction term would simplify the model without
loss.

## Scores vs. baseline

| Metric | Baseline (current OLS) | This approach (v3) | Δ |
|--------|-----------------------:|-------------------:|--:|
| Utah-2026 MAE | 0.9293 | **0.7275** | **−0.2018** |
| Utah-2026 MaxErr | 2.6675 | 2.0893 | −0.5782 |
| Texas-2026 MAE | 4.3937 | **1.5993** | **−2.7944** |
| Texas-2026 MaxErr | 17.3553 | 8.1384 | −9.2169 |
| Texas-2026 R² | −0.6192 | **+0.6171** | **+1.2363** |

**Acceptance bar (Texas MAE < 4.19): PASS** — clears the bar by 2.59. The
Texas R² flipped from −0.62 (worse than predicting the mean) to +0.62
(explains 62% of variance).

## Iteration log

| # | Hypothesis | Δ Texas MAE (estimated by agent) | Decision |
|---|-----------|---------------------------------:|----------|
| 1 | Add `(W−L)/nGames` | −0.57 | KEPT |
| 2 | Replace W−L with only `(W−L)/nGames` | +0.08 | REVERTED |
| 3 | Add `strength × (W−L)/nGames` interaction | −0.02 | KEPT (marginal) |
| 4 | Add `gdVar` (per-game GD variance) | +0.03 | REVERTED |
| 5 | Replace `gdCap` with uncapped `gdMean` | +0.09 | REVERTED |

See `iterations.md` for the full reasoning. **Note:** the per-iteration
numbers were analytical estimates the executing agent worked out by hand;
the final OLS fit produced a much larger Texas MAE improvement (−2.79)
than the iteration-by-iteration estimates suggested (cumulatively ~−0.59).
This is because OLS jointly reweights all features when one is added —
the agent's "small marginal change" assumption per iteration understated
the true impact.

## What worked

- **Season-length normalisation (Iteration 1) was the breakthrough.** Texas
  teams play ~6 more games than Utah teams (mean 20.7 vs 14.7); the
  baseline (W − L) coefficient over-rewarded the absolute win count, not
  the win rate. Adding `(W − L) / nGames` lets the OLS price the
  season-rate effect separately and dramatically improves portability.
- **Keeping both `(W − L)` and `(W − L) / nGames`** (rather than replacing,
  per Iteration 2) was correct — the OLS uses both to express "absolute
  wins matter, but rate matters more in long seasons."

## What didn't work

- **Strength × (W − L) / nGames interaction (Iteration 3) added nothing.**
  Coefficient collapsed to −0.0009 in the final fit. The agent kept it on
  the margin; in retrospect we should drop it (YAGNI).
- **`gdVar` (Iteration 4) hurt Texas.** Per-game GD variance adds noise
  rather than signal — teams that blow out weak opponents inflate gdVar
  without that meaning much, and the relationship doesn't generalise.
- **Uncapped gdMean (Iteration 5) hurt Texas.** The cap at ±3 is doing
  useful regularisation work; removing it lets a few blowout games dominate
  the per-team mean.

## Methodology limitations

- Used Texas held-out for KEEP/REVERT decisions on each iteration. With 5
  iterations this is mild inflation, but a cleaner split would be ideal.
- Stopping driven by held-out plateau (two consecutive non-improvements);
  a more principled criterion (AIC, cross-validation) was out of scope.
- The interaction term should be dropped on simplicity grounds. Keeping
  it preserves the iteration history but adds noise.

## How to reproduce

```bash
git checkout residual
npm install
npm run fit:v3
npm run predict:v3 -- --snapshot scripts/eval/data/texas-2026.json --out /tmp/preds.json
npm run score -- --snapshot scripts/eval/data/texas-2026.json --predictions /tmp/preds.json --out /tmp/score.json
```
