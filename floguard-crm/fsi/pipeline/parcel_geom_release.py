"""Build the parcel polygon release that sql/024 loads into parcel_risk.geom.

    python -m pipeline.parcel_polygons                       # data/v2/parcels.gpkg
    python -m pipeline.parcel_geom_release --tag parcel-geom-2026-11-19

Writes fsi/releases/<tag>/parcel_geom_NN.json (JSON array of [parcel_id, wkt]),
simplified to ~0.5 m and rounded to 6 decimals, plus manifest.json with row counts
and sha256 per part.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data" / "v2"
RELEASES = HERE.parent / "releases"


def build(src: Path, out: Path, rows_per_part: int = 10000, tol: float = 0.000005) -> dict:
    import geopandas as gpd
    import shapely

    g = gpd.read_file(src, layer="parcels")
    geoms = shapely.simplify(g.geometry.values, tol, preserve_topology=True)
    out.mkdir(parents=True, exist_ok=True)
    parts, rows, skipped = [], [], 0
    for pid, geom in zip(g.parcel_id.astype(str), geoms):
        if geom is None or geom.is_empty:
            skipped += 1
            continue
        rows.append([pid, shapely.to_wkt(geom, rounding_precision=6, trim=True)])
    for i in range(0, len(rows), rows_per_part):
        chunk = rows[i:i + rows_per_part]
        data = json.dumps(chunk, separators=(",", ":")).encode()
        name = f"parcel_geom_{i // rows_per_part:02d}.json"
        (out / name).write_bytes(data)
        parts.append({"file": name, "rows": len(chunk), "bytes": len(data),
                      "sha256": hashlib.sha256(data).hexdigest()})
    manifest = {"source": str(src.name), "rows": len(rows), "skipped_empty": skipped,
                "simplify_deg": tol, "parts": parts}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DATA / "parcels.gpkg")
    ap.add_argument("--tag", required=True)
    ap.add_argument("--rows-per-part", type=int, default=10000)
    a = ap.parse_args()
    m = build(a.src, RELEASES / a.tag, a.rows_per_part)
    print(f"{m['rows']} rows in {len(m['parts'])} parts -> releases/{a.tag}")


if __name__ == "__main__":
    main()
