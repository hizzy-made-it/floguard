"""Pull Volusia parcel polygons to a local GeoPackage for zonal statistics.

scripts/ingest-volusia-parcels.mjs keeps only centroids in parcel_risk (and
pull_centroids.mjs generalises geometry to ~20 m to shrink the payload). Zonal
stats need the real lot line, so this pulls full-precision polygons straight
from the appraiser layer to fsi/data/v2/parcels.gpkg. It does not touch the
database or the JS ingest.

    python -m pipeline.parcel_polygons                # full county, ~315 pages
    python -m pipeline.parcel_polygons --limit 2000   # smoke test

Output layer `parcels`: parcel_id (PARID), geometry (EPSG:4326, MultiPolygon).
Duplicate PARIDs (condo stacks share a footprint) are dissolved to one row.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .sources import PARCEL_LAYER, arcgis_features

DATA = Path(__file__).resolve().parent.parent / "data" / "v2"


def pull(out: Path, limit: int | None = None, layer_url: str = PARCEL_LAYER, bbox=None) -> int:
    import geopandas as gpd
    from shapely.geometry import shape

    recs = []
    for f in arcgis_features(layer_url, out_fields="PARID", page=1000, bbox=bbox):
        pid = str((f.get("properties") or {}).get("PARID") or "").strip()
        g = f.get("geometry")
        if not pid or not g:
            continue
        geom = shape(g)
        if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
        recs.append({"parcel_id": pid, "geometry": geom})
        if limit and len(recs) >= limit:
            break
    gdf = gpd.GeoDataFrame(recs, geometry="geometry", crs="EPSG:4326")
    gdf = gdf.dissolve(by="parcel_id", as_index=False)
    out.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(out, driver="GPKG", layer="parcels")
    print(f"wrote {len(gdf)} parcels -> {out}")
    return len(gdf)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DATA / "parcels.gpkg")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--bbox", type=float, nargs=4, metavar=("W", "S", "E", "N"))
    a = ap.parse_args()
    pull(a.out, a.limit, bbox=a.bbox)


if __name__ == "__main__":
    main()
