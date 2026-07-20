"""Drainage Need Score (DNS) — 0–100 sales urgency for drainage leads.

Sales urgency, not an engineering assessment: it prioritizes dials; the free
on-site assessment does the diagnosing. Spec: Sales Docs/DRAINAGE-NEED-SCORE.md.

Scoring is keyword-based over the lead's notes / issue fields:
  duration (how long water stands) + location touched (highest single)
  + damage signals (stack, max +40) + frequency + intent,
with a keyword fallback when no structured signal matches.

Notes wire line (parsed by the CRM prospect card):
  DNS <score>/<grade> (<band>) | <signal 1>; <signal 2>; <signal 3>
"""

from __future__ import annotations

import re
from typing import Any

# --- Duration: how long water stands (take highest single match) ---
_DURATION = [
    (re.compile(r"never (fully )?(dries|drains)|always (wet|standing|soggy)|weeks? to drain"), 45,
     "water never fully dries"),
    (re.compile(r"several days|days to drain|\b\d+\s*\+?\s*days\b|for days|standing water.{0,20}days"), 35,
     "standing water for days"),
    (re.compile(r"about a day|a full day|next day|24 ?hours"), 20,
     "water stands about a day"),
    (re.compile(r"(a )?few hours|couple (of )?hours|hours to drain"), 12,
     "water stands a few hours"),
    (re.compile(r"within an hour|drains (fast|quickly|within)|goes down quickly"), 5,
     "drains within an hour"),
]

# --- Location touched (use highest single location) ---
_LOCATION = [
    (re.compile(r"inside (the )?(house|home)|water (came|come|comes|coming|got|gets) in(side|to the house)?\b|interior flood"), 40,
     "water reaching inside the house"),
    (re.compile(r"crawl ?space|under (the )?(house|home)"), 30,
     "water in the crawlspace / under the home"),
    (re.compile(r"foundation|\bslab\b|stem ?wall"), 25,
     "water around the foundation"),
    (re.compile(r"driveway|patio|lanai|pool deck|walkway"), 15,
     "water on driveway/patio/lanai"),
    (re.compile(r"\byard\b|\blawn\b|\bgrass\b|backyard|front yard"), 5,
     "water in the yard"),
]

# --- Damage signals (stack, max +40) ---
_DAMAGE_MAX = 40
_DAMAGE = [
    (re.compile(r"\bmold\b|musty|mildew"), 15, "mold or musty smell"),
    (re.compile(r"foundation (crack|damage|moisture)|cracks? (in|around|near) (the )?foundation"), 20,
     "foundation cracks or moisture"),
    (re.compile(r"dead grass|erosion|wash(ed)? ?out"), 8, "dead grass / erosion"),
    (re.compile(r"(damaged|cracked|sinking|heaving|buckl\w+) (patio|driveway|pavers?)|pavers? (sinking|shifting)"), 8,
     "damaged patio/driveway"),
    (re.compile(r"water (inside|intrusion|in the (house|home|garage))|flood(ed|ing)? (the )?(house|home|garage|inside)"), 25,
     "water getting inside"),
]

# --- Frequency (take highest single match) ---
_FREQUENCY = [
    (re.compile(r"constant(ly)?|all the time|year.?round|never stops"), 20, "constant water"),
    (re.compile(r"every (time it )?rains?|each rain|any rain|whenever it rains"), 15, "floods every rain"),
    (re.compile(r"seasonal(ly)?|rainy season|wet season|every (summer|year)|hurricane season"), 10,
     "seasonal flooding"),
    (re.compile(r"(only|just) .{0,20}(heavy|big|bad) (storms?|rains?)|heavy (storms?|rains?) only"), 5,
     "heavy storms only"),
]

# --- Intent / timeline (take highest single match) ---
_INTENT = [
    (re.compile(r"\basap\b|urgent(ly)?|right away|immediately|this week"), 10, "wants it fixed ASAP"),
    (re.compile(r"within a month|this month|next few weeks|\bsoon\b"), 5, "timeline within a month"),
]

# --- Keyword fallback when no structured signal matches ---
_FALLBACK = [
    (re.compile(r"flood|standing water|days to drain"), 20, "flooding / standing water reported"),
    (re.compile(r"crawl ?space|musty|mold"), 20, "crawlspace / musty / mold signal"),
    (re.compile(r"foundation"), 20, "foundation mentioned"),
    (re.compile(r"erosion|washout"), 10, "erosion / washout"),
    (re.compile(r"\bsump\b|french drain"), 10, "existing system mentioned"),
]


def grade_for_total(total: int) -> tuple[str, str]:
    """Return (letter_grade, band) per the DNS spec."""
    t = max(0, min(100, int(total)))
    if t >= 85:
        return "A", "urgent"
    if t >= 70:
        return "B", "urgent"
    if t >= 50:
        return "C", "priority"
    if t >= 30:
        return "D", "monitor"
    return "F", "monitor"


def talk_track_for(result: dict[str, Any], name: str = "") -> str:
    """Band-specific talk track (free assessment is always the close)."""
    who = name or "this homeowner"
    gaps = list(result.get("gaps") or [])
    gap_txt = "; ".join(gaps[:2]) if gaps else "the water issue described"
    band = result.get("band") or "monitor"
    if band == "urgent":
        return (
            f"Lead with their own words — {gap_txt}. That kind of water problem "
            f"compounds with every storm. Offer a free on-site assessment slot "
            f"within 24–48 hours: morning or afternoon?"
        )
    if band == "priority":
        return (
            f"Frame the free assessment as fact-finding for {who}: we walk the "
            f"yard, map where the water goes, and fix it before it reaches the "
            f"slab. Book a day + time — no price talk by phone."
        )
    return (
        f"Honest check-in only for {who} — no pressure. Offer a seasonal "
        f"storm-readiness look; if anything changes after a heavy rain, that's "
        f"the moment to walk the yard."
    )


def _first_match(text: str, table: list[tuple[re.Pattern[str], int, str]]) -> tuple[int, str]:
    for rx, pts, label in table:
        if rx.search(text):
            return pts, label
    return 0, ""


def score_text(text: str) -> dict[str, Any]:
    """Score free text (notes / issue description). Returns the DNS dict."""
    low = re.sub(r"\s+", " ", (text or "").lower()).strip()
    total = 0
    gaps: list[str] = []
    dims: dict[str, int] = {
        "duration": 0,
        "location": 0,
        "damage": 0,
        "frequency": 0,
        "intent": 0,
        "fallback": 0,
    }

    if low:
        pts, label = _first_match(low, _DURATION)
        if pts:
            dims["duration"] = pts
            gaps.append(label)

        pts, label = _first_match(low, _LOCATION)
        if pts:
            dims["location"] = pts
            gaps.append(label)

        dmg = 0
        for rx, pts, label in _DAMAGE:
            if rx.search(low):
                dmg += pts
                gaps.append(label)
        dims["damage"] = min(_DAMAGE_MAX, dmg)

        pts, label = _first_match(low, _FREQUENCY)
        if pts:
            dims["frequency"] = pts
            gaps.append(label)

        pts, label = _first_match(low, _INTENT)
        if pts:
            dims["intent"] = pts
            gaps.append(label)

        total = sum(dims.values())

        # Keyword fallback — only when no structured signal hit
        if total == 0:
            for rx, pts, label in _FALLBACK:
                if rx.search(low):
                    dims["fallback"] += pts
                    gaps.append(label)
            total = dims["fallback"]

    total = max(0, min(100, total))
    grade, band = grade_for_total(total)

    # De-duplicate signals, keep order, cap at 5
    seen: set[str] = set()
    uniq: list[str] = []
    for g in gaps:
        if g not in seen:
            seen.add(g)
            uniq.append(g)

    result: dict[str, Any] = {
        "total": total,
        "grade": grade,
        "band": band,
        "gaps": uniq[:5],
        "dimensions": dims,
        "talk_track": "",
    }
    result["talk_track"] = talk_track_for(result)
    return result


def score_lead(lead: Any) -> dict[str, Any]:
    """
    Score a Lead's notes/issue fields.
    Returns {total: 0-100, grade: 'A'-'F', band: 'urgent'|'priority'|'monitor',
             gaps: [signals], talk_track: str} (+ dimensions detail).
    """
    parts = [
        getattr(lead, "notes", "") or "",
        getattr(lead, "industry", "") or "",
    ]
    result = score_text(" \n".join(p for p in parts if p))
    name = getattr(lead, "name", "") or ""
    if name:
        result["talk_track"] = talk_track_for(result, name)
    return result


def score_compact_note(result: dict[str, Any]) -> str:
    """One-line DNS wire note for lead.notes (parsed by the CRM prospect card)."""
    gaps = result.get("gaps") or []
    sig = "; ".join(gaps[:3]) if gaps else "no drainage signals in notes"
    return (
        f"DNS {result.get('total', 0)}/{result.get('grade', 'F')} "
        f"({result.get('band', 'monitor')}) | {sig}"
    )


def apply_score_note(lead: Any, result: dict[str, Any]) -> None:
    """Insert or replace the DNS wire line at the top of lead.notes."""
    note = score_compact_note(result)
    existing = (getattr(lead, "notes", "") or "").strip()
    if "DNS " not in existing:
        lead.notes = f"{note}\n{existing}".strip() if existing else note
        return
    lines = existing.splitlines()
    lines = [note if ln.strip().startswith("DNS ") else ln for ln in lines]
    lead.notes = "\n".join(lines).strip()


def score_to_hooks(result: dict[str, Any], name: str = "") -> list[str]:
    """Short hooks for the research brief / outreach (max 3)."""
    hooks = [
        f"Drainage need {result.get('total', 0)}/100 "
        f"(grade {result.get('grade', 'F')}, {result.get('band', 'monitor')})"
    ]
    for g in (result.get("gaps") or [])[:2]:
        hooks.append(g)
    return hooks[:3]
