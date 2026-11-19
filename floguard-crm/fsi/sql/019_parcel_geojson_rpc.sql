-- 019: parcel polygons for the CRM map at high zoom (agent F2, 2026-11-19).
-- Additive and idempotent. Not applied anywhere by the author; apply via the SQL editor after 001.
--
-- Read by api/fsi-parcels.js action 'parcel_geom' (POST /rest/v1/rpc/fsi_parcel_geojson).
-- The API caps the box at 0.06 degrees each way and the row count at 1500; this function caps
-- again so a direct service-role call cannot pull the county either.
--
-- Depends on: public.parcel_risk.geom (001; PostGIS in schema public or extensions) and its GiST
-- index parcel_risk_geom_idx. If geom is null for every parcel in the box the function returns no
-- rows and the API answers available:false / reason 'no_geom' (the map keeps dots).
--
-- Simplification: 0.000005 degrees (about 0.5 m) with ST_SimplifyPreserveTopology, 6 decimals in
-- the GeoJSON (about 0.1 m). Enough to outline a lot at zoom 15-20 without shipping survey detail.

create or replace function public.fsi_parcel_geojson(
  w   double precision,
  s   double precision,
  e   double precision,
  n   double precision,
  lim integer default 600)
returns table(parcel_id text, fsi_static real, fsi_live real, geom_geojson jsonb)
-- plpgsql + unqualified st_* / && resolved through search_path at call time, so this works with
-- PostGIS in schema public (production) or extensions (001). Review R1. Not security definer:
-- only service_role calls it, and it bypasses RLS anyway.
language plpgsql stable
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if w is null or s is null or e is null or n is null
     or not (e > w and n > s) or (e - w) > 0.06 or (n - s) > 0.06 then
    return;
  end if;
  return query
  select p.parcel_id,
         p.fsi_static,
         p.fsi_live,
         st_asgeojson(st_simplifypreservetopology(p.geom, 0.000005), 6)::jsonb
    from public.parcel_risk p
   where p.geom is not null
     and p.geom && st_makeenvelope(w, s, e, n, 4326)
   order by p.fsi_live desc nulls last
   limit least(greatest(coalesce(lim, 600), 1), 1500);
end;
$$;

revoke all on function public.fsi_parcel_geojson(double precision, double precision, double precision, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.fsi_parcel_geojson(double precision, double precision, double precision, double precision, integer)
  to service_role;

comment on function public.fsi_parcel_geojson(double precision, double precision, double precision, double precision, integer) is
  'CRM map parcel outlines for a small bbox (<= 0.06 deg). Service role only. See docs/handoff/F2.md.';

-- Optional, NOT part of this migration: the map search (action ''search'') does
--   address ilike '%q%' or owner_name ilike '%q%' or parcel_id = q
-- which is a sequential scan on parcel_risk. At ~200k Volusia parcels that is fine for 10 rows,
-- but if it gets slow, a trigram index helps (needs pg_trgm, which is a new extension):
--   create extension if not exists pg_trgm with schema extensions;
--   create index if not exists parcel_risk_address_trgm on public.parcel_risk
--     using gin (address extensions.gin_trgm_ops);
