-- scenarios: a b c d e
-- Behaviour tests for fsi/sql/019_parcel_geojson_rpc.sql (added by review agent R1).
-- PostGIS is stubbed (00_bootstrap_supabase.sql): geometry is GeoJSON text, && compares the
-- coordinate bounding boxes, simplification is identity. What is real here: the box/limit caps,
-- the null-geometry filter, the ordering and the privileges.
\set ON_ERROR_STOP on
set search_path = "$user", public, extensions;

delete from public.parcel_risk where parcel_id like 'T-GEO-%';
insert into public.parcel_risk (parcel_id, lat, lon, fsi_static, fsi_live, geom) values
  ('T-GEO-1', 29.101, -81.101, 0.5, 40, '{"type":"MultiPolygon","coordinates":[[[[-81.102,29.100],[-81.100,29.100],[-81.100,29.102],[-81.102,29.100]]]]}'),
  ('T-GEO-2', 29.103, -81.103, 0.7, 70, '{"type":"MultiPolygon","coordinates":[[[[-81.104,29.102],[-81.102,29.102],[-81.102,29.104],[-81.104,29.102]]]]}'),
  ('T-GEO-3', 29.500, -81.500, 0.9, 90, '{"type":"MultiPolygon","coordinates":[[[[-81.501,29.499],[-81.499,29.499],[-81.499,29.501],[-81.501,29.499]]]]}'),
  ('T-GEO-4', 29.102, -81.102, 0.9, 99, null);

select t.eq((select count(*)::int from public.fsi_parcel_geojson(-81.11, 29.09, -81.09, 29.11)), 2,
            '019 returns parcels whose outline overlaps the box, skips far parcels and null geometry');
select t.eq((select parcel_id from public.fsi_parcel_geojson(-81.11, 29.09, -81.09, 29.11) limit 1), 'T-GEO-2',
            '019 orders by fsi_live desc');
select t.eq((select count(*)::int from public.fsi_parcel_geojson(-81.11, 29.09, -81.09, 29.11, 1)), 1, '019 honours lim');
select t.eq((select count(*)::int from public.fsi_parcel_geojson(-81.20, 29.00, -81.00, 29.20)), 0,
            '019 refuses a box wider than 0.06 degrees (returns nothing)');
select t.eq((select count(*)::int from public.fsi_parcel_geojson(-81.09, 29.09, -81.11, 29.11)), 0, '019 refuses an inverted box');
select t.eq((select jsonb_typeof(geom_geojson) from public.fsi_parcel_geojson(-81.11, 29.09, -81.09, 29.11) limit 1), 'object',
            '019 geom_geojson is a JSON object');
select t.ok(not has_function_privilege('anon', 'public.fsi_parcel_geojson(double precision,double precision,double precision,double precision,integer)', 'execute')
        and not has_function_privilege('authenticated', 'public.fsi_parcel_geojson(double precision,double precision,double precision,double precision,integer)', 'execute'),
            '019 RPC closed to anon/authenticated');
select t.ok(has_function_privilege('service_role', 'public.fsi_parcel_geojson(double precision,double precision,double precision,double precision,integer)', 'execute'),
            '019 RPC open to service_role');

delete from public.parcel_risk where parcel_id like 'T-GEO-%';

-- 016 geom column follows PostGIS's schema (public in production, extensions per 001)
select t.ok((select format_type(a.atttypid, null) ~ 'geometry' from pg_attribute a
              where a.attrelid = 'public.nfip_claim_block_group'::regclass and a.attname = 'geom' and not a.attisdropped),
            '016 nfip_claim_block_group.geom created with the installed geometry type');
select t.lives($$select public.nfip_claim_bg_build_geom()$$, '016 nfip_claim_bg_build_geom resolves st_* through search_path');
