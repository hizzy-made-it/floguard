from pathlib import Path

from leadagent.db import Database
from leadagent.import_leads import import_bootstrap
from leadagent.pipeline.approve import approve_draft, mark_sent, ApprovalError
from leadagent.pipeline.outbound import run_outbound_for_lead
from leadagent.settings import Settings
import pytest


@pytest.fixture
def env(tmp_path: Path):
    db_path = tmp_path / "test.db"
    settings = Settings(
        openai_api_key="",
        apify_dry_run=True,
        enrich_free_discovery=False,  # no network in unit tests
        leadagent_db=db_path,
        leadagent_config_dir=Path(__file__).resolve().parents[1] / "config",
        require_send_confirmation=True,
        daily_send_cap=25,
    )
    db = Database(db_path)
    import_bootstrap(db)
    return settings, db


def test_outbound_creates_pending_draft(env):
    settings, db = env
    leads = db.list_leads()
    homeowner = next(L for L in leads if L.lead_type == "french_drain")
    draft, pkg, path = run_outbound_for_lead(
        settings, db, homeowner, force_template=True
    )
    assert draft.status == "pending_approval"
    assert draft.body
    assert len(pkg.subjects) >= 1
    assert Path(path).exists()


def test_send_requires_yes(env):
    settings, db = env
    lead = db.list_leads()[0]
    draft, _, _ = run_outbound_for_lead(settings, db, lead, force_template=True)
    approve_draft(settings, db, draft.id, send=False)
    with pytest.raises(ApprovalError):
        mark_sent(settings, db, draft.id, confirm_yes=False)
    sent = mark_sent(settings, db, draft.id, confirm_yes=True)
    assert sent.status == "sent"
