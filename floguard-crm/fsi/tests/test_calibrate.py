"""Calibration recovers known weights; refuses below the sample-size floor; no spatial leakage."""
import numpy as np
import pytest

from pipeline import calibrate as CA
from pipeline import config as C1

TRUE = {"twi": 0.35, "hand_inv": 0.25, "depr": 0.20, "soil": 0.12, "zone": 0.08}
ZONES = ["X", "X-SHADED", "AE", "AO"]
HSGS = ["A", "B", "C", "D"]


def synth(n=6000, n_tracts=120, seed=3, scale=10.0, dyn=False):
    rng = np.random.default_rng(seed)
    parcels, labels = {}, []
    for i in range(n):
        p = {"parcel_id": f"P{i}", "census_tract": f"T{i % n_tracts}",
             "twi_n": rng.uniform(), "hand_n": rng.uniform(), "depr_n": rng.uniform(),
             "hsg": HSGS[rng.integers(4)], "fema_zone": ZONES[rng.integers(4)]}
        f = CA.features_v1(p)
        lin = scale * sum(TRUE[k] * f[k] for k in TRUE) - scale * 0.55
        api = rng.uniform() if dyn else None
        r24 = rng.uniform() if dyn else None
        if dyn:
            lin += 2.0 * (0.6 * api + 0.4 * r24) - 1.0
        y = int(rng.uniform() < 1 / (1 + np.exp(-lin)))
        parcels[p["parcel_id"]] = {k: str(v) for k, v in p.items()}
        labels.append({"parcel_id": p["parcel_id"], "y": y, "w": 1.0, "source": "lead_outcomes",
                       "api": api, "rain24": r24})
    return parcels, labels


def test_recovers_known_static_weights():
    parcels, labels = synth()
    rep = CA.calibrate(parcels, labels, "v1")
    w = rep["weights"]
    got = {"twi": w["w1_twi"], "hand_inv": w["w2_hand"], "depr": w["w_depr"], "soil": w["w3_soil"], "zone": w["w4_zone"]}
    for k in TRUE:
        assert got[k] == pytest.approx(TRUE[k], abs=0.05), (k, got)
    assert rep["cv"]["auc"] > 0.75
    assert rep["sign_conflicts"] == []
    lift = rep["cv"]["lift_by_decile"]
    assert lift[0]["lift"] > 1.8 and lift[-1]["lift"] < 0.5          # top decile ~2x base rate
    assert len(rep["cv"]["calibration_curve"]) >= 5


def test_dynamic_terms_and_alpha():
    parcels, labels = synth(dyn=True)
    rep = CA.calibrate(parcels, labels, "v1")
    assert rep["counts"]["dynamic_used"]
    assert rep["weights"]["w5_api"] == pytest.approx(0.6, abs=0.12)
    assert rep["weights"]["alpha"] is not None and rep["weights"]["alpha"] > 0


def test_refuses_below_minimum():
    parcels, labels = synth(n=80)
    rep = CA.calibrate(parcels, labels, "v1")
    assert rep["weights"] is None and "not enough labels" in rep["refused"]
    assert rep["thresholds"]["min_minority_effective"] == max(30, 10 * 5)


def test_low_weight_labels_count_less():
    parcels, labels = synth(n=400)
    for l in labels:
        l["w"] = 0.05 if l["parcel_id"] != "P0" else 1.0              # one heavy label dominates
    rep = CA.calibrate(parcels, labels, "v1")
    assert rep["weights"] is None                                      # Kish effective n collapses


def test_spatial_folds_never_share_tracts(monkeypatch):
    from sklearn.model_selection import GroupKFold
    seen = []
    orig = GroupKFold.split

    def spy(self, X, y=None, groups=None):
        for tr, te in orig(self, X, y, groups):
            seen.append(set(np.asarray(groups)[tr]) & set(np.asarray(groups)[te]))
            yield tr, te
    monkeypatch.setattr(GroupKFold, "split", spy)
    parcels, labels = synth(n=2000)
    CA.calibrate(parcels, labels, "v1")
    assert seen and all(not s for s in seen)


def test_build_labels_from_outcomes_and_proxies():
    parcels = {f"P{i}": {"parcel_id": f"P{i}", "census_tract": "T1"} for i in range(50)}
    outcomes = [{"parcel_id": "P1", "water_confirmed": "true", "outcome": "won", "api_at": "75", "rain_24h_at": "0"},
                {"parcel_id": "P2", "water_confirmed": "false", "outcome": "lost"},
                {"parcel_id": "P3", "water_confirmed": "", "outcome": "no_show"},
                {"parcel_id": "NOPE", "water_confirmed": "true"}]
    proxies = [{"parcel_id": "P10", "label": "1", "weight": "0.5", "label_source": "complaint"}]
    labs = CA.build_labels(parcels, outcomes, proxies, "water", background_ratio=3)
    assert [(l["parcel_id"], l["y"]) for l in labs[:3]] == [("P1", 1), ("P2", 0), ("P10", 1)]
    assert labs[0]["api"] == pytest.approx(0.5)
    assert sum(1 for l in labs if l["source"] == "background") == 3
    won = CA.build_labels(parcels, outcomes, [], "won", 0)
    assert [(l["parcel_id"], l["y"]) for l in won] == [("P1", 1), ("P2", 0)]


def test_production_baseline_reported():
    parcels, labels = synth(n=3000)
    rep = CA.calibrate(parcels, labels, "v1")
    assert rep["production_weights"]["w1_twi"] == C1.W_TWI
    assert 0.5 < rep["baseline_production"]["auc"] <= 1.0
