"""Sync leads with the FloGuard CRM shared store (/api/academy-leads).

push: local SQLite → server (CRM JSON shape via export_academy).
pull: server → local SQLite (labels mapped back via LABEL_TO_TYPE,
      the CRM's `contact` → our `contact_name`; non-empty server fields win).
Auth is the X-Academy-Sync-Secret header (ACADEMY_SYNC_SECRET in .env),
never the Supabase service role or an OpenAI key.

The endpoint path and header name are the deployed backend's contract —
rebranding must not rename them.
"""

from __future__ import annotations

import httpx

from leadagent.db import Database
from leadagent.export_academy import build_academy_export
from leadagent.models import LABEL_TO_TYPE, LeadType, Lead
from leadagent.settings import Settings


class SyncError(RuntimeError):
    pass


# CRM row field → Lead field (identical names omitted where equal)
FIELD_MAP = [
    ("industry", "industry"),
    ("phone", "phone"),
    ("website", "website"),
    ("email", "email"),
    ("contact", "contact_name"),
    ("address", "address"),
    ("zip", "zip"),
    ("parcel_id", "parcel_id"),
    ("owner", "owner"),
    ("status", "status"),
    ("notes", "notes"),
    ("source", "source"),
]


def _address_from_notes(notes: str) -> str:
    """Recover site address buried in older FSI notes."""
    import re

    text = notes or ""
    m = re.search(r"(?im)^\s*Site address:\s*(.+)$", text)
    if m:
        v = m.group(1).strip()
        if v and v not in ("—", "-", "–") and v.lower() not in ("n/a", "na"):
            return v
    m = re.search(r"(?im)^\s*Addr(?:ess)?:\s*(.+)$", text)
    if m:
        v = m.group(1).strip()
        if v and v not in ("—", "-"):
            return v
    return ""

_VALID_TYPES = {t.value for t in LeadType}


def _post(settings: Settings, payload: dict, client: httpx.Client | None = None) -> dict:
    if not settings.academy_sync_secret:
        raise SyncError("ACADEMY_SYNC_SECRET is not set — add it to LeadAgent/.env.")
    headers = {"X-Academy-Sync-Secret": settings.academy_sync_secret}
    own = client is None
    c = client or httpx.Client(timeout=30.0)
    try:
        r = c.post(settings.academy_sync_url, json=payload, headers=headers)
    finally:
        if own:
            c.close()
    if r.status_code in (401, 403):
        raise SyncError(f"Auth failed ({r.status_code}) — check ACADEMY_SYNC_SECRET.")
    if r.status_code >= 400:
        raise SyncError(f"Sync failed ({r.status_code}): {r.text[:200]}")
    return r.json()


def _row_categories(row: dict) -> list[str]:
    """Internal category keys for a server row (prefer round-trip metadata)."""

    def _norm(key: str) -> str:
        return (key or "").strip().lower()

    cats = row.get("categories")
    if isinstance(cats, list) and cats:
        out: list[str] = []
        for c in cats:
            n = _norm(str(c))
            if n and n not in out:
                out.append(n)
        return out
    labels = row.get("lists") if isinstance(row.get("lists"), list) else []
    if not labels and row.get("list"):
        labels = [row["list"]]
    out = []
    for label in labels:
        key = LABEL_TO_TYPE.get(str(label).strip().lower())
        if key:
            key = _norm(key)
            if key and key not in out:
                out.append(key)
    return out


def push_leads(settings: Settings, db: Database, client: httpx.Client | None = None) -> dict:
    doc = build_academy_export(db)
    result = _post(settings, {"action": "bulk_upsert", "leads": doc["leads"]}, client)
    result["pushed"] = len(doc["leads"])
    return result


def pull_leads(settings: Settings, db: Database, client: httpx.Client | None = None) -> dict:
    data = _post(settings, {"action": "list"}, client)
    added = updated = skipped = 0
    for row in data.get("leads") or []:
        if not isinstance(row, dict):
            skipped += 1
            continue
        name = str(row.get("name") or "").strip()
        if not name:
            skipped += 1
            continue
        city = str(row.get("city") or "").strip()
        cats = _row_categories(row)
        lead_type = str(row.get("lead_type") or "").strip().lower()
        if lead_type not in _VALID_TYPES:
            lead_type = cats[0] if cats else "needs_classification"

        existing = db.find_lead_by_name_city(name, city)
        if existing:
            for src, dst in FIELD_MAP:
                v = row.get(src)
                if v is not None and str(v).strip() != "":
                    setattr(existing, dst, str(v))
            if not existing.city and city:
                existing.city = city
            if not (existing.address or "").strip():
                recovered = _address_from_notes(existing.notes or str(row.get("notes") or ""))
                if recovered:
                    existing.address = recovered
            db.merge_categories(existing, cats)  # merges + upserts
            updated += 1
        else:
            lead = Lead(name=name, city=city, lead_type=lead_type)
            for src, dst in FIELD_MAP:
                v = row.get(src)
                if v is not None and str(v).strip() != "":
                    setattr(lead, dst, str(v))
            if not (lead.address or "").strip():
                recovered = _address_from_notes(lead.notes or str(row.get("notes") or ""))
                if recovered:
                    lead.address = recovered
            lead.set_categories(cats or [lead_type])
            db.upsert_lead(lead)
            added += 1
    return {
        "added": added,
        "updated": updated,
        "skipped": skipped,
        "remote_count": data.get("count"),
        "remote_updated_at": data.get("updated_at"),
    }


def sync_status(settings: Settings, db: Database, client: httpx.Client | None = None) -> dict:
    data = _post(settings, {"action": "list"}, client)
    return {
        "local_leads": db.count_leads(),
        "remote_leads": data.get("count"),
        "remote_updated_at": data.get("updated_at"),
        "url": settings.academy_sync_url,
    }
