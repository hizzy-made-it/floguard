from __future__ import annotations

import json

from leadagent.classify import classify_lead
from leadagent.db import Database
from leadagent.draft.reply_writer import write_reply
from leadagent.enrich.research import enrich_lead
from leadagent.models import Draft, DraftStatus, Lead
from leadagent.settings import Settings


def draft_reply_for_lead(
    settings: Settings,
    db: Database,
    lead: Lead,
    inbound_body: str,
    *,
    force_template: bool = False,
) -> Draft:
    goal = classify_lead(lead, settings.playbooks_path)
    brief = enrich_lead(settings, db, lead) if lead.id else None
    pkg = write_reply(
        settings, lead, goal, inbound_body, brief, force_template=force_template
    )
    subject = pkg.subjects[0] if pkg.subjects else f"Re: {lead.name}"
    draft = Draft(
        lead_id=lead.id or 0,
        channel="email",
        direction="reply",
        subject=subject,
        body=pkg.primary_email,
        subjects_alt=json.dumps(pkg.subjects),
        body_alt=pkg.alternate_email,
        follow_up=pkg.follow_up,
        angle_note=pkg.angle_note,
        status=DraftStatus.PENDING_APPROVAL.value,
    )
    draft = db.add_draft(draft)
    db.log_activity(
        "reply_draft",
        lead.id,
        {"draft_id": draft.id, "inbound_preview": inbound_body[:200]},
    )
    return draft
