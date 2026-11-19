"""Polygon zonal stats and neighbour-relative elevation."""
import numpy as np
import pytest
from affine import Affine
from shapely.geometry import LineString, box

from pipeline import neighbors as NB
from pipeline import zonal as Z

T = Affine(1, 0, 0, 0, -1, 0)   # cell (r, c) covers x in [c, c+1], y in [-r-1, -r]


def bowl(n=41):
    y, x = np.mgrid[0:n, 0:n].astype(float)
    return np.minimum(5.0 + 0.002 * ((x - 20) ** 2 + (y - 20) ** 2), 5.45)


def arrays(dem, **extra):
    from pipeline import hydro as H
    a = {"elev": dem, "depr": H.depression_depth(dem), "srcres": np.ones_like(dem)}
    a.update(extra)
    return a


def test_bowl_parcel_inside_and_outside():
    dem = bowl()
    a = arrays(dem)
    inside = Z.zonal_parcel("in", box(14, -27, 27, -14), a, T)
    assert inside.geom_mode == "polygon"
    assert inside.depr_max_m == pytest.approx(0.45, abs=1e-9)
    assert inside.depr_frac == pytest.approx(1.0)
    assert inside.area_m2 == pytest.approx(13 * 13)
    corner = Z.zonal_parcel("out", box(0, -6, 6, 0), a, T)
    assert corner.depr_max_m == 0.0 and corner.depr_frac == 0.0
    assert corner.elev_med_m == pytest.approx(5.45)
    assert inside.elev_med_m < corner.elev_med_m


def test_percentiles_on_plane_and_partial_cells():
    y, x = np.mgrid[0:20, 0:20].astype(float)
    dem = 0.1 * x                                     # 0.1 m per column
    r = Z.zonal_parcel("p", box(2, -12, 12, -2), {"elev": dem}, T)
    assert r.elev_med_m == pytest.approx(0.1 * 6.5, abs=0.06)   # columns 2..11, median between 6 and 7
    assert r.elev_p10_m < r.elev_med_m
    half = Z.zonal_parcel("h", box(2.5, -12, 12, -2), {"elev": dem}, T)   # half of column 2 inside
    assert half.area_m2 == pytest.approx(9.5 * 10)


def test_twi_extremes_ignore_slivers():
    twi = np.full((20, 20), 5.0)
    twi[:, 12] = 15.0                                 # a ditch in the next column
    r = Z.zonal_parcel("p", box(2, -12, 12.2, -2), {"elev": np.zeros((20, 20)), "twi": twi}, T)
    assert r.twi_max == 5.0                           # 0.2-cell sliver of the ditch does not set the max
    assert 5.0 < r.twi_awm < 5.3                      # but it does nudge the area-weighted mean


def test_yard_only_excludes_footprint():
    y, x = np.mgrid[0:20, 0:20].astype(float)
    dem = np.where(x < 7, 6.0, 5.0)                   # house pad on the west half is raised
    lot = box(2, -12, 12, -2)
    full = Z.zonal_parcel("p", lot, {"elev": dem}, T)
    yard = Z.zonal_parcel("p", lot, {"elev": dem}, T, footprints=box(2, -12, 7, -2))
    assert yard.yard_only and not full.yard_only
    assert yard.elev_med_m == pytest.approx(5.0)
    assert full.elev_med_m > yard.elev_med_m
    tiny_yard = Z.zonal_parcel("p", lot, {"elev": dem}, T, footprints=box(2, -12, 11.9, -2))
    assert not tiny_yard.yard_only                    # < 20 m2 of yard left: fall back to the lot


def test_tiny_lot_falls_back_to_centroid_and_partial_flag():
    dem = np.arange(100.0).reshape(10, 10)
    r = Z.zonal_parcel("t", box(3.4, -3.6, 3.6, -3.4), {"elev": dem}, T)
    assert r.geom_mode in ("centroid", "polygon")
    assert r.elev_med_m == dem[3, 3]
    edge = Z.zonal_parcel("e", box(-2, -5, 3, 0), {"elev": dem}, T)
    assert edge.geom_mode == "polygon_partial"


def test_dem_source_fraction():
    src = np.ones((10, 10))
    src[:, 5:] = 10.0
    r = Z.zonal_parcel("s", box(3, -8, 7, -2), {"elev": np.zeros((10, 10)), "srcres": src}, T)
    assert r.dem_1m_frac == pytest.approx(0.5)


def grid_lots(n=3, size=20.0):
    lots, ids = [], []
    for i in range(n):
        for j in range(n):
            lots.append(box(j * size, i * size, (j + 1) * size - 1, (i + 1) * size - 1))
            ids.append(f"L{i}{j}")
    return ids, lots


def test_bowl_among_neighbours():
    ids, lots = grid_lots()
    em = np.full(len(ids), 5.0)
    em[4] = 4.7                                       # centre lot 0.3 m below its 8 neighbours
    road = LineString([(-10, -6), (70, -6)])          # street along the south edge
    xy = NB.sample_lines([road])
    street = np.column_stack([xy, np.full(len(xy), 5.1)])
    out = NB.neighbour_relative(ids, lots, em, street)
    assert out["L11"]["nbr_rel_m"] == pytest.approx(-0.3)
    assert out["L11"]["nbr_count"] == 8
    assert out["L00"]["nbr_rel_m"] == pytest.approx(0.0)      # corner lot vs its 3 level neighbours
    assert out["L01"]["street_rel_m"] == pytest.approx(-0.1)  # front row lots see the road
    assert out["L21"]["street_rel_m"] is None                 # back row is > 35 m from it


def test_sample_raster_and_lines():
    dem = np.arange(25.0).reshape(5, 5)
    xy = NB.sample_lines([LineString([(0.5, -0.5), (4.5, -0.5)])], spacing=1.0)
    assert len(xy) == 5
    assert list(NB.sample_raster(xy, dem, T)) == [0, 1, 2, 3, 4]
