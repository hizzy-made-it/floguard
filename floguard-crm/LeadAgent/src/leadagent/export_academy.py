"""Export leads to the FloGuard CRM JSON shape (import file / sync payload).

CRM lead rows use display labels (`list` primary + `lists` array) from
CATEGORY_LABELS, plus `contact` (the CRM name for our `contact_name`).
Internal metadata (`lead_type`, `categories`, `source`) rides along — the
CRM UI ignores unknown fields but stores leads whole, so it survives
a round trip back through `leadagent sync pull` / `import-leads`.

Wire names (`academy_leads.json`, the `/api/academy-leads` endpoint, and the
`website_score` row key) are the deployed backend's contract and stay as-is —
`website_score` now carries the Drainage Need Score (DNS) object.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from leadagent.db import Database
from leadagent.models import CATEGORY_LABELS, Lead

SCHEMA_VERSION = 1
DEFAULT_EXPORT_NAME = "academy_leads.json"

# Fallback CRM list for a lead with no mappable category yet (e.g.
# needs_classification). Mirrors the front-end's own default — normalizeList()
# in public/crm/index.html resolves anything unknown to 'FrenchDrain'.
DEFAULT_LIST_LABEL = CATEGORY_LABELS["french_drain"]


def _parse_dns_note(notes: str) -> dict | None:
    """Parse the Drainage Need Score wire line written by enrich/drainage_score.py
    (``score_compact_note`` / ``apply_score_note``):

        DNS 78/B (urgent) | standing water for days; water in the crawlspace
    """
    import re

    text = (notes or "").strip()
    if not text:
        return None
    m = re.search(
        r"DNS\s+(\d{1,3})/([A-F])\s*\((urgent|priority|monitor)\)\s*(?:\|\s*([^\n]+))?",
        text,
        re.I,
    )
    if not m:
        return None
    gaps_raw = (m.group(4) or "").strip()
    gaps = [g.strip() for g in gaps_raw.split(";") if g.strip()] if gaps_raw else []
    return {
        "total": int(m.group(1)),
        "grade": m.group(2).upper(),
        "band": m.group(3).lower(),
        "gaps": gaps,
    }


def lead_to_academy(lead: Lead) -> dict:
    """Map an internal Lead to one FloGuard CRM lead row."""
    lists: list[str] = []
    cats = lead.category_list()
    for cat in cats:
        label = CATEGORY_LABELS.get(cat)
        if label and label not in lists:
            lists.append(label)
    primary = CATEGORY_LABELS.get(lead.lead_type, "")
    if not lists:
        lists = [primary or DEFAULT_LIST_LABEL]
    if primary and primary not in lists:
        lists.insert(0, primary)
    row = {
        "id": lead.id,
        "name": lead.name,
        "city": lead.city,
        "industry": lead.industry,
        "list": primary or lists[0],
        "lists": lists,
        "phone": lead.phone,
        "website": lead.website,
        "contact": lead.contact_name,
        "email": lead.email,
        "status": lead.status or "New",
        "notes": lead.notes,
        "source": lead.source,
        "lead_type": lead.lead_type,
        "categories": cats,
    }
    dns = _parse_dns_note(lead.notes or "")
    if dns:
        # Explicit object so the CRM prospect card + Score column hydrate without
        # re-parsing. `website_score` is the deployed front-end's field name for
        # the score object (public/crm/index.html) — keep it even though the
        # score itself is now the Drainage Need Score.
        row["website_score"] = dns
        # Keep notes as-is (already include the compact DNS line from research)
    return row


def build_academy_export(db: Database, lead_type: str | None = None) -> dict:
    """Build the full export document {version, exported_at, leads}."""
    leads = db.list_leads(lead_type=lead_type, category=lead_type, limit=100000)
    return {
        "version": SCHEMA_VERSION,
        "exported_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "leads": [lead_to_academy(lead) for lead in leads],
    }


def export_academy_leads(
    db: Database, out_path: Path, lead_type: str | None = None
) -> dict:
    """Write the export JSON to out_path; returns the document."""
    doc = build_academy_export(db, lead_type=lead_type)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    return doc
