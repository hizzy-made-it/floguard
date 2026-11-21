
import json

import pytest

from pipeline.repair_corridor_grid import LARGE_HUC, RELEASE, repair_release
from pipeline.terrain_grid import flow_seam_status, grid_cell, resolution_summary


@pytest.mark.parametrize("value", [0, -1, None, True, "bad", float("inf"), float("nan")])
def test_invalid_processing_cell_is_not_silently_defaulted(value):
    with pytest.raises(ValueError):
        grid_cell(value)


def row(pid, huc=LARGE_HUC, area=100, native=1):
    return {
        "parcel_id": pid, "huc12": huc, "lot_area_m2": area, "dem_res_m": native,
        "dem_1m_frac": float(native == 1), "fsi_confidence": 0.812,
        "fsi_inputs": {"dem_res_m": native, "release": RELEASE, "huc12": huc},
    }


def test_source_grid_and_effective_resolution_are_distinct():
    rows = [
        {"dem_1m_frac": 1, "fsi_inputs": {"grid_cell_m": 2}},
        {"dem_1m_frac": 1, "fsi_inputs": {"grid_cell_m": 1}},
        {"dem_1m_frac": 0, "fsi_inputs": {"grid_cell_m": 1}},
    ]
    summary = resolution_summary(rows)
    assert summary["grid_cell_m_counts"] == {"1": 2, "2": 1}
    assert summary["dem_source_1m_share"] == 2 / 3
    assert summary["effective_1m_share"] == 1 / 3


def test_seam_tolerance_not_reported_as_exact():
    assert flow_seam_status({"residual_cells": 0, "residual_mfd_cells": 0.00009}) == "residual"
    assert flow_seam_status({"residual_cells": 0, "residual_mfd_cells": 0}) == "converged"
    assert flow_seam_status({"residual_cells": 0}) == "unknown"


def test_archive_repair_preserves_both_source_and_confidence(tmp_path):
    src = tmp_path / "source"
    src.mkdir()
    filename = "parcel_terrain_v2_00.json"
    rows = [row("p2", int(LARGE_HUC), area=4), row("p1", "030802010100")]
    (src / filename).write_text(json.dumps(rows))
    (src / "summary.json").write_text(json.dumps({"parcels": 2, "parts": [filename]}))
    dest = tmp_path / "dest"
    summary = repair_release(src, dest, expected_rows=2, expected_large=1, expected_parts=[filename])
    corrected = json.loads((dest / filename).read_text())
    assert summary["effective_1m_share"] == 0.5
    assert summary["dem_source_1m_share"] == 1.0
    assert summary["confidence_legacy_grid_penalty_pending"] == 1
    assert summary["activation_ready"] is False
    assert corrected[0]["huc12"] == corrected[0]["fsi_inputs"]["huc12"] == LARGE_HUC
    assert corrected[0]["fsi_inputs"]["grid_cell_m"] == 2
    assert corrected[0]["fsi_inputs"]["confidence_legacy_grid_penalty"]
    assert corrected[1]["fsi_inputs"]["grid_cell_m"] == 1
    assert [r["fsi_confidence"] for r in corrected] == [r["fsi_confidence"] for r in rows]
    assert [r["dem_res_m"] for r in corrected] == [r["dem_res_m"] for r in rows]
    assert json.loads((src / filename).read_text()) == rows


def test_archive_repair_does_not_emit_partial_destination(tmp_path):
    src = tmp_path / "source"
    src.mkdir()
    filename = "parcel_terrain_v2_00.json"
    (src / filename).write_text(json.dumps([row("same"), row("same")]))
    (src / "summary.json").write_text(json.dumps({"parcels": 2, "parts": [filename]}))
    dest = tmp_path / "dest"
    with pytest.raises(ValueError, match="duplicate"):
        repair_release(src, dest, expected_rows=2, expected_large=2, expected_parts=[filename])
    assert not dest.exists()
