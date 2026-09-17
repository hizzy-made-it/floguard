-- 011: item 2 — real terrain (TWI / HAND from USGS 3DEP) into parcel_risk.
-- Applied 2026-09-17 as migration terrain_apply.
--
-- Producer: fsi/pipeline/terrain_run.py writes fsi/data/parcel_terrain.csv
--   parcel_id,twi,hand,twi_n,hand_n   (twi_n / hand_n already 2–98 pct normalised county-wide)
--
-- Two ways in:
--   a) scripts/upload-terrain.mjs  → PostgREST upsert (needs the project un-capped)
--   b) terrain_load_enqueue(url)   → pg_net GET of a hosted CSV (works while egress-capped,
--      because pg_net traffic is not PostgREST egress), then terrain_load_process().
-- Both end with fsi_recompute_static(): S = 0.40*twi_n + 0.25*(1-hand_n) + 0.20*hsg + 0.15*zone,
-- then fsi_live from the cell's d, then must_have_rescore().

create or replace function public.hsg_score(hsg text)
returns real language sql immutable
as $$
  select case
    when hsg is null or trim(hsg) = '' then 0.55
    else coalesce((array[0.2, 0.4, 0.7, 1.0])[
      array_position(array['A','B','C','D'], upper(split_part(trim(hsg), '/', array_length(string_to_array(trim(hsg), '/'), 1)))
    )], 0.55) end
$$;

create or replace function public.zone_score(zone text)
returns real language sql immutable
as $$
  select case upper(coalesce(trim(zone), ''))
    when 'AE' then 1.0 when 'VE' then 1.0
    when 'AO' then 0.8 when 'AH' then 0.8
    when 'X-SHADED' then 0.6 when 'X' then 0.45
    else 0.6 end
$$;

-- Apply one batch of rows: [{parcel_id, twi, hand, twi_n, hand_n}, ...]
create or replace function public.terrain_apply(rows jsonb)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  update public.parcel_risk p
     set twi = v.twi, hand = v.hand, twi_n = v.twi_n, hand_n = v.hand_n
    from jsonb_to_recordset(rows) as v(parcel_id text, twi real, hand real, twi_n real, hand_n real)
   where p.parcel_id = v.parcel_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- CSV text -> rows -> terrain_apply. Header row required.
create or replace function public.terrain_apply_csv(body text)
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare n integer;
begin
  with lines as (
    select l from unnest(string_to_array(replace(body, E'\r', ''), E'\n')) with ordinality as t(l, o)
     where o > 1 and l <> ''
  ), parsed as (
    select split_part(l, ',', 1) parcel_id,
           split_part(l, ',', 2)::real twi,
           split_part(l, ',', 3)::real hand,
           split_part(l, ',', 4)::real twi_n,
           split_part(l, ',', 5)::real hand_n
      from lines
  )
  update public.parcel_risk p
     set twi = v.twi, hand = v.hand, twi_n = v.twi_n, hand_n = v.hand_n
    from parsed v
   where p.parcel_id = v.parcel_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

create table if not exists public.terrain_load_queue (
  req_id       bigint primary key,
  url          text not null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  status_code  integer,
  n_rows       integer,
  error        text
);
alter table public.terrain_load_queue enable row level security;
revoke all on table public.terrain_load_queue from anon, authenticated;
grant select, insert, update, delete on table public.terrain_load_queue to service_role;

create or replace function public.terrain_load_enqueue(urls text[])
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare u text; rid bigint; c int := 0;
begin
  foreach u in array urls loop
    rid := net.http_get(u, timeout_milliseconds := 120000);
    insert into public.terrain_load_queue (req_id, url) values (rid, u);
    c := c + 1;
  end loop;
  return c;
end;
$$;

create or replace function public.terrain_load_process()
returns table(processed integer, rows_applied integer, pending integer, failed integer)
language plpgsql security definer
set search_path = public, extensions
set statement_timeout = '900s'
as $$
declare q record; n int; c_proc int := 0; c_rows int := 0;
begin
  for q in
    select tq.req_id, r.status_code, r.content, r.error_msg, r.timed_out
      from public.terrain_load_queue tq
      join net._http_response r on r.id = tq.req_id
     where tq.processed_at is null
     order by tq.requested_at
  loop
    begin
      if q.status_code = 200 and q.content is not null then
        n := public.terrain_apply_csv(q.content);
        update public.terrain_load_queue set processed_at = now(), status_code = 200, n_rows = n where req_id = q.req_id;
        c_rows := c_rows + n;
      else
        update public.terrain_load_queue set processed_at = now(), status_code = q.status_code,
               error = coalesce(q.error_msg, 'timeout=' || q.timed_out::text) where req_id = q.req_id;
      end if;
    exception when others then
      update public.terrain_load_queue set processed_at = now(), error = sqlerrm where req_id = q.req_id;
    end;
    delete from net._http_response where id = q.req_id;
    c_proc := c_proc + 1;
  end loop;
  return query select c_proc, c_rows,
    (select count(*)::int from public.terrain_load_queue where processed_at is null),
    (select count(*)::int from public.terrain_load_queue where error is not null);
end;
$$;

-- Static term from stored inputs (replaces the DEM-lite values), then live + bands.
create or replace function public.fsi_recompute_static(county text default '12127')
returns jsonb
language plpgsql security definer
set search_path = public
set statement_timeout = '1800s'
as $$
declare n_static integer; n_live integer; run public.must_have_runs%rowtype;
begin
  update public.parcel_risk
     set fsi_static = round((
           0.40 * least(greatest(coalesce(twi_n, 0.55), 0), 1)
         + 0.25 * (1 - least(greatest(coalesce(hand_n, 0.45), 0), 1))
         + 0.20 * public.hsg_score(hsg)
         + 0.15 * public.zone_score(fema_zone))::numeric, 4),
         updated_at = now()
   where twi_n is not null or hand_n is not null or hsg is not null or fema_zone is not null;
  get diagnostics n_static = row_count;
  n_live := public.fsi_apply_dynamic_cells(county);
  perform public.must_have_rescore();
  select * into run from public.must_have_runs order by id desc limit 1;
  return jsonb_build_object('fsi_static_updated', n_static, 'fsi_live_updated', n_live,
                            'mhs_rows_changed', run.rows_changed,
                            'cuts', jsonb_build_object('must', run.cut_must, 'should', run.cut_should, 'maybe', run.cut_maybe));
end;
$$;

revoke all on function public.terrain_apply(jsonb) from public, anon, authenticated;
revoke all on function public.terrain_apply_csv(text) from public, anon, authenticated;
revoke all on function public.terrain_load_enqueue(text[]) from public, anon, authenticated;
revoke all on function public.terrain_load_process() from public, anon, authenticated;
revoke all on function public.fsi_recompute_static(text) from public, anon, authenticated;
grant execute on function public.terrain_apply(jsonb) to service_role;
grant execute on function public.terrain_apply_csv(text) to service_role;
grant execute on function public.terrain_load_enqueue(text[]) to service_role;
grant execute on function public.terrain_load_process() to service_role;
grant execute on function public.fsi_recompute_static(text) to service_role;
