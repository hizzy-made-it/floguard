"""Per-parcel zonal statistics over the parcel polygon (v2), replacing the v1
3x3 window at the centroid.

A 3x3 window at 10 m is 30 m square: on a 0.2 acre lot it straddles the street
and the neighbour, and on a large lot it misses the back yard where water
actually sits. The polygon is the lot.

Partial cells: cell weights are the fraction of each cell inside the polygon
(supersampled `SUPERSAMPLE`x per axis), so a 1 m grid on a 15 m frontage does
not swing with sub-cell boundary placement. Extremes (max TWI, min HAND) are
taken only over cells at least half inside, so a ditch clipped by the lot line
does not decide the parcel.

Yard-only: when a building-footprint layer is supplied, cells under the house
are removed (the slab is built up; the yard is where water stands). If that
leaves fewer than MIN_YARD_M2 of yard, the full lot is used and yard_only is
False for that parcel.
"""

from __future__ import annotations

from . import _affine as A

import math
from dataclasses import dataclass, asdict

import numpy as np
from affine import Affine
from rasterio import features

from .config_v2 import DEPR_MIN_M

SUPERSAMPLE = 4
MIN_YARD_M2 = 20.0
CORE_W = 0.5   # cells at least this much inside count for extremes


@dataclass
class ZonalResult:
    parcel_id: str
    geom_mode: str          # polygon | polygon_partial | centroid
    yard_only: bool
    area_m2: float          # weighted cell area used
    elev_p10_m: float | None
    elev_med_m: float | None
    twi_max: float | None
    twi_awm: float | None
    hand_min_m: float | None
    depr_max_m: float | None
    depr_frac: float | None
    dem_1m_frac: float | None
    dem_res_m: float | None
    hand_area_fraction: float | None = None

    def row(self) -> dict:
        return asdict(self)


def weighted_quantile(values: np.ndarray, weights: np.ndarray, q: float) -> float:
    """Weighted quantile with the 'midpoint of cumulative weight' convention."""
    o = np.argsort(values)
    v = values[o]
    w = weights[o]
    cw = np.cumsum(w) - 0.5 * w
    cw /= w.sum()
    return float(np.interp(q, cw, v))


def coverage(geom, transform: Affine, shape: tuple[int, int], f: int = SUPERSAMPLE) -> np.ndarray:
    """Fraction (0-1) of each cell of a (rows, cols) grid that lies inside geom."""
    if geom is None or geom.is_empty:
        return np.zeros(shape)
    fine_t = A.scale(transform, 1.0 / f)
    fine = features.rasterize([(geom, 1)], out_shape=(shape[0] * f, shape[1] * f),
                              transform=fine_t, fill=0, dtype="uint8", all_touched=False)
    return fine.reshape(shape[0], f, shape[1], f).mean(axis=(1, 3))


def _subwindow(geom, transform: Affine, shape):
    """Row/col slice covering geom's bounds (+1 cell), clipped, and whether it was clipped."""
    minx, miny, maxx, maxy = geom.bounds
    inv = ~transform
    c0, r0 = A.apply(inv, minx, maxy)
    c1, r1 = A.apply(inv, maxx, miny)
    r0, c0 = int(math.floor(min(r0, r1))) - 1, int(math.floor(min(c0, c1))) - 1
    r1, c1 = int(math.ceil(max(r0, r1))) + 2, int(math.ceil(max(c0, c1))) + 2
    clipped = r0 < 0 or c0 < 0 or r1 > shape[0] or c1 > shape[1]
    r0, c0 = max(r0, 0), max(c0, 0)
    r1, c1 = min(r1, shape[0]), min(c1, shape[1])
    return r0, r1, c0, c1, clipped


def zonal_parcel(parcel_id: str, geom, arrays: dict[str, np.ndarray], transform: Affine,
                 footprints=None) -> ZonalResult:
    """Zonal stats for one parcel polygon over window arrays sharing `transform`.

    arrays: elev, twi, hand, depr, srcres (float; NaN = nodata). Any may be missing.
    footprints: shapely geometry (union of building footprints near the parcel) or None.
    """
    shape = next(iter(arrays.values())).shape
    r0, r1, c0, c1, clipped = _subwindow(geom, transform, shape)
    empty = ZonalResult(parcel_id, "none", False, 0.0, *([None] * 9))
    if r1 <= r0 or c1 <= c0:
        return empty
    sub_t = A.translate(transform, c0, r0)
    sub_shape = (r1 - r0, c1 - c0)
    cov = coverage(geom, sub_t, sub_shape)
    sub = {k: np.asarray(a[r0:r1, c0:c1], dtype=np.float64) for k, a in arrays.items()}
    valid = np.isfinite(sub["elev"]) if "elev" in sub else np.ones(sub_shape, bool)
    cell_area = abs(transform.a * transform.e)
    mode = "polygon_partial" if clipped else "polygon"

    yard_only = False
    if footprints is not None and not footprints.is_empty:
        bcov = coverage(footprints.intersection(geom), sub_t, sub_shape)
        yard = np.clip(cov - bcov, 0.0, 1.0)
        if (yard * valid).sum() * cell_area >= MIN_YARD_M2:
            cov = yard
            yard_only = True

    w = cov * valid
    if w.sum() <= 1e-9:
        # Lot smaller than a cell or entirely nodata: fall back to the cell under
        # the representative point.
        pt = geom.representative_point()
        inv = ~sub_t
        cc, rr = A.apply(inv, pt.x, pt.y)
        rr, cc = int(rr), int(cc)
        if not (0 <= rr < sub_shape[0] and 0 <= cc < sub_shape[1]) or not valid[rr, cc]:
            return empty
        w = np.zeros(sub_shape)
        w[rr, cc] = 1.0
        mode = "centroid"

    sel = w > 0
    core = w >= CORE_W
    if not core.any():
        core = sel

    def wq(name, q):
        if name not in sub:
            return None
        v = sub[name][sel]
        ww = w[sel]
        ok = np.isfinite(v)
        if not ok.any():
            return None
        return weighted_quantile(v[ok], ww[ok], q)

    def wmean(name):
        if name not in sub:
            return None
        v = sub[name][sel]
        ww = w[sel]
        ok = np.isfinite(v)
        return float((v[ok] * ww[ok]).sum() / ww[ok].sum()) if ok.any() else None

    def ext(name, fn):
        if name not in sub:
            return None
        v = sub[name][core]
        v = v[np.isfinite(v)]
        return float(fn(v)) if v.size else None

    depr_frac = None
    if "depr" in sub:
        d = sub["depr"][sel]
        ok = np.isfinite(d)
        if ok.any():
            depr_frac = float((w[sel][ok] * (d[ok] >= DEPR_MIN_M)).sum() / w[sel][ok].sum())

    dem_1m_frac = dem_res = None
    if "srcres" in sub:
        s = sub["srcres"][sel]
        ok = np.isfinite(s) & (s > 0)
        if ok.any():
            ww = w[sel][ok]
            dem_1m_frac = float((ww * (s[ok] <= 1.5)).sum() / ww.sum())
            dem_res = 1.0 if dem_1m_frac >= 0.5 else float(np.max(s[ok]))

    return ZonalResult(
        parcel_id=parcel_id, geom_mode=mode, yard_only=yard_only,
        area_m2=float(w.sum() * cell_area),
        elev_p10_m=wq("elev", 0.10), elev_med_m=wq("elev", 0.50),
        twi_max=ext("twi", np.max), twi_awm=wmean("twi"),
        hand_min_m=ext("hand", np.min),
        hand_area_fraction=float(w[np.isfinite(sub["hand"])].sum() / w.sum()) if "hand" in sub else None,
        depr_max_m=ext("depr", np.max), depr_frac=depr_frac,
        dem_1m_frac=dem_1m_frac, dem_res_m=dem_res,
    )
