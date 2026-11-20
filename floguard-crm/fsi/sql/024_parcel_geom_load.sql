-- 024: load full parcel polygons into parcel_risk.geom (was NULL on every row, so the map drew dots).
--
-- Source: Volusia appraiser layer via fsi/pipeline/parcel_polygons.py, simplified to ~0.5 m
-- (st_simplifypreservetopology 0.000005 deg, same tolerance fsi_parcel_geojson applies on read)
-- and rounded to 6 decimals. Built by scripts/build-parcel-geom-release.py into
-- fsi/releases/parcel-geom-<date>/parcel_geom_NN.json: a JSON array of [parcel_id, wkt] pairs.
--
-- Load (dashboard SQL editor, no service key needed), same pg_net pattern as 018:
--   select parcel_geom_load_enqueue(array['https://raw.githubusercontent.com/.../parcel_geom_00.json', ...]);
--   select * from parcel_geom_load_process(4);   -- repeat until pending = 0
--   vacuum (analyze) public.parcel_risk;
-- Rollback: update public.parcel_risk set geom = null;   (map falls back to dots)
-- Additive and idempotent.

create table if not exists public.parcel_geom_load_queue (
  req_id       bigint primary key,
  url          text not null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  status_code  integer,
  n_rows       integer,
  error        text
);
alter table public.parcel_geom_load_queue enable row level security;
revoke all on table public.parcel_geom_load_queue from anon, authenticated;
grant select, insert, update, delete on table public.parcel_geom_load_queue to service_role;

create or replace function public.parcel_geom_apply(rows jsonb)
returns integer
language plpgsql security definer
set search_path = public, extensions
set statement_timeout = '900s'
as $$
declare n integer;
begin
  with src as (
    select r->>0 as parcel_id,
           st_multi(st_makevalid(st_geomfromtext(r->>1, 4326))) as g
      from jsonb_array_elements(rows) r
  ), ok as (
    select parcel_id, st_multi(st_collectionextract(g, 3)) as g
      from src
     where g is not null and not st_isempty(g)
  )
  update public.parcel_risk p
     set geom = ok.g
    from ok
   where p.parcel_id = ok.parcel_id
     and (p.geom is null or not st_equals(p.geom, ok.g));
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.parcel_geom_load_enqueue(urls text[])
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare u text; rid bigint; c int := 0;
begin
  foreach u in array urls loop
    rid := net.http_get(u, timeout_milliseconds := 120000);
    insert into public.parcel_geom_load_queue (req_id, url) values (rid, u);
    c := c + 1;
  end loop;
  return c;
end;
$$;

-- p_max: parts applied per call (keeps one call under the dashboard gateway timeout).
create or replace function public.parcel_geom_load_process(p_max integer default 4)
returns table(processed integer, rows_applied integer, pending integer, failed integer)
language plpgsql security definer
set search_path = public, extensions
set statement_timeout = '900s'
as $$
declare q record; n int; c_proc int := 0; c_rows int := 0;
begin
  for q in
    select gq.req_id, r.status_code, r.content, r.error_msg, r.timed_out
      from public.parcel_geom_load_queue gq
      join net._http_response r on r.id = gq.req_id
     where gq.processed_at is null
     order by gq.requested_at, gq.req_id
     limit greatest(p_max, 1)
  loop
    begin
      if q.status_code = 200 and q.content is not null then
        n := public.parcel_geom_apply(q.content::jsonb);
        update public.parcel_geom_load_queue set processed_at = now(), status_code = 200, n_rows = n where req_id = q.req_id;
        c_rows := c_rows + n;
      else
        update public.parcel_geom_load_queue set processed_at = now(), status_code = q.status_code,
               error = coalesce(q.error_msg, 'timeout=' || q.timed_out::text) where req_id = q.req_id;
      end if;
    exception when others then
      update public.parcel_geom_load_queue set processed_at = now(), error = sqlerrm where req_id = q.req_id;
    end;
    delete from net._http_response where id = q.req_id;
    c_proc := c_proc + 1;
  end loop;
  return query select c_proc, c_rows,
    (select count(*)::int from public.parcel_geom_load_queue where processed_at is null),
    (select count(*)::int from public.parcel_geom_load_queue where error is not null);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.parcel_geom_apply(jsonb)',
    'public.parcel_geom_load_enqueue(text[])',
    'public.parcel_geom_load_process(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
