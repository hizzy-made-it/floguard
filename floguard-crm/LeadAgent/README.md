# LeadAgent — FloGuard drainage & flood-mitigation outreach

Local hybrid agent that **classifies leads**, **researches** them (Apify or heuristic dry-run), and **drafts elite cold emails** under a strict **human approval gate**. Email send goes through Outlook (MCP or desktop). Social/password platforms use a **dedicated Brave profile** via CDP — no passwords stored in the agent.

FloGuard, LLC installs smart drainage / flood-mitigation systems for Florida homes and commercial property. Every outbound message closes on the same thing: a **free on-site assessment** (a specific day + time) — never a contract, never a firm price.

The CRM front-end this agent syncs with lives at `public/crm/` (deployed at **FloGuardFL.com**).

## Writing standard

Drafts follow the elite outbound standard in `src/leadagent/draft/prompts.py`:

- Success metric = **positive reply rate**
- Priorities: Relevance → Credibility → Clarity → Curiosity → Low-friction CTA
- Output always: **3 subjects · primary · alternate · follow-up · angle note**
- No spam openers, no fake personalization, no invented pricing
- **All prices, terms, and service-line facts come from `config/playbooks.yaml`.** Anything not confirmed there is marked `[CONFIRM WITH OWNER]` — never invent it.

## Quick start

```powershell
cd C:\1projects\_deploy_hdacademy\floguard-crm\LeadAgent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
copy .env.example .env
# Edit .env — set OPENAI_API_KEY when you want LLM drafts; leave empty for templates

leadagent init-db
leadagent import-leads --bootstrap
leadagent leads list
leadagent draft 1 --template
leadagent drafts show 1
leadagent drafts approve 1
```

Import real CRM data — normally straight from the server:

```powershell
leadagent sync pull
```

Offline fallback (browser that never synced):

1. Open the FloGuard CRM (`/crm/`) in Brave/Chrome
2. Paste/run `scripts/export_tracker_leads.js` in the console
3. `leadagent import-leads path\to\floguard_leads_export.json`

## Lead types → goals

The only lead categories are the ones defined in `config/playbooks.yaml`:

| Type | CRM list label | Goal |
|------|----------------|------|
| `french_drain` | FrenchDrain | Book the free on-site assessment for a French drain + sump candidate |
| `sump_pump` | SumpPump | Book the free assessment for a crawlspace / interior water candidate |
| `yard_drainage` | YardDrainage | Book the free assessment for a yard / hardscape drainage fix |
| `maintenance` | Maintenance | Book a seasonal storm-readiness service visit for an existing system |
| `property_mgmt` | PropertyMgmt | Free pilot assessment of the manager's worst property + written scope |
| `client` | Client | Seasonal check, maintenance plan, or referral |
| `partnership` | Partner | Mutual-upside referral relationship with adjacent trades |
| custom | — | Defined only in `config/playbooks.yaml` |

### Import the FloGuard lists (multi-category)

```powershell
leadagent import-lists --lists-dir "C:\1projects\_deploy_hdacademy\floguard-crm\Lead Tools" --which ALL
```

- `List_Homeowners.csv` → residential drainage categories, refined by issue notes
  (crawlspace/sump/musty → `sump_pump`; lanai/patio/driveway/grading → `yard_drainage`;
  maintenance/service/inspect → `maintenance`; otherwise `french_drain`)
- `List_Property_Mgmt.csv` → `property_mgmt`

`--which` accepts `HOMEOWNERS`, `PROPERTY_MGMT`, or `ALL`.

Same business name+city merges into one lead with a `categories` JSON array. Draft per angle:

```powershell
leadagent draft <id> --template --category sump_pump
leadagent draft <id> --template --all-categories
leadagent run outbound --type french_drain --limit 5 --template
```

## Lead scoring — Drainage Need Score (DNS)

Leads are prioritized by the **Drainage Need Score** (0–100), computed in
`src/leadagent/enrich/drainage_score.py`. Full spec: `Sales Docs/DRAINAGE-NEED-SCORE.md`.

It is a **sales urgency score, not an engineering assessment** — it decides who
to dial first; the free on-site assessment does the actual diagnosing.

- Bands: `urgent` (dial first, 24–48h slot) · `priority` (normal cadence) · `monitor` (nurture only)
- `leadagent research <id>` computes it and writes a compact wire line into lead notes:
  `DNS 78/B (urgent) | standing water for days; water in the crawlspace`
- The CRM prospect card and Score column hydrate from that line.

## Sync with the FloGuard CRM (shared leads store)

The deployed CRM (`floguardfl.com/crm/`) and LeadAgent share one server-side lead
list (`/api/academy-leads`, stored in Supabase Storage). Set `ACADEMY_SYNC_SECRET`
in `.env` (must match the Vercel env var of the same name), then:

```powershell
leadagent sync status   # local vs remote counts
leadagent sync push     # SQLite → server (merge by name+city, union lists)
leadagent sync pull     # server → SQLite (rep edits: status, contact, phone…)
leadagent export-academy   # offline alternative: JSON file for the CRM "Import JSON" button
```

Typical refresh: `leadagent import-lists --which ALL` → `leadagent sync push`.
Reps' in-browser edits sync automatically (debounced push after each save);
`sync pull` brings them back into SQLite. Field mapping: the CRM's `contact` ↔
our `contact_name`; CRM list labels (FrenchDrain/SumpPump/YardDrainage/
Maintenance/PropertyMgmt/Client/Partner) map to internal types via `LABEL_TO_TYPE`.

> The endpoint path `/api/academy-leads`, the `X-Academy-Sync-Secret` header, and
> the `website_score` payload key are the deployed backend's contract and are
> intentionally left unrenamed. `website_score` now carries the DNS object.

## Approval / send flow

```
research → draft (pending_approval) → human approve
    → Outlook create_draft (MCP)
    → human review in Outlook
    → Outlook send_draft (MCP)
    → leadagent drafts mark-sent <id> --yes
```

**Never auto-sends.** `--yes` is required to record a send. Daily cap: `DAILY_SEND_CAP`.

## Contact enrichment (website · phone · email)

When you run `leadagent research <id>`, `leadagent draft <id>`, or
`leadagent run outbound`, enrichment tries to **find and save**:

| Field | Sources |
|-------|---------|
| **Website** | Google Maps (Apify) → free DuckDuckGo search fallback |
| **Phone** | Google Maps → site scrape (`/contact`, homepage) |
| **Email** | Site scrape + contact-info actor → mailto/page text |

Only **empty** lead fields are filled (existing values are never overwritten).

```env
APIFY_TOKEN=apify_api_...
APIFY_DRY_RUN=false   # live Maps + crawlers
```

With `APIFY_DRY_RUN=true` (or no token), free discovery still runs: website
search + direct HTTP scrape of the business site for emails/phones.

Configure actors and free-discovery flags in `config/enrichment.yaml`.

Bulk enrichment:

```powershell
python scripts/enrich_all.py --limit 20 --push     # enrich, then push cards to the CRM
python scripts/enrich_all.py --id 12 --force       # re-spend Apify on one lead
```

## Brave (LinkedIn / logged-in sites)

```powershell
.\scripts\start_brave_debug.ps1
leadagent browser-doctor
```

Use the dedicated profile under `%LOCALAPPDATA%\LeadAgent\BraveProfile`. Log into LinkedIn there once.

## CLI map

| Command | Purpose |
|---------|---------|
| `leadagent init-db` | Create SQLite DB + schema |
| `leadagent import-leads <path>` / `--bootstrap` | Import CSV/JSON/HTML, or load samples |
| `leadagent import-lists --which ALL` | Import the FloGuard list CSVs |
| `leadagent leads list/show/add/set-type/add-category` | CRM |
| `leadagent research <id>` | Enrich + Drainage Need Score |
| `leadagent goal <id>` | Print the goal card only |
| `leadagent draft <id>` | Outbound package |
| `leadagent draft-reply <id> --body "..."` | Reply draft |
| `leadagent drafts list/show/approve/reject/mark-sent` | Approval gate |
| `leadagent run outbound --type french_drain --limit 5` | Batch drafts |
| `leadagent export-academy` | CRM-importable JSON |
| `leadagent sync push/pull/status` | Shared CRM leads store |
| `leadagent browser-doctor` | CDP health |
| `leadagent version` | Version |

## Tests

```powershell
pytest -q
```

## Layout

```
config/           playbooks, enrichment, channels
src/leadagent/    CLI, DB, classify, enrich, draft, pipeline, channels
skills/           Agent skill wrapper
scripts/          Brave CDP + bulk enrich + CRM export helper
data/             SQLite + draft exports (gitignored)
```

## Safety

- No platform passwords in `.env`
- No bulk send without caps + confirmation
- Pricing and service-line facts only from `config/playbooks.yaml`
- Never quote a firm system price by phone or email — the close is the free assessment
- No insurance-coverage, flood-proof, or guaranteed-outcome claims (see `forbidden_claims`)
- CAPTCHA / 2FA → hand control back to you

## License

Private — FloGuard, LLC internal use.
