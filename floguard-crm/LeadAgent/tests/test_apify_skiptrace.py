"""Unit tests for the Apify one-api/skip-trace provider."""

from __future__ import annotations

from unittest.mock import MagicMock

from leadagent.enrich.apify_skiptrace import (
    apify_skip_trace,
    build_skiptrace_input,
    parse_skiptrace_items,
)
from leadagent.models import Lead


def _lead(**kw) -> Lead:
    base = dict(
        name="LOWE JAKE",
        lead_type="french_drain",
        address="1604 TURNBULL CROSSINGS DR, NEW SMYRNA BEACH, FL 32168",
        city="NEW SMYRNA BEACH",
        zip="32168",
    )
    base.update(kw)
    return Lead(**base)


def _client(dry_run: bool = False) -> MagicMock:
    client = MagicMock()
    client.dry_run = dry_run
    return client


def test_input_semicolon_format():
    lead = _lead(address="3828 Double Oak Ln, Irving, TX 75061", city="Irving", zip="75061")
    run_input = build_skiptrace_input(lead)
    assert run_input == {
        "street_citystatezip": ["3828 Double Oak Ln; Irving, TX 75061"],
        "max_results": 1,
    }


def test_input_zip_and_state_from_address():
    lead = _lead(city="", zip="")
    run_input = build_skiptrace_input(lead)
    assert run_input is not None
    (entry,) = run_input["street_citystatezip"]
    assert entry.startswith("1604 TURNBULL CROSSINGS DR; ")
    assert "NEW SMYRNA BEACH" in entry
    assert "FL 32168" in entry


def test_input_city_zip_from_lead_fields():
    lead = _lead(address="123 Palm Ave", city="Port Orange", zip="32127")
    run_input = build_skiptrace_input(lead)
    assert run_input == {
        "street_citystatezip": ["123 Palm Ave; Port Orange, FL 32127"],
        "max_results": 1,
    }


def test_input_none_when_unusable():
    assert build_skiptrace_input(_lead(address="", city="", zip="")) is None
    # Street only, no city or zip anywhere
    assert build_skiptrace_input(_lead(address="123 Palm Ave", city="", zip="")) is None


def test_no_address_returns_ok_false():
    result = apify_skip_trace(_lead(address="", city="", zip=""), client=_client())
    assert result == {"ok": False, "provider": "apify_skiptrace", "error": "no_address"}


def test_dry_run_returns_none():
    client = _client(dry_run=True)
    assert apify_skip_trace(_lead(), client=client) is None
    client.run_actor.assert_not_called()


def test_parse_phone_email_columns():
    items = [
        {
            "Name": "Jake Lowe",
            "Phone-1": "(386) 555-0142",
            "Phone-1-Type": "Wireless",
            "Phone-1-Provider": "Verizon",
            "Phone-2": "3865550142",  # dup of Phone-1 after normalization
            "Email-1": "OWNER@Example.net",
            "Email-2": "owner@example.net",  # dup after lowering
        }
    ]
    phones, emails = parse_skiptrace_items(items)
    assert phones == ["(386) 555-0142"]
    assert emails == ["owner@example.net"]


def test_parse_tolerates_nested_and_junk():
    items = [
        {
            "Phone-3": {"number": "3865550100", "type": "Landline"},
            "Phone-4": "1785551234",  # invalid NANP — dropped
            "Email-2": {"address": "real@example.net"},
            "Email-3": "not-an-email",
        },
        "garbage-item",
    ]
    phones, emails = parse_skiptrace_items(items)
    assert phones == ["(386) 555-0100"]
    assert emails == ["real@example.net"]


def test_run_actor_exception_is_ok_false():
    client = _client()
    client.run_actor.side_effect = RuntimeError("boom")
    result = apify_skip_trace(_lead(), client=client)
    assert result["ok"] is False
    assert "boom" in result["error"]


def test_success_result_shape():
    client = _client()
    client.run_actor.return_value = [
        {"Phone-1": "3865550142", "Email-1": "owner@example.net"}
    ]
    result = apify_skip_trace(_lead(), client=client)
    assert result == {
        "ok": True,
        "provider": "apify_skiptrace",
        "phones": ["(386) 555-0142"],
        "emails": ["owner@example.net"],
        "found": 1,
    }
    actor_id, run_input = client.run_actor.call_args[0]
    assert actor_id == "one-api/skip-trace"
    assert run_input["max_results"] == 1
