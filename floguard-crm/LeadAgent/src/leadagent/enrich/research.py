from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from leadagent.db import Database
from leadagent.enrich.apify_client import ApifyClient
from leadagent.enrich.contact_finder import (
    contacts_from_apify_items,
    discover_website_via_search,
    is_usable_website,
    normalize_phone,
    normalize_website,
    scrape_website_contacts,
)
from leadagent.enrich.drainage_score import (
    apply_score_note,
    score_lead,
    score_to_hooks,
)
from leadagent.models import Lead, Research, ResearchBrief
from leadagent.settings import Settings


def load_enrichment_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _heuristic_brief(lead: Lead) -> ResearchBrief:
    website = normalize_website(lead.website or "")
    has_site = is_usable_website(website)
    hooks: list[str] = []
    risks: list[str] = []

    if not has_site:
        # Not a pitch angle for FloGuard — just a contact-discovery gap
        risks.append("no_website")

    if lead.city:
        hooks.append(f"Property in {lead.city} — local soil, slope, and water-table angle")

    if lead.industry:
        hooks.append(f"Property / account context: {lead.industry}")

    notes_low = (lead.notes or "").lower()
    if any(k in notes_low for k in ("hurricane", "storm", "tropical", "wet season")):
        hooks.append("Storm-season timing is already on their mind")
    if "insurance" in notes_low:
        # Reps must not follow this thread — coverage claims are forbidden
        risks.append("insurance_mentioned")

    emails: list[str] = []
    if lead.email:
        emails.append(lead.email.strip().lower())

    return ResearchBrief(
        business_name=lead.name,
        category=lead.industry,
        phone=normalize_phone(lead.phone) or lead.phone,
        address=lead.city,
        website_present=has_site,
        website_notes=website if has_site else "none on file",
        rating="",
        review_themes=[],
        hook_candidates=hooks[:3],
        risk_flags=risks,
        emails_found=emails,
        raw={"mode": "heuristic"},
    )


def brief_to_summary(brief: ResearchBrief) -> str:
    lines = [
        f"{brief.business_name} | {brief.category} | {brief.address}",
        f"Website: {'yes — ' + brief.website_notes if brief.website_present else 'NO'}",
    ]
    if brief.drainage_score:
        ds = brief.drainage_score
        lines.append(
            f"Drainage need: {ds.get('total', 0)}/100 grade {ds.get('grade', 'F')} "
            f"({ds.get('band', 'monitor')})"
        )
        if ds.get("gaps"):
            lines.append("Signals: " + "; ".join(ds["gaps"][:5]))
        if ds.get("talk_track"):
            lines.append("Talk track: " + str(ds["talk_track"]))
    if brief.phone:
        lines.append(f"Phone: {brief.phone}")
    if brief.emails_found:
        lines.append("Emails: " + ", ".join(brief.emails_found))
    if brief.rating:
        lines.append(f"Rating: {brief.rating}")
    if brief.review_themes:
        lines.append("Reviews: " + "; ".join(brief.review_themes))
    if brief.hook_candidates:
        lines.append("Hooks: " + " | ".join(brief.hook_candidates))
    if brief.risk_flags:
        lines.append("Risks: " + ", ".join(brief.risk_flags))
    return "\n".join(lines)


def _apply_drainage_score(brief: ResearchBrief, lead: Lead) -> None:
    """
    Score the lead's own water description (DNS) and attach it to the brief.

    Sales urgency only — the free on-site assessment does the diagnosing.
    Purely local: reads lead notes/industry, never touches the network.
    """
    try:
        ds = score_lead(lead)
    except Exception as exc:
        brief.risk_flags.append(f"dns_error:{type(exc).__name__}")
        return

    brief.drainage_score = ds

    band = str(ds.get("band") or "")
    if band and f"dns_{band}" not in brief.risk_flags:
        brief.risk_flags.append(f"dns_{band}")
    if not (ds.get("gaps") or []):
        # No water language on file — the rep has nothing to open on
        if "no_drainage_signal" not in brief.risk_flags:
            brief.risk_flags.append("no_drainage_signal")

    hooks = score_to_hooks(ds, lead.name)
    brief.hook_candidates = list(
        dict.fromkeys([*hooks, *(brief.hook_candidates or [])])
    )[:5]
    brief.raw["drainage_score"] = ds


def _needs_contact_fields(lead: Lead) -> bool:
    """True when prospect is missing website, phone, or email."""
    has_web = is_usable_website(lead.website or "")
    has_phone = bool((lead.phone or "").strip())
    has_email = bool((lead.email or "").strip())
    return not (has_web and has_phone and has_email)


def _parse_scraped_at(raw: str) -> datetime | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        # Accept ISO with or without Z
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _payload_shows_apify_run(payload: dict[str, Any]) -> bool:
    if not isinstance(payload, dict):
        return False
    if payload.get("apify_ran_at"):
        return True
    if int(payload.get("apify_count") or 0) > 0:
        return True
    actors = payload.get("actors_run")
    if isinstance(actors, list) and actors:
        return True
    brief = payload.get("brief") or {}
    if isinstance(brief, dict):
        raw = brief.get("raw") or {}
        if isinstance(raw, dict):
            if raw.get("apify_ran_at"):
                return True
            if int(raw.get("apify_count") or 0) > 0:
                return True
            ar = raw.get("actors_run")
            if isinstance(ar, list) and ar:
                return True
            if raw.get("apify_sample"):
                return True
    return False


def _apify_already_ran(
    db: Database,
    lead_id: int,
    *,
    ttl_hours: int = 168,
    once_forever: bool = False,
) -> tuple[bool, str]:
    """
    True if paid Apify actors already ran for this lead within TTL
    (or ever, when once_forever).
    Returns (skipped, reason).
    """
    if not lead_id:
        return False, ""
    now = datetime.now(timezone.utc)
    for row in db.latest_research(lead_id):
        try:
            payload = json.loads(row.payload_json or "{}")
        except Exception:
            payload = {}
        ran = row.source in ("apify", "merged") or _payload_shows_apify_run(payload)
        if not ran:
            continue
        if once_forever:
            return True, f"prior Apify run (source={row.source}, once_forever)"
        scraped = _parse_scraped_at(row.scraped_at or "")
        # Prefer stamped apify_ran_at inside payload
        stamp = ""
        if isinstance(payload, dict):
            stamp = str(payload.get("apify_ran_at") or "")
            if not stamp:
                brief = payload.get("brief") or {}
                if isinstance(brief, dict):
                    raw = brief.get("raw") or {}
                    if isinstance(raw, dict):
                        stamp = str(raw.get("apify_ran_at") or "")
        stamped = _parse_scraped_at(stamp) or scraped
        if stamped is None:
            # Treat undated prior run as already-ran (safe for budget)
            return True, f"prior Apify run (source={row.source}, no timestamp)"
        age_h = (now - stamped.astimezone(timezone.utc)).total_seconds() / 3600.0
        if age_h < max(0, int(ttl_hours)):
            return True, f"Apify ran {age_h:.1f}h ago (ttl={ttl_hours}h)"
        # Older than TTL — allow re-run; keep looking only for a fresher hit
    return False, ""


def _should_run_apify(
    db: Database,
    lead: Lead,
    cfg: dict[str, Any],
    *,
    force: bool,
    dry_run: bool,
) -> tuple[bool, str]:
    """Whether to spend Apify actors this enrich call."""
    if dry_run or not lead.id:
        return False, "dry_run_or_no_id"
    if force:
        return True, "force"
    if cfg.get("apify_skip_if_ran", True) is False:
        return True, "skip_gate_disabled"
    ttl = int(cfg.get("default_ttl_hours") or 168)
    once = bool(cfg.get("apify_once_forever"))
    already, reason = _apify_already_ran(
        db, lead.id or 0, ttl_hours=ttl, once_forever=once
    )
    if already:
        return False, reason or "already_ran"
    return True, "first_or_expired"


def _apply_contacts_to_brief(
    brief: ResearchBrief,
    *,
    websites: list[str] | None = None,
    phones: list[str] | None = None,
    emails: list[str] | None = None,
    address: str = "",
    rating: str = "",
    category: str = "",
    review_themes: list[str] | None = None,
) -> None:
    for w in websites or []:
        n = normalize_website(w)
        if is_usable_website(n):
            brief.website_present = True
            brief.website_notes = n
            if "no_website" in brief.risk_flags:
                brief.risk_flags = [r for r in brief.risk_flags if r != "no_website"]
            break
        if n and not brief.website_present:
            # Keep social/maps URLs as notes only
            brief.website_notes = n

    for p in phones or []:
        n = normalize_phone(p) or p
        if n:
            brief.phone = n
            break

    for e in emails or []:
        e_low = e.strip().lower()
        if e_low and e_low not in brief.emails_found:
            brief.emails_found.append(e_low)

    if address and not brief.address:
        brief.address = address
    if rating:
        brief.rating = rating
    if category and not brief.category:
        brief.category = category
    if review_themes:
        brief.review_themes = list(review_themes)[:5]


def _write_enrichment_to_lead(
    db: Database, lead: Lead, brief: ResearchBrief
) -> dict[str, str]:
    """
    Persist enrichment onto the lead for CRM completeness.
    Never overwrites non-empty contact fields; keeps one DNS wire line in notes.
    """
    updated: dict[str, str] = {}

    if brief.website_present and is_usable_website(brief.website_notes):
        found_web = normalize_website(brief.website_notes)
        if found_web and not is_usable_website(lead.website or ""):
            lead.website = found_web
            updated["website"] = found_web

    if brief.phone and not (lead.phone or "").strip():
        lead.phone = brief.phone
        updated["phone"] = brief.phone

    if brief.emails_found and not (lead.email or "").strip():
        lead.email = brief.emails_found[0]
        updated["email"] = brief.emails_found[0]

    # Industry / category from Maps when empty
    cat = (brief.category or "").strip()
    if cat and not (lead.industry or "").strip():
        lead.industry = cat
        updated["industry"] = cat

    # Compact DNS wire line for CRM export / prospect card (insert or refresh)
    if brief.drainage_score:
        before = lead.notes or ""
        apply_score_note(lead, brief.drainage_score)
        if (lead.notes or "") != before:
            updated["notes"] = "dns_note"

    if updated and lead.id:
        db.upsert_lead(lead)
        db.log_activity("contact_enriched", lead.id, updated)

    return updated


# Backward-compatible alias
def _write_contacts_to_lead(
    db: Database, lead: Lead, brief: ResearchBrief
) -> dict[str, str]:
    return _write_enrichment_to_lead(db, lead, brief)


def _build_actor_input(
    actor_key: str,
    lead: Lead,
    website: str,
) -> dict[str, Any] | None:
    """Return run input for a known actor key, or None to skip."""
    if actor_key == "google_maps":
        return {
            "searchStringsArray": [f"{lead.name} {lead.city}".strip()],
            "maxCrawledPlacesPerSearch": 3,
            "language": "en",
            "includeWebResults": False,
            "scrapePlaceDetailPage": True,
        }

    site = normalize_website(website or lead.website or "")
    if not site:
        return None

    if actor_key == "website_content":
        return {
            "startUrls": [{"url": site}],
            "maxCrawlPages": 5,
            "crawlerType": "playwright:firefox",
        }

    if actor_key == "contact_info":
        return {
            "startUrls": [{"url": site}],
            "maxRequestsPerStartUrl": 8,
            "maxDepth": 2,
            "sameDomain": True,
            "proxyConfiguration": {"useApifyProxy": True},
        }

    return None


def _run_free_contact_pass(
    lead: Lead,
    brief: ResearchBrief,
    cfg: dict[str, Any],
    *,
    enabled: bool = True,
) -> None:
    """
    No-Apify contact discovery: optional DDG website search + direct site scrape.
    Controlled by settings.enrich_free_discovery + enrichment.yaml free_discovery.
    """
    free_cfg = cfg.get("free_discovery") or {}
    if not enabled or free_cfg.get("enabled", True) is False:
        return

    website = ""
    if brief.website_present and is_usable_website(brief.website_notes):
        website = normalize_website(brief.website_notes)
    elif is_usable_website(lead.website or ""):
        website = normalize_website(lead.website)

    # Discover website if missing
    if not website and free_cfg.get("search_website", True):
        found = discover_website_via_search(lead.name, lead.city or "")
        if found:
            _apply_contacts_to_brief(brief, websites=[found])
            website = found
            brief.raw["website_search"] = found
            brief.hook_candidates = (
                [f"Found likely website via search: {found}"] + brief.hook_candidates
            )[:3]

    # Scrape site for email + phone
    if website and free_cfg.get("scrape_website", True):
        max_pages = int(free_cfg.get("max_pages") or 4)
        scraped = scrape_website_contacts(website, max_pages=max_pages)
        brief.raw["site_scrape"] = {
            "pages_checked": scraped.get("pages_checked"),
            "source_url": scraped.get("source_url"),
            "email_count": len(scraped.get("emails") or []),
            "phone_count": len(scraped.get("phones") or []),
        }
        _apply_contacts_to_brief(
            brief,
            emails=list(scraped.get("emails") or []),
            phones=list(scraped.get("phones") or []),
        )
        if scraped.get("emails"):
            brief.hook_candidates = (
                [f"Public email found on site: {scraped['emails'][0]}"]
                + brief.hook_candidates
            )[:3]


def enrich_lead(
    settings: Settings,
    db: Database,
    lead: Lead,
    *,
    force: bool = False,
) -> ResearchBrief:
    """
    Enrich a lead: find website, phone, and email when missing.

    Order of operations:
      1. Return cached brief if complete and not force
      2. Heuristic brief from existing lead fields
      3. Apify actors at most once per TTL (unless force)
      4. Free discovery for remaining contact gaps (never re-spends Apify)
      5. Drainage Need Score + write full CRM fields onto the lead
    """
    client = ApifyClient(settings)
    cfg = load_enrichment_config(settings.enrichment_path)

    if not force:
        existing = db.latest_research(lead.id or 0)
        for row in existing:
            if row.source in ("heuristic", "apify", "merged", "contacts"):
                try:
                    payload = json.loads(row.payload_json)
                    if payload.get("brief") and not _needs_contact_fields(lead):
                        cached = ResearchBrief(**payload["brief"])
                        # Do not imply Apify will re-run when serving cache
                        raw = dict(cached.raw or {})
                        raw["apify_decision"] = {
                            "run": False,
                            "reason": "cache_complete",
                        }
                        cached.raw = raw
                        return cached
                except Exception:
                    pass

    brief = _heuristic_brief(lead)
    apify_items: list[dict[str, Any]] = []
    actors_run: list[str] = []
    apify_ran_at = ""
    run_apify, apify_reason = _should_run_apify(
        db, lead, cfg, force=force, dry_run=client.dry_run
    )
    brief.raw["apify_decision"] = {"run": run_apify, "reason": apify_reason}

    # Prefer usable website already on lead
    working_website = (
        normalize_website(lead.website)
        if is_usable_website(lead.website or "")
        else ""
    )

    if run_apify and not client.dry_run and lead.id:
        type_key = lead.lead_type or "french_drain"
        plans = cfg.get("type_plans") or {}
        # An explicitly empty plan means "spend nothing here" (residential leads
        # are private homes — business directory actors find nothing). Only fall
        # back to default when the type is absent from config entirely.
        if type_key in plans:
            type_plans = list(plans[type_key] or [])
        else:
            type_plans = list(
                plans.get("default")
                or ["google_maps", "website_content", "contact_info"]
            )
        actors = cfg.get("actors") or {}
        max_actors = int(cfg.get("max_actors_per_lead") or 3)

        for actor_key in type_plans[:max_actors]:
            actor = actors.get(actor_key) or {}
            if not actor.get("enabled"):
                continue
            actor_id = actor.get("actor_id")
            if not actor_id:
                continue

            # website/contact actors need a URL — skip until Maps (or free search) finds one
            run_input = _build_actor_input(actor_key, lead, working_website)
            if run_input is None:
                continue

            try:
                items = client.run_actor(actor_id, run_input)
                apify_items.extend(items)
                actors_run.append(actor_key)
            except Exception as exc:
                brief.risk_flags.append(f"apify_error:{actor_key}:{exc}")
                continue

            # After Maps, promote website for subsequent actors
            if actor_key == "google_maps" and items:
                merged = contacts_from_apify_items(items)
                _apply_contacts_to_brief(
                    brief,
                    websites=list(merged.get("websites") or []),
                    phones=list(merged.get("phones") or []),
                    emails=list(merged.get("emails") or []),
                    address=str(merged.get("address") or ""),
                    rating=str(merged.get("rating") or ""),
                    category=str(merged.get("category") or ""),
                    review_themes=list(merged.get("review_themes") or []),
                )
                if brief.website_present and is_usable_website(brief.website_notes):
                    working_website = normalize_website(brief.website_notes)

        apify_ran_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        # Stamp even if actors returned empty — prevents re-spend loops
        brief.raw["apify_ran_at"] = apify_ran_at
        brief.raw["actors_run"] = actors_run
        brief.raw["apify_count"] = len(apify_items)

        if apify_items:
            merged_all = contacts_from_apify_items(apify_items)
            _apply_contacts_to_brief(
                brief,
                websites=list(merged_all.get("websites") or []),
                phones=list(merged_all.get("phones") or []),
                emails=list(merged_all.get("emails") or []),
                address=str(merged_all.get("address") or ""),
                rating=str(merged_all.get("rating") or ""),
                category=str(merged_all.get("category") or ""),
                review_themes=list(merged_all.get("review_themes") or []),
            )
            brief.raw["apify_sample"] = apify_items[0]
        elif actors_run:
            # Actors ran but empty — still skip next time within TTL
            brief.risk_flags.append("apify_empty_results")
    elif not run_apify and not client.dry_run:
        brief.raw["apify_skipped"] = apify_reason
        if _needs_contact_fields(lead) and not brief.emails_found:
            brief.risk_flags.append("apify_exhausted_no_email")

    # Free pass fills gaps (cheap; never re-triggers Apify)
    still_missing = (
        not brief.website_present
        or not brief.phone
        or not brief.emails_found
    )
    if still_missing:
        _run_free_contact_pass(
            lead,
            brief,
            cfg,
            enabled=getattr(settings, "enrich_free_discovery", True),
        )

    # Prefer lead email already known
    if lead.email and lead.email.strip().lower() not in brief.emails_found:
        brief.emails_found.insert(0, lead.email.strip().lower())

    if not brief.phone and lead.phone:
        brief.phone = normalize_phone(lead.phone) or lead.phone

    # Drainage Need Score (sales urgency from the prospect's own words; not Apify)
    _apply_drainage_score(brief, lead)

    source = "heuristic"
    if apify_items and (
        brief.phone
        or brief.emails_found
        or (brief.website_present and brief.website_notes != (lead.website or ""))
    ):
        source = "merged"
    elif apify_items or (apify_ran_at and actors_run):
        source = "apify" if apify_items or actors_run else source
    elif brief.raw.get("site_scrape") or brief.raw.get("website_search"):
        source = "contacts"
    elif not run_apify and brief.raw.get("apify_skipped"):
        # Gap-fill only after prior Apify
        source = "contacts" if still_missing else "merged"

    updated_fields: dict[str, str] = {}
    if lead.id:
        updated_fields = _write_enrichment_to_lead(db, lead, brief)
        brief.raw["lead_updates"] = updated_fields

        db.add_research(
            Research(
                lead_id=lead.id,
                source=source,
                payload_json=json.dumps(
                    {
                        "brief": brief.model_dump(),
                        "apify_count": len(apify_items),
                        "apify_ran_at": apify_ran_at
                        or brief.raw.get("apify_ran_at")
                        or "",
                        "actors_run": actors_run or brief.raw.get("actors_run") or [],
                        "apify_decision": brief.raw.get("apify_decision"),
                        "lead_updates": updated_fields,
                    }
                ),
                summary=brief_to_summary(brief),
            )
        )
        db.log_activity(
            "research",
            lead.id,
            {
                "source": source,
                "hooks": brief.hook_candidates,
                "dry_run": client.dry_run,
                "apify_run": run_apify,
                "apify_reason": apify_reason,
                "phone": brief.phone,
                "email": (brief.emails_found[0] if brief.emails_found else ""),
                "website": brief.website_notes if brief.website_present else "",
                "updated": updated_fields,
            },
        )

    return brief
