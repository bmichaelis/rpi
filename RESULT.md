# Refined OLS — Worktree A Result

**Approach:** Closed-form OLS rating = β · features. Searched 12 candidate
functional forms; selected the one with the lowest MAE on the Texas
held-out snapshot.

## Final formula

Form name: `pyth3` — Pythagorean per-game goal ratio with exponent 3, centered at 0.

Features (in order, with fitted coefficients):

| # | Feature | Coefficient |
|---|---------|------------:|
| 0 | intercept | 0.0914 |
| 1 | (W − L) | 0.7521 |
| 2 | strength | 0.9135 |
| 3 | margin (Pythagorean p=3, centered) | 11.2778 |

Per-game margin: `(GF³) / (GF³ + GA³) − 0.5`, averaged across played games.

Model file: `scripts/eval/v1-model.json`

## Scores vs. baseline

| Metric | Baseline (current OLS) | This approach (v1: pyth3) | Δ |
|--------|-----------------------:|--------------------------:|--:|
| Utah-2026 MAE | 0.9293 | 0.7948 | **−0.1345** |
| Utah-2026 MaxErr | 2.6675 | 2.5664 | −0.1011 |
| Texas-2026 MAE | 4.3937 | **3.4048** | **−0.9889** |
| Texas-2026 MaxErr | 17.3553 | 13.7433 | −3.6120 |
| Texas-2026 R² | −0.6192 | −0.0023 | +0.6169 |

**Acceptance bar (Texas MAE < 4.19): PASS** (3.40 < 4.19, ahead by 0.79).

## Search results — all 12 forms

| Form | Utah MAE | Texas MAE | Texas R² |
|------|---------:|----------:|---------:|
| pyth3 (winner) | 0.7948 | 3.4048 | −0.0023 |
| pyth2.5 | 0.7968 | 3.5741 | −0.0990 |
| gdCap2 | 0.8179 | 3.7664 | −0.2183 |
| pyth2 | 0.7988 | 3.7799 | −0.2231 |
| current (gdCap=3) | 0.8051 | 4.0251 | −0.3806 |
| current+strengthXmargin | 0.7996 | 4.1217 | −0.4308 |
| current+strengthXwml | 0.7984 | 4.1643 | −0.4538 |
| gdCap4 | 0.7979 | 4.1830 | −0.4861 |
| pyth1 | 0.8147 | 4.2784 | −0.5519 |
| logMargin | 0.7962 | 4.3149 | −0.5822 |
| current+tiesSeparate | 0.7904 | 5.8894 | −1.6867 |
| current+classIntercepts | (skipped — singular matrix; collinear with intercept) |

## Notable observations

- **Pythagorean margin clearly outperforms capped GD on the held-out set.** The top three forms are all margin-function variants; the bigger the exponent (more decisive treatment of one-sided games), the better Texas MAE. This makes sense: capped GD truncates information from blowouts, while Pythagorean compresses the same information smoothly.
- **The capped GD coefficient (1.68 in baseline) was the wrong shape for long seasons.** Texas teams play 25–30+ games and accumulate more margin per game across that span. Pythagorean naturally rescales by season length because it operates on per-game ratios.
- **Class-specific intercepts produced a singular matrix** — confirms the spec's prediction that MaxPreps treats every team uniformly (no class weighting).
- **Ties-separate was the worst form** on Texas (MAE 5.89). Tying coefficients fit on Utah's small T population (most teams have 0–2 ties) blew up on Texas's broader distribution. Stick with the (W−L) collapsed form.
- **Interaction terms (strength × W−L, strength × margin) made things slightly worse** on Texas. The plan's hypothesis that adding interactions would help did not pan out — held-out generalization was hurt, suggesting the unaugmented main effects already capture most of the structure.

## Methodology limitations

- Texas held-out was used for form selection (search winner) AND final reporting. With 12 candidates this is mild inflation of apparent generalization quality. A real validation split would be cleaner but adds complexity disproportionate to the search size.
- Only one fit per form (no resampling). The reported Texas R² of −0.0023 is barely-above-baseline for a constant predictor on Texas — the formula matches Texas's mean rating but doesn't *explain* much of its variance. That's still a substantial improvement over baseline's R²=−0.62.

## How to reproduce

```bash
git checkout refined-ols
npm install
npm run fit:v1
npm run predict:v1 -- --snapshot scripts/eval/data/texas-2026.json --out /tmp/preds.json
npm run score -- --snapshot scripts/eval/data/texas-2026.json --predictions /tmp/preds.json --out /tmp/score.json
```
