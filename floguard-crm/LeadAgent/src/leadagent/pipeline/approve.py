from __future__ import annotations

from leadagent.db import Database
from leadagent.models import Draft, DraftStatus
from leadagent.settings import Settings


class ApprovalError(ValueError):
    pass


def approve_draft(
    settings: Settings,
    db: Database,
    draft_id: int,
    *,
    send: bool = False,
    confirm_yes: bool = False,
    note: str = "",
) -> Draft:
    draft = db.get_draft(draft_id)
    if not draft:
        raise ApprovalError(f"Draft {draft_id} not found")
    if draft.status not in (
        DraftStatus.PENDING_APPROVAL.value,
        DraftStatus.APPROVED.value,
        DraftStatus.REVISED.value,
    ):
        raise ApprovalError(f"Draft {draft_id} has status {draft.status}; cannot approve")

    db.add_approval(draft_id, "approved", note=note)
    db.update_draft_status(draft_id, DraftStatus.APPROVED.value)
    db.log_activity("approve", draft.lead_id, {"draft_id": draft_id, "note": note})

    if send:
        return mark_sent(settings, db, draft_id, confirm_yes=confirm_yes)

    updated = db.get_draft(draft_id)
    assert updated
    return updated


def reject_draft(db: Database, draft_id: int, note: str = "") -> Draft:
    draft = db.get_draft(draft_id)
    if not draft:
        raise ApprovalError(f"Draft {draft_id} not found")
    db.add_approval(draft_id, "rejected", note=note)
    db.update_draft_status(draft_id, DraftStatus.REJECTED.value)
    db.log_activity("reject", draft.lead_id, {"draft_id": draft_id, "note": note})
    updated = db.get_draft(draft_id)
    assert updated
    return updated


def mark_sent(
    settings: Settings,
    db: Database,
    draft_id: int,
    *,
    confirm_yes: bool = False,
    external_id: str = "",
) -> Draft:
    """
    Mark draft as sent. Does NOT call Outlook itself — operator or agent
    uses Outlook MCP send_draft after creating a draft there.
    Requires typed confirmation when settings.require_send_confirmation.
    """
    draft = db.get_draft(draft_id)
    if not draft:
        raise ApprovalError(f"Draft {draft_id} not found")

    if settings.require_send_confirmation and not confirm_yes:
        raise ApprovalError(
            "Send blocked: pass confirm_yes=True after operator types YES. "
            "Never auto-send."
        )

    sent_today = db.count_sends_today()
    if sent_today >= settings.daily_send_cap:
        raise ApprovalError(
            f"Daily send cap reached ({settings.daily_send_cap}). Aborting."
        )

    db.add_approval(draft_id, "sent", note=external_id or "")
    db.update_draft_status(draft_id, DraftStatus.SENT.value, external_id=external_id)
    db.log_activity(
        "send",
        draft.lead_id,
        {"draft_id": draft_id, "external_id": external_id},
    )

    lead = db.get_lead(draft.lead_id)
    if lead:
        lead.status = "Sent"
        db.upsert_lead(lead)

    updated = db.get_draft(draft_id)
    assert updated
    return updated
