# Handoff S: SQL verification of 016 / 017 on a real Postgres (2026-11-19)

Branch `crm-next/S`. Nothing was applied to any live database. Everything below ran on a throw-away local
PostgreSQL **16.15** cluster (`/tmp/pg-s`, port 54329, unprivileged OS user `pgs`). Production is PG17; see "Not verifiable".

Run it again any time: `floguard-crm/fsi/tests/sql/run-local.sh` (exit 0 = all green; `KEEP_SERVER=1` leaves the cluster up).
Every `fsi/sql/NNN_*.sql` with NNN > 015 is picked up automatically (so 018 is applied 3x and linted with no edits),
and every `fsi/tests/sql/*.test.sql` whose `-- scenarios:` header lists a scenario runs against it.

## Stand-ins (the only things faked; all in `fsi/tests/sql/00_bootstrap_supabase.sql` and `run-local.sh`)

| Real thing | Stand-in | Effect on verification |
|---|---|---|
| PostGIS `extensions.geometry(MultiPolygon, 4326)` | `create domain extensions.geometry as text` | geometry columns hold text. Typmod / SRID enforcement and every spatial function are NOT exercised. |
| `st_geomfromgeojson`, `st_setsrid`, `st_multi` (called only by `nfip_claim_bg_build_geom`) | identity SQL functions in schema `extensions` | proves the function parses, runs, and counts rows; not that real PostGIS accepts the GeoJSON. |
| GiST index (`using gist (geom)`, 001 + 016) | plain btree on the text column | index DDL shape only. |
| `create extension postgis` (001, supabase migration DO block), `create extension pg_cron` (005) | removed / `null;` in the temp copy | |
| `cron.job`, `cron.schedule`, `cron.unschedule` | tiny table + two functions | 005/006/009 scheduling statements run; no job ever fires. |
| `net.http_get`, `net._http_response` | stub function + empty table | 007/009 bodies are plpgsql and never executed; they only had to be created. |
| Roles `anon`, `authenticated`, `service_role` | `nologin noinherit`; `service_role` has `BYPASSRLS` (as on Supabase) | grants/RLS tests use real `set role`. |
| Supabase default privileges (ALL on new public tables/functions/sequences to the three roles) | `alter default privileges ...` | makes the migrations' REVOKEs matter; this is how the sequence leak below was found. |

The committed 001-017 files are never edited by the harness. Each is run through `sed` into a temp copy that only
(a) swaps `[extensions.]geometry(Type, srid)` for `extensions.geometry`, (b) turns `using gist (col)` into `(col)`,
(c) deletes/neutralises the two `create extension` lines. 016 and 017 contain no other geometry or extension syntax.

Scenario databases (all cloned from `s_base` = bootstrap + 001..015 + the two `supabase/migrations/*` files):

| DB | Starting state for 017 |
|---|---|
| `s_a` | no `public.leads` |
| `s_b` | legacy `leads` (shape inferred from `git show be167fd:floguard-crm/server/lib/academy-pg.js`: `organizations` table + `org_id` FK, `legacy_id`, `lists text[]`, `meta`, `pipeline_status`, `unique(org_id, legacy_id)`), 30 rows, 2 null names, 1 empty name, 3 blank parcel_ids, **duplicate parcel_ids** (`P-100` x2, `P-200` x3), pre-existing `parcel_id/address/zip` columns |
| `s_c` | same, no duplicates, `lists jsonb` |
| `s_d` | same, exactly the inferred shape (no `parcel_id/address/zip` columns) |
| `s_e` | like `s_a`, but all objects are owned by a NON-superuser login role and 016/017 are applied as that role (Supabase's `postgres` is not a superuser) |

## What passed (final run: ALL OK)

| Check | Result |
|---|---|
| 001..015 apply on stand-ins | all 15 files clean, no error other than the stand-in extension lines (handled by rewrite) |
| `supabase/migrations/*` on top of 001..015 | schema identical (they are copies of 001+002+003 and 004). Data: re-applying re-upserts `FIXTURE-*` rows in `parcel_risk` (`updated_at = now()` and fixture values). Harmless, see "Reported only". |
| 016 and 017 first apply, single transaction each, in s_a..s_e | clean. Only NOTICEs: s_b prints the duplicate-parcel notice (expected). |
| 2nd and 3rd apply | clean; `pg_dump -s` (incl. ACLs, triggers, indexes, views) byte-identical and md5 of every public table identical, so no data change, `updated_at` untouched, stage backfill not re-run |
| Stage backfill re-run guard | hand-set `assessment_booked` / `won` (status still `New`) survive a 4th apply |
| 016 formula | heat = min(1, ln(1+w)/ln(1+ref)), w = sfha + 2 zone_x + other, ref = max(5, p95): hand values (e.g. 0.3801, 0.6732, 0.5568, 0.8296, cap at 1, 0 for a zero-claim group) and an independent SQL re-implementation agree on every row |
| 016 zone-X weighting | 10 zone X claims out-heat 10 SFHA claims, at block group and parcel level |
| 016 parcel apply | `claim_bg_*` and legacy `claim_heat/claim_count_10y/claim_paid_sum/claim_last_year` set from block group; zero-claim group forces 0; tract fallback when `block_group` is null OR not in the table; stale `claim_bg_*` cleared on fallback; parcel with neither untouched; all 8 buckets touch each parcel exactly once; 2nd pass changes 0; bad bucket args raise |
| 016 events | `nfip_claim_event_list`: min-claims filter, sums, block-group count, named flag, ordering newest-year-first, `null` min |
| 015 after 016 | `must_have_rescore()`, `must_have_cuts()+must_have_apply_batch()` (8 buckets), `must_have_band_counts()`, `must_have_raw` 9-arg default call all run; `claim_hot_tract` and `gold_segment` fire off block-group heat and not off a zero-claim group |
| 017 behaviour | `updated_at` trigger (also overrides a client-supplied value), `legacy_id` auto-assign (max+1, explicit ids kept, whitespace replaced, 20-digit numeric ignored), 4 concurrent sessions x 40 inserts got 160 distinct ids, funnel counts / amounts / soft delete excluded, `lead_tasks_due` bucketing at ET 23:59 / 00:01 boundaries (tasks of soft-deleted leads and done tasks excluded), check constraints, estimate `number` and `public_token` uniqueness and shape, all FK behaviours (cascade on lead delete, `estimate_id` set null, orphan inserts rejected, soft delete keeps history) |
| 017 parcel unique index | no-duplicates states: unique index exists, duplicate live parcel rejected, NULL and blank allowed, reusable after soft delete. s_b: no unique index + plain index + NOTICE, duplicates insertable; after dedupe and re-run the unique index appears and the plain one is dropped |
| RLS / grants (004 pattern) | RLS on for 5 tables, zero policies; `anon` and `authenticated` have no privilege on any table, view or sequence (live `set role` denials checked); `service_role` has full DML, view select, sequence usage and can insert (trigger + sequence default work under RLS bypass) |
| Function lint (generic, covers 018+) | every function created after 015 pins `search_path`; non-trigger functions: no EXECUTE for anon/authenticated, EXECUTE for service_role |
| JS <-> SQL contract (`contract-check.mjs`) | every column the ingest, `claims_layer`, `leadToRow`, activity/task inserts and the view reads use exists; JS stage/activity/task enums equal the SQL CHECK lists; JS `applyHeat` equals SQL `nfip_recompute_block_group_heat` on 300 random rows (max diff 4.9e-4 = JS rounding to 3 dp); SQL backfill CASE equals JS `stageFromStatus` for every legacy status |
| Scale smoke (313k synthetic parcels, 3 KB text in `geom`; not committed) | 016 DDL 0.2 s; `nfip_apply_block_group_claims` all 8 buckets 10.6 s (297k rows changed), second pass 13.8 s (0 changed, it still scans); `must_have_rescore()` 21 s |
| Node suite | `npm test`: 153 / 153 (no JS change was needed) |

Test totals in the last run: s_a 309 pass / 0 fail, s_b 321 / 0, s_c 321 / 0, s_d 321 / 0, s_e 309 / 0, plus 18 contract checks on each of s_a and s_c and 2 concurrency checks.
Run against the ORIGINAL 016/017 the same harness fails 8 assertions per DB (the defects below), so the tests do have teeth.

## Defects found and fixed (016 / 017 only; all additive and idempotent)

| # | File | Defect | Fix |
|---|---|---|---|
| 1 | 017 | Unique index `leads_parcel_id_uidx` excluded NULL but not `''`. The migration normalises existing blanks, but any later insert of two leads with a blank parcel_id (a CRM row, a CSV, a hand edit) hits `duplicate key ... leads_parcel_id_uidx`. The API writes NULL, other writers may not. | Predicate is now `parcel_id is not null and btrim(parcel_id) <> '' and deleted_at is null`, and the duplicate pre-count uses the same predicate. |
| 2 | 017 | After duplicates were resolved and 017 re-run, the stop-gap `leads_parcel_id_idx` stayed forever next to the unique index (redundant write cost). | Dropped when the unique index is created. |
| 3 | 017 | `lead_estimate_number_seq` kept the `anon`/`authenticated` ALL grants Supabase's default privileges give new sequences (found only because the harness reproduces default privileges). | `revoke all on sequence ... from anon, authenticated`. |
| 4 | 017 | `lead_funnel` and `lead_tasks_due` were SECURITY DEFINER views (default), linter 0010 and a standing back door around table grants. | `with (security_invoker = true)` (PG15+). service_role still reads them (table grants + BYPASSRLS). |
| 5 | 016, 017 | `nfip_weighted_count`, `touch_updated_at`, `leads_assign_legacy_id` had no pinned `search_path` (linter 0011). Note `touch_updated_at` is also defined in 007 with an identical body; re-declaring it only adds the pin. | `set search_path = public` on all three. |
| 6 | 017 | `create extension if not exists pgcrypto` is a no-op on Supabase but, where pgcrypto is missing, creates it in `public` (linter 0014) or fails for a role without CREATE on the database (reproduced in s_e). `gen_random_uuid()` is core. | Line removed. |
| 7 | 017 | stage backfill guard looked at `information_schema.columns`, which only shows columns the current role can see; a role without privileges would re-add the column and error. | `pg_attribute` lookup. |
| 8 | 016 | `abs(hashtext(parcel_id)) % buckets`: `abs(-2147483648)` raises `integer out of range`. Chance a given run meets that hash among 313k parcels is about 7e-5, and the whole bucket call would fail. | `abs(hashtext(...)::bigint)` in both statements of `nfip_apply_block_group_claims`. Bucket assignment is unchanged for every other value. |
| 9 | 016 | No schema-cache reload (017 has one). | `notify pgrst, 'reload schema';` appended. |

No JS mirror changed: the unique-index predicate change keeps the API's behaviour (it writes NULL for blanks and handles a 409), and the heat formula was not touched.

## Reported only (not edited: files owned by others, or not defects)

- `supabase/migrations/20260721184122_*` embeds 002's `FIXTURE-001..021` upsert. If those rows exist or are re-added in production they are reset on every re-apply, and applying the migration to production adds 21 fake parcels (`owner_name 'Fixture Owner NN'`). Do not run the migration files and the SQL-editor files both; run each exactly once. Check `select count(*) from parcel_risk where parcel_id like 'FIXTURE-%'` before and after.
- `012`/`015` `must_have_apply_batch` use the same `abs(hashtext())` pattern as defect 8 (same 7e-5 chance). Not touched.
- `nfip_recompute_block_group_heat()` rewrites every block-group row (and `updated_at`) on every call even when nothing changed. Fine at 343 rows.
- 016 `nfip_apply_block_group_claims`: a parcel whose `block_group` is set but absent from `nfip_claim_block_group` AND whose tract is absent from `nfip_claim_tract` keeps its old `claim_heat` and old `claim_bg_*`. Normal ingest creates a row for every 2020 block group, so this only bites after `--reassign-all` into an unmatched area.
- 017 stage backfill uses the primary `status` only (documented in the file); the API derives across `list_status`. Legacy leads whose only progress is in `list_status` start at `new` until their next push.
- Production `leads` constraints are unknown. If it has a CHECK on `pipeline_status` (old values: new, contacted, follow_up, closed, lost), the new API writes `pipelineFromStage(stage)`; confirm with the pre-flight below.
- The `organizations` table and its RLS are not touched by 017.

## Large-table / lock / version lint (016 on 313k-row `parcel_risk`)

| Statement | Cost | Verdict |
|---|---|---|
| 6 x `alter table parcel_risk add column ... ` (no default) | metadata only; brief ACCESS EXCLUSIVE lock | OK. They queue behind any long transaction on `parcel_risk` (the daily `fsi_daily` job runs up to 1800 s) and then block everyone queued behind them, so set `lock_timeout` (below) and avoid 11:00-12:30 UTC (the 005/006/009 cron window). |
| `create index parcel_risk_block_group_idx on parcel_risk (block_group)` (not CONCURRENTLY) | SHARE lock (blocks writes, not reads) for the build. Column is all NULL at this point; the scale smoke built it in about 0.1 s. | Acceptable in a migration. CONCURRENTLY cannot run inside the SQL editor's transaction and is unnecessary here. |
| `create index nfip_claim_bg_*` (incl. gist) | tables are new / ~343 rows | OK |
| `nfip_apply_block_group_claims` | updates up to all rows of `parcel_risk` per full pass (297k rows in 10.6 s locally, row-lock only, bucketed, `statement_timeout 900s` per call). Heavy WAL and bloat on a 313k x wide-geom table | Not part of the migration; run by the ingest. Run `vacuum (analyze) parcel_risk` afterwards. |
| 017 `alter table leads add column ... default <constant>` (`phones`, `data`, `stage`) | PG11+ metadata only; 017 touches ~227 rows | OK. No volatile default is added to an existing table (`gen_random_uuid()` defaults appear only on new tables). |
| 017 `add constraint leads_stage_check` | ACCESS EXCLUSIVE + full scan of `leads` (~227 rows) | OK |
| PG17 specifics | `security_invoker` views need PG15+. Nothing else is version dependent (no removed catalog columns, no `pg_stat_*`, no MAINTAIN reliance; the expression index `lower(name)` uses a builtin so PG17's safe-search_path-in-maintenance rule is irrelevant). | OK on 15/17 |
| REVOKEs that could break PostgREST | `revoke ... from public, anon, authenticated` on the 016 functions and tables, and on `leads` + new tables in 017. PostgREST connects as `authenticator` and switches to the JWT role; every code path in this repo uses the service-role key (checked: `server/lib/supabase-rest.js`, `api/fsi-parcels.js`, the ingest script), and `service_role` keeps EXECUTE/DML (tested via `set role`). | Safe for this codebase. Pre-flight below checks nothing else relies on anon/authenticated access to `leads`. |

## Not verifiable without real PostGIS / Supabase

- Anything involving real PostGIS: geometry typmod, GiST build, `st_geomfromgeojson(jsonb::text)` accepting the TIGERweb GeoJSON (Polygon vs MultiPolygon, `GeometryCollection` would violate the MultiPolygon typmod), and `nfip_claim_bg_build_geom` runtime on 343 real polygons.
- pg_cron / pg_net actually firing; `supabase_admin`-owned event triggers; the real Supabase default ACLs (reproduced from documentation, not from the platform).
- PG17 planner behaviour and real timings (smoke numbers are PG16, synthetic rows).
- The real production `public.leads` DDL, its policies/triggers/FKs from other tables (e.g. `activities.lead_id`), and the PostgREST upsert path (`on_conflict` merge-duplicates with a `jsonb` array into `text[]` for `lists`). The 4 legacy-shape scenarios are inferred; the pre-flight queries below close that gap.
- Real PostgREST: the harness checks column/enum agreement, not HTTP behaviour.
- Contention between the ingest and the daily cron on a live system.

## Safe apply order (production)

0. Pre-flight queries below. Stop if any "STOP" condition appears.
1. Take a backup of the columns 016 overwrites (cheap, makes rollback exact):
   ```sql
   create table public._bak_parcel_claims_20261119 as
     select parcel_id, claim_heat, claim_count_10y, claim_paid_sum, claim_last_year,
            must_have_score, must_have_band, must_have_reasons from public.parcel_risk;
   ```
   Also `create table public._bak_leads_20261119 as select * from public.leads;` if `leads` exists. Both tables are created by `postgres` and so carry default privileges that grant `anon`/`authenticated`: run `revoke all on public._bak_parcel_claims_20261119, public._bak_leads_20261119 from anon, authenticated; alter table ... enable row level security;` straight after, and drop them when done.
2. In the SQL editor session: `set lock_timeout = '10s'; set statement_timeout = '120s';` then run `fsi/sql/016_claims_block_group.sql` (single run, outside 11:00-12:30 UTC). Verify (queries below).
3. Run the ingest per `docs/handoff/B.md` (join-census-tracts first, then `ingest-nfip-claims.mjs`). 016 is inert for the map until then (`claims_layer` reports `available:false`).
4. Run `fsi/sql/017_leads_pipeline.sql`. Read the NOTICEs. If it reports duplicate parcel_ids it still succeeds; dedupe and re-run (the unique index then appears). Verify.
5. Only then flip `ACADEMY_DATA_BACKEND` (see `C.md`). 018 comes after, same procedure; add its own `*.test.sql` and re-run `run-local.sh`.

### Pre-flight queries (read-only)

```sql
-- environment
select version();
select extname, extnamespace::regnamespace from pg_extension where extname in ('postgis','pg_cron','pg_net');
select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('postgres','anon','authenticated','service_role');
-- 015 applied? (must return a regprocedure, not null)
select to_regprocedure('public.must_have_raw(real,real,text,text,real,real,real,integer,text,real,real,real)');
select column_name from information_schema.columns where table_name = 'parcel_risk'
   and column_name in ('census_tract','claim_heat','impervious_ratio','lot_sqft','depr_n') order by 1;      -- expect 5 rows
select count(*) from public.parcel_risk;                                                                 -- ~313k
-- already applied / name collisions (all should be null before you start)
select to_regclass('public.nfip_claim_block_group'), to_regclass('public.nfip_claim_event'),
       to_regclass('public.lead_activity'), to_regclass('public.lead_tasks'), to_regclass('public.lead_estimates'),
       to_regclass('public.lead_jobs'), to_regclass('public.lead_funnel'), to_regclass('public.lead_tasks_due');
select count(*) from public.parcel_risk where parcel_id like 'FIXTURE-%';
-- who holds locks / long transactions right now (STOP if something runs on parcel_risk)
select pid, state, now() - xact_start as age, left(query, 80) from pg_stat_activity
 where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid();
select jobname, schedule from cron.job;

-- leads (017)
select to_regclass('public.leads');
select column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'leads' order by ordinal_position;       -- id must be uuid
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.leads'::regclass;   -- STOP on an unexpected CHECK (esp. pipeline_status) or a non-uuid pk
select conrelid::regclass as referencing, conname from pg_constraint where confrelid = 'public.leads'::regclass;   -- tables with an FK to leads
select tgname from pg_trigger where tgrelid = 'public.leads'::regclass and not tgisinternal;
select policyname, roles, cmd, qual from pg_policies where tablename = 'leads';          -- anything granting authenticated?
select grantee, privilege_type from information_schema.role_table_grants
 where table_name = 'leads' and grantee in ('anon','authenticated');                     -- 017 will revoke these
select relrowsecurity from pg_class where oid = 'public.leads'::regclass;
select pg_get_functiondef('public.touch_updated_at()'::regprocedure);                     -- expect the one-line 007 body
select count(*) as total,
       count(*) filter (where legacy_id is not null and legacy_id !~ '^[0-9]{1,15}$') as non_numeric_legacy
  from public.leads;
-- only if leads.parcel_id already exists:
select parcel_id, count(*) from public.leads
 where parcel_id is not null and btrim(parcel_id) <> '' and deleted_at is null
 group by 1 having count(*) > 1;                                                         -- duplicates: 017 still applies, without the unique index
select count(*) from public.leads where parcel_id is not null and btrim(parcel_id) = '';  -- blanks: 017 nulls them
-- who depends on leads (views, functions)
select distinct dependent_view.relname from pg_depend d join pg_rewrite r on r.oid = d.objid
  join pg_class dependent_view on dependent_view.oid = r.ev_class
 where d.refobjid = 'public.leads'::regclass and dependent_view.relname <> 'leads';
```

### Post-apply verification (read-only)

```sql
-- 016
select count(*) from public.nfip_claim_block_group;   -- 0 until the ingest has run
select proname, prosecdef, proconfig from pg_proc where proname like 'nfip\_%' and pronamespace = 'public'::regnamespace;
select has_function_privilege('anon', 'public.nfip_apply_block_group_claims(integer,integer)', 'execute');   -- false
-- 017
select stage, count(*) from public.leads group by 1 order by 1;
select indexname from pg_indexes where tablename = 'leads' and indexname like 'leads\_parcel%';
select relname, relrowsecurity from pg_class where relname in ('leads','lead_activity','lead_tasks','lead_estimates','lead_jobs');
select has_table_privilege('anon', 'public.leads', 'select'), has_table_privilege('service_role', 'public.leads', 'select');   -- false, true
select * from public.lead_funnel;
```

## Rollback

016 (data in the new tables is re-creatable by re-running the ingest; parcel columns revert by restoring the backup):
```sql
begin;
drop function if exists public.nfip_claim_event_list(integer);
drop function if exists public.nfip_apply_block_group_claims(integer, integer);
drop function if exists public.nfip_claim_bg_build_geom();
drop function if exists public.nfip_recompute_block_group_heat();
drop function if exists public.nfip_weighted_count(integer, integer, integer);
drop table if exists public.nfip_claim_event;
drop table if exists public.nfip_claim_block_group;
alter table public.parcel_risk drop column if exists block_group, drop column if exists claim_bg_count_10y,
  drop column if exists claim_bg_zone_x_10y, drop column if exists claim_bg_rate,
  drop column if exists claim_bg_last_year, drop column if exists claim_bg_top_event;   -- also drops parcel_risk_block_group_idx
update public.parcel_risk p set claim_heat = b.claim_heat, claim_count_10y = b.claim_count_10y,
       claim_paid_sum = b.claim_paid_sum, claim_last_year = b.claim_last_year
  from public._bak_parcel_claims_20261119 b where b.parcel_id = p.parcel_id;
commit;
-- then, to rebuild must-have from the restored heat:  node scripts/score-must-have.mjs
-- (or restore must_have_* from the backup table with the same UPDATE ... FROM pattern)
```
`nfip_claim_tract` and `claim_heat` columns pre-date 016 and are not dropped. Do not drop `parcel_risk` columns if 018 already depends on them.

017 when `public.leads` existed before (drops only what 017 added; compare with the pre-flight column list first, and only drop columns that were NOT there before):
```sql
begin;
drop view if exists public.lead_funnel, public.lead_tasks_due;
drop table if exists public.lead_jobs, public.lead_estimates, public.lead_tasks, public.lead_activity;   -- loses any estimates/tasks/activity written since
drop sequence if exists public.lead_estimate_number_seq;
drop trigger if exists leads_assign_legacy_id_trg on public.leads;
drop trigger if exists leads_touch_updated_at_trg on public.leads;
drop function if exists public.leads_assign_legacy_id();
drop index if exists public.leads_parcel_id_uidx, public.leads_parcel_id_idx, public.leads_legacy_id_idx,
     public.leads_stage_idx, public.leads_updated_at_idx, public.leads_name_city_idx;
alter table public.leads drop constraint if exists leads_stage_check;
-- columns 017 may have added (drop only those absent from your pre-flight list; this destroys their contents):
-- alter table public.leads drop column stage, drop column phones, drop column phone_dnc, drop column phone_line_type,
--   drop column phone_source, drop column phone_confidence, drop column email_source, drop column enriched_at,
--   drop column next_action, drop column data, drop column deleted_at, drop column address, drop column zip, drop column parcel_id;
-- restore what the pre-flight showed: RLS flag and grants, e.g.
-- alter table public.leads disable row level security;   -- only if relrowsecurity was false before
-- grant select, insert, update, delete on public.leads to anon, authenticated;   -- only if they held these before
commit;
```
Leave `public.touch_updated_at()` alone (007 uses it). When `leads` did NOT exist before 017, also `drop table public.leads cascade;` (or just keep it: it is empty and RLS-locked). Instant application-level rollback is `ACADEMY_DATA_BACKEND=storage` (see C.md), which needs no SQL.

## Files

- `fsi/tests/sql/run-local.sh` (runner), `00_bootstrap_supabase.sql` (stand-ins + `t.*` assertion helpers),
  `160_claims.test.sql`, `170_leads.test.sql`, `900_lint.test.sql` (generic, covers new files), `contract-check.mjs`,
  `fixtures/legacy_leads.sql`, `fixtures/make_nonsuper_owner.sql`.
- Edited: `fsi/sql/016_claims_block_group.sql`, `fsi/sql/017_leads_pipeline.sql` (defects above).
- Requirements to run: PostgreSQL server binaries (default `/usr/lib/postgresql/16/bin`, override `PGBIN`), `psql`, `node`. As root it creates the OS user `pgs`.
- Writing a test for 018: add `fsi/tests/sql/180_*.test.sql` with a `-- scenarios: a b c d e` header and use `t.ok / t.eq / t.near / t.throws / t.lives`; 900_lint will already cover its functions, tables and views.
