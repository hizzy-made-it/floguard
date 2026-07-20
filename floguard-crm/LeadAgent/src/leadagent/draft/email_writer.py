from __future__ import annotations

import json
import re
from typing import Any

import httpx

from leadagent.draft.prompts import (
    ELITE_OUTREACH_SYSTEM,
    FLOGUARD_CONSTRAINTS,
    build_user_prompt,
)
from leadagent.models import GoalCard, Lead, OutreachPackage, ResearchBrief
from leadagent.settings import Settings


def _word_count(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text or ""))


def _dns(brief: ResearchBrief | None) -> dict[str, Any]:
    """Drainage Need Score dict off the brief (empty dict when absent)."""
    if brief and isinstance(brief.drainage_score, dict):
        return brief.drainage_score
    return {}


def _dns_opener(dns: dict[str, Any], name: str) -> str:
    """
    Open on the prospect's own reported signals, never on the score itself.
    DNS is sales urgency, not an inspection finding.
    """
    gaps = list(dns.get("gaps") or [])
    if not gaps:
        return ""
    if len(gaps) >= 2:
        detail = f"{gaps[0]} and {gaps[1]}"
    else:
        detail = gaps[0]
    return (
        f"You mentioned {detail} at {name} — in Florida soil that pattern "
        f"almost never fixes itself."
    )


def _template_package(lead: Lead, goal: GoalCard, brief: ResearchBrief | None) -> OutreachPackage:
    """Deterministic fallback when no LLM key — still follows elite structure."""
    name = lead.name or "your property"
    city = lead.city or "your area"
    hooks = (brief.hook_candidates if brief else []) or []
    hook = hooks[0] if hooks else ""
    dns = _dns(brief)
    dns_open = _dns_opener(dns, name)
    lt = goal.lead_type

    if lt == "sump_pump":
        subjects = [
            f"under the house at {name}",
            "musty after rain?",
            f"crawlspace check — {city}",
        ]
        opener = dns_open or (
            f"A musty crawlspace after a heavy rain at {name} is a water signal, "
            f"not a smell problem."
        )
        primary = (
            f"{opener}\n\n"
            f"Water that sits under a house doesn't announce itself — it shows up later as "
            f"the smell, then the floors, then the framing. A sealed basin and float-switch "
            f"pump handle it, but only after someone looks at where the water is actually coming from.\n\n"
            f"The on-site assessment is free and it's the only honest way to tell whether "
            f"it's a pump problem or a drainage problem.\n\n"
            f"{goal.primary_cta.capitalize() if goal.primary_cta else 'Worth a free look under the house before storm season?'}"
        )
        alternate = (
            f"If {name} already has a pump, the question isn't whether it runs — it's whether "
            f"it runs when the power is out. The storm that cuts power is the same storm "
            f"pushing groundwater up.\n\n"
            f"I can walk the crawlspace and the discharge line for free and tell you plainly "
            f"what's holding and what isn't.\n\n"
            f"Want me to grab a slot this week?"
        )
        follow = (
            f"Following up on {name} — no pressure. If the crawlspace still smells musty "
            f"after the next rain, that's the moment worth a free look. Want a day and time?"
        )
        angle = "Crawlspace / interior water signal → free assessment (pump vs drainage)."
    elif lt == "yard_drainage":
        subjects = [
            f"standing water at {name}",
            f"{city} yard that won't drain",
            "patio holding water?",
        ]
        opener = dns_open or (
            f"Water pooling on a lanai, patio, or driveway at {name} rarely stays there."
        )
        primary = (
            f"{opener}\n\n"
            f"Most of these turn out to be a slope and discharge problem, not a full-system "
            f"problem — catch basins, a channel drain, a swale, or tying the downspouts "
            f"somewhere useful. Lower entry ticket than a full French drain.\n\n"
            f"The walk-through is free; I'd map where the water actually goes before anyone "
            f"talks scope or price.\n\n"
            f"{goal.primary_cta.capitalize() if goal.primary_cta else 'Want a free 30-minute walk-through of where the water goes?'}"
        )
        alternate = (
            f"The 'it drains eventually' yards are the ones that cost the most later — dead "
            f"grass and washouts first, sinking pavers after.\n\n"
            f"For {name}, a free walk-through tells you whether this is a small grading fix "
            f"or something bigger. No quote by phone either way.\n\n"
            f"Morning or afternoon better?"
        )
        follow = (
            f"Different angle for {name}: you don't need a full system to stop water sitting "
            f"on the hardscape. The free walk-through sorts which one it is. Useful?"
        )
        angle = "Hardscape / yard pooling → lower-ticket drainage fix, free walk-through."
    elif lt == "maintenance":
        subjects = [
            f"storm-readiness for {name}",
            "pump check before the season",
            f"{name} — system still good?",
        ]
        primary = (
            f"Pumps fail silently. The first storm of the season is a bad time to find out "
            f"the one at {name} has been coasting.\n\n"
            f"A storm-readiness visit is the full check — pump test, basin, discharge line, "
            f"battery. We service inherited systems too, not just our own installs.\n\n"
            f"{goal.primary_cta.capitalize() if goal.primary_cta else 'Want me to grab you a storm-readiness slot before the season?'}"
        )
        alternate = (
            f"'It worked last year' is true right up until it isn't — and the failure always "
            f"lands during the storm, never before it.\n\n"
            f"I can get {name} on the schedule for a seasonal check. Which week works better?"
        )
        follow = (
            f"Quick nudge on {name}: the check takes one visit and tells you whether the "
            f"system is actually storm-ready. Want a day and time?"
        )
        angle = "Seasonal storm-readiness on an existing/inherited system."
    elif lt == "property_mgmt":
        subjects = [
            f"the worst property in your portfolio",
            f"tenant water calls — {city}",
            f"{name} — free pilot walk",
        ]
        primary = (
            f"Every wet season brings the same calls: musty smell, flooded yard, standing "
            f"water at move-out. Usually from the same two or three properties.\n\n"
            f"I'll walk the single worst one in your portfolio for free and hand you a written "
            f"scope you can forward straight to the owner. No commitment, and nothing for you "
            f"to sell internally until the owner sees it in writing.\n\n"
            f"{goal.primary_cta.capitalize() if goal.primary_cta else 'Which property gives you the most grief — worth a free walk this week?'}"
        )
        alternate = (
            f"A handyman can move water off a slab for a season. What a manager usually needs "
            f"is the written scope that makes an owner approve the real fix.\n\n"
            f"For {name}, that starts with one free pilot assessment on the property "
            f"generating the most calls.\n\n"
            f"Want to name that property and I'll take it from there?"
        )
        follow = (
            f"Still happy to do the free pilot walk for {name} — one property, written scope, "
            f"forwardable to the owner. Which address?"
        )
        angle = "Repeat tenant water calls → free pilot assessment + owner-forwardable scope."
    elif lt == "client":
        subjects = [
            f"seasonal check for {name}",
            "before the storms",
            f"{name} — quick follow-through",
        ]
        primary = (
            f"Since the system at {name} is already in, the easy wins are the ones nobody "
            f"scheduled — a seasonal storm-readiness check, or a backup conversation before "
            f"the season rather than during it.\n\n"
            f"There's usually also a neighbor with the exact same water problem who'd rather "
            f"hear it from you than from us.\n\n"
            f"{goal.primary_cta.capitalize() if goal.primary_cta else 'Want me to pencil in a seasonal check before the storms?'}"
        )
        alternate = (
            f"Two low-effort options for {name}: put the seasonal check on the calendar, or "
            f"point us at one neighbor dealing with the same standing water.\n\n"
            f"Either one is a short reply. Which is easier?"
        )
        follow = (
            f"Didn't want this buried — for {name} the seasonal check is the cheap insurance, "
            f"and it books in one message. Want a day and time?"
        )
        angle = "Existing client: seasonal check, backup conversation, or one warm referral."
    elif lt == "partnership":
        subjects = [
            f"mutual upside — {name}",
            "asset leverage idea",
            f"{name} + FloGuard",
        ]
        primary = (
            f"Drainage shows up inside other people's work — landscape, hardscape, foundation, "
            f"roofing, remediation. Usually as the thing nobody wants to own.\n\n"
            f"For {name} there's a clean referral path in both directions: we stay in our lane "
            f"(water in, water out) and nothing we do competes with what you sell.\n\n"
            f"{goal.primary_cta.capitalize() if goal.primary_cta else 'Open to mapping mutual upside in one short note?'}"
        )
        alternate = (
            f"Most partnership emails are vague. Mine isn't: one shared local audience, one "
            f"referral path, one way to check whether it's worth continuing.\n\n"
            f"For {name} I already see the candidate angle. Want it in three bullets?"
        )
        follow = (
            f"Still think there's a simple referral path between {name} and what we do. "
            f"If I send three bullets, worth a look?"
        )
        angle = "Adjacent-trade referral path; non-competing, low commitment."
    else:
        # french_drain default — lead with the reported water signals when present
        gaps = list(dns.get("gaps") or [])[:2]
        band = str(dns.get("band") or "")
        if dns_open:
            opener = dns_open
            angle = (
                f"Reported water signals ({'; '.join(gaps)}) → free assessment"
                if gaps
                else "Reported water signals → free assessment"
            )
            if band:
                angle += f"; DNS band {band}"
        elif hook:
            opener = hook.rstrip(".") + "."
            angle = "Standing water after storms → free on-site assessment."
        else:
            opener = (
                f"Standing water that lingers after a storm at {name} tends to work its "
                f"way toward the foundation, not away from it."
            )
            angle = "Standing water after storms → free on-site assessment."
        subjects = [
            f"standing water at {name}",
            f"{city} yard after the last storm",
            "where the water actually goes",
        ]
        urgency = (
            "Given what you described, I'd rather look sooner than later — "
            "that kind of water compounds with every storm.\n\n"
            if band == "urgent"
            else ""
        )
        primary = (
            f"{opener}\n\n"
            f"{urgency}"
            f"A proper French drain is engineered for the actual soil, slope, and water "
            f"table on the property — trench, clean gravel, perforated pipe, and a "
            f"discharge point that makes sense. Usually paired with a sump.\n\n"
            f"The part most people don't expect: the assessment that tells you what YOUR "
            f"yard needs is free, and nobody quotes a price until someone has walked it.\n\n"
            f"{goal.primary_cta.capitalize() if goal.primary_cta else 'Morning or afternoon better for a free 30-minute walk-through?'}"
        )
        alternate = (
            f"Most people try regrading or hauling in dirt first. It moves the water for a "
            f"season, then the same low spot comes back — because the water table didn't "
            f"change.\n\n"
            f"A free walk-through at {name} tells you which one you're actually dealing with. "
            f"No price talk by phone either way.\n\n"
            f"Want me to hold a slot this week?"
        )
        follow = (
            f"Different angle for {name}: the free assessment isn't a sales visit — it's the "
            f"only way to know whether this is a grading fix or a full system. Want a day "
            f"and time?"
        )

    return OutreachPackage(
        subjects=subjects,
        primary_email=primary.strip(),
        alternate_email=alternate.strip(),
        follow_up=follow.strip(),
        angle_note=angle,
        lead_type=lt,
        goal=goal.goal,
    )


def _parse_llm_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _llm_package(
    settings: Settings,
    lead: Lead,
    goal: GoalCard,
    brief: ResearchBrief | None,
    *,
    direction: str = "outbound",
    inbound_body: str = "",
) -> OutreachPackage | None:
    if not settings.openai_api_key:
        return None

    hooks = list(brief.hook_candidates) if brief else []
    research_summary = ""
    if brief:
        parts = [
            f"Website present: {brief.website_present}",
            f"Website notes: {brief.website_notes}" if brief.website_notes else "",
            f"Rating: {brief.rating}" if brief.rating else "",
            f"Review themes: {', '.join(brief.review_themes)}" if brief.review_themes else "",
            f"Risks: {', '.join(brief.risk_flags)}" if brief.risk_flags else "",
        ]
        if isinstance(brief.drainage_score, dict) and brief.drainage_score:
            ds = brief.drainage_score
            parts.append(
                f"Drainage Need Score: {ds.get('total', 0)}/100 "
                f"grade {ds.get('grade', 'F')} band {ds.get('band', 'monitor')} "
                f"(sales urgency only — NOT an inspection finding)"
            )
            if ds.get("gaps"):
                parts.append("Reported water signals: " + "; ".join(ds["gaps"][:4]))
            if ds.get("talk_track"):
                parts.append("Suggested talk track: " + str(ds["talk_track"]))
        research_summary = "; ".join(p for p in parts if p)

    user = build_user_prompt(
        lead_name=lead.name,
        city=lead.city,
        industry=lead.industry,
        lead_type=goal.lead_type,
        goal=goal.goal,
        primary_cta=goal.primary_cta,
        pricing_anchor=goal.pricing_anchor,
        value_hooks=goal.value_hooks,
        website=lead.website,
        phone=lead.phone,
        contact_name=lead.contact_name,
        notes=lead.notes,
        research_summary=research_summary,
        hooks=hooks,
        email_length=goal.email_length,
        direction=direction,
        inbound_body=inbound_body,
    )

    system = ELITE_OUTREACH_SYSTEM + "\n\n" + FLOGUARD_CONSTRAINTS
    payload = {
        "model": settings.openai_model,
        "temperature": 0.7,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }

    try:
        with httpx.Client(base_url=settings.openai_base_url, timeout=90.0) as client:
            r = client.post(
                "/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"]
            data = _parse_llm_json(content)
    except Exception:
        return None

    subjects = data.get("subjects") or []
    if isinstance(subjects, str):
        subjects = [subjects]
    return OutreachPackage(
        subjects=[str(s) for s in subjects][:3],
        primary_email=str(data.get("primary_email") or "").strip(),
        alternate_email=str(data.get("alternate_email") or "").strip(),
        follow_up=str(data.get("follow_up") or "").strip(),
        angle_note=str(data.get("angle_note") or "").strip(),
        lead_type=goal.lead_type,
        goal=goal.goal,
    )


def write_outreach(
    settings: Settings,
    lead: Lead,
    goal: GoalCard,
    brief: ResearchBrief | None = None,
    *,
    direction: str = "outbound",
    inbound_body: str = "",
    force_template: bool = False,
) -> OutreachPackage:
    if not force_template:
        pkg = _llm_package(
            settings, lead, goal, brief, direction=direction, inbound_body=inbound_body
        )
        if pkg and pkg.primary_email:
            while len(pkg.subjects) < 3:
                pkg.subjects.append(pkg.subjects[-1] if pkg.subjects else lead.name)
            return pkg
    return _template_package(lead, goal, brief)


def format_package_for_display(pkg: OutreachPackage, lead: Lead) -> str:
    lines = [
        f"Lead: {lead.name} ({pkg.lead_type})",
        f"Goal: {pkg.goal}",
        "",
        "SUBJECTS:",
    ]
    for i, s in enumerate(pkg.subjects, 1):
        lines.append(f"  {i}. {s}")
    lines += [
        "",
        "PRIMARY EMAIL:",
        pkg.primary_email,
        "",
        f"(~{_word_count(pkg.primary_email)} words)",
        "",
        "ALTERNATE ANGLE:",
        pkg.alternate_email,
        "",
        "FOLLOW-UP:",
        pkg.follow_up,
        "",
        "WHY THIS ANGLE:",
        pkg.angle_note,
    ]
    return "\n".join(lines)
