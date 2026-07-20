from __future__ import annotations

import json
from pathlib import Path

from leadagent.classify import classify_lead
from leadagent.db import Database
from leadagent.draft.email_writer import format_package_for_display, write_outreach
from leadagent.enrich.research import enrich_lead
from leadagent.models import Draft, DraftStatus, Lead, OutreachPackage
from leadagent.settings import Settings


def run_outbound_for_lead(
    settings: Settings,
    db: Database,
    lead: Lead,
    *,
    skip_research: bool = False,
    force_template: bool = False,
    export: bool = True,
    category: str | None = None,
) -> tuple[Draft, OutreachPackage, str]:
    """
    Draft outreach for a lead. If category is set, force that product angle
    (multi-category prospects can get one package per category).
    """
    original_type = lead.lead_type
    if category:
        lead.lead_type = category.strip().lower()

    goal = classify_lead(lead, settings.playbooks_path)
    if goal.lead_type == "needs_classification":
        lead.lead_type = original_type
        raise ValueError(
            f"Lead {lead.id} needs classification before drafting. "
            f"Set lead_type or --category "
            f"(french_drain|sump_pump|yard_drainage|maintenance|property_mgmt|client|partnership)."
        )

    # Persist categories membership; restore primary type unless category forced as primary
    if lead.id:
        if category:
            cats = lead.category_list()
            if goal.lead_type not in cats:
                cats.append(goal.lead_type)
            lead.set_categories(cats)
            # Keep original primary type on the record when drafting a secondary angle
            lead.lead_type = original_type or goal.lead_type
        db.upsert_lead(lead)

    brief = None
    research_ids: list[int] = []
    if not skip_research:
        brief = enrich_lead(settings, db, lead)
        for r in db.latest_research(lead.id or 0)[:1]:
            if r.id:
                research_ids.append(r.id)

    # Writer uses goal.lead_type for angle
    pkg = write_outreach(settings, lead, goal, brief, force_template=force_template)
    subject = pkg.subjects[0] if pkg.subjects else f"{lead.name}"
    draft = Draft(
        lead_id=lead.id or 0,
        channel="email",
        direction="outbound",
        subject=subject,
        body=pkg.primary_email,
        subjects_alt=json.dumps(pkg.subjects),
        body_alt=pkg.alternate_email,
        follow_up=pkg.follow_up,
        angle_note=f"[{goal.lead_type}] {pkg.angle_note}",
        research_ids=json.dumps(research_ids),
        status=DraftStatus.PENDING_APPROVAL.value,
    )
    draft = db.add_draft(draft)
    db.log_activity(
        "draft_created",
        lead.id,
        {
            "draft_id": draft.id,
            "lead_type": goal.lead_type,
            "category": category or goal.lead_type,
            "subject": subject,
        },
    )

    if lead.id and lead.status in ("", "New"):
        lead.status = "Draft ready"
        db.upsert_lead(lead)

    display = format_package_for_display(pkg, lead)
    export_path = ""
    if export:
        export_path = str(_export_draft(settings, draft, lead, display))

    return draft, pkg, export_path


def run_outbound_all_categories(
    settings: Settings,
    db: Database,
    lead: Lead,
    *,
    force_template: bool = False,
    skip_research: bool = False,
) -> list[tuple[Draft, OutreachPackage, str]]:
    """One draft package per category membership on the lead."""
    cats = lead.category_list() or [lead.lead_type]
    out: list[tuple[Draft, OutreachPackage, str]] = []
    for i, cat in enumerate(cats):
        # Research once (first category only) to save API calls
        draft, pkg, path = run_outbound_for_lead(
            settings,
            db,
            lead,
            category=cat,
            force_template=force_template,
            skip_research=skip_research or i > 0,
        )
        out.append((draft, pkg, path))
    return out


def _export_draft(settings: Settings, draft: Draft, lead: Lead, display: str) -> Path:
    out_dir = settings.exports_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"draft_{draft.id}_{lead.id}.txt"
    path.write_text(
        f"To: {lead.email or '(add email)'}\n"
        f"Subject: {draft.subject}\n"
        f"Status: {draft.status}\n"
        f"Lead: {lead.name} | type={lead.lead_type}\n"
        f"{'=' * 60}\n\n"
        f"{display}\n",
        encoding="utf-8",
    )
    return path


def run_outbound_batch(
    settings: Settings,
    db: Database,
    *,
    lead_type: str | None = None,
    city: str | None = None,
    limit: int = 5,
    force_template: bool = False,
    all_categories: bool = False,
) -> list[Draft]:
    leads = db.list_leads(
        lead_type=lead_type, category=lead_type, city=city, limit=limit * 3
    )
    # Prefer New / empty status
    ranked = sorted(
        leads,
        key=lambda L: (0 if L.status in ("", "New", "Researching") else 1, -(L.id or 0)),
    )
    drafts: list[Draft] = []
    for lead in ranked:
        if len(drafts) >= limit:
            break
        try:
            if all_categories:
                for draft, _, _ in run_outbound_all_categories(
                    settings, db, lead, force_template=force_template
                ):
                    drafts.append(draft)
                    if len(drafts) >= limit:
                        break
            else:
                draft, _, _ = run_outbound_for_lead(
                    settings,
                    db,
                    lead,
                    force_template=force_template,
                    category=lead_type,
                )
                drafts.append(draft)
        except ValueError:
            continue
    return drafts
