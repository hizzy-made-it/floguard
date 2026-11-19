-- Local stand-ins for the Supabase platform pieces the FSI migrations rely on.
-- NOT production code. Run once per fresh database BEFORE 001.
--   roles:      anon, authenticated, service_role (service_role has BYPASSRLS like Supabase)
--   schemas:    extensions, cron, net
--   geometry:   extensions.geometry is a DOMAIN over text (PostGIS is not installable here);
--               st_geomfromgeojson / st_setsrid / st_multi are identity-ish stubs.
--   pg_cron:    cron.job + cron.schedule/unschedule that only record rows.
--   pg_net:     net.http_get returns a bigint; net._http_response exists (empty).
--   default privileges: Supabase grants ALL on new public tables/functions/sequences to
--               anon, authenticated, service_role. Reproduced so that the migrations' REVOKEs are
--               actually exercised.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;

set search_path = "$user", public, extensions;

-- PostGIS stand-ins. Created in schema `extensions` (001's layout); run-local.sh moves them to
-- `public` for the POSTGIS_SCHEMA=public pass (production layout). Bodies use unqualified names so
-- they keep working after the move (database search_path is "$user", public, extensions).
create domain extensions.geometry as text;
create function extensions.st_geomfromgeojson(text) returns extensions.geometry language sql immutable as $$ select cast($1 as geometry) $$;
create function extensions.st_setsrid(extensions.geometry, integer) returns extensions.geometry language sql immutable as $$ select $1 $$;
create function extensions.st_multi(extensions.geometry) returns extensions.geometry language sql immutable as $$ select $1 $$;
-- 019 (fsi_parcel_geojson) stand-ins. Geometry values in tests are GeoJSON text, so st_asgeojson
-- returns them unchanged, simplification is identity, st_makeenvelope builds a GeoJSON polygon and
-- && compares the bounding boxes of the two GeoJSON texts (coordinates only, no SRID handling).
create function extensions.st_simplifypreservetopology(extensions.geometry, double precision) returns extensions.geometry language sql immutable as $$ select $1 $$;
create function extensions.st_asgeojson(extensions.geometry, integer default 9, integer default 8) returns text language sql immutable as $$ select $1::text $$;
create function extensions.st_makeenvelope(double precision, double precision, double precision, double precision, integer default 0) returns extensions.geometry language sql immutable as $$
  select cast(json_build_object('type', 'Polygon', 'coordinates', json_build_array(json_build_array(
    json_build_array($1, $2), json_build_array($3, $2), json_build_array($3, $4), json_build_array($1, $4), json_build_array($1, $2))))::text as geometry) $$;
create function extensions._sb_bbox(g text) returns double precision[] language sql immutable as $$
  select array[min(x), min(y), max(x), max(y)]
    from (select (m[1])::double precision as x, (m[2])::double precision as y
            from regexp_matches(g, '\[\s*(-?[0-9.eE+-]+)\s*,\s*(-?[0-9.eE+-]+)\s*\]', 'g') as m) c $$;
create function extensions._sb_overlaps(a text, b text) returns boolean language sql immutable as $$
  select (_sb_bbox(a))[1] <= (_sb_bbox(b))[3] and (_sb_bbox(b))[1] <= (_sb_bbox(a))[3]
     and (_sb_bbox(a))[2] <= (_sb_bbox(b))[4] and (_sb_bbox(b))[2] <= (_sb_bbox(a))[4] $$;
create operator extensions.&& (leftarg = text, rightarg = text, function = extensions._sb_overlaps);

create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create or replace function cron.unschedule(p_jobid bigint) returns boolean language sql as $$
  with d as (delete from cron.job where jobid = p_jobid returning 1) select exists (select 1 from d) $$;

create schema if not exists net;
create table if not exists net._http_response (id bigint primary key, status_code int, content text, timed_out boolean, error_msg text, created timestamptz default now());
create sequence if not exists net._req_seq;
create or replace function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$ select nextval('net._req_seq') $$;

-- Supabase default privileges (postgres role creates objects in public)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
-- Supabase also leaves EXECUTE on new functions to PUBLIC (Postgres default). Left as is.

-- Tiny assertion helper used by *.test.sql files.
create schema if not exists t;
create table if not exists t.results (n serial primary key, ok boolean not null, name text not null, detail text, file text);
create or replace function t.ok(p_ok boolean, p_name text, p_detail text default null) returns boolean language plpgsql security definer set search_path = t, pg_catalog as $$
begin
  insert into t.results (ok, name, detail) values (coalesce(p_ok, false), p_name, p_detail);
  raise notice '% %', case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end,
    p_name || case when coalesce(p_ok, false) or p_detail is null then '' else ' -- ' || p_detail end;
  return coalesce(p_ok, false);
end $$;
create or replace function t.eq(p_actual anyelement, p_expected anyelement, p_name text) returns boolean language sql as $$
  select t.ok(p_actual is not distinct from p_expected, p_name, format('got %L expected %L', p_actual, p_expected)) $$;
create or replace function t.near(p_actual double precision, p_expected double precision, p_name text, p_tol double precision default 1e-4) returns boolean language sql as $$
  select t.ok(abs(p_actual - p_expected) <= p_tol, p_name, format('got %s expected %s', p_actual, p_expected)) $$;
-- Runs a statement and passes when it raises an error whose message matches p_pattern (regex), or any error when null.
create or replace function t.throws(p_sql text, p_pattern text, p_name text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return t.ok(false, p_name, 'no error raised');
exception when others then
  return t.ok(p_pattern is null or sqlerrm ~* p_pattern, p_name, 'raised: ' || sqlerrm);
end $$;
-- Runs a statement and passes when it succeeds.
create or replace function t.lives(p_sql text, p_name text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return t.ok(true, p_name);
exception when others then
  return t.ok(false, p_name, 'raised: ' || sqlerrm);
end $$;
grant usage on schema t to anon, authenticated, service_role;
