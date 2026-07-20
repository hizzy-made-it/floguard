from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class LeadType(str, Enum):
    FRENCH_DRAIN = "french_drain"
    SUMP_PUMP = "sump_pump"
    YARD_DRAINAGE = "yard_drainage"
    MAINTENANCE = "maintenance"
    PROPERTY_MGMT = "property_mgmt"
    CLIENT = "client"
    PARTNERSHIP = "partnership"
    CUSTOM = "custom"
    NEEDS_CLASSIFICATION = "needs_classification"


# CRM UI list labels ↔ internal lead_type keys
CATEGORY_LABELS: dict[str, str] = {
    "french_drain": "FrenchDrain",
    "sump_pump": "SumpPump",
    "yard_drainage": "YardDrainage",
    "maintenance": "Maintenance",
    "property_mgmt": "PropertyMgmt",
    "client": "Client",
    "partnership": "Partner",
}

LABEL_TO_TYPE: dict[str, str] = {
    "frenchdrain": "french_drain",
    "french drain": "french_drain",
    "french_drain": "french_drain",
    "homeowners": "french_drain",
    "homeowner": "french_drain",
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


class DraftStatus(str, Enum):
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    SENT = "sent"
    REJECTED = "rejected"
    REVISED = "revised"


class DraftChannel(str, Enum):
    EMAIL = "email"
    LINKEDIN = "linkedin"
    OTHER = "other"


class DraftDirection(str, Enum):
    OUTBOUND = "outbound"
    REPLY = "reply"
    FOLLOW_UP = "follow_up"


class Lead(BaseModel):
    id: int | None = None
    name: str
    city: str = ""
    industry: str = ""
    lead_type: str = "french_drain"
    # JSON array of category keys
    # (french_drain|sump_pump|yard_drainage|maintenance|property_mgmt|client|partnership|…)
    # Enables multi-category prospects used across several funnels.
    categories: str = "[]"
    phone: str = ""
    website: str = ""
    email: str = ""
    contact_name: str = ""
    status: str = "New"
    notes: str = ""
    source: str = ""
    custom_type: str = ""
    created_at: str = ""
    updated_at: str = ""

    def category_list(self) -> list[str]:
        import json

        try:
            raw = json.loads(self.categories or "[]")
            if isinstance(raw, list):
                out: list[str] = []
                for x in raw:
                    k = str(x).strip().lower()
                    if k and k not in out:
                        out.append(k)
                return out
        except Exception:
            pass
        return [self.lead_type] if self.lead_type else []

    def set_categories(self, cats: list[str]) -> None:
        import json

        cleaned: list[str] = []
        for c in cats:
            k = str(c).strip().lower()
            if k and k not in cleaned:
                cleaned.append(k)
        if not cleaned and self.lead_type:
            cleaned = [self.lead_type]
        self.categories = json.dumps(cleaned)
        if cleaned and (not self.lead_type or self.lead_type == "needs_classification"):
            self.lead_type = cleaned[0]


class Research(BaseModel):
    id: int | None = None
    lead_id: int
    source: str
    payload_json: str = "{}"
    summary: str = ""
    scraped_at: str = ""


class Draft(BaseModel):
    id: int | None = None
    lead_id: int
    channel: str = DraftChannel.EMAIL.value
    direction: str = DraftDirection.OUTBOUND.value
    subject: str = ""
    body: str = ""
    subjects_alt: str = "[]"  # JSON list of alt subject lines
    body_alt: str = ""
    follow_up: str = ""
    angle_note: str = ""
    research_ids: str = "[]"
    status: str = DraftStatus.PENDING_APPROVAL.value
    external_id: str = ""
    created_at: str = ""


class Approval(BaseModel):
    id: int | None = None
    draft_id: int
    decision: str
    decided_at: str = ""
    note: str = ""


class GoalCard(BaseModel):
    lead_type: str
    goal: str
    primary_cta: str
    value_hooks: list[str] = Field(default_factory=list)
    objections: list[str] = Field(default_factory=list)
    pricing_anchor: str = ""
    close_step: str = ""
    email_length: list[int] = Field(default_factory=lambda: [50, 120])
    channel_priority: list[str] = Field(default_factory=lambda: ["email"])
    forbidden_claims: list[str] = Field(default_factory=list)
    brand: dict[str, Any] = Field(default_factory=dict)


class ResearchBrief(BaseModel):
    business_name: str = ""
    category: str = ""
    phone: str = ""
    address: str = ""
    website_present: bool = False
    website_notes: str = ""
    rating: str = ""
    review_themes: list[str] = Field(default_factory=list)
    hook_candidates: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    emails_found: list[str] = Field(default_factory=list)
    # Drainage Need Score result: {total, grade, band, gaps, talk_track}
    # (see enrich/drainage_score.py and Sales Docs/DRAINAGE-NEED-SCORE.md)
    drainage_score: dict[str, Any] | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class OutreachPackage(BaseModel):
    """Full elite-SDR output format."""

    subjects: list[str] = Field(default_factory=list)
    primary_email: str = ""
    alternate_email: str = ""
    follow_up: str = ""
    angle_note: str = ""
    lead_type: str = ""
    goal: str = ""
