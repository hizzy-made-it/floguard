"""Terrain v2 county runner. See fsi/RUNBOOK-terrain-v2.md for the full procedure.

    python -m pipeline.terrain_v2_run fetch      # DEM tile lists + downloads, HUC12, NHD, roads
    python -m pipeline.terrain_v2_run plan       # tiles = HUC12 ∩ 5 km chunks, + halo
    python -m pipeline.terrain_v2_run terrain    # phases 1-3 (resumable)
    python -m pipeline.terrain_v2_run zonal      # per-parcel polygon stats + street samples
    python -m pipeline.terrain_v2_run soils      # SSURGO via SDA -> per-parcel soil terms
    python -m pipeline.terrain_v2_run assemble   # neighbours, normalisation, confidence -> release
    python -m pipeline.terrain_v2_run all

Working directory: fsi/data/v2/ (gitignored). Inputs it expects or fetches:
    dem/1m/*.tif, dem/13/*.tif        3DEP (fetch)
    huc12.gpkg, nhd_flowlines.gpkg     USGS hydro services (fetch)
    roads/tl_2024_12127_roads.shp      TIGER roads (fetch)
    parcels.gpkg                       python -m pipeline.parcel_polygons
    optional: --culverts F --inlets F --footprints F   (county stormwater GIS, footprints)

Outputs: fsi/data/v2/release/parcel_terrain_v2.csv and parcel_terrain_v2_NN.json
(row objects for sql/018 terrain_v2_apply), plus run.json with diagnostics.
"""

from __future__ import annotations

import argparse
import json
import math
import time
import zipfile
from pathlib import Path

import numpy as np

from . import _affine as A
from . import confidence as CF
from . import config_v2 as C2
from . import hydro as H
from . import neighbors as NB
from . import sources as SRC
from .terrain_grid import flow_seam_status, grid_cell, resolution_summary
from . import zonal as Z
from .terrain_v2 import DiskStore, TerrainParams, Tile, run_tiles, window_from_cores

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data" / "v2"
RELEASE = DATA / "release"
CLIP_PCT = (2.0, 98.0)
CHUNK_M = 5000.0
AOI_BUFFER_M = 1000.0


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Grid / plan
# ---------------------------------------------------------------------------

def grid_transform(plan: dict):
    from affine import Affine

    return Affine(plan["cell"], 0, plan["x0"], 0, -plan["cell"], plan["y0"])


def window_transform(plan: dict, t: Tile):
    return A.translate(grid_transform(plan), t.col_off, t.row_off)


def make_plan(parcels_path: Path, huc_path: Path, p: TerrainParams, chunk_m: float = CHUNK_M) -> dict:
    import geopandas as gpd
    from shapely.geometry import box

    parcels = gpd.read_file(parcels_path, layer="parcels", columns=[]).to_crs(SRC.UTM17)
    minx, miny, maxx, maxy = parcels.total_bounds
    aoi = box(minx, miny, maxx, maxy).buffer(AOI_BUFFER_M, join_style=2)
    hucs = gpd.read_file(huc_path).to_crs(SRC.UTM17)
    hucs = hucs[hucs.intersects(aoi)]
    cell = p.cell_m
    halo = p.halo_cells * cell
    gx0 = math.floor((aoi.bounds[0] - halo) / cell) * cell
    gy0 = math.ceil((aoi.bounds[3] + halo) / cell) * cell
    ncols = int(math.ceil((aoi.bounds[2] + halo - gx0) / cell))
    nrows = int(math.ceil((gy0 - (aoi.bounds[1] - halo)) / cell))
    tiles = []
    for _, h in hucs.iterrows():
        core = h.geometry.intersection(aoi)
        if core.is_empty:
            continue
        bx0, by0, bx1, by1 = core.bounds
        nx = max(1, int(math.ceil((bx1 - bx0) / chunk_m)))
        ny = max(1, int(math.ceil((by1 - by0) / chunk_m)))
        for i in range(nx):
            for j in range(ny):
                sq = box(bx0 + i * chunk_m, by0 + j * chunk_m, bx0 + (i + 1) * chunk_m, by0 + (j + 1) * chunk_m)
                piece = core.intersection(sq)
                if piece.is_empty or piece.area < 4 * cell * cell:
                    continue
                px0, py0, px1, py1 = piece.bounds
                c0 = max(0, int(math.floor((px0 - gx0) / cell)) - p.halo_cells)
                c1 = min(ncols, int(math.ceil((px1 - gx0) / cell)) + p.halo_cells)
                r0 = max(0, int(math.floor((gy0 - py1) / cell)) - p.halo_cells)
                r1 = min(nrows, int(math.ceil((gy0 - py0) / cell)) + p.halo_cells)
                tiles.append({"key": f"{h['huc12']}_{i}_{j}", "huc12": str(h["huc12"]),
                              "row_off": r0, "col_off": c0, "height": r1 - r0, "width": c1 - c0,
                              "core_wkt": piece.wkt})
    return {"crs": SRC.UTM17, "cell": cell, "x0": gx0, "y0": gy0, "nrows": nrows, "ncols": ncols,
            "params": p.__dict__, "tiles": tiles}


def tiles_of(plan: dict) -> list[Tile]:
    return [Tile(t["key"], t["row_off"], t["col_off"], t["height"], t["width"], huc12=t["huc12"]) for t in plan["tiles"]]


# ---------------------------------------------------------------------------
# File-backed inputs
# ---------------------------------------------------------------------------

class FileInputs:
    """Reads DEM sources and vector layers into each tile's window of the global grid."""

    def __init__(self, plan: dict, dem_1m: list, dem_13: list, flowlines=None,
                 inlets=None, culverts=None, bounds: dict | None = None):
        from shapely import wkt

        self.plan = plan
        self.cell_m = plan["cell"]
        self.dem_1m = dem_1m
        self.dem_13 = dem_13
        self.cores = {t["key"]: wkt.loads(t["core_wkt"]) for t in plan["tiles"]}
        self.flow_gdf = flowlines
        self.inlet_gdf = inlets
        self.culv_gdf = culverts
        self._bounds = dict(bounds or {})  # path -> (x0, y0, x1, y1) in plan CRS; skips opening remote files

    def _src_bounds(self, path):
        import rasterio
        from rasterio.warp import transform_bounds

        if path not in self._bounds:
            with rasterio.open(path) as s:
                self._bounds[path] = transform_bounds(s.crs, self.plan["crs"], *s.bounds)
        return self._bounds[path]

    def _wbounds(self, t: Tile):
        tr = window_transform(self.plan, t)
        x0, y1 = A.apply(tr, 0, 0)
        x1, y0 = A.apply(tr, t.width, t.height)
        return x0, y0, x1, y1

    def dem(self, t: Tile):
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.vrt import WarpedVRT

        tr = window_transform(self.plan, t)
        out = np.full((t.height, t.width), np.nan)
        res = np.zeros((t.height, t.width), dtype=np.float32)
        wx0, wy0, wx1, wy1 = self._wbounds(t)
        # 10 m first, then 1 m on top (newest last): 1 m wins wherever it has data.
        for paths, r_m in ((self.dem_13, 10.0), (self.dem_1m, 1.0)):
            for path in paths:
                bx0, by0, bx1, by1 = self._src_bounds(path)
                if bx1 < wx0 or bx0 > wx1 or by1 < wy0 or by0 > wy1:
                    continue
                with rasterio.open(path) as src:
                    rs = Resampling.average if r_m < self.cell_m else Resampling.bilinear
                    with WarpedVRT(src, crs=self.plan["crs"], transform=tr, width=t.width, height=t.height,
                                   resampling=rs, src_nodata=src.nodata, nodata=np.nan, dtype="float64") as v:
                        a = v.read(1)
                ok = np.isfinite(a) & (a > -100) & (a < 1000)
                out[ok] = a[ok]
                res[ok] = r_m
        return out, res

    def core(self, t: Tile):
        from rasterio import features

        return features.rasterize([(self.cores[t.key], 1)], out_shape=(t.height, t.width),
                                  transform=window_transform(self.plan, t), fill=0, dtype="uint8").astype(bool)

    def _clip(self, gdf, t):
        if gdf is None or not len(gdf):
            return None
        x0, y0, x1, y1 = self._wbounds(t)
        sub = gdf.cx[x0:x1, y0:y1]
        return sub if len(sub) else None

    def flowlines(self, t: Tile):
        from rasterio import features

        sub = self._clip(self.flow_gdf, t)
        if sub is None:
            return None
        return features.rasterize(((g, 1) for g in sub.geometry), out_shape=(t.height, t.width),
                                  transform=window_transform(self.plan, t), fill=0, all_touched=True,
                                  dtype="uint8").astype(bool)

    def inlets(self, t: Tile):
        from rasterio import features

        sub = self._clip(self.inlet_gdf, t)
        if sub is None:
            return None
        return features.rasterize(((g, 1) for g in sub.geometry), out_shape=(t.height, t.width),
                                  transform=window_transform(self.plan, t), fill=0, dtype="uint8").astype(bool)

    def culverts(self, t: Tile):
        sub = self._clip(self.culv_gdf, t)
        if sub is None:
            return []
        inv = ~window_transform(self.plan, t)
        paths = []
        for g in sub.geometry:
            for part in getattr(g, "geoms", [g]):
                rc = []
                for x, y in part.coords:
                    c, r = A.apply(inv, x, y)
                    rc.append((int(math.floor(r)), int(math.floor(c))))
                cells = []
                for (r0, c0), (r1, c1) in zip(rc[:-1], rc[1:]):
                    seg = H.line_cells(r0, c0, r1, c1)
                    cells.extend(seg if not cells else seg[1:])
                if len(cells) >= 2:
                    paths.append(cells)
        return paths


def _read_vec(path: Path | None, crs=SRC.UTM17):
    if not path:
        return None
    import geopandas as gpd

    p = Path(path)
    if not p.exists():
        return None
    return gpd.read_file(p).to_crs(crs)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_fetch(a):
    DATA.mkdir(parents=True, exist_ok=True)
    bbox = tuple(a.bbox) if a.bbox else SRC.VOLUSIA_BBOX
    # Context layers (DEM, HUC12, NHD) must cover the parcels plus AOI buffer plus halo.
    pad = 0.02 if a.bbox else 0.0
    ctx = (bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad)
    log("TNM: listing 1 m DEM tiles")
    m1 = SRC.select_1m_tiles(SRC.tnm_products(ctx, SRC.DS_1M))
    SRC.save_manifest(m1, DATA / "dem_1m_manifest.json")
    log(f"  {len(m1)} tiles after newest-per-tile selection, {sum(i.get('sizeInBytes') or 0 for i in m1) / 1e9:.1f} GB")
    m13 = SRC.select_13_tiles(SRC.tnm_products(ctx, SRC.DS_13))
    SRC.save_manifest(m13, DATA / "dem_13_manifest.json")
    if not a.lists_only:
        for i, it in enumerate(m1):
            u = it["downloadURL"]
            SRC.download(u, DATA / "dem" / "1m" / u.rsplit("/", 1)[-1], it.get("sizeInBytes"))
            log(f"  1m {i + 1}/{len(m1)}")
        for it in m13:
            u = it["downloadURL"]
            SRC.download(u, DATA / "dem" / "13" / u.rsplit("/", 1)[-1], it.get("sizeInBytes"))
    log("WBD HUC12")
    SRC.features_to_gpkg(SRC.arcgis_features(SRC.WBD_HUC12_LAYER, out_fields="huc12,name,tohuc,areasqkm",
                                             bbox=ctx, order_by=None), DATA / "huc12.gpkg")
    log("NHD flowlines")
    SRC.features_to_gpkg(SRC.arcgis_features(SRC.NHD_FLOWLINE_LAYER, out_fields="*", bbox=ctx, order_by=None),
                         DATA / "nhd_flowlines.gpkg")
    if a.bbox:
        log("parcels (bbox pilot)")
        from .parcel_polygons import pull

        pull(DATA / "parcels.gpkg", bbox=bbox)
    log("TIGER roads")
    z = SRC.download(SRC.TIGER_ROADS_URL, DATA / "roads" / "tl_2024_12127_roads.zip")
    with zipfile.ZipFile(z) as zf:
        zf.extractall(DATA / "roads")


def _params(a) -> TerrainParams:
    return TerrainParams(cell_m=a.cell, halo_m=a.halo, max_breach_m=a.max_breach_m,
                         stream_area_m2=a.stream_area_m2)


def cmd_plan(a):
    plan = make_plan(DATA / "parcels.gpkg", DATA / "huc12.gpkg", _params(a), a.chunk_m)
    (DATA / "plan.json").write_text(json.dumps(plan))
    cells = sum(t["height"] * t["width"] for t in plan["tiles"])
    big = max(t["height"] * t["width"] for t in plan["tiles"])
    log(f"plan: {len(plan['tiles'])} tiles, {cells / 1e9:.2f} G window cells, largest {big / 1e6:.0f} M cells "
        f"(~{big * 130 / 1e9:.1f} GB peak RAM)")


def _manifest_bounds(items: list[dict], prefix: str, crs: str) -> dict:
    from rasterio.warp import transform_bounds

    out = {}
    for i in items:
        b = i.get("boundingBox") or {}
        if b:
            out[prefix + i["downloadURL"]] = transform_bounds("EPSG:4326", crs, b["minX"], b["minY"], b["maxX"], b["maxY"])
    return out


def _inputs(a, plan):
    vec = dict(flowlines=_read_vec(a.flowlines or DATA / "nhd_flowlines.gpkg"),
               inlets=_read_vec(a.inlets), culverts=_read_vec(a.culverts))
    if a.remote_dem:
        # Pilot mode: read the COGs over HTTPS range requests (/vsicurl/) instead of downloading 32 GB.
        m1 = json.loads((DATA / "dem_1m_manifest.json").read_text())
        m13 = json.loads((DATA / "dem_13_manifest.json").read_text())
        pre = "/vsicurl/"
        bounds = {**_manifest_bounds(m1, pre, plan["crs"]), **_manifest_bounds(m13, pre, plan["crs"])}
        return FileInputs(plan, [pre + i["downloadURL"] for i in m1], [pre + i["downloadURL"] for i in m13],
                          bounds=bounds, **vec)
    dem1 = sorted((DATA / "dem" / "1m").glob("*.tif"))
    man = DATA / "dem_1m_manifest.json"
    if man.exists():  # manifest order is oldest -> newest
        order = {i["downloadURL"].rsplit("/", 1)[-1]: k for k, i in enumerate(json.loads(man.read_text()))}
        dem1 = sorted(dem1, key=lambda p: order.get(p.name, -1))
    dem13 = sorted((DATA / "dem" / "13").glob("*.tif"))
    return FileInputs(plan, dem1, dem13, **vec)


def cmd_terrain(a):
    plan = json.loads((DATA / "plan.json").read_text())
    p = TerrainParams(**plan["params"])
    tiles = tiles_of(plan)
    if a.only:
        keep = set(a.only.split(","))
        tiles = [t for t in tiles if t.huc12 in keep or t.key in keep]
    diag = run_tiles(_inputs(a, plan), DiskStore(DATA / "tiles"), tiles, p, log=log)
    (DATA / "terrain_diag.json").write_text(json.dumps({**diag, "tile_keys": [t.key for t in tiles]}))


def cmd_zonal(a):
    import geopandas as gpd
    from shapely import wkt

    plan = json.loads((DATA / "plan.json").read_text())
    store = DiskStore(DATA / "tiles")
    diag_path = DATA / "terrain_diag.json"
    diag = json.loads(diag_path.read_text()) if diag_path.exists() else {}
    seam_status = flow_seam_status(diag)
    diagnosed = set(diag.get("tile_keys", []))
    parcels = gpd.read_file(DATA / "parcels.gpkg", layer="parcels").to_crs(SRC.UTM17)
    parcels["rep"] = parcels.geometry.representative_point()
    rep = gpd.GeoDataFrame(parcels[["parcel_id"]], geometry=parcels["rep"], crs=SRC.UTM17)
    foot = _read_vec(a.footprints)
    roads = _read_vec(a.roads or next(iter((DATA / "roads").glob("*.shp")), None))
    rows, street_pts = [], []
    done = set()
    geoms = parcels.set_index("parcel_id").geometry
    all_tiles = [Tile(x["key"], x["row_off"], x["col_off"], x["height"], x["width"], huc12=x["huc12"])
                 for x in plan["tiles"]]
    all_tiles = [x for x in all_tiles if store.has(x.key, "twi")]
    for k, t in enumerate(plan["tiles"]):
        tile = Tile(t["key"], t["row_off"], t["col_off"], t["height"], t["width"], huc12=t["huc12"])
        if not store.has(tile.key, "twi"):
            continue
        core = wkt.loads(t["core_wkt"])
        sel = rep[rep.within(core)]
        sel = sel[~sel.parcel_id.isin(done)]
        tr = window_transform(plan, tile)
        # Lots can reach into the halo; every cell's value comes from the tile that owns it.
        arrays = {name: window_from_cores(store, all_tiles, tile, name, fill=np.nan)
                  for name in ("elev", "twi", "hand", "depr", "srcres")}
        arrays["srcres"][arrays["srcres"] <= 0] = np.nan
        meta = json.loads(str(store.get(tile.key, "meta")))
        for pid in sel.parcel_id:
            g = geoms[pid]
            fp = None
            if foot is not None:
                cand = foot.cx[g.bounds[0]:g.bounds[2], g.bounds[1]:g.bounds[3]]
                if len(cand):
                    fp = cand.geometry.union_all()
            r = Z.zonal_parcel(pid, g, arrays, tr, fp).row()
            r.update(huc12=tile.huc12, grid_cell_m=plan["cell"], nhd=meta.get("has_flowlines", False),
                     flow_seam_status=seam_status if tile.key in diagnosed else "unknown",
                     culverts_or_inlets=bool(meta.get("n_culverts") or meta.get("has_inlets")))
            rows.append(r)
            done.add(pid)
        if roads is not None:
            ln = roads.cx[tr.c:tr.c + tile.width * tr.a, tr.f + tile.height * tr.e:tr.f]
            ln = ln[ln.intersects(core)]
            xy = NB.sample_lines(ln.geometry.intersection(core))
            if len(xy):
                z = NB.sample_raster(xy, arrays["elev"], tr)
                street_pts.append(np.column_stack([xy, z]))
        log(f"zonal tile {k + 1}/{len(plan['tiles'])}: {len(sel)} parcels")
    import pandas as pd

    pd.DataFrame(rows).to_csv(DATA / "zonal.csv", index=False)
    np.save(DATA / "street_pts.npy", np.vstack(street_pts) if street_pts else np.zeros((0, 3)))
    log(f"zonal: {len(rows)} parcels")


def cmd_soils(a):
    import geopandas as gpd

    from . import soils as SO

    attrs = SO.fetch_tabular(a.areasymbol)
    SO.save_json(attrs, DATA / "ssurgo_attrs.json")
    log(f"SDA: {len(attrs)} map units")
    soil_path = Path(a.soil_polygons) if a.soil_polygons else DATA / "ssurgo_mupolygon.gpkg"
    if not soil_path.exists():
        if a.bbox:
            SO.fetch_mupolygons_bbox(a.bbox, a.areasymbol, soil_path)
        else:
            SO.fetch_mupolygons(sorted(attrs), soil_path)
    soils = gpd.read_file(soil_path)
    if "mukey" not in soils.columns and "MUKEY" in soils.columns:
        soils = soils.rename(columns={"MUKEY": "mukey"})
    soils["mukey"] = soils["mukey"].astype(str)
    soils = soils.to_crs(SRC.UTM17)
    parcels = gpd.read_file(DATA / "parcels.gpkg", layer="parcels").to_crs(SRC.UTM17)
    drained = set()
    if a.drained_ids:
        drained = {l.strip() for l in Path(a.drained_ids).read_text().splitlines() if l.strip()}
    res = SO.parcel_soils(parcels, soils, attrs, drained)
    SO.save_json(res, DATA / "parcel_soils.json")
    log(f"soils: {len(res)} parcels")


def pct_norm(v: np.ndarray, clip=CLIP_PCT):
    ok = np.isfinite(v)
    if ok.sum() < 2:
        return np.full_like(v, np.nan), (None, None)
    lo, hi = np.percentile(v[ok], clip)
    span = (hi - lo) or 1.0
    return np.where(ok, np.clip((v - lo) / span, 0, 1), np.nan), (float(lo), float(hi))


def pct_rank(v: np.ndarray) -> np.ndarray:
    ok = np.isfinite(v)
    out = np.full(v.shape, np.nan)
    if ok.sum():
        order = v[ok].argsort().argsort()
        out[ok] = order / max(1, ok.sum() - 1)
    return out


def assemble(zonal_rows, soils: dict, street_xyz, parcel_geoms: dict, ten_m: dict | None,
             cell_m: float, release_tag: str) -> list[dict]:
    """Pure table step (unit-tested): neighbours, normalisation, v2 static, confidence."""
    cells = [grid_cell(r.get("grid_cell_m"), fallback=cell_m) for r in zonal_rows]
    ids = [r["parcel_id"] for r in zonal_rows]
    em = np.array([np.nan if r.get("elev_med_m") is None else r["elev_med_m"] for r in zonal_rows], float)
    nbr = NB.neighbour_relative(ids, [parcel_geoms[i] for i in ids], em, street_xyz)
    twi_awm = np.array([np.nan if r.get("twi_awm") is None else r["twi_awm"] for r in zonal_rows], float)
    hand_min = np.array([np.nan if r.get("hand_min_m") is None else r["hand_min_m"] for r in zonal_rows], float)
    twi_n, twi_clip = pct_norm(twi_awm)
    hand_n, hand_clip = pct_norm(hand_min)
    diff_t = diff_h = None
    if ten_m:
        t10 = np.array([ten_m.get(i, {}).get("twi", np.nan) for i in ids], float)
        h10 = np.array([ten_m.get(i, {}).get("hand", np.nan) for i in ids], float)
        both = np.isfinite(t10) & np.isfinite(twi_awm)
        rt1 = np.full(len(ids), np.nan)
        rt10 = np.full(len(ids), np.nan)
        rt1[both] = pct_rank(twi_awm[both])
        rt10[both] = pct_rank(t10[both])
        diff_t = rt1 - rt10
        bh = np.isfinite(h10) & np.isfinite(hand_min)
        rh1 = np.full(len(ids), np.nan)
        rh10 = np.full(len(ids), np.nan)
        rh1[bh] = pct_rank(hand_min[bh])
        rh10[bh] = pct_rank(h10[bh])
        diff_h = rh1 - rh10
    out = []
    for k, r in enumerate(zonal_rows):
        pid = r["parcel_id"]
        so = soils.get(pid, {})
        nb = nbr.get(pid, {})
        dn = C2.depr_v2_n(r.get("depr_max_m"), r.get("depr_frac"))
        tn = None if not np.isfinite(twi_n[k]) else round(float(twi_n[k]), 4)
        hn = None if not np.isfinite(hand_n[k]) else round(float(hand_n[k]), 4)
        rd = []
        if diff_t is not None:
            rd = [None if not np.isfinite(diff_t[k]) else float(diff_t[k]),
                  None if not np.isfinite(diff_h[k]) else float(diff_h[k])]
        agree = CF.agree_component(rd) if any(x is not None for x in rd) else None
        conf = CF.fsi_confidence(dem_1m_frac=r.get("dem_1m_frac"), geom_mode=r.get("geom_mode"),
                                 soil_cov=so.get("soil_cov"), nhd=r.get("nhd"),
                                 culverts_or_inlets=r.get("culverts_or_inlets"), rank_diffs=rd,
                                 area_m2=r.get("area_m2"), cell_m=cells[k])
        s2 = C2.static_score_v2(tn, hn, dn, nb.get("nbr_rel_m"), nb.get("street_rel_m"), so.get("hsg_eff"),
                                so.get("drain_class"), so.get("ksat_um_s"), so.get("wt_depth_m"), None)
        inputs = CF.fsi_inputs(
            model="terrain-v2", release=release_tag, huc12=r.get("huc12"),
            dem=("3dep_1m" if (r.get("dem_1m_frac") or 0) >= 0.5 else "3dep_13"),
            dem_res_m=r.get("dem_res_m"), grid_cell_m=cells[k], dem_1m_frac=_r3(r.get("dem_1m_frac")),
            flow_seam_status=r.get("flow_seam_status", "unknown"),
            geom=r.get("geom_mode"), yard_only=r.get("yard_only"),
            nhd_burn=bool(r.get("nhd")), culverts_or_inlets=bool(r.get("culverts_or_inlets")),
            soil=("ssurgo_sda" if so else None), soil_cov=_r3(so.get("soil_cov")),
            nbr_count=nb.get("nbr_count"), street_n=nb.get("street_n"),
            agree_10m=_r3(agree), twi_clip=[round(x, 3) for x in twi_clip] if twi_clip[0] is not None else None,
            hand_clip=[round(x, 3) for x in hand_clip] if hand_clip[0] is not None else None)
        out.append({
            "parcel_id": pid, "huc12": r.get("huc12"),
            "dem_res_m": r.get("dem_res_m"), "dem_1m_frac": _r3(r.get("dem_1m_frac")),
            "geom_mode": r.get("geom_mode"), "yard_only": bool(r.get("yard_only")),
            "lot_area_m2": _r1(r.get("area_m2")),
            "elev_p10_m": _r3(r.get("elev_p10_m")), "elev_med_m": _r3(r.get("elev_med_m")),
            "twi_max": _r3(r.get("twi_max")), "twi_awm": _r3(r.get("twi_awm")), "twi_v2_n": tn,
            "hand_min_m": _r3(r.get("hand_min_m")), "hand_v2_n": hn,
            "depr_max_m": _r3(r.get("depr_max_m")), "depr_frac": _r3(r.get("depr_frac")),
            "depr_v2_n": round(dn, 4),
            "nbr_rel_m": _r3(nb.get("nbr_rel_m")), "nbr_count": nb.get("nbr_count"),
            "street_rel_m": _r3(nb.get("street_rel_m")),
            "hsg_eff": so.get("hsg_eff"), "hsg_dual": so.get("hsg_dual"),
            "drain_class": so.get("drain_class"), "ksat_um_s": _r3(so.get("ksat_um_s")),
            "wt_depth_m": _r3(so.get("wt_depth_m")), "soil_cov": _r3(so.get("soil_cov")),
            "fsi_confidence": conf, "fsi_inputs": inputs, "model_version_v2": C2.MODEL_VERSION,
            "_static_v2_no_zone": s2,
        })
    return out


def _r3(v):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(float(v), 3)


def _r1(v):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(float(v), 1)


def load_ten_m(paths: list[Path]) -> dict:
    import csv

    out = {}
    for p in paths:
        with open(p, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                try:
                    out[r["parcel_id"]] = {"twi": float(r["twi"]), "hand": float(r["hand"])}
                except (KeyError, ValueError):
                    pass
    return out


def write_release(rows: list[dict], out_dir: Path, part_rows: int = 10000) -> list[Path]:
    import csv

    out_dir.mkdir(parents=True, exist_ok=True)
    cols = [k for k in rows[0] if not k.startswith("_")] if rows else []
    with (out_dir / "parcel_terrain_v2.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({**r, "fsi_inputs": json.dumps(r["fsi_inputs"], separators=(",", ":"))})
    parts = []
    for i in range(0, len(rows), part_rows):
        p = out_dir / f"parcel_terrain_v2_{i // part_rows:02d}.json"
        p.write_text(json.dumps([{k: v for k, v in r.items() if not k.startswith("_")}
                                 for r in rows[i:i + part_rows]], separators=(",", ":")))
        parts.append(p)
    return parts


def cmd_assemble(a):
    import geopandas as gpd
    import pandas as pd

    z = pd.read_csv(DATA / "zonal.csv", dtype={"parcel_id": str, "huc12": str}).replace({np.nan: None}).to_dict("records")
    if any(r.get("grid_cell_m") is None for r in z):
        raise ValueError("zonal.csv lacks per-parcel grid_cell_m; rerun zonal on each original processing plan before assembly")
    soils = json.loads((DATA / "parcel_soils.json").read_text()) if (DATA / "parcel_soils.json").exists() else {}
    street = np.load(DATA / "street_pts.npy") if (DATA / "street_pts.npy").exists() else None
    parcels = gpd.read_file(DATA / "parcels.gpkg", layer="parcels").to_crs(SRC.UTM17)
    geoms = dict(zip(parcels.parcel_id.astype(str), parcels.geometry))
    for r in z:
        r["parcel_id"] = str(r["parcel_id"])
    ten = load_ten_m(sorted(Path(a.compare_10m).glob("parcel_terrain_*.csv"))) if a.compare_10m else None
    plan = json.loads((DATA / "plan.json").read_text())
    rows = assemble(z, soils, street, geoms, ten, plan["cell"], a.tag)
    parts = write_release(rows, RELEASE / a.tag)
    conf = np.array([r["fsi_confidence"] for r in rows])
    summary = {"parcels": len(rows), "parts": [p.name for p in parts],
               "confidence_p10_50_90": np.percentile(conf, [10, 50, 90]).round(3).tolist() if len(conf) else None,
               **resolution_summary(rows)}
    (RELEASE / a.tag / "summary.json").write_text(json.dumps(summary, indent=1))
    log(f"release {a.tag}: {summary}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["fetch", "plan", "terrain", "zonal", "soils", "assemble", "all"])
    ap.add_argument("--lists-only", action="store_true", help="fetch: write manifests, skip DEM downloads")
    ap.add_argument("--data-dir", type=Path, help="working directory (default fsi/data/v2)")
    ap.add_argument("--bbox", type=float, nargs=4, metavar=("W", "S", "E", "N"),
                    help="pilot area in lon/lat: fetch parcels/HUC/NHD/soils for this box only")
    ap.add_argument("--remote-dem", action="store_true",
                    help="terrain: read DEM COGs over HTTPS from the manifests instead of local files")
    ap.add_argument("--cell", type=float, default=1.0)
    ap.add_argument("--halo", type=float, default=300.0)
    ap.add_argument("--chunk-m", type=float, default=CHUNK_M)
    ap.add_argument("--max-breach-m", type=float, default=40.0)
    ap.add_argument("--stream-area-m2", type=float, default=250_000.0)
    ap.add_argument("--only", help="terrain: comma list of huc12 or tile keys (pilot runs)")
    ap.add_argument("--flowlines", type=Path)
    ap.add_argument("--culverts", type=Path, help="county stormwater culverts/pipes (lines)")
    ap.add_argument("--inlets", type=Path, help="county stormwater inlets (points)")
    ap.add_argument("--footprints", type=Path, help="building footprints (polygons) for yard-only stats")
    ap.add_argument("--roads", type=Path)
    ap.add_argument("--areasymbol", default="FL127")
    ap.add_argument("--soil-polygons", help="WSS soilmu_a_fl127.shp instead of SDA polygons")
    ap.add_argument("--drained-ids", help="file of parcel_ids known to have artificial drainage")
    ap.add_argument("--compare-10m", default=str(HERE.parent / "releases" / "terrain-2026-09-17"))
    ap.add_argument("--tag", default=time.strftime("terrain-v2-%Y-%m-%d"))
    a = ap.parse_args()
    if a.data_dir:
        global DATA, RELEASE
        DATA = a.data_dir.resolve()
        RELEASE = DATA / "release"
    steps = {"fetch": [cmd_fetch], "plan": [cmd_plan], "terrain": [cmd_terrain], "zonal": [cmd_zonal],
             "soils": [cmd_soils], "assemble": [cmd_assemble],
             "all": [cmd_plan, cmd_terrain, cmd_zonal, cmd_soils, cmd_assemble]}[a.cmd]
    for s in steps:
        s(a)


if __name__ == "__main__":
    main()
