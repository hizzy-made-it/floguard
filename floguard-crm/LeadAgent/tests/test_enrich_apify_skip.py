"""Apify must not re-run the same lead within TTL unless force=True."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from leadagent.db import Database
from leadagent.enrich.research import enrich_lead
from leadagent.models import Lead
from leadagent.settings import Settings


def _settings(db_path: Path) -> Settings:
    return Settings(
        openai_api_key="",
        apify_token="test-token",
        apify_dry_run=False,
        enrich_free_discovery=False,
        leadagent_db=db_path,
        leadagent_config_dir=Path(__file__).resolve().parents[1] / "config",
    )


def _lead(db: Database, **kw) -> Lead:
    base = dict(
        name="Acme Plumbing",
        city="Daytona Beach",
        lead_type="website",
        phone="",
        website="",
        email="",
    )
    base.update(kw)
    return db.upsert_lead(Lead(**base))


def test_apify_runs_once_then_skips(tmp_path: Path):
    db_path = tmp_path / "t.db"
    settings = _settings(db_path)
    db = Database(db_path)
    lead = _lead(db)

    maps_item = {
        "title": "Acme Plumbing",
        "phone": "3865550100",
        "website": "https://acmeplumbing.example",
        "address": "Daytona Beach, FL",
        "categoryName": "Plumber",
        "totalScore": 4.2,
    }
    calls: list[str] = []

    def fake_run(actor_id, run_input, timeout_secs=120):
        calls.append(actor_id)
        if "google" in actor_id or "places" in actor_id:
            return [maps_item]
        return [{"url": "https://acmeplumbing.example", "text": "Call 386-555-0100 email info@acmeplumbing.example"}]

    with (
        patch("leadagent.enrich.research.ApifyClient.run_actor", side_effect=fake_run),
        patch(
            "leadagent.enrich.research._apply_drainage_score",
            lambda brief, lead: None,
        ),
    ):
        b1 = enrich_lead(settings, db, lead, force=False)
        assert calls, "first enrich must call Apify"
        first_calls = len(calls)
        assert b1.raw.get("apify_decision", {}).get("run") is True

        lead2 = db.get_lead(lead.id)
        assert lead2 and lead2.phone

        b2 = enrich_lead(settings, db, lead2, force=False)
        assert len(calls) == first_calls, "second enrich must not call Apify again"
        decision = (b2.raw or {}).get("apify_decision") or {}
        assert decision.get("run") is False
        assert decision.get("reason") in (
            "cache_complete",
            "prior Apify run",
        ) or "ago" in str(decision.get("reason") or "") or str(
            decision.get("reason") or ""
        ).startswith("prior") or decision.get("reason") == "cache_complete"


def test_force_reruns_apify(tmp_path: Path):
    db_path = tmp_path / "t2.db"
    settings = _settings(db_path)
    db = Database(db_path)
    lead = _lead(db, phone="(386) 555-0100", website="https://acmeplumbing.example")

    calls: list[str] = []

    def fake_run(actor_id, run_input, timeout_secs=120):
        calls.append(actor_id)
        return [
            {
                "phone": "3865550100",
                "website": "https://acmeplumbing.example",
                "categoryName": "Plumber",
            }
        ]

    with (
        patch("leadagent.enrich.research.ApifyClient.run_actor", side_effect=fake_run),
        patch("leadagent.enrich.research._apply_drainage_score", lambda b, l: None),
        patch("leadagent.enrich.research._run_free_contact_pass", lambda *a, **k: None),
    ):
        enrich_lead(settings, db, lead, force=True)
        n1 = len(calls)
        assert n1 >= 1
        lead = db.get_lead(lead.id)
        enrich_lead(settings, db, lead, force=True)
        assert len(calls) > n1


def test_writeback_fills_industry_and_contacts(tmp_path: Path):
    db_path = tmp_path / "t3.db"
    settings = _settings(db_path)
    db = Database(db_path)
    lead = _lead(db, industry="")

    maps_item = {
        "phone": "3865559999",
        "website": "https://biz.example",
        "categoryName": "Home Services",
        "email": "hello@biz.example",
    }

    with (
        patch(
            "leadagent.enrich.research.ApifyClient.run_actor",
            return_value=[maps_item],
        ),
        patch("leadagent.enrich.research._apply_drainage_score", lambda b, l: None),
        patch("leadagent.enrich.research._run_free_contact_pass", lambda *a, **k: None),
    ):
        enrich_lead(settings, db, lead, force=True)

    r = db.get_lead(lead.id)
    assert r is not None
    assert "555-9999" in (r.phone or "") or "5559999" in (r.phone or "").replace("-", "")
    assert r.website and "biz.example" in r.website
    assert r.email == "hello@biz.example"
    assert r.industry == "Home Services"
