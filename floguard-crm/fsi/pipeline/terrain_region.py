"""Single-surface reference for a bounded terrain region, never a county runner."""
from __future__ import annotations

import json
import math

import numpy as np

from . import hydro as H
from .terrain_v2 import Inputs, Store, TerrainParams, Tile

MAX_REGION_CELLS = 16_000_000


def run_shared_region(inputs: Inputs, store: Store, tiles: list[Tile],
                      p: TerrainParams, log=print) -> dict:
    """Condition and route one region, then slice both cores and halos.

    All overlapping outputs read identical cells, including elevations after
    breaching and filling. Use halo data for connectivity but seed area only in
    owned cores, as in the tiled pilot. Window/NoData-edge sinks are not assumed
    to be verified drainage; without a channel or inlet on a path HAND is NaN.
    """
    if not tiles:
        raise ValueError("shared-region preview requires a nonempty tile plan")
    if len({t.key for t in tiles}) != len(tiles):
        raise ValueError("duplicate terrain tile key")
    r0, c0 = min(t.row_off for t in tiles), min(t.col_off for t in tiles)
    r1 = max(t.row_off + t.height for t in tiles)
    c1 = max(t.col_off + t.width for t in tiles)
    region = Tile("_shared_region", r0, c0, r1 - r0, c1 - c0)
    shape = (region.height, region.width)
    if math.prod(shape) > MAX_REGION_CELLS:
        raise ValueError("shared-region preview exceeds 16 million raster cells; use a smaller study area")

    def window(t):
        r, c = t.row_off - r0, t.col_off - c0
        return np.s_[r:r + t.height, c:c + t.width]

    log(f"shared-region preview: {shape[0]} x {shape[1]} cells, {len(tiles)} tile windows")
    dem, srcres = inputs.dem(region)
    if dem.shape != shape or srcres.shape != shape:
        raise ValueError("shared-region DEM and provenance must both match the planned raster")
    valid = np.isfinite(dem)
    covered = np.zeros(shape, bool)
    owned = np.zeros(shape, bool)
    for t in tiles:
        w = window(t)
        core = inputs.core(t) & valid[w]
        if (owned[w] & core).any():
            raise ValueError(f"overlapping terrain core ownership at {t.key}")
        owned[w] |= core
        covered[w] = True
    valid &= covered
    dem = np.where(valid, dem, np.nan)
    srcres = np.where(valid, srcres, 0.0)
    if not owned.any():
        raise ValueError("shared-region preview has no owned DEM cells")
    flow = inputs.flowlines(region)
    inlets = inputs.inlets(region)
    flow = np.zeros(shape, bool) if flow is None else flow & valid
    inlets = np.zeros(shape, bool) if inlets is None else inlets & valid
    culverts = inputs.culverts(region)
    log(f"conditioning {int(valid.sum()):,} valid cells in one solve")
    cond = H.condition_dem(dem, valid, culverts=culverts, flowline_mask=flow, inlets=inlets,
                           burn_depth_m=p.nhd_burn_m, max_breach_cells=p.max_breach_cells,
                           max_breach_depth_m=p.max_breach_depth_m)
    breached_elev = cond["breached"]
    routing = cond["routing"]
    depr = H.depression_depth(cond["basin_dem"], valid, inlets)
    del cond["basin_dem"]
    order = H.descending_order(routing, valid)
    weights = owned.astype(float)
    log("routing D8 and MFD across the shared surface")
    acc8, _ = H.accumulate(routing, valid, weights, outlets=inlets, order=order)
    accm, _ = H.accumulate(routing, valid, weights, outlets=inlets, order=order, method="mfd")
    del _, order, weights
    receivers = H.d8_receivers(routing, valid, inlets).reshape(shape)
    terminal = valid & (receivers < 0)
    # Inlets and mapped channels can resolve a path. A high-area terminal at
    # an unknown study boundary isn't, by itself, evidence of a channel.
    stream = (flow | inlets | ((acc8 >= p.stream_cells) & ~terminal)) & valid
    hand, _ = H.hand_full(breached_elev, routing, valid, stream, inlets)
    del _, receivers
    slope = H.slope_radians(breached_elev, p.cell_m)
    twi = H.twi(accm, slope, p.cell_m)
    twi[~valid] = np.nan
    mass8 = float(acc8[terminal].sum())
    massm = float(accm[terminal].sum())
    seeded = int(owned.sum())
    for mass in (mass8, massm):
        if not math.isclose(mass, seeded, rel_tol=1e-9, abs_tol=1e-7):
            raise RuntimeError(f"regional flow failed mass balance: terminal={mass}, seeded={seeded}")

    log("writing shared elevation and drainage slices")
    data = {"elev": dem, "srcres": srcres, "valid": valid, "flowlines": flow,
            "inlets": inlets, "routing": routing, "breached": breached_elev, "depr": depr,
            "acc_d8_final": acc8, "acc_mfd_final": accm, "hand": hand, "slope": slope,
            "stream": stream, "twi": twi}
    compact = {"elev", "srcres", "depr", "hand", "slope", "twi"}
    for t in tiles:
        w = window(t)
        core = inputs.core(t) & valid[w]
        store.put(t.key, "core", core)
        for k, a in data.items():
            store.put(t.key, k, a[w].astype(np.float32) if k in compact else a[w])
        # Record local source support, not the presence of a remote inlet in
        # another part of the region. As in tiled mode, extent includes halo.
        store.put(t.key, "meta", np.array(json.dumps({
            "has_flowlines": bool(flow[w].any()), "has_inlets": bool(inlets[w].any()),
            "n_culverts": len(inputs.culverts(t)), "conditioning": "shared_region_preview",
        })))
    return {"conditioning": "shared_region_preview", "residual_cells": 0.0, "residual_mfd_cells": 0.0,
            "seeded_cells": seeded, "valid_cells": int(valid.sum()), "terminal_d8_cells": mass8,
            "terminal_mfd_cells": massm, "terminal_cells": int(terminal.sum()),
            "unverified_terminal_cells": int((terminal & ~stream).sum()),
            "hand_unresolved_cells": int((owned & ~np.isfinite(hand)).sum()),
            "n_breached": cond["n_breached"]}

