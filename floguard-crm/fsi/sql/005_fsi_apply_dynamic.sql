-- 005: daily dynamic-term apply, split in two because the 312k-row fsi_live
-- rewrite takes ~55s — past PostgREST's statement timeout and Vercel's budget.
--
--   api/cron-rainfall.js (Vercel cron, 10:00 UTC)  → rainfall_state.{api_value, rain_24h, d}
--   pg_cron 'fsi_apply_dynamic_daily' (12:00 UTC) → fsi_apply_dynamic_from_state() → parcel_risk.fsi_live
--
-- FSI = 100 * S^alpha * (0.5 + 0.5 * D), alpha = 1. Applied 2026-09-16 via Supabase MCP
-- (migrations fsi_apply_dynamic, fsi_dynamic_pg_cron). Kept here as the source of record.

create extension if not exists pg_cron with schema pg_catalog;

alter table public.rainfall_state add column if not exists d real;

create or replace function public.fsi_apply_dynamic(d real)
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '900s'
as $$
declare
  n integer;
  dd real := least(greatest(coalesce(d, 0.5), 0), 1);
begin
  update public.parcel_risk
     set fsi_live   = round((100.0 * fsi_static * (0.5 + 0.5 * dd))::numeric, 2),
         updated_at = now()
   where fsi_static is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.fsi_apply_dynamic_from_state(county text default '12127')
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '900s'
as $$
declare
  dv real;
begin
  select d into dv from public.rainfall_state where county_fips = county;
  if dv is null then
    return 0;
  end if;
  return public.fsi_apply_dynamic(dv);
end;
$$;

revoke all on function public.fsi_apply_dynamic(real) from public, anon, authenticated;
revoke all on function public.fsi_apply_dynamic_from_state(text) from public, anon, authenticated;
grant execute on function public.fsi_apply_dynamic(real) to service_role;
grant execute on function public.fsi_apply_dynamic_from_state(text) to service_role;

-- 12:00 UTC daily, two hours after the Vercel cron (Hobby cron timing is loose).
select cron.unschedule(jobid) from cron.job where jobname = 'fsi_apply_dynamic_daily';
select cron.schedule('fsi_apply_dynamic_daily', '0 12 * * *', $$select public.fsi_apply_dynamic_from_state('12127')$$);
