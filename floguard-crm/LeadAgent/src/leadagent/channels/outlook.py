"""
Outlook integration notes for hybrid operation.

LeadAgent intentionally does NOT embed Microsoft Graph tokens.
Email draft/send in the hybrid model:

1. CLI creates draft text in SQLite + data/exports/draft_*.txt
2. Operator (or coding agent with Outlook MCP) calls:
   - outlook_create_draft(to, subject, body)
   - after human YES: outlook_send_draft(message_id)
3. CLI records send: leadagent drafts mark-sent <id> --yes --external-id <message_id>

Helper to format for MCP copy-paste.
"""

from __future__ import annotations

from leadagent.models import Draft, Lead


def mcp_create_draft_args(draft: Draft, lead: Lead) -> dict:
    to = [lead.email] if lead.email else []
    return {
        "to": to,
        "subject": draft.subject,
        "body": draft.body,
        "tool": "outlook__create_draft",
        "note": "Create draft only. Do not send until operator approves.",
    }


def mcp_send_draft_args(message_id: str) -> dict:
    return {
        "message_id": message_id,
        "tool": "outlook__send_draft",
        "warning": "IRREVERSIBLE. Only after typed YES.",
    }
