from leadagent.classify import classify_lead, normalize_tracker_list
from leadagent.models import Lead
from leadagent.playbooks import get_goal_card, load_playbooks
from leadagent.settings import REPO_ROOT

PLAYBOOKS = REPO_ROOT / "config" / "playbooks.yaml"

# The only categories FloGuard sells. Any other label must fail closed.
FLOGUARD_TYPES = {
    "french_drain",
    "sump_pump",
    "yard_drainage",
    "maintenance",
    "property_mgmt",
    "client",
    "partnership",
}


def test_normalize_tracker_list():
    assert normalize_tracker_list("FrenchDrain") == "french_drain"
    assert normalize_tracker_list("Homeowners") == "french_drain"
    assert normalize_tracker_list("Sump Pump") == "sump_pump"
    assert normalize_tracker_list("YardDrainage") == "yard_drainage"
    assert normalize_tracker_list("Maintenance") == "maintenance"
    assert normalize_tracker_list("PropertyMgmt") == "property_mgmt"
    assert normalize_tracker_list("Partner") == "partnership"


def test_retired_product_lines_are_not_categories():
    """
    The FloGuard CRM carries flood-mitigation leads only. Labels inherited from
    the source product must never resolve to a live playbook.
    """
    data = load_playbooks(PLAYBOOKS)
    for dead in ("website", "sponsor", "dnd", "dnd_restaurant", "medrev", "academy", "duck"):
        assert dead not in data["types"], f"retired product line still in playbooks: {dead}"
        card = get_goal_card(dead, playbooks_path=PLAYBOOKS)
        assert card.lead_type == "needs_classification", (
            f"retired label {dead!r} resolved to {card.lead_type!r} instead of failing closed"
        )


def test_playbook_types_are_exactly_the_floguard_set():
    data = load_playbooks(PLAYBOOKS)
    assert set(data["types"]) == FLOGUARD_TYPES


def test_property_manager_is_commercial_lead():
    lead = Lead(
        name="Coastal Property Management",
        city="Daytona Beach",
        industry="Property Management",
        lead_type="",
    )
    goal = classify_lead(lead, PLAYBOOKS)
    assert goal.lead_type == "property_mgmt"
    assert "assessment" in goal.goal.lower() or "pilot" in goal.goal.lower()


def test_crawlspace_notes_route_to_sump_pump():
    lead = Lead(
        name="Miller Residence",
        city="Port Orange",
        notes="Crawlspace smells musty every time it rains",
        lead_type="",
    )
    goal = classify_lead(lead, PLAYBOOKS)
    assert goal.lead_type == "sump_pump"


def test_hardscape_notes_route_to_yard_drainage():
    lead = Lead(
        name="Alvarez Residence",
        city="New Smyrna Beach",
        notes="Water pools on the lanai and driveway after storms",
        lead_type="",
    )
    goal = classify_lead(lead, PLAYBOOKS)
    assert goal.lead_type == "yard_drainage"


def test_homeowner_defaults_to_french_drain():
    lead = Lead(
        name="Nguyen Residence",
        city="Ormond Beach",
        notes="Backyard holds water for days after heavy rain",
        lead_type="",
    )
    goal = classify_lead(lead, PLAYBOOKS)
    assert goal.lead_type == "french_drain"


def test_installed_system_is_client():
    lead = Lead(
        name="Example Residence",
        city="DeLand",
        status="System installed",
        lead_type="french_drain",
    )
    goal = classify_lead(lead, PLAYBOOKS)
    assert goal.lead_type == "client"


def test_explicit_type_wins_over_industry_when_set():
    lead = Lead(
        name="Beachside Realty",
        city="Daytona",
        industry="Property Management",
        lead_type="partnership",
    )
    goal = classify_lead(lead, PLAYBOOKS)
    assert goal.lead_type == "partnership"


def test_brand_is_floguard():
    data = load_playbooks(PLAYBOOKS)
    brand = data["brand"]
    assert "floguard" in brand["company"].lower()
    assert "floguardfl.com" in brand["website"].lower()
    assert "floguardfl.com" in brand["email"].lower()


def test_every_type_closes_on_a_booked_visit():
    """The close is always a booked appointment — never a contract or a price."""
    data = load_playbooks(PLAYBOOKS)
    for key in data["types"]:
        card = get_goal_card(key, playbooks_path=PLAYBOOKS)
        assert card.primary_cta, f"{key} has no CTA"
        close = card.close_step.lower()
        assert "booked" in close or "reply" in close or "chat" in close, (
            f"{key} close_step is not an appointment/conversation: {card.close_step!r}"
        )


def test_no_firm_price_promised_outside_the_assessment():
    """
    The only number reps may say is the band, and only with the
    assessment caveat. Guard the playbook copy against a bare quote.
    """
    data = load_playbooks(PLAYBOOKS)
    forbidden = " ".join(data["forbidden_claims"]).lower()
    assert "firm system prices" in forbidden
    for key, pb in data["types"].items():
        anchor = str(pb.get("pricing_anchor") or "").lower()
        if "$" in anchor:
            assert "assessment" in anchor, (
                f"{key} pricing_anchor states a price without the assessment caveat"
            )
