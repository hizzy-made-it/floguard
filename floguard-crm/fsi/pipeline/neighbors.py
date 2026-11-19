"""Neighbour-relative elevation: is this lot a bowl among its neighbours?

Absolute elevation predicts nothing (spec section 1); what floods a yard is
being lower than the ground around it. Two comparisons, both on the lot's
median elevation from zonal.py:

  nbr_rel_m     lot median - median of the lot medians of parcels within
                NBR_RADIUS_M of the lot boundary (self excluded). Needs at
                least MIN_NEIGHBOURS neighbours.
  street_rel_m  lot median - median elevation of the adjacent street centreline,
                sampled every STREET_SPACING_M along the road and kept only
                within STREET_RADIUS_M of the lot and within STREET_BAND_M of
                the nearest road point (the frontage, not the road behind).

Negative = the lot sits below its surroundings. Street crowns in Volusia are
typically 0.1-0.3 m above the yard by design, so a small negative street_rel_m
is normal; the bowl signal is a lot that is lower than BOTH the street and the
neighbours.
"""

from __future__ import annotations

from . import _affine as A

import numpy as np
import shapely
from scipy.spatial import cKDTree

NBR_RADIUS_M = 30.0
MIN_NEIGHBOURS = 2
STREET_RADIUS_M = 35.0
STREET_BAND_M = 10.0
STREET_SPACING_M = 2.0
MIN_STREET_POINTS = 3


def sample_lines(lines, spacing: float = STREET_SPACING_M) -> np.ndarray:
    """Points every `spacing` metres along each line. Returns (n, 2) x,y."""
    pts = []
    for ln in lines:
        if ln is None or ln.is_empty:
            continue
        for part in getattr(ln, "geoms", [ln]):
            L = part.length
            if L <= 0:
                continue
            d = np.arange(0.0, L + 1e-9, spacing)
            p = shapely.line_interpolate_point(part, d)
            pts.append(np.column_stack([shapely.get_x(p), shapely.get_y(p)]))
    return np.vstack(pts) if pts else np.zeros((0, 2))


def sample_raster(xy: np.ndarray, arr: np.ndarray, transform) -> np.ndarray:
    """Nearest-cell values at points; NaN outside the array."""
    inv = ~transform
    out = np.full(len(xy), np.nan)
    if not len(xy):
        return out
    cols, rows = A.apply(inv, xy[:, 0], xy[:, 1])
    rows = np.floor(rows).astype(int)
    cols = np.floor(cols).astype(int)
    ok = (rows >= 0) & (cols >= 0) & (rows < arr.shape[0]) & (cols < arr.shape[1])
    out[ok] = arr[rows[ok], cols[ok]]
    return out


def neighbour_relative(parcel_ids, geoms, elev_med, street_xyz: np.ndarray | None = None,
                       radius: float = NBR_RADIUS_M) -> dict[str, dict]:
    """Compute nbr_rel_m, nbr_count, street_rel_m, street_n for every parcel.

    geoms: shapely polygons in a metric CRS; elev_med: per-parcel lot medians
    (NaN where unknown); street_xyz: (n, 3) sampled street points with elevation.
    """
    geoms = np.asarray(geoms, dtype=object)
    em = np.asarray(elev_med, dtype=np.float64)
    tree = shapely.STRtree(geoms)
    buffered = shapely.buffer(geoms, radius)
    src, dst = tree.query(buffered, predicate="intersects")
    out: dict[str, dict] = {}
    nbr_vals: dict[int, list] = {}
    for s, d in zip(src, dst):
        if s == d or not np.isfinite(em[d]):
            continue
        nbr_vals.setdefault(int(s), []).append(em[d])

    kd = None
    if street_xyz is not None and len(street_xyz):
        sx = street_xyz[np.isfinite(street_xyz[:, 2])]
        if len(sx):
            kd = cKDTree(sx[:, :2])

    for i, pid in enumerate(parcel_ids):
        rec = {"nbr_rel_m": None, "nbr_count": 0, "street_rel_m": None, "street_n": 0}
        vals = nbr_vals.get(i, [])
        rec["nbr_count"] = len(vals)
        if np.isfinite(em[i]) and len(vals) >= MIN_NEIGHBOURS:
            rec["nbr_rel_m"] = float(em[i] - np.median(vals))
        if kd is not None and np.isfinite(em[i]):
            g = geoms[i]
            c = g.centroid
            minx, miny, maxx, maxy = g.bounds
            r = 0.5 * float(np.hypot(maxx - minx, maxy - miny)) + STREET_RADIUS_M
            idx = kd.query_ball_point([c.x, c.y], r)
            if idx:
                cand = sx[idx]
                pts = shapely.points(cand[:, 0], cand[:, 1])
                dist = shapely.distance(g, pts)
                keep = (dist > 0) & (dist <= STREET_RADIUS_M)
                if keep.any():
                    dmin = dist[keep].min()
                    keep &= dist <= dmin + STREET_BAND_M
                    if keep.sum() >= MIN_STREET_POINTS:
                        rec["street_rel_m"] = float(em[i] - np.median(cand[keep, 2]))
                        rec["street_n"] = int(keep.sum())
        out[pid] = rec
    return out
