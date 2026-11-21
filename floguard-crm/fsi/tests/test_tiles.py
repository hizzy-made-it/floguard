"""Tile-edge flow: per-watershed tiles + export propagation == one big tile."""
import numpy as np
import pytest

from pipeline import hydro as H
from pipeline import terrain_v2 as T


def run(dem, labels, p, **kw):
    tiles, lk = T.tiles_from_labels(labels, p.halo_cells)
    st = T.MemoryStore()
    diag = T.run_tiles(T.ArrayInputs(dem, labels, p.cell_m, label_of_key=lk, **kw), st, tiles, p, log=lambda m: None)
    return st, tiles, diag


def valley():
    y, x = np.mgrid[0:60, 0:80].astype(float)
    return 20 - 0.05 * x + 0.3 * np.abs(y - 30) ** 0.8


@pytest.mark.parametrize("split", ["vertical", "diagonal", "four"])
def test_tile_edge_flow_path_matches_single_tile(split):
    dem = valley()
    y, x = np.mgrid[0:60, 0:80]
    labels = {"vertical": np.where(x < 40, 1, 2),
              "diagonal": np.where(x + 0.5 * y < 50, 1, 2),
              "four": 1 + (x >= 40) + 2 * (y >= 30)}[split]
    p = T.TerrainParams(cell_m=1.0, halo_m=6, stream_area_m2=200, propagate_tol=1e-9)
    st, tiles, diag = run(dem, labels, p)
    st1, t1, _ = run(dem, np.ones_like(labels), p)
    shape = dem.shape
    for name, tol in [("acc_d8_final", 1e-9), ("acc_mfd_final", 1e-3), ("hand", 1e-6), ("twi", 1e-4)]:
        a = T.mosaic(st, tiles, name, shape)
        b = T.mosaic(st1, t1, name, shape)
        assert np.nanmax(np.abs(a - b)) <= tol, name
    acc = T.mosaic(st, tiles, "acc_d8_final", shape)
    assert acc[30, 78] > 1000                                     # the valley outlet collects across the seam
    assert diag["residual_cells"] == 0


def test_noisy_dem_mass_conserved_across_tiles():
    rng = np.random.default_rng(1)
    dem = valley() + rng.normal(0, 0.05, (60, 80))
    y, x = np.mgrid[0:60, 0:80]
    labels = 1 + (x >= 27) + (x >= 54)
    p = T.TerrainParams(cell_m=1.0, halo_m=5, stream_area_m2=200)
    st, tiles, diag = run(dem, labels, p)
    total = 0.0
    for t in tiles:
        routing = st.get(t.key, "routing")
        valid = st.get(t.key, "valid")
        core = st.get(t.key, "core")
        rec = H.d8_receivers(routing, valid).reshape(routing.shape)
        # cells that send flow nowhere: grid edge of the WHOLE domain only
        gr = np.arange(t.height)[:, None] + t.row_off
        gc = np.arange(t.width)[None, :] + t.col_off
        on_edge = (gr == 0) | (gc == 0) | (gr == 59) | (gc == 79)
        sinks = core & (rec < 0)
        assert not (sinks & ~on_edge).any()
        total += st.get(t.key, "acc_d8_final")[sinks].sum()
    assert total == pytest.approx(dem.size, rel=1e-9)             # every cell counted exactly once


def test_culvert_crossing_tile_seam():
    nr, nc = 41, 60
    y, x = np.mgrid[0:nr, 0:nc].astype(float)
    dem = 10.0 - 0.02 * x + 0.05 * np.abs(y - 20)
    dem[:, 30:34] += 1.5
    labels = np.where(x < 32, 1, 2)                               # seam through the middle of the road
    culv = [H.line_cells(20, 27, 20, 36)]
    p = T.TerrainParams(cell_m=1.0, halo_m=8, max_breach_m=1, stream_area_m2=400)
    st, tiles, _ = run(dem, labels, p, culverts=culv)
    depr = T.mosaic(st, tiles, "depr", dem.shape)
    assert depr[20, 28] < 0.01
    st2, tiles2, _ = run(dem, labels, p)
    assert T.mosaic(st2, tiles2, "depr", dem.shape)[20, 28] > 0.5


def test_disk_store_roundtrip(tmp_path):
    dem = valley()
    labels = np.where(np.mgrid[0:60, 0:80][1] < 40, 1, 2)
    p = T.TerrainParams(cell_m=1.0, halo_m=6, stream_area_m2=200)
    tiles, lk = T.tiles_from_labels(labels, p.halo_cells)
    st = T.DiskStore(tmp_path)
    T.run_tiles(T.ArrayInputs(dem, labels, 1.0, label_of_key=lk), st, tiles, p, log=lambda m: None)
    a = T.mosaic(st, tiles, "acc_d8_final", dem.shape)
    # rerun reuses phase 1 and must not double count
    tiles2, _ = T.tiles_from_labels(labels, p.halo_cells)
    T.run_tiles(T.ArrayInputs(dem, labels, 1.0, label_of_key=lk), st, tiles2, p, log=lambda m: None)
    b = T.mosaic(st, tiles2, "acc_d8_final", dem.shape)
    assert np.array_equal(a, b)


def test_hand_paths_linked_across_tiles():
    """Channel only in the east tile, halo too thin to reach it: HAND must still resolve."""
    y, x = np.mgrid[0:40, 0:80].astype(float)
    dem = 10 - 0.05 * x + 0.02 * np.abs(y - 20)
    flow = np.zeros(dem.shape, bool)
    flow[:, 78] = True                                            # channel near the east edge
    labels = 1 + (x >= 20) + (x >= 40) + (x >= 60)                # four strips, west ones far from it
    p = T.TerrainParams(cell_m=1.0, halo_m=2, stream_area_m2=1e9, propagate_tol=1e-9)
    st, tiles, diag = run(dem, labels, p, flowlines=flow)
    st1, t1, _ = run(dem, np.ones_like(labels), p, flowlines=flow)
    h = T.mosaic(st, tiles, "hand", dem.shape)
    h1 = T.mosaic(st1, t1, "hand", dem.shape)
    assert diag["hand_linked_cells"] > 0
    assert np.isnan(h[:, :76]).sum() == 0
    assert np.nanmax(np.abs(h - h1)) < 1e-6
    assert h[20, 5] == pytest.approx(dem[20, 5] - (dem[20, 78] - p.nhd_burn_m), abs=0.05)   # channel burned 1 m

def test_inconsistent_tile_halos_cannot_recirculate_one_cell_of_flow(monkeypatch):
    # Tile A thinks its east neighbour is lower, while tile B thinks its west
    # neighbour is lower. Both of those conditional views are individually DAGs;
    # composing their outgoing edges without reconciling creates A <-> B.
    dem = np.array([[4.0, 3.0]])
    views = iter([np.array([[4.0, 1.0]]), np.array([[2.0, 3.0]])])

    def condition(dem, valid, **_):
        routing = next(views)
        return {"routing": routing, "basin_dem": dem, "breached": dem, "n_breached": 0}

    monkeypatch.setattr(T.H, "condition_dem", condition)
    labels = np.array([[1, 2]])
    p = T.TerrainParams(halo_m=1, propagate_max_rounds=3, stream_area_m2=2)
    tiles, lookup = T.tiles_from_labels(labels, p.halo_cells)
    store = T.MemoryStore()
    diag = T.run_tiles(T.ArrayInputs(dem, labels, label_of_key=lookup), store, tiles, p, log=lambda _: None)
    assert diag["residual_cells"] == diag["residual_mfd_cells"] == 0.0
    for layer in ("acc_d8_final", "acc_mfd_final"):
        np.testing.assert_allclose(T.mosaic(store, tiles, layer, dem.shape), [[1.0, 2.0]])
    # HAND consumes the same stitched potential and finds the actual channel.
    np.testing.assert_allclose(T.mosaic(store, tiles, "hand", dem.shape), [[1.0, 0.0]])

def test_reconciled_seam_sink_does_not_invent_a_hand_channel(monkeypatch):
    dem = np.array([[4.0, 4.0]])
    views = iter([np.array([[4.0, 1.0]]), np.array([[2.0, 4.0]])])

    def condition(dem, valid, **_):
        return {"routing": next(views), "basin_dem": dem, "breached": dem, "n_breached": 0}

    monkeypatch.setattr(T.H, "condition_dem", condition)
    p = T.TerrainParams(halo_m=1, propagate_max_rounds=3, stream_area_m2=2)
    tiles, lookup = T.tiles_from_labels(np.array([[1, 2]]), p.halo_cells)
    store = T.MemoryStore()
    diag = T.run_tiles(T.ArrayInputs(dem, np.array([[1, 2]]), label_of_key=lookup),
                       store, tiles, p, log=lambda _: None)
    assert diag["residual_cells"] == diag["residual_mfd_cells"] == 0.0
    assert diag["seam_new_sink_cells"] == diag["hand_unresolved_cells"] == 2
    np.testing.assert_allclose(T.mosaic(store, tiles, "acc_d8_final", dem.shape), [[1.0, 1.0]])
    assert np.isnan(T.mosaic(store, tiles, "hand", dem.shape)).all()
