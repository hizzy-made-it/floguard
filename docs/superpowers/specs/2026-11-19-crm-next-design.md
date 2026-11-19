# CRM Next — design and work split (2026-11-19)

Owner request: take `crm.floguardfl.com` (code in `floguard-crm/`) to a professional-grade
look and process; phone numbers on every lead; insurance claims on the flood map; maximum
map accuracy. Owner said "finish everything you listed" and handed over the how.

## State on main (verified 2026-11-19)

- 227 leads, 221 from the flood map; 6 have a phone, 0 an email.
- Leads live in browser localStorage (`floguard_leads_v1`) and sync to a shared store.
- Enrichment exists (`server/lib/contact-enrich.js`): BatchData skip-trace, then free web search.
- Claims exist as tract/grid "claim heat" (`scripts/ingest-nfip-claims.mjs`), but the script
  calls OpenFEMA `v2/FimaNfipClaims`, frozen 2026-06-01. Lat/long are redacted to 0.1 degree,
  so the 0.02 degree grid is false precision. Records carry `censusBlockGroupFips`.
- Terrain: 3DEP 10 m, 3x3 window at parcel centroid. Weights uncalibrated (zero outcomes).
- UI: one 4,679-line `public/crm/index.html` (inline CSS lines 7-419, inline JS 1037-4676),
  Segoe UI, emoji nav, 10 top-level tabs, no inline `onclick` handlers.

## Hard constraints (every agent)

1. **Do not add files under `floguard-crm/api/`.** There are 12 functions already (Vercel
   Hobby cap). Add behaviour as new `action` values on existing endpoints.
2. No build step. The CRM is static files + Vercel functions. Plain JS, classic scripts.
3. Never commit secrets. New env vars go in `.env.example` as names only.
4. All SQL is additive and idempotent (`if not exists`, `create or replace`). Never drop or
   rewrite existing columns. Do not apply SQL to any live database.
5. Compliance copy stays: claims are neighbourhood aggregates, never a personal claim flag;
   FSI is not an inspection; scrub DNC before dialing.
6. Existing behaviour keeps working. No feature removal.
7. Stay inside your owned files. If you need a change elsewhere, write it in your handoff note.
8. Tests: `node --test` for JS (no new dependencies unless unavoidable), `pytest` for Python.
9. Commit on your branch with clear messages ending in:
   `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` and
   `Claude-Session: https://claude.ai/code/session_019rf88SgSnFKzE39L4jHWyB`.
   Do not push.
10. Write a handoff note at `floguard-crm/docs/handoff/<your-letter>.md`: what changed, the
    API/data contract the front end must use, env vars, how to run tests, what you could not verify.

## Wave 1 (parallel, disjoint files)

| | Work | Owns |
|---|---|---|
| A | Contact enrichment: Trestle fallback, per-phone metadata, DNC gating | `server/lib/contact-enrich.js`, new `server/lib/trestle.js`, `api/enrich-contacts.js`, `tests/enrich/` |
| B | Claims: OpenFEMA v3, block-group grain, by flood zone and by storm event | `scripts/ingest-nfip-claims.mjs`, `fsi/sql/016_*.sql`, `api/fsi-parcels.js`, `tests/claims/` |
| C | Leads in Postgres as source of truth, pipeline stage, tasks, activity log | `server/lib/academy-db.js`, `server/lib/academy-pg.js`, `api/academy-leads.js`, `fsi/sql/017_*.sql`, `scripts/migrate-leads-to-pg.mjs`, `tests/leads/` |
| D | Map accuracy pipeline: polygon zonal terrain at 1 m, hydro-conditioning, water table, radar rain, neighbour-relative elevation, confidence, calibration | `fsi/pipeline/`, `fsi/sql/018_*.sql`, `fsi/tests/`, `fsi/README.md`, `fsi/requirements.txt` |
| E | Front end: mechanical split of `index.html` into CSS + classic script files, then the redesign | `public/crm/` except `vendor/` and `docs/` |

### Shared lead contact contract (A writes, C stores, front end reads)

```
lead.phone            string   primary dialable number, "(386) 555-0100"
lead.phones           array of { number, line_type: mobile|landline|voip|unknown,
                                 dnc: true|false|null, litigator: true|false|null,
                                 source: batchdata|trestle|web|search|manual|google_voice,
                                 confidence: 0..1, found_at: ISO }
lead.phone_dnc        true|false|null   for the primary number
lead.phone_line_type, lead.phone_source, lead.phone_confidence
lead.email, lead.email_source
lead.enriched_at      ISO
lead.stage            new|contacted|assessment_booked|estimate_sent|won|lost|nurture
lead.next_action      { type: call|text|email|visit|other, due_at: ISO, note }
lead.updated_at       ISO (server-set; used for conflict resolution)
```

The existing per-cause `status` strings stay. `stage` is derived from them when absent
(New -> new; Called - no answer/Callback/Interested -> contacted; Quoted -> estimate_sent;
Deposit collected/Contract signed -> won; Not interested/Do not contact -> lost;
Archived -> nurture).

## Wave 2 (after wave 1 merges; front-end wiring on the split files)

- F1 Leads workspace: server-backed leads with offline cache, phone chips (line type, DNC,
  source, confidence), dial blocked on DNC, pipeline board, next-action tasks, activity
  timeline, click-to-call/text with logging, funnel dashboard, storm dial banner.
- F2 Map: split view, block-group claims layer with zone/event toggles, parcel polygons at
  high zoom, address search, per-parcel confidence, new terrain fields in the score breakdown.

## Wave 3

- G Estimates: line-item estimate from the pricing doc, printable proposal, typed-signature
  acceptance on a tokenised public page (action on an existing endpoint), job and invoice
  records. No payment processing.
- Review agent over the integrated branch, then a fix pass.

## Approaches considered

- Full rewrite to a React app: best long-term, but the live app has no tests and 4,679 lines
  of working behaviour; a rewrite in one pass would regress it. Rejected for now.
- Restyle in place in the single file: lowest risk, but every later change collides in one file.
- **Chosen:** mechanical split into classic script files (same global scope, no build step),
  then redesign and wire features file by file.

## Out of this pass (needs the owner or real data)

- Running the 1 m LiDAR terrain job (tens of GB of rasters; needs a machine with the data).
- Calibration against real outcomes (zero exist); the script ships, proxy labels are optional.
- Funding BatchData/Trestle, setting API keys in Vercel, applying SQL to Supabase, merging to main.
- Public-records requests for permits and complaints (ingest script shape only).
