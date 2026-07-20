"""Enrich leads: website, phone, email, Drainage Need Score (DNS).

Apify is NOT re-run for the same lead within TTL (default 7 days) unless --force.
Missing contacts still try free search/scrape without spending Apify.

Usage (from LeadAgent root, venv active):
  $env:APIFY_DRY_RUN='false'
  python scripts/enrich_all.py --limit 20 --push
  python scripts/enrich_all.py --id 12 --push
  python scripts/enrich_all.py --id 12 --force   # re-spend Apify
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from leadagent.db import Database  # noqa: E402
from leadagent.enrich.research import brief_to_summary, enrich_lead  # noqa: E402
from leadagent.settings import get_settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Enrich leads (website/phone/email). Apify once per TTL unless --force."
    )
    parser.add_argument("--limit", type=int, default=100_000, help="Max leads")
    parser.add_argument("--id", type=int, default=None, help="Single lead id only")
    parser.add_argument(
        "--force",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Re-run Apify even if already ran within TTL (default: false)",
    )
    parser.add_argument(
        "--push",
        action="store_true",
        help="After enrich, push full lead cards to the FloGuard CRM shared store",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Skip leads that already have website + phone + email",
    )
    args = parser.parse_args()

    if os.environ.get("APIFY_DRY_RUN", "").lower() not in ("0", "false", "no"):
        if "APIFY_DRY_RUN" not in os.environ:
            os.environ["APIFY_DRY_RUN"] = "false"

    settings = get_settings()
    db = Database(settings.leadagent_db)

    if args.id is not None:
        lead = db.get_lead(args.id)
        leads = [lead] if lead else []
        if not lead:
            print(f"Lead {args.id} not found", file=sys.stderr)
            return 1
    else:
        leads = db.list_leads(limit=args.limit)

    print(
        f"Enriching up to {len(leads)} lead(s) | apify_dry_run={settings.apify_dry_run} "
        f"| token={'yes' if settings.apify_token else 'NO'} | force={args.force}"
    )
    if settings.apify_dry_run or not settings.apify_token:
        print(
            "WARNING: Apify dry-run or missing APIFY_TOKEN — free search/scrape only.",
            file=sys.stderr,
        )

    ok = 0
    skipped_complete = 0
    apify_ran = 0
    apify_skipped = 0
    for lead in leads:
        if args.only_missing:
            has = (
                bool((lead.website or "").strip())
                and bool((lead.phone or "").strip())
                and bool((lead.email or "").strip())
            )
            if has:
                skipped_complete += 1
                continue

        print(f"\n--- #{lead.id} {lead.name} ({lead.city})")
        try:
            brief = enrich_lead(settings, db, lead, force=args.force)
            decision = (brief.raw or {}).get("apify_decision") or {}
            if decision.get("run"):
                apify_ran += 1
                print(f"  apify: RAN ({decision.get('reason')})")
            else:
                apify_skipped += 1
                print(f"  apify: SKIP ({decision.get('reason') or brief.raw.get('apify_skipped')})")
            print(brief_to_summary(brief))
            refreshed = db.get_lead(lead.id) or lead
            print(
                f"  saved → website={refreshed.website or '—'} · "
                f"phone={refreshed.phone or '—'} · email={refreshed.email or '—'} · "
                f"industry={refreshed.industry or '—'}"
            )
            ok += 1
        except Exception as exc:
            print(f"  ERROR: {exc}", file=sys.stderr)

    print(
        f"\nDone: {ok} enriched"
        + (f", {skipped_complete} already complete" if skipped_complete else "")
        + f" | apify ran={apify_ran} skipped={apify_skipped}"
    )

    if args.push:
        try:
            from leadagent.sync_academy import push_leads

            result = push_leads(settings, db)
            print(
                f"Pushed to the FloGuard CRM: {result.get('pushed')} leads "
                f"(added={result.get('added')} merged={result.get('merged')})"
            )
            print("In the FloGuard CRM: hard-refresh and click the Sync pill to pull contacts.")
        except Exception as exc:
            print(f"FloGuard CRM push failed: {exc}", file=sys.stderr)
            return 3
    else:
        print("Tip: add --push to upload full lead cards to the FloGuard CRM.")

    return 0 if ok or skipped_complete else 2


if __name__ == "__main__":
    raise SystemExit(main())
