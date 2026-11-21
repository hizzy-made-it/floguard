"""Repair provenance in a local copy of the pinned November 20 corridor artifact.

The old artifact lacks the unrounded rank and geometry inputs needed to reassemble
confidence exactly. Keep the archived score fields intact, flag those rows and
do not use this metadata-only artifact to activate terrain v2.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from .terrain_grid import resolution_summary

RELEASE = "terrain-v2-corridor-2026-11-20"
LARGE_HUC = "030802010700"
EXPECTED_ROWS = 110_990
EXPECTED_LARGE = 10_449
EXPECTED_PARTS = [f"parcel_terrain_v2_{i:02d}.json" for i in range(12)]


def repair_row(row):
    provenance = row["fsi_inputs"]
    huc = row["huc12"]
    if provenance.get("release") != RELEASE or provenance.get("huc12") != huc:
        raise ValueError(f"wrong release/HUC for {row['parcel_id']}")
    # The original pandas assembly parsed numeric watershed IDs as integers.
    # Only normalize the known legacy representation for the pinned corridor.
    raw_huc = str(huc)
    if len(raw_huc) not in (11, 12) or not raw_huc.isascii() or not raw_huc.isdigit():
        raise ValueError(f"invalid HUC12 for {row['parcel_id']}")
    huc = raw_huc.zfill(12)
    cell = 2 if huc == LARGE_HUC else 1
    if provenance.get("grid_cell_m", cell) != cell:
        raise ValueError(f"conflicting grid cell for {row['parcel_id']}")
    if provenance.get("dem_res_m") != row.get("dem_res_m"):
        raise ValueError(f"inconsistent native DEM label for {row['parcel_id']}")
    area = row.get("lot_area_m2")
    legacy_size_penalty = cell == 2 and area is not None and area < 9
    inputs = {**provenance, "huc12": huc, "grid_cell_m": cell}
    if legacy_size_penalty:
        inputs["confidence_legacy_grid_penalty"] = True
    return {**row, "huc12": huc, "fsi_inputs": inputs}, legacy_size_penalty


def repair_release(source: Path, destination: Path, *, expected_rows=EXPECTED_ROWS,
                   expected_large=EXPECTED_LARGE, expected_parts=EXPECTED_PARTS):
    """Fail closed on a partial, duplicate, unexpected or mixed release."""
    if destination.resolve() == source.resolve() or destination.exists():
        raise ValueError("destination must be a new directory separate from the source")
    summary = json.loads((source / "summary.json").read_text(encoding="utf-8"))
    if summary["parts"] != expected_parts or summary["parcels"] != expected_rows:
        raise ValueError("unexpected parts or parcel count in source summary")
    parts, ids, hucs, rows, pending = {}, set(), Counter(), [], 0
    for name in expected_parts:
        raw = (source / name).read_bytes()
        fixed = []
        for row in json.loads(raw):
            parcel = row["parcel_id"]
            if parcel in ids:
                raise ValueError(f"duplicate parcel id {parcel}")
            ids.add(parcel)
            corrected, flagged = repair_row(row)
            hucs[corrected["huc12"]] += 1
            pending += flagged
            fixed.append(corrected)
        encoded = json.dumps(fixed, separators=(",", ":"), allow_nan=False).encode("utf-8")
        parts[name] = (hashlib.sha256(raw).hexdigest(), encoded)
        rows.extend(fixed)
    if len(ids) != expected_rows or hucs[LARGE_HUC] != expected_large:
        raise ValueError(f"unexpected counts: {len(ids)} unique parcels; {hucs[LARGE_HUC]} in 2 m HUC12")
    result = {
        **summary, **resolution_summary(rows),
        "confidence_legacy_grid_penalty_pending": pending,
        "flow_seam_validation": "pending",
        "activation_ready": False,
        "source_part_sha256": {name: sha for name, (sha, _) in parts.items()},
        "corrected_part_sha256": {name: hashlib.sha256(data).hexdigest() for name, (_, data) in parts.items()},
    }
    destination.mkdir(parents=True)
    for name, (_, data) in parts.items():
        (destination / name).write_bytes(data)
    (destination / "summary.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    print(json.dumps(repair_release(args.source, args.destination), indent=2))


if __name__ == "__main__":
    main()
