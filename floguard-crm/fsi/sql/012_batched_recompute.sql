-- 012: disk-safe full-table recompute for the free-tier database.
-- Applied 2026-09-17 as migration batched_recompute.
--
-- Why: a single UPDATE over 313k rows writes a second copy of every row before
-- the old ones can be vacuumed. On 2026-09-17 fsi_recompute_static() hit
-- "could not extend file: No space left on device" (db 732 MB, free tier) and
-- rolled back. Batching by hashtext(parcel_id) % n with VACUUM between batches
-- keeps the peak at one batch. VACUUM cannot run inside a function, so the
-- batches are chained in a pg_cron command (see the bottom of this file).
--
-- Also dropped 2026-09-17 to free 170 MB: parcel_risk_geom_idx, _fsi_live_idx,
-- _city_idx, _impervious_idx (idx_scan = 0; the map API filters lat/lon and
-- PostgREST sorts in memory). Keep pkey, must_have, tract, rain_cell.

-- Static + live for one hash bucket.
create or replace function public.fsi_static_batch(bucket integer, buckets integer default 8, county text default '12127')
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '900s'
as $$
declare n integer; county_d real;
begin
  select d into county_d from public.rainfall_state where county_fips = county;
  county_d := least(greatest(coalesce(county_d, 0.5), 0), 1);
  update public.parcel_risk p
     set fsi_static = s.static,
         fsi_live = round((100.0 * s.static * (0.5 + 0.5 * coalesce(
           (select c.d from public.rainfall_cell c
             where c.cell_id = p.rain_cell and c.observed_at > now() - interval '2 days'),
           county_d)))::numeric, 2),
         updated_at = now()
    from (
      select parcel_id,
             round((0.40 * least(greatest(coalesce(twi_n, 0.55), 0), 1)
                  + 0.25 * (1 - least(greatest(coalesce(hand_n, 0.45), 0), 1))
                  + 0.20 * public.hsg_score(hsg)
                  + 0.15 * public.zone_score(fema_zone))::numeric, 4) as static
        from public.parcel_risk
       where abs(hashtext(parcel_id)) % buckets = bucket
    ) s
   where s.parcel_id = p.parcel_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Cuts once, over all rows; logs a must_have_runs row and returns its id.
create or replace function public.must_have_cuts(
  must_top double precision default 0.03,
  should_top double precision default 0.15,
  maybe_top double precision default 0.40)
returns bigint
language plpgsql security definer
set search_path = public
set statement_timeout = '900s'
as $$
declare n_dial bigint; cut_must real; cut_should real; cut_maybe real; rid bigint;
begin
  with sc as (
    select s.score, s.is_dial
      from public.parcel_risk p
      cross join lateral public.must_have_raw(
        p.fsi_live, p.fsi_static, p.fema_zone, p.hsg, p.claim_heat,
        p.just_value, p.living_area, p.year_built, p.homestead,
        p.impervious_ratio, p.lot_sqft) s
  ), d as (select score from sc where is_dial),
  ranked as (select score, row_number() over (order by score) - 1 as idx, count(*) over () as n from d)
  select max(n),
         max(score) filter (where idx = least(n - 1, greatest(0, floor(n * (1 - must_top))))),
         max(score) filter (where idx = least(n - 1, greatest(0, floor(n * (1 - should_top))))),
         max(score) filter (where idx = least(n - 1, greatest(0, floor(n * (1 - maybe_top)))))
    into n_dial, cut_must, cut_should, cut_maybe
    from ranked;
  if n_dial is null or n_dial = 0 then
    n_dial := 0; cut_must := 100; cut_should := 100; cut_maybe := 100;
  end if;
  insert into public.must_have_runs (dial_eligible, cut_must, cut_should, cut_maybe, rows_changed)
  values (n_dial, cut_must, cut_should, cut_maybe, 0) returning id into rid;
  return rid;
end;
$$;

-- Apply score / reasons / band for one hash bucket using the cuts of run_id.
create or replace function public.must_have_apply_batch(run_id bigint, bucket integer, buckets integer default 8)
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '900s'
as $$
declare r public.must_have_runs%rowtype; n integer;
begin
  select * into r from public.must_have_runs where id = run_id;
  if not found then raise exception 'must_have_runs % not found', run_id; end if;
  update public.parcel_risk p
     set must_have_score   = m.score,
         must_have_reasons = m.reasons,
         must_have_band    = m.band,
         updated_at        = now()
    from (
      select p2.parcel_id, s.score, s.reasons,
             case when not s.is_dial then 'skip'
                  when s.score >= r.cut_must then 'must'
                  when s.score >= r.cut_should then 'should'
                  when s.score >= r.cut_maybe then 'maybe'
                  else 'skip' end as band
        from public.parcel_risk p2
        cross join lateral public.must_have_raw(
          p2.fsi_live, p2.fsi_static, p2.fema_zone, p2.hsg, p2.claim_heat,
          p2.just_value, p2.living_area, p2.year_built, p2.homestead,
          p2.impervious_ratio, p2.lot_sqft) s
       where abs(hashtext(p2.parcel_id)) % buckets = bucket
    ) m
   where m.parcel_id = p.parcel_id
     and (p.must_have_score is distinct from m.score
       or p.must_have_reasons is distinct from m.reasons
       or p.must_have_band is distinct from m.band);
  get diagnostics n = row_count;
  update public.must_have_runs set rows_changed = rows_changed + n where id = run_id;
  return n;
end;
$$;

revoke all on function public.fsi_static_batch(integer, integer, text) from public, anon, authenticated;
revoke all on function public.must_have_cuts(double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.must_have_apply_batch(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.fsi_static_batch(integer, integer, text) to service_role;
grant execute on function public.must_have_cuts(double precision, double precision, double precision) to service_role;
grant execute on function public.must_have_apply_batch(bigint, integer, integer) to service_role;

-- One-off pg_cron command used 2026-09-17 (schedule at a fixed minute, unschedule after success):
--   set statement_timeout = '1800s';
--   vacuum public.parcel_risk;
--   select fsi_static_batch(0); vacuum public.parcel_risk;  ... select fsi_static_batch(7); vacuum public.parcel_risk;
--   select must_have_cuts();
--   select must_have_apply_batch((select max(id) from must_have_runs), 0); vacuum public.parcel_risk; ... bucket 7
-- The daily fsi_daily() job stays as is: its live-only rewrite changes fewer bytes per row
-- and had been fitting; if it starts failing on space, chain fsi_apply_dynamic_cells the same way.
