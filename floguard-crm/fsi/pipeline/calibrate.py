"""Calibrate FSI weights against outcomes and measure ranking accuracy.

    python -m pipeline.calibrate --parcels parcels.csv --outcomes lead_outcomes.csv \\
        [--proxy proxy_matched.csv] [--target water|won] [--model v1|v2] --out report.json

What it does
  1. Labels: lead_outcomes rows (target 'water' = water_confirmed true/false,
     the terrain question; 'won' = won vs lost, which mixes in sales effects),
     plus optional proxy labels from proxy_labels.py. Proxy files are usually
     positives only (permits, complaints); --background-ratio adds that many
     unlabelled parcels per positive as weighted negatives (presence-background
     design: it estimates relative, not absolute, risk -- fine for ranking).
  2. Features: the model's own normalised terms (0-1, same scale as weights),
     plus API_n / Rain24_n when at least 80% of labels carry them.
  3. Logistic regression, L2 (C=1), class_weight='balanced', sample weights =
     label weights. Evaluated with spatial block cross-validation: folds are
     census tracts (GroupKFold), so a parcel is never scored by a model that
     saw its next-door neighbour -- adjacent lots share terrain and would
     inflate AUC.
  4. Report: out-of-fold AUC and PR-AUC for the fitted model AND for the
     current production weights (the bar to beat), calibration curve, lift by
     decile, and fitted weights mapped back to w1..w6 / alpha.

Mapping to w1..w6 / alpha
  Static terms enter linearly, so w_i = max(beta_i, 0) / sum(max(beta_j, 0)).
  A negative coefficient means the data say that term points the wrong way; it
  is clipped to 0 and listed under sign_conflicts -- review before shipping.
  w5/w6 the same over the dynamic terms. alpha: refit
      logit p = b0 + b1*ln S + b2*ln(0.5 + 0.5 D)
  with S and D from the fitted weights; since ln FSI = ln100 + alpha ln S +
  ln(0.5+0.5D), alpha = b1 / b2 (reported only when b2 > 0).

Minimum sample size (refuses to emit weights below it)
  minority class effective n >= max(30, 10 x n_features), and total effective
  n >= 100. Effective n is min(sum of weights, Kish's (sum w)^2 / sum w^2), so a
  pile of 0.5-weight complaints counts for half as many confirmed site visits.
  Why: the events-per-variable rule (Peduzzi et al. 1996, J Clin Epidemiol
  49:1373) -- below ~10 events per coefficient, logistic coefficients are
  biased and can flip sign; with 7 features that is 70 minority events. The
  30 / 100 floor matches lead_outcomes_readiness() in sql/007. Below the bar
  the report still carries counts and the production-weight baseline AUC, but
  "weights" is null.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

import numpy as np

from . import config as C1
from . import config_v2 as C2

MIN_TOTAL_EFF = 100
MIN_MINORITY_FLOOR = 30
EPV = 10
DYN_MIN_SHARE = 0.8

V1_STATIC = ["twi", "hand_inv", "depr", "soil", "zone"]
V2_STATIC = ["twi", "hand_inv", "depr", "bowl", "soil", "wt", "zone"]
DYN = ["api", "rain24"]
V1_PROD = {"twi": C1.W_TWI, "hand_inv": C1.W_HAND, "depr": C1.W_DEPR, "soil": C1.W_SOIL, "zone": C1.W_ZONE}
V2_PROD = {"twi": C2.W2["twi"], "hand_inv": C2.W2["hand"], "depr": C2.W2["depr"], "bowl": C2.W2["bowl"],
           "soil": C2.W2["soil"], "wt": C2.W2["wt"], "zone": C2.W2["zone"]}
WEIGHT_NAMES = {"twi": "w1_twi", "hand_inv": "w2_hand", "depr": "w_depr", "soil": "w3_soil", "zone": "w4_zone",
                "bowl": "w_bowl", "wt": "w_water_table", "api": "w5_api", "rain24": "w6_rain24"}


def _f(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def features_v1(p: dict) -> dict:
    return {
        "twi": C2.clamp01(_f(p.get("twi_n")) if _f(p.get("twi_n")) is not None else 0.55),
        "hand_inv": 1 - C2.clamp01(_f(p.get("hand_n")) if _f(p.get("hand_n")) is not None else 0.45),
        "depr": C2.clamp01(_f(p.get("depr_n")) or 0.0),
        "soil": C1.hsg_score(p.get("hsg") or None),
        "zone": C1.zone_score(p.get("fema_zone") or None),
    }


def features_v2(p: dict) -> dict:
    t = _f(p.get("twi_v2_n"))
    h = _f(p.get("hand_v2_n"))
    return {
        "twi": C2.clamp01(0.55 if t is None else t),
        "hand_inv": 1 - C2.clamp01(0.45 if h is None else h),
        "depr": C2.clamp01(_f(p.get("depr_v2_n")) or 0.0),
        "bowl": C2.bowl_score(_f(p.get("nbr_rel_m")), _f(p.get("street_rel_m"))),
        "soil": C2.soil_score_v2(p.get("hsg_eff") or None, p.get("drain_class") or None, _f(p.get("ksat_um_s"))),
        "wt": C2.wt_score(_f(p.get("wt_depth_m"))),
        "zone": C1.zone_score(p.get("fema_zone") or None),
    }


def kish(w: np.ndarray) -> float:
    """Effective sample size: min(sum of weights, Kish (sum w)^2 / sum w^2).
    Sum of weights discounts low-trust labels (20 complaints at 0.5 = 10);
    Kish discounts uneven weights (one heavy label among many light ones)."""
    if not len(w) or (w ** 2).sum() <= 0:
        return 0.0
    return float(min(w.sum(), w.sum() ** 2 / (w ** 2).sum()))


def build_labels(parcels: dict[str, dict], outcomes: list[dict], proxies: list[dict], target: str,
                 background_ratio: float, seed: int = 0) -> list[dict]:
    """-> [{parcel_id, y, w, api, rain24, source}] (api/rain24 normalised 0-1 or None)."""
    labs = []
    for o in outcomes:
        pid = (o.get("parcel_id") or "").strip()
        if not pid or pid not in parcels:
            continue
        if target == "water":
            wc = (o.get("water_confirmed") or "").strip().lower()
            if wc not in ("true", "t", "1", "false", "f", "0"):
                continue
            y = 1 if wc in ("true", "t", "1") else 0
        else:
            oc = (o.get("outcome") or "").strip().lower()
            if oc not in ("won", "lost"):
                continue
            y = 1 if oc == "won" else 0
        api = _f(o.get("api_at"))
        r24 = _f(o.get("rain_24h_at"))
        labs.append({"parcel_id": pid, "y": y, "w": 1.0, "source": "lead_outcomes",
                     "api": None if api is None else C2.clamp01(api / 150.0),
                     "rain24": None if r24 is None else C2.clamp01(r24 / 75.0)})
    pos_proxy = 0.0
    for p in proxies:
        pid = (p.get("parcel_id") or "").strip()
        if pid not in parcels:
            continue
        w = _f(p.get("weight"))
        y = int(_f(p.get("label")) or 0)
        labs.append({"parcel_id": pid, "y": y, "w": 1.0 if w is None else w,
                     "source": p.get("label_source") or "proxy", "api": None, "rain24": None})
        pos_proxy += (1.0 if w is None else w) * y
    if background_ratio > 0 and pos_proxy > 0:
        rng = np.random.default_rng(seed)
        labelled = {l["parcel_id"] for l in labs}
        pool = [k for k in parcels if k not in labelled]
        n = min(len(pool), int(round(background_ratio * sum(1 for l in labs if l["y"] == 1 and l["source"] != "lead_outcomes"))))
        for pid in rng.choice(pool, size=n, replace=False) if n else []:
            labs.append({"parcel_id": str(pid), "y": 0, "w": 1.0, "source": "background", "api": None, "rain24": None})
    return labs


def _group(p: dict) -> str:
    t = (p.get("census_tract") or "").strip()
    if t:
        return t
    lat, lon = _f(p.get("lat")), _f(p.get("lon"))
    if lat is not None and lon is not None:
        return f"g{int(lat // 0.02)}_{int(lon // 0.02)}"
    return (p.get("zip") or "nogroup").strip()


def lift_by_decile(y, s, w):
    o = np.argsort(-s, kind="stable")
    y, w = y[o], w[o]
    base = (y * w).sum() / w.sum()
    out = []
    for k, idx in enumerate(np.array_split(np.arange(len(y)), 10)):
        if not len(idx):
            continue
        rate = (y[idx] * w[idx]).sum() / w[idx].sum()
        out.append({"decile": k + 1, "n": int(len(idx)), "rate": round(float(rate), 4),
                    "lift": round(float(rate / base), 3) if base > 0 else None})
    return out


def calibrate(parcels: dict[str, dict], labels: list[dict], model: str = "v1", n_splits: int = 5,
              C: float = 1.0) -> dict:
    from sklearn.calibration import calibration_curve
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import average_precision_score, roc_auc_score
    from sklearn.model_selection import GroupKFold

    feat_fn = features_v1 if model == "v1" else features_v2
    static = V1_STATIC if model == "v1" else V2_STATIC
    prod = V1_PROD if model == "v1" else V2_PROD
    dyn_share = np.mean([l["api"] is not None and l["rain24"] is not None for l in labels]) if labels else 0
    use_dyn = dyn_share >= DYN_MIN_SHARE
    names = static + (DYN if use_dyn else [])
    rows = []
    for l in labels:
        f = feat_fn(parcels[l["parcel_id"]])
        if use_dyn:
            f["api"] = 0.5 if l["api"] is None else l["api"]
            f["rain24"] = 0.5 if l["rain24"] is None else l["rain24"]
        rows.append([f[n] for n in names])
    X = np.array(rows, dtype=float).reshape(-1, len(names))
    y = np.array([l["y"] for l in labels], dtype=int)
    w = np.array([l["w"] for l in labels], dtype=float)
    g = np.array([_group(parcels[l["parcel_id"]]) for l in labels])

    n_pos_eff, n_neg_eff = kish(w[y == 1]), kish(w[y == 0])
    need_minority = max(MIN_MINORITY_FLOOR, EPV * len(names))
    counts = {"labels": int(len(y)), "positives": int(y.sum()), "negatives": int((1 - y).sum()),
              "effective_pos": round(n_pos_eff, 1), "effective_neg": round(n_neg_eff, 1),
              "groups": int(len(set(g))), "features": names, "dynamic_used": bool(use_dyn),
              "sources": {s: int(sum(1 for l in labels if l["source"] == s)) for s in sorted({l["source"] for l in labels})}}
    thresholds = {"min_total_effective": MIN_TOTAL_EFF, "min_minority_effective": need_minority,
                  "rule": "events-per-variable >= 10 (Peduzzi 1996); floor 30/100 as sql/007 readiness"}
    report = {"model": model, "counts": counts, "thresholds": thresholds,
              "production_weights": {WEIGHT_NAMES[k]: v for k, v in prod.items()}}

    prod_score = X[:, :len(static)] @ np.array([prod[n] for n in static])
    if use_dyn:
        d = 0.6 * X[:, names.index("api")] + 0.4 * X[:, names.index("rain24")]
        prod_score = prod_score * (0.5 + 0.5 * d)
    if y.min() != y.max():
        report["baseline_production"] = {
            "auc": round(float(roc_auc_score(y, prod_score, sample_weight=w)), 4),
            "pr_auc": round(float(average_precision_score(y, prod_score, sample_weight=w)), 4),
        }

    enough = (n_pos_eff + n_neg_eff) >= MIN_TOTAL_EFF and min(n_pos_eff, n_neg_eff) >= need_minority
    k = min(n_splits, len(set(g)))
    if not enough or k < 2:
        report["weights"] = None
        report["refused"] = (f"not enough labels: effective pos {n_pos_eff:.0f} / neg {n_neg_eff:.0f}, "
                             f"need minority >= {need_minority} and total >= {MIN_TOTAL_EFF}"
                             + ("" if k >= 2 else "; fewer than 2 spatial groups"))
        return report

    oof = np.zeros(len(y))
    for tr, te in GroupKFold(n_splits=k).split(X, y, g):
        assert not set(g[tr]) & set(g[te])
        m = LogisticRegression(C=C, class_weight="balanced", max_iter=2000)
        m.fit(X[tr], y[tr], sample_weight=w[tr])
        oof[te] = m.predict_proba(X[te])[:, 1]
    frac_pos, mean_pred = calibration_curve(y, oof, n_bins=10, strategy="quantile")
    report["cv"] = {
        "scheme": f"GroupKFold({k}) by census tract (spatial blocks)",
        "auc": round(float(roc_auc_score(y, oof, sample_weight=w)), 4),
        "pr_auc": round(float(average_precision_score(y, oof, sample_weight=w)), 4),
        "base_rate": round(float((y * w).sum() / w.sum()), 4),
        "calibration_curve": [{"mean_pred": round(float(a), 4), "frac_pos": round(float(b), 4)}
                              for a, b in zip(mean_pred, frac_pos)],
        "lift_by_decile": lift_by_decile(y, oof, w),
        "baseline_lift_by_decile": lift_by_decile(y, prod_score, w),
        "note": "class_weight='balanced' shifts predicted probabilities; read the curve for ranking shape, "
                "not absolute rates",
    }

    m = LogisticRegression(C=C, class_weight="balanced", max_iter=2000)
    m.fit(X, y, sample_weight=w)
    beta = dict(zip(names, m.coef_[0].tolist()))
    pos = {n: max(beta[n], 0.0) for n in static}
    tot = sum(pos.values())
    weights = {WEIGHT_NAMES[n]: round(pos[n] / tot, 4) if tot > 0 else None for n in static}
    conflicts = [n for n in names if beta[n] < 0]
    alpha = None
    if use_dyn:
        dp = {n: max(beta[n], 0.0) for n in DYN}
        dt = sum(dp.values())
        for n in DYN:
            weights[WEIGHT_NAMES[n]] = round(dp[n] / dt, 4) if dt > 0 else None
        if tot > 0 and dt > 0:
            S = X[:, :len(static)] @ np.array([pos[n] / tot for n in static])
            D = sum(X[:, names.index(n)] * dp[n] / dt for n in DYN)
            Z = np.column_stack([np.log(np.maximum(S, 1e-6)), np.log(0.5 + 0.5 * D)])
            m2 = LogisticRegression(C=C, class_weight="balanced", max_iter=2000).fit(Z, y, sample_weight=w)
            b1, b2 = m2.coef_[0]
            alpha = round(float(b1 / b2), 3) if b2 > 0 else None
    weights["alpha"] = alpha
    report["coefficients"] = {n: round(v, 4) for n, v in beta.items()}
    report["intercept"] = round(float(m.intercept_[0]), 4)
    report["weights"] = weights
    report["sign_conflicts"] = conflicts
    beats = report["cv"]["auc"] > report.get("baseline_production", {}).get("auc", 0)
    report["recommendation"] = ("fitted weights beat production out-of-fold; review sign_conflicts, then "
                                "update config / sql / fsi-score.mjs together") if beats else \
        "fitted weights do not beat production out-of-fold; keep production weights"
    return report


def read_csv(path: Path | None) -> list[dict]:
    if not path:
        return []
    with Path(path).open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parcels", type=Path, required=True)
    ap.add_argument("--outcomes", type=Path)
    ap.add_argument("--proxy", type=Path)
    ap.add_argument("--target", choices=["water", "won"], default="water")
    ap.add_argument("--model", choices=["v1", "v2"], default="v1")
    ap.add_argument("--background-ratio", type=float, default=0.0)
    ap.add_argument("--C", type=float, default=1.0)
    ap.add_argument("--out", type=Path, default=Path("calibration_report.json"))
    a = ap.parse_args()
    parcels = {r["parcel_id"]: r for r in read_csv(a.parcels)}
    labels = build_labels(parcels, read_csv(a.outcomes), read_csv(a.proxy), a.target, a.background_ratio)
    rep = calibrate(parcels, labels, a.model, C=a.C)
    a.out.write_text(json.dumps(rep, indent=1))
    print(json.dumps({k: rep.get(k) for k in ("counts", "refused", "baseline_production", "weights")}, indent=1))
    if rep.get("cv"):
        print(f"CV AUC {rep['cv']['auc']}  PR-AUC {rep['cv']['pr_auc']}  -> {a.out}")


if __name__ == "__main__":
    main()
