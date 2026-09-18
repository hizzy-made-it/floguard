-- 013: closed-basin term. Applied 2026-09-17 as migration depression_term.
--
-- HAND is height above *flowing* drainage. A parcel inside a closed basin
-- (Deltona / DeBary lake pattern) has nowhere for water to go yet reads as high
-- ground. depr_m = filled DEM minus raw DEM at the lot (max of a 3x3 window);
-- depr_n = clamp(depr_m / 1 m). Produced by fsi/pipeline/depression_run.py.
--
-- Static score becomes
--   S = 0.35*TWI_n + 0.20*(1-HAND_n) + 0.10*DEPR_n + 0.20*HSG + 0.15*Z
-- (was 0.40 / 0.25 / – / 0.20 / 0.15). Mirrored in scripts/lib/fsi-score.mjs
-- and fsi/pipeline/config.py.

alter table public.parcel_risk
  add column if not exists depr_m real,
  add column if not exists depr_n real;

create or replace function public.depr_apply(rows jsonb)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  update public.parcel_risk p
     set depr_m = v.depr_m, depr_n = v.depr_n
    from jsonb_to_recordset(rows) as v(parcel_id text, depr_m real, depr_n real)
   where p.parcel_id = v.parcel_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.fsi_static_expr(twi_n real, hand_n real, depr_n real, hsg text, zone text)
returns real language sql immutable
as $$
  select round((
      0.35 * least(greatest(coalesce(twi_n, 0.55), 0), 1)
    + 0.20 * (1 - least(greatest(coalesce(hand_n, 0.45), 0), 1))
    + 0.10 * least(greatest(coalesce(depr_n, 0.0), 0), 1)
    + 0.20 * public.hsg_score(hsg)
    + 0.15 * public.zone_score(zone))::numeric, 4)::real
$$;

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
      select parcel_id, public.fsi_static_expr(twi_n, hand_n, depr_n, hsg, fema_zone) as static
        from public.parcel_risk
       where abs(hashtext(parcel_id)) % buckets = bucket
    ) s
   where s.parcel_id = p.parcel_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.fsi_recompute_static(county text default '12127')
returns jsonb
language plpgsql security definer
set search_path = public
set statement_timeout = '1800s'
as $$
declare n_static integer; n_live integer; run public.must_have_runs%rowtype;
begin
  update public.parcel_risk
     set fsi_static = public.fsi_static_expr(twi_n, hand_n, depr_n, hsg, fema_zone),
         updated_at = now()
   where twi_n is not null or hand_n is not null or depr_n is not null or hsg is not null or fema_zone is not null;
  get diagnostics n_static = row_count;
  n_live := public.fsi_apply_dynamic_cells(county);
  perform public.must_have_rescore();
  select * into run from public.must_have_runs order by id desc limit 1;
  return jsonb_build_object('fsi_static_updated', n_static, 'fsi_live_updated', n_live,
                            'mhs_rows_changed', run.rows_changed,
                            'cuts', jsonb_build_object('must', run.cut_must, 'should', run.cut_should, 'maybe', run.cut_maybe));
end;
$$;

revoke all on function public.depr_apply(jsonb) from public, anon, authenticated;
revoke all on function public.fsi_static_expr(real, real, real, text, text) from public, anon, authenticated;
grant execute on function public.depr_apply(jsonb) to service_role;
