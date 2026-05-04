#!/usr/bin/env python3
"""
Standalone OLS fit for MaxPreps rating reproduction.
Reads utah-2026.json and texas-2026.json, fits 12 candidate forms,
and outputs results.
"""
import json
import math
import sys
import os

# Paths relative to worktree root
WORKTREE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UTAH_PATH = os.path.join(WORKTREE, "scripts/eval/data/utah-2026.json")
TEXAS_PATH = os.path.join(WORKTREE, "scripts/eval/data/texas-2026.json")
MODEL_OUTPUT = os.path.join(WORKTREE, "scripts/eval/v1-model.json")

def load_snapshot(path):
    with open(path) as f:
        return json.load(f)

def avg_margin(played_games, spec):
    if not played_games:
        return 0.0
    margins = []
    for g in played_games:
        gf = g.get("goalsScored") or 0
        ga = g.get("goalsAllowed") or 0
        kind = spec["kind"]
        if kind == "cappedGd":
            cap = spec["cap"]
            gd = gf - ga
            margins.append(max(-cap, min(cap, gd)))
        elif kind == "pythagorean":
            e = spec["exponent"]
            num = gf ** e
            den = (gf ** e) + (ga ** e)
            margins.append(0.0 if den == 0 else num / den - 0.5)
        elif kind == "log":
            margins.append(math.log(1 + gf) - math.log(1 + ga))
    return sum(margins) / len(margins)

CLASS_LABELS = ["4A", "5A", "6A", "OOS"]

def class_label(cls):
    if cls == "oos":
        return "OOS"
    return f"{cls}A"

def extract_features(schedule, spec, strength):
    played = [g for g in schedule["games"] if g.get("goalsScored") is not None and g.get("goalsAllowed") is not None]
    W = sum(1 for g in played if g["won"] is True)
    L = sum(1 for g in played if g["won"] is False)
    T = sum(1 for g in played if g["won"] is None)

    features = []

    if spec["classIntercepts"]:
        cls = class_label(schedule["classification"])
        for c in CLASS_LABELS:
            features.append(1 if c == cls else 0)
    elif spec["intercept"]:
        features.append(1)

    if spec["tiesSeparate"]:
        features.extend([W, L, T])
    else:
        features.append(W - L)

    if spec["strength"]:
        features.append(strength)

    margin = avg_margin(played, spec["margin"])
    features.append(margin)

    for inter in spec.get("interactions", []):
        if inter == "strengthTimesWinLoss":
            features.append(strength * (W - L))
        elif inter == "strengthTimesMargin":
            features.append(strength * margin)

    return features

def solve_ols(X, y):
    n = len(X)
    p = len(X[0])
    assert len(y) == n, f"shape mismatch n={n} |y|={len(y)}"

    # A = X^T X, b = X^T y
    A = [[0.0]*p for _ in range(p)]
    b = [0.0]*p
    for i in range(n):
        for j in range(p):
            b[j] += X[i][j] * y[i]
            for k in range(j+1):
                A[j][k] += X[i][j] * X[i][k]
    for j in range(p):
        for k in range(j):
            A[k][j] = A[j][k]

    # Gaussian elimination with partial pivoting
    M = [A[r][:] + [b[r]] for r in range(p)]
    for col in range(p):
        pivot = col
        pivot_mag = abs(M[col][col])
        for r in range(col+1, p):
            mag = abs(M[r][col])
            if mag > pivot_mag:
                pivot = r
                pivot_mag = mag
        if pivot_mag < 1e-12:
            raise ValueError(f"singular matrix at col {col}")
        if pivot != col:
            M[col], M[pivot] = M[pivot], M[col]
        for r in range(col+1, p):
            factor = M[r][col] / M[col][col]
            for c in range(col, p+1):
                M[r][c] -= factor * M[col][c]

    x = [0.0]*p
    for i in range(p-1, -1, -1):
        s = M[i][p]
        for j in range(i+1, p):
            s -= M[i][j] * x[j]
        x[i] = s / M[i][i]
    return x

def score_preds(snap, predictions):
    pairs = []
    for slug, official in snap["officialRatings"].items():
        pred = predictions.get(slug)
        if pred is None:
            continue
        pairs.append((pred, official))
    if not pairs:
        return {"mae": 0, "maxErr": 0, "r2": 0}
    n = len(pairs)
    sum_abs = sum(abs(p - o) for p, o in pairs)
    sum_sq = sum((p - o)**2 for p, o in pairs)
    max_err = max(abs(p - o) for p, o in pairs)
    mean_off = sum(o for _, o in pairs) / n
    ss_tot = sum((o - mean_off)**2 for _, o in pairs)
    r2 = 1 - sum_sq / ss_tot if ss_tot != 0 else 1.0
    return {"mae": sum_abs / n, "maxErr": max_err, "r2": r2}

CANDIDATE_FORMS = [
    {"name": "current", "intercept": True, "margin": {"kind": "cappedGd", "cap": 3}, "strength": True, "tiesSeparate": False, "classIntercepts": False, "interactions": []},
    {"name": "gdCap2", "intercept": True, "margin": {"kind": "cappedGd", "cap": 2}, "strength": True, "tiesSeparate": False, "classIntercepts": False, "interactions": []},
    {"name": "gdCap4", "intercept": True, "margin": {"kind": "cappedGd", "cap": 4}, "strength": True, "tiesSeparate": False, "classIntercepts": False, "interactions": []},
    {"name": "pyth1", "intercept": True, "margin": {"kind": "pythagorean", "exponent": 1}, "strength": True, "tiesSeparate": False, "classIntercepts": False, "interactions": []},
    {"name": "pyth2", "intercept": True, "margin": {"kind": "pythagorean", "exponent": 2}, "strength": True, "tiesSeparate": False, "classIntercepts": False, "interactions": []},
    {"name": "pyth2.5", "intercept": True, "margin": {"kind": "pythagorean", "exponent": 2.5}, "strength": True, "tiesSeparate": False, "classIntercepts": False, "interactions": []},
    {"name": "pyth3", "intercept": True, "margin": {"kind": "pythagorean", "exponent": 3}, "strength": True, "tiesSeparate": False, "classIntercepts": False, "interactions": []},
    {"name": "logMargin", "intercept": True, "margin": {"kind": "log"}, "strength": True, "tiesSeparate": False, "classIntercepts": False, "interactions": []},
    {"name": "current+strengthXwml", "intercept": True, "margin": {"kind": "cappedGd", "cap": 3}, "strength": True, "tiesSeparate": False, "classIntercepts": False, "interactions": ["strengthTimesWinLoss"]},
    {"name": "current+strengthXmargin", "intercept": True, "margin": {"kind": "cappedGd", "cap": 3}, "strength": True, "tiesSeparate": False, "classIntercepts": False, "interactions": ["strengthTimesMargin"]},
    {"name": "current+classIntercepts", "intercept": False, "margin": {"kind": "cappedGd", "cap": 3}, "strength": True, "tiesSeparate": False, "classIntercepts": True, "interactions": []},
    {"name": "current+tiesSeparate", "intercept": True, "margin": {"kind": "cappedGd", "cap": 3}, "strength": True, "tiesSeparate": True, "classIntercepts": False, "interactions": []},
]

def build_design_matrix(snap, spec):
    slugs, X, y = [], [], []
    for slug, official in snap["officialRatings"].items():
        sched = snap["scheduleCache"].get(slug)
        if not sched:
            continue
        strength = snap["strengthMap"].get(slug)
        if strength is None:
            continue
        slugs.append(slug)
        X.append(extract_features(sched, spec, strength))
        y.append(official)
    return slugs, X, y

def predict_all(snap, spec, beta):
    out = {}
    for slug, sched in snap["scheduleCache"].items():
        strength = snap["strengthMap"].get(slug, 0.0)
        feats = extract_features(sched, spec, strength)
        pred = sum(beta[i] * feats[i] for i in range(len(feats)))
        out[slug] = pred
    return out

def main():
    print("Loading snapshots...")
    utah = load_snapshot(UTAH_PATH)
    texas = load_snapshot(TEXAS_PATH)
    print(f"Utah: {len(utah['officialRatings'])} ranked teams, {len(utah['scheduleCache'])} in cache")
    print(f"Texas: {len(texas['officialRatings'])} ranked teams, {len(texas['scheduleCache'])} in cache")

    results = []
    for spec in CANDIDATE_FORMS:
        _, X, y = build_design_matrix(utah, spec)
        try:
            beta = solve_ols(X, y)
        except Exception as e:
            print(f"SKIP {spec['name']}: {e}")
            continue
        utah_preds = predict_all(utah, spec, beta)
        texas_preds = predict_all(texas, spec, beta)
        us = score_preds(utah, utah_preds)
        ts = score_preds(texas, texas_preds)
        results.append({
            "formName": spec["name"],
            "spec": spec,
            "coefficients": beta,
            "utah": us,
            "texas": ts,
        })

    results.sort(key=lambda r: r["texas"]["mae"])

    print()
    print(f"{'Form':<32}| {'Utah MAE':>8} | {'Utah MaxErr':>11} | {'Texas MAE':>9} | {'Texas MaxErr':>12} | {'Texas R2':>8}")
    print("-"*32 + "|" + "-"*10 + "|" + "-"*13 + "|" + "-"*11 + "|" + "-"*14 + "|" + "-"*10)
    for r in results:
        print(f"{r['formName']:<32}| {r['utah']['mae']:>8.4f} | {r['utah']['maxErr']:>11.4f} | {r['texas']['mae']:>9.4f} | {r['texas']['maxErr']:>12.4f} | {r['texas']['r2']:>8.4f}")

    winner = results[0]
    print(f"\nWinner: {winner['formName']}  (Texas MAE={winner['texas']['mae']:.4f})")
    print(f"Coefficients: {[round(c, 6) for c in winner['coefficients']]}")
    print(f"Utah: MAE={winner['utah']['mae']:.4f}, MaxErr={winner['utah']['maxErr']:.4f}")
    print(f"Texas: MAE={winner['texas']['mae']:.4f}, MaxErr={winner['texas']['maxErr']:.4f}, R2={winner['texas']['r2']:.4f}")

    # Write model JSON
    model_data = {
        "formName": winner["formName"],
        "spec": winner["spec"],
        "coefficients": winner["coefficients"],
        "utah": winner["utah"],
        "texas": winner["texas"],
        "allResults": [{"formName": r["formName"], "utah": r["utah"], "texas": r["texas"]} for r in results]
    }
    with open(MODEL_OUTPUT, "w") as f:
        json.dump(model_data, f, indent=2)
    print(f"\nWrote {MODEL_OUTPUT}")

if __name__ == "__main__":
    main()
