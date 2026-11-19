-- 022: deployment-wide DAILY cap on paid contact-enrichment lookups (review agent R1, 2026-11-19).
-- Additive and idempotent. Not applied anywhere by the author.
--
-- Read by server/lib/enrich-spend.js (api/enrich-contacts.js action 'enrich'). Every enrich request
-- reserves its paid lookups (BatchData + Trestle HTTP calls) here BEFORE calling a provider and
-- releases what it did not use afterwards. The cap itself comes from the env var
-- ENRICH_DAILY_PAID_CAP (default 200) and is passed in by the API, so changing it needs no SQL.
-- `day` is the America/New_York calendar day. `reserved` is the conservative count (includes
-- in-flight and never-released reservations); `used` is what callers reported as actually spent.
-- Until this file is applied the API falls back to a per-instance in-memory cap (weaker; see the
-- module header).

create table if not exists public.enrich_spend_daily (
  day        date primary key,
  reserved   integer not null default 0 check (reserved >= 0),
  used       integer not null default 0 check (used >= 0),
  requests   integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.enrich_spend_daily enable row level security;
revoke all on table public.enrich_spend_daily from anon, authenticated;
grant select, insert, update, delete on table public.enrich_spend_daily to service_role;

-- Atomically grant min(p_want, p_cap - reserved) and add it to reserved. Returns granted + new total.
create or replace function public.enrich_spend_reserve(p_day date, p_want integer, p_cap integer)
returns table(granted integer, reserved integer)
language plpgsql security definer
set search_path = public
as $$
declare r integer; g integer;
begin
  if p_day is null then raise exception 'p_day is required'; end if;
  insert into public.enrich_spend_daily (day) values (p_day) on conflict (day) do nothing;
  select d.reserved into r from public.enrich_spend_daily d where d.day = p_day for update;
  g := least(greatest(coalesce(p_want, 0), 0), greatest(coalesce(p_cap, 0) - r, 0));
  update public.enrich_spend_daily d
     set reserved = r + g, requests = d.requests + 1, updated_at = now()
   where d.day = p_day;
  return query select g, r + g;
end;
$$;

-- Return unused lookups of one reservation and record what was actually spent.
create or replace function public.enrich_spend_release(p_day date, p_unused integer, p_used integer)
returns table(granted integer, reserved integer)
language plpgsql security definer
set search_path = public
as $$
declare r integer;
begin
  update public.enrich_spend_daily d
     set reserved = greatest(d.reserved - greatest(coalesce(p_unused, 0), 0), 0),
         used = d.used + greatest(coalesce(p_used, 0), 0),
         updated_at = now()
   where d.day = p_day
  returning d.reserved into r;
  return query select 0, coalesce(r, 0);
end;
$$;

revoke all on function public.enrich_spend_reserve(date, integer, integer) from public, anon, authenticated;
revoke all on function public.enrich_spend_release(date, integer, integer) from public, anon, authenticated;
grant execute on function public.enrich_spend_reserve(date, integer, integer) to service_role;
grant execute on function public.enrich_spend_release(date, integer, integer) to service_role;

comment on table public.enrich_spend_daily is
  'Paid enrichment lookups per America/New_York day (BatchData + Trestle). Cap = env ENRICH_DAILY_PAID_CAP. See server/lib/enrich-spend.js.';

notify pgrst, 'reload schema';
