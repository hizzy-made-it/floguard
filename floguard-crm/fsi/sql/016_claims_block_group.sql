-- 016: NFIP claims at census block-group grain, by flood-zone class and by storm event.
-- Additive + idempotent. DO NOT apply from an agent; run in the SQL editor on the floguard project.
--
-- Why: OpenFEMA redacts claim lat/long to 0.1 degree, so the old 0.02 degree grid (and its
-- distance falloff) was false precision. Each v3 claim carries `censusGeoid` (12-digit block-group
-- FIPS = state 2 + county 3 + tract 6 + block group 1). Block group is the finest honest grain.
--
-- Compliance (unchanged): these are NEIGHBOURHOOD aggregates. Never a personal claim flag, never
-- "this owner filed a claim", never insurance advice.
--
-- Contents
--   1. nfip_claim_block_group   one row per Census-2020 block group in Volusia (zero-claim rows too)
--   2. nfip_claim_event         block group x storm event x year
--   3. parcel_risk additions    block_group + claim_bg_* neighbourhood columns
--   4. functions                nfip_weighted_count, nfip_recompute_block_group_heat,
--                               nfip_claim_bg_build_geom, nfip_apply_block_group_claims,
--                               nfip_claim_event_list
--
-- Apply order: 004 (tract table), 015 (must_have_raw), then this file. Then run
-- `node scripts/ingest-nfip-claims.mjs` and `node scripts/score-must-have.mjs`.
-- scripts/join-census-tracts.mjs repaints claim_heat from the tract table for every parcel and then
-- calls nfip_apply_block_group_claims itself (review R1), so it and the claims ingest can run in either order.

-- ---------------------------------------------------------------------------
-- 1. Block-group aggregates
-- ---------------------------------------------------------------------------
create table if not exists public.nfip_claim_block_group (
  block_group        text primary key,                 -- 12-digit GEOID
  tract              text,                             -- first 11 digits
  vintage            smallint not null default 2020,   -- polygon vintage the FIPS was matched against
  housing_units      integer,                          -- Census 2020 HU100; null when unknown

  claim_count_all    integer not null default 0,
  claim_count_10y    integer not null default 0,       -- loss year >= current year - 9
  claim_count_5y     integer not null default 0,       -- loss year >= current year - 4
  claim_last_year    integer,
  paid_total_10y     real    not null default 0,       -- building + contents paid, negatives clamped to 0
  median_water_depth real,                             -- inches, 10y window, claims with depth > 0 only

  -- Zone class split. sfha = rated/current zone A* or V*; zone_x = X, B, C, shaded X;
  -- other = D, blank or unparseable. Zone X claims outside the SFHA are the drainage signal.
  claim_sfha_all     integer not null default 0,
  claim_zone_x_all   integer not null default 0,
  claim_other_all    integer not null default 0,
  claim_sfha_10y     integer not null default 0,
  claim_zone_x_10y   integer not null default 0,
  claim_other_10y    integer not null default 0,

  -- Claims per housing unit over the 10y window (a fraction, not per-1000). Null when housing_units unknown.
  claim_rate_10y        real,
  claim_rate_zone_x_10y real,

  heat               real not null default 0,          -- 0-1, see nfip_weighted_count()
  top_event          text,                             -- e.g. 'Hurricane Ian (2022)' (10y window, named events only)
  top_event_claims   integer,

  centroid_lat       double precision,
  centroid_lon       double precision,
  bbox_w             double precision,
  bbox_s             double precision,
  bbox_e             double precision,
  bbox_n             double precision,
  geom_geojson       jsonb,                            -- generalised polygon for the map layer (written by the ingest)
  geom               extensions.geometry(MultiPolygon, 4326), -- built from geom_geojson by nfip_claim_bg_build_geom()

  updated_at         timestamptz not null default now()
);

create index if not exists nfip_claim_bg_tract_idx on public.nfip_claim_block_group (tract);
create index if not exists nfip_claim_bg_bbox_idx
  on public.nfip_claim_block_group (bbox_w, bbox_e, bbox_s, bbox_n);
create index if not exists nfip_claim_bg_geom_idx on public.nfip_claim_block_group using gist (geom);

alter table public.nfip_claim_block_group enable row level security;
revoke all on table public.nfip_claim_block_group from anon, authenticated;
grant select, insert, update, delete on table public.nfip_claim_block_group to service_role;

comment on table public.nfip_claim_block_group is
  'OpenFEMA NFIP v3 claims aggregated to Census-2020 block group. Neighbourhood aggregate only; never implies a named owner filed a claim.';

-- ---------------------------------------------------------------------------
-- 2. Block group x event
-- ---------------------------------------------------------------------------
-- event_key is floodEvent (name) when present, else eventDesignationNumber, else 'unnamed-<year>'.
create table if not exists public.nfip_claim_event (
  block_group       text not null,
  event_key         text not null,
  event_year        integer not null,
  event_name        text,                -- floodEvent, e.g. 'Hurricane Ian'
  event_designation text,                -- eventDesignationNumber, e.g. 'FL0222' (null before ~2020 events)
  claim_count       integer not null default 0,
  paid_total        real not null default 0,
  sfha_count        integer not null default 0,
  zone_x_count      integer not null default 0,
  other_count       integer not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (block_group, event_key, event_year)
);

create index if not exists nfip_claim_event_key_idx on public.nfip_claim_event (event_key, event_year);

alter table public.nfip_claim_event enable row level security;
revoke all on table public.nfip_claim_event from anon, authenticated;
grant select, insert, update, delete on table public.nfip_claim_event to service_role;

comment on table public.nfip_claim_event is
  'NFIP claims per block group per storm event (OpenFEMA floodEvent / eventDesignationNumber). Neighbourhood aggregate only.';

-- ---------------------------------------------------------------------------
-- 3. parcel_risk additions
-- ---------------------------------------------------------------------------
alter table public.parcel_risk add column if not exists block_group text;           -- 12-digit, point-in-polygon on parcel lat/lon
alter table public.parcel_risk add column if not exists claim_bg_count_10y integer;
alter table public.parcel_risk add column if not exists claim_bg_zone_x_10y integer;
alter table public.parcel_risk add column if not exists claim_bg_rate real;         -- claims per housing unit, 10y (fraction)
alter table public.parcel_risk add column if not exists claim_bg_last_year integer;
alter table public.parcel_risk add column if not exists claim_bg_top_event text;

create index if not exists parcel_risk_block_group_idx on public.parcel_risk (block_group);

-- ---------------------------------------------------------------------------
-- 4. Functions
-- ---------------------------------------------------------------------------

-- claim_heat weighting.
--   weighted = 1.0 * sfha_10y + 2.0 * zone_x_10y + 1.0 * other_10y
--   heat     = least(1, ln(1 + weighted) / ln(1 + ref)),   ref = greatest(5, p95 of weighted over block groups with weighted > 0)
--
-- Why zone X counts double: a claim from a property outside the mapped flood hazard area is the
-- sign of a drainage/ponding problem, which is what FloGuard sells. SFHA claims are expected
-- (the structure is mapped as flood-prone and usually insured); a zone X claim is not. The p95
-- reference replaces the old county maximum so one outlier block group no longer flattens the rest.
-- must_have_raw() in 015 is untouched: it still takes p_claim_heat and applies its own 0.12 / 0.33 weights.
-- Mirrored in scripts/lib/claims.mjs (ZONE_X_WEIGHT, computeHeatRef, heatFor).
create or replace function public.nfip_weighted_count(p_sfha integer, p_zone_x integer, p_other integer)
returns double precision
language sql immutable
set search_path = public
as $$
  select 1.0 * coalesce(p_sfha, 0) + 2.0 * coalesce(p_zone_x, 0) + 1.0 * coalesce(p_other, 0)
$$;

-- Recompute per-housing-unit rates and heat on every block-group row from the stored counts.
-- Safe to run after backfilling housing_units or after hand edits. Returns rows touched.
create or replace function public.nfip_recompute_block_group_heat()
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '300s'
as $function$
declare
  ref double precision;
  n integer;
begin
  select greatest(5, coalesce(
           percentile_cont(0.95) within group (order by w), 0))
    into ref
    from (select public.nfip_weighted_count(claim_sfha_10y, claim_zone_x_10y, claim_other_10y) as w
            from public.nfip_claim_block_group) s
   where w > 0;
  ref := coalesce(ref, 5);

  update public.nfip_claim_block_group b
     set claim_rate_10y = case when b.housing_units > 0
                               then b.claim_count_10y::real / b.housing_units end,
         claim_rate_zone_x_10y = case when b.housing_units > 0
                               then b.claim_zone_x_10y::real / b.housing_units end,
         heat = least(1, ln(1 + public.nfip_weighted_count(b.claim_sfha_10y, b.claim_zone_x_10y, b.claim_other_10y))
                         / ln(1 + ref)),
         updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- Build the PostGIS geometry column from the generalised GeoJSON the ingest uploads.
create or replace function public.nfip_claim_bg_build_geom()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare n integer;
begin
  update public.nfip_claim_block_group
     set geom = st_multi(st_setsrid(st_geomfromgeojson(geom_geojson::text), 4326))
   where geom_geojson is not null;
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- (Re)apply block-group aggregates onto parcels by parcel_risk.block_group, and recompute claim_heat.
--   * Parcels whose block_group exists in nfip_claim_block_group: claim_bg_* and claim_heat come from the
--     block group (claim_count_10y / claim_paid_sum / claim_last_year are also set from it so existing
--     readers stay consistent). Zero-claim block groups give heat 0: that is real information.
--   * Other parcels (no block_group, e.g. outside the 2020 polygons): claim_heat falls back to the tract
--     table (nfip_claim_tract.heat) via parcel_risk.census_tract; claim_bg_* are cleared.
-- Bucketed like 012/must_have_apply_batch so each call stays inside the statement timeout:
--   select nfip_apply_block_group_claims(8, 0); ... (8, 7);   -- or (1, 0) for everything
create or replace function public.nfip_apply_block_group_claims(
  p_buckets integer default 1,
  p_bucket integer default 0)
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '900s'
as $function$
declare n integer; n2 integer;
begin
  if p_buckets < 1 or p_bucket < 0 or p_bucket >= p_buckets then
    raise exception 'bad bucket % of %', p_bucket, p_buckets;
  end if;

  -- 1. Block-group grain.
  update public.parcel_risk p
     set claim_bg_count_10y   = b.claim_count_10y,
         claim_bg_zone_x_10y  = b.claim_zone_x_10y,
         claim_bg_rate        = b.claim_rate_10y,
         claim_bg_last_year   = b.claim_last_year,
         claim_bg_top_event   = b.top_event,
         claim_heat           = b.heat,
         claim_count_10y      = b.claim_count_10y,
         claim_paid_sum       = b.paid_total_10y,
         claim_last_year      = b.claim_last_year,
         updated_at           = now()
    from public.nfip_claim_block_group b
   where b.block_group = p.block_group
     and abs(hashtext(p.parcel_id)::bigint) % p_buckets = p_bucket
     and (p.claim_heat is distinct from b.heat
       or p.claim_bg_count_10y is distinct from b.claim_count_10y
       or p.claim_bg_zone_x_10y is distinct from b.claim_zone_x_10y
       or p.claim_bg_rate is distinct from b.claim_rate_10y
       or p.claim_bg_last_year is distinct from b.claim_last_year
       or p.claim_bg_top_event is distinct from b.top_event
       or p.claim_count_10y is distinct from b.claim_count_10y
       or p.claim_paid_sum is distinct from b.paid_total_10y
       or p.claim_last_year is distinct from b.claim_last_year);
  get diagnostics n = row_count;

  -- 2. Tract fallback for parcels without a block-group row.
  update public.parcel_risk p
     set claim_bg_count_10y   = null,
         claim_bg_zone_x_10y  = null,
         claim_bg_rate        = null,
         claim_bg_last_year   = null,
         claim_bg_top_event   = null,
         claim_heat           = t.heat,
         claim_count_10y      = t.claim_count_10y,
         claim_paid_sum       = t.paid_sum,
         claim_last_year      = t.last_loss_year,
         updated_at           = now()
    from public.nfip_claim_tract t
   where t.census_tract = p.census_tract
     and not exists (select 1 from public.nfip_claim_block_group b where b.block_group = p.block_group)
     and abs(hashtext(p.parcel_id)::bigint) % p_buckets = p_bucket
     and (p.claim_heat is distinct from t.heat
       or p.claim_bg_count_10y is not null
       or p.claim_count_10y is distinct from t.claim_count_10y);
  get diagnostics n2 = row_count;

  return n + n2;
end;
$function$;

-- Event list for the map filter chips: one row per (event, year) across the county.
create or replace function public.nfip_claim_event_list(p_min_claims integer default 25)
returns table(
  event_key text, event_name text, event_designation text, event_year integer,
  total_claims bigint, zone_x_claims bigint, sfha_claims bigint,
  paid_total double precision, block_groups bigint, is_named boolean)
language sql stable security definer
set search_path = public
as $$
  select e.event_key,
         max(e.event_name),
         max(e.event_designation),
         e.event_year,
         sum(e.claim_count)::bigint,
         sum(e.zone_x_count)::bigint,
         sum(e.sfha_count)::bigint,
         sum(e.paid_total)::double precision,
         count(*)::bigint,
         bool_or(e.event_name is not null or e.event_designation is not null)
    from public.nfip_claim_event e
   group by e.event_key, e.event_year
  having sum(e.claim_count) >= greatest(coalesce(p_min_claims, 0), 0)
   order by e.event_year desc, sum(e.claim_count) desc
   limit 500
$$;

revoke all on function public.nfip_weighted_count(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.nfip_recompute_block_group_heat() from public, anon, authenticated;
revoke all on function public.nfip_claim_bg_build_geom() from public, anon, authenticated;
revoke all on function public.nfip_apply_block_group_claims(integer, integer) from public, anon, authenticated;
revoke all on function public.nfip_claim_event_list(integer) from public, anon, authenticated;
grant execute on function public.nfip_weighted_count(integer, integer, integer) to service_role;
grant execute on function public.nfip_recompute_block_group_heat() to service_role;
grant execute on function public.nfip_claim_bg_build_geom() to service_role;
grant execute on function public.nfip_apply_block_group_claims(integer, integer) to service_role;
grant execute on function public.nfip_claim_event_list(integer) to service_role;

notify pgrst, 'reload schema';
