"""SSURGO soil terms per parcel: effective hydrologic group, drainage class,
saturated hydraulic conductivity and seasonal high water table depth.

v1 used only the hydrologic soil group. In Volusia that is not enough: the
sandy flatwoods soils are group A (fast-draining sand) on paper but carry a
water table at 0-30 cm for months, so yards stand in water after any rain.
The water-table depth and drainage class carry that; ksat separates sand from
clay where the water table is deep.

Source: USDA NRCS Soil Data Access (SDA).
  Tabular endpoint (confirmed 2026-11-19 with a live FL127 query):
      POST https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest
      body {"query": "<T-SQL>", "format": "JSON+COLUMNNAME"}
      -> {"Table": [[col names], [row], ...]}
  Spatial: the same endpoint returns map-unit polygons as WKT
      SELECT mukey, mupolygongeo.STAsText() FROM mupolygon WHERE areasymbol='FL127'
  (WGS84). Large; fetch_mupolygons() pages by mukey. Alternatively download the
  FL127 SSURGO package from Web Soil Survey and pass soilmu_a_fl127.shp.

Units: wtdepannmin is cm (NULL = no water table within 200 cm; we store 2.0 m,
the bottom of the reported range). ksat_r is micrometres per second.

Dual groups (A/D, B/D, C/D) are resolved to D: see config_v2.hsg_effective().
"""

from __future__ import annotations

import json
import math
from pathlib import Path

SDA_URL = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"
WT_NULL_M = 2.0

TABULAR_SQL = """
SELECT mu.mukey, mu.muname, ma.hydgrpdcd, ma.drclassdcd, ma.wtdepannmin, ma.wtdepaprjunmin,
  (SELECT TOP 1 MIN(ch.ksat_r) FROM component c INNER JOIN chorizon ch ON ch.cokey = c.cokey
     WHERE c.mukey = mu.mukey AND c.majcompflag = 'Yes' AND ch.hzdept_r < 100
     GROUP BY c.cokey, c.comppct_r ORDER BY c.comppct_r DESC) AS ksat_min_top100
FROM legend l
INNER JOIN mapunit mu ON mu.lkey = l.lkey
INNER JOIN muaggatt ma ON ma.mukey = mu.mukey
WHERE l.areasymbol = '{areasymbol}'
"""
# ksat: the MINIMUM ksat_r of the dominant major component's horizons starting
# in the top 100 cm. The slowest layer controls how fast a yard drains; a sand
# over a clay pan drains like the pan.


def sda_query(sql: str, client=None) -> list[dict]:
    """Run T-SQL against SDA, return rows as dicts."""
    import httpx

    own = client is None
    client = client or httpx.Client(timeout=180.0)
    try:
        r = client.post(SDA_URL, json={"query": sql, "format": "JSON+COLUMNNAME"})
        r.raise_for_status()
        return parse_sda(r.json())
    finally:
        if own:
            client.close()


def parse_sda(payload: dict) -> list[dict]:
    t = (payload or {}).get("Table") or []
    if not t:
        return []
    cols = t[0]
    return [dict(zip(cols, row)) for row in t[1:]]


def _f(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def mukey_attributes(rows: list[dict]) -> dict[str, dict]:
    """Normalise SDA tabular rows -> {mukey: {hsg, drain_class, ksat_um_s, wt_depth_m}}."""
    out = {}
    for r in rows:
        wt = _f(r.get("wtdepannmin"))
        out[str(r["mukey"])] = {
            "hsg": (r.get("hydgrpdcd") or None),
            "drain_class": (r.get("drclassdcd") or None),
            "ksat_um_s": _f(r.get("ksat_min_top100")),
            "wt_depth_m": WT_NULL_M if wt is None else wt / 100.0,
            "muname": r.get("muname"),
        }
    return out


def fetch_tabular(areasymbol: str = "FL127") -> dict[str, dict]:
    return mukey_attributes(sda_query(TABULAR_SQL.format(areasymbol=areasymbol)))


def fetch_mupolygons(mukeys: list[str], out_path: Path, chunk: int = 20):
    """Download map-unit polygons for the given mukeys to a GeoPackage (EPSG:4326)."""
    import geopandas as gpd
    from shapely import wkt

    recs = []
    for i in range(0, len(mukeys), chunk):
        ks = ",".join(f"'{k}'" for k in mukeys[i:i + chunk] if str(k).isdigit())
        rows = sda_query(f"SELECT mukey, mupolygongeo.STAsText() AS wkt FROM mupolygon WHERE mukey IN ({ks})")
        recs.extend({"mukey": str(r["mukey"]), "geometry": wkt.loads(r["wkt"])} for r in rows)
        print(f"  mupolygon {min(i + chunk, len(mukeys))}/{len(mukeys)} keys, {len(recs)} polygons", flush=True)
    gdf = gpd.GeoDataFrame(recs, geometry="geometry", crs="EPSG:4326")
    gdf.to_file(out_path, driver="GPKG")
    return gdf


def fetch_mupolygons_bbox(bbox, areasymbol: str, out_path: Path):
    """Map-unit polygons intersecting a lon/lat box (pilot areas)."""
    import geopandas as gpd
    from shapely import wkt

    w, s, e, n = (float(v) for v in bbox)
    poly = f"POLYGON(({w} {s}, {e} {s}, {e} {n}, {w} {n}, {w} {s}))"
    rows = sda_query(
        "SELECT mukey, mupolygongeo.STAsText() AS wkt FROM mupolygon "
        f"WHERE areasymbol = '{areasymbol}' AND mupolygongeo.STIntersects(geometry::STGeomFromText('{poly}', 4326)) = 1")
    gdf = gpd.GeoDataFrame([{"mukey": str(r["mukey"]), "geometry": wkt.loads(r["wkt"])} for r in rows],
                           geometry="geometry", crs="EPSG:4326")
    gdf.to_file(out_path, driver="GPKG")
    return gdf


def parcel_soils(parcels, soils, attrs: dict[str, dict], drained_ids: set[str] | None = None) -> dict[str, dict]:
    """Area-weighted soil terms per parcel.

    parcels: GeoDataFrame [parcel_id, geometry]; soils: GeoDataFrame [mukey, geometry];
    both in the same metric CRS. Returns {parcel_id: {...}} with
      hsg (raw dominant), hsg_eff, hsg_dual, drain_class (dominant by area),
      ksat_um_s (area-weighted geometric mean), wt_depth_m (area-weighted mean),
      soil_cov (fraction of the lot with SSURGO data).
    """
    import geopandas as gpd

    from .config_v2 import hsg_effective

    drained_ids = drained_ids or set()
    p = parcels[["parcel_id", "geometry"]].copy()
    p["lot_area"] = p.geometry.area
    ov = gpd.overlay(p, soils[["mukey", "geometry"]], how="intersection", keep_geom_type=True)
    ov["a"] = ov.geometry.area
    out: dict[str, dict] = {}
    lot_area = dict(zip(p.parcel_id, p.lot_area))
    for pid, g in ov.groupby("parcel_id"):
        tot = g["a"].sum()
        by_key = g.groupby("mukey")["a"].sum().sort_values(ascending=False)
        dom = attrs.get(str(by_key.index[0]), {})
        ks, ws, wts, wws = 0.0, 0.0, 0.0, 0.0
        for mk, a in by_key.items():
            at = attrs.get(str(mk))
            if not at:
                continue
            if at.get("ksat_um_s") and at["ksat_um_s"] > 0:
                ks += a * math.log(at["ksat_um_s"])
                ws += a
            if at.get("wt_depth_m") is not None:
                wts += a * at["wt_depth_m"]
                wws += a
        eff, dual = hsg_effective(dom.get("hsg"), drained=pid in drained_ids)
        out[pid] = {
            "hsg": dom.get("hsg"),
            "hsg_eff": eff,
            "hsg_dual": dual,
            "drain_class": dom.get("drain_class"),
            "ksat_um_s": math.exp(ks / ws) if ws > 0 else None,
            "wt_depth_m": wts / wws if wws > 0 else None,
            "soil_cov": min(1.0, tot / lot_area[pid]) if lot_area.get(pid) else None,
        }
    return out


def save_json(obj, path: Path) -> None:
    Path(path).write_text(json.dumps(obj))
