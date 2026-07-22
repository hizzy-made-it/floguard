from pathlib import Path

from leadagent.db import Database
from leadagent.import_lists import import_all_lists
from leadagent.pipeline.outbound import run_outbound_all_categories, run_outbound_for_lead
from leadagent.settings import Settings

# Retired HD Connex / Academy funnels — must never appear on a FloGuard lead.
RETIRED_CATEGORIES = {
    "website",
    "sponsor",
    "dnd_restaurant",
    "dnd",
    "medrev",
    "academy",
    "duck",
}

_HEADER = "name,address,city,phone,email,property_type,issue_notes,source\n"

# Two intake rows for the Nguyen address (door-knock, then the web quiz) —
# same name+city, different service lines, so they merge into one lead.
_HOMEOWNERS_CSV = _HEADER + (
    "EXAMPLE Homeowner,123 Example St,Port Orange,,,Single-family home,"
    "template row - do not import,\n"
    ",,Deltona,386-555-0000,,Single-family home,blank name row,\n"
    "Nguyen Residence,1420 Dunlawton Ave,Port Orange,386-555-0142,"
    "nguyen@example.com,Single-family home,"
    "Standing water in the backyard for days after every rain,door-knock\n"
    "Nguyen Residence,1420 Dunlawton Ave,Port Orange,,,Single-family home,"
    "Crawlspace under the addition smells musty - asking about a sump pump,quiz\n"
    "Brantley Residence,88 Ocean Shore Blvd,Ormond Beach,386-555-0188,,"
    "Single-family home,Lanai floods and the pavers are sinking,referral\n"
    "Whitfield Residence,7 Canal St,New Smyrna Beach,,whitfield@example.com,"
    "Single-family home,"
    "Existing system from another contractor - wants an annual inspect before storm season,\n"
    "Delgado Residence,405 Riverside Dr,Edgewater,386-555-0405,,Single-family home,"
    "Front yard holds water for two days after a heavy rain,door-knock\n"
)

_PROPERTY_MGMT_CSV = _HEADER + (
    "EXAMPLE Property Manager,1 Example Blvd,Daytona Beach,,,Property Management,"
    "template row - do not import,\n"
    "Coastal Property Management,250 N Beach St,Daytona Beach,386-555-0250,"
    "ops@example.com,Property Management,"
    "Repeat tenant complaints about standing water at two rentals,\n"
    "Halifax Rentals Group,15 W Indiana Ave,DeLand,386-555-0015,,Rental portfolio,"
    "Wet season flooding at the DeLand duplexes,partner-referral\n"
)


def _lists_dir(tmp_path: Path) -> Path:
    d = tmp_path / "Lead Tools"
    d.mkdir()
    (d / "List_Homeowners.csv").write_text(_HOMEOWNERS_CSV, encoding="utf-8")
    (d / "List_Property_Mgmt.csv").write_text(_PROPERTY_MGMT_CSV, encoding="utf-8")
    return d


def _settings(tmp_path: Path, db_path: Path) -> Settings:
    return Settings(
        openai_api_key="",
        apify_dry_run=True,
        enrich_free_discovery=False,  # no network in unit tests
        leadagent_db=db_path,
        leadagent_config_dir=Path(__file__).resolve().parents[1] / "config",
    )


def _by_name(db: Database, needle: str):
    return next((L for L in db.list_leads(limit=500) if needle in (L.name or "")), None)


def test_import_lists_multi_category(tmp_path: Path):
    db_path = tmp_path / "lists.db"
    db = Database(db_path)
    lists_dir = _lists_dir(tmp_path)

    result = import_all_lists(db, lists_dir, which="ALL")

    assert result["lists_dir"] == str(lists_dir)
    homeowners = result["lists"]["HOMEOWNERS"]
    prop_mgmt = result["lists"]["PROPERTY_MGMT"]
    assert "error" not in homeowners
    assert "error" not in prop_mgmt
    # EXAMPLE template row + the blank-name row are skipped, never synthesized
    assert homeowners["skipped"] == 2
    assert homeowners["added"] == 4
    assert homeowners["updated"] == 1  # second Nguyen row merges
    assert prop_mgmt["skipped"] == 1
    assert prop_mgmt["added"] == 2
    assert result["total_leads"] == 6

    fake = [
        L
        for L in db.list_leads(limit=500)
        if "prospect —" in (L.name or "") or "prospect -" in (L.name or "")
    ]
    assert fake == []

    # One address on two service lines merges into a single multi-category lead
    nguyen = _by_name(db, "Nguyen Residence")
    assert nguyen is not None
    cats = nguyen.category_list()
    assert "french_drain" in cats
    assert "sump_pump" in cats
    assert nguyen.lead_type == "french_drain"  # primary type kept on merge
    assert "Standing water in the backyard" in nguyen.notes
    assert "musty" in nguyen.notes
    assert nguyen.address == "1420 Dunlawton Ave"
    assert nguyen.phone == "386-555-0142"  # richer field from the first row wins
    assert "door-knock" in nguyen.source and "quiz" in nguyen.source

    # issue_notes keyword overrides pick the service line
    assert _by_name(db, "Brantley Residence").category_list() == ["yard_drainage"]
    assert _by_name(db, "Whitfield Residence").category_list() == ["maintenance"]
    assert _by_name(db, "Delgado Residence").category_list() == ["french_drain"]

    # Property-management rows are always the B2B lane
    coastal = _by_name(db, "Coastal Property Management")
    assert coastal is not None
    assert coastal.lead_type == "property_mgmt"
    assert coastal.category_list() == ["property_mgmt"]
    assert coastal.city == "Daytona Beach"
    assert coastal.industry == "Property Management"
    assert coastal.source == "List_Property_Mgmt"  # default when the column is blank
    assert _by_name(db, "Halifax Rentals Group").category_list() == ["property_mgmt"]

    # No lead anywhere carries a retired HD Connex funnel
    all_cats = {c for L in db.list_leads(limit=500) for c in L.category_list()}
    assert not RETIRED_CATEGORIES & all_cats
    assert not RETIRED_CATEGORIES & {L.lead_type for L in db.list_leads(limit=500)}


def test_import_selects_a_single_list(tmp_path: Path):
    db = Database(tmp_path / "one.db")
    result = import_all_lists(db, _lists_dir(tmp_path), which="property_mgmt")
    assert "HOMEOWNERS" not in result["lists"]
    assert result["lists"]["PROPERTY_MGMT"]["added"] == 2
    assert result["total_leads"] == 2


def test_draft_per_category(tmp_path: Path):
    db_path = tmp_path / "draft.db"
    settings = _settings(tmp_path, db_path)
    db = Database(db_path)
    import_all_lists(db, _lists_dir(tmp_path), which="HOMEOWNERS")

    nguyen = _by_name(db, "Nguyen Residence")
    assert set(nguyen.category_list()) == {"french_drain", "sump_pump"}

    draft_fd, pkg_fd, _ = run_outbound_for_lead(
        settings, db, nguyen, force_template=True, skip_research=True,
        category="french_drain",
    )
    assert draft_fd.body
    assert pkg_fd.lead_type == "french_drain"
    assert "french drain" in pkg_fd.primary_email.lower()

    draft_sp, pkg_sp, _ = run_outbound_for_lead(
        settings, db, nguyen, force_template=True, skip_research=True,
        category="sump_pump",
    )
    assert draft_sp.body
    assert pkg_sp.lead_type == "sump_pump"
    assert "crawlspace" in pkg_sp.primary_email.lower()
    # Different service line → genuinely different angle, not a re-send
    assert pkg_sp.primary_email != pkg_fd.primary_email

    # Drafting a secondary angle must not steal the primary type
    reloaded = db.get_lead(nguyen.id)
    assert reloaded.lead_type == "french_drain"

    # One package per category membership for a multi-category lead
    results = run_outbound_all_categories(
        settings, db, reloaded, force_template=True, skip_research=True
    )
    types = {pkg.lead_type for _, pkg, _ in results}
    assert types == {"french_drain", "sump_pump"}
    assert not RETIRED_CATEGORIES & types
