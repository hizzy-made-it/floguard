"""Per-parcel input-quality confidence (fsi_confidence, 0-1) and the fsi_inputs record.

This is NOT a probability that the parcel floods. It says how much the inputs
behind this parcel's score can be trusted, so the map can grey out parcels
whose number rests on coarse or missing data and reps do not chase them.

    conf = 0.30*dem + 0.15*geom + 0.15*soil + 0.15*cond + 0.25*agree   (then x size factor)

  dem    1.0 if >=90% of the lot is 1 m LiDAR; 0.55 at 10 m; linear between.
         A 10 m cell is larger than most Volusia lots.
  geom   polygon 1.0, polygon clipped at a tile edge 0.8, centroid fallback 0.5.
  soil   SSURGO coverage of the lot (0-1); 0.3 when no soil match.
  cond   hydro-conditioning inputs present for the lot's tile:
         0.5 base + 0.25 NHD flowlines burned + 0.25 culverts or inlets supplied.
         Without culverts a 1 m DEM can invent closed basins behind road fill.
  agree  agreement of 1 m and 10 m results: 1 - mean |percentile rank
         difference| of TWI and HAND. 0.7 when only one resolution exists.
         Large disagreement means the lot sits on sub-10 m features
         (swales, berms) -- or that one of the two is wrong.
  size   x0.8 if the lot has fewer than 9 effective cells (a 1 m lot under
         9 m2 is a sliver; at 10 m most lots are under 9 cells, which the dem
         term already covers, so the factor applies only at 1 m).
"""

from __future__ import annotations

import math

W_CONF = {"dem": 0.30, "geom": 0.15, "soil": 0.15, "cond": 0.15, "agree": 0.25}


def dem_component(dem_1m_frac: float | None) -> float:
    if dem_1m_frac is None or not math.isfinite(dem_1m_frac):
        return 0.0
    f = max(0.0, min(1.0, dem_1m_frac / 0.9))
    return 0.55 + 0.45 * f


def geom_component(mode: str | None) -> float:
    return {"polygon": 1.0, "polygon_partial": 0.8, "centroid": 0.5}.get(mode or "", 0.3)


def soil_component(soil_cov: float | None) -> float:
    if soil_cov is None or not math.isfinite(soil_cov):
        return 0.3
    return max(0.3, min(1.0, soil_cov))


def cond_component(nhd: bool, culverts_or_inlets: bool) -> float:
    return 0.5 + 0.25 * bool(nhd) + 0.25 * bool(culverts_or_inlets)


def agree_component(rank_diffs: list[float | None]) -> float:
    d = [abs(x) for x in rank_diffs if x is not None and math.isfinite(x)]
    if not d:
        return 0.7
    return max(0.0, 1.0 - sum(d) / len(d))


def fsi_confidence(*, dem_1m_frac, geom_mode, soil_cov, nhd, culverts_or_inlets,
                   rank_diffs, area_m2=None, cell_m=1.0) -> float:
    c = (W_CONF["dem"] * dem_component(dem_1m_frac)
         + W_CONF["geom"] * geom_component(geom_mode)
         + W_CONF["soil"] * soil_component(soil_cov)
         + W_CONF["cond"] * cond_component(nhd, culverts_or_inlets)
         + W_CONF["agree"] * agree_component(rank_diffs))
    if area_m2 is not None and cell_m <= 1.0 and area_m2 < 9 * cell_m * cell_m:
        c *= 0.8
    return round(max(0.0, min(1.0, c)), 3)


def fsi_inputs(**kw) -> dict:
    """Compact provenance record for parcel_risk.fsi_inputs (jsonb). Drops Nones."""
    return {k: v for k, v in kw.items() if v is not None}
