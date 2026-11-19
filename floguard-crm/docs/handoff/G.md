# Handoff G: estimates -> proposal -> acceptance -> job -> invoice record

Branch `crm-next/G`. No files added under `api/`. No payment processing; no card data is accepted or stored
(Luhn-valid card numbers and card/bank field names are rejected with 400 `payment_data_not_accepted`).

## Files
- `server/lib/estimates.js` (all logic), `api/academy-leads.js` (authenticated actions added), `api/leads.js` (public `proposal_*` actions added; intake unchanged)
- `fsi/sql/020_estimates_additions.sql` (additive; NOT applied anywhere). Required in addition to 017.
- `public/crm/docs/estimate_catalog.json` (catalog, business info, disclaimers, terms placeholders, consent text)
- `public/crm/js/20-estimates.js`, `css/estimates.css` (rep UI; tags added to `index.html`), `proposal.html`, `js/proposal.js`, `css/proposal.css` (customer page)
- `vercel.json`: `/proposal/:token` rewrite to `/crm/proposal.html`, plus noindex / no-referrer / no-store headers for both URLs
- Tests: `tests/estimates/` (pricing, api-estimates, api-proposal, intake-unchanged, ui.test.mjs); screenshots in `docs/handoff/G-screens/`

## Authenticated actions (POST /crm/api/academy-leads, same auth as C)
Storage backend: 501 `postgres_backend_required`. 017 missing under `postgres`: 503 `leads_pipeline_not_ready`. 020 missing: 503 `estimates_not_ready`.
- `estimate_catalog` -> `{catalog}`
- `estimate_create {lead_id, line_items, discount?, discount_reason?, notes_to_customer?, internal_notes?, valid_until?, customer?:{name,address}}` -> `{estimate, proposal}`
- `estimate_update {estimate_id, updated_at?, ...same fields}` draft only (409 `not_draft`, 409 `conflict` with `estimate`)
- `estimate_list {lead_id}` -> `{estimates, jobs}`; `estimate_get {estimate_id}` -> `{estimate, proposal, job}`
- `estimate_send {estimate_id, valid_until?}` draft -> sent: mints a 43-char base64url token (32 random bytes), sets `valid_until` (default today + `ESTIMATE_DEFAULT_VALID_DAYS`), snapshots terms, moves lead stage to `estimate_sent` (never back from `won`), writes activity. Returns `{estimate, public_url, message:{subject,body,sms}, links:{mailto,sms}, warnings}`. Nothing is sent. `sms` link is null when `phone_dnc === true`. Re-send keeps the same token.
- `estimate_void {estimate_id, reason}` (not allowed once accepted); `job_create_from_estimate {estimate_id, scheduled_for?, notes?}` (accepted only, idempotent, one job per estimate); `job_update {job_id, status?, scheduled_for?, completed_at?, notes?}`; `invoice_mark {job_id, invoice_number?, invoice_total?, invoice_status: unbilled|sent|paid, paid_at?}`; `jobs_list {lead_id?, status?}`.
- Totals are always computed server-side from quantity x unit price in cents; client totals are ignored. Numbers `FG-YYYY-NNNN`, per org and year, retried on unique collision.
- Status values returned: draft, sent, accepted, declined, expired (derived from `valid_until`, end of day America/New_York), void (derived from `voided_at`). The 017 status check constraint is untouched.

## Pricing rules enforced
Catalog items come only from the pricing doc: `exterior_french_drain` and `french_drain_sump_system`, both band $4,500-$12,000 per system. Price outside the band needs `band_override_reason` (5+ chars). Custom lines (work the doc does not price: interior/sump-only, yard drainage, maintenance, B2B) always need a reason and unit `each`. Per-foot wording in a description is refused. A discount needs a reason (the doc has no discount policy; logged, owner to decide).

## Public actions (POST /crm/api/leads, no login; the token is the credential)
`proposal_get {token, preview?}`, `proposal_accept {token, name, consent:true}`, `proposal_decline {token, reason?}`.
Unknown, malformed, draft and voided tokens all return the identical `404 {error:'not_found'}`. Expired: get shows `status:'expired'`; accept/decline 410 `expired`. Accept: idempotent (repeat returns `already_accepted:true` with the original name/time); 409 `already_declined`; 400 `consent_required` / `full_name_required`. Records `accepted_at`, `accepted_name`, IP, user-agent and the exact consent wording; lead stage -> `won`. Response whitelist is built field by field in `toPublicProposal` (no lead data, internal notes, scores, FSI/claims, band or discount reasons, IP, ids).
Limits (in-memory per isolate, via `rateLimit`): reads 30/min/IP and 20/min/token; writes 6/min/IP and 10/min/token; 8 misses per 10 min per IP then 429. Tokens are hashed for bucket keys and never logged. CORS unchanged (`setCors` allowlist).

## Customer page
`/proposal/<token>` (Vercel rewrite) or `/crm/proposal.html?t=<token>`. Loads only tokens.css, proposal.css, proposal.js (CSP meta, no inline script/style, text nodes only, no storage). Rep preview: `proposal.html?preview=1` receives the draft via same-origin postMessage from the CRM window; accept is disabled and no view is recorded.

## Rep UI
`FG.estimates.open(lead, {estimateId?})` opens the modal; `FG.estimates.list(lead)` opens the list view and resolves `{estimates, jobs}`. Entry point: registers `FG.leadDrawer.addAction({id,label,icon,title,onClick,run,handler})` if F1's hook exists at DOMContentLoaded/load (callback receives the lead, falls back to the open profile), else a MutationObserver adds an "Estimate" button to `#pfActBar`. F1: confirm the hook signature; the fallback button is skipped once the hook registers. Storage/uncreated-DB errors show "Estimates need the database switched on".

## Owner must supply
- Terms, deposit/payment schedule, warranty text, and the licence/insurance line: edit `estimate_catalog.json` (`terms.text`, `terms.deposit`, `terms.warranty`, `business.license_line`) and set `terms.placeholder` to false. Until then the rep editor shows a "Draft terms" warning, the page shows marked placeholders, and Send asks for confirmation. Not legal advice; have counsel review the consent wording (`acceptance.consent_text`).
- Default validity period (30 days is a placeholder decision), discount policy, whether interior/sump-only, yard drainage and maintenance get priced catalog items.
- Confirm the item descriptions (taken from the doc's service-line wording; the combined-system description assumes the sump is in the band).
- Apply 017 then 020 in Supabase; set `ACADEMY_DATA_BACKEND` to postgres/dual/auto.

## Not verified / notes
- No SQL was run against a real database; PostgREST behaviour is exercised through the in-memory fake only (e.g. `status=in.(...)` filters, unique-index retry, `updated_at=eq` concurrency).
- Vercel header/rewrite behaviour for `/proposal/:token` not tested on Vercel; the dev server only serves `/crm/proposal.html?t=`.
- The proposal page is same-origin with the CRM (shares localStorage). It uses no innerHTML and a strict CSP; hosting it on its own origin would be stronger.
- Rate limits are per serverless isolate. A rep opening the live link (not preview) counts as a customer view.
- `leads.amount` is not updated from estimates (the browser push would overwrite it).
- Browser tests: Chrome only; run `PLAYWRIGHT_CORE=/tmp/etools/node_modules/playwright-core node --test tests/estimates/ui.test.mjs`.
