"""Address normalisation and matching for proxy labels."""
from pipeline import proxy_labels as PL

PARCELS = [
    {"parcel_id": "100", "address": "123 N MAIN ST", "zip": "32114"},
    {"parcel_id": "200", "address": "45 OCEAN SHORE BLVD", "zip": "32176"},
    {"parcel_id": "300", "address": "45 OCEAN SHORE BLVD", "zip": "32118"},
    {"parcel_id": "400", "address": "7 PELICAN CT UNIT 2", "zip": "32127"},
]


def test_normalize():
    assert PL.normalize_address("123 North Main Street, Apt 4") == "123 N MAIN ST"
    assert PL.normalize_address("123 N. Main St #4B") == "123 N MAIN ST"
    assert PL.normalize_address("45 Ocean Shore Boulevard, Ormond Beach FL") == "45 OCEAN SHORE BLVD"
    assert PL.split_number("123 N MAIN ST") == ("123", "N MAIN ST")


def test_match_exact_fuzzy_ambiguous():
    idx = PL.ParcelIndex(PARCELS)
    assert PL.ParcelIndex(PARCELS).match("123 North Main Street")[:2] == ("100", "exact")
    pid, how, score = idx.match("123 N MAINE ST")
    assert (pid, how) == ("100", "fuzzy") and score >= PL.FUZZY_MIN
    assert idx.match("45 Ocean Shore Blvd")[:2] == (None, "no_match") or idx.match("45 Ocean Shore Blvd")[0] is None
    assert idx.match("45 Ocean Shor Blvd")[:2] == (None, "ambiguous")      # two parcels, no zip to split them
    assert idx.match("45 Ocean Shore Blvd", "32118")[0] == "300"
    assert idx.match("999 NOWHERE RD")[0] is None
    assert idx.match("7 Pelican Court")[0] == "400"


def test_ingest_rows():
    idx = PL.ParcelIndex(PARCELS)
    rows = [{"Address": "123 N. Main Street", "Date": "2024-10-10", "label_source": "permit_drainage", "weight": "1"},
            {"parcel_id": "200", "date": "2022-09-30", "label_source": "ian_damage", "weight": "0.8"},
            {"address": "123 N Main St", "date": "2023-01-01", "label_source": "complaint", "weight": "2", "label": "0"},
            {"address": "no number street", "date": "2023-01-01"}]
    m, u = PL.ingest(rows, idx)
    assert [x["parcel_id"] for x in m] == ["100", "200", "100"]
    assert m[0]["match_method"] == "exact" and m[0]["date"] == "2024-10-10"
    assert any(x["match_method"] == "parcel_id" and x["weight"] == 0.8 for x in m)
    assert any(x["label"] == 0 and x["weight"] == 1.0 for x in m)          # weight clamped to 1
    assert any(r["reason"] == "no_house_number" for r in u)
