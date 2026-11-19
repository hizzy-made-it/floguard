# Handoff C: leads in Postgres (pipeline, tasks, activity)

Branch `crm-next/C`. Owner files: `api/academy-leads.js`, `server/lib/academy-db.js`,
`server/lib/academy-pg.js`, `fsi/sql/017_leads_pipeline.sql`, `scripts/migrate-leads-to-pg.mjs`,
`tests/leads/`. One new file outside that list: `server/lib/leads-core.js` (pure identity/merge/stage
logic shared by the API and the migration script; nothing under `api/` was added).

Run tests: `cd floguard-crm && node --test tests/leads/*.test.js` (no dependencies, no network).

## What changed

- Leads can live in Postgres (`public.leads`) as the source of truth, with `lead_activity`,
  `lead_tasks`, and (for the later Estimates work) `lead_estimates` + `lead_jobs`.
- Identity: incoming leads match by `uuid`/`id`, then `parcel_id`, then name+city. Two same-name
  owners in one city stay separate when both have an address (or both have a parcel) and they differ.
- `phone_dnc === true` is never cleared by a merge. Empty values never clear anything.
- New actions on `/api/academy-leads` (below). The legacy actions keep their request/response shapes.
- Browser-only fields (website_score, mgmt_company_*, maintenance_*, suggested_causes, list_status,
  lists_touched, ...) are stored in `leads.data` jsonb, so nothing the browser stores is lost.

## Backend selection (`ACADEMY_DATA_BACKEND`)

| value | leads backend |
|---|---|
| `storage` | blob `floguard-academy/leads.json` (today's production). New actions return 501. |
| `postgres` | Postgres. If 017 is not applied: every action returns 503 `{error:'leads_pipeline_not_ready'}`. |
| `dual` | Postgres when 017 is applied, and every write is mirrored (full live set) to the blob. Before 017: blob only. |
| `auto` (default) | Postgres when 017 is applied (probed, cached 30 s), else blob. No blob mirror. |

Behaviour change to know about: before this work `auto` used Postgres for leads whenever the
`organizations` table existed, even without 017 columns. Now `auto` needs the 017 columns, otherwise it
stays on the blob. Production sets `storage` explicitly, so it is unaffected.

New actions on the blob backend: HTTP 501 `{"error":"postgres_backend_required","detail":"..."}`.
So does `list` with `since`/`cursor`/`limit`.

## Request/response contract

All requests: `POST /crm/api/academy-leads` (same-origin proxy used by the CRM), JSON body
`{ "action": "...", ... }`. Auth: `Authorization: Bearer <academy session token>` or
`X-Academy-Sync-Secret`. Rate limit 60/min/IP. Errors are `{ "error": "<code>", "detail": "<text>" }`.

A **lead ref** is `lead_id` (or `id`, or `uuid`): a UUID string, or the legacy id (the numeric `id` the
browser already uses, or `web_...` strings). UUID is the stable identity; use `lead.uuid` for new code.

### Lead object (responses)

Everything the browser already had, plus:

```
id            number|string   legacy id (numeric for existing leads) — falls back to uuid if none
uuid          string          stable primary key
address, zip, parcel_id       strings ('' when absent)
phone, phones[], phone_dnc (true|false|null), phone_line_type, phone_source, phone_confidence (0..1|null)
email, email_source, enriched_at (ISO|null)
stage         new|contacted|assessment_booked|estimate_sent|won|lost|nurture   (always present)
next_action   {type: call|text|email|visit|other, due_at: ISO, note, task_id?} | null
created_at, updated_at (ISO, server-set; use updated_at as the concurrency token)
deleted_at    only present on soft-deleted leads (only returned by list+since)
```
`next_follow_up_at` and other date strings the browser sent are returned exactly as sent
(`'2026-11-25'` stays `'2026-11-25'`).

### Legacy actions (unchanged for the current front end and LeadAgent)

- `list` `{}` -> `200 { leads, count, updated_at, next_cursor: null, has_more: false }` (all live leads).
- `push` / `bulk_upsert` `{ leads: [...] }` ->
  `200 { ok, count, added, merged, updated, skipped:{noop,invalid,deleted}, conflicts:[{name,reason}], updated_at }`.
  `count` = live leads after the call; `merged` = incoming rows that matched an existing lead
  (changed or not); `updated` = rows actually written. A push that changes nothing writes nothing and
  does not bump `updated_at` (so the browser's save-on-every-edit does not invalidate other clients'
  tokens). Max 20 000 leads (400 beyond that).
- `replace` `{ leads }` (secret only, else 403/401) -> `200 { ok, count, updated_at }` (Postgres adds `pruned`).
  On Postgres, matched leads keep their identity/history and are overwritten with the incoming
  values; leads not in the set are **soft-deleted** (not destroyed). Stage, next_action, phones and DNC
  are preserved when the incoming lead lacks them.
- `prune_placeholders` `{}` -> `200 { ok, removed, remaining, leads, updated_at }` (soft delete on Postgres).

Push rules worth knowing on the front end:
- A pushed `stage` / `next_action` is ignored when the pushed lead's `updated_at` is older than the
  server row (a stale tab cannot undo a newer stage). Send the `updated_at` you last received.
- A pushed lead that matches a soft-deleted lead is skipped (`skipped.deleted`), not resurrected.
  Send `restore: true` on that lead (or `delete` with `restore:true`) to bring it back.
- New leads pushed with a numeric `id` get a server-assigned id (browser ids collide across devices).
  Non-numeric ids such as `web_abc` are kept as the legacy id.
- Changing the legacy `status`/`list_status` through `push` re-derives `stage` and logs a `stage_change`.

### `list` with cursor / change feed (Postgres only)

Request: `{ action:'list', since?: ISO, cursor?: string, limit?: 1..1000, include_deleted?: bool }`

Response: `200 { leads, count, updated_at, next_cursor, has_more }`.
- Ordered by `(updated_at, id)` ascending. Pass `next_cursor` back as `cursor` until `has_more` is false.
  Ties on identical `updated_at` do not skip rows.
- `since` returns leads changed after that instant **including soft-deleted ones** (`deleted_at` set) so a
  client can drop them. Keep sending the same `since` while paging with `cursor`. Without `since`,
  deleted leads are hidden unless `include_deleted: true`.
- Offline cache pattern: store `updated_at` of the newest lead you hold (or the last `next_cursor`);
  next sync call `list` with `since`.
- 400 `bad_since` / `bad_cursor` on malformed input.

### `get`

`{ action:'get', lead_id }` -> `200 { ok, lead, activity: [...newest first, max 100 (activity_limit up to 500)],
tasks: [open tasks by due_at, then last 50 done] }`. 404 `not_found`.

### `patch` (optimistic concurrency)

`{ action:'patch', lead_id, updated_at, patch: { ...fields }, confirm_dnc_clear? }`

- `updated_at`: the `updated_at` of the lead copy you edited. If it differs from the server row ->
  `409 { error:'conflict', detail, lead: <server copy> }`. Re-apply your change on `lead` and resend with
  `lead.updated_at`. The check is also atomic at write time. Omit `updated_at` only for CLI/unconditional writes.
- `patch` sets exactly the fields given; `null`/`''` clear a field (unlike `push`). `id, uuid, created_at,
  updated_at, deleted_at, legacy_id` are ignored.
- `stage`: one of the seven stages, else 400 `invalid_stage`. A change writes a `stage_change` activity
  (`meta:{from,to,via:'patch'}`).
- `next_action`: object (`due_at` required) or `null`. Sets the lead field and keeps exactly one open
  "next action" task in sync (replacing the previous one). 400 `invalid_next_action`.
- `phones`: merged by number (adds/updates; `dnc`/`litigator` true is sticky). `list_status`: shallow-merged.
- `phone_dnc`: setting `false` while the stored value is `true` needs `confirm_dnc_clear: true`, else
  400 `dnc_clear_requires_confirmation`. A confirmed clear logs a `system` activity. If you replace `phone`
  with a different number and do not send `phone_dnc`, the flag is re-evaluated from that number's `phones[]` entry
  (else `null`); otherwise a `true` flag stays.
- `name` cannot be blank (400 `name_required`).
- Response `200 { ok, lead }`.

### `delete`

`{ action:'delete', lead_id, updated_at?, restore?: true }` -> `200 { ok, id (uuid), deleted_at (null when
restored), updated_at }`; `409 conflict` (with `lead`) when `updated_at` is given and stale. Soft delete only;
history stays. Writes a `system` activity.

### `activity_add`

`{ action:'activity_add', lead_id, type, direction?, outcome?, body?, meta?, at? }`
- `type`: `call|text|email|note|stage_change|enrich|visit|system` (400 `invalid_type`)
- `direction`: `inbound|outbound` or omitted (400 `invalid_direction`); `at`: ISO, default now (400 `invalid_at`)
- `actor` is taken from the session username; the sync-secret caller may send `actor` (default `sync`).
- Does **not** modify the lead row (so it does not invalidate your `updated_at` token).
- -> `200 { ok, activity: { id, lead_id, at, actor, type, direction, outcome, body, meta } }`

### `activity_list`

`{ action:'activity_list', lead_id, limit? (max 500, default 100), before?: ISO }` ->
`200 { ok, activity: [newest first], count }`. Works for soft-deleted leads too.

### `task_add`

`{ action:'task_add', lead_id, type? (default call), due_at (ISO, required), note? }` ->
`200 { ok, task: { id, lead_id, type, due_at, note, done_at: null, created_by, ... }, lead }`.
`lead.next_action` is recomputed as the earliest open task (`{type, due_at, note, task_id}`); the returned
`lead.updated_at` is the new token. 400 `invalid_type` / `invalid_due_at`.

### `task_done`

`{ action:'task_done', task_id (uuid), note? }` -> `200 { ok, task (done_at set), lead }`. Idempotent
(a second call returns the task unchanged). `lead.next_action` is recomputed (null when nothing is open).
Logs a `system` activity. 400 `task_id_required`, 404 `not_found`.

### `tasks_due`

`{ action:'tasks_due', lead_id? }` -> `200 { ok, tasks: [...], counts: { overdue, today, total }, as_of }`.
Open tasks due by the end of today (America/New_York) on live leads, oldest first. Each task:
`{ id, lead_id, type, due_at, note, created_by, is_next_action, bucket: 'overdue'|'today', lead_name,
lead_phone, lead_stage, lead_phone_dnc }`. Block dialing in the UI when `lead_phone_dnc === true`.

### `funnel`

`{ action:'funnel' }` -> `200 { ok, funnel: { new, contacted, assessment_booked, estimate_sent, won, lost,
nurture }, stages: [{stage, leads, amount}, ...in that order, zero-filled], total, as_of }`. Live leads only.
`amount` sums the lead `amount` field.

### Stage derivation (when `stage` is absent)

From legacy `status` and each `list_status` value: New -> new; Called - no answer / Callback / Interested ->
contacted; Quoted -> estimate_sent; Deposit collected / Contract signed -> won; Not interested / Do not
contact -> lost; Archived -> nurture. Across causes the most advanced progress wins (won > estimate_sent >
contacted); with no progress, a terminal primary status wins, otherwise new. `assessment_booked` has no
legacy equivalent: it is only ever set explicitly and survives unrelated pushes.

## Cut-over steps (nothing has been applied anywhere)

1. Review `fsi/sql/017_leads_pipeline.sql`. Apply it in the Supabase SQL editor (or
   `npm run apply-fsi-sql` with `DATABASE_URL`). It is additive and idempotent; safe if `public.leads` already
   exists. Read the NOTICEs: if it says duplicate `parcel_id`s exist, the unique index was skipped
   (a plain index is used and the API dedupes in app code); dedupe those rows and re-run 017.
2. Dry run: `cd floguard-crm && node scripts/migrate-leads-to-pg.mjs --dry-run`
   (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; add `--file floguard_leads_backup.json` for each browser
   JSON export you want folded in, `--no-storage` to skip the bucket). Check the insert/update/skip/conflict
   counts and the listed conflicts.
3. Real run: same command without `--dry-run`. Idempotent; re-run any time. Nothing is deleted.
4. Smoke: set `ACADEMY_DATA_BACKEND=dual` in Vercel, redeploy; open the CRM, edit a lead, confirm it appears in
   Postgres (`select count(*) from leads`) and the blob keeps updating.
5. Flip to `ACADEMY_DATA_BACKEND=postgres` once happy. `storage` is the instant rollback (blob stays warm
   under `dual`; under `postgres` it stops updating, so re-run step 3 style export if you roll back late).

## Decisions and caveats

- `public.leads` DDL is not in the repo (the referenced `20260712_sales_rev_orgs.sql` was never committed).
  Columns were inferred from `leadFromRow`/`leadToRow`; 017 creates the table if missing and adds columns
  otherwise. If the live table differs (for instance `lead_id` types), the FKs are best-effort (NOTICE, no failure).
- parcel_id uniqueness: partial unique index on live rows, created only when no duplicates exist; app level
  matching is the real guard, and an insert race on the index falls back to a merge.
- 017 turns on RLS and revokes anon/authenticated on the existing `leads` table (spec). If anything reads
  `leads` with the anon key (nothing in this repo does), it will stop working.
- The front end still merges server leads into localStorage by lowercased name+city
  (`mergeServerLeads`, around line 2158 of `public/crm/index.html`). That collapses same-name owners on the
  client even though the server no longer does. The front-end agent should key on `uuid` (then parcel_id, then
  name+city+address) and send `updated_at` back on push/patch.
- `saveLeadsStore` (used by `web-leads.js` and `scripts/backfill-lead-addresses.mjs`) on Postgres overwrites matched
  leads, inserts new ones, never deletes, and drops any lead whose `updated_at` is older than the stored row.
- No `Prefer: count` is used, so `list` has no `total`; use `funnel.total` or `count` of an unpaged list.
- Estimates/jobs tables exist but no API touches them yet (Wave 3).

## Not verified

- No SQL was run against a real database. The 017 syntax, the `legacy_id` trigger, the views and the
  PostgREST `or=(...)` keyset filter are exercised only through an in-memory fake (`tests/leads/helpers/fake-supabase.js`).
  Run 017 on a Supabase branch/dev project first.
- `lists` is written as a JSON array; correct for jsonb and PostgREST also accepts it for `text[]`.
