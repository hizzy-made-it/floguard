-- 010: item 4 — post-storm dial list.
-- Applied 2026-09-17 as migration storm_dial_list.
--
-- "Who got rained on hard, and is worth a call while the yard is still wet."
-- Reads rainfall_cell (009) + parcel_risk bands (006/008). No new state.
--
--   select * from storm_cells(25);                      -- which cells had >=25 mm yesterday
--   select * from storm_dial_list(25, 'should', 200);   -- top parcels in those cells
--
-- Served to the CRM by api/fsi-parcels.js action 'storm'.

create or replace function public.storm_cells(min_rain_mm real default 25)
returns table(cell_id text, lat double precision, lon double precision,
              rain_24h real, api_value real, d real, rain_day date,
              parcels integer, must_parcels integer, should_parcels integer)
language sql stable security definer
set search_path = public
as $$
  select c.cell_id, c.lat, c.lon, c.rain_24h, c.api_value, c.d, c.rain_day,
         count(p.parcel_id)::int,
         count(p.parcel_id) filter (where p.must_have_band = 'must')::int,
         count(p.parcel_id) filter (where p.must_have_band = 'should')::int
    from public.rainfall_cell c
    left join public.parcel_risk p on p.rain_cell = c.cell_id
   where c.rain_24h >= min_rain_mm
     and c.observed_at > now() - interval '2 days'
   group by c.cell_id, c.lat, c.lon, c.rain_24h, c.api_value, c.d, c.rain_day
   order by c.rain_24h desc
$$;

-- min_band: 'must' | 'should' | 'maybe' (inclusive, better bands included).
create or replace function public.storm_dial_list(
  min_rain_mm real default 25,
  min_band text default 'should',
  max_rows integer default 200)
returns table(
  parcel_id text, address text, owner_name text, city text, zip text,
  lat double precision, lon double precision,
  must_have_score real, must_have_band text, must_have_reasons text[],
  fsi_live real, fsi_static real, fema_zone text, hsg text, claim_heat real,
  twi_n real, hand_n real, impervious_ratio real, lot_sqft real,
  year_built integer, living_area real, just_value real, homestead text,
  rain_cell text, cell_rain_24h real, cell_api real, cell_d real, rain_day date)
language sql stable security definer
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
         p.fsi_live, p.fsi_static, p.fema_zone, p.hsg, p.claim_heat,
         p.twi_n, p.hand_n, p.impervious_ratio, p.lot_sqft,
         p.year_built, p.living_area, p.just_value, p.homestead,
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

revoke all on function public.storm_cells(real) from public, anon, authenticated;
revoke all on function public.storm_dial_list(real, text, integer) from public, anon, authenticated;
grant execute on function public.storm_cells(real) to service_role;
grant execute on function public.storm_dial_list(real, text, integer) to service_role;
