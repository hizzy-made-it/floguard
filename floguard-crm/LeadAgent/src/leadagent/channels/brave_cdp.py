from __future__ import annotations

from typing import Any

import httpx

from leadagent.settings import Settings


def cdp_version(settings: Settings) -> dict[str, Any] | None:
    """Return Brave/Chrome /json/version if remote debugging is up."""
    base = settings.brave_cdp_url.rstrip("/")
    try:
        with httpx.Client(timeout=3.0) as client:
            r = client.get(f"{base}/json/version")
            r.raise_for_status()
            return r.json()
    except Exception:
        return None


def browser_doctor(settings: Settings) -> dict[str, Any]:
    info = cdp_version(settings)
    return {
        "cdp_url": settings.brave_cdp_url,
        "reachable": info is not None,
        "browser": (info or {}).get("Browser"),
        "webSocketDebuggerUrl": (info or {}).get("webSocketDebuggerUrl"),
        "user_data_dir": settings.brave_user_data_dir or "(not set — use scripts/start_brave_debug.ps1)",
        "hint": (
            "Start Brave with remote debugging, then re-run doctor."
            if info is None
            else "CDP OK. Log into LinkedIn in this profile before drafting DMs."
        ),
    }


def connect_playwright(settings: Settings):
    """
    Connect Playwright over CDP. Caller must have playwright installed
    and Brave running with --remote-debugging-port.
    """
    from playwright.sync_api import sync_playwright

    info = cdp_version(settings)
    if not info or not info.get("webSocketDebuggerUrl"):
        raise RuntimeError(
            f"Brave CDP not reachable at {settings.brave_cdp_url}. "
            "Run scripts/start_brave_debug.ps1 first."
        )
    p = sync_playwright().start()
    browser = p.chromium.connect_over_cdp(settings.brave_cdp_url)
    return p, browser
