---
name: sales-agent
description: Operate the local FloGuard LeadAgent CLI — classify drainage / flood-mitigation leads, Apify research, elite outbound email drafts, approval-gated send. Use when drafting FloGuard sales emails, working homeowner or property-manager outreach, or running leadagent commands.
---

# FloGuard Sales Agent

FloGuard, LLC installs smart drainage / flood-mitigation systems for Florida homes
and commercial property. This agent works **only** FloGuard drainage prospects.

## Rules (non-negotiable)

1. **Never auto-send.** Drafts stay `pending_approval` until the human approves.
2. **Send requires typed YES** via `leadagent drafts mark-sent <id> --yes` after Outlook MCP `send_draft`.
3. **Prices, terms, and service-line facts only from** `config/playbooks.yaml` — never invent. Anything unconfirmed there is `[CONFIRM WITH OWNER]`; write nothing rather than guess.
4. **The close is always the FREE on-site assessment** — a specific day + time window. Never a contract, never a firm price by phone or email.
5. **Writing standard** lives in `src/leadagent/draft/prompts.py` (elite SDR / reply-rate standard).
6. **No password storage.** Brave CDP reuses a dedicated logged-in profile.

## Forbidden claims

From `config/playbooks.yaml` — never write any of these: fake urgency or invented
deadlines, invented customer names or stats, guaranteed outcomes, firm system
prices quoted by phone or email, insurance-coverage claims of any kind,
storm-surge or flood-proof protection claims, invented warranty terms,
mold-remediation promises, or buzzwords (synergy / unlock / revolutionize /
game-changer).

## Goal by lead type

| Type | CRM list | Goal |
|------|----------|------|
| french_drain | FrenchDrain | Book the free assessment — French drain + sump candidate |
| sump_pump | SumpPump | Book the free assessment — crawlspace / interior water |
| yard_drainage | YardDrainage | Book the free assessment — yard / hardscape fix (lower entry ticket) |
| maintenance | Maintenance | Book a seasonal storm-readiness service visit |
| property_mgmt | PropertyMgmt | Free pilot assessment of the worst property + written scope for the owner |
| client | Client | Seasonal check, maintenance plan, or referral |
| partnership | Partner | Mutual-upside referral relationship with adjacent trades |

Multi-category: one prospect can sit on several lists (e.g. a homeowner with both
a soggy yard and a musty crawlspace → `yard_drainage` + `sump_pump`). Draft with
`--category` or `--all-categories`.

## Lead priority — Drainage Need Score (DNS)

`leadagent research <id>` computes a 0–100 DNS (`src/leadagent/enrich/drainage_score.py`,
spec in `Sales Docs/DRAINAGE-NEED-SCORE.md`) and writes it to lead notes as
`DNS 78/B (urgent) | signal; signal`.

- `urgent` → dial first, offer a 24–48h assessment slot
- `priority` → normal cadence
- `monitor` → nurture only

It ranks who to contact first. It does **not** diagnose the property — the free
on-site assessment does that.

## CLI workflow

```bash
# Setup
pip install -e ".[dev]"
leadagent init-db
leadagent import-lists --lists-dir "..\Lead Tools" --which ALL
# or: leadagent import-leads --bootstrap
# or: leadagent sync pull    # pull the shared CRM store

# Single lead
leadagent leads list --type french_drain
leadagent leads show 1
leadagent research 1
leadagent draft 1 --template --category french_drain
leadagent draft 1 --template --all-categories   # one package per category
leadagent drafts show 1
leadagent drafts approve 1

# Outlook (via MCP tools in this environment)
# outlook_create_draft with exported subject/body
# human reviews in Outlook
# outlook_send_draft
leadagent drafts mark-sent 1 --yes --external-id <message_id>

# Batch (still no send)
leadagent run outbound --type french_drain --limit 5 --template

# Push enriched cards back to the CRM
leadagent sync push

# Brave
# scripts/start_brave_debug.ps1
leadagent browser-doctor
```

## Outreach package format

Every draft includes:

1. 3 subject lines
2. Primary email
3. Alternate angle
4. Short follow-up
5. Angle note

## Elite writing priorities

Relevance → Credibility → Clarity → Curiosity → Low-friction CTA

Never open with: hope you're well / came across / impressed by / wanted to reach out / my name is.

## Related files

- `config/playbooks.yaml` — brand facts, goals, pricing bands, hooks, forbidden claims
- `src/leadagent/draft/prompts.py` — full system prompt
- `src/leadagent/enrich/drainage_score.py` — Drainage Need Score
- `Sales Docs/DRAINAGE-NEED-SCORE.md` — DNS spec
- `Sales Docs/FloGuard_Drainage_Sales_Playbook.md` — human sales playbook
- `Sales Docs/FloGuard_Objection_Encyclopedia.md` — objection handling
- `Sales Docs/FloGuard_Call_Scripts.md` — call scripts
