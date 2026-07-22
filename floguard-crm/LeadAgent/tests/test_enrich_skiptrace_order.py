"""Residential enrichment must skip-trace first and never DDG-search.

Regression for the junk-contact bug: DDG website discovery matched
name-collision sites for residential owner names ("LOWE JAKE" → lowes.com),
wrote junk phone/email, and blocked the skip-trace pass entirely.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from leadagent.db import Database
from leadagent.enrich.research import enrich_lead
from leadagent.models import Lead
from leadagent.settings import Settings

SKIPTRACE_ACTOR = "one-api/skip-trace"


def _settings(db_path: Path, **kw) -> Settings:
    base = dict(
        openai_api_key="",
        apify_token="test-token",
        apify_dry_run=False,
        enrich_free_discovery=True,
        leadagent_db=db_path,
        leadagent_config_dir=Path(__file__).resolve().parents[1] / "config",
    )
    base.update(kw)
    return Settings(**base)


def _residential(db: Database, **kw) -> Lead:
    base = dict(
        name="LOWE JAKE",
        owner="LOWE JAKE",
        lead_type="french_drain",
        address="1604 TURNBULL CROSSINGS DR, NEW SMYRNA BEACH, FL 32168",
        city="NEW SMYRNA BEACH",
        zip="32168",
        phone="",
        website="",
        email="",
    )
    base.update(kw)
    return db.upsert_lead(Lead(**base))


def _run(settings, db, lead, *, run_actor, batchdata=None, scrape=None):
    ddg = MagicMock(return_value="")
    scrape_mock = MagicMock(
        return_value=scrape or {"emails": [], "phones": [], "pages_checked": 0, "source_url": ""}
    )
    bd = MagicMock(return_value=batchdata)
    with (
        patch("leadagent.enrich.research.ApifyClient.run_actor", side_effect=run_actor),
        patch("leadagent.enrich.research.discover_website_via_search", ddg),
        patch("leadagent.enrich.research.scrape_website_contacts", scrape_mock),
        patch("leadagent.enrich.research.batchdata_skip_trace", bd),
        patch("leadagent.enrich.research._apply_drainage_score", lambda b, l: None),
    ):
        brief = enrich_lead(settings, db, lead, force=True)
    return brief, ddg, scrape_mock, bd


def test_residential_uses_skiptrace_not_ddg(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    lead = _residential(db)
    calls: list[str] = []

    def fake_run(actor_id, run_input, timeout_secs=120):
        calls.append(actor_id)
        if actor_id == SKIPTRACE_ACTOR:
            return [{"Phone-1": "(386) 555-0142", "Email-1": "jake@example.net"}]
        return []

    brief, ddg, _, _ = _run(_settings(tmp_path / "t.db"), db, lead, run_actor=fake_run)

    assert SKIPTRACE_ACTOR in calls
    ddg.assert_not_called()
    assert brief.phone == "(386) 555-0142"
    assert "jake@example.net" in brief.emails_found

    saved = db.get_lead(lead.id)
    assert saved.phone == "(386) 555-0142"
    assert saved.email == "jake@example.net"
    assert not saved.website  # no lowes.com-style junk


def test_batchdata_fallback_when_skiptrace_misses(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    lead = _residential(db)

    def fake_run(actor_id, run_input, timeout_secs=120):
        return []  # skip-trace miss

    brief, _, _, bd = _run(
        _settings(tmp_path / "t.db", batchdata_api_key="test-key"),
        db,
        lead,
        run_actor=fake_run,
        batchdata={
            "ok": True,
            "provider": "batchdata",
            "phones": ["(386) 555-0100"],
            "emails": ["owner@example.net"],
        },
    )

    bd.assert_called_once()
    assert brief.phone == "(386) 555-0100"
    assert "owner@example.net" in brief.emails_found


def test_batchdata_skipped_on_skiptrace_full_hit(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    lead = _residential(db)

    def fake_run(actor_id, run_input, timeout_secs=120):
        if actor_id == SKIPTRACE_ACTOR:
            return [{"Phone-1": "3865550142", "Email-1": "jake@example.net"}]
        return []

    _, _, _, bd = _run(
        _settings(tmp_path / "t.db", batchdata_api_key="test-key"),
        db,
        lead,
        run_actor=fake_run,
    )
    bd.assert_not_called()


def test_skiptrace_requires_address(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    lead = _residential(db, address="", zip="")
    calls: list[str] = []

    def fake_run(actor_id, run_input, timeout_secs=120):
        calls.append(actor_id)
        return []

    _run(_settings(tmp_path / "t.db"), db, lead, run_actor=fake_run)
    assert SKIPTRACE_ACTOR not in calls


def test_commercial_flow_unchanged(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    lead = db.upsert_lead(
        Lead(
            name="Sunrise Property Management",
            lead_type="property_mgmt",
            address="100 Main St, Daytona Beach, FL 32114",
            city="Daytona Beach",
            phone="",
            website="",
            email="",
        )
    )
    calls: list[str] = []

    def fake_run(actor_id, run_input, timeout_secs=120):
        calls.append(actor_id)
        return []

    _, ddg, _, _ = _run(_settings(tmp_path / "t.db"), db, lead, run_actor=fake_run)

    assert SKIPTRACE_ACTOR not in calls
    ddg.assert_called_once()  # commercial keeps DDG website discovery


def test_residential_existing_website_still_scraped(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    lead = _residential(db, website="https://realhome.example")

    def fake_run(actor_id, run_input, timeout_secs=120):
        return []

    _, ddg, scrape_mock, _ = _run(
        _settings(tmp_path / "t.db"),
        db,
        lead,
        run_actor=fake_run,
        scrape={
            "emails": ["owner@realhome.example"],
            "phones": [],
            "pages_checked": 1,
            "source_url": "https://realhome.example",
        },
    )

    ddg.assert_not_called()
    scrape_mock.assert_called_once()
