"""Terrain v2: tiled, watershed-based hydro-conditioning and terrain derivatives.

Why tiles at all: Volusia at 1 m is ~9e9 cells; no workstation holds that.
Why watersheds: a HUC12 is a drainage unit, so almost all flow that starts in
it also ends in it and tile seams rarely cut a flow path. Why that is still not
enough: Florida's WBD boundaries are drawn on flat ground and the 1 m DEM often
disagrees with them, and large HUC12s must be split to fit in RAM. So:

    tile = (HUC12 polygon ∩ chunk square)   core: the cells this tile owns
         + halo of `halo_m` metres          context for breaching, slope, HAND

    phase 1  per tile: condition independent DEM windows for contextual burn,
             breach and fill. Then make each core owner authoritative for
             routing elevations in its neighbours' halos before accumulating
             any flow. A seam crossing therefore strictly descends one shared
             scalar potential, not two disagreeing local surfaces. Edge weights
             keep the original local slope on allowed cross-seam edges.
    phase 2  propagate exports: each export is injected into the tile whose core
             owns the target cell and routed onward with the same routing DEM.
             Accumulation is linear: final = local + routed injections. Routing
             cannot recirculate once all shared elevations agree. New boundary
             sinks and exports still pending at the round cap are reported.
    phase 3  per tile: assemble final accumulation for the whole window (core
             values from every overlapping tile), streams (area threshold, NHD
             cells, inlets), HAND, slope, TWI.

All tiles share one global grid (UTM 17N, `cell` metres, integer row/col
offsets), so moving values between tiles is array slicing, not resampling.

The data access is behind `Inputs` (ArrayInputs for tests, FileInputs in
terrain_v2_run.py for real rasters/vectors) and results go to a `Store`
(MemoryStore for tests, DiskStore with .npy files for the county run).
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Protocol

import numpy as np

from . import hydro as H


# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------

@dataclass
class TerrainParams:
    cell_m: float = 1.0
    halo_m: float = 300.0             # context ring; also the largest parcel half-width zonal can see whole
    max_breach_m: float = 40.0        # longest excavated breach channel (road embankments are 10-40 m)
    max_breach_depth_m: float = 0.0   # 0 = unlimited single-cell cut depth
    nhd_burn_m: float = 1.0           # NHD flowline burn depth
    stream_area_m2: float = 250_000.0 # contributing area that makes a channel for HAND (0.25 km2)
    propagate_tol: float = 1e-3       # export amounts below this (cells) are dropped; 1e-3 m2 at 1 m
    propagate_max_rounds: int = 25    # bound legitimate long cross-tile paths / MFD tails

    @property
    def halo_cells(self) -> int:
        return int(math.ceil(self.halo_m / self.cell_m))

    @property
    def max_breach_cells(self) -> int:
        return max(1, int(round(self.max_breach_m / self.cell_m)))

    @property
    def stream_cells(self) -> float:
        return self.stream_area_m2 / (self.cell_m * self.cell_m)


@dataclass
class Tile:
    key: str
    row_off: int        # window (core bbox + halo) in global grid cells
    col_off: int
    height: int
    width: int
    huc12: str = ""
    meta: dict = field(default_factory=dict)

    def contains(self, r: int, c: int) -> bool:
        return self.row_off <= r < self.row_off + self.height and self.col_off <= c < self.col_off + self.width


class Inputs(Protocol):
    cell_m: float

    def dem(self, tile: Tile) -> tuple[np.ndarray, np.ndarray]:
        """(elevation float64 with NaN nodata, source resolution in metres per cell; 0 = none)."""

    def core(self, tile: Tile) -> np.ndarray: ...

    def flowlines(self, tile: Tile) -> np.ndarray | None: ...

    def inlets(self, tile: Tile) -> np.ndarray | None: ...

    def culverts(self, tile: Tile) -> list[list[tuple[int, int]]]: ...


class Store(Protocol):
    def put(self, key: str, name: str, arr: np.ndarray) -> None: ...

    def get(self, key: str, name: str) -> np.ndarray: ...

    def has(self, key: str, name: str) -> bool: ...


class MemoryStore:
    def __init__(self):
        self._d: dict[tuple[str, str], np.ndarray] = {}

    def put(self, key, name, arr):
        self._d[(key, name)] = arr

    def get(self, key, name):
        return self._d[(key, name)]

    def has(self, key, name):
        return (key, name) in self._d


class DiskStore:
    """One .npy per (tile, layer) under root/<key>/. Loaded with mmap where read-only."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _p(self, key, name):
        return self.root / key / f"{name}.npy"

    def put(self, key, name, arr):
        p = self._p(key, name)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp.npy")
        np.save(tmp, arr)
        tmp.replace(p)

    def get(self, key, name):
        return np.load(self._p(key, name), mmap_mode=None)

    def has(self, key, name):
        return self._p(key, name).exists()


# ---------------------------------------------------------------------------
# In-memory inputs for tests and small areas
# ---------------------------------------------------------------------------

class ArrayInputs:
    """Global arrays + an integer label raster that says which tile owns each cell."""

    def __init__(self, dem: np.ndarray, labels: np.ndarray, cell_m: float = 1.0,
                 srcres: np.ndarray | None = None, flowlines: np.ndarray | None = None,
                 inlets: np.ndarray | None = None,
                 culverts: list[list[tuple[int, int]]] | None = None,
                 label_of_key: dict[str, int] | None = None):
        self.dem_g = np.asarray(dem, dtype=np.float64)
        self.labels = labels
        self.cell_m = cell_m
        self.srcres_g = srcres if srcres is not None else np.where(np.isfinite(self.dem_g), cell_m, 0.0)
        self.flow_g = flowlines
        self.inlet_g = inlets
        self.culverts_g = culverts or []
        self.label_of_key = label_of_key or {}

    @staticmethod
    def _win(a, t: Tile):
        return a[t.row_off:t.row_off + t.height, t.col_off:t.col_off + t.width]

    def dem(self, t):
        return self._win(self.dem_g, t).copy(), self._win(self.srcres_g, t).copy()

    def core(self, t):
        return self._win(self.labels, t) == self.label_of_key[t.key]

    def flowlines(self, t):
        return None if self.flow_g is None else self._win(self.flow_g, t).copy()

    def inlets(self, t):
        return None if self.inlet_g is None else self._win(self.inlet_g, t).copy()

    def culverts(self, t):
        out = []
        for path in self.culverts_g:
            loc = [(r - t.row_off, c - t.col_off) for r, c in path]
            if any(0 <= r < t.height and 0 <= c < t.width for r, c in loc):
                out.append(loc)
        return out


def tiles_from_labels(labels: np.ndarray, halo_cells: int, keys: dict[int, str] | None = None) -> tuple[list[Tile], dict[str, int]]:
    """Build tiles (core bbox + halo, clipped to the grid) from a label raster. Label 0 = unowned."""
    nr, nc = labels.shape
    tiles, lk = [], {}
    for lab in sorted(int(v) for v in np.unique(labels) if v != 0):
        rows, cols = np.nonzero(labels == lab)
        r0 = max(0, rows.min() - halo_cells)
        r1 = min(nr, rows.max() + 1 + halo_cells)
        c0 = max(0, cols.min() - halo_cells)
        c1 = min(nc, cols.max() + 1 + halo_cells)
        key = (keys or {}).get(lab, f"t{lab}")
        tiles.append(Tile(key, int(r0), int(c0), int(r1 - r0), int(c1 - c0)))
        lk[key] = lab
    return tiles, lk


# ---------------------------------------------------------------------------
# Phases
# ---------------------------------------------------------------------------

def phase1_condition(inputs: Inputs, store: Store, tile: Tile, p: TerrainParams) -> None:
    """Condition one tile; do not route area on its unshared halo yet."""
    dem, srcres = inputs.dem(tile)
    valid = np.isfinite(dem)
    core = inputs.core(tile) & valid
    flow = inputs.flowlines(tile)
    inl = inputs.inlets(tile)
    inl = np.zeros(dem.shape, dtype=bool) if inl is None else (inl & valid)
    cond = H.condition_dem(
        dem, valid, culverts=inputs.culverts(tile), flowline_mask=flow, inlets=inl,
        burn_depth_m=p.nhd_burn_m, max_breach_cells=p.max_breach_cells,
        max_breach_depth_m=p.max_breach_depth_m,
    )
    depr = H.depression_depth(cond["basin_dem"], valid, inl)
    store.put(tile.key, "elev", dem.astype(np.float32))
    store.put(tile.key, "srcres", srcres.astype(np.float32))
    store.put(tile.key, "valid", valid)
    store.put(tile.key, "core", core)
    store.put(tile.key, "inlets", inl)
    store.put(tile.key, "flowlines", np.zeros(dem.shape, bool) if flow is None else (flow & valid))
    store.put(tile.key, "routing", cond["routing"])
    store.put(tile.key, "breached", cond["breached"])
    store.put(tile.key, "depr", depr.astype(np.float32))
    tile.meta["n_breached"] = cond["n_breached"]
    tile.meta["has_flowlines"] = bool(flow is not None and flow.any())
    tile.meta["has_inlets"] = bool(inl.any())
    tile.meta["n_culverts"] = len(inputs.culverts(tile))
    # Write readiness last so a partially conditioned tile is never reused.
    store.put(tile.key, "meta", np.array(json.dumps(tile.meta)))


def _seam_routing(store: Store, tiles: list[Tile], target: Tile,
                  raw: np.ndarray, core: np.ndarray, valid: np.ndarray):
    """Overlay each owner's conditioned core elevation on target's valid halo.

    Own core elevations and unowned boundary cells stay unchanged. Conflicting
    core ownership is rejected, not made dependent on tile iteration order.
    """
    routing = raw.copy()
    filled = core.copy()
    changed = 0
    shift = 0.0
    for other in tiles:
        if other.key == target.key:
            continue
        r0 = max(target.row_off, other.row_off)
        r1 = min(target.row_off + target.height, other.row_off + other.height)
        c0 = max(target.col_off, other.col_off)
        c1 = min(target.col_off + target.width, other.col_off + other.width)
        if r0 >= r1 or c0 >= c1:
            continue
        here = np.s_[r0 - target.row_off:r1 - target.row_off, c0 - target.col_off:c1 - target.col_off]
        there = np.s_[r0 - other.row_off:r1 - other.row_off, c0 - other.col_off:c1 - other.col_off]
        owned = store.get(other.key, "core")[there] & valid[here]
        seen = filled[here]
        if np.any(seen & owned):
            raise ValueError(f"overlapping valid terrain cores: {target.key}, {other.key}")
        if not np.any(owned):
            continue
        values = store.get(other.key, "routing")[there][owned]
        target_view = routing[here]
        delta = np.abs(target_view[owned] - values)
        changed += int(np.count_nonzero(delta))
        shift = max(shift, float(delta.max()))
        target_view[owned] = values
        seen[owned] = True
    return routing, changed, shift


def _seed_tile_flow(store: Store, tiles: list[Tile], t: Tile):
    raw = store.get(t.key, "routing")
    valid = store.get(t.key, "valid")
    core = store.get(t.key, "core")
    inl = store.get(t.key, "inlets")
    guard, changed, shift = _seam_routing(store, tiles, t, raw, core, valid)
    new_sinks = 0
    if changed:
        old = H.d8_receivers(raw, valid, inl)
        new = H.d8_receivers(raw, valid, inl, routing_guard=guard)
        new_sinks = int(np.count_nonzero(core.ravel() & (old >= 0) & (new < 0)))
    weights = core.astype(np.float64)
    order = H.descending_order(raw, valid)
    acc8, ex8 = H.accumulate(raw, valid, weights, core=core, outlets=inl,
                              method="d8", order=order, routing_guard=guard)
    accm, exm = H.accumulate(raw, valid, weights, core=core, outlets=inl,
                              method="mfd", order=order, routing_guard=guard)
    store.put(t.key, "routing_guard", guard)
    store.put(t.key, "order", order)
    store.put(t.key, "acc_d8", acc8)
    store.put(t.key, "acc_mfd", accm)
    return _collect_exports(t, ex8, exm), changed, shift, new_sinks


def _collect_exports(tile: Tile, ex8: np.ndarray, exm: np.ndarray) -> np.ndarray:
    rr, cc = np.nonzero((ex8 > 0) | (exm > 0))
    return np.column_stack([rr + tile.row_off, cc + tile.col_off, ex8[rr, cc], exm[rr, cc]]).astype(np.float64)


def _assign_owners(tiles: list[Tile], store: Store, ex: np.ndarray) -> np.ndarray:
    """Index into `tiles` of the tile whose core owns each export's landing cell (-1: none).
    Vectorised: county runs produce millions of seam exports."""
    owner = np.full(len(ex), -1, dtype=np.int64)
    if not len(ex):
        return owner
    r = ex[:, 0].astype(np.int64)
    c = ex[:, 1].astype(np.int64)
    for ti, t in enumerate(tiles):
        sel = np.nonzero((owner < 0) & (r >= t.row_off) & (r < t.row_off + t.height)
                         & (c >= t.col_off) & (c < t.col_off + t.width))[0]
        if not sel.size:
            continue
        core = store.get(t.key, "core")
        hit = core[r[sel] - t.row_off, c[sel] - t.col_off]
        owner[sel[hit]] = ti
    return owner


def phase2_propagate(store: Store, tiles: list[Tile], exports, p: TerrainParams) -> dict:
    """Route exported flow through the tiles that own its landing cells, until it
    reaches an outlet or falls below tolerance. Returns diagnostics."""
    pending = np.asarray(exports, dtype=np.float64).reshape(-1, 4)
    rounds = 0
    initial = pending[:, 2:].sum(axis=0)
    lost = np.zeros(2)
    discarded = np.zeros(2)
    while len(pending) and rounds < p.propagate_max_rounds:
        rounds += 1
        owner = _assign_owners(tiles, store, pending)
        lost += pending[owner < 0, 2:].sum(axis=0)  # outside every owned core
        nxt = []
        for ti in np.unique(owner[owner >= 0]):
            t = tiles[ti]
            items = pending[owner == ti]
            routing = store.get(t.key, "routing")
            guard = store.get(t.key, "routing_guard")
            valid = store.get(t.key, "valid")
            core = store.get(t.key, "core")
            inl = store.get(t.key, "inlets")
            w8 = np.zeros(routing.shape)
            wm = np.zeros(routing.shape)
            rr = items[:, 0].astype(np.int64) - t.row_off
            cc = items[:, 1].astype(np.int64) - t.col_off
            np.add.at(w8, (rr, cc), items[:, 2])
            np.add.at(wm, (rr, cc), items[:, 3])
            order = store.get(t.key, "order")
            a8, e8 = H.accumulate(routing, valid, w8, core=core, outlets=inl,
                                  method="d8", order=order, routing_guard=guard)
            am, em = H.accumulate(routing, valid, wm, core=core, outlets=inl,
                                  method="mfd", order=order, routing_guard=guard)
            store.put(t.key, "acc_d8", store.get(t.key, "acc_d8") + a8 * core)
            store.put(t.key, "acc_mfd", store.get(t.key, "acc_mfd") + am * core)
            e = _collect_exports(t, e8, em)
            if len(e):
                keep = (e[:, 2] > p.propagate_tol) | (e[:, 3] > p.propagate_tol)
                discarded += e[~keep, 2:].sum(axis=0)
                nxt.append(e[keep])
        pending = np.vstack(nxt) if nxt else np.zeros((0, 4))
    residual = float(pending[:, 2].sum()) if len(pending) else 0.0
    residual_mfd = float(pending[:, 3].sum()) if len(pending) else 0.0
    # Compare total uniquely seeded seam flow, not cumulative injections (which
    # include the same legitimate flow whenever it crosses a *different* seam).
    remaining = np.array([residual, residual_mfd])
    if np.any(lost + discarded + remaining > initial + 1e-8 * np.maximum(initial, 1.0)):
        raise RuntimeError("terrain seam routing emitted more area than it received")
    return {"rounds": rounds, "outflow_cells": float(lost[0]), "outflow_mfd_cells": float(lost[1]),
            "seam_initial_d8_cells": float(initial[0]), "seam_initial_mfd_cells": float(initial[1]),
            "seam_tolerance_discarded_d8_cells": float(discarded[0]),
            "seam_tolerance_discarded_mfd_cells": float(discarded[1]),
            "residual_cells": residual, "residual_mfd_cells": residual_mfd}


def window_from_cores(store: Store, tiles: list[Tile], t: Tile, name: str, fill: float = 0.0) -> np.ndarray:
    """Assemble `name` for t's whole window from the core cells of every overlapping tile
    (each cell's value as computed by the tile that owns it)."""
    out = np.full((t.height, t.width), fill, dtype=np.float64)
    for o in tiles:
        r0 = max(t.row_off, o.row_off)
        r1 = min(t.row_off + t.height, o.row_off + o.height)
        c0 = max(t.col_off, o.col_off)
        c1 = min(t.col_off + t.width, o.col_off + o.width)
        if r1 <= r0 or c1 <= c0:
            continue
        src = store.get(o.key, name)[r0 - o.row_off:r1 - o.row_off, c0 - o.col_off:c1 - o.col_off]
        cm = store.get(o.key, "core")[r0 - o.row_off:r1 - o.row_off, c0 - o.col_off:c1 - o.col_off]
        dst = out[r0 - t.row_off:r1 - t.row_off, c0 - t.col_off:c1 - t.col_off]
        dst[cm] = src[cm]
    return out


def phase3_finalize(store: Store, tiles: list[Tile], t: Tile, p: TerrainParams) -> None:
    """Streams, HAND, slope and TWI for one tile window using final accumulation."""
    valid = store.get(t.key, "valid")
    routing = store.get(t.key, "routing")
    guard = store.get(t.key, "routing_guard")
    breached = store.get(t.key, "breached")
    inl = store.get(t.key, "inlets")
    flow = store.get(t.key, "flowlines")
    acc8 = window_from_cores(store, tiles, t, "acc_d8")
    accm = window_from_cores(store, tiles, t, "acc_mfd")
    stream = ((acc8 >= p.stream_cells) | flow) & valid
    hnd, term = H.hand_full(breached, routing, valid, stream, inl,
                            core=store.get(t.key, "core"), routing_guard=guard)
    # Unresolved paths: remember the global cell where they left the window.
    tr_, tc_ = np.divmod(term, t.width)
    gterm = np.where(term >= 0, (tr_ + t.row_off) * GLOBAL_STRIDE + (tc_ + t.col_off), -1)
    store.put(t.key, "hand_term", gterm.reshape(hnd.shape))
    slope = H.slope_radians(breached, p.cell_m)
    tw = H.twi(accm, slope, p.cell_m)
    tw[~valid] = np.nan
    store.put(t.key, "stream", stream)
    store.put(t.key, "hand", hnd.astype(np.float32))
    store.put(t.key, "slope", slope.astype(np.float32))
    store.put(t.key, "twi", tw.astype(np.float32))
    store.put(t.key, "acc_d8_final", acc8)
    store.put(t.key, "acc_mfd_final", accm)


GLOBAL_STRIDE = 1 << 31  # flat global index = row * stride + col (grid widths are far below 2^31)


def phase3b_link_hand(store: Store, tiles: list[Tile], p: TerrainParams) -> dict:
    """Finish HAND paths that left a tile window before reaching a channel.

    A cell whose D8 path exits the window at edge cell E inherits the drainage
    elevation of E as computed by the tile whose core owns E (E is deep in that
    tile's core, since every window is core + halo). Repeated until nothing
    changes, so a path can cross several tiles. Paths that leave the study
    area or never meet a channel stay NaN.
    """
    def drain_z(t):
        return store.get(t.key, "breached") - store.get(t.key, "hand")

    rounds = 0
    fixed_total = 0
    while rounds < p.propagate_max_rounds:
        rounds += 1
        fixed = 0
        for t in tiles:
            term = store.get(t.key, "hand_term")
            core = store.get(t.key, "core")
            todo = (term >= 0) & core
            if not todo.any():
                continue
            g = term[todo]
            ex = np.column_stack([g // GLOBAL_STRIDE, g % GLOBAL_STRIDE, np.zeros(len(g)), np.zeros(len(g))])
            owner = _assign_owners(tiles, store, ex.astype(np.float64))
            hnd = store.get(t.key, "hand")
            elev = store.get(t.key, "breached")
            new_term = term.copy()
            idx = np.argwhere(todo)
            changed = False
            for oi in np.unique(owner[owner >= 0]):
                o = tiles[oi]
                sel = owner == oi
                if o.key == t.key:  # exit cell is our own core (grid edge): nothing further to follow
                    cells = idx[sel]
                    new_term[cells[:, 0], cells[:, 1]] = -1
                    changed = True
                    continue
                rr = (g[sel] // GLOBAL_STRIDE) - o.row_off
                cc = (g[sel] % GLOBAL_STRIDE) - o.col_off
                dz = drain_z(o)[rr, cc]
                oterm = store.get(o.key, "hand_term")[rr, cc]
                cells = idx[sel]
                ok = np.isfinite(dz)
                hnd[cells[ok, 0], cells[ok, 1]] = elev[cells[ok, 0], cells[ok, 1]] - dz[ok]
                new_term[cells[ok, 0], cells[ok, 1]] = -1
                # not resolved there either: follow that tile's exit next round
                adv = ~ok & (oterm >= 0) & (oterm != g[sel])
                new_term[cells[adv, 0], cells[adv, 1]] = oterm[adv]
                stop = ~ok & ~adv
                new_term[cells[stop, 0], cells[stop, 1]] = -1
                fixed += int(ok.sum())
                changed = changed or ok.any() or adv.any() or stop.any()
            gone = owner < 0  # left the study area: unresolved for good
            new_term[idx[gone, 0], idx[gone, 1]] = -1
            changed = changed or gone.any()
            if changed:
                store.put(t.key, "hand", hnd.astype(np.float32))
                store.put(t.key, "hand_term", new_term)
        fixed_total += fixed
        if not any(((store.get(t.key, "hand_term") >= 0) & store.get(t.key, "core")).any() for t in tiles):
            break
    unresolved = sum(int((np.isnan(store.get(t.key, "hand")) & store.get(t.key, "core")).sum()) for t in tiles)
    return {"hand_rounds": rounds, "hand_linked_cells": fixed_total, "hand_unresolved_cells": unresolved}


def run_tiles(inputs: Inputs, store: Store, tiles: list[Tile], p: TerrainParams, log=print) -> dict:
    """Condition cached inputs, then rebuild a consistent flow graph each run.

    The tile set can change between runs. Never reuse legacy local accumulators,
    exports, or stitched elevations from a different core selection.
    """
    for i, t in enumerate(tiles):
        if store.has(t.key, "meta"):
            t.meta.update(json.loads(str(store.get(t.key, "meta"))))
            log(f"[1/3] {t.key} conditioned cache")
        else:
            phase1_condition(inputs, store, t, p)
            log(f"[1/3] {t.key} {i + 1}/{len(tiles)} breached={t.meta.get('n_breached')}")
    exports = []
    changed = sinks = 0
    max_shift = 0.0
    for i, t in enumerate(tiles):
        ex, n, shift, n_sinks = _seed_tile_flow(store, tiles, t)
        changed += n
        sinks += n_sinks
        max_shift = max(max_shift, shift)
        exports.append(ex)
        log(f"[1/3] {t.key} {i + 1}/{len(tiles)} seam exports={len(ex)}, new sinks={n_sinks}")
    allx = np.vstack(exports) if exports else np.zeros((0, 4))
    diag = phase2_propagate(store, tiles, allx, p)
    diag.update(seam_changed_halo_cells=changed, seam_max_routing_shift_m=max_shift, seam_new_sink_cells=sinks)
    log(f"[2/3] propagate {diag}")
    for i, t in enumerate(tiles):
        phase3_finalize(store, tiles, t, p)
        log(f"[3/3] {t.key} {i + 1}/{len(tiles)}")
    diag.update(phase3b_link_hand(store, tiles, p))
    log(f"[3/3] HAND linking {diag}")
    return diag


def mosaic(store: Store, tiles: list[Tile], name: str, shape: tuple[int, int], fill=np.nan) -> np.ndarray:
    """Global array of `name` from tile cores (tests / small areas only)."""
    out = np.full(shape, fill, dtype=np.float64)
    for t in tiles:
        a = store.get(t.key, name)
        cm = store.get(t.key, "core")
        dst = out[t.row_off:t.row_off + t.height, t.col_off:t.col_off + t.width]
        dst[cm] = a[cm]
    return out
