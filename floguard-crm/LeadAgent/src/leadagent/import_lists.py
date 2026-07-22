"""Import FloGuard Lead Tools CSVs into the leadagent DB (multi-category merge).

Lists (looked up in the local ``Lead Tools/`` folder):
  HOMEOWNERS     List_Homeowners.csv     → homeowner drainage leads
  PROPERTY_MGMT  List_Property_Mgmt.csv  → property-management (B2B) leads

CSV columns (both files, header row required):
  name           Homeowner or company name. Rows whose name starts with
                 "EXAMPLE" are template rows and are skipped.
  address        Street address → Lead.address (also kept in notes for DNS context).
  city           City (merge key together with name).
  zip            Optional ZIP → Lead.zip
  phone          Phone number.
  email          Email address.
  property_type  e.g. "Single-family home", "Rental portfolio" → Lead.industry.
  issue_notes    Free-text drainage issue description → Lead.notes (also feeds
                 the Drainage Need Score and category detection).
  source         Where the lead came from (door-knock, quiz, referral, …).

Category assignment:
  Homeowner rows default to ``french_drain`` (CRM list "FrenchDrain"). The
  category is overridden when issue_notes match:
    crawlspace|sump|musty                → sump_pump   (SumpPump)
    lanai|patio|driveway|grading         → yard_drainage (YardDrainage)
    maintenance|service|inspect          → maintenance (Maintenance)
  Property-mgmt rows always get ``property_mgmt`` (PropertyMgmt).

Same name+city merges into one lead with a categories JSON array, exactly like
the original multi-list importer.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Any

from leadagent.db import Database
from leadagent.models import Lead

# Default locations under the FloGuard monorepo (no legacy HD paths).
# parents[2] = LeadAgent/, parents[3] = floguard-crm/
_LEADAGENT_ROOT = Path(__file__).resolve().parents[2]
_CRM_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_LIST_DIRS = [
    _CRM_ROOT / "Lead Tools",
    _LEADAGENT_ROOT / "Lead Tools",
    Path(r"C:\1projects\floguard\floguard-crm\Lead Tools"),
]

LIST_FILES = {
    "HOMEOWNERS": "List_Homeowners.csv",
    "PROPERTY_MGMT": "List_Property_Mgmt.csv",
}

# issue_notes keyword → category overrides (checked in order; first hit wins)
_CATEGORY_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"crawl ?space|sump|musty", re.I), "sump_pump"),
    (re.compile(r"lanai|patio|driveway|grading", re.I), "yard_drainage"),
    (re.compile(r"maintenance|service|inspect", re.I), "maintenance"),
]


def resolve_list_dir(explicit: Path | None = None) -> Path:
    if explicit and explicit.exists():
        return explicit
    for d in DEFAULT_LIST_DIRS:
        d = d.resolve()
        if any((d / fname).exists() for fname in LIST_FILES.values()):
            return d
    raise FileNotFoundError(
        "Lead Tools lists not found. Pass --lists-dir to the folder containing "
        "List_Homeowners.csv / List_Property_Mgmt.csv."
    )


def _clean(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def category_for_issue_notes(issue_notes: str) -> str:
    """Homeowner category: french_drain default, keyword overrides per docstring."""
    text = issue_notes or ""
    for rx, cat in _CATEGORY_RULES:
        if rx.search(text):
            return cat
    return "french_drain"


def _is_template_row(name: str) -> bool:
    return name.strip().upper().startswith("EXAMPLE")


def _upsert_multi(
    db: Database,
    *,
    name: str,
    city: str,
    industry: str,
    primary_type: str,
    categories: list[str],
    phone: str = "",
    email: str = "",
    website: str = "",
    contact: str = "",
    address: str = "",
    zip: str = "",
    parcel_id: str = "",
    status: str = "New",
    notes: str = "",
    source: str = "",
) -> Lead:
    existing = db.find_lead_by_name_city(name, city)
    if existing:
        cats = existing.category_list()
        for c in categories:
            if c not in cats:
                cats.append(c)
        existing.set_categories(cats)
        # Prefer richer fields
        if industry and not existing.industry:
            existing.industry = industry
        if phone and not existing.phone:
            existing.phone = phone
        if email and not existing.email:
            existing.email = email
        if website and not existing.website:
            existing.website = website
        if contact and not existing.contact_name:
            existing.contact_name = contact
        if address and not existing.address:
            existing.address = address
        if zip and not existing.zip:
            existing.zip = zip
        if parcel_id and not existing.parcel_id:
            existing.parcel_id = parcel_id
        if notes:
            if notes not in (existing.notes or ""):
                existing.notes = (existing.notes + " | " + notes).strip(" |")
        if source and source not in (existing.source or ""):
            existing.source = (
                f"{existing.source},{source}" if existing.source else source
            )
        # Keep primary lead_type unless empty
        if not existing.lead_type or existing.lead_type == "needs_classification":
            existing.lead_type = primary_type
        return db.upsert_lead(existing)

    lead = Lead(
        name=name,
        city=city,
        industry=industry,
        lead_type=primary_type,
        phone=phone,
        email=email,
        website=website,
        contact_name=contact,
        address=address,
        zip=zip,
        parcel_id=parcel_id,
        status=status or "New",
        notes=notes,
        source=source,
    )
    lead.set_categories(categories)
    return db.upsert_lead(lead)


def _row_notes(issue_notes: str) -> str:
    return (issue_notes or "").strip()


def import_homeowners(db: Database, path: Path) -> dict[str, int]:
    """Homeowner rows — french_drain default with issue-note category overrides."""
    added = updated = skipped = 0
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            name = _clean(row.get("name"))
            if not name or _is_template_row(name):
                skipped += 1
                continue
            address = _clean(row.get("address"))
            city = _clean(row.get("city"))
            zip_code = _clean(row.get("zip") or row.get("postal"))
            phone = _clean(row.get("phone"))
            email = _clean(row.get("email"))
            property_type = _clean(row.get("property_type"))
            issue_notes = _clean(row.get("issue_notes"))
            source = _clean(row.get("source"))

            category = category_for_issue_notes(issue_notes)

            before = db.find_lead_by_name_city(name, city)
            _upsert_multi(
                db,
                name=name,
                city=city,
                industry=property_type or "Single-family home",
                primary_type=category,
                categories=[category],
                phone=phone,
                email=email,
                address=address,
                zip=zip_code,
                status="New",
                notes=_row_notes(issue_notes),
                source=source or "List_Homeowners",
            )
            if before:
                updated += 1
            else:
                added += 1
    return {"added": added, "updated": updated, "skipped": skipped}


def import_property_mgmt(db: Database, path: Path) -> dict[str, int]:
    """Property-management (B2B) rows — always property_mgmt."""
    added = updated = skipped = 0
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            name = _clean(row.get("name"))
            if not name or _is_template_row(name):
                skipped += 1
                continue
            address = _clean(row.get("address"))
            city = _clean(row.get("city"))
            zip_code = _clean(row.get("zip") or row.get("postal"))
            phone = _clean(row.get("phone"))
            email = _clean(row.get("email"))
            property_type = _clean(row.get("property_type"))
            issue_notes = _clean(row.get("issue_notes"))
            source = _clean(row.get("source"))

            before = db.find_lead_by_name_city(name, city)
            _upsert_multi(
                db,
                name=name,
                city=city,
                industry=property_type or "Property Management",
                primary_type="property_mgmt",
                categories=["property_mgmt"],
                phone=phone,
                email=email,
                address=address,
                zip=zip_code,
                status="New",
                notes=_row_notes(issue_notes),
                source=source or "List_Property_Mgmt",
            )
            if before:
                updated += 1
            else:
                added += 1
    return {"added": added, "updated": updated, "skipped": skipped}


def import_all_lists(
    db: Database,
    lists_dir: Path | None = None,
    *,
    which: str = "ALL",
) -> dict[str, Any]:
    """
    Import the FloGuard lists. Multi-category merge by name+city so one
    prospect can sit on several funnels without duplicate rows.

    which: "HOMEOWNERS", "PROPERTY_MGMT", or "ALL" (case-insensitive).
    """
    root = resolve_list_dir(lists_dir)
    which = (which or "ALL").strip().upper()
    results: dict[str, Any] = {"lists_dir": str(root), "lists": {}}

    if which in ("ALL", "HOMEOWNERS"):
        p = root / LIST_FILES["HOMEOWNERS"]
        results["lists"]["HOMEOWNERS"] = (
            import_homeowners(db, p) if p.exists() else {"error": "missing"}
        )
    if which in ("ALL", "PROPERTY_MGMT"):
        p = root / LIST_FILES["PROPERTY_MGMT"]
        results["lists"]["PROPERTY_MGMT"] = (
            import_property_mgmt(db, p) if p.exists() else {"error": "missing"}
        )

    results["total_leads"] = db.count_leads()
    db.log_activity("import_lists", None, results)
    return results
