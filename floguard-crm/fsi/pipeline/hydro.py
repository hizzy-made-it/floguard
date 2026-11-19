"""Array-level hydrology kernels for terrain v2.

Everything here works on in-memory numpy arrays in a projected metric grid
(UTM 17N for Volusia). No GDAL, no files: the raster plumbing lives in
terrain_v2.py, so every algorithm below can be unit-tested on synthetic DEMs
with known answers (fsi/tests/test_hydro.py).

Kernels are numba-compiled when numba is installed (it is in requirements.txt;
a 1 m HUC12 window is ~1e8 cells and pure Python would take hours). Without
numba the same functions run as plain Python, which is fine for tests.

Conditioning order (why each step exists):

    raw DEM
      -> burn culverts            road embankments sit on top of real pipes; a
                                  1 m DEM sees the embankment as a dam
      -> burn NHD flowlines       mapped channels narrower than a cell or under
                                  bridges otherwise lose continuity
      -> least-cost breach        cut through remaining false dams, but only up
         (bounded length/depth)   to a set length so real ridges stay ridges
      -> epsilon priority fill    whatever could not be breached is a real
                                  depression; fill it so flow routes across it
    = conditioned DEM  (routing only)

The closed-basin measure (depression depth) is computed from the DEM BEFORE
breaching (culverts/inlets applied, nothing else): breaching is a routing
convenience and would erase exactly the bowls the sales team is looking for.
"""

from __future__ import annotations

import heapq
import math

import numpy as np

try:  # pragma: no cover - exercised implicitly
    from numba import njit

    HAVE_NUMBA = True
except Exception:  # pragma: no cover
    HAVE_NUMBA = False

    def njit(*args, **kwargs):
        if args and callable(args[0]):
            return args[0]

        def deco(f):
            return f

        return deco


# 8-neighbour offsets, clockwise from east. Distances in cells.
DR = np.array([0, 1, 1, 1, 0, -1, -1, -1], dtype=np.int64)
DC = np.array([1, 1, 0, -1, -1, -1, 0, 1], dtype=np.int64)
DIST = np.array([1.0, math.sqrt(2), 1.0, math.sqrt(2), 1.0, math.sqrt(2), 1.0, math.sqrt(2)])

# Freeman (1991) multiple-flow-direction exponent. 1.1 is the published value
# for divergent hillslopes; it spreads flow on convex ground and concentrates it
# in hollows, which is what makes TWI smooth instead of D8-blocky.
MFD_EXPONENT = 1.1

# Slope floor (radians) for TWI. Coastal Florida has many truly flat cells;
# tan(0) would put inf into the raster.
MIN_SLOPE_RAD = 0.001

# Elevation increment used by the epsilon fill and by breach carving so that
# every conditioned cell has a strictly lower neighbour toward an outlet.
# Computations run in float64, so 1e-5 m is well above rounding at 0-100 m.
EPSILON_M = 1e-5


# ---------------------------------------------------------------------------
# Rasterising helpers
# ---------------------------------------------------------------------------

def line_cells(r0: int, c0: int, r1: int, c1: int) -> list[tuple[int, int]]:
    """8-connected Bresenham line from (r0,c0) to (r1,c1), endpoints included, in order."""
    cells = []
    dr, dc = abs(r1 - r0), abs(c1 - c0)
    sr = 1 if r1 >= r0 else -1
    sc = 1 if c1 >= c0 else -1
    err = dc - dr
    r, c = r0, c0
    while True:
        cells.append((r, c))
        if r == r1 and c == c1:
            break
        e2 = 2 * err
        if e2 > -dr:
            err -= dr
            c += sc
        if e2 < dc:
            err += dc
            r += sr
    return cells


# ---------------------------------------------------------------------------
# Burning
# ---------------------------------------------------------------------------

def burn_culverts(dem: np.ndarray, valid: np.ndarray, culverts: list[list[tuple[int, int]]],
                  drop_m: float = 0.05) -> np.ndarray:
    """Carve each culvert as a straight descending channel through whatever is on top.

    `culverts` is a list of ordered cell paths (from line_cells), one per pipe,
    each running from one embankment toe to the other. The invert is set to a
    linear interpolation between the lower of the two end elevations (minus
    `drop_m`) and the other end, so the pipe drains whichever way the ground
    falls. Cells already below the invert are left alone.

    This is the fix for the false-dam problem: at 1 m a road embankment is a
    continuous wall, the real culvert under it is invisible to LiDAR, and
    without this every upstream yard reads as a closed basin.
    """
    out = dem.copy()
    nr, nc = out.shape
    for path in culverts:
        pts = [(r, c) for r, c in path if 0 <= r < nr and 0 <= c < nc and valid[r, c]]
        if len(pts) < 2:
            continue
        za = out[pts[0]]
        zb = out[pts[-1]]
        if za < zb:  # flow toward the start: reverse so we always descend
            pts = pts[::-1]
            za, zb = zb, za
        start = za
        end = zb - drop_m
        n = len(pts) - 1
        for k, (r, c) in enumerate(pts):
            inv = start + (end - start) * (k / n)
            if out[r, c] > inv:
                out[r, c] = inv
    return out


def burn_mask(dem: np.ndarray, mask: np.ndarray, depth_m: float) -> np.ndarray:
    """Lower cells under a rasterised line layer (NHD flowlines) by a fixed depth.

    A modest burn (default 1 m in terrain_v2) is enough: breaching does the rest,
    and a deep burn creates artificial canyons that distort HAND next to them.
    """
    out = dem.copy()
    out[mask] -= depth_m
    return out


# ---------------------------------------------------------------------------
# Priority-flood fill (Barnes, Lehman & Mulla 2014)
# ---------------------------------------------------------------------------

@njit(cache=True)
def _priority_flood(z, valid, outlet, eps):
    nr, nc = z.shape
    out = z.copy()
    closed = np.zeros((nr, nc), dtype=np.bool_)
    heap = [(0.0, np.int64(0))]
    heap.pop()
    for r in range(nr):
        for c in range(nc):
            if not valid[r, c]:
                continue
            edge = r == 0 or c == 0 or r == nr - 1 or c == nc - 1 or outlet[r, c]
            if not edge:
                for k in range(8):
                    rr = r + DR[k]
                    cc = c + DC[k]
                    if not valid[rr, cc]:
                        edge = True
                        break
            if edge:
                closed[r, c] = True
                heapq.heappush(heap, (out[r, c], np.int64(r * nc + c)))
    while len(heap) > 0:
        e, idx = heapq.heappop(heap)
        r = idx // nc
        c = idx % nc
        for k in range(8):
            rr = r + DR[k]
            cc = c + DC[k]
            if rr < 0 or cc < 0 or rr >= nr or cc >= nc:
                continue
            if closed[rr, cc] or not valid[rr, cc]:
                continue
            closed[rr, cc] = True
            if out[rr, cc] <= out[r, c]:
                out[rr, cc] = out[r, c] + eps
            heapq.heappush(heap, (out[rr, cc], np.int64(rr * nc + cc)))
    return out


def fill_depressions(dem: np.ndarray, valid: np.ndarray | None = None,
                     outlets: np.ndarray | None = None, epsilon: float = 0.0) -> np.ndarray:
    """Priority-flood fill. epsilon=0 -> flat-water fill (depression depth);
    epsilon>0 -> every cell gets a strictly lower path to an outlet (routing).

    `outlets` marks cells that drain off-grid (stormwater inlets): they seed the
    flood like edge cells, so a bowl with a working inlet is not a closed basin.
    """
    z = np.asarray(dem, dtype=np.float64)
    if valid is None:
        valid = np.isfinite(z)
    if outlets is None:
        outlets = np.zeros(z.shape, dtype=np.bool_)
    zz = np.where(valid, z, 0.0)
    out = _priority_flood(zz, valid.astype(np.bool_), outlets.astype(np.bool_), float(epsilon))
    return np.where(valid, out, np.nan)


def depression_depth(dem: np.ndarray, valid: np.ndarray | None = None,
                     outlets: np.ndarray | None = None) -> np.ndarray:
    """Closed-basin depth = flat fill - DEM (metres, >= 0). NaN where invalid."""
    z = np.asarray(dem, dtype=np.float64)
    if valid is None:
        valid = np.isfinite(z)
    filled = fill_depressions(z, valid, outlets, 0.0)
    d = filled - z
    d[valid & (d < 0)] = 0.0
    return np.where(valid, d, np.nan)


# ---------------------------------------------------------------------------
# Bounded least-cost breaching (after Lindsay 2016)
# ---------------------------------------------------------------------------

@njit(cache=True)
def _pit_representatives(z, valid, outlet):
    """One cell per closed flat region (a single-cell pit is a region of one).

    A region is a connected set of equal-elevation cells. It is a pit when no
    cell in it has a strictly lower neighbour and it does not touch the grid
    edge, an outlet or nodata. Hydro-flattened lakes in the 1 m DEM are large
    flat regions; treating every lake cell as its own pit would launch millions
    of searches. One breach per region is enough: the epsilon fill afterwards
    drains the rest of the flat toward it.
    """
    nr, nc = z.shape
    seen = np.zeros((nr, nc), dtype=np.bool_)
    reps = []
    stack = np.empty(nr * nc, dtype=np.int64)
    for r0 in range(nr):
        for c0 in range(nc):
            if seen[r0, c0] or not valid[r0, c0]:
                continue
            # quick reject: a cell with a lower neighbour cannot seed a pit region
            zc = z[r0, c0]
            seen[r0, c0] = True
            top = 0
            stack[top] = r0 * nc + c0
            top += 1
            is_pit = True
            rep = r0 * nc + c0
            while top > 0:
                top -= 1
                i = stack[top]
                r = i // nc
                c = i % nc
                if r == 0 or c == 0 or r == nr - 1 or c == nc - 1 or outlet[r, c]:
                    is_pit = False
                for k in range(8):
                    rr = r + DR[k]
                    cc = c + DC[k]
                    if rr < 0 or cc < 0 or rr >= nr or cc >= nc:
                        continue
                    if not valid[rr, cc]:
                        is_pit = False
                        continue
                    zn = z[rr, cc]
                    if zn < zc:
                        is_pit = False
                    elif zn == zc and not seen[rr, cc]:
                        seen[rr, cc] = True
                        stack[top] = rr * nc + cc
                        top += 1
            if is_pit:
                reps.append(rep)
    return reps


@njit(cache=True)
def _breach(z, valid, outlet, max_len, max_depth, eps):
    nr, nc = z.shape
    n = nr * nc
    out = z.copy()
    rep_list = _pit_representatives(out, valid, outlet)
    npit = len(rep_list)
    pits = np.empty(npit, dtype=np.int64)
    pz = np.empty(npit, dtype=np.float64)
    for i in range(npit):
        pits[i] = rep_list[i]
        pz[i] = out[pits[i] // nc, pits[i] % nc]
    order = np.argsort(pz, kind="mergesort")

    # Search budget per pit: cells needing excavation are limited to max_len;
    # free (at or below pit level) cells are limited by a visit cap so a huge
    # flat cannot stall the run.
    max_visit = (2 * max_len + 1) * (2 * max_len + 1) * 4
    cost = np.full(n, np.inf)
    steps = np.zeros(n, dtype=np.int64)
    prev = np.full(n, -1, dtype=np.int64)
    stamp = np.full(n, -1, dtype=np.int64)
    breached = 0
    for oi in range(npit):
        p = pits[order[oi]]
        pr = p // nc
        pc = p % nc
        zp = out[pr, pc]
        still = True
        for k in range(8):
            rr = pr + DR[k]
            cc = pc + DC[k]
            if out[rr, cc] < zp:
                still = False
                break
        if not still:
            continue
        heap = [(0.0, np.int64(p))]
        cost[p] = 0.0
        steps[p] = 0
        prev[p] = -1
        stamp[p] = oi
        found = -1
        visits = 0
        while len(heap) > 0:
            cst, i = heapq.heappop(heap)
            if cst > cost[i]:
                continue
            visits += 1
            if visits > max_visit:
                break
            ir = i // nc
            ic = i % nc
            if i != p:
                at_edge = ir == 0 or ic == 0 or ir == nr - 1 or ic == nc - 1 or outlet[ir, ic]
                if out[ir, ic] < zp or at_edge:
                    found = i
                    break
            for k in range(8):
                rr = ir + DR[k]
                cc = ic + DC[k]
                if rr < 0 or cc < 0 or rr >= nr or cc >= nc:
                    continue
                if not valid[rr, cc]:
                    continue
                j = rr * nc + cc
                dig = out[rr, cc] - zp
                if dig < 0.0:
                    dig = 0.0
                if max_depth > 0.0 and dig > max_depth:
                    continue
                st = steps[i] + (1 if dig > 0.0 else 0)
                if st > max_len:
                    continue
                nc_ = cst + dig
                if stamp[j] != oi or nc_ < cost[j]:
                    stamp[j] = oi
                    cost[j] = nc_
                    prev[j] = i
                    steps[j] = st
                    heapq.heappush(heap, (nc_, np.int64(j)))
        if found < 0:
            continue
        # Walk back to the pit, then carve a strictly descending channel.
        path = []
        j = found
        while j != -1:
            path.append(j)
            if j == p:
                break
            j = prev[j]
        L = len(path)
        lvl = zp
        for t in range(L - 2, -1, -1):  # path[L-1] is the pit
            j = path[t]
            jr = j // nc
            jc = j % nc
            lvl = lvl - eps
            if out[jr, jc] > lvl:
                out[jr, jc] = lvl
            else:
                lvl = out[jr, jc]
        breached += 1
    return out, breached


def breach_depressions(dem: np.ndarray, valid: np.ndarray | None = None,
                       outlets: np.ndarray | None = None, max_length_cells: int = 40,
                       max_depth_m: float = 0.0, epsilon: float = EPSILON_M) -> tuple[np.ndarray, int]:
    """Cut a least-excavation channel from each pit to lower ground, within limits.

    max_length_cells  most cells the channel may excavate (cells already at or
                      below pit level are free). Road embankments are 10-40 m
                      wide; real ridges are wider. Pits that need a longer cut
                      stay pits and are filled afterwards.
    max_depth_m       deepest single-cell cut allowed (0 = unlimited).

    Returns (breached DEM, number of pits breached).
    """
    z = np.asarray(dem, dtype=np.float64)
    if valid is None:
        valid = np.isfinite(z)
    if outlets is None:
        outlets = np.zeros(z.shape, dtype=np.bool_)
    zz = np.where(valid, z, 0.0)
    out, n = _breach(zz, valid.astype(np.bool_), outlets.astype(np.bool_),
                     int(max_length_cells), float(max_depth_m), float(epsilon))
    return np.where(valid, out, np.nan), int(n)


def condition_dem(dem: np.ndarray, valid: np.ndarray | None = None, *,
                  culverts: list | None = None, flowline_mask: np.ndarray | None = None,
                  inlets: np.ndarray | None = None, burn_depth_m: float = 1.0,
                  max_breach_cells: int = 40, max_breach_depth_m: float = 0.0) -> dict:
    """Full conditioning chain. Returns dict with
        'basin_dem'   culverts burned, inlets as outlets, NOT breached (closed-basin source)
        'breached'    + NHD burn + bounded breach (slope / HAND elevations)
        'routing'     + epsilon fill (flow directions; strictly drains everywhere)
        'n_breached'
    """
    z = np.asarray(dem, dtype=np.float64)
    if valid is None:
        valid = np.isfinite(z)
    if inlets is None:
        inlets = np.zeros(z.shape, dtype=np.bool_)
    basin = burn_culverts(z, valid, culverts) if culverts else z.copy()
    b = basin
    if flowline_mask is not None and flowline_mask.any():
        b = burn_mask(b, flowline_mask & valid, burn_depth_m)
    breached, n = breach_depressions(b, valid, inlets, max_breach_cells, max_breach_depth_m)
    routing = fill_depressions(breached, valid, inlets, EPSILON_M)
    return {"basin_dem": np.where(valid, basin, np.nan), "breached": breached,
            "routing": routing, "n_breached": n}


# ---------------------------------------------------------------------------
# Flow routing
# ---------------------------------------------------------------------------

@njit(cache=True)
def _d8(z, valid, outlet):
    nr, nc = z.shape
    rec = np.full(nr * nc, -1, dtype=np.int64)
    for r in range(nr):
        for c in range(nc):
            if not valid[r, c] or outlet[r, c]:
                continue
            best = 0.0
            bi = -1
            for k in range(8):
                rr = r + DR[k]
                cc = c + DC[k]
                if rr < 0 or cc < 0 or rr >= nr or cc >= nc or not valid[rr, cc]:
                    continue
                s = (z[r, c] - z[rr, cc]) / DIST[k]
                if s > best:
                    best = s
                    bi = rr * nc + cc
            rec[r * nc + c] = bi
    return rec


def d8_receivers(routing_dem: np.ndarray, valid: np.ndarray,
                 outlets: np.ndarray | None = None) -> np.ndarray:
    """Flat index of the steepest-descent neighbour, -1 for outlets/edges/inlets."""
    if outlets is None:
        outlets = np.zeros(routing_dem.shape, dtype=np.bool_)
    zz = np.where(valid, routing_dem, 0.0)
    return _d8(zz, valid.astype(np.bool_), outlets.astype(np.bool_))


@njit(cache=True)
def _accumulate(z, valid, core, weights, outlet, mfd, p, order, export):
    """Accumulate `weights` downslope in `order` (descending z).

    Flow from a core cell into a non-core cell is not added there: it is
    written to `export` at that target cell and leaves this tile. This is how
    flow crosses watershed (tile) boundaries without double counting.
    """
    nr, nc = z.shape
    acc = weights.copy()
    for oi in range(order.shape[0]):
        i = order[oi]
        r = i // nc
        c = i % nc
        if not valid[r, c] or outlet[r, c]:
            continue
        a = acc[r, c]
        if a == 0.0:
            continue
        if mfd:
            tot = 0.0
            for k in range(8):
                rr = r + DR[k]
                cc = c + DC[k]
                if rr < 0 or cc < 0 or rr >= nr or cc >= nc or not valid[rr, cc]:
                    continue
                d = z[r, c] - z[rr, cc]
                if d > 0.0:
                    tot += (d / DIST[k]) ** p
            if tot <= 0.0:
                continue
            for k in range(8):
                rr = r + DR[k]
                cc = c + DC[k]
                if rr < 0 or cc < 0 or rr >= nr or cc >= nc or not valid[rr, cc]:
                    continue
                d = z[r, c] - z[rr, cc]
                if d > 0.0:
                    f = a * (d / DIST[k]) ** p / tot
                    if core[r, c] and not core[rr, cc]:
                        export[rr, cc] += f
                    else:
                        acc[rr, cc] += f
        else:
            best = 0.0
            br = -1
            bc = -1
            for k in range(8):
                rr = r + DR[k]
                cc = c + DC[k]
                if rr < 0 or cc < 0 or rr >= nr or cc >= nc or not valid[rr, cc]:
                    continue
                s = (z[r, c] - z[rr, cc]) / DIST[k]
                if s > best:
                    best = s
                    br = rr
                    bc = cc
            if br < 0:
                continue
            if core[r, c] and not core[br, bc]:
                export[br, bc] += a
            else:
                acc[br, bc] += a
    return acc


def descending_order(routing_dem: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Flat indices of valid cells from highest to lowest (cache it: sorting dominates)."""
    flat = np.where(valid, routing_dem, -np.inf).ravel()
    order = np.argsort(-flat, kind="stable").astype(np.int64)
    return order[np.isfinite(flat[order])]


def accumulate(routing_dem: np.ndarray, valid: np.ndarray, weights: np.ndarray, *,
               core: np.ndarray | None = None, outlets: np.ndarray | None = None,
               method: str = "d8", exponent: float = MFD_EXPONENT,
               order: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Flow accumulation of `weights` (e.g. cell area) on a routing DEM.

    Returns (acc, export). `export[r, c]` is the amount that left the core into
    non-core cell (r, c); it is 0 everywhere when `core` is None.
    The routing DEM must strictly drain (condition_dem()['routing']).
    """
    if core is None:
        core = valid.copy()
    if outlets is None:
        outlets = np.zeros(routing_dem.shape, dtype=np.bool_)
    if order is None:
        order = descending_order(routing_dem, valid)
    export = np.zeros(routing_dem.shape, dtype=np.float64)
    zz = np.where(valid, routing_dem, 0.0).astype(np.float64)
    acc = _accumulate(zz, valid.astype(np.bool_), core.astype(np.bool_),
                      np.asarray(weights, dtype=np.float64).copy(), outlets.astype(np.bool_),
                      method == "mfd", float(exponent), order, export)
    return acc, export


# ---------------------------------------------------------------------------
# Derivatives
# ---------------------------------------------------------------------------

def slope_radians(dem: np.ndarray, cell: float) -> np.ndarray:
    """Horn (1981) 3x3 slope. Edge cells use replicated neighbours."""
    z = np.asarray(dem, dtype=np.float64)
    zp = np.pad(np.where(np.isfinite(z), z, np.nan), 1, mode="edge")
    # Replace NaN neighbours with the centre so slopes at data edges stay finite.
    centre = np.pad(z, 1, mode="edge")
    zp = np.where(np.isfinite(zp), zp, centre)
    a, b, c = zp[:-2, :-2], zp[:-2, 1:-1], zp[:-2, 2:]
    d, f = zp[1:-1, :-2], zp[1:-1, 2:]
    g, h, i = zp[2:, :-2], zp[2:, 1:-1], zp[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * cell)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * cell)
    s = np.arctan(np.hypot(dzdx, dzdy))
    return np.where(np.isfinite(z), s, np.nan)


def twi(acc_cells: np.ndarray, slope_rad: np.ndarray, cell: float) -> np.ndarray:
    """TWI = ln(a / tan B), a = specific contributing area = acc_cells * cell (m)."""
    sca = np.maximum(acc_cells, 1.0) * cell
    tb = np.tan(np.maximum(slope_rad, MIN_SLOPE_RAD))
    return np.log(sca / tb)


@njit(cache=True)
def _hand(z_elev, rec, stream, valid, core, order):
    nr, nc = z_elev.shape
    n = nr * nc
    drain = np.full(n, -1, dtype=np.int64)
    term = np.full(n, -1, dtype=np.int64)
    hand = np.full((nr, nc), np.nan)
    for oi in range(order.shape[0]):  # ascending routing elevation: receivers first
        i = order[oi]
        r = i // nc
        c = i % nc
        if not valid[r, c]:
            continue
        j = rec[i]
        if stream[r, c]:
            drain[i] = i
        elif j >= 0 and core[r, c] and not core[j // nc, j % nc]:
            term[i] = j  # leaves this tile's core: the owner of j finishes the path
        elif j >= 0:
            drain[i] = drain[j]
            term[i] = term[j]
        else:
            term[i] = i  # path ends here without a channel: grid edge
        if drain[i] >= 0:
            d = drain[i]
            hand[r, c] = z_elev[r, c] - z_elev[d // nc, d % nc]
            term[i] = -1
    return hand, drain, term


def hand_full(elev, routing_dem, valid, stream, outlets=None, core=None):
    """HAND plus `term`: for unresolved cells, the flat index of the cell where the
    path stopped (-1 when resolved). With `core`, a core cell's path stops at the
    first non-core cell, because cells near a window edge route along the edge
    (the edge acts like a false channel); terrain_v2 then finishes the path with
    the tile that owns that cell."""
    if outlets is None:
        outlets = np.zeros(elev.shape, dtype=np.bool_)
    if core is None:
        core = valid
    rec = d8_receivers(routing_dem, valid, outlets)
    flat = np.where(valid, routing_dem, np.inf).ravel()
    order = np.argsort(flat, kind="stable").astype(np.int64)
    order = order[np.isfinite(flat[order])]
    st = (stream | outlets) & valid
    hnd, drain, term = _hand(np.where(valid, elev, 0.0).astype(np.float64), rec, st.astype(np.bool_),
                             valid.astype(np.bool_), np.asarray(core, dtype=np.bool_), order)
    return hnd, term


def hand(elev: np.ndarray, routing_dem: np.ndarray, valid: np.ndarray, stream: np.ndarray,
         outlets: np.ndarray | None = None) -> np.ndarray:
    """Height Above Nearest Drainage along D8 paths of the routing DEM.

    Heights come from `elev` (the breached DEM), not the epsilon-filled routing
    surface, so a lot inside a filled depression gets its true (possibly
    negative) height relative to the channel it eventually drains to. Inlets
    count as drainage. NaN where the path leaves the grid without meeting a
    channel (terrain_v2 links those paths across tiles).
    """
    return hand_full(elev, routing_dem, valid, stream, outlets)[0]
