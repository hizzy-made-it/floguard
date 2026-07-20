from __future__ import annotations

from pathlib import Path

from leadagent.models import GoalCard, Lead
from leadagent.playbooks import get_goal_card, load_playbooks, resolve_type_key

# Industries that strongly signal a property-management / B2B lead
PROPERTY_MGMT_INDUSTRIES = {
    "property management",
    "property mgmt",
    "property manager",
    "rental portfolio",
    "rentals",
    "hoa",
    "real estate",
}

CLIENT_STATUSES = {
    "assessment done",
    "system installed",
    "contract signed",
    "active client",
    "client",
}

# issue-note keywords → homeowner service line (first hit wins)
_SUMP_KEYWORDS = ("crawlspace", "crawl space", "sump", "musty")
_YARD_KEYWORDS = ("lanai", "patio", "driveway", "grading")
_MAINT_KEYWORDS = ("maintenance", "service", "inspect")


def normalize_tracker_list(list_value: str) -> str:
    """Map CRM list labels to internal lead_type keys."""
    v = (list_value or "").strip().lower()
    mapping = {
        "frenchdrain": "french_drain",
        "french drain": "french_drain",
        "french_drain": "french_drain",
        "homeowner": "french_drain",
        "homeowners": "french_drain",
        "sumppump": "sump_pump",
        "sump pump": "sump_pump",
        "sump_pump": "sump_pump",
        "yarddrainage": "yard_drainage",
        "yard drainage": "yard_drainage",
        "yard_drainage": "yard_drainage",
        "maintenance": "maintenance",
        "propertymgmt": "property_mgmt",
        "property mgmt": "property_mgmt",
        "property_mgmt": "property_mgmt",
        "client": "client",
        "partner": "partnership",
        "partnership": "partnership",
    }
    return mapping.get(v, v or "needs_classification")


def _homeowner_type_from_notes(notes: str) -> str:
    low = (notes or "").lower()
    if any(k in low for k in _SUMP_KEYWORDS):
        return "sump_pump"
    if any(k in low for k in _YARD_KEYWORDS):
        return "yard_drainage"
    if any(k in low for k in _MAINT_KEYWORDS):
        return "maintenance"
    return "french_drain"


def classify_lead(lead: Lead, playbooks_path: Path | None = None) -> GoalCard:
    """
    Prefer explicit lead_type; apply light heuristics when empty or generic.
    Never invent a service line — unknown types return needs_classification.
    """
    data = load_playbooks(playbooks_path) if playbooks_path else None
    explicit = (lead.lead_type or "").strip().lower()
    industry = (lead.industry or "").strip().lower()
    status = (lead.status or "").strip().lower()
    notes = (lead.notes or "").lower()

    # Client status wins when present
    if status in CLIENT_STATUSES or "existing client" in notes or "upsell" in notes:
        lead.lead_type = "client"
        return get_goal_card("client", lead.custom_type, playbooks_path, data)

    # Explicit non-empty type (except needs_classification)
    if explicit and explicit not in ("", "needs_classification", "new"):
        key = resolve_type_key(explicit, lead.custom_type, data or load_playbooks(playbooks_path))  # type: ignore
        if key != "needs_classification":
            lead.lead_type = key if not key.startswith("custom:") else "custom"
            if key.startswith("custom:"):
                lead.custom_type = key.split(":", 1)[1]
            return get_goal_card(lead.lead_type, lead.custom_type, playbooks_path, data)

    # B2B industry heuristics
    if industry in PROPERTY_MGMT_INDUSTRIES or any(
        s in industry for s in PROPERTY_MGMT_INDUSTRIES
    ):
        lead.lead_type = "property_mgmt"
        return get_goal_card("property_mgmt", lead.custom_type, playbooks_path, data)

    # Partnership keywords
    if "partner" in notes or "affiliate" in notes or "collab" in notes:
        lead.lead_type = "partnership"
        return get_goal_card("partnership", lead.custom_type, playbooks_path, data)

    # Homeowner: pick the service line from the issue notes
    lead.lead_type = _homeowner_type_from_notes(notes)
    return get_goal_card(lead.lead_type, lead.custom_type, playbooks_path, data)
