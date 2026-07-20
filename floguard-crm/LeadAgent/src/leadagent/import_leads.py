from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from leadagent.classify import normalize_tracker_list
from leadagent.db import Database
from leadagent.models import Lead

# Minimal FloGuard seed for bootstrap when no CSV provided. Fictional sample
# leads only — notes are written in the shape the Drainage Need Score reads.
BOOTSTRAP_SEED = [
    {
        "name": "Sample Homeowner — Ridgewood Ave",
        "city": "Port Orange",
        "industry": "Residential",
        "list": "FrenchDrain",
        "notes": "Back yard holds standing water for days after storms; pooling near the foundation",
    },
    {
        "name": "Sample Homeowner — Beachside",
        "city": "New Smyrna Beach",
        "industry": "Residential",
        "list": "SumpPump",
        "notes": "Musty crawlspace after heavy rain; no pump installed",
    },
    {
        "name": "Sample Property Management Co",
        "city": "Ormond Beach",
        "industry": "Property Management",
        "list": "PropertyMgmt",
        "notes": "Portfolio of rentals; recurring tenant complaints about flooded yards",
    },
]


def lead_from_tracker_row(row: dict) -> Lead:
    list_val = row.get("list") or row.get("lead_type") or row.get("List") or "Website"
    lead_type = normalize_tracker_list(str(list_val))
    status = row.get("status") or row.get("Status") or "New"
    if str(list_val).strip().lower() == "client":
        lead_type = "client"
    lead = Lead(
        name=str(row.get("name") or row.get("Business") or "").strip(),
        city=str(row.get("city") or row.get("City") or "").strip(),
        industry=str(row.get("industry") or row.get("Industry") or "").strip(),
        lead_type=lead_type,
        phone=str(row.get("phone") or row.get("Phone") or "").strip(),
        website=str(row.get("website") or row.get("Website") or "").strip(),
        email=str(row.get("email") or row.get("Email") or "").strip(),
        contact_name=str(row.get("contact") or row.get("contact_name") or "").strip(),
        status=str(status).strip() or "New",
        notes=str(row.get("notes") or row.get("Notes") or "").strip(),
        source=str(row.get("source") or "import").strip(),
        custom_type=str(row.get("custom_type") or "").strip(),
    )
    # Optional multi-category from row.lists / row.categories
    cats_raw = row.get("categories") or row.get("lists") or []
    if isinstance(cats_raw, str):
        import json

        try:
            cats_raw = json.loads(cats_raw)
        except json.JSONDecodeError:
            cats_raw = [c.strip() for c in cats_raw.split(",") if c.strip()]
    if isinstance(cats_raw, list) and cats_raw:
        lead.set_categories(
            [normalize_tracker_list(str(c)) for c in cats_raw] + [lead_type]
        )
    else:
        lead.set_categories([lead_type])
    return lead


def import_csv(db: Database, path: Path) -> int:
    count = 0
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            lead = lead_from_tracker_row(row)
            if not lead.name:
                continue
            db.upsert_lead(lead)
            count += 1
    db.log_activity("import_csv", None, {"path": str(path), "count": count})
    return count


def import_json(db: Database, path: Path) -> int:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "leads" in data:
        data = data["leads"]
    count = 0
    for row in data:
        lead = lead_from_tracker_row(row)
        if not lead.name:
            continue
        db.upsert_lead(lead)
        count += 1
    db.log_activity("import_json", None, {"path": str(path), "count": count})
    return count


def import_bootstrap(db: Database) -> int:
    count = 0
    for row in BOOTSTRAP_SEED:
        lead = lead_from_tracker_row(row)
        db.upsert_lead(lead)
        count += 1
    db.log_activity("import_bootstrap", None, {"count": count})
    return count


def extract_seed_from_html(html_path: Path) -> list[dict]:
    """Best-effort extract SEED JSON array from tracker HTML."""
    text = html_path.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"const SEED\s*=\s*(\[.*?\]);", text, re.DOTALL)
    if not m:
        return []
    raw = m.group(1)
    # HTML may truncate in some copies; try parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return []


def import_tracker_html(db: Database, html_path: Path) -> int:
    rows = extract_seed_from_html(html_path)
    if not rows:
        return import_bootstrap(db)
    count = 0
    for row in rows:
        lead = lead_from_tracker_row(row)
        if not lead.name:
            continue
        db.upsert_lead(lead)
        count += 1
    db.log_activity("import_html", None, {"path": str(html_path), "count": count})
    return count
