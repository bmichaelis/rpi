#!/usr/bin/env python3
"""
Python implementation of Massey rating fit-v2 for use when npm/node commands are unavailable.
Implements the same algorithm as fit-v2.ts.
"""

import json
import math
import sys
from pathlib import Path

# Change to worktree root for relative paths
import os
os.chdir(Path(__file__).parent.parent.parent)


def solve_ols(X, y):
    """Solve OLS via Gaussian elimination on normal equations."""
    n = len(X)
    if n == 0:
        raise ValueError("Empty design matrix")
    p = len(X[0])
    if len(y) != n:
        raise ValueError(f"Shape mismatch n={n}, |y|={len(y)}")

    # Compute A = X^T X, b = X^T y
    A = [[0.0] * p for _ in range(p)]
    b = [0.0] * p
    for i in range(n):
        for j in range(p):
            b[j] += X[i][j] * y[i]
            for k in range(j + 1):
                A[j][k] += X[i][j] * X[i][k]
    # Symmetrize
    for j in range(p):
        for k in range(j):
            A[k][j] = A[j][k]

    # Augmented matrix [A | b]
    M = [A[i][:] + [b[i]] for i in range(p)]

    # Gaussian elimination with partial pivoting
    for col in range(p):
        pivot = col
        pivot_mag = abs(M[col][col])
        for r in range(col + 1, p):
            mag = abs(M[r][col])
            if mag > pivot_mag:
                pivot = r
                pivot_mag = mag
        if pivot_mag < 1e-12:
            raise ValueError("Singular matrix")
        if pivot != col:
            M[col], M[pivot] = M[pivot], M[col]
        for r in range(col + 1, p):
            factor = M[r][col] / M[col][col]
            for c in range(col, p + 1):
                M[r][c] -= factor * M[col][c]

    # Back-substitute
    x = [0.0] * p
    for i in range(p - 1, -1, -1):
        s = M[i][p]
        for j in range(i + 1, p):
            s -= M[i][j] * x[j]
        x[i] = s / M[i][i]
    return x


def transform_margin(raw, spec):
    """Apply margin transformation."""
    kind = spec["kind"]
    if kind == "binary":
        if raw > 0:
            return 1.0
        elif raw < 0:
            return -1.0
        return 0.0
    elif kind == "cappedGd":
        cap = spec["cap"]
        return max(-cap, min(cap, raw))
    return raw


def solve_massey(games, margin_spec, ridge):
    """Solve Massey rating system."""
    # Collect distinct slugs
    slug_set = set()
    for g in games:
        slug_set.add(g["a"])
        slug_set.add(g["b"])
    slugs = sorted(slug_set)
    idx = {s: i for i, s in enumerate(slugs)}
    n = len(slugs)
    if n == 0:
        return {}

    # Build design matrix and y
    X = []
    y = []
    for g in games:
        row = [0.0] * n
        row[idx[g["a"]]] = 1.0
        row[idx[g["b"]]] = -1.0
        X.append(row)
        y.append(transform_margin(g["marginAOverB"], margin_spec))

    # Sum-zero anchor
    X.append([1.0] * n)
    y.append(0.0)

    # Ridge augmentation
    if ridge > 0:
        sqrt_l = math.sqrt(ridge)
        for i in range(n):
            row = [0.0] * n
            row[i] = sqrt_l
            X.append(row)
            y.append(0.0)

    beta = solve_ols(X, y)
    return {slugs[i]: beta[i] for i in range(n)}


def fit_affine(raw_ratings, official_ratings):
    """Fit affine transform r_official ≈ a*r_raw + b."""
    pairs = []
    for slug, r in raw_ratings.items():
        if slug in official_ratings:
            pairs.append((r, official_ratings[slug]))

    if len(pairs) == 0:
        return {"a": 1.0, "b": 0.0}
    if len(pairs) == 1:
        return {"a": 1.0, "b": pairs[0][1] - pairs[0][0]}

    X = [[1.0, p[0]] for p in pairs]
    y_vals = [p[1] for p in pairs]
    beta = solve_ols(X, y_vals)
    return {"a": beta[1], "b": beta[0]}


def apply_affine(raw_ratings, affine):
    """Apply affine transform to all ratings."""
    a, b = affine["a"], affine["b"]
    return {slug: a * r + b for slug, r in raw_ratings.items()}


def score_predictions(snapshot, predictions):
    """Score predictions against official ratings."""
    pairs = []
    for slug, official in snapshot["officialRatings"].items():
        if slug in predictions:
            pairs.append((predictions[slug], official))

    if not pairs:
        return {"mae": 0, "maxErr": 0, "r2": 0}

    n = len(pairs)
    sum_abs = sum(abs(p - o) for p, o in pairs)
    sum_sq = sum((p - o) ** 2 for p, o in pairs)
    max_err = max(abs(p - o) for p, o in pairs)
    mean_official = sum(o for _, o in pairs) / n
    ss_tot = sum((o - mean_official) ** 2 for _, o in pairs)
    r2 = 1 - sum_sq / ss_tot if ss_tot > 0 else 1.0

    return {
        "mae": sum_abs / n,
        "maxErr": max_err,
        "r2": r2,
    }


def games_from_snapshot(snap):
    """Extract unique games from snapshot."""
    seen = set()
    games = []
    for a_slug, sched in snap["scheduleCache"].items():
        for g in sched["games"]:
            if g["goalsScored"] is None or g["goalsAllowed"] is None:
                continue
            b_slug = g["opponentSlug"]
            key = (a_slug, b_slug) if a_slug < b_slug else (b_slug, a_slug)
            if key in seen:
                continue
            seen.add(key)
            margin = (g["goalsScored"] or 0) - (g["goalsAllowed"] or 0)
            games.append({"a": a_slug, "b": b_slug, "marginAOverB": margin})
    return games


def main():
    # Load snapshots
    with open("scripts/eval/data/utah-2026.json") as f:
        utah = json.load(f)
    with open("scripts/eval/data/texas-2026.json") as f:
        texas = json.load(f)

    utah_games = games_from_snapshot(utah)
    texas_games = games_from_snapshot(texas)
    print(f"Utah games: {len(utah_games)}, Texas games: {len(texas_games)}")

    # Search grid: 4 margin types × 3 ridge values = 12 configs
    margin_specs = [
        {"kind": "binary"},
        {"kind": "cappedGd", "cap": 2},
        {"kind": "cappedGd", "cap": 3},
        {"kind": "cappedGd", "cap": 4},
    ]
    ridges = [0, 0.1, 1.0]

    results = []
    for margin_spec in margin_specs:
        kind = margin_spec["kind"]
        margin_name = "binary" if kind == "binary" else f"gdCap{margin_spec['cap']}"
        for ridge in ridges:
            name = f"{margin_name}_ridge{ridge}"
            try:
                utah_raw = solve_massey(utah_games, margin_spec, ridge)
                texas_raw = solve_massey(texas_games, margin_spec, ridge)
            except ValueError as e:
                print(f"SKIP {name}: {e}")
                continue

            affine = fit_affine(utah_raw, utah["officialRatings"])
            utah_cal = apply_affine(utah_raw, affine)
            texas_cal = apply_affine(texas_raw, affine)

            utah_score = score_predictions(utah, utah_cal)
            texas_score = score_predictions(texas, texas_cal)

            results.append({
                "name": name,
                "margin": margin_spec,
                "ridge": ridge,
                "affine": affine,
                "utah": utah_score,
                "texas": texas_score,
            })

    # Sort by Texas MAE
    results.sort(key=lambda r: r["texas"]["mae"])

    # Print table
    print("\nConfig                    | Affine (a, b)           | Utah MAE | Texas MAE | Texas R²")
    print("--------------------------|-----------------------|----------|-----------|---------")
    for r in results:
        a_str = f"({r['affine']['a']:.4f}, {r['affine']['b']:.4f})"
        print(f"{r['name']:<26}| {a_str:<22}| {r['utah']['mae']:>8.4f} | {r['texas']['mae']:>9.4f} | {r['texas']['r2']:>7.4f}")

    winner = results[0]
    print(f"\nWinner: {winner['name']}  (Texas MAE={winner['texas']['mae']:.4f})")

    # Write model file
    model_data = {
        "configName": winner["name"],
        "margin": winner["margin"],
        "ridge": winner["ridge"],
        "affine": winner["affine"],
        "utah": winner["utah"],
        "texas": winner["texas"],
        "allResults": [{"name": r["name"], "utah": r["utah"], "texas": r["texas"]} for r in results],
    }

    with open("scripts/eval/v2-model.json", "w") as f:
        json.dump(model_data, f, indent=2)
    print("Wrote scripts/eval/v2-model.json")

    return model_data


if __name__ == "__main__":
    main()
