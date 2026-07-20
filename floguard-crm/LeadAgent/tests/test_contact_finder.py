"""Unit tests for contact extraction and lead writeback."""

from pathlib import Path
from unittest.mock import patch

from leadagent.db import Database
from leadagent.enrich.contact_finder import (
    contacts_from_apify_items,
    extract_emails,
    extract_phones,
    is_plausible_email,
    is_usable_website,
    normalize_phone,
    normalize_website,
)
from leadagent.enrich.research import enrich_lead
from leadagent.models import Lead
from leadagent.settings import Settings


def test_normalize_website_adds_https():
    assert normalize_website("example.com").startswith("https://")
    assert normalize_website("https://foo.com/") == "https://foo.com"
    assert normalize_website("none") == ""
    assert normalize_website("n/a") == ""


def test_is_usable_website_rejects_social():
    assert is_usable_website("https://joesgrill.com")
    assert not is_usable_website("https://facebook.com/joesgrill")
    assert not is_usable_website("none")


def test_normalize_phone_us():
    assert normalize_phone("3865551212") == "(386) 555-1212"
    assert normalize_phone("1-386-555-1212") == "(386) 555-1212"
    assert normalize_phone("(386) 555-1212") == "(386) 555-1212"


def test_extract_emails_filters_noise():
    text = """
    Contact us at info@joesgrill.com or sales@joesgrill.com.
    Ignore noreply@mail.wixpress.com and logo@cdn.example.com.png
    Also mailto:owner@joesgrill.com
    """
    emails = extract_emails(text)
    assert "info@joesgrill.com" in emails
    assert "sales@joesgrill.com" in emails
    assert not any("wixpress" in e for e in emails)
    assert not any(e.endswith(".png") for e in emails)


def test_is_plausible_email():
    assert is_plausible_email("hello@biz.com")
    assert not is_plausible_email("noreply@biz.com")
    assert not is_plausible_email("x@example.com")


def test_extract_phones():
    text = "Call (386) 555-0199 or 386.555.0200 today"
    phones = extract_phones(text)
    assert any("555-0199" in p for p in phones)
    assert len(phones) >= 1


def test_contacts_from_apify_maps_item():
    items = [
        {
            "title": "Joe's Grill",
            "phone": "+1 386-555-0100",
            "website": "www.joesgrill.com",
            "address": "100 Main St, Daytona Beach, FL",
            "totalScore": 4.6,
            "categoryName": "Restaurant",
            "email": "hello@joesgrill.com",
        }
    ]
    out = contacts_from_apify_items(items)
    assert out["phones"]
    assert normalize_phone(out["phones"][0]) == "(386) 555-0100"
    assert any("joesgrill.com" in w for w in out["websites"])
    assert "hello@joesgrill.com" in out["emails"]
    assert "Daytona" in out["address"]


def test_contacts_from_website_crawler_text():
    items = [
        {
            "url": "https://joesgrill.com/contact",
            "text": "Email: bookings@joesgrill.com Phone: 386-555-7777",
        }
    ]
    out = contacts_from_apify_items(items)
    assert "bookings@joesgrill.com" in out["emails"]
    assert any("555-7777" in p for p in out["phones"])


def test_enrich_writes_contacts_from_apify_and_scrape(tmp_path: Path):
    db_path = tmp_path / "t.db"
    settings = Settings(
        openai_api_key="",
        apify_token="test-token",
        apify_dry_run=False,
        leadagent_db=db_path,
        leadagent_config_dir=Path(__file__).resolve().parents[1] / "config",
    )
    db = Database(db_path)
    lead = Lead(
        name="Joe's Grill",
        city="Daytona Beach",
        lead_type="website",
        phone="",
        website="",
        email="",
    )
    lead = db.upsert_lead(lead)

    maps_item = {
        "title": "Joe's Grill",
        "phone": "3865550100",
        "website": "https://joesgrill.example",
        "address": "Daytona Beach, FL",
        "totalScore": 4.5,
    }
    site_html = """
    <html><body>
      <a href="mailto:info@joesgrill.example">Email us</a>
      <p>Call (386) 555-0100</p>
    </body></html>
    """

    def fake_run_actor(actor_id, run_input, timeout_secs=120):
        if "google-places" in actor_id or "crawler-google" in actor_id:
            return [maps_item]
        # website / contact actors — return text payload
        return [{"url": "https://joesgrill.example", "text": site_html}]

    with (
        patch("leadagent.enrich.research.ApifyClient.run_actor", side_effect=fake_run_actor),
        patch(
            "leadagent.enrich.research.scrape_website_contacts",
            return_value={
                "emails": ["info@joesgrill.example"],
                "phones": ["(386) 555-0100"],
                "pages_checked": 1,
                "source_url": "https://joesgrill.example/contact",
            },
        ),
        patch(
            "leadagent.enrich.research.discover_website_via_search",
            return_value="",
        ),
    ):
        brief = enrich_lead(settings, db, lead, force=True)

    refreshed = db.get_lead(lead.id)
    assert refreshed is not None
    assert refreshed.phone
    assert "555-0100" in refreshed.phone
    assert refreshed.website and "joesgrill" in refreshed.website
    assert refreshed.email == "info@joesgrill.example"
    assert brief.website_present
    assert brief.emails_found


def test_enrich_free_discovery_in_dry_run(tmp_path: Path):
    db_path = tmp_path / "t2.db"
    settings = Settings(
        openai_api_key="",
        apify_token="",
        apify_dry_run=True,
        leadagent_db=db_path,
        leadagent_config_dir=Path(__file__).resolve().parents[1] / "config",
    )
    db = Database(db_path)
    lead = Lead(
        name="Sunset Pier Cafe",
        city="Daytona Beach",
        lead_type="website",
        website="https://sunsetpier.example",
        phone="",
        email="",
    )
    lead = db.upsert_lead(lead)

    with patch(
        "leadagent.enrich.research.scrape_website_contacts",
        return_value={
            "emails": ["hello@sunsetpier.example"],
            "phones": ["(386) 555-9999"],
            "pages_checked": 2,
            "source_url": "https://sunsetpier.example/contact",
        },
    ):
        brief = enrich_lead(settings, db, lead, force=True)

    refreshed = db.get_lead(lead.id)
    assert refreshed is not None
    assert refreshed.email == "hello@sunsetpier.example"
    assert "555-9999" in (refreshed.phone or "")
    assert "hello@sunsetpier.example" in brief.emails_found
