"""Hydrology kernels on synthetic DEMs with known answers."""
import numpy as np
import pytest

from pipeline import hydro as H


def bowl(n=41, k=0.002, spill=5.45):
    y, x = np.mgrid[0:n, 0:n].astype(float)
    c = (n - 1) / 2
    return np.minimum(5.0 + k * ((x - c) ** 2 + (y - c) ** 2), spill)


def test_bowl_depression_depth_is_rim_minus_ground():
    dem = bowl()
    d = H.depression_depth(dem)
    assert d[20, 20] == pytest.approx(0.45, abs=1e-9)          # spill 5.45 - floor 5.00
    assert d[20, 30] == pytest.approx(0.45 - 0.002 * 100, abs=1e-9)
    assert d[0, 0] == 0.0 and d[20, 39] == 0.0                   # flat rim region is not a basin


def test_bowl_inlet_makes_it_drain():
    dem = bowl()
    inlet = np.zeros(dem.shape, bool)
    inlet[20, 20] = True
    d = H.depression_depth(dem, outlets=inlet)
    assert np.nanmax(d) == 0.0                                   # a working inlet = no closed basin


def test_epsilon_fill_drains_everywhere():
    dem = bowl()
    c = H.condition_dem(dem, max_breach_cells=2)                 # bowl too wide to breach
    assert c["n_breached"] == 0
    r = H.d8_receivers(c["routing"], np.isfinite(dem))
    nr, nc = dem.shape
    interior = np.zeros(dem.shape, bool)
    interior[1:-1, 1:-1] = True
    assert (r.reshape(dem.shape)[interior] >= 0).all()           # no interior pits left
    acc, _ = H.accumulate(c["routing"], np.isfinite(dem), np.ones_like(dem))
    out = r.reshape(dem.shape) < 0
    assert acc[out].sum() == pytest.approx(dem.size)             # mass conserved at the outlets


def ridge(nr=40, nc=61):
    y, x = np.mgrid[0:nr, 0:nc].astype(float)
    return 10.0 - 0.1 * np.abs(x - 30) - 0.01 * y


def test_ridge_twi_low_hand_high():
    dem = ridge()
    valid = np.isfinite(dem)
    chan = np.zeros(dem.shape, bool)
    chan[:, 0] = chan[:, -1] = True
    c = H.condition_dem(dem, flowline_mask=chan, burn_depth_m=0.0)
    acc, _ = H.accumulate(c["routing"], valid, np.ones_like(dem), method="mfd")
    tw = H.twi(acc, H.slope_radians(c["breached"], 1.0), 1.0)
    hd = H.hand(c["breached"], c["routing"], valid, chan)
    r = 20
    assert tw[r, 30] < tw[r, 5] < tw[r, 1]                       # wetness grows downslope
    assert hd[r, 30] == pytest.approx(3.0, abs=0.35)             # ridge 3 m above the channels
    assert hd[r, 0] == 0.0 and hd[r, -1] == 0.0
    assert hd[r, 30] > hd[r, 20] > hd[r, 10] > 0                 # monotone toward the channel


def embankment(width=4, height=1.5):
    nr, nc = 41, 60
    y, x = np.mgrid[0:nr, 0:nc].astype(float)
    dem = 10.0 - 0.02 * x + 0.05 * np.abs(y - 20)                # valley along row 20 draining east
    dem[:, 30:30 + width] += height                              # road fill across the valley
    return dem


def test_embankment_false_dam_without_culvert():
    dem = embankment()
    d = H.depression_depth(dem)
    assert d[20, 28] > 0.5                                       # ponds behind the road fill


def test_embankment_culvert_removes_false_dam():
    dem = embankment()
    culvert = [H.line_cells(20, 27, 20, 36)]
    c = H.condition_dem(dem, culverts=culvert, max_breach_cells=1)
    d = H.depression_depth(c["basin_dem"])
    assert d[20, 28] < 0.01                                      # basin measure sees the pipe
    assert c["basin_dem"][20, 31] < dem[20, 31] - 1.0            # invert carved through the fill
    # Flow from upstream crosses the road along the culvert line.
    valid = np.isfinite(dem)
    r = H.d8_receivers(c["routing"], valid)
    i = 20 * dem.shape[1] + 25
    path = []
    while i >= 0 and len(path) < 200:
        path.append(divmod(i, dem.shape[1]))
        i = r[i]
    crossing = [p for p in path if 30 <= p[1] < 34]
    assert crossing and all(p[0] == 20 for p in crossing)


def test_breach_is_bounded_by_length():
    dem = embankment(width=4)
    short, n_short = H.breach_depressions(dem, max_length_cells=2)
    long_, n_long = H.breach_depressions(dem, max_length_cells=8)
    assert H.depression_depth(short)[20, 28] > 0.5               # 4-cell fill, 2-cell limit: stays a dam
    assert n_long >= 1
    assert H.depression_depth(long_)[20, 28] < 1e-3              # 8-cell limit cuts through


def test_true_basin_kept_when_breaching_routes_through():
    """Routing may breach the road, but the closed-basin layer must not."""
    dem = embankment(width=4)
    c = H.condition_dem(dem, max_breach_cells=8)
    assert H.depression_depth(c["breached"])[20, 28] < 1e-3
    assert H.depression_depth(c["basin_dem"])[20, 28] > 0.5


def test_nhd_burn_lowers_only_masked_cells():
    dem = ridge()
    m = np.zeros(dem.shape, bool)
    m[10, :] = True
    b = H.burn_mask(dem, m, 1.0)
    assert np.allclose(dem[m] - b[m], 1.0) and np.array_equal(dem[~m], b[~m])


def test_slope_of_plane():
    y, x = np.mgrid[0:10, 0:10].astype(float)
    s = H.slope_radians(0.1 * x, 2.0)                           # 0.1 m per 2 m cell = 5%
    assert np.allclose(s[2:-2, 2:-2], np.arctan(0.05))
