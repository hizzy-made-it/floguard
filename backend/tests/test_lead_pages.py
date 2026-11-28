"""Unit tests for the CRM forwarder (no server, no network)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import lead_pages  # noqa: E402

LEAD = {"id": "abc", "name": "Dana Johnson", "email": "d@example.com", "phone": "", "address": "5508 N Lancewood Cir",
        "location": "Port Orange", "issues": ["Standing water"], "photos": [], "source": "landing", "status": "new",
        "email_error": "x"}


class Resp:
    def __init__(self, code, data):
        self.status_code, self._data = code, data

    def json(self):
        return self._data


def test_off_without_secret(monkeypatch):
    monkeypatch.delenv("LEAD_FORWARD_SECRET", raising=False)
    assert lead_pages.forward_lead(LEAD, send=True, post=lambda *a, **k: 1 / 0) is None


def test_payload_and_headers(monkeypatch):
    monkeypatch.setenv("LEAD_FORWARD_SECRET", "s" * 32)
    seen = {}

    def post(url, json, headers, timeout):
        seen.update(url=url, json=json, headers=headers)
        return Resp(200, {"url": "https://floguardfl.com/p/x", "version": "full", "sent": "disabled"})

    out = lead_pages.forward_lead(LEAD, send=False, post=post)
    assert out["version"] == "full"
    assert seen["url"] == lead_pages.DEFAULT_URL
    assert seen["headers"]["X-Lead-Forward-Secret"] == "s" * 32
    body = seen["json"]
    assert body["action"] == "lead_forward" and body["source_id"] == "mongo:abc" and body["send"] is False
    # Empty fields and internal fields are not sent.
    assert "phone" not in body["lead"] and "photos" not in body["lead"]
    assert "status" not in body["lead"] and "email_error" not in body["lead"]


def test_failures_return_none(monkeypatch):
    monkeypatch.setenv("LEAD_FORWARD_SECRET", "s" * 32)
    assert lead_pages.forward_lead(LEAD, send=True, post=lambda *a, **k: Resp(500, {})) is None

    def boom(*a, **k):
        raise TimeoutError("slow")

    assert lead_pages.forward_lead(LEAD, send=True, post=boom) is None


def test_which_sources_get_pages():
    assert lead_pages.wants_page({"source": "landing"})
    assert lead_pages.wants_page({"source": "contact"})
    assert not lead_pages.wants_page({"source": "guide", "address": "1 A St"})
    assert not lead_pages.wants_page({"source": "honeypot"})
