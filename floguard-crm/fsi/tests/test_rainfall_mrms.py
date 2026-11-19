"""MRMS grid indexing, URL building, GRIB/GeoTIFF value reading, per-cell API."""
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from pipeline import config
from pipeline import rainfall as R


def test_index_known_cells():
    assert R.mrms_index(54.9999, -129.9999) == (0, 0)
    assert R.mrms_index(20.0001, -60.0001) == (3499, 6999)
    # Volusia centroid; matches GDAL's index on the live 2026-11-18 file
    assert R.mrms_index(29.028, -81.0755) == (2597, 4892)
    with pytest.raises(ValueError):
        R.mrms_index(10.0, -81.0)


def test_center_roundtrip_and_ids():
    rng = np.random.default_rng(0)
    for lat, lon in zip(rng.uniform(28.6, 29.5, 500), rng.uniform(-81.7, -80.7, 500)):
        r, c = R.mrms_index(lat, lon)
        clat, clon = R.mrms_cell_center(r, c)
        assert abs(clat - lat) <= 0.005 + 1e-9 and abs(clon - lon) <= 0.005 + 1e-9
        assert R.mrms_index(clat, clon) == (r, c)
        assert R.parse_mrms_cell_id(R.mrms_cell_id(r, c)) == (r, c)


def test_url():
    u = R.mrms_url("24h", datetime(2026, 11, 18, 12, tzinfo=timezone.utc))
    assert u == ("https://noaa-mrms-pds.s3.amazonaws.com/CONUS/MultiSensor_QPE_24H_Pass2_00.00/20261118/"
                 "MRMS_MultiSensor_QPE_24H_Pass2_00.00_20261118-120000.grib2.gz")
    assert "QPE_72H_Pass2_00.00/20261118/" in R.mrms_url("72h", datetime(2026, 11, 18, 12, tzinfo=timezone.utc))


def test_read_values_from_synthetic_grid(tmp_path):
    import rasterio
    from affine import Affine

    arr = np.zeros((R.MRMS_NROWS, R.MRMS_NCOLS), dtype="float32")
    arr[2597, 4892] = 24.7
    arr[2597, 4893] = -3.0                            # missing
    p = tmp_path / "mrms.tif"
    with rasterio.open(p, "w", driver="GTiff", width=R.MRMS_NCOLS, height=R.MRMS_NROWS, count=1, dtype="float32",
                       crs="EPSG:4326", transform=Affine(0.01, 0, -130.0, 0, -0.01, 55.0), compress="deflate") as d:
        d.write(arr, 1)
    v = R.read_mrms_values(p, [(2597, 4892), (2597, 4893), (0, 0)])
    assert v[0] == pytest.approx(24.7, abs=1e-4) and v[1] is None and v[2] == 0.0


LIVE = Path("/tmp/mrms_dl/q.grib2")


@pytest.mark.skipif(not LIVE.exists(), reason="live MRMS sample not downloaded")
def test_read_live_grib():
    v = R.read_mrms_values(LIVE, [R.mrms_index(29.028, -81.0755)])
    assert v[0] is not None and v[0] >= 0


def test_cell_api_chain():
    k = config.API_DECAY_K
    assert R.advance_cell(10.0, date(2026, 11, 17), 5.0, 30.0, date(2026, 11, 18)) == pytest.approx(k * 10 + 5)
    assert R.advance_cell(10.0, date(2026, 11, 18), 5.0, 30.0, date(2026, 11, 18)) == 10.0   # same day rerun
    cold = R.advance_cell(None, None, 5.0, 25.0, date(2026, 11, 18))
    assert cold == pytest.approx(5 + (k + k * k) * 10)
    gap = R.advance_cell(10.0, date(2026, 11, 10), 5.0, 25.0, date(2026, 11, 18))
    assert gap == pytest.approx(cold)
