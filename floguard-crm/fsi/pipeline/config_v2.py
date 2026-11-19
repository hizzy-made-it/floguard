"""Terrain v2 static score. Mirrored in SQL by fsi/sql/018 fsi_static_v2_expr().

v1 (config.py) stays the default. v2 is used only when a parcel has v2 terms
(terrain_v2_at is set) AND the database setting fsi_model_version = 'v2'.

    S2 = 0.20*TWI2_n + 0.15*(1-HAND2_n) + 0.15*DEPR2_n + 0.15*BOWL_n
       + 0.10*SOIL2  + 0.10*WT_n      + 0.15*Z

Same caveat as v1: literature-informed defaults, not calibrated. calibrate.py
replaces them once enough labels exist; until then this is a ranking, not a
measurement, and never an inspection result.
"""

from __future__ import annotations

import math

from .config import FEMA_ZONE_DEFAULT, HSG_DEFAULT, HSG_SCORE, zone_score

MODEL_VERSION = "v2"

W2 = {
    "twi": 0.20,
    "hand": 0.15,
    "depr": 0.15,
    "bowl": 0.15,
    "soil": 0.10,
    "wt": 0.10,
    "zone": 0.15,
}

# --- neighbour-relative ("bowl among neighbours") ---
# rel = lot median elevation minus neighbours / street. Negative = lower.
BOWL_FULL_M = 0.6      # 0.6 m below the neighbourhood is the top of the scale
BOWL_W_NBR = 0.6       # weight of the parcel-neighbour comparison vs the street
BOWL_DEFAULT = 0.2     # unknown: modest, about the county median of a level lot

# --- seasonal high water table ---
WT_FULL_M = 2.0        # 0 m -> 1.0, >= 2 m -> 0.0 (SSURGO reports to 200 cm)
WT_DEFAULT = 0.5

# --- soil ---
SOIL_DEFAULT = HSG_DEFAULT
DRAIN_CLASS_SCORE = {
    "VERY POORLY DRAINED": 1.0,
    "POORLY DRAINED": 0.85,
    "SOMEWHAT POORLY DRAINED": 0.65,
    "MODERATELY WELL DRAINED": 0.4,
    "WELL DRAINED": 0.2,
    "SOMEWHAT EXCESSIVELY DRAINED": 0.1,
    "EXCESSIVELY DRAINED": 0.05,
}

# --- closed basin (v2: depth AND how much of the lot is in it) ---
DEPR_FULL_M = 1.0
DEPR_W_DEPTH = 0.6
DEPR_MIN_M = 0.10      # cells shallower than this do not count toward depr_frac: 3DEP QL2 LiDAR
                       # is specified at <= 10 cm RMSEz, so shallower "bowls" are not distinguishable
                       # from noise (the 2026-11-19 pilot flagged 17-35% of 1 m cells at 5 cm)


def clamp01(x: float) -> float:
    if x is None or not math.isfinite(x):
        return 0.0
    return max(0.0, min(1.0, x))


def hsg_effective(hsg: str | None, drained: bool = False) -> tuple[str | None, bool]:
    """Resolve SSURGO dual hydrologic groups.

    NRCS assigns A/D, B/D, C/D to soils whose seasonal high water table is
    within 60 cm (NEH Part 630 ch. 7). The first letter applies only when the
    soil is artificially drained; the D applies in its natural state. Volusia's
    flatwoods soils (Myakka, Immokalee, Smyrna, Pomona) are mostly A/D or B/D
    and sit under ordinary residential yards with no tile drainage, so the
    undrained D is the honest default. Pass drained=True only where artificial
    drainage is actually known (e.g. a parcel inside a mapped drainage district
    with working underdrains).

    Returns (effective single group or None, was_dual).
    """
    if not hsg:
        return None, False
    k = hsg.strip().upper().replace(" ", "")
    if "/" in k:
        first, second = k.split("/", 1)
        return (first if drained else second), True
    return k, False


def drain_class_score(dc: str | None) -> float | None:
    if not dc:
        return None
    return DRAIN_CLASS_SCORE.get(dc.strip().upper())


def ksat_score(ksat_um_s: float | None) -> float | None:
    """Saturated hydraulic conductivity (um/s, SSURGO ksat_r) -> 0-1 risk.
    log-linear: <= 1 um/s -> 1.0 (water stays), >= 100 um/s -> 0.0 (sand drains)."""
    if ksat_um_s is None or not math.isfinite(ksat_um_s):
        return None
    if ksat_um_s <= 0:
        return 1.0
    return clamp01((2.0 - math.log10(ksat_um_s)) / 2.0)


def soil_score_v2(hsg_eff: str | None, drain_class: str | None, ksat_um_s: float | None) -> float:
    parts = []
    if hsg_eff and hsg_eff.upper() in HSG_SCORE:
        parts.append(HSG_SCORE[hsg_eff.upper()])
    d = drain_class_score(drain_class)
    if d is not None:
        parts.append(d)
    k = ksat_score(ksat_um_s)
    if k is not None:
        parts.append(k)
    return sum(parts) / len(parts) if parts else SOIL_DEFAULT


def bowl_score(nbr_rel_m: float | None, street_rel_m: float | None) -> float:
    have_n = nbr_rel_m is not None and math.isfinite(nbr_rel_m)
    have_s = street_rel_m is not None and math.isfinite(street_rel_m)
    if have_n and have_s:
        rel = BOWL_W_NBR * nbr_rel_m + (1 - BOWL_W_NBR) * street_rel_m
    elif have_n:
        rel = nbr_rel_m
    elif have_s:
        rel = street_rel_m
    else:
        return BOWL_DEFAULT
    return clamp01(-rel / BOWL_FULL_M)


def wt_score(wt_depth_m: float | None) -> float:
    if wt_depth_m is None or not math.isfinite(wt_depth_m):
        return WT_DEFAULT
    return clamp01(1.0 - wt_depth_m / WT_FULL_M)


def depr_v2_n(depr_max_m: float | None, depr_frac: float | None) -> float:
    dm = 0.0 if depr_max_m is None or not math.isfinite(depr_max_m) else depr_max_m
    fr = 0.0 if depr_frac is None or not math.isfinite(depr_frac) else depr_frac
    return clamp01(DEPR_W_DEPTH * min(dm / DEPR_FULL_M, 1.0) + (1 - DEPR_W_DEPTH) * clamp01(fr))


def static_score_v2(twi_n, hand_n, depr_n, nbr_rel_m, street_rel_m, hsg_eff, drain_class,
                    ksat_um_s, wt_depth_m, zone) -> float:
    """Mirror of SQL fsi_static_v2_expr(). Rounded to 4 dp like the SQL."""
    def nz(v, d):
        return d if v is None or not math.isfinite(v) else v

    s = (
        W2["twi"] * clamp01(nz(twi_n, 0.55))
        + W2["hand"] * (1.0 - clamp01(nz(hand_n, 0.45)))
        + W2["depr"] * clamp01(nz(depr_n, 0.0))
        + W2["bowl"] * bowl_score(nbr_rel_m, street_rel_m)
        + W2["soil"] * soil_score_v2(hsg_eff, drain_class, ksat_um_s)
        + W2["wt"] * wt_score(wt_depth_m)
        + W2["zone"] * (zone_score(zone) if zone else FEMA_ZONE_DEFAULT)
    )
    return round(s, 4)
