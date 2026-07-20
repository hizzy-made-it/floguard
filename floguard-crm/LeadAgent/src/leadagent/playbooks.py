from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from leadagent.models import GoalCard


class PlaybookError(ValueError):
    pass


def load_playbooks(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise PlaybookError(f"Playbooks file not found: {path}")
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if "types" not in data:
        raise PlaybookError("playbooks.yaml missing 'types'")
    return data


def resolve_type_key(lead_type: str, custom_type: str, data: dict[str, Any]) -> str:
    lt = (lead_type or "").strip().lower()
    ct = (custom_type or "").strip().lower()

    # CRM list labels → playbook keys. FloGuard sells one thing (flood
    # mitigation), split by service line; there are no other product lines.
    aliases = {
        "frenchdrain": "french_drain",
        "french drain": "french_drain",
        "french_drain": "french_drain",
        "homeowner": "french_drain",
        "homeowners": "french_drain",
        "sumppump": "sump_pump",
        "sump pump": "sump_pump",
        "sump_pump": "sump_pump",
        "crawlspace": "sump_pump",
        "yarddrainage": "yard_drainage",
        "yard drainage": "yard_drainage",
        "yard_drainage": "yard_drainage",
        "maintenance": "maintenance",
        "propertymgmt": "property_mgmt",
        "property mgmt": "property_mgmt",
        "property_mgmt": "property_mgmt",
        "commercial": "property_mgmt",
        "client": "client",
        "partner": "partnership",
        "partnership": "partnership",
        "custom": "custom",
        "needs_classification": "needs_classification",
    }
    key = aliases.get(lt, lt)

    if key == "custom" or (key not in data.get("types", {}) and ct):
        custom_types = data.get("custom_types") or {}
        if ct and ct in custom_types:
            return f"custom:{ct}"
        if key == "custom":
            return "needs_classification"

    if key in data.get("types", {}):
        return key

    if key.startswith("custom:"):
        name = key.split(":", 1)[1]
        if name in (data.get("custom_types") or {}):
            return key

    return "needs_classification"


def get_goal_card(
    lead_type: str,
    custom_type: str = "",
    playbooks_path: Path | None = None,
    data: dict[str, Any] | None = None,
) -> GoalCard:
    data = data or load_playbooks(playbooks_path)  # type: ignore[arg-type]
    key = resolve_type_key(lead_type, custom_type, data)
    brand = data.get("brand") or {}
    forbidden = data.get("forbidden_claims") or []

    if key == "needs_classification":
        return GoalCard(
            lead_type="needs_classification",
            goal="Classify this lead before drafting outreach",
            primary_cta="",
            forbidden_claims=forbidden,
            brand=brand,
        )

    if key.startswith("custom:"):
        name = key.split(":", 1)[1]
        pb = (data.get("custom_types") or {})[name]
        type_label = f"custom:{name}"
    else:
        pb = data["types"][key]
        type_label = key

    return GoalCard(
        lead_type=type_label,
        goal=pb.get("goal", ""),
        primary_cta=pb.get("primary_cta", ""),
        value_hooks=list(pb.get("value_hooks") or []),
        objections=list(pb.get("objections") or []),
        pricing_anchor=pb.get("pricing_anchor", ""),
        close_step=pb.get("close_step", ""),
        email_length=list(pb.get("email_length") or [50, 120]),
        channel_priority=list(pb.get("channel_priority") or ["email"]),
        forbidden_claims=forbidden,
        brand=brand,
    )
