import numpy as np
import pytest

from pipeline.terrain_region import run_shared_region
from pipeline.terrain_v2 import ArrayInputs, MemoryStore, TerrainParams, Tile, tiles_from_labels


def solve(dem, labels, flow=None, inlets=None, culverts=None, reverse=False, stream_area=10000):
    tiles, ids = tiles_from_labels(labels, 1)
    if reverse:
        tiles.reverse()
    store = MemoryStore()
    diag = run_shared_region(
        ArrayInputs(dem, labels, flowlines=flow, inlets=inlets, culverts=culverts, label_of_key=ids),
        store, tiles, TerrainParams(max_breach_m=2, stream_area_m2=stream_area), log=lambda _: None)
    return tiles, store, diag


def test_shared_elevation_and_flow_match_unpartitioned_domain():
    # A cross-boundary obstruction above a mapped channel. One culvert runs
    # across the artificial partition, and a NoData hole isn't a mapped outlet.
    rows, cols = np.indices((9, 12))
    dem = (20 - cols + np.abs(rows - 4)).astype(float)
    dem[:, 5:7] += 10
    dem[1, 9] = np.nan
    flow = (rows == 4) & (cols >= 7)
    inlets = (rows == 4) & (cols == 11)
    culverts = [[(4, c) for c in range(4, 8)]]
    left_right = np.where(cols < 6, 1, 2)
    tiles, store, diag = solve(dem, left_right, flow, inlets, culverts)
    _, whole, expected = solve(dem, np.ones(dem.shape, int), flow, inlets, culverts)
    _, reorder, reverse = solve(dem, left_right, flow, inlets, culverts, reverse=True)
    for key in ("elev", "routing", "breached", "hand", "depr", "twi", "acc_d8_final", "acc_mfd_final"):
        for t in tiles:
            r,c = t.row_off,t.col_off
            np.testing.assert_array_equal(store.get(t.key,key),
                                          whole.get("t1",key)[r:r+t.height,c:c+t.width])
            np.testing.assert_array_equal(store.get(t.key,key), reorder.get(t.key,key))
    assert diag == expected == reverse
    assert diag["terminal_d8_cells"] == 107
    assert diag["terminal_mfd_cells"] == pytest.approx(107)
    assert np.isfinite(store.get("t1", "hand")[4, 4])
    # Depression layer kept on its own, independent of the channel burn.
    _, dry, _ = solve(dem, left_right, None, inlets, culverts)
    np.testing.assert_array_equal(store.get("t1", "depr"), dry.get("t1", "depr"))


def test_boundary_and_hole_not_mistaken_for_verified_drainage():
    dem = np.arange(25, dtype=float).reshape(5, 5)
    dem[0, 0] = np.nan
    _, store, diag = solve(dem, np.ones(dem.shape, int))
    assert diag["hand_unresolved_cells"] == 24
    assert diag["unverified_terminal_cells"] > 0
    assert np.isnan(store.get("t1", "hand")).all()


def test_large_or_empty_preview_rejected_before_loading_data():
    with pytest.raises(ValueError, match="16 million"):
        run_shared_region(None, None, [Tile("too_large", 0, 0, 4001, 4000)], TerrainParams())
    with pytest.raises(ValueError, match="nonempty"):
        run_shared_region(None, None, [], TerrainParams())



def test_explicit_region_routes_through_unowned_context_outside_tile_windows():
    rows, cols = np.indices((5, 14))
    dem = (14 - cols + 3 * np.abs(rows - 2)).astype(float)
    labels = np.where(cols < 3, 1, np.where(cols > 10, 2, 0))
    channel = (rows == 2) & (cols >= 11)
    study = Tile("study", 0, 0, 5, 14)
    results = []
    for halo in (0, 4):
        tiles, ids = tiles_from_labels(labels, halo)
        store = MemoryStore()
        diag = run_shared_region(ArrayInputs(dem, labels, flowlines=channel, label_of_key=ids),
                                 store, tiles, TerrainParams(stream_area_m2=1000),
                                 log=lambda _: None, region=study)
        assert diag["valid_cells"] == 70
        assert diag["terminal_d8_cells"] == 30
        results.append(store.get("t1", "hand")[:, :3])
    np.testing.assert_array_equal(*results)
    assert np.isfinite(results[0][2, :]).all()
