"""Synthetic neighbourhood through the whole v2 chain: tiles -> zonal -> neighbours -> release rows."""
import json

import numpy as np
import pytest
from affine import Affine
from shapely.geometry import LineString, box

from pipeline import neighbors as NB
from pipeline import terrain_v2 as T
from pipeline import terrain_v2_run as RUN
from pipeline import zonal as Z

TR = Affine(1, 0, 0, 0, -1, 0)
SQL_COLS = ["parcel_id", "huc12", "dem_res_m", "dem_1m_frac", "geom_mode", "yard_only", "lot_area_m2",
            "elev_p10_m", "elev_med_m", "twi_max", "twi_awm", "twi_v2_n", "hand_min_m", "hand_v2_n",
            "depr_max_m", "depr_frac", "depr_v2_n", "nbr_rel_m", "nbr_count", "street_rel_m", "hsg_eff",
            "hsg_dual", "drain_class", "ksat_um_s", "wt_depth_m", "soil_cov", "fsi_confidence", "fsi_inputs"]


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    nr, nc = 80, 120
    y, x = np.mgrid[0:nr, 0:nc].astype(float)
    dem = 8.0 - 0.01 * x + 0.002 * np.abs(y - 40)          # gentle slope east
    dem[50:62, 50:62] -= 0.4                                # one lot sits in a 0.4 m bowl
    src = np.ones_like(dem)
    src[:, 90:] = 10.0                                      # east edge only has 10 m data
    labels = np.where(x < 60, 1, 2)
    p = T.TerrainParams(cell_m=1.0, halo_m=15, stream_area_m2=1500)
    tiles, lk = T.tiles_from_labels(labels, p.halo_cells, {1: "030802010101_0_0", 2: "030802010102_0_0"})
    st = T.MemoryStore()
    # Give the artificial bowl a surveyed channel, rather than relying on
    # a crossing loop to become a channel by exceeding the area threshold.
    stream = np.zeros(dem.shape, dtype=bool)
    stream[55, 50:] = True
    diag = T.run_tiles(T.ArrayInputs(dem, labels, 1.0, srcres=src, flowlines=stream, label_of_key=lk),
                       st, tiles, p, log=lambda m: None)
    assert diag["residual_cells"] == diag["residual_mfd_cells"] == 0.0
    lots = {}
    for i, r0 in enumerate(range(26, 74, 12)):
        for j, c0 in enumerate(range(26, 110, 12)):
            lots[f"P{i}{j}"] = box(c0, -(r0 + 12), c0 + 12, -r0)
    rows = []
    for t in tiles:
        arr = {k: T.window_from_cores(st, tiles, t, k, fill=np.nan) for k in ("elev", "twi", "hand", "depr", "srcres")}
        wt = Affine(1, 0, t.col_off, 0, -1, -t.row_off)
        core = st.get(t.key, "core")
        for pid, g in lots.items():
            pt = g.representative_point()
            r, c = int(-pt.y) - t.row_off, int(pt.x) - t.col_off
            if 0 <= r < t.height and 0 <= c < t.width and core[r, c]:
                z = Z.zonal_parcel(pid, g, arr, wt).row()
                z.update(huc12=t.key.split("_")[0], nhd=True, culverts_or_inlets=False)
                rows.append(z)
    road = LineString([(0, -23), (120, -23)])
    xy = NB.sample_lines([road])
    street = np.column_stack([xy, NB.sample_raster(xy, dem, TR)])
    soils = {pid: {"hsg_eff": "D", "hsg_dual": True, "drain_class": "Poorly drained", "ksat_um_s": 50.0,
                   "wt_depth_m": 0.3, "soil_cov": 1.0} for pid in lots}
    ten = {pid: {"twi": 5.0 + k * 0.1, "hand": 1.0} for k, pid in enumerate(lots)}
    out = RUN.assemble(rows, soils, street, lots, ten, 1.0, "test-release")
    return {r["parcel_id"]: r for r in out}, tmp_path_factory.mktemp("rel")


def test_every_lot_scored_once(run):
    rows, _ = run
    assert len(rows) == 4 * 7


def test_bowl_lot_stands_out(run):
    rows, _ = run
    b = rows["P22"]                                         # the lot over the 0.4 m bowl
    assert b["depr_max_m"] == pytest.approx(0.4, abs=0.05)
    assert b["depr_frac"] > 0.9
    assert b["nbr_rel_m"] < -0.3
    others = [r for k, r in rows.items() if k != "P22"]
    assert all(b["depr_v2_n"] > r["depr_v2_n"] for r in others)
    assert all(b["_static_v2_no_zone"] > r["_static_v2_no_zone"] for r in others)


def test_resolution_and_confidence(run):
    rows, _ = run
    east = rows["P06"]                                      # columns 98-110: 10 m only
    assert east["dem_res_m"] == 10.0 and east["fsi_inputs"]["dem"] == "3dep_13"
    assert rows["P01"]["dem_res_m"] == 1.0
    assert east["fsi_confidence"] < rows["P01"]["fsi_confidence"]
    assert all(0 <= r["fsi_confidence"] <= 1 for r in rows.values())
    assert rows["P01"]["street_rel_m"] is not None          # front row sees the road
    assert rows["P01"]["huc12"] == "030802010101"


def test_release_files_match_sql_apply_columns(run):
    rows, d = run
    parts = RUN.write_release(list(rows.values()), d, part_rows=10)
    assert len(parts) == 3
    data = [r for p in parts for r in json.loads(p.read_text())]
    assert len(data) == 28
    for r in data:
        assert set(SQL_COLS) <= set(r)
        assert not any(k.startswith("_") for k in r)
    assert (d / "parcel_terrain_v2.csv").read_text().splitlines()[0].startswith("parcel_id,huc12,")
