"""BatchData Property Skip Trace (optional paid).

Residential tax-roll leads are private homes — Maps/site crawlers find
nothing. BatchData resolves owner phone/email from property address +
owner name. Mirrors server/lib/contact-enrich.js in the CRM.

Docs: https://developer.batchdata.com — set BATCHDATA_API_KEY in .env.
A 403 with a valid token means the key product lacks Property Skip Trace
API access (enable it in the BatchData dashboard).
"""

from __future__ import annotations

import re
from typing import Any

import httpx

from leadagent.enrich.contact_finder import (
    is_plausible_email,
    normalize_phone,
)
from leadagent.models import Lead

SKIP_TRACE_PATH = "/api/v1/property/skip-trace"


def street_line(address: str) -> str:
    """'123 Palm Ave, Port Orange, FL 32127' → '123 Palm Ave'."""
    a = (address or "").strip()
    if not a:
        return ""
    return a.split(",")[0].strip()


def parse_owner_name(name: str) -> tuple[str, str]:
    """Split tax-roll owner strings into (first, last).

    Handles 'SMITH, JOHN', 'SMITH JOHN A' (appraiser LAST FIRST MIDDLE),
    and plain 'John Smith'.
    """
    raw = (name or "").strip()
    if not raw:
        return "", ""
    if "," in raw:
        last, _, rest = raw.partition(",")
        parts = rest.split()
        return (parts[0] if parts else ""), last.strip()
    parts = raw.split()
    if len(parts) == 1:
        return "", parts[0]
    if parts[0] == parts[0].upper() and len(parts[0]) > 1:
        # LAST FIRST MIDDLE (common appraiser format)
        return parts[1], parts[0]
    return parts[0], parts[-1]


def _walk_contacts(node: Any, phones: list[str], emails: list[str], depth: int = 0) -> None:
    """Response shapes vary by plan — walk common phone/email paths."""
    if node is None or depth > 8:
        return
    if isinstance(node, list):
        for x in node:
            _walk_contacts(x, phones, emails, depth + 1)
        return
    if not isinstance(node, dict):
        return
    for k, v in node.items():
        kl = str(k).lower()
        if ("phone" in kl or kl in ("mobile", "telephone")) and isinstance(v, (str, int)):
            n = normalize_phone(str(v))
            if n:
                phones.append(n)
        elif "email" in kl and isinstance(v, str):
            e = v.strip().lower()
            if is_plausible_email(e):
                emails.append(e)
        else:
            _walk_contacts(v, phones, emails, depth + 1)


def batchdata_skip_trace(
    lead: Lead,
    *,
    api_key: str,
    api_url: str = "https://api.batchdata.com",
    timeout: float = 20.0,
) -> dict[str, Any] | None:
    """Skip-trace a property owner. Returns None when no key configured.

    Result: {ok, provider, phones, emails} or {ok: False, error, status}.
    """
    key = (api_key or "").strip()
    if not key:
        return None

    address = (lead.address or "").strip()
    if not address:
        return {"ok": False, "provider": "batchdata", "error": "no_address"}

    zip_code = (lead.zip or "").strip()
    if not zip_code:
        m = re.search(r"\b(\d{5})(?:-\d{4})?\b", address)
        if m:
            zip_code = m.group(1)
    first, last = parse_owner_name(lead.owner or lead.name)

    prop: dict[str, Any] = {"street": street_line(address), "state": "FL"}
    if lead.city:
        prop["city"] = lead.city.strip()
    if zip_code:
        prop["zip"] = zip_code
    request: dict[str, Any] = {"propertyAddress": prop}
    if first or last:
        person: dict[str, str] = {}
        if first:
            person["firstName"] = first
        if last:
            person["lastName"] = last
        request["persons"] = [person]

    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(
                api_url.rstrip("/") + SKIP_TRACE_PATH,
                json={"requests": [request]},
                headers={
                    "Authorization": f"Bearer {key}",
                    "Accept": "application/json",
                },
            )
    except Exception as exc:
        return {"ok": False, "provider": "batchdata", "error": str(exc)}

    try:
        data = r.json()
    except Exception:
        data = None

    if r.status_code >= 400:
        msg = ""
        if isinstance(data, dict):
            status = data.get("status") or {}
            msg = str(
                data.get("message")
                or data.get("error")
                or (status.get("message") if isinstance(status, dict) else "")
                or (status.get("text") if isinstance(status, dict) else "")
                or ""
            )
        if not msg:
            msg = f"HTTP {r.status_code}"
        if r.status_code == 403:
            if "balance" in msg.lower():
                msg += " (add funds in the BatchData dashboard)"
            else:
                msg += (
                    " (token OK but no Property Skip Trace API permission — "
                    "enable Skip Trace API in BatchData dashboard)"
                )
        return {
            "ok": False,
            "provider": "batchdata",
            "error": msg,
            "status": r.status_code,
        }

    phones: list[str] = []
    emails: list[str] = []
    _walk_contacts(data, phones, emails)

    # De-dup preserving order
    seen_p: set[str] = set()
    uniq_phones: list[str] = []
    for p in phones:
        digits = re.sub(r"\D", "", p)
        if digits not in seen_p:
            seen_p.add(digits)
            uniq_phones.append(p)
    uniq_emails = list(dict.fromkeys(emails))

    return {
        "ok": True,
        "provider": "batchdata",
        "phones": uniq_phones,
        "emails": uniq_emails,
    }
