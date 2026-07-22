"""Apify one-api/skip-trace — near-free residential owner skip trace.

Searches people-record sites (TruePeopleSearch, FastPeopleSearch,
BeenVerified) by property address and returns owner phones/emails.
Billed $7 per 1,000 FOUND results (~$0.007/hit, misses free); the free
Apify plan's $5/month credit covers roughly 700 found owners.

Runs BEFORE BatchData for residential leads; BatchData stays as the
paid fallback. Actor input format: "Street; City, ST ZIP".
"""

from __future__ import annotations

import re
from typing import Any

from leadagent.enrich.apify_client import ApifyClient
from leadagent.enrich.batchdata import _walk_contacts, street_line
from leadagent.enrich.contact_finder import (
    is_plausible_email,
    normalize_phone,
)
from leadagent.models import Lead

DEFAULT_ACTOR_ID = "one-api/skip-trace"

_PHONE_KEY = re.compile(r"(?i)phone[-_ ]?\d*")
_EMAIL_KEY = re.compile(r"(?i)email[-_ ]?\d*")


def build_skiptrace_input(lead: Lead, *, max_results: int = 1) -> dict[str, Any] | None:
    """Actor input from the lead's site address, or None when unusable."""
    address = (lead.address or "").strip()
    street = street_line(address)
    if not street:
        return None

    zip_code = (lead.zip or "").strip()
    if not zip_code:
        m = re.search(r"\b(\d{5})(?:-\d{4})?\b", address)
        if m:
            zip_code = m.group(1)

    city = (lead.city or "").strip()
    if not city:
        parts = [p.strip() for p in address.split(",")]
        if len(parts) >= 2 and parts[1]:
            city = parts[1]

    state = "FL"
    m = re.search(r",\s*([A-Za-z]{2})\s+\d{5}", address)
    if m:
        state = m.group(1).upper()

    if not city and not zip_code:
        return None

    locality = " ".join(x for x in (f"{city}," if city else "", state, zip_code) if x)
    return {
        "street_citystatezip": [f"{street}; {locality}"],
        "max_results": max_results,
    }


def _collect_values(node: Any, out: list[str], depth: int = 0) -> None:
    if node is None or depth > 4:
        return
    if isinstance(node, (str, int)):
        out.append(str(node))
    elif isinstance(node, list):
        for x in node:
            _collect_values(x, out, depth + 1)
    elif isinstance(node, dict):
        for v in node.values():
            _collect_values(v, out, depth + 1)


def parse_skiptrace_items(items: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    """Extract validated (phones, emails) from actor dataset items.

    Matches "Phone-1"/"Email-2"-style keys exactly — metadata columns like
    "Phone-1-Type"/"Phone-1-Provider" do not fullmatch and are ignored.
    """
    phones: list[str] = []
    emails: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        for key, value in item.items():
            k = str(key)
            values: list[str] = []
            if _PHONE_KEY.fullmatch(k):
                _collect_values(value, values)
                for v in values:
                    n = normalize_phone(v)
                    if n:
                        phones.append(n)
                        break
            elif _EMAIL_KEY.fullmatch(k):
                _collect_values(value, values)
                for v in values:
                    e = v.strip().lower()
                    if is_plausible_email(e):
                        emails.append(e)
                        break

    if not phones and not emails:
        # Column naming drifted — fall back to a deep key walk
        # (_walk_contacts validates via normalize_phone / is_plausible_email)
        _walk_contacts(items, phones, emails)

    seen_p: set[str] = set()
    uniq_phones: list[str] = []
    for p in phones:
        digits = re.sub(r"\D", "", p)
        if digits not in seen_p:
            seen_p.add(digits)
            uniq_phones.append(p)
    return uniq_phones, list(dict.fromkeys(emails))


def apify_skip_trace(
    lead: Lead,
    *,
    client: ApifyClient,
    actor_id: str = DEFAULT_ACTOR_ID,
    max_results: int = 1,
    timeout_secs: int = 90,
) -> dict[str, Any] | None:
    """Skip-trace a property owner via Apify. Returns None in dry-run.

    Result: {ok, provider, phones, emails, found} or {ok: False, error}.
    """
    if client.dry_run or not actor_id:
        return None

    run_input = build_skiptrace_input(lead, max_results=max_results)
    if run_input is None:
        return {"ok": False, "provider": "apify_skiptrace", "error": "no_address"}

    try:
        items = client.run_actor(actor_id, run_input, timeout_secs=timeout_secs)
    except Exception as exc:
        return {"ok": False, "provider": "apify_skiptrace", "error": str(exc)}

    phones, emails = parse_skiptrace_items(items or [])
    return {
        "ok": True,
        "provider": "apify_skiptrace",
        "phones": phones,
        "emails": emails,
        "found": len(items or []),
    }
