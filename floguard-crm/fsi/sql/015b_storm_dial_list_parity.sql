-- 015b: storm_dial_list parity with the map columns.
-- Applied to production 2026-09-25 as migration 20260925183841_storm_dial_list_parity.
-- Recovered from supabase_migrations.schema_migrations on 2026-11-19 (it was applied from the
-- dashboard and never committed). Replaces the 010 definition; apply after 010-015.

drop function if exists public.storm_dial_list(real, text, integer);

create function public.storm_dial_list(
  min_rain_mm real default 25,
  min_band text default 'should',
  max_rows integer default 200
)
returns table (
  parcel_id text, address text, owner_name text, city text, zip text,
  lat double precision, lon double precision,
  must_have_score real, must_have_band text, must_have_reasons text[],
  fsi_live real, fsi_static real, fema_zone text, hsg text,
  claim_heat real, claim_count_10y integer, claim_last_year integer,
  twi_n real, hand_n real, depr_m real, depr_n real,
  impervious_ratio real, lot_sqft real,
  year_built integer, living_area real, just_value real, homestead text,
  dor_use text, use_desc text,
  rain_cell text, cell_rain_24h real, cell_api real, cell_d real, rain_day date
)
language sql
stable
security definer
set search_path = public
as $$
  with bands as (
    select case lower(min_band)
             when 'must' then array['must']
             when 'maybe' then array['must','should','maybe']
             else array['must','should'] end as ok
  )
  select p.parcel_id, p.address, p.owner_name, p.city, p.zip, p.lat, p.lon,
         p.must_have_score, p.must_have_band, p.must_have_reasons,
         p.fsi_live, p.fsi_static, p.fema_zone, p.hsg,
         p.claim_heat, p.claim_count_10y, p.claim_last_year,
         p.twi_n, p.hand_n, p.depr_m, p.depr_n,
         p.impervious_ratio, p.lot_sqft,
         p.year_built, p.living_area, p.just_value, p.homestead,
         p.dor_use, p.use_desc,
         p.rain_cell, c.rain_24h, c.api_value, c.d, c.rain_day
    from public.parcel_risk p
    join public.rainfall_cell c on c.cell_id = p.rain_cell
    cross join bands b
   where c.rain_24h >= min_rain_mm
     and c.observed_at > now() - interval '2 days'
     and p.must_have_band = any (b.ok)
   order by c.rain_24h desc, p.must_have_score desc nulls last, p.fsi_live desc nulls last
   limit least(greatest(coalesce(max_rows, 200), 1), 2000)
$$;

revoke all on function public.storm_dial_list(real, text, integer) from public, anon, authenticated;
grant execute on function public.storm_dial_list(real, text, integer) to service_role;
