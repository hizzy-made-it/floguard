import pytest

from leadagent.draft.email_writer import write_outreach
from leadagent.models import GoalCard, Lead, ResearchBrief
from leadagent.settings import Settings

BANNED_OPENERS = [
    "i hope you're well",
    "i came across",
    "i was impressed",
    "i wanted to reach out",
    "my name is",
]

# Claims that would be illegal, uninsurable, or unbacked for a drainage
# contractor. None may ever appear in generated copy.
FORBIDDEN_PHRASES = [
    "flood proof",
    "floodproof",
    "flood-proof",
    "storm surge",
    "guarantee",
    "guaranteed",
    "insurance will",
    "covered by insurance",
    "mold remediation",
    "we remediate mold",
]

# Product lines that no longer exist in this CRM.
RETIRED_TERMS = [
    "dine in daytona",
    "medrev",
    "sales academy",
    "spin-to-win",
    "sponsorship",
    "website package",
    "duck race",
]

GOALS = {
    "french_drain": "Book the free on-site assessment for a French drain + sump candidate",
    "sump_pump": "Book the free assessment for a crawlspace / interior water candidate",
    "yard_drainage": "Book the free assessment for a yard / hardscape drainage fix",
    "maintenance": "Book a seasonal storm-readiness service visit",
    "property_mgmt": "Open a B2B relationship with a free pilot assessment",
    "client": "Expand an existing relationship",
    "partnership": "Create a mutual-upside referral relationship",
}

ALL_TYPES = list(GOALS)


def _goal(lt: str = "french_drain") -> GoalCard:
    return GoalCard(
        lead_type=lt,
        goal=GOALS[lt],
        primary_cta="morning or afternoon better for a free walk-through?",
        pricing_anchor=(
            "Complete systems typically $4,500-$12,000 — quoted only after the "
            "free on-site assessment"
        ),
        value_hooks=["standing water compounds toward the foundation"],
        email_length=[50, 120],
    )


def _blob(pkg) -> str:
    return " ".join(
        [pkg.primary_email, pkg.alternate_email, pkg.follow_up, *pkg.subjects]
    ).lower()


@pytest.mark.parametrize("lead_type", ALL_TYPES)
def test_every_type_produces_a_full_package(lead_type):
    settings = Settings(openai_api_key="")
    lead = Lead(name="Test Property", city="Port Orange", lead_type=lead_type)
    pkg = write_outreach(settings, lead, _goal(lead_type), force_template=True)

    assert len(pkg.subjects) == 3
    assert pkg.primary_email
    assert pkg.alternate_email
    assert pkg.follow_up
    assert pkg.angle_note
    low = pkg.primary_email.lower()
    for banned in BANNED_OPENERS:
        assert not low.startswith(banned), f"banned opener: {banned}"


@pytest.mark.parametrize("lead_type", ALL_TYPES)
def test_no_forbidden_claims_in_any_template(lead_type):
    settings = Settings(openai_api_key="")
    lead = Lead(name="Test Property", city="Daytona Beach", lead_type=lead_type)
    pkg = write_outreach(settings, lead, _goal(lead_type), force_template=True)
    blob = _blob(pkg)
    for phrase in FORBIDDEN_PHRASES:
        assert phrase not in blob, f"{lead_type} template contains forbidden claim: {phrase}"


@pytest.mark.parametrize("lead_type", ALL_TYPES)
def test_no_retired_product_lines_in_any_template(lead_type):
    settings = Settings(openai_api_key="")
    lead = Lead(name="Test Property", city="Ormond Beach", lead_type=lead_type)
    pkg = write_outreach(settings, lead, _goal(lead_type), force_template=True)
    blob = _blob(pkg)
    for term in RETIRED_TERMS:
        assert term not in blob, f"{lead_type} template still references {term}"


@pytest.mark.parametrize("lead_type", ALL_TYPES)
def test_templates_never_quote_a_firm_price(lead_type):
    """
    A dollar figure may appear only alongside the assessment caveat.
    The deterministic templates should not lead with price at all.
    """
    settings = Settings(openai_api_key="")
    lead = Lead(name="Test Property", city="DeLand", lead_type=lead_type)
    pkg = write_outreach(settings, lead, _goal(lead_type), force_template=True)
    blob = _blob(pkg)
    if "$" in blob:
        assert "assessment" in blob, f"{lead_type} states a price with no assessment caveat"


def test_no_buzzwords_in_template():
    settings = Settings(openai_api_key="")
    lead = Lead(name="Test Property", city="Daytona", lead_type="french_drain")
    pkg = write_outreach(settings, lead, _goal("french_drain"), force_template=True)
    blob = _blob(pkg)
    for word in ("synergy", "revolutionize", "game-changer", "unlock your"):
        assert word not in blob


def test_french_drain_template_opens_on_reported_signals():
    """DNS gaps are the prospect's own words — the strongest available opener."""
    settings = Settings(openai_api_key="")
    lead = Lead(
        name="Nguyen Residence",
        city="Ormond Beach",
        lead_type="french_drain",
        notes="Backyard holds water for days; water reaching the foundation",
    )
    brief = ResearchBrief(
        business_name=lead.name,
        drainage_score={
            "total": 72,
            "grade": "B",
            "band": "urgent",
            "gaps": ["standing water for days", "water around the foundation"],
            "talk_track": "Offer a free assessment slot within 24-48 hours.",
        },
    )
    pkg = write_outreach(settings, lead, _goal("french_drain"), brief, force_template=True)
    low = pkg.primary_email.lower()
    assert "standing water for days" in low
    assert "foundation" in low
    assert "urgent" in pkg.angle_note.lower() or "signals" in pkg.angle_note.lower()


def test_score_is_never_presented_as_an_inspection_finding():
    """
    DNS is sales urgency, not a diagnosis. The raw number must not surface in
    customer-facing copy.
    """
    settings = Settings(openai_api_key="")
    lead = Lead(name="Miller Residence", city="Port Orange", lead_type="french_drain")
    brief = ResearchBrief(
        business_name=lead.name,
        drainage_score={
            "total": 88,
            "grade": "A",
            "band": "urgent",
            "gaps": ["water never fully dries"],
            "talk_track": "Dial first.",
        },
    )
    pkg = write_outreach(settings, lead, _goal("french_drain"), brief, force_template=True)
    blob = _blob(pkg)
    assert "88" not in blob
    assert "/100" not in blob
    assert "score" not in blob


def test_template_survives_missing_drainage_score():
    settings = Settings(openai_api_key="")
    lead = Lead(name="Alvarez Residence", city="Edgewater", lead_type="french_drain")
    brief = ResearchBrief(business_name=lead.name)  # drainage_score is None
    pkg = write_outreach(settings, lead, _goal("french_drain"), brief, force_template=True)
    assert pkg.primary_email
    assert len(pkg.subjects) == 3


def test_sump_pump_template_mentions_crawlspace_water():
    settings = Settings(openai_api_key="")
    lead = Lead(name="Miller Residence", city="Port Orange", lead_type="sump_pump")
    pkg = write_outreach(settings, lead, _goal("sump_pump"), force_template=True)
    blob = _blob(pkg)
    assert "crawlspace" in blob or "under the house" in blob or "musty" in blob


def test_property_mgmt_template_offers_forwardable_scope():
    settings = Settings(openai_api_key="")
    lead = Lead(
        name="Coastal Property Management",
        city="Daytona Beach",
        industry="Property Management",
        lead_type="property_mgmt",
    )
    pkg = write_outreach(settings, lead, _goal("property_mgmt"), force_template=True)
    blob = _blob(pkg)
    assert "scope" in blob and "owner" in blob
    assert "free" in blob


@pytest.mark.parametrize("lead_type", ALL_TYPES)
def test_every_template_closes_on_a_visit_not_a_contract(lead_type):
    settings = Settings(openai_api_key="")
    lead = Lead(name="Test Property", city="Deltona", lead_type=lead_type)
    pkg = write_outreach(settings, lead, _goal(lead_type), force_template=True)
    blob = _blob(pkg)
    assert "contract" not in blob, f"{lead_type} template pushes a contract"
    if lead_type not in ("partnership", "client"):
        assert any(
            w in blob for w in ("assessment", "walk-through", "walk", "visit", "slot", "look")
        ), f"{lead_type} template has no appointment close"
