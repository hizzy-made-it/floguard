import json
from pathlib import Path

import httpx
import pytest

from leadagent.db import Database
from leadagent.models import Lead
from leadagent.settings import Settings
from leadagent.sync_academy import SyncError, pull_leads, push_leads, sync_status

SYNC_URL = "https://test.local/api/academy-leads"

# Retired HD Connex / Academy funnels — must never round-trip back in.
RETIRED_CATEGORIES = {"website", "sponsor", "dnd_restaurant", "dnd", "medrev", "academy", "duck"}


def _settings(tmp_path: Path, secret: str = "s3cret") -> Settings:
    return Settings(
        leadagent_db=tmp_path / "sync.db",
        academy_sync_url=SYNC_URL,
        academy_sync_secret=secret,
    )


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_push_sends_bulk_upsert_with_secret(tmp_path: Path):
    settings = _settings(tmp_path)
    db = Database(settings.leadagent_db)
    lead = Lead(
        name="Nguyen Residence",
        city="Port Orange",
        lead_type="french_drain",
        contact_name="Mai Nguyen",
        notes="DNS 78/B (urgent) | standing water for days; water in the crawlspace",
    )
    # Homeowner spanning two service lines
    lead.set_categories(["french_drain", "sump_pump"])
    db.upsert_lead(lead)

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["secret"] = request.headers.get("X-Academy-Sync-Secret")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True, "count": 1, "added": 1, "merged": 0})

    result = push_leads(settings, db, client=_client(handler))

    assert seen["url"] == SYNC_URL
    assert seen["secret"] == "s3cret"
    assert seen["body"]["action"] == "bulk_upsert"
    row = seen["body"]["leads"][0]
    assert row["list"] == "FrenchDrain"
    assert set(row["lists"]) == {"FrenchDrain", "SumpPump"}
    assert row["contact"] == "Mai Nguyen"  # contact_name → contact
    assert row["categories"] == ["french_drain", "sump_pump"]
    # Drainage Need Score rides along under the front-end's field name
    assert row["website_score"]["total"] == 78
    assert row["website_score"]["band"] == "urgent"
    assert result["pushed"] == 1
    assert result["added"] == 1


def test_pull_merges_status_and_categories(tmp_path: Path):
    settings = _settings(tmp_path)
    db = Database(settings.leadagent_db)
    local = Lead(name="Nguyen Residence", city="Port Orange", lead_type="french_drain")
    local.set_categories(["french_drain"])
    db.upsert_lead(local)

    server_rows = [
        {  # existing lead: status + contact + a second service line added in the CRM
            "name": "Nguyen Residence",
            "city": "Port Orange",
            "list": "FrenchDrain",
            "lists": ["FrenchDrain", "SumpPump"],
            "status": "Contacted",
            "contact": "Mai Nguyen",
            "phone": "386-555-0142",
        },
        {  # brand-new B2B lead with round-trip metadata
            "name": "Coastal Property Management",
            "city": "Daytona Beach",
            "list": "PropertyMgmt",
            "lists": ["PropertyMgmt"],
            "industry": "Property Management",
            "lead_type": "property_mgmt",
            "categories": ["property_mgmt"],
            "status": "New",
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["action"] == "list"
        return httpx.Response(
            200,
            json={"leads": server_rows, "count": 2, "updated_at": "2026-01-01T00:00:00Z"},
        )

    result = pull_leads(settings, db, client=_client(handler))
    assert result["updated"] == 1
    assert result["added"] == 1
    assert result["remote_count"] == 2
    assert result["remote_updated_at"] == "2026-01-01T00:00:00Z"

    nguyen = db.find_lead_by_name_city("Nguyen Residence", "Port Orange")
    assert nguyen.status == "Contacted"
    assert nguyen.contact_name == "Mai Nguyen"
    assert nguyen.phone == "386-555-0142"
    cats = nguyen.category_list()
    assert "french_drain" in cats  # original membership kept
    assert "sump_pump" in cats  # label-only row merged back to an internal key
    assert not RETIRED_CATEGORIES & set(cats)

    coastal = db.find_lead_by_name_city("Coastal Property Management", "Daytona Beach")
    assert coastal is not None
    assert coastal.lead_type == "property_mgmt"
    assert coastal.category_list() == ["property_mgmt"]
    assert coastal.industry == "Property Management"


def test_pull_skips_rows_without_a_name(tmp_path: Path):
    settings = _settings(tmp_path)
    db = Database(settings.leadagent_db)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"leads": [{"city": "Deltona", "list": "FrenchDrain"}, "not-a-row"], "count": 2},
        )

    result = pull_leads(settings, db, client=_client(handler))
    assert result == {
        "added": 0,
        "updated": 0,
        "skipped": 2,
        "remote_count": 2,
        "remote_updated_at": None,
    }
    assert db.count_leads() == 0


def test_auth_failure_raises_sync_error(tmp_path: Path):
    settings = _settings(tmp_path, secret="wrong")
    db = Database(settings.leadagent_db)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "bad secret"})

    with pytest.raises(SyncError, match="Auth failed"):
        sync_status(settings, db, client=_client(handler))


def test_missing_secret_raises_before_network(tmp_path: Path):
    settings = _settings(tmp_path, secret="")
    db = Database(settings.leadagent_db)

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("must not hit the network without a secret")

    with pytest.raises(SyncError, match="ACADEMY_SYNC_SECRET"):
        push_leads(settings, db, client=_client(handler))
