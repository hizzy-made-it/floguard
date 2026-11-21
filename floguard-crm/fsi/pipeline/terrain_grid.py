"""Keep the source LiDAR resolution distinct from the terrain processing grid."""

from collections import Counter
from math import isfinite


def grid_cell(value, *, fallback=None):
    """A valid grid cell is finite and positive; never silently reinterpret bad input."""
    value = fallback if value is None else value
    if isinstance(value, bool):
        raise ValueError("grid_cell_m must be finite and positive")
    try:
        cell = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("grid_cell_m must be finite and positive") from exc
    if not isfinite(cell) or cell <= 0:
        raise ValueError("grid_cell_m must be finite and positive")
    return cell


def flow_seam_status(diag):
    """Record processing-run convergence without claiming which individual lots moved."""
    rem = [diag.get("residual_cells"), diag.get("residual_mfd_cells")]
    if any(not isinstance(x, (float, int)) or not isfinite(x) or x < 0 for x in rem):
        return "unknown"
    return "residual" if any(x > 0 for x in rem) else "converged"


def resolution_summary(rows):
    """Count source, processing grid and effective output independently (>=50% source coverage)."""
    cells = [grid_cell(r["fsi_inputs"]["grid_cell_m"]) for r in rows]
    source_1m = [(r.get("dem_1m_frac") or 0) >= 0.5 for r in rows]
    share = sum(source_1m) / len(rows) if rows else None
    return {
        "dem_1m_share": share,
        "dem_source_1m_share": share,
        "flow_seam_status_counts": dict(sorted(Counter(r["fsi_inputs"].get("flow_seam_status") or "unknown" for r in rows).items())),
        "grid_cell_m_counts": {f"{k:g}": n for k, n in sorted(Counter(cells).items())},
        "effective_1m_share": (
            sum(native and cell <= 1 for native, cell in zip(source_1m, cells)) / len(rows)
            if rows else None
        ),
    }
