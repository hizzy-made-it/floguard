-- 015c: rainfall fetch retries and a freshness probe.
-- Applied to production 2026-09-25 as migration 20260925184052_rain_fetch_retry_and_freshness.
-- Recovered from supabase_migrations.schema_migrations on 2026-11-19 (it was applied from the
-- dashboard and never committed). Depends on 009 (rain_fetch_process, rain_fetch_enqueue,
-- rain_fetch_queue, rainfall_cell).

create or replace function public.rain_fetch_ensure()
returns table (action text, detail text)
language plpgsql
security definer
set search_path = public, extensions
set statement_timeout = '600s'
as $$
declare
  latest timestamptz;
  pending int;
  rid bigint;
begin
  perform public.rain_fetch_process();

  select max(observed_at) into latest from public.rainfall_cell;
  select count(*) into pending from public.rain_fetch_queue where processed_at is null;

  if latest is not null and latest >= date_trunc('day', now()) + interval '11 hours' then
    return query select 'ok'::text, ('fresh as of ' || latest::text);
  elsif pending > 0 then
    return query select 'waiting'::text, (pending::text || ' request(s) in flight');
  else
    rid := public.rain_fetch_enqueue();
    return query select 'requeued'::text, ('req_id ' || rid::text);
  end if;
end;
$$;

revoke all on function public.rain_fetch_ensure() from public, anon, authenticated;
grant execute on function public.rain_fetch_ensure() to service_role;

select cron.unschedule(jobid) from cron.job where jobname in
  ('rain_fetch_retry_1', 'rain_fetch_retry_2', 'rain_fetch_retry_3');
select cron.schedule('rain_fetch_retry_1', '30 12 * * *', $$select * from public.rain_fetch_ensure()$$);
select cron.schedule('rain_fetch_retry_2', '30 14 * * *', $$select * from public.rain_fetch_ensure()$$);
select cron.schedule('rain_fetch_retry_3', '30 16 * * *', $$select * from public.rain_fetch_ensure()$$);

create or replace function public.rain_freshness()
returns table (observed_at timestamptz, rain_day date, age_hours real, stale boolean, cells integer)
language sql
security definer
set search_path = public
stable
as $$
  select max(observed_at),
         max(rain_day),
         round((extract(epoch from (now() - max(observed_at))) / 3600)::numeric, 1)::real,
         max(observed_at) < now() - interval '30 hours',
         count(*)::int
    from public.rainfall_cell
$$;
revoke all on function public.rain_freshness() from public, anon, authenticated;
grant execute on function public.rain_freshness() to service_role;
