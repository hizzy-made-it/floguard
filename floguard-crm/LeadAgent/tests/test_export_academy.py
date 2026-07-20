import json
from pathlib import Path

from leadagent.db import Database
from leadagent.enrich.drainage_score import apply_score_note, score_lead
from leadagent.export_academy import export_academy_leads, lead_to_academy
from leadagent.models import Lead

# Retired HD Connex / Academy product lines — must never surface again.
RETIRED_LABELS = {"Website", "DnD", "MedRev", "Academy", "Duck", "Sponsor"}


def _lead(**kw) -> Lead:
    base = dict(name="Nguyen Residence", city="Port Orange", lead_type="french_drain")
    base.update(kw)
    return Lead(**base)


def test_lead_to_academy_maps_labels_and_contact():
    lead = _lead(
        name="Coastal Property Management",
        city="Daytona Beach",
        industry="Property Management",
        lead_type="property_mgmt",
        contact_name="Denise Alvarez",
        source="List_Property_Mgmt",
    )
    # B2B portfolio account that also buys seasonal service
    lead.set_categories(["property_mgmt", "maintenance"])
    row = lead_to_academy(lead)
    # internal keys → CRM display labels, primary first
    assert row["list"] == "PropertyMgmt"
    assert set(row["lists"]) == {"PropertyMgmt", "Maintenance"}
    assert row["lists"][0] == "PropertyMgmt"
    # contact_name maps to the CRM's `contact`
    assert row["contact"] == "Denise Alvarez"
    # internal metadata rides along for round-trip
    assert row["lead_type"] == "property_mgmt"
    assert row["categories"] == ["property_mgmt", "maintenance"]
    assert row["status"] == "New"
    assert row["city"] == "Daytona Beach"
    assert not RETIRED_LABELS & set(row["lists"])


def test_lead_to_academy_dedupes_shared_labels():
    # Homeowner spanning two service lines; the primary type is also listed as
    # a category membership — its label must not be emitted twice.
    lead = _lead(lead_type="french_drain")
    lead.set_categories(["sump_pump", "french_drain", "french_drain"])
    row = lead_to_academy(lead)
    assert row["lists"].count("FrenchDrain") == 1
    assert row["lists"].count("SumpPump") == 1
    assert set(row["lists"]) == {"FrenchDrain", "SumpPump"}
    assert row["list"] == "FrenchDrain"
    # duplicate keys collapse in the round-trip metadata too
    assert row["categories"] == ["sump_pump", "french_drain"]


def test_lead_to_academy_unlabeled_category_is_dropped():
    # Keys with no CRM label (retired product lines, junk imports) never
    # become a list; the lead still lands on a valid FloGuard list.
    lead = _lead(lead_type="yard_drainage")
    lead.set_categories(["yard_drainage", "website", "sponsor"])
    row = lead_to_academy(lead)
    assert row["lists"] == ["YardDrainage"]
    assert not RETIRED_LABELS & set(row["lists"])


def test_lead_to_academy_unknown_type_falls_back():
    lead = _lead(lead_type="needs_classification", categories="[]")
    row = lead_to_academy(lead)
    # Falls back to the default FloGuard list, matching the CRM front-end's own
    # normalizeList() default — never the retired "Website" line.
    assert row["list"] == "FrenchDrain"
    assert row["lists"] == ["FrenchDrain"]


def test_lead_to_academy_exports_drainage_score_as_website_score():
    """The DNS line in notes hydrates the CRM's `website_score` field."""
    lead = _lead(
        name="Whitfield Residence",
        city="New Smyrna Beach",
        lead_type="sump_pump",
        notes=(
            "Standing water for days along the north side after every rain; "
            "crawlspace under the home smells musty. Wants it fixed ASAP."
        ),
    )
    result = score_lead(lead)
    apply_score_note(lead, result)
    assert lead.notes.startswith("DNS ")

    row = lead_to_academy(lead)
    # `website_score` is the deployed front-end / api key name — do not rename.
    score = row["website_score"]
    assert score["total"] == result["total"]
    assert score["grade"] == result["grade"]
    assert score["band"] == result["band"]
    assert score["band"] in ("urgent", "priority", "monitor")
    assert score["gaps"] == result["gaps"][:3]


def test_lead_to_academy_without_score_note_omits_website_score():
    lead = _lead(notes="Addr: 1420 Dunlawton Ave · Left a voicemail Tuesday.")
    assert "website_score" not in lead_to_academy(lead)


def test_export_academy_leads_writes_document(tmp_path: Path):
    db = Database(tmp_path / "exp.db")
    a = _lead(name="Nguyen Residence", city="Port Orange")
    a.set_categories(["french_drain", "sump_pump"])
    db.upsert_lead(a)
    b = _lead(
        name="Coastal Property Management",
        city="Daytona Beach",
        industry="Property Management",
        lead_type="property_mgmt",
    )
    db.upsert_lead(b)

    out = tmp_path / "academy_leads.json"
    doc = export_academy_leads(db, out)
    assert out.exists()
    on_disk = json.loads(out.read_text(encoding="utf-8"))
    assert on_disk["version"] == 1
    assert on_disk["exported_at"]
    assert len(on_disk["leads"]) == 2
    assert {L["name"] for L in on_disk["leads"]} == {
        "Nguyen Residence",
        "Coastal Property Management",
    }
    assert doc["leads"][0]["lists"]
    for row in on_disk["leads"]:
        assert not RETIRED_LABELS & set(row["lists"])


def test_export_filter_by_type(tmp_path: Path):
    db = Database(tmp_path / "filt.db")
    sump = _lead(
        name="Brantley Residence",
        city="Ormond Beach",
        lead_type="sump_pump",
        notes="Musty crawlspace after storms.",
    )
    db.upsert_lead(sump)
    db.upsert_lead(_lead(name="Nguyen Residence", city="Port Orange"))
    # Multi-category lead: matches the filter through its categories array
    both = _lead(name="Delgado Residence", city="Edgewater", lead_type="yard_drainage")
    both.set_categories(["yard_drainage", "sump_pump"])
    db.upsert_lead(both)

    out = tmp_path / "sump.json"
    doc = export_academy_leads(db, out, lead_type="sump_pump")
    assert {L["name"] for L in doc["leads"]} == {
        "Brantley Residence",
        "Delgado Residence",
    }
    rows = {L["name"]: L for L in doc["leads"]}
    assert rows["Brantley Residence"]["list"] == "SumpPump"
    # Primary list stays the lead's own type; the filter matched a membership
    assert rows["Delgado Residence"]["list"] == "YardDrainage"
    assert "SumpPump" in rows["Delgado Residence"]["lists"]
