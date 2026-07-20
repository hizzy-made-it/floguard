"""One-time static terrain precompute: TWI, HAND, soil, FEMA zone -> fsi_static.

STATUS: SCAFFOLD -- NOT RUN. The WhiteboxTools sequence below is written from
documented tool names but has never been executed against real Volusia data.
Every raster step is unverified until it runs end to end once. Do not treat
the numbers it would produce as trustworthy before that.

This is the heavy half of the system and the reason the architecture splits
static from dynamic. Per-parcel TWI over LiDAR rasters cannot run inside a
serverless function per request -- attempting that is the main way this
project stalls (spec section 6). It runs here, offline. The map reads rows.

Pipeline shape:

    DEM (USGS 3DEP, 1 m)
      -> breach depressions           sinks left in place make TWI garbage
      -> D-infinity flow accumulation -> a
      -> slope                        -> tan B
      -> TWI = ln(a / tan B)
      -> extract streams -> HAND

    parcels (county appraiser)
      -> zonal mean of TWI and HAND per polygon
      -> spatial join SSURGO -> hsg
      -> spatial join NFHL   -> fema_zone
      -> percentile-clip normalize across the county
      -> static_score() -> fsi_static

Inputs live under fsi/data/ and are gitignored. Fetch them with the ingest
scripts; never commit multi-gigabyte rasters.
"""

from __future__ import annotations

import math
from pathlib import Path

from .config import static_score

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

DEM_PATH = DATA_DIR / "volusia_dem_1m.tif"
PARCELS_PATH = DATA_DIR / "volusia_parcels.gpkg"
SSURGO_PATH = DATA_DIR / "ssurgo_volusia.gpkg"
NFHL_PATH = DATA_DIR / "nfhl_volusia.gpkg"

# Flow-accumulation cell count above which a cell counts as a drainage channel,
# for HAND. Tune against visible ditches and canals on aerial imagery. Too low
# and every shallow swale becomes "drainage", which flattens HAND toward zero
# everywhere and silently kills the w2 term.
STREAM_THRESHOLD_CELLS = 5000

# Slope floor in radians before dividing. Perfectly flat cells are common in
# coastal Florida and would divide by zero, poisoning the raster with inf.
MIN_SLOPE_RAD = 0.001

# Percentile clip applied before 0-1 scaling. Raw TWI has a long right tail
# over open water and canals; unclipped min/max scaling compresses every
# residential parcel into the bottom of the range.
CLIP_PERCENTILES = (1.0, 99.0)


def build_terrain_rasters(dem: Path, out_dir: Path) -> dict[str, Path]:
    """Derive TWI and HAND rasters from a DEM.

    Intended WhiteboxTools sequence:

        wbt.breach_depressions_least_cost(dem, filled, dist=100)
        wbt.d_inf_flow_accumulation(filled, sca, out_type="specific contributing area")
        wbt.slope(filled, slope_deg)
        # TWI = ln(sca / tan(slope)), with slope floored at MIN_SLOPE_RAD
        wbt.extract_streams(sca, streams, threshold=STREAM_THRESHOLD_CELLS)
        wbt.elevation_above_stream(filled, streams, hand)

    Returns paths keyed 'twi' and 'hand'.
    """
    raise NotImplementedError(
        "terrain raster derivation not implemented -- see docstring for the "
        "intended WhiteboxTools sequence"
    )


def twi_from_arrays(sca, slope_rad):
    """TWI = ln(a / tan B), elementwise, with the flat-cell guard applied.

    Kept separate from the raster plumbing so it is unit-testable without GDAL.
    """
    tan_b = math.tan(max(slope_rad, MIN_SLOPE_RAD))
    return math.log(max(sca, 1e-6) / tan_b)


def zonal_stats_to_parcels(twi: Path, hand: Path, parcels: Path):
    """Mean TWI and HAND per parcel polygon.

    Mean, not min or max: one anomalous cell on a parcel edge -- a road ditch
    clipped into the polygon -- would dominate an extremum and rank a dry lot
    as high risk.
    """
    raise NotImplementedError("zonal statistics not implemented")


def normalize_county(values):
    """Percentile-clip to CLIP_PERCENTILES, then scale to 0-1."""
    raise NotImplementedError("county normalization not implemented")


def compute_fsi_static(twi_n: float, hand_n: float, hsg: str | None, zone: str | None) -> float:
    """Thin wrapper so the batch writes S through the same code path as the API."""
    return static_score(twi_n, hand_n, hsg, zone)


def main() -> None:
    raise NotImplementedError(
        "static terrain precompute is a scaffold. Build order per spec section 7: "
        "1) parcel ingest, 2) this module, 3) rainfall cron, 4) map surface."
    )


if __name__ == "__main__":
    main()
