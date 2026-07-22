-- FloGuard FSI — harden PostGIS against Supabase database linter
--
-- Fixes WARN findings:
--   0014_extension_in_public  (postgis in public)
--   0028_anon_security_definer_function_executable (st_estimatedextent)
--   0029_authenticated_security_definer_function_executable (st_estimatedextent)
--
-- Run in Supabase SQL Editor (or: psql "$DATABASE_URL" -f fsi/sql/003_postgis_security_harden.sql)
--
-- SAFE PATH (always run): revoke RPC execute on st_estimatedextent from client roles.
-- MOVE PATH (optional): only if you have no important data depending on public.postgis
-- geometry types yet. Moving PostGIS after tables use public.geometry is painful —
-- prefer revoke-only if parcel_risk already exists with public.geometry.

-- ---------------------------------------------------------------------------
-- 1) Revoke client RPC on the linter-flagged SECURITY DEFINER overloads
-- ---------------------------------------------------------------------------
-- PostGIS installs these as SECURITY DEFINER; PostgREST would otherwise expose
-- them at /rest/v1/rpc/st_estimatedextent for anon + authenticated.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'st_estimatedextent'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
    -- Keep service_role / postgres able to use it if needed
    execute format('grant execute on function %s to service_role', r.sig);
    execute format('grant execute on function %s to postgres', r.sig);
    raise notice 'revoked client execute on %', r.sig;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Optional: move PostGIS out of public → extensions
-- ---------------------------------------------------------------------------
-- Uncomment ONLY if:
--   - postgis is currently in public, AND
--   - you do not yet depend on public.geometry columns, OR you are prepared
--     to recreate parcel_risk with extensions.geometry.
--
-- create schema if not exists extensions;
--
-- -- Drop dependent FSI objects first if they use public.geometry:
-- -- drop index if exists public.parcel_risk_geom_idx;
-- -- alter table public.parcel_risk drop column if exists geom;
--
-- drop extension if exists postgis cascade;
-- create extension postgis with schema extensions;
--
-- -- Recreate geom if you dropped it:
-- -- alter table public.parcel_risk
-- --   add column geom extensions.geometry(MultiPolygon, 4326);
-- -- create index if not exists parcel_risk_geom_idx
-- --   on public.parcel_risk using gist (geom);

-- ---------------------------------------------------------------------------
-- 3) Ensure FSI tables are not world-readable via PostgREST
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.parcel_risk') is not null then
    execute 'alter table public.parcel_risk enable row level security';
    execute 'revoke all on table public.parcel_risk from anon, authenticated';
    execute 'grant select, insert, update, delete on table public.parcel_risk to service_role';
  end if;
  if to_regclass('public.rainfall_state') is not null then
    execute 'alter table public.rainfall_state enable row level security';
    execute 'revoke all on table public.rainfall_state from anon, authenticated';
    execute 'grant select, insert, update, delete on table public.rainfall_state to service_role';
  end if;
end $$;
