"""Soil term resolution, SDA parsing, v2 score shape, confidence."""
import math

import geopandas as gpd
import pytest
from shapely.geometry import box

from pipeline import confidence as CF
from pipeline import config_v2 as C2
from pipeline import soils as SO


@pytest.mark.parametrize("raw,drained,exp", [
    ("A/D", False, ("D", True)), ("B/D", False, ("D", True)), ("C/D", False, ("D", True)),
    ("A/D", True, ("A", True)), ("B", False, ("B", False)), (None, False, (None, False)),
    (" a / d ", False, ("D", True)),
])
def test_dual_groups_are_undrained_d(raw, drained, exp):
    assert C2.hsg_effective(raw, drained) == exp


def test_parse_sda_payload_and_units():
    payload = {"Table": [["mukey", "muname", "hydgrpdcd", "drclassdcd", "wtdepannmin", "wtdepaprjunmin", "ksat_min_top100"],
                         ["1544175", "Astor fine sand", "A/D", "Very poorly drained", "0", "0", "92"],
                         ["1544109", "Astatula", "A", "Excessively drained", None, None, "141"]]}
    attrs = SO.mukey_attributes(SO.parse_sda(payload))
    assert attrs["1544175"] == {"hsg": "A/D", "drain_class": "Very poorly drained", "ksat_um_s": 92.0,
                                "wt_depth_m": 0.0, "muname": "Astor fine sand"}
    assert attrs["1544109"]["wt_depth_m"] == SO.WT_NULL_M      # null = no water table within 200 cm


def test_parcel_soils_area_weighted():
    parcels = gpd.GeoDataFrame({"parcel_id": ["p1", "p2"]},
                               geometry=[box(0, 0, 10, 10), box(20, 0, 30, 10)], crs="EPSG:26917")
    soils = gpd.GeoDataFrame({"mukey": ["1", "2"]},
                             geometry=[box(-5, -5, 7.5, 15), box(7.5, -5, 25, 15)], crs="EPSG:26917")
    attrs = {"1": {"hsg": "A/D", "drain_class": "Poorly drained", "ksat_um_s": 100.0, "wt_depth_m": 0.0},
             "2": {"hsg": "C", "drain_class": "Well drained", "ksat_um_s": 1.0, "wt_depth_m": 2.0}}
    out = SO.parcel_soils(parcels, soils, attrs)
    p1 = out["p1"]
    assert p1["hsg"] == "A/D" and p1["hsg_eff"] == "D" and p1["hsg_dual"]
    assert p1["wt_depth_m"] == pytest.approx(0.5)              # 75% at 0 m, 25% at 2 m
    assert p1["ksat_um_s"] == pytest.approx(10 ** (0.75 * 2))  # geometric mean
    assert p1["soil_cov"] == pytest.approx(1.0)
    assert out["p2"]["soil_cov"] == pytest.approx(0.5)         # half the lot outside the soil layer


def test_v2_terms():
    assert C2.ksat_score(1.0) == 1.0 and C2.ksat_score(100.0) == 0.0 and C2.ksat_score(10.0) == pytest.approx(0.5)
    assert C2.wt_score(0.0) == 1.0 and C2.wt_score(2.5) == 0.0 and C2.wt_score(None) == 0.5
    assert C2.bowl_score(-0.6, None) == 1.0 and C2.bowl_score(0.2, None) == 0.0
    assert C2.bowl_score(-0.3, 0.0) == pytest.approx(0.3)
    assert C2.depr_v2_n(1.0, 1.0) == 1.0 and C2.depr_v2_n(0.5, 0.0) == pytest.approx(0.3)
    assert sum(C2.W2.values()) == pytest.approx(1.0)


def test_v2_score_orders_bowl_above_ridge():
    wet = C2.static_score_v2(0.9, 0.1, 0.8, -0.4, -0.3, "D", "Very poorly drained", 2.0, 0.0, "X")
    dry = C2.static_score_v2(0.1, 0.9, 0.0, 0.5, 0.4, "A", "Excessively drained", 150.0, 2.0, "X")
    assert 0 <= dry < 0.3 < 0.7 < wet <= 1


def test_confidence_range_and_ordering():
    best = CF.fsi_confidence(dem_1m_frac=1.0, geom_mode="polygon", soil_cov=1.0, nhd=True,
                             culverts_or_inlets=True, rank_diffs=[0.0, 0.0])
    worst = CF.fsi_confidence(dem_1m_frac=0.0, geom_mode="centroid", soil_cov=None, nhd=False,
                              culverts_or_inlets=False, rank_diffs=[0.9, 0.9])
    mid = CF.fsi_confidence(dem_1m_frac=1.0, geom_mode="polygon", soil_cov=1.0, nhd=True,
                            culverts_or_inlets=False, rank_diffs=[])
    assert best == 1.0 and 0 < worst < 0.4 and worst < mid < best
    sliver = CF.fsi_confidence(dem_1m_frac=1.0, geom_mode="polygon", soil_cov=1.0, nhd=True,
                               culverts_or_inlets=True, rank_diffs=[0, 0], area_m2=4.0)
    assert sliver == pytest.approx(0.8)
    assert CF.fsi_inputs(a=1, b=None) == {"a": 1}
