"""Forward website leads to the CRM, which saves them, builds the lead's public page
(floguardfl.com/p/<token>) and, when sending is switched on there, emails the auto-reply.

Env:
  LEAD_FORWARD_SECRET   shared secret, same value as on the CRM (Vercel). Unset = forwarding off.
  CRM_LEAD_FORWARD_URL  default https://crm.floguardfl.com/crm/api/leads
"""
import logging
import os

import requests

logger = logging.getLogger(__name__)

DEFAULT_URL = "https://crm.floguardfl.com/crm/api/leads"
# Sources that are real drainage requests. "guide" is a PDF download; "honeypot" is a bot.
PAGE_SOURCES = {"contact", "landing", "website", "quiz", "assessment"}

FIELDS = (
    "name", "email", "phone", "address", "location", "property_type", "issues", "water_location",
    "water_duration", "frequency", "affected_size", "existing_drainage", "damages", "timeline",
    "photos", "message", "source",
)


def forwarding_enabled() -> bool:
    return len(os.environ.get("LEAD_FORWARD_SECRET", "").strip()) >= 24


def wants_page(lead: dict) -> bool:
    src = (lead.get("source") or "contact").lower()
    return src in PAGE_SOURCES or src not in {"guide", "honeypot"} and bool(lead.get("address"))


def build_payload(lead: dict, *, send: bool, preview: bool = False, persist: bool = True) -> dict:
    body = {k: lead.get(k) for k in FIELDS if lead.get(k) not in (None, "", [])}
    return {
        "action": "lead_forward",
        "source_id": f"mongo:{lead.get('id')}",
        "lead": body,
        "send": bool(send),
        "preview": bool(preview),
        "persist": bool(persist),
    }


def forward_lead(lead: dict, *, send: bool, preview: bool = False, persist: bool = True,
                 timeout: float = 55.0, post=requests.post):
    """Blocking. Returns the CRM's JSON ({url, version, reasons, sent, ...}) or None."""
    if not forwarding_enabled():
        return None
    url = os.environ.get("CRM_LEAD_FORWARD_URL", "").strip() or DEFAULT_URL
    try:
        r = post(
            url,
            json=build_payload(lead, send=send, preview=preview, persist=persist),
            headers={"X-Lead-Forward-Secret": os.environ["LEAD_FORWARD_SECRET"].strip()},
            timeout=timeout,
        )
        if r.status_code != 200:
            logger.error("LEAD_FORWARD_FAILED lead_id=%s status=%s", lead.get("id"), r.status_code)
            return None
        return r.json()
    except Exception as e:  # network, timeout, bad JSON
        logger.error("LEAD_FORWARD_FAILED lead_id=%s error=%s", lead.get("id"), str(e)[:200])
        return None
