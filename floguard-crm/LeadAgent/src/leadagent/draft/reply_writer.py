from __future__ import annotations

from leadagent.draft.email_writer import write_outreach
from leadagent.models import GoalCard, Lead, OutreachPackage, ResearchBrief
from leadagent.settings import Settings


def write_reply(
    settings: Settings,
    lead: Lead,
    goal: GoalCard,
    inbound_body: str,
    brief: ResearchBrief | None = None,
    force_template: bool = False,
) -> OutreachPackage:
    return write_outreach(
        settings,
        lead,
        goal,
        brief,
        direction="reply",
        inbound_body=inbound_body,
        force_template=force_template,
    )
