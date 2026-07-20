from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from leadagent.models import Draft, Lead, Research


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    city TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    lead_type TEXT DEFAULT 'website',
    categories TEXT DEFAULT '[]',
    phone TEXT DEFAULT '',
    website TEXT DEFAULT '',
    email TEXT DEFAULT '',
    contact_name TEXT DEFAULT '',
    status TEXT DEFAULT 'New',
    notes TEXT DEFAULT '',
    source TEXT DEFAULT '',
    custom_type TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    payload_json TEXT DEFAULT '{}',
    summary TEXT DEFAULT '',
    scraped_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    channel TEXT DEFAULT 'email',
    direction TEXT DEFAULT 'outbound',
    subject TEXT DEFAULT '',
    body TEXT DEFAULT '',
    subjects_alt TEXT DEFAULT '[]',
    body_alt TEXT DEFAULT '',
    follow_up TEXT DEFAULT '',
    angle_note TEXT DEFAULT '',
    research_ids TEXT DEFAULT '[]',
    status TEXT DEFAULT 'pending_approval',
    external_id TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id INTEGER NOT NULL,
    decision TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    note TEXT DEFAULT '',
    FOREIGN KEY (draft_id) REFERENCES drafts(id)
);

CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    kind TEXT NOT NULL,
    detail_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
);
"""


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self.connection() as conn:
            conn.executescript(SCHEMA)
            # Lightweight migrations for existing DBs
            cols = {
                r[1] for r in conn.execute("PRAGMA table_info(leads)").fetchall()
            }
            if "categories" not in cols:
                conn.execute("ALTER TABLE leads ADD COLUMN categories TEXT DEFAULT '[]'")

    def log_activity(
        self, kind: str, lead_id: int | None = None, detail: dict[str, Any] | None = None
    ) -> None:
        with self.connection() as conn:
            conn.execute(
                "INSERT INTO activity (lead_id, kind, detail_json, created_at) VALUES (?,?,?,?)",
                (lead_id, kind, json.dumps(detail or {}), utc_now()),
            )

    # --- Leads ---

    def _row_to_lead(self, row: sqlite3.Row) -> Lead:
        d = dict(row)
        if not d.get("categories"):
            d["categories"] = json.dumps([d["lead_type"]] if d.get("lead_type") else [])
        return Lead(**{k: d[k] for k in Lead.model_fields if k in d})

    def upsert_lead(self, lead: Lead) -> Lead:
        now = utc_now()
        if not lead.categories or lead.categories == "[]":
            lead.set_categories([lead.lead_type] if lead.lead_type else [])
        with self.connection() as conn:
            if lead.id:
                conn.execute(
                    """UPDATE leads SET name=?, city=?, industry=?, lead_type=?, categories=?,
                       phone=?, website=?, email=?, contact_name=?, status=?, notes=?, source=?,
                       custom_type=?, updated_at=? WHERE id=?""",
                    (
                        lead.name,
                        lead.city,
                        lead.industry,
                        lead.lead_type,
                        lead.categories,
                        lead.phone,
                        lead.website,
                        lead.email,
                        lead.contact_name,
                        lead.status,
                        lead.notes,
                        lead.source,
                        lead.custom_type,
                        now,
                        lead.id,
                    ),
                )
                lead.updated_at = now
                return lead
            cur = conn.execute(
                """INSERT INTO leads
                   (name, city, industry, lead_type, categories, phone, website, email,
                    contact_name, status, notes, source, custom_type, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    lead.name,
                    lead.city,
                    lead.industry,
                    lead.lead_type,
                    lead.categories,
                    lead.phone,
                    lead.website,
                    lead.email,
                    lead.contact_name,
                    lead.status,
                    lead.notes,
                    lead.source,
                    lead.custom_type,
                    now,
                    now,
                ),
            )
            lead.id = int(cur.lastrowid)
            lead.created_at = now
            lead.updated_at = now
            return lead

    def find_lead_by_name_city(self, name: str, city: str = "") -> Lead | None:
        """Match for multi-category merge on import."""
        name = (name or "").strip().lower()
        city = (city or "").strip().lower()
        if not name:
            return None
        with self.connection() as conn:
            if city:
                row = conn.execute(
                    "SELECT * FROM leads WHERE lower(name)=? AND lower(city)=? LIMIT 1",
                    (name, city),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM leads WHERE lower(name)=? LIMIT 1", (name,)
                ).fetchone()
            return self._row_to_lead(row) if row else None

    def merge_categories(self, lead: Lead, extra: list[str]) -> Lead:
        cats = lead.category_list()
        for c in extra:
            k = str(c).strip().lower()
            if k and k not in cats:
                cats.append(k)
        lead.set_categories(cats)
        return self.upsert_lead(lead)

    def get_lead(self, lead_id: int) -> Lead | None:
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
            return self._row_to_lead(row) if row else None

    def list_leads(
        self,
        lead_type: str | None = None,
        city: str | None = None,
        status: str | None = None,
        category: str | None = None,
        limit: int = 100,
    ) -> list[Lead]:
        q = "SELECT * FROM leads WHERE 1=1"
        params: list[Any] = []
        if lead_type and not category:
            # primary type OR membership in categories JSON
            q += " AND (lead_type=? OR categories LIKE ?)"
            params.extend([lead_type, f'%"{lead_type}"%'])
        if category:
            q += " AND (lead_type=? OR categories LIKE ?)"
            params.extend([category, f'%"{category}"%'])
        if city:
            q += " AND city LIKE ?"
            params.append(f"%{city}%")
        if status:
            q += " AND status=?"
            params.append(status)
        q += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        with self.connection() as conn:
            rows = conn.execute(q, params).fetchall()
            return [self._row_to_lead(r) for r in rows]

    def count_leads(self) -> int:
        with self.connection() as conn:
            return int(conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0])

    # --- Research ---

    def add_research(self, research: Research) -> Research:
        now = utc_now()
        with self.connection() as conn:
            cur = conn.execute(
                """INSERT INTO research (lead_id, source, payload_json, summary, scraped_at)
                   VALUES (?,?,?,?,?)""",
                (
                    research.lead_id,
                    research.source,
                    research.payload_json,
                    research.summary,
                    now,
                ),
            )
            research.id = int(cur.lastrowid)
            research.scraped_at = now
            return research

    def latest_research(self, lead_id: int) -> list[Research]:
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM research WHERE lead_id=? ORDER BY id DESC LIMIT 20",
                (lead_id,),
            ).fetchall()
            return [Research(**dict(r)) for r in rows]

    # --- Drafts ---

    def add_draft(self, draft: Draft) -> Draft:
        now = utc_now()
        with self.connection() as conn:
            cur = conn.execute(
                """INSERT INTO drafts
                   (lead_id, channel, direction, subject, body, subjects_alt, body_alt,
                    follow_up, angle_note, research_ids, status, external_id, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    draft.lead_id,
                    draft.channel,
                    draft.direction,
                    draft.subject,
                    draft.body,
                    draft.subjects_alt,
                    draft.body_alt,
                    draft.follow_up,
                    draft.angle_note,
                    draft.research_ids,
                    draft.status,
                    draft.external_id,
                    now,
                ),
            )
            draft.id = int(cur.lastrowid)
            draft.created_at = now
            return draft

    def get_draft(self, draft_id: int) -> Draft | None:
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM drafts WHERE id=?", (draft_id,)).fetchone()
            return Draft(**dict(row)) if row else None

    def list_drafts(self, status: str | None = None, limit: int = 50) -> list[Draft]:
        q = "SELECT * FROM drafts WHERE 1=1"
        params: list[Any] = []
        if status:
            q += " AND status=?"
            params.append(status)
        q += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        with self.connection() as conn:
            rows = conn.execute(q, params).fetchall()
            return [Draft(**dict(r)) for r in rows]

    def update_draft_status(
        self, draft_id: int, status: str, external_id: str | None = None
    ) -> None:
        with self.connection() as conn:
            if external_id is not None:
                conn.execute(
                    "UPDATE drafts SET status=?, external_id=? WHERE id=?",
                    (status, external_id, draft_id),
                )
            else:
                conn.execute(
                    "UPDATE drafts SET status=? WHERE id=?", (status, draft_id)
                )

    def add_approval(self, draft_id: int, decision: str, note: str = "") -> None:
        with self.connection() as conn:
            conn.execute(
                "INSERT INTO approvals (draft_id, decision, decided_at, note) VALUES (?,?,?,?)",
                (draft_id, decision, utc_now(), note),
            )

    def count_sends_today(self) -> int:
        today = utc_now()[:10]
        with self.connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) FROM drafts WHERE status='sent' AND created_at LIKE ?",
                (f"{today}%",),
            ).fetchone()
            # Also count by activity
            row2 = conn.execute(
                "SELECT COUNT(*) FROM activity WHERE kind='send' AND created_at LIKE ?",
                (f"{today}%",),
            ).fetchone()
            return max(int(row[0]), int(row2[0]))
