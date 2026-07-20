from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from leadagent import __version__
from leadagent.channels.brave_cdp import browser_doctor
from leadagent.channels.outlook import mcp_create_draft_args
from leadagent.classify import classify_lead
from leadagent.db import Database
from leadagent.draft.email_writer import format_package_for_display
from leadagent.enrich.research import brief_to_summary, enrich_lead
from leadagent.import_leads import (
    import_bootstrap,
    import_csv,
    import_json,
    import_tracker_html,
)
from leadagent.import_lists import import_all_lists
from leadagent.models import Lead
from leadagent.pipeline.approve import ApprovalError, approve_draft, mark_sent, reject_draft
from leadagent.pipeline.inbound import draft_reply_for_lead
from leadagent.pipeline.outbound import (
    run_outbound_all_categories,
    run_outbound_batch,
    run_outbound_for_lead,
)
from leadagent.settings import get_settings

app = typer.Typer(
    name="leadagent",
    help="FloGuard drainage / flood-mitigation outreach agent — classify, enrich, draft, approve.",
    no_args_is_help=True,
)
leads_app = typer.Typer(help="Manage leads")
drafts_app = typer.Typer(help="Drafts and approval gate")
run_app = typer.Typer(help="Run pipelines")
sync_app = typer.Typer(help="Sync leads with the FloGuard CRM shared store")
app.add_typer(leads_app, name="leads")
app.add_typer(drafts_app, name="drafts")
app.add_typer(run_app, name="run")
app.add_typer(sync_app, name="sync")

console = Console()


def _db() -> Database:
    s = get_settings()
    return Database(s.leadagent_db)


@app.command()
def version() -> None:
    """Show version."""
    console.print(f"leadagent {__version__}")


@app.command("init-db")
def init_db() -> None:
    """Create SQLite database and schema."""
    db = _db()
    console.print(f"[green]Database ready:[/green] {db.path}")


@app.command("import-leads")
def import_leads_cmd(
    path: Optional[Path] = typer.Argument(
        None, help="CSV, JSON, or tracker HTML path. Omit for bootstrap sample."
    ),
    bootstrap: bool = typer.Option(False, "--bootstrap", help="Load 3 sample leads"),
) -> None:
    """Import leads from CSV/JSON/HTML or bootstrap samples."""
    db = _db()
    if bootstrap or path is None:
        # No repo-level HTML seed file ships with the FloGuard CRM — real leads
        # come from `import-lists`, `sync pull`, or an explicit CSV/JSON path.
        n = import_bootstrap(db)
        console.print(f"Imported {n} bootstrap leads")
        return

    if not path.exists():
        console.print(f"[red]Not found:[/red] {path}")
        raise typer.Exit(1)
    suffix = path.suffix.lower()
    if suffix == ".csv":
        n = import_csv(db, path)
    elif suffix in (".json", ".jsonl"):
        n = import_json(db, path)
    elif suffix in (".html", ".htm"):
        n = import_tracker_html(db, path)
    else:
        console.print("Unsupported format. Use .csv, .json, or .html")
        raise typer.Exit(1)
    console.print(f"[green]Imported {n} leads[/green]")


@app.command("import-lists")
def import_lists_cmd(
    lists_dir: Optional[Path] = typer.Option(
        None,
        "--lists-dir",
        help="Folder containing the FloGuard list CSVs (default: monorepo Lead Tools)",
    ),
    which: str = typer.Option(
        "ALL", "--which", help="Which lists: HOMEOWNERS, PROPERTY_MGMT, or ALL"
    ),
) -> None:
    """Import the FloGuard lists with multi-category merge (french_drain/sump_pump/…)."""
    db = _db()
    result = import_all_lists(db, lists_dir, which=which)
    console.print(Panel.fit(json.dumps(result, indent=2), title="FloGuard list import"))
    console.print(f"[green]Total leads in DB:[/green] {result.get('total_leads')}")


@app.command("export-academy")
def export_academy_cmd(
    out: Optional[Path] = typer.Option(
        None, "--out", help="Output JSON path (default: data/exports/academy_leads.json)"
    ),
    type: Optional[str] = typer.Option(
        None,
        "--type",
        help="Only export leads of this type/category (french_drain|sump_pump|yard_drainage|...)",
    ),
) -> None:
    """Export leads as FloGuard CRM-importable JSON (list/lists labels, contact field)."""
    from leadagent.export_academy import DEFAULT_EXPORT_NAME, export_academy_leads

    db = _db()
    s = get_settings()
    out_path = out or (s.exports_dir / DEFAULT_EXPORT_NAME)
    doc = export_academy_leads(db, out_path, lead_type=type)
    console.print(
        f"[green]Exported {len(doc['leads'])} leads[/green] -> {out_path}"
    )


@sync_app.command("push")
def sync_push() -> None:
    """Push local leads to the FloGuard CRM shared store (bulk_upsert merge)."""
    from leadagent.sync_academy import SyncError, push_leads

    try:
        result = push_leads(get_settings(), _db())
    except SyncError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)
    console.print(
        f"[green]Pushed {result.get('pushed')} leads[/green] — "
        f"server now has {result.get('count')} "
        f"(+{result.get('added', 0)} new, {result.get('merged', 0)} merged)"
    )


@sync_app.command("pull")
def sync_pull() -> None:
    """Pull the FloGuard CRM shared store into local SQLite (merge by name+city)."""
    from leadagent.sync_academy import SyncError, pull_leads

    try:
        result = pull_leads(get_settings(), _db())
    except SyncError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)
    console.print(Panel.fit(json.dumps(result, indent=2), title="CRM sync pull"))


@sync_app.command("status")
def sync_status_cmd() -> None:
    """Compare local vs remote lead counts."""
    from leadagent.sync_academy import SyncError, sync_status

    try:
        result = sync_status(get_settings(), _db())
    except SyncError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)
    console.print(Panel.fit(json.dumps(result, indent=2), title="CRM sync status"))


@leads_app.command("list")
def leads_list(
    type: Optional[str] = typer.Option(
        None, "--type", help="french_drain|sump_pump|yard_drainage|maintenance|property_mgmt|…"
    ),
    city: Optional[str] = typer.Option(None, "--city"),
    status: Optional[str] = typer.Option(None, "--status"),
    limit: int = typer.Option(50, "--limit"),
) -> None:
    """List leads (type matches primary type OR categories membership)."""
    db = _db()
    rows = db.list_leads(lead_type=type, category=type, city=city, status=status, limit=limit)
    table = Table(title=f"Leads ({len(rows)})")
    table.add_column("ID", style="cyan")
    table.add_column("Name")
    table.add_column("City")
    table.add_column("Primary")
    table.add_column("Categories")
    table.add_column("Status")
    for L in rows:
        cats = ",".join(L.category_list())[:28]
        table.add_row(
            str(L.id),
            L.name[:36],
            L.city[:14],
            L.lead_type[:12],
            cats,
            L.status[:14],
        )
    console.print(table)


@leads_app.command("show")
def leads_show(lead_id: int) -> None:
    """Show one lead + goal card."""
    settings = get_settings()
    db = _db()
    lead = db.get_lead(lead_id)
    if not lead:
        console.print(f"[red]Lead {lead_id} not found[/red]")
        raise typer.Exit(1)
    goal = classify_lead(lead, settings.playbooks_path)
    console.print(Panel.fit(lead.model_dump_json(indent=2), title="Lead"))
    console.print(
        Panel.fit(
            f"type={goal.lead_type}\ngoal={goal.goal}\ncta={goal.primary_cta}\n"
            f"pricing={goal.pricing_anchor}\nclose={goal.close_step}",
            title="Goal card",
        )
    )


@leads_app.command("add")
def leads_add(
    name: str = typer.Option(..., "--name"),
    city: str = typer.Option("", "--city"),
    industry: str = typer.Option("", "--industry"),
    lead_type: str = typer.Option("french_drain", "--type"),
    phone: str = typer.Option("", "--phone"),
    website: str = typer.Option("", "--website"),
    email: str = typer.Option("", "--email"),
    notes: str = typer.Option("", "--notes"),
) -> None:
    """Add a lead manually."""
    db = _db()
    lead = Lead(
        name=name,
        city=city,
        industry=industry,
        lead_type=lead_type,
        phone=phone,
        website=website,
        email=email,
        notes=notes,
        status="New",
        source="cli",
    )
    lead = db.upsert_lead(lead)
    console.print(f"[green]Added lead {lead.id}:[/green] {lead.name} ({lead.lead_type})")


@leads_app.command("set-type")
def leads_set_type(lead_id: int, lead_type: str) -> None:
    """Override lead classification (primary type)."""
    db = _db()
    lead = db.get_lead(lead_id)
    if not lead:
        raise typer.Exit(1)
    lead.lead_type = lead_type
    cats = lead.category_list()
    if lead_type not in cats:
        cats.insert(0, lead_type)
    lead.set_categories(cats)
    db.upsert_lead(lead)
    console.print(f"Lead {lead_id} type → {lead_type} · categories={lead.category_list()}")


@leads_app.command("add-category")
def leads_add_category(lead_id: int, category: str) -> None:
    """Add a secondary category so the prospect can be drafted/coached in multiple funnels."""
    db = _db()
    lead = db.get_lead(lead_id)
    if not lead:
        raise typer.Exit(1)
    cat = category.strip().lower()
    db.merge_categories(lead, [cat])
    lead = db.get_lead(lead_id)
    console.print(f"Lead {lead_id} categories → {lead.category_list() if lead else []}")


@app.command()
def research(
    lead_id: int,
    force: bool = typer.Option(False, "--force", help="Re-run enrichment"),
) -> None:
    """Enrich a lead (Apify if configured; heuristic dry-run by default)."""
    settings = get_settings()
    db = _db()
    lead = db.get_lead(lead_id)
    if not lead:
        console.print(f"[red]Lead {lead_id} not found[/red]")
        raise typer.Exit(1)
    lead.status = "Researching"
    db.upsert_lead(lead)
    brief = enrich_lead(settings, db, lead, force=force)
    # Reload lead — enrichment writes website / phone / email when found
    lead = db.get_lead(lead_id) or lead
    console.print(Panel(brief_to_summary(brief), title=f"Research — {lead.name}"))
    console.print(
        f"  Lead contacts → website={lead.website or '—'} · "
        f"phone={lead.phone or '—'} · email={lead.email or '—'}"
    )
    if brief.drainage_score:
        ds = brief.drainage_score
        console.print(
            f"[cyan]Drainage Need Score[/cyan] {ds.get('total', 0)}/100 · "
            f"grade {ds.get('grade', 'F')} · {ds.get('band', 'monitor')}"
        )
    updates = (brief.raw or {}).get("lead_updates") or {}
    if updates:
        console.print(f"[green]Updated fields: {', '.join(updates.keys())}[/green]")
    if settings.apify_dry_run or not settings.apify_token:
        console.print(
            "[yellow]Apify dry-run / no token — free site search + scrape only. "
            "Set APIFY_TOKEN + APIFY_DRY_RUN=false for Google Maps + contact actors.[/yellow]"
        )


# NOTE: the old `score-website` command (Website Fitness Score) was removed with
# the rest of the website product line. FloGuard leads are scored by the Drainage
# Need Score, which `leadagent research <id>` computes and writes to lead notes —
# see src/leadagent/enrich/drainage_score.py.


@app.command()
def draft(
    lead_id: int,
    template: bool = typer.Option(
        False, "--template", help="Force template writer (no LLM)"
    ),
    skip_research: bool = typer.Option(False, "--skip-research"),
    category: Optional[str] = typer.Option(
        None,
        "--category",
        "-c",
        help="Force angle: french_drain|sump_pump|yard_drainage|maintenance|property_mgmt|client|partnership",
    ),
    all_categories: bool = typer.Option(
        False,
        "--all-categories",
        help="Draft one package per category on multi-category leads",
    ),
) -> None:
    """Draft outbound email package for a lead (pending approval)."""
    settings = get_settings()
    db = _db()
    lead = db.get_lead(lead_id)
    if not lead:
        console.print(f"[red]Lead {lead_id} not found[/red]")
        raise typer.Exit(1)
    try:
        if all_categories:
            results = run_outbound_all_categories(
                settings,
                db,
                lead,
                force_template=template,
                skip_research=skip_research,
            )
            for d, pkg, export_path in results:
                console.print(
                    Panel(
                        format_package_for_display(pkg, lead),
                        title=f"Draft #{d.id} · {pkg.lead_type}",
                    )
                )
                if export_path:
                    console.print(f"Export: {export_path}")
            console.print(
                f"[green]Created {len(results)} pending_approval draft(s) "
                f"across categories {lead.category_list()}[/green]"
            )
            return

        d, pkg, export_path = run_outbound_for_lead(
            settings,
            db,
            lead,
            skip_research=skip_research,
            force_template=template,
            category=category,
        )
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)
    console.print(Panel(format_package_for_display(pkg, lead), title=f"Draft #{d.id}"))
    console.print(f"[green]Saved pending_approval draft {d.id}[/green]")
    if export_path:
        console.print(f"Export: {export_path}")
    console.print(
        "\n[bold]Next:[/bold] review → `leadagent drafts approve {id}` → "
        "create Outlook draft via MCP → `leadagent drafts mark-sent {id} --yes`"
    )
    if lead.email:
        args = mcp_create_draft_args(d, lead)
        console.print(Panel(json.dumps(args, indent=2), title="Outlook MCP create_draft args"))


@app.command("draft-reply")
def draft_reply(
    lead_id: int,
    body: str = typer.Option(..., "--body", help="Inbound email body"),
    template: bool = typer.Option(False, "--template"),
) -> None:
    """Draft a reply for an inbound message (pending approval)."""
    settings = get_settings()
    db = _db()
    lead = db.get_lead(lead_id)
    if not lead:
        raise typer.Exit(1)
    d = draft_reply_for_lead(settings, db, lead, body, force_template=template)
    console.print(Panel(d.body, title=f"Reply draft #{d.id} — {d.subject}"))


@drafts_app.command("list")
def drafts_list(
    status: Optional[str] = typer.Option("pending_approval", "--status"),
    limit: int = typer.Option(30, "--limit"),
) -> None:
    """List drafts (default: pending_approval)."""
    db = _db()
    rows = db.list_drafts(status=status if status != "all" else None, limit=limit)
    table = Table(title="Drafts")
    table.add_column("ID")
    table.add_column("Lead")
    table.add_column("Dir")
    table.add_column("Subject")
    table.add_column("Status")
    for d in rows:
        lead = db.get_lead(d.lead_id)
        table.add_row(
            str(d.id),
            (lead.name if lead else str(d.lead_id))[:28],
            d.direction,
            d.subject[:40],
            d.status,
        )
    console.print(table)


@drafts_app.command("show")
def drafts_show(draft_id: int) -> None:
    """Show full draft package."""
    db = _db()
    d = db.get_draft(draft_id)
    if not d:
        raise typer.Exit(1)
    lead = db.get_lead(d.lead_id)
    subjects = json.loads(d.subjects_alt or "[]")
    text = (
        f"Subject: {d.subject}\n"
        f"Alts: {subjects}\n\n"
        f"PRIMARY:\n{d.body}\n\n"
        f"ALTERNATE:\n{d.body_alt}\n\n"
        f"FOLLOW-UP:\n{d.follow_up}\n\n"
        f"ANGLE: {d.angle_note}\n"
        f"Status: {d.status} | Lead: {lead.name if lead else d.lead_id}"
    )
    console.print(Panel(text, title=f"Draft #{d.id}"))


@drafts_app.command("approve")
def drafts_approve(
    draft_id: int,
    send: bool = typer.Option(False, "--send", help="Also mark sent (requires --yes)"),
    yes: bool = typer.Option(False, "--yes", help="Confirm irreversible send"),
    note: str = typer.Option("", "--note"),
) -> None:
    """Approve a draft. Use --send --yes only after Outlook send is intentional."""
    settings = get_settings()
    db = _db()
    try:
        if send and settings.require_send_confirmation and not yes:
            console.print(
                "[red]Refusing to send without --yes[/red]\n"
                "Flow: approve first, create/send in Outlook, then:\n"
                f"  leadagent drafts mark-sent {draft_id} --yes"
            )
            d = approve_draft(settings, db, draft_id, send=False, note=note)
            console.print(f"[green]Approved draft {d.id} (not sent)[/green]")
            return
        d = approve_draft(
            settings, db, draft_id, send=send, confirm_yes=yes, note=note
        )
        console.print(f"[green]Draft {d.id} → {d.status}[/green]")
    except ApprovalError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)


@drafts_app.command("reject")
def drafts_reject(
    draft_id: int, note: str = typer.Option("", "--note")
) -> None:
    """Reject a draft."""
    db = _db()
    try:
        d = reject_draft(db, draft_id, note=note)
        console.print(f"Draft {d.id} rejected")
    except ApprovalError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)


@drafts_app.command("mark-sent")
def drafts_mark_sent(
    draft_id: int,
    yes: bool = typer.Option(False, "--yes", help="Required confirmation"),
    external_id: str = typer.Option("", "--external-id", help="Outlook message_id"),
) -> None:
    """Record that a draft was sent (after Outlook MCP send_draft)."""
    settings = get_settings()
    db = _db()
    try:
        d = mark_sent(
            settings, db, draft_id, confirm_yes=yes, external_id=external_id
        )
        console.print(f"[green]Draft {d.id} marked sent[/green]")
    except ApprovalError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)


@run_app.command("outbound")
def run_outbound(
    type: Optional[str] = typer.Option(
        None, "--type", help="Filter/angle: french_drain|sump_pump|yard_drainage|property_mgmt|…"
    ),
    city: Optional[str] = typer.Option(None, "--city"),
    limit: int = typer.Option(5, "--limit"),
    template: bool = typer.Option(False, "--template"),
    all_categories: bool = typer.Option(
        False, "--all-categories", help="One draft per category membership"
    ),
) -> None:
    """Batch draft outbound emails (all pending_approval — never auto-send)."""
    settings = get_settings()
    db = _db()
    drafts = run_outbound_batch(
        settings,
        db,
        lead_type=type,
        city=city,
        limit=limit,
        force_template=template,
        all_categories=all_categories,
    )
    console.print(f"[green]Created {len(drafts)} drafts[/green]")
    for d in drafts:
        console.print(f"  #{d.id} lead={d.lead_id} [{d.angle_note[:40]}] — {d.subject[:40]}")


@app.command("browser-doctor")
def browser_doctor_cmd() -> None:
    """Check Brave CDP connectivity."""
    settings = get_settings()
    info = browser_doctor(settings)
    console.print(Panel(json.dumps(info, indent=2), title="Browser doctor"))


@app.command("goal")
def goal_cmd(lead_id: int) -> None:
    """Print goal card only."""
    settings = get_settings()
    db = _db()
    lead = db.get_lead(lead_id)
    if not lead:
        raise typer.Exit(1)
    goal = classify_lead(lead, settings.playbooks_path)
    console.print(goal.model_dump_json(indent=2))


if __name__ == "__main__":
    app()
