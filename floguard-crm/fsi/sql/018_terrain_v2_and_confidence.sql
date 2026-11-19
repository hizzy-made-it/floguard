-- 018: terrain v2 (1 m LiDAR, hydro-conditioned, polygon zonal), neighbour-relative
-- elevation, SSURGO water table / drainage / ksat, per-parcel confidence, MRMS radar
-- rain cells, and a model-version switch. NOT APPLIED to any database yet.
--
-- Additive and idempotent: every column is `add column if not exists`, every function
-- `create or replace`, settings rows `on conflict do nothing`. Safe to run twice.
--
-- Producer: fsi/pipeline/terrain_v2_run.py -> fsi/data/v2/release/<tag>/parcel_terrain_v2_NN.json
-- Two ways in (mirrors 011):
--   a) python -m pipeline.upload_v2 <dir>          -> PostgREST rpc terrain_v2_apply(rows)
--   b) terrain_v2_load_enqueue(array[...urls...]), then terrain_v2_load_process()  (pg_net)
-- Applying v2 rows changes NO score. fsi_static keeps using v1 until
--   select fsi_set_model_version('v2');
-- and a batched recompute (fsi_static_batch(b) for b in 0..7, vacuum between; see 012).
-- Roll back: select fsi_set_model_version('v1'); then the same batched recompute.
--
-- v2 static (mirrored in fsi/pipeline/config_v2.py; JS mirror still to be written in
-- scripts/lib/fsi-score.mjs -- see docs/handoff/D.md):
--   S2 = 0.20*TWI2_n + 0.15*(1-HAND2_n) + 0.15*DEPR2_n + 0.15*BOWL + 0.10*SOIL2 + 0.10*WT + 0.15*Z

-- ---------------------------------------------------------------------------
-- A. Columns
-- ---------------------------------------------------------------------------
alter table public.parcel_risk
  add column if not exists terrain_v2_at  timestamptz,  -- when v2 terms were loaded; null = no v2 data
  add column if not exists model_version  text,         -- which model produced fsi_static: v1 | v2
  add column if not exists huc12          text,         -- watershed (WBD HUC12) the lot was processed in
  add column if not exists dem_res_m      real,         -- 1 (LiDAR) or 10 (3DEP 1/3 arc-second fallback)
  add column if not exists dem_1m_frac    real,         -- share of the lot covered by 1 m LiDAR, 0-1
  add column if not exists geom_mode      text,         -- polygon | polygon_partial | centroid
  add column if not exists yard_only      boolean,      -- building footprint excluded from the stats
  add column if not exists lot_area_m2    real,         -- area actually measured (yard if yard_only)
  add column if not exists elev_p10_m     real,         -- 10th pct ground elevation on the lot, m NAVD88
  add column if not exists elev_med_m     real,         -- median ground elevation on the lot, m NAVD88
  add column if not exists twi_max        real,         -- max TWI on the lot (cells >= half inside)
  add column if not exists twi_awm        real,         -- area-weighted mean TWI
  add column if not exists twi_v2_n       real,         -- twi_awm, 2-98 pct county normalised, 0-1
  add column if not exists hand_min_m     real,         -- min HAND on the lot, m (can be < 0: below its drain)
  add column if not exists hand_v2_n      real,         -- hand_min_m, 2-98 pct county normalised, 0-1
  add column if not exists depr_max_m     real,         -- deepest closed-basin depth on the lot, m (un-breached DEM)
  add column if not exists depr_frac      real,         -- share of the lot inside a depression >= 10 cm, 0-1
  add column if not exists depr_v2_n      real,         -- 0.6*min(depr_max_m/1m,1) + 0.4*depr_frac, 0-1
  add column if not exists nbr_rel_m      real,         -- lot median - median of neighbour lots within 30 m (neg = bowl)
  add column if not exists nbr_count      integer,      -- neighbour lots used
  add column if not exists street_rel_m   real,         -- lot median - adjacent street centreline median (neg = below road)
  add column if not exists hsg_eff        text,         -- effective hydrologic group, dual A/D etc. resolved to D
  add column if not exists hsg_dual       boolean,      -- SSURGO group was dual (A/D, B/D, C/D)
  add column if not exists drain_class    text,         -- SSURGO drainage class (dominant by area)
  add column if not exists ksat_um_s      real,         -- slowest-layer ksat in top 100 cm, um/s
  add column if not exists wt_depth_m     real,         -- SSURGO annual min water table depth, m (2.0 = none in 200 cm)
  add column if not exists soil_cov       real,         -- share of the lot with SSURGO data, 0-1
  add column if not exists fsi_static_v2  real,         -- v2 static score, always computed when v2 terms exist, 0-1
  add column if not exists fsi_confidence real,         -- input-quality confidence 0-1 (not a flood probability)
  add column if not exists fsi_inputs     jsonb,        -- provenance: dem, geom, conditioning, soil, agreement...
  add column if not exists mrms_cell      text;         -- NOAA MRMS 0.01 deg cell, 'm<row>_<col>'

alter table public.rainfall_cell
  add column if not exists source   text not null default 'open_meteo',  -- open_meteo | mrms
  add column if not exists rain_72h real;                                -- mm, MRMS only

alter table public.lead_outcomes
  add column if not exists depr_n_at          real,
  add column if not exists fsi_static_v2_at   real,
  add column if not exists fsi_confidence_at  real,
  add column if not exists model_version_at   text;

-- ---------------------------------------------------------------------------
-- B. Settings
-- ---------------------------------------------------------------------------
create table if not exists public.fsi_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.fsi_settings enable row level security;
revoke all on table public.fsi_settings from anon, authenticated;
grant select, insert, update, delete on table public.fsi_settings to service_role;
insert into public.fsi_settings (key, value) values ('fsi_model_version', 'v1') on conflict (key) do nothing;
insert into public.fsi_settings (key, value) values ('rain_source', 'open_meteo') on conflict (key) do nothing;

create or replace function public.fsi_model_version()
returns text language sql stable
set search_path = public
as $$ select coalesce((select value from public.fsi_settings where key = 'fsi_model_version'), 'v1') $$;

create or replace function public.fsi_set_model_version(v text)
returns text
language plpgsql security definer
set search_path = public
as $$
begin
  if v not in ('v1', 'v2') then raise exception 'model version must be v1 or v2, got %', v; end if;
  insert into public.fsi_settings (key, value, updated_at) values ('fsi_model_version', v, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;  -- scores change only after the batched recompute (fsi_static_batch)
end;
$$;

-- ---------------------------------------------------------------------------
-- C. v2 term scores and static expression (mirror: fsi/pipeline/config_v2.py)
-- ---------------------------------------------------------------------------
create or replace function public.drain_class_score(dc text)
returns real language sql immutable
as $$
  select case upper(trim(coalesce(dc, '')))
    when 'VERY POORLY DRAINED' then 1.0
    when 'POORLY DRAINED' then 0.85
    when 'SOMEWHAT POORLY DRAINED' then 0.65
    when 'MODERATELY WELL DRAINED' then 0.4
    when 'WELL DRAINED' then 0.2
    when 'SOMEWHAT EXCESSIVELY DRAINED' then 0.1
    when 'EXCESSIVELY DRAINED' then 0.05
    else null end::real
$$;

-- ksat um/s: <= 1 -> 1.0 (water stays), >= 100 -> 0.0 (sand drains); log-linear between.
create or replace function public.ksat_score(k real)
returns real language sql immutable
as $$
  select case when k is null then null
              when k <= 0 then 1.0
              else least(greatest((2.0 - log(k::double precision)) / 2.0, 0), 1) end::real
$$;

-- Mean of whichever of {effective HSG, drainage class, ksat} exist; 0.55 when none.
create or replace function public.soil_score_v2(hsg_eff text, dc text, k real)
returns real language sql immutable
as $$
  select coalesce(avg(v), 0.55)::real from (values
    (case when upper(trim(coalesce(hsg_eff, ''))) in ('A', 'B', 'C', 'D') then public.hsg_score(hsg_eff) end),
    (public.drain_class_score(dc)),
    (public.ksat_score(k))) t(v)
$$;

-- Bowl among neighbours: 0.6 m below the surroundings is the top of the scale.
create or replace function public.bowl_score(nbr_rel real, street_rel real)
returns real language sql immutable
as $$
  select (case
    when nbr_rel is not null and street_rel is not null
      then least(greatest(-(0.6 * nbr_rel + 0.4 * street_rel) / 0.6, 0), 1)
    when nbr_rel is not null then least(greatest(-nbr_rel / 0.6, 0), 1)
    when street_rel is not null then least(greatest(-street_rel / 0.6, 0), 1)
    else 0.2 end)::real
$$;

-- Seasonal high water table: 0 m -> 1, >= 2 m -> 0; unknown 0.5.
create or replace function public.wt_score(wt real)
returns real language sql immutable
as $$
  select (case when wt is null then 0.5 else least(greatest(1 - wt / 2.0, 0), 1) end)::real
$$;

create or replace function public.fsi_static_v2_expr(
  twi_n real, hand_n real, depr_n real, nbr_rel real, street_rel real,
  hsg_eff text, dc text, ksat real, wt real, zone text)
returns real language sql immutable
as $$
  select round((
      0.20 * least(greatest(coalesce(twi_n, 0.55), 0), 1)
    + 0.15 * (1 - least(greatest(coalesce(hand_n, 0.45), 0), 1))
    + 0.15 * least(greatest(coalesce(depr_n, 0.0), 0), 1)
    + 0.15 * public.bowl_score(nbr_rel, street_rel)
    + 0.10 * public.soil_score_v2(hsg_eff, dc, ksat)
    + 0.10 * public.wt_score(wt)
    + 0.15 * public.zone_score(zone))::numeric, 4)::real
$$;

-- v2 static for a stored row; null when the row has no v2 terms.
create or replace function public.fsi_static_v2_of(p public.parcel_risk)
returns real language sql stable
as $$
  select case when p.terrain_v2_at is null then null else public.fsi_static_v2_expr(
    p.twi_v2_n, p.hand_v2_n, p.depr_v2_n, p.nbr_rel_m, p.street_rel_m,
    p.hsg_eff, p.drain_class, p.ksat_um_s, p.wt_depth_m, p.fema_zone) end
$$;

-- The one place that decides which static score a row gets. v1 unless the setting
-- says v2 AND the row has v2 terms; with version 'v1' this is exactly
-- fsi_static_expr() (sql/014), so applying 018 alone changes no score.
create or replace function public.fsi_static_dispatch(version text, p public.parcel_risk)
returns real language sql stable
as $$
  select case
    when version = 'v2' and p.terrain_v2_at is not null then public.fsi_static_v2_of(p)
    else public.fsi_static_expr(p.twi_n, p.hand_n, p.depr_n, p.hsg, p.fema_zone) end
$$;

-- ---------------------------------------------------------------------------
-- D. Recompute paths now go through the dispatcher (same signatures as 012/013)
-- ---------------------------------------------------------------------------
create or replace function public.fsi_static_batch(bucket integer, buckets integer default 8, county text default '12127')
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '900s'
as $$
declare n integer; county_d real; ver text := public.fsi_model_version();
begin
  select d into county_d from public.rainfall_state where county_fips = county;
  county_d := least(greatest(coalesce(county_d, 0.5), 0), 1);
  update public.parcel_risk p
     set fsi_static = s.static,
         fsi_static_v2 = s.static_v2,
         model_version = s.mv,
         fsi_live = round((100.0 * s.static * (0.5 + 0.5 * coalesce(
           (select c.d from public.rainfall_cell c
             where c.cell_id = p.rain_cell and c.observed_at > now() - interval '2 days'),
           county_d)))::numeric, 2),
         updated_at = now()
    from (
      select r.parcel_id,
             public.fsi_static_dispatch(ver, r) as static,
             public.fsi_static_v2_of(r) as static_v2,
             case when ver = 'v2' and r.terrain_v2_at is not null then 'v2' else 'v1' end as mv
        from public.parcel_risk r
       where abs(hashtext(r.parcel_id)) % buckets = bucket
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
declare n_static integer; n_live integer; run public.must_have_runs%rowtype; ver text := public.fsi_model_version();
begin
  update public.parcel_risk p
     set fsi_static = public.fsi_static_dispatch(ver, p),
         fsi_static_v2 = public.fsi_static_v2_of(p),
         model_version = case when ver = 'v2' and p.terrain_v2_at is not null then 'v2' else 'v1' end,
         updated_at = now()
   where p.twi_n is not null or p.hand_n is not null or p.depr_n is not null or p.hsg is not null
      or p.fema_zone is not null or p.terrain_v2_at is not null;
  get diagnostics n_static = row_count;
  n_live := public.fsi_apply_dynamic_cells(county);
  perform public.must_have_rescore();
  select * into run from public.must_have_runs order by id desc limit 1;
  return jsonb_build_object('model_version', ver, 'fsi_static_updated', n_static, 'fsi_live_updated', n_live,
                            'mhs_rows_changed', run.rows_changed,
                            'cuts', jsonb_build_object('must', run.cut_must, 'should', run.cut_should, 'maybe', run.cut_maybe));
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Load v2 rows (batched apply, like terrain_apply in 011)
-- ---------------------------------------------------------------------------
create or replace function public.terrain_v2_apply(rows jsonb)
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare n integer;
begin
  update public.parcel_risk p
     set huc12 = v.huc12, dem_res_m = v.dem_res_m, dem_1m_frac = v.dem_1m_frac,
         geom_mode = v.geom_mode, yard_only = v.yard_only, lot_area_m2 = v.lot_area_m2,
         elev_p10_m = v.elev_p10_m, elev_med_m = v.elev_med_m,
         twi_max = v.twi_max, twi_awm = v.twi_awm, twi_v2_n = v.twi_v2_n,
         hand_min_m = v.hand_min_m, hand_v2_n = v.hand_v2_n,
         depr_max_m = v.depr_max_m, depr_frac = v.depr_frac, depr_v2_n = v.depr_v2_n,
         nbr_rel_m = v.nbr_rel_m, nbr_count = v.nbr_count, street_rel_m = v.street_rel_m,
         hsg_eff = v.hsg_eff, hsg_dual = v.hsg_dual, drain_class = v.drain_class,
         ksat_um_s = v.ksat_um_s, wt_depth_m = v.wt_depth_m, soil_cov = v.soil_cov,
         fsi_confidence = v.fsi_confidence, fsi_inputs = v.fsi_inputs,
         fsi_static_v2 = public.fsi_static_v2_expr(v.twi_v2_n, v.hand_v2_n, v.depr_v2_n, v.nbr_rel_m,
           v.street_rel_m, v.hsg_eff, v.drain_class, v.ksat_um_s, v.wt_depth_m, p.fema_zone),
         terrain_v2_at = now()
    from jsonb_to_recordset(rows) as v(
      parcel_id text, huc12 text, dem_res_m real, dem_1m_frac real, geom_mode text, yard_only boolean,
      lot_area_m2 real, elev_p10_m real, elev_med_m real, twi_max real, twi_awm real, twi_v2_n real,
      hand_min_m real, hand_v2_n real, depr_max_m real, depr_frac real, depr_v2_n real,
      nbr_rel_m real, nbr_count integer, street_rel_m real, hsg_eff text, hsg_dual boolean,
      drain_class text, ksat_um_s real, wt_depth_m real, soil_cov real,
      fsi_confidence real, fsi_inputs jsonb)
   where p.parcel_id = v.parcel_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Clear v2 terms (full rollback of the data, not just the switch).
create or replace function public.terrain_v2_clear(bucket integer, buckets integer default 8)
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '900s'
as $$
declare n integer;
begin
  update public.parcel_risk
     set terrain_v2_at = null, fsi_static_v2 = null
   where terrain_v2_at is not null and abs(hashtext(parcel_id)) % buckets = bucket;
  get diagnostics n = row_count;
  return n;
end;
$$;

create table if not exists public.terrain_v2_load_queue (
  req_id       bigint primary key,
  url          text not null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  status_code  integer,
  n_rows       integer,
  error        text
);
alter table public.terrain_v2_load_queue enable row level security;
revoke all on table public.terrain_v2_load_queue from anon, authenticated;
grant select, insert, update, delete on table public.terrain_v2_load_queue to service_role;

create or replace function public.terrain_v2_load_enqueue(urls text[])
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare u text; rid bigint; c int := 0;
begin
  foreach u in array urls loop
    rid := net.http_get(u, timeout_milliseconds := 120000);
    insert into public.terrain_v2_load_queue (req_id, url) values (rid, u);
    c := c + 1;
  end loop;
  return c;
end;
$$;

create or replace function public.terrain_v2_load_process()
returns table(processed integer, rows_applied integer, pending integer, failed integer)
language plpgsql security definer
set search_path = public, extensions
set statement_timeout = '900s'
as $$
declare q record; n int; c_proc int := 0; c_rows int := 0;
begin
  for q in
    select tq.req_id, r.status_code, r.content, r.error_msg, r.timed_out
      from public.terrain_v2_load_queue tq
      join net._http_response r on r.id = tq.req_id
     where tq.processed_at is null
     order by tq.requested_at
  loop
    begin
      if q.status_code = 200 and q.content is not null then
        n := public.terrain_v2_apply(q.content::jsonb);
        update public.terrain_v2_load_queue set processed_at = now(), status_code = 200, n_rows = n where req_id = q.req_id;
        c_rows := c_rows + n;
      else
        update public.terrain_v2_load_queue set processed_at = now(), status_code = q.status_code,
               error = coalesce(q.error_msg, 'timeout=' || q.timed_out::text) where req_id = q.req_id;
      end if;
    exception when others then
      update public.terrain_v2_load_queue set processed_at = now(), error = sqlerrm where req_id = q.req_id;
    end;
    delete from net._http_response where id = q.req_id;
    c_proc := c_proc + 1;
  end loop;
  return query select c_proc, c_rows,
    (select count(*)::int from public.terrain_v2_load_queue where processed_at is null),
    (select count(*)::int from public.terrain_v2_load_queue where error is not null);
end;
$$;

-- ---------------------------------------------------------------------------
-- F. MRMS radar rain cells (fsi/pipeline/rainfall.py refresh_cells_mrms writes them)
-- ---------------------------------------------------------------------------
-- Same arithmetic as rainfall.mrms_index(): grid edge 130 W / 55 N, 0.01 deg.
create or replace function public.mrms_cell_id(lat double precision, lon double precision)
returns text language sql immutable
as $$
  select case when lat is null or lon is null then null
    else 'm' || floor((55.0 - lat) / 0.01)::int || '_' || floor((lon + 130.0) / 0.01)::int end
$$;

create or replace function public.mrms_cells_seed()
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare n integer;
begin
  update public.parcel_risk
     set mrms_cell = public.mrms_cell_id(lat, lon)
   where lat is not null and lon is not null
     and mrms_cell is distinct from public.mrms_cell_id(lat, lon);
  insert into public.rainfall_cell (cell_id, lat, lon, source)
  select c,
         55.0 - (split_part(substr(c, 2), '_', 1)::int + 0.5) * 0.01,
         -130.0 + (split_part(substr(c, 2), '_', 2)::int + 0.5) * 0.01,
         'mrms'
    from (select distinct mrms_cell as c from public.parcel_risk where mrms_cell is not null) s
  on conflict (cell_id) do nothing;
  select count(*) into n from public.rainfall_cell where source = 'mrms';
  return n;
end;
$$;

-- Point parcels at MRMS cells or back at the Open-Meteo 0.05 deg cells (sql/009).
-- Batched by hash bucket like 012 (free-tier disk); call for bucket 0..buckets-1.
create or replace function public.rain_source_use(src text, bucket integer, buckets integer default 8)
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '900s'
as $$
declare n integer;
begin
  if src not in ('mrms', 'open_meteo') then raise exception 'rain source must be mrms or open_meteo'; end if;
  if src = 'mrms' then
    update public.parcel_risk
       set rain_cell = mrms_cell
     where mrms_cell is not null and rain_cell is distinct from mrms_cell
       and abs(hashtext(parcel_id)) % buckets = bucket;
  else
    update public.parcel_risk
       set rain_cell = floor(lat / 0.05)::int || '_' || floor(lon / 0.05)::int
     where lat is not null and lon is not null
       and rain_cell is distinct from (floor(lat / 0.05)::int || '_' || floor(lon / 0.05)::int)
       and abs(hashtext(parcel_id)) % buckets = bucket;
  end if;
  get diagnostics n = row_count;
  insert into public.fsi_settings (key, value, updated_at) values ('rain_source', src, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return n;
end;
$$;

-- sql/009 fetched every rainfall_cell from Open-Meteo; MRMS cells must not be sent there.
create or replace function public.rain_fetch_enqueue()
returns bigint
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  ids text[]; lats text; lons text; url text; rid bigint;
begin
  select array_agg(cell_id order by cell_id),
         string_agg(round(lat::numeric, 3)::text, ',' order by cell_id),
         string_agg(round(lon::numeric, 3)::text, ',' order by cell_id)
    into ids, lats, lons
    from public.rainfall_cell
   where source = 'open_meteo';
  if ids is null then
    raise exception 'rainfall_cell has no open_meteo cells — run rain_cells_seed() first';
  end if;
  url := 'https://api.open-meteo.com/v1/forecast?latitude=' || lats || '&longitude=' || lons
      || '&daily=precipitation_sum&past_days=14&forecast_days=1&timezone=America%2FNew_York';
  rid := net.http_get(url, timeout_milliseconds := 60000);
  insert into public.rain_fetch_queue (req_id, cell_ids) values (rid, ids);
  return rid;
end;
$$;

-- ---------------------------------------------------------------------------
-- G. Outcome snapshots also freeze the v2 inputs (calibration needs them)
-- ---------------------------------------------------------------------------
create or replace function public.lead_outcomes_snapshot()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  p public.parcel_risk%rowtype;
  rs public.rainfall_state%rowtype;
begin
  new.updated_at := now();
  if new.parcel_id is not null then
    select * into p from public.parcel_risk where parcel_id = new.parcel_id;
    if found then
      new.fsi_live_at        := p.fsi_live;
      new.fsi_static_at      := p.fsi_static;
      new.must_have_score_at := p.must_have_score;
      new.must_have_band_at  := p.must_have_band;
      new.fema_zone_at       := p.fema_zone;
      new.hsg_at             := p.hsg;
      new.claim_heat_at      := p.claim_heat;
      new.twi_n_at           := p.twi_n;
      new.hand_n_at          := p.hand_n;
      new.depr_n_at          := p.depr_n;
      new.fsi_static_v2_at   := p.fsi_static_v2;
      new.fsi_confidence_at  := p.fsi_confidence;
      new.model_version_at   := p.model_version;
      if new.address is null then new.address := p.address; end if;
      if new.city is null then new.city := p.city; end if;
      if new.zip is null then new.zip := p.zip; end if;
    end if;
  end if;
  if p.rain_cell is not null then
    select rain_24h, api_value into new.rain_24h_at, new.api_at
      from public.rainfall_cell
     where cell_id = p.rain_cell and observed_at > now() - interval '2 days';
  end if;
  if new.rain_24h_at is null then
    select * into rs from public.rainfall_state where county_fips = '12127';
    if found then
      new.rain_24h_at := rs.rain_24h;
      new.api_at      := rs.api_value;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- H. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.fsi_set_model_version(text) from public, anon, authenticated;
revoke all on function public.terrain_v2_apply(jsonb) from public, anon, authenticated;
revoke all on function public.terrain_v2_clear(integer, integer) from public, anon, authenticated;
revoke all on function public.terrain_v2_load_enqueue(text[]) from public, anon, authenticated;
revoke all on function public.terrain_v2_load_process() from public, anon, authenticated;
revoke all on function public.mrms_cells_seed() from public, anon, authenticated;
revoke all on function public.rain_source_use(text, integer, integer) from public, anon, authenticated;
revoke all on function public.fsi_static_batch(integer, integer, text) from public, anon, authenticated;
revoke all on function public.fsi_recompute_static(text) from public, anon, authenticated;
revoke all on function public.rain_fetch_enqueue() from public, anon, authenticated;
grant execute on function public.fsi_set_model_version(text) to service_role;
grant execute on function public.terrain_v2_apply(jsonb) to service_role;
grant execute on function public.terrain_v2_clear(integer, integer) to service_role;
grant execute on function public.terrain_v2_load_enqueue(text[]) to service_role;
grant execute on function public.terrain_v2_load_process() to service_role;
grant execute on function public.mrms_cells_seed() to service_role;
grant execute on function public.rain_source_use(text, integer, integer) to service_role;
grant execute on function public.fsi_static_batch(integer, integer, text) to service_role;
grant execute on function public.fsi_recompute_static(text) to service_role;
grant execute on function public.rain_fetch_enqueue() to service_role;

-- ---------------------------------------------------------------------------
-- Hardening (found by fsi/tests/sql/900_lint.test.sql): pin search_path on the
-- helper functions and remove the default EXECUTE that Supabase grants to
-- anon/authenticated. Idempotent; skips any signature that is absent.
-- ---------------------------------------------------------------------------
do $$
declare
  sig text;
  fn  regprocedure;
begin
  foreach sig in array array[
    'public.wt_score(real)',
    'public.soil_score_v2(text,text,real)',
    'public.mrms_cell_id(double precision,double precision)',
    'public.ksat_score(real)',
    'public.fsi_static_v2_of(public.parcel_risk)',
    'public.fsi_static_v2_expr(real,real,real,real,real,text,text,real,real,text)',
    'public.fsi_static_dispatch(text,public.parcel_risk)',
    'public.fsi_model_version()',
    'public.drain_class_score(text)',
    'public.bowl_score(real,real)'
  ] loop
    fn := to_regprocedure(sig);
    if fn is null then continue; end if;
    execute format('alter function %s set search_path = public, extensions', fn);
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
