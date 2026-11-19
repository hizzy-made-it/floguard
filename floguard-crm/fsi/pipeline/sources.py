"""Public data access for terrain v2. Every endpoint below was hit live on
2026-11-19 from this repo's build environment (curl) and returned data:

USGS 3DEP via The National Map (TNM) Access API
    GET https://tnmaccess.nationalmap.gov/api/v1/products
        ?bbox=W,S,E,N&datasets=<name>&max=<n>&offset=<k>&outputFormat=JSON
    -> {"total": n, "items": [{title, downloadURL, sizeInBytes, publicationDate,
        boundingBox{minX,maxX,minY,maxY}, ...}]}
    datasets used:
      "Digital Elevation Model (DEM) 1 meter"      1 m LiDAR DEM, UTM, 10 km tiles
      "National Elevation Dataset (NED) 1/3 arc-second"   ~10 m seamless, 1x1 degree
    For Volusia (bbox -81.68,28.61,-80.73,29.43) the 1 m query returned 115
    tiles, 31.9 GB, from 4 overlapping projects: FL_Peninsular_2018_D18 (80),
    FL_Peninsular_FDEM_2018_D19_DRRA (21), FL_Upper_Saint_Johns_2017 (12),
    FL_2017PalmCoast_C22 (2). select_1m_tiles() keeps the newest per tile.
    The downloadURL values point at the public S3 bucket
      https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/<project>/TIFF/USGS_1M_17_x<..>y<...>_<project>.tif
      https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/historical/n30w082/USGS_13_n30w082_<date>.tif
    (s3://prd-tnm, us-west-2, anonymous; `aws s3 cp --no-sign-request` also works).

USGS Watershed Boundary Dataset, HUC12
    https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6
    fields include huc12, name, tohuc, areasqkm.

USGS NHD flowlines (large scale = high resolution)
    https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6

Volusia parcel polygons (property appraiser, public record)
    https://maps2.vcgov.org/arcgis/rest/services/Pictometry_Parcels/MapServer/0
    (same layer as scripts/ingest-volusia-parcels.mjs; id field PARID)

Street centrelines: Census TIGER/Line roads for Volusia (12127)
    https://www2.census.gov/geo/tiger/TIGER2024/ROADS/tl_2024_12127_roads.zip
    (or the county road centreline layer if the owner has it).
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

TNM_URL = "https://tnmaccess.nationalmap.gov/api/v1/products"
DS_1M = "Digital Elevation Model (DEM) 1 meter"
DS_13 = "National Elevation Dataset (NED) 1/3 arc-second"
WBD_HUC12_LAYER = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6"
NHD_FLOWLINE_LAYER = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6"
PARCEL_LAYER = "https://maps2.vcgov.org/arcgis/rest/services/Pictometry_Parcels/MapServer/0"
TIGER_ROADS_URL = "https://www2.census.gov/geo/tiger/TIGER2024/ROADS/tl_2024_12127_roads.zip"

VOLUSIA_BBOX = (-81.68, 28.61, -80.73, 29.43)  # W, S, E, N (county + ~3 km)
UTM17 = "EPSG:26917"

_TILE_RE = re.compile(r"USGS_1M_\d+_(x\d+y\d+)_")


def _client(timeout=120.0):
    import httpx

    return httpx.Client(timeout=timeout, follow_redirects=True)


def tnm_products(bbox, dataset: str, page: int = 100, client=None) -> list[dict]:
    own = client is None
    client = client or _client()
    out, offset = [], 0
    try:
        while True:
            r = client.get(TNM_URL, params={
                "bbox": ",".join(f"{v:.5f}" for v in bbox), "datasets": dataset,
                "max": page, "offset": offset, "outputFormat": "JSON"})
            r.raise_for_status()
            j = r.json()
            items = j.get("items") or []
            out.extend(items)
            offset += len(items)
            if not items or offset >= int(j.get("total") or 0):
                return out
    finally:
        if own:
            client.close()


def tile_code(url_or_title: str) -> str | None:
    m = _TILE_RE.search(url_or_title)
    return m.group(1) if m else None


def select_1m_tiles(items: list[dict]) -> list[dict]:
    """One item per 10 km tile code: the newest publication (ties: largest file).
    Returned oldest-first, so compositing in order lets newer data win where
    neighbouring tiles' 6 m overlap buffers disagree."""
    best: dict[str, dict] = {}
    for it in items:
        code = tile_code(it.get("downloadURL", "")) or it.get("title")
        key = (it.get("publicationDate") or "", it.get("sizeInBytes") or 0)
        cur = best.get(code)
        if cur is None or key > (cur.get("publicationDate") or "", cur.get("sizeInBytes") or 0):
            best[code] = it
    return sorted(best.values(), key=lambda i: i.get("publicationDate") or "")


def select_13_tiles(items: list[dict]) -> list[dict]:
    """Newest 1/3 arc-second item per 1x1 degree cell (n30w082 etc.)."""
    best: dict[str, dict] = {}
    for it in items:
        m = re.search(r"(n\d+w\d+)", it.get("downloadURL", ""))
        code = m.group(1) if m else it.get("title")
        if code not in best or (it.get("publicationDate") or "") > (best[code].get("publicationDate") or ""):
            best[code] = it
    return sorted(best.values(), key=lambda i: i.get("publicationDate") or "")


def download(url: str, dest: Path, expected_size: int | None = None, client=None, retries: int = 3) -> Path:
    """Stream a file to dest; skip if it already exists with the expected size. Retries 3x."""
    dest = Path(dest)
    if dest.exists() and (expected_size is None or dest.stat().st_size == expected_size):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    own = client is None
    client = client or _client(timeout=600.0)
    try:
        for attempt in range(retries):
            try:
                tmp = dest.with_suffix(dest.suffix + ".part")
                with client.stream("GET", url) as r:
                    r.raise_for_status()
                    with tmp.open("wb") as f:
                        for chunk in r.iter_bytes(1 << 20):
                            f.write(chunk)
                tmp.replace(dest)
                return dest
            except Exception:
                if attempt == retries - 1:
                    raise
                time.sleep(5 * (attempt + 1))
    finally:
        if own:
            client.close()
    return dest


def arcgis_features(layer_url: str, *, where: str = "1=1", out_fields: str = "*",
                    bbox=None, page: int = 1000, order_by: str | None = "OBJECTID",
                    client=None, log=print):
    """Yield GeoJSON features (EPSG:4326) from an ArcGIS REST layer, paged by offset."""
    own = client is None
    client = client or _client()
    offset = 0
    try:
        while True:
            params = {"where": where, "outFields": out_fields, "outSR": 4326, "f": "geojson",
                      "resultOffset": offset, "resultRecordCount": page, "returnGeometry": "true"}
            if order_by:
                params["orderByFields"] = order_by
            if bbox is not None:
                params.update({"geometry": ",".join(str(v) for v in bbox), "geometryType": "esriGeometryEnvelope",
                               "inSR": 4326, "spatialRel": "esriSpatialRelIntersects"})
            for attempt in range(3):
                try:
                    r = client.get(layer_url.rstrip("/") + "/query", params=params)
                    r.raise_for_status()
                    j = r.json()
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(3 * (attempt + 1))
            feats = j.get("features") or []
            yield from feats
            offset += len(feats)
            if log and offset % 20000 < page:
                log(f"  {layer_url.rsplit('/', 3)[-3]} offset {offset}")
            if not feats or (len(feats) < page and not j.get("exceededTransferLimit")):
                return
    finally:
        if own:
            client.close()


def features_to_gpkg(features, path: Path, keep: list[str] | None = None, layer: str | None = None):
    import geopandas as gpd

    feats = list(features)
    if keep:
        for f in feats:
            p = f.get("properties") or {}
            f["properties"] = {k: p.get(k) for k in keep}
    gdf = gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(path, driver="GPKG", layer=layer)
    return gdf


def save_manifest(items: list[dict], path: Path) -> None:
    keep = ("title", "downloadURL", "sizeInBytes", "publicationDate", "boundingBox")
    Path(path).write_text(json.dumps([{k: i.get(k) for k in keep} for i in items], indent=1))
