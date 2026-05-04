#!/usr/bin/env python3
"""
Diagnostic script to analyze residuals from the baseline OLS formula.
Computes the same logic as the TypeScript baseline-formula.ts and diagnostics.ts.

Baseline formula:
  rating = 0.0552 + 0.8809*(W-L) + 0.9183*strength + 1.6813*gdCap
  gdCap = mean per-game GD capped at ±3
"""
import json
import math
import sys
import os

# Load snapshots
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
utah_path = os.path.join(base_dir, 'eval', 'data', 'utah-2026.json')
texas_path = os.path.join(base_dir, 'eval', 'data', 'texas-2026.json')

with open(utah_path) as f:
    utah = json.load(f)
with open(texas_path) as f:
    texas = json.load(f)

# Baseline coefficients
INTERCEPT = 0.0552
COEF_WL = 0.8809
COEF_STRENGTH = 0.9183
COEF_GD = 1.6813

def compute_features(schedule, strength):
    """Compute baseline features for a team schedule."""
    played = [g for g in schedule['games']
              if g['goalsScored'] is not None and g['goalsAllowed'] is not None]
    W = sum(1 for g in played if g['won'] == True)
    L = sum(1 for g in played if g['won'] == False)
    T = sum(1 for g in played if g['won'] is None)
    gd_sum = sum(max(-3, min(3, g['goalsScored'] - g['goalsAllowed'])) for g in played)
    gd_cap = gd_sum / len(played) if played else 0
    gd_raw = [(g['goalsScored'] - g['goalsAllowed']) for g in played]
    gd_mean = sum(gd_raw) / len(gd_raw) if gd_raw else 0
    gd_var = (sum((v - gd_mean)**2 for v in gd_raw) / (len(gd_raw) - 1)) if len(gd_raw) > 1 else 0
    gd_max = max(gd_raw) if gd_raw else 0
    gd_min = min(gd_raw) if gd_raw else 0
    n = len(played)
    return {
        'W': W, 'L': L, 'T': T, 'n': n,
        'WL': W - L,
        'wl_norm': (W - L) / n if n > 0 else 0,
        'strength': strength,
        'gd_cap': gd_cap,
        'gd_mean': gd_mean,
        'gd_var': gd_var,
        'gd_max': gd_max,
        'gd_min': gd_min,
        'abs_gd_mean': abs(gd_mean),
        'abs_strength': abs(strength),
        'strength_x_wl': strength * (W - L),
        'strength_x_gd': strength * gd_mean,
        'log1pW': math.log(1 + W),
        'L_sq': L * L,
        'strength_sq': strength ** 2,
        'wl_x_gd': (W - L) * gd_mean,
        'wl_over_n': (W - L) / n if n > 0 else 0,
        'win_rate': W / n if n > 0 else 0,
        'loss_rate': L / n if n > 0 else 0,
    }

def predict_baseline(schedule, strength):
    feats = compute_features(schedule, strength)
    return INTERCEPT + COEF_WL * feats['WL'] + COEF_STRENGTH * feats['strength'] + COEF_GD * feats['gd_cap']

def pearson_r(xs, ys):
    n = len(xs)
    if n < 2:
        return 0
    mx = sum(xs) / n
    my = sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx)**2 for x in xs)
    syy = sum((y - my)**2 for y in ys)
    if sxx == 0 or syy == 0:
        return 0
    return sxy / math.sqrt(sxx * syy)

def analyze_snapshot(snap, name):
    print(f"\n{'='*60}")
    print(f"ANALYSIS: {name}")
    print(f"{'='*60}")

    # Compute predictions and residuals for ranked teams only
    residuals = []
    metrics = {}
    for slug, official in snap['officialRatings'].items():
        sched = snap['scheduleCache'].get(slug)
        if not sched:
            continue
        strength = snap['strengthMap'].get(slug, 0)
        pred = predict_baseline(sched, strength)
        residual = pred - official
        residuals.append({'slug': slug, 'pred': pred, 'official': official, 'residual': residual})
        metrics[slug] = compute_features(sched, strength)

    n = len(residuals)
    mean_res = sum(r['residual'] for r in residuals) / n
    mae = sum(abs(r['residual']) for r in residuals) / n

    print(f"n = {n}")
    print(f"Mean residual = {mean_res:.4f}")
    print(f"MAE = {mae:.4f}")

    # Correlations
    feature_names = [
        'n', 'WL', 'W', 'L', 'T', 'wl_norm', 'win_rate', 'loss_rate',
        'gd_cap', 'gd_mean', 'abs_gd_mean', 'gd_var', 'gd_max', 'gd_min',
        'strength', 'abs_strength', 'strength_sq',
        'strength_x_wl', 'strength_x_gd',
        'log1pW', 'L_sq', 'wl_x_gd',
        'wl_over_n', 'strength_sq',
    ]
    feature_names = list(dict.fromkeys(feature_names))  # deduplicate

    print(f"\nCorrelation of residual with features (sorted by |r|):")
    print(f"{'Feature':<30} {'Pearson r':>10}")
    print(f"{'-'*30} {'-'*10}")

    corr_list = []
    for fname in feature_names:
        xs = [metrics[r['slug']][fname] for r in residuals if fname in metrics[r['slug']]]
        ys = [r['residual'] for r in residuals if fname in metrics[r['slug']]]
        r = pearson_r(xs, ys)
        corr_list.append((fname, r))

    corr_list.sort(key=lambda x: abs(x[1]), reverse=True)
    for fname, r in corr_list:
        print(f"{fname:<30} {r:>10.4f}")

    # By class
    by_class = {}
    for r in residuals:
        cls = snap['scheduleCache'][r['slug']]['classification']
        if cls == 'oos':
            cls = 'OOS'
        else:
            cls = f"{cls}A"
        by_class.setdefault(cls, []).append(r['residual'])

    print(f"\nResiduals by class:")
    for cls in sorted(by_class.keys()):
        arr = by_class[cls]
        mean_r = sum(arr) / len(arr)
        mae_r = sum(abs(x) for x in arr) / len(arr)
        print(f"  {cls}: n={len(arr)}, mean={mean_r:.4f}, MAE={mae_r:.4f}")

    # Top 15 worst residuals
    worst = sorted(residuals, key=lambda r: abs(r['residual']), reverse=True)[:15]
    print(f"\nTop 15 worst |residuals|:")
    for r in worst:
        m = metrics[r['slug']]
        cls = snap['scheduleCache'][r['slug']]['classification']
        if cls == 'oos':
            cls = 'OOS'
        else:
            cls = f"{cls}A"
        print(f"  {r['slug']:<45} pred={r['pred']:7.2f} off={r['official']:7.2f} res={r['residual']:7.2f}"
              f"  [{cls} W={m['W']} L={m['L']} T={m['T']} n={m['n']} "
              f"strength={m['strength']:.2f} gd_mean={m['gd_mean']:.2f}]")

    return residuals, metrics

# Run analysis on Utah (training set)
utah_residuals, utah_metrics = analyze_snapshot(utah, "Utah 2026 (training)")

# Run analysis on Texas (held-out)
texas_residuals, texas_metrics = analyze_snapshot(texas, "Texas 2026 (held-out)")

# Additional: compare season lengths between Utah and Texas
utah_ngames = [utah_metrics[r['slug']]['n'] for r in utah_residuals]
texas_ngames = [texas_metrics[r['slug']]['n'] for r in texas_residuals]
print(f"\n{'='*60}")
print("Season length comparison:")
print(f"Utah:  mean={sum(utah_ngames)/len(utah_ngames):.1f}, min={min(utah_ngames)}, max={max(utah_ngames)}")
print(f"Texas: mean={sum(texas_ngames)/len(texas_ngames):.1f}, min={min(texas_ngames)}, max={max(texas_ngames)}")

# Check strength distribution
utah_str = [utah_metrics[r['slug']]['strength'] for r in utah_residuals]
texas_str = [texas_metrics[r['slug']]['strength'] for r in texas_residuals]
print(f"\nStrength distribution:")
print(f"Utah:  mean={sum(utah_str)/len(utah_str):.2f}, min={min(utah_str):.2f}, max={max(utah_str):.2f}")
print(f"Texas: mean={sum(texas_str)/len(texas_str):.2f}, min={min(texas_str):.2f}, max={max(texas_str):.2f}")

# OLS fit on Utah
def ols_fit(X, y):
    """Simple OLS via normal equations for small systems."""
    n = len(X)
    p = len(X[0])
    # Build X^T X and X^T y
    XtX = [[0.0]*p for _ in range(p)]
    Xty = [0.0]*p
    for i in range(n):
        for j in range(p):
            Xty[j] += X[i][j] * y[i]
            for k in range(p):
                XtX[j][k] += X[i][j] * X[i][k]
    # Gaussian elimination with partial pivoting
    import copy
    M = [XtX[i][:] + [Xty[i]] for i in range(p)]
    for col in range(p):
        # Find pivot
        pivot = col
        for r in range(col+1, p):
            if abs(M[r][col]) > abs(M[pivot][col]):
                pivot = r
        if abs(M[pivot][col]) < 1e-12:
            raise ValueError(f"Singular at column {col}")
        M[col], M[pivot] = M[pivot], M[col]
        for r in range(col+1, p):
            f = M[r][col] / M[col][col]
            for c in range(col, p+1):
                M[r][c] -= f * M[col][c]
    # Back-substitute
    x = [0.0]*p
    for i in range(p-1, -1, -1):
        s = M[i][p]
        for j in range(i+1, p):
            s -= M[i][j] * x[j]
        x[i] = s / M[i][i]
    return x

def fit_and_score(snap, feature_fn, feature_names, dataset_name):
    """Fit OLS on Utah, score on the given dataset."""
    pass

# Now run OLS fits to test hypotheses
print(f"\n{'='*60}")
print("OLS FITS - Testing hypotheses")
print(f"{'='*60}")

def build_dataset(snap):
    X = []
    y = []
    slugs = []
    for slug, official in snap['officialRatings'].items():
        sched = snap['scheduleCache'].get(slug)
        if not sched:
            continue
        strength = snap['strengthMap'].get(slug, 0)
        m = compute_features(sched, strength)
        slugs.append(slug)
        y.append(official)
        X.append(m)
    return slugs, X, y

def predict_with_beta(snap, beta, feature_keys):
    preds = {}
    for slug, sched in snap['scheduleCache'].items():
        strength = snap['strengthMap'].get(slug, 0)
        m = compute_features(sched, strength)
        pred = sum(b * m[k] for b, k in zip(beta, feature_keys))
        preds[slug] = pred
    return preds

def score_preds(preds, official_ratings):
    residuals = []
    for slug, off in official_ratings.items():
        if slug in preds:
            residuals.append(preds[slug] - off)
    n = len(residuals)
    mae = sum(abs(r) for r in residuals) / n
    rmse = math.sqrt(sum(r**2 for r in residuals) / n)
    max_err = max(abs(r) for r in residuals)
    mean_y = sum(official_ratings.values()) / len(official_ratings)
    ss_res = sum(r**2 for r in residuals)
    ss_tot = sum((v - mean_y)**2 for v in official_ratings.values())
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
    return {'n': n, 'mae': mae, 'rmse': rmse, 'max_err': max_err, 'r2': r2}

utah_slugs, utah_X_raw, utah_y = build_dataset(utah)
texas_slugs, texas_X_raw, texas_y = build_dataset(texas)

def run_form(name, keys_with_const):
    """Run an OLS form. keys_with_const is a list of keys; use 'CONST' for intercept."""
    X_train = []
    for m in utah_X_raw:
        row = []
        for k in keys_with_const:
            if k == 'CONST':
                row.append(1.0)
            else:
                row.append(m[k])
        X_train.append(row)
    try:
        beta = ols_fit(X_train, utah_y)
    except ValueError as e:
        print(f"{name:<40} SINGULAR: {e}")
        return None

    # Predict on both snapshots
    def predict_snap(snap):
        preds = {}
        for slug, sched in snap['scheduleCache'].items():
            strength = snap['strengthMap'].get(slug, 0)
            m = compute_features(sched, strength)
            row = [1.0 if k == 'CONST' else m[k] for k in keys_with_const]
            preds[slug] = sum(b * v for b, v in zip(beta, row))
        return preds

    utah_preds = predict_snap(utah)
    texas_preds = predict_snap(texas)
    u_score = score_preds(utah_preds, utah['officialRatings'])
    t_score = score_preds(texas_preds, texas['officialRatings'])

    coef_str = ' '.join(f"{k}={b:.4f}" for k, b in zip(keys_with_const, beta))
    print(f"{name:<45} Utah MAE={u_score['mae']:.4f} Texas MAE={t_score['mae']:.4f} | {coef_str}")
    return {'name': name, 'keys': keys_with_const, 'beta': beta, 'utah': u_score, 'texas': t_score}

# Baseline refit
baseline = run_form("baseline [CONST, WL, strength, gd_cap]",
                    ['CONST', 'WL', 'strength', 'gd_cap'])

# Test hypotheses based on correlations
forms = [
    ("H1a: +wl_norm",        ['CONST', 'WL', 'strength', 'gd_cap', 'wl_norm']),
    ("H1b: wl_norm only (no WL)",['CONST', 'wl_norm', 'strength', 'gd_cap']),
    ("H2a: +gd_var",         ['CONST', 'WL', 'strength', 'gd_cap', 'gd_var']),
    ("H2b: gd_mean instead of gd_cap", ['CONST', 'WL', 'strength', 'gd_mean']),
    ("H3a: +strength_x_wl",  ['CONST', 'WL', 'strength', 'gd_cap', 'strength_x_wl']),
    ("H3b: +strength_sq",    ['CONST', 'WL', 'strength', 'gd_cap', 'strength_sq']),
    ("H4a: +L_sq",           ['CONST', 'WL', 'strength', 'gd_cap', 'L_sq']),
    ("H4b: W and L sep",     ['CONST', 'W', 'L', 'strength', 'gd_cap']),
    ("H5a: +wl_x_gd",        ['CONST', 'WL', 'strength', 'gd_cap', 'wl_x_gd']),
    ("H5b: +abs_strength",   ['CONST', 'WL', 'strength', 'gd_cap', 'abs_strength']),
    ("H6a: +win_rate",       ['CONST', 'WL', 'strength', 'gd_cap', 'win_rate']),
    ("H6b: +loss_rate",      ['CONST', 'WL', 'strength', 'gd_cap', 'loss_rate']),
    ("H7a: +n (season length)", ['CONST', 'WL', 'strength', 'gd_cap', 'n']),
    ("H7b: WL+wl_norm+gd_mean", ['CONST', 'WL', 'wl_norm', 'strength', 'gd_mean']),
    ("H8: wl_norm + strength + gd", ['CONST', 'wl_norm', 'strength', 'gd_cap']),
    ("H9: WL+str+gdcap+str_x_wl+wl_norm", ['CONST', 'WL', 'strength', 'gd_cap', 'strength_x_wl', 'wl_norm']),
    ("H10: WL+str+gd_cap+gd_var+wl_norm", ['CONST', 'WL', 'strength', 'gd_cap', 'gd_var', 'wl_norm']),
]

print(f"\n{'Name':<45} {'Scores'}")
print(f"{'-'*45} {'-'*60}")

results = []
for name, keys in forms:
    r = run_form(name, keys)
    if r:
        results.append(r)

# Sort by Texas MAE
results.sort(key=lambda r: r['texas']['mae'])
print(f"\n{'='*60}")
print("Top 5 forms by Texas MAE:")
for r in results[:5]:
    print(f"  {r['name']:<45} Texas MAE={r['texas']['mae']:.4f} Utah MAE={r['utah']['mae']:.4f}")

best = results[0] if results else None
print(f"\nBest: {best['name'] if best else 'None'}")
print(f"  Keys: {best['keys'] if best else []}")
print(f"  Beta: {best['beta'] if best else []}")
print(f"  Utah MAE: {best['utah']['mae']:.4f} (baseline: {baseline['utah']['mae']:.4f})")
print(f"  Texas MAE: {best['texas']['mae']:.4f} (baseline: {baseline['texas']['mae']:.4f})")
if best:
    print(f"  Texas MAE delta: {best['texas']['mae'] - baseline['texas']['mae']:+.4f}")
