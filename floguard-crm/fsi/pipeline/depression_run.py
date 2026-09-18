"""Closed-basin term: depression depth = filled DEM - raw DEM, per parcel.

HAND measures height above *flowing* drainage, so a parcel in a closed basin
(the Deltona / DeBary lake pattern) reads as high ground even though water
has nowhere to go. Wang & Liu fill raises every sink to its spill elevation;
the difference is how deep the bowl is at that cell.

    python fsi/pipeline/depression_run.py

Inputs  (fsi/data/):  terrain/dem_utm.tif (from terrain_run.py), parcel_centroids.csv
Outputs (fsi/data/):  terrain/depr.tif, parcel_depression.csv  parcel_id,depr_m,depr_n
"""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
import rasterio

import terrain_run as T

DEPR = T.OUT / "depr.tif"
FILLED = T.OUT / "filled_tmp.tif"
RESULT = T.DATA / "parcel_depression.csv"
DEPR_CAP_M = 1.0  # a bowl 1 m deep at the lot is the top of the scale
SAMPLE_HALF = 1   # 3x3 window; take the MAX depth in it — a lot on the bowl edge still drains into it


def build_depth() -> None:
    if DEPR.exists():
        T.log("depr.tif exists, skipping")
        return
    import whitebox

    dem = T.OUT / "dem_utm.tif"
    wbt = whitebox.WhiteboxTools()
    wbt.set_verbose_mode(False)
    wbt.set_working_dir(str(T.OUT))
    T.log("fill depressions (Wang & Liu) for depth")
    wbt.fill_depressions_wang_and_liu(str(dem), str(FILLED), fix_flats=False)
    T.log("depth = filled - raw")
    with rasterio.open(FILLED) as f, rasterio.open(dem) as d:
        filled = f.read(1).astype("float32")
        raw = d.read(1).astype("float32")
        meta = d.meta.copy()
        nod = d.nodata
    depth = filled - raw
    bad = ~np.isfinite(depth) | (raw == nod) | (filled == f.nodata if f.nodata is not None else False)
    depth[bad] = -9999.0
    depth[(~bad) & (depth < 0)] = 0.0
    del filled, raw
    meta.update(dtype="float32", nodata=-9999.0, compress="lzw", tiled=True)
    with rasterio.open(DEPR, "w", **meta) as dst:
        dst.write(depth, 1)
    del depth
    FILLED.unlink(missing_ok=True)
    T._stats(DEPR, "depr")


def sample() -> None:
    from pyproj import Transformer

    rows = []
    with T.CENTROIDS.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                rows.append((r["parcel_id"], float(r["lat"]), float(r["lon"])))
            except (KeyError, ValueError):
                continue
    T.log(f"{len(rows)} centroids")
    to_utm = Transformer.from_crs("EPSG:4326", T.UTM, always_xy=True)
    out = []
    with rasterio.open(DEPR) as ds:
        band = ds.read(1)
        for i, (pid, lat, lon) in enumerate(rows):
            x, y = to_utm.transform(lon, lat)
            if not (ds.bounds.left <= x <= ds.bounds.right and ds.bounds.bottom <= y <= ds.bounds.top):
                continue
            row, col = ds.index(x, y)
            r0, r1 = max(0, row - SAMPLE_HALF), min(ds.height, row + SAMPLE_HALF + 1)
            c0, c1 = max(0, col - SAMPLE_HALF), min(ds.width, col + SAMPLE_HALF + 1)
            win = band[r0:r1, c0:c1]
            win = win[(win != -9999.0) & np.isfinite(win)]
            if not win.size:
                continue
            out.append((pid, float(win.max())))
            if i % 100000 == 0:
                T.log(f"  sampled {i}")
    d = np.array([o[1] for o in out])
    T.log(
        f"{len(out)} parcels; depth>0: {100 * (d > 0).mean():.1f}%  "
        f"p50/90/98/max = {np.percentile(d, 50):.2f}/{np.percentile(d, 90):.2f}/{np.percentile(d, 98):.2f}/{d.max():.2f} m"
    )
    dn = np.clip(d / DEPR_CAP_M, 0, 1)
    with RESULT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["parcel_id", "depr_m", "depr_n"])
        for (pid, dm), n in zip(out, dn):
            w.writerow([pid, f"{dm:.3f}", f"{n:.4f}"])
    T.log(f"wrote {RESULT}")


if __name__ == "__main__":
    build_depth()
    sample()
