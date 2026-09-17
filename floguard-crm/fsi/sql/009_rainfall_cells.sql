-- 009: item 3 — per-cell rainfall instead of one county centroid.
-- Applied 2026-09-17 as migration rainfall_cells. Runs entirely in Postgres
-- (pg_net + pg_cron), so it works without the Vercel cron.
--
-- Why: Florida summer storms are cellular. On 2026-09-15 Open-Meteo reported
-- 10.5 mm at 29.03,-81.07 and 62.7 mm at 29.08,-81.12 — 6 km apart. One
-- county number cannot say "who flooded last night".
--
-- Grid: 0.05° cells (~5.5 km) → 157 cells cover every scored Volusia parcel.
-- Open-Meteo accepts all 157 lat/lon pairs in one request.
--
-- Daily chain (UTC):
--   11:00 rain_fetch_enqueue()   one pg_net GET for all cells → rain_fetch_queue
--   11:10 rain_fetch_process()   parse response → rainfall_cell (API_t, rain_24h, d)
--   12:00 fsi_daily()            fsi_apply_dynamic_cells() → parcel_risk.fsi_live, then must_have_rescore()
-- County-level rainfall_state (Vercel cron / 005) stays as the fallback when a cell is stale.

alter table public.parcel_risk add column if not exists rain_cell text;
create index if not exists parcel_risk_rain_cell_idx on public.parcel_risk (rain_cell);

create table if not exists public.rainfall_cell (
  cell_id     text primary key,          -- floor(lat/0.05)_floor(lon/0.05)
  lat         double precision not null, -- cell centroid
  lon         double precision not null,
  api_value   real,                      -- antecedent precipitation index, mm
  rain_24h    real,                      -- last completed day, mm
  rain_day    date,
  d           real,                      -- dynamic term 0–1 (0.6*API_n + 0.4*Rain24_n)
  observed_at timestamptz
);
alter table public.rainfall_cell enable row level security;
revoke all on table public.rainfall_cell from anon, authenticated;
grant select, insert, update, delete on table public.rainfall_cell to service_role;

create table if not exists public.rain_fetch_queue (
  req_id       bigint primary key,        -- net._http_response.id
  cell_ids     text[] not null,           -- request order == response order
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  status_code  integer,
  n_cells      integer,
  error        text
);
alter table public.rain_fetch_queue enable row level security;
revoke all on table public.rain_fetch_queue from anon, authenticated;
grant select, insert, update, delete on table public.rain_fetch_queue to service_role;

-- Assign every parcel to a cell and make sure the cell row exists.
create or replace function public.rain_cells_seed()
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare n integer;
begin
  update public.parcel_risk
     set rain_cell = floor(lat / 0.05)::int || '_' || floor(lon / 0.05)::int
   where lat is not null and lon is not null
     and rain_cell is distinct from (floor(lat / 0.05)::int || '_' || floor(lon / 0.05)::int);
  insert into public.rainfall_cell (cell_id, lat, lon)
  select distinct rain_cell,
         (floor(lat / 0.05) + 0.5) * 0.05,
         (floor(lon / 0.05) + 0.5) * 0.05
    from public.parcel_risk
   where rain_cell is not null
  on conflict (cell_id) do nothing;
  select count(*) into n from public.rainfall_cell;
  return n;
end;
$$;

-- One Open-Meteo request for all cells. past_days=14 so API can be rebuilt after a gap.
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
    from public.rainfall_cell;
  if ids is null then
    raise exception 'rainfall_cell is empty — run rain_cells_seed() first';
  end if;
  url := 'https://api.open-meteo.com/v1/forecast?latitude=' || lats || '&longitude=' || lons
      || '&daily=precipitation_sum&past_days=14&forecast_days=1&timezone=America%2FNew_York';
  rid := net.http_get(url, timeout_milliseconds := 60000);
  insert into public.rain_fetch_queue (req_id, cell_ids) values (rid, ids);
  return rid;
end;
$$;

-- Parse pending responses. Mirrors scripts/refresh-rainfall.mjs per cell:
--   rain24 = last completed day (yesterday); API_t = 0.87*API_(t-1) + rain24 when the
--   chain is unbroken (<=2 days), else rebuilt from the 14-day history;
--   D = 0.6*clamp(API/150) + 0.4*clamp(rain24/75).
create or replace function public.rain_fetch_process()
returns table(processed integer, cells_updated integer, pending integer, failed integer)
language plpgsql security definer
set search_path = public, extensions
set statement_timeout = '300s'
as $$
declare
  q record; body jsonb; el jsonb; i int; n_cells int; c_upd int := 0; c_proc int := 0; c_req int;
  totals real[]; days date[]; len int; rain24 real; rday date; api real; hist real;
  prev record; cid text; dd real;
begin
  for q in
    select fq.req_id, fq.cell_ids, r.status_code, r.content, r.error_msg, r.timed_out
      from public.rain_fetch_queue fq
      join net._http_response r on r.id = fq.req_id
     where fq.processed_at is null
     order by fq.requested_at
  loop
    begin
      if q.status_code <> 200 or q.content is null then
        update public.rain_fetch_queue
           set processed_at = now(), status_code = q.status_code,
               error = coalesce(q.error_msg, 'timeout=' || q.timed_out::text)
         where req_id = q.req_id;
      else
        body := q.content::jsonb;
        if jsonb_typeof(body) <> 'array' then body := jsonb_build_array(body); end if;
        n_cells := jsonb_array_length(body);
        if n_cells <> array_length(q.cell_ids, 1) then
          raise exception 'response has % locations, expected %', n_cells, array_length(q.cell_ids, 1);
        end if;
        c_req := 0;
        for i in 0 .. n_cells - 1 loop
          el := body -> i;
          cid := q.cell_ids[i + 1];
          select array_agg((v)::real order by o), array_agg((t)::date order by o)
            into totals, days
            from jsonb_array_elements_text(el -> 'daily' -> 'precipitation_sum') with ordinality a(v, o)
            join jsonb_array_elements_text(el -> 'daily' -> 'time') with ordinality b(t, o2) on o2 = o;
          len := coalesce(array_length(totals, 1), 0);
          if len = 0 then continue; end if;
          if len >= 2 then rain24 := coalesce(totals[len - 1], 0); rday := days[len - 1];
          else rain24 := coalesce(totals[1], 0); rday := days[1]; end if;
          hist := 0;
          for i2 in 1 .. greatest(len - 1, 1) loop
            hist := 0.87 * hist + coalesce(totals[i2], 0);
          end loop;
          select * into prev from public.rainfall_cell where cell_id = cid;
          if prev.api_value is not null and prev.rain_day is not null and prev.rain_day >= rday then
            -- Same rain day already folded in (duplicate run): keep API, just refresh.
            api := prev.api_value;
          elsif prev.api_value is not null and prev.observed_at > now() - interval '2 days' then
            api := 0.87 * prev.api_value + rain24;
          else
            api := hist;
          end if;
          dd := 0.6 * least(greatest(api / 150.0, 0), 1) + 0.4 * least(greatest(rain24 / 75.0, 0), 1);
          update public.rainfall_cell
             set api_value = round(api::numeric, 2), rain_24h = round(rain24::numeric, 2),
                 rain_day = rday, d = round(dd::numeric, 3), observed_at = now()
           where cell_id = cid;
          c_upd := c_upd + 1;
          c_req := c_req + 1;
        end loop;
        update public.rain_fetch_queue
           set processed_at = now(), status_code = 200, n_cells = c_req
         where req_id = q.req_id;
      end if;
    exception when others then
      update public.rain_fetch_queue set processed_at = now(), error = sqlerrm where req_id = q.req_id;
    end;
    delete from net._http_response where id = q.req_id;
    c_proc := c_proc + 1;
  end loop;
  return query select c_proc, c_upd,
    (select count(*)::int from public.rain_fetch_queue where processed_at is null),
    (select count(*)::int from public.rain_fetch_queue where error is not null);
end;
$$;

-- Per-parcel dynamic term: the cell's d when fresh (<=2 days), else the county d.
create or replace function public.fsi_apply_dynamic_cells(county text default '12127')
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '900s'
as $$
declare n integer; county_d real;
begin
  select d into county_d from public.rainfall_state where county_fips = county;
  county_d := least(greatest(coalesce(county_d, 0.5), 0), 1);
  update public.parcel_risk p
     set fsi_live = round((100.0 * p.fsi_static * (0.5 + 0.5 * coalesce(
           (select c.d from public.rainfall_cell c
             where c.cell_id = p.rain_cell and c.observed_at > now() - interval '2 days'),
           county_d)))::numeric, 2),
         updated_at = now()
   where p.fsi_static is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.fsi_daily(county text default '12127')
returns jsonb
language plpgsql security definer
set search_path = public
set statement_timeout = '1800s'
as $$
declare
  n_live integer;
  run    public.must_have_runs%rowtype;
  fresh  integer;
begin
  n_live := public.fsi_apply_dynamic_cells(county);
  perform public.must_have_rescore();
  select * into run from public.must_have_runs order by id desc limit 1;
  select count(*) into fresh from public.rainfall_cell where observed_at > now() - interval '2 days';
  return jsonb_build_object(
    'fsi_live_updated', n_live,
    'rain_cells_fresh', fresh,
    'mhs_run_id', run.id,
    'mhs_rows_changed', run.rows_changed,
    'mhs_dial_eligible', run.dial_eligible,
    'cuts', jsonb_build_object('must', run.cut_must, 'should', run.cut_should, 'maybe', run.cut_maybe));
end;
$$;

revoke all on function public.rain_cells_seed() from public, anon, authenticated;
revoke all on function public.rain_fetch_enqueue() from public, anon, authenticated;
revoke all on function public.rain_fetch_process() from public, anon, authenticated;
revoke all on function public.fsi_apply_dynamic_cells(text) from public, anon, authenticated;
grant execute on function public.rain_cells_seed() to service_role;
grant execute on function public.rain_fetch_enqueue() to service_role;
grant execute on function public.rain_fetch_process() to service_role;
grant execute on function public.fsi_apply_dynamic_cells(text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname in ('rain_fetch_enqueue', 'rain_fetch_process');
select cron.schedule('rain_fetch_enqueue', '0 11 * * *',  $$select public.rain_fetch_enqueue()$$);
select cron.schedule('rain_fetch_process', '10 11 * * *', $$set statement_timeout = '600s'; select * from public.rain_fetch_process()$$);
