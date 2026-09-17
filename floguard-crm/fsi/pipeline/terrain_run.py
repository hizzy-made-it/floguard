"""Real terrain batch: USGS 3DEP DEM -> TWI + HAND per parcel.

Implements the sequence documented in terrain.py against actual data. First run
uses the 1/3 arc-second (~10 m) seamless product: four tiles cover Volusia and
the whole county fits in memory. The 1 m LiDAR product is ~100 tiles and
20 GB; step up to it later for must-band neighbourhoods if 10 m proves out.

    python fsi/pipeline/terrain_run.py            # full run
    python fsi/pipeline/terrain_run.py --skip-wbt # reuse rasters, redo sampling

Inputs  (fsi/data/):  dem/USGS_13_*.tif, parcel_centroids.csv
Outputs (fsi/data/):  terrain/{dem,dem_utm,twi,hand}.tif (intermediates deleted)
                      parcel_terrain.csv  parcel_id,twi,hand,twi_n,hand_n
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.windows import from_bounds

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
DEM_DIR = DATA / "dem"
OUT = DATA / "terrain"
CENTROIDS = DATA / "parcel_centroids.csv"
RESULT = DATA / "parcel_terrain.csv"

# Volusia bbox with a 0.03 deg margin so flow paths near the edge are not cut.
W, S, E, N = -81.70, 28.58, -80.70, 29.46

# Cells of specific contributing area above which a cell is a channel (HAND).
# 10 m cells: 5000 cells ~ 0.5 km2 upslope. Tune against visible ditches.
STREAM_THRESHOLD = 5000
MIN_SLOPE_RAD = 0.001
CLIP_PCT = (2.0, 98.0)
SAMPLE_HALF = 1  # 3x3 window (~30 m) around the centroid ~ one lot


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def mosaic_clip() -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    dem = OUT / "dem.tif"
    if dem.exists():
        log(f"dem.tif exists, skipping mosaic")
        return dem
    tiles = sorted(DEM_DIR.glob("USGS_13_*.tif"))
    if len(tiles) < 4:
        sys.exit(f"expected 4 tiles in {DEM_DIR}, found {len(tiles)}")
    log(f"mosaic {len(tiles)} tiles, clip to {W},{S},{E},{N}")
    srcs = [rasterio.open(t) for t in tiles]
    arr, transform = merge(srcs, bounds=(W, S, E, N))
    meta = srcs[0].meta.copy()
    for s in srcs:
        s.close()
    arr = arr[0].astype("float32")
    nodata = -9999.0
    arr[~np.isfinite(arr)] = nodata
    meta.update(
        driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
        dtype="float32", transform=transform, nodata=nodata, compress="lzw", tiled=True,
    )
    with rasterio.open(dem, "w", **meta) as dst:
        dst.write(arr, 1)
    log(f"dem.tif {arr.shape[1]}x{arr.shape[0]} px")
    return dem


# Volusia sits in UTM zone 17N. The 3DEP tiles are lat/lon (EPSG:4326): running
# flow accumulation on a degree grid gave specific contributing areas in
# degrees, TWI around -2 instead of ~8, and zero stream cells above the
# threshold (HAND 100% nodata). Everything downstream needs metres.
UTM = "EPSG:26917"
CELL_M = 10.0


def reproject_utm(dem_ll: Path) -> Path:
    from rasterio.warp import Resampling, calculate_default_transform, reproject

    out = OUT / "dem_utm.tif"
    if out.exists():
        log("dem_utm.tif exists, skipping reprojection")
        return out
    log(f"reproject dem.tif -> {UTM} at {CELL_M:g} m")
    with rasterio.open(dem_ll) as src:
        transform, width, height = calculate_default_transform(
            src.crs, UTM, src.width, src.height, *src.bounds, resolution=(CELL_M, CELL_M)
        )
        meta = src.meta.copy()
        meta.update(crs=UTM, transform=transform, width=width, height=height,
                    nodata=-9999.0, dtype="float32", compress="lzw", tiled=True)
        with rasterio.open(out, "w", **meta) as dst:
            reproject(
                source=rasterio.band(src, 1), destination=rasterio.band(dst, 1),
                src_transform=src.transform, src_crs=src.crs, src_nodata=src.nodata,
                dst_transform=transform, dst_crs=UTM, dst_nodata=-9999.0,
                resampling=Resampling.bilinear,
            )
    log(f"dem_utm.tif {width}x{height} px")
    return out


def _stats(path: Path, label: str) -> None:
    with rasterio.open(path) as d:
        a = d.read(1)
        ok = np.isfinite(a) & (a != d.nodata) & (a != -9999.0)
        v = a[ok]
        pct = np.round(np.percentile(v, [1, 25, 50, 75, 99]), 2) if v.size else None
        log(f"  {label}: valid {100 * ok.mean():.1f}%  p1/25/50/75/99 = {pct}")


def run_wbt(dem: Path) -> dict[str, Path]:
    """WhiteboxTools chain. Intermediates are deleted as soon as the next stage
    no longer needs them: the six full-county rasters total ~4 GB and the
    machine ran out of disk on the first attempt. Peak here is ~2.5 GB."""
    import whitebox

    wbt = whitebox.WhiteboxTools()
    wbt.set_verbose_mode(False)
    wbt.set_working_dir(str(OUT))
    paths = {k: OUT / f"{k}.tif" for k in ("filled", "sca", "slope", "streams", "hand", "twi")}

    # Least-cost breaching (terrain.py docstring) ran >15 min on the 100 Mpx
    # county DEM with nothing written. Wang & Liu fill with flat fixing is
    # minutes and is the standard choice for TWI on flat coastal terrain.
    log("fill depressions (Wang & Liu, fix flats)")
    wbt.fill_depressions_wang_and_liu(str(dem), str(paths["filled"]), fix_flats=True)
    log("D-infinity flow accumulation -> specific contributing area")
    wbt.d_inf_flow_accumulation(str(paths["filled"]), str(paths["sca"]), out_type="Specific Contributing Area")
    log("slope (degrees)")
    wbt.slope(str(paths["filled"]), str(paths["slope"]), units="degrees")

    log("TWI = ln(sca / tan(slope))")
    with rasterio.open(paths["sca"]) as s, rasterio.open(paths["slope"]) as sl:
        sca = s.read(1).astype("float64")
        slope = sl.read(1).astype("float64")
        meta = s.meta.copy()
        nod = s.nodata
    tan_b = np.tan(np.maximum(np.deg2rad(slope), MIN_SLOPE_RAD))
    del slope
    twi = np.log(np.maximum(sca, 1e-6) / tan_b).astype("float32")
    bad = ~np.isfinite(twi)
    if nod is not None:
        bad |= sca == nod
    del sca, tan_b
    twi[bad] = -9999.0
    meta.update(dtype="float32", nodata=-9999.0, compress="lzw", tiled=True)
    with rasterio.open(paths["twi"], "w", **meta) as dst:
        dst.write(twi, 1)
    del twi
    paths["slope"].unlink(missing_ok=True)
    _stats(paths["twi"], "twi")

    log("extract streams")
    wbt.extract_streams(str(paths["sca"]), str(paths["streams"]), threshold=STREAM_THRESHOLD)
    paths["sca"].unlink(missing_ok=True)
    log("elevation above stream (HAND)")
    wbt.elevation_above_stream(str(paths["filled"]), str(paths["streams"]), str(paths["hand"]))
    paths["streams"].unlink(missing_ok=True)
    paths["filled"].unlink(missing_ok=True)
    _stats(paths["hand"], "hand")
    return paths


def sample(paths: dict[str, Path]) -> None:
    log(f"sampling parcels from {CENTROIDS}")
    rows = []
    with CENTROIDS.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                rows.append((r["parcel_id"], float(r["lat"]), float(r["lon"])))
            except (KeyError, ValueError):
                continue
    log(f"{len(rows)} centroids")

    def read_window_mean(ds, band, x, y):
        row, col = ds.index(x, y)
        r0, r1 = max(0, row - SAMPLE_HALF), min(ds.height, row + SAMPLE_HALF + 1)
        c0, c1 = max(0, col - SAMPLE_HALF), min(ds.width, col + SAMPLE_HALF + 1)
        if r1 <= r0 or c1 <= c0:
            return None
        win = band[r0:r1, c0:c1]
        win = win[(win != -9999.0) & np.isfinite(win)]
        return float(win.mean()) if win.size else None

    from pyproj import Transformer

    to_utm = Transformer.from_crs("EPSG:4326", UTM, always_xy=True)
    with rasterio.open(paths["twi"]) as dt, rasterio.open(paths["hand"]) as dh:
        twi_band = dt.read(1)
        hand_band = dh.read(1)
        hand_nod = dh.nodata
        if hand_nod is not None:
            hand_band = np.where(hand_band == hand_nod, -9999.0, hand_band)
        out = []
        for i, (pid, lat, lon) in enumerate(rows):
            x, y = to_utm.transform(lon, lat)
            if not (dt.bounds.left <= x <= dt.bounds.right and dt.bounds.bottom <= y <= dt.bounds.top):
                continue
            t = read_window_mean(dt, twi_band, x, y)
            h = read_window_mean(dh, hand_band, x, y)
            if t is None or h is None:
                continue
            out.append((pid, t, h))
            if i % 50000 == 0:
                log(f"  sampled {i}")

    log(f"{len(out)} parcels with terrain; normalising ({CLIP_PCT[0]}–{CLIP_PCT[1]} pct clip)")
    twi_v = np.array([o[1] for o in out])
    hand_v = np.array([o[2] for o in out])

    def norm(v):
        lo, hi = np.percentile(v, CLIP_PCT)
        span = (hi - lo) or 1.0
        return np.clip((v - lo) / span, 0, 1), lo, hi

    twi_n, tlo, thi = norm(twi_v)
    hand_n, hlo, hhi = norm(hand_v)
    log(f"twi clip [{tlo:.2f}, {thi:.2f}]  hand clip [{hlo:.2f}, {hhi:.2f}] m")

    with RESULT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["parcel_id", "twi", "hand", "twi_n", "hand_n"])
        for (pid, t, h), tn, hn in zip(out, twi_n, hand_n):
            w.writerow([pid, f"{t:.3f}", f"{h:.3f}", f"{tn:.4f}", f"{hn:.4f}"])
    log(f"wrote {RESULT}")
    log(
        "twi_n quartiles "
        + ", ".join(f"{q:.2f}" for q in np.percentile(twi_n, [25, 50, 75]))
        + " · hand_n quartiles "
        + ", ".join(f"{q:.2f}" for q in np.percentile(hand_n, [25, 50, 75]))
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-wbt", action="store_true", help="reuse existing terrain rasters")
    args = ap.parse_args()
    dem = reproject_utm(mosaic_clip())
    if args.skip_wbt:
        paths = {k: OUT / f"{k}.tif" for k in ("filled", "sca", "slope", "streams", "hand", "twi")}
    else:
        paths = run_wbt(dem)
    sample(paths)


if __name__ == "__main__":
    main()
