-- scenarios: a b c d e
-- Behaviour tests for fsi/sql/018_terrain_v2_and_confidence.sql (added by review agent R1).
-- fsi/tests/test_sql_018.py covers the score maths (SQL == Python on 300 inputs); this file covers
-- what that test does not: the bucket hash overflow, the model-version setting guard, apply/clear
-- round trip on parcel_risk, and that every batched function runs for all 8 buckets.
\set ON_ERROR_STOP on
set search_path = "$user", public, extensions;

delete from public.parcel_risk where parcel_id like 'T-TV2-%';

-- 1. abs(hashtext(x)) raises "integer out of range" when hashtext(x) = -2147483648; one such parcel id
--    would fail its whole bucket every night. Every function created after 015 must cast to bigint first.
select t.throws($$select abs((-2147483648)::int)$$, 'out of range', 'premise: abs(int_min) raises');
select t.lives($$select abs((-2147483648)::int::bigint) % 8$$, 'premise: abs(int_min::bigint) is fine');
select t.ok(p.prosrc !~ 'abs\(\s*hashtext\(\s*[a-z0-9_.]+\s*\)\s*\)', 'no int abs(hashtext()) overflow in ' || p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosrc ~ 'hashtext'
   and (p.oid::regprocedure::text not in (select sig from t.baseline_fns)
        or p.proname = 'fsi_static_batch')            -- replaced by 018 (same signature as 012/013)
   and p.proname <> 'leads_assign_legacy_id';  -- advisory-lock key, not a bucket
-- Not covered (pre-existing, outside this branch's SQL): 015 must_have_apply_batch has the same pattern.

-- 2. model version setting
select t.eq(public.fsi_model_version(), 'v1', '018 default model version is v1');
select t.throws($$select public.fsi_set_model_version('v3')$$, 'model version must be v1 or v2', '018 rejects an unknown model version');

-- 3. apply / clear round trip
insert into public.parcel_risk (parcel_id, lat, lon, fema_zone, hsg, twi_n, hand_n, depr_n) values
  ('T-TV2-1', 29.10, -81.10, 'X', 'D', 0.6, 0.3, 0.1),
  ('T-TV2-2', 29.11, -81.11, 'AE', 'B', 0.4, 0.5, 0.0);
select t.eq(public.terrain_v2_apply('[{"parcel_id":"T-TV2-1","twi_v2_n":0.7,"hand_v2_n":0.2,"depr_v2_n":0.3,
  "nbr_rel_m":-0.4,"street_rel_m":-0.2,"hsg_eff":"D","drain_class":"Poorly drained","ksat_um_s":1.5,
  "wt_depth_m":0.5,"fsi_confidence":0.9,"fsi_inputs":{"dem":"3dep_1m"}},
  {"parcel_id":"T-TV2-NOPE","twi_v2_n":0.1}]'::jsonb), 1, '018 apply updates only existing parcels');
select t.ok((select terrain_v2_at is not null and fsi_static_v2 between 0 and 1 and abs(fsi_confidence - 0.9) < 1e-6
               from public.parcel_risk where parcel_id = 'T-TV2-1'), '018 apply sets v2 terms, v2 score and confidence');
select t.ok((select terrain_v2_at is null and fsi_static_v2 is null from public.parcel_risk where parcel_id = 'T-TV2-2'),
            '018 apply leaves other parcels alone');

-- every bucket runs (would raise on an overflowing hash), and v1 stays live while the setting is v1
select t.lives($$select public.fsi_static_batch(b, 8) from generate_series(0, 7) b$$, '018 fsi_static_batch runs for buckets 0..7');
select t.eq((select model_version from public.parcel_risk where parcel_id = 'T-TV2-1'), 'v1', '018 v1 setting keeps model_version v1');
select t.ok((select fsi_static_v2 is not null from public.parcel_risk where parcel_id = 'T-TV2-1'), '018 batch keeps the v2 score for comparison');
select t.lives($$select public.rain_source_use('open_meteo', b, 8) from generate_series(0, 7) b$$, '018 rain_source_use runs for buckets 0..7');

select t.eq((select sum(public.terrain_v2_clear(b, 8)) from generate_series(0, 7) b)::int >= 1, true, '018 clear over all buckets clears the test row');
select t.ok((select terrain_v2_at is null and fsi_static_v2 is null from public.parcel_risk where parcel_id = 'T-TV2-1'), '018 clear resets v2 terms');

-- 4. privileges on the write paths (lint covers EXECUTE generically; spot-check the dangerous ones)
select t.ok(not has_function_privilege('authenticated', 'public.terrain_v2_load_enqueue(text[])', 'execute'),
            '018 terrain_v2_load_enqueue (pg_net fetch) is not callable by authenticated');
select t.ok(not has_function_privilege('anon', 'public.fsi_set_model_version(text)', 'execute'),
            '018 fsi_set_model_version is not callable by anon');

-- restore setting/rows touched (keeps the idempotency comparison of later runs meaningful)
update public.fsi_settings set value = 'open_meteo' where key = 'rain_source';
delete from public.parcel_risk where parcel_id like 'T-TV2-%';

-- 5. Production carries a migration that is not in the repo (rain_fetch_retry_and_freshness) and may
--    have changed rain_fetch_enqueue(). Re-applying 018 must not overwrite a body it does not know.
create temp table _rfe as select pg_get_functiondef('public.rain_fetch_enqueue()'::regprocedure) as def;
create or replace function public.rain_fetch_enqueue() returns bigint language plpgsql security definer
  set search_path = public, extensions as $$ begin return -42; /* production-only change */ end $$;
\i :migdir/018_terrain_v2_and_confidence.sql.:dbname.rewritten.sql
select t.ok((select prosrc ~ 'production-only change' from pg_proc where oid = 'public.rain_fetch_enqueue()'::regprocedure),
            '018 leaves an unknown (production) rain_fetch_enqueue body alone');
do $$ begin execute (select def from _rfe); end $$;
select t.ok((select prosrc ~ 'open_meteo' from pg_proc where oid = 'public.rain_fetch_enqueue()'::regprocedure),
            '018 version restored for the rest of the run');
