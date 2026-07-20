from __future__ import annotations

from typing import Any

from leadagent.channels.brave_cdp import connect_playwright
from leadagent.models import Lead, OutreachPackage
from leadagent.settings import Settings


def open_search_and_prepare_dm(
    settings: Settings,
    lead: Lead,
    package: OutreachPackage,
    *,
    dry_run: bool = True,
) -> dict[str, Any]:
    """
    Open LinkedIn search for the lead. Does NOT send.
    Fills nothing unless dry_run is False — and even then only pastes draft
    into an open message box if one is already focused (v1 is intentionally cautious).
    """
    message = package.primary_email
    # LinkedIn DMs should be shorter
    if len(message) > 600:
        message = message[:580].rsplit(" ", 1)[0] + "…"

    result: dict[str, Any] = {
        "lead": lead.name,
        "message_preview": message,
        "sent": False,
        "action": "none",
    }

    if dry_run:
        result["action"] = "dry_run_only"
        result["hint"] = "Pass dry_run=False only when Brave CDP is up and you want the tab opened."
        return result

    p, browser = connect_playwright(settings)
    try:
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        page = context.pages[0] if context.pages else context.new_page()
        q = f"{lead.name} {lead.city}".strip()
        page.goto(
            f"https://www.linkedin.com/search/results/all/?keywords={q.replace(' ', '%20')}",
            wait_until="domcontentloaded",
        )
        result["action"] = "opened_search"
        result["url"] = page.url
        result["draft_for_paste"] = message
        result["hint"] = (
            "Review search results, open the right profile, paste draft_for_paste. "
            "Do not auto-send."
        )
    finally:
        # Leave browser open — do not close user's Brave
        p.stop()

    return result
