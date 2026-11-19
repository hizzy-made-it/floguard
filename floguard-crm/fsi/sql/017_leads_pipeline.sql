-- 017: leads as a Postgres source of truth — pipeline stage, tasks, activity log,
-- and (defined now so one migration covers it) estimates + jobs.
--
-- Additive and idempotent: every statement is `if not exists` / `create or replace`
-- or guarded by a DO block. Safe to re-run. Safe whether or not public.leads already
-- exists. Nothing is dropped or rewritten. NOT applied by the agent that wrote it.
--
-- Where the existing leads table comes from: the DDL for public.leads is NOT in this
-- repo (server/lib/academy-pg.js refers to supabase/migrations/20260712_sales_rev_orgs.sql
-- which was never committed). Its shape was inferred from leadFromRow()/leadToRow():
--   id uuid pk, org_id uuid, legacy_id text, name, city, industry, lead_type, list,
--   lists text[]/jsonb, phone, website, email, contact_name, owner, status,
--   pipeline_status, notes, source, custom_type, best_package, amount numeric,
--   next_follow_up_at, last_activity_at, meta jsonb, created_at, updated_at.
-- Section A creates the table with those columns if it is missing, then section B adds
-- every column this pipeline needs with `add column if not exists`. Column types for
-- pre-existing columns are never altered.
--
-- Written to the table by api/academy-leads.js via the service role (PostgREST).
-- Every table below: RLS on, no anon/authenticated access, service_role only.

-- No pgcrypto needed: gen_random_uuid() is core since PG13 (the earlier `create extension pgcrypto` was removed;
-- it could create the extension in schema public and trip linter 0014, or fail for a role without CREATE on the database).

-- Same body as the helper in 007; re-declared so 017 stands alone. `set search_path` clears linter 0011.
create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = public
as $$ begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- A. leads: create if missing (shape inferred from academy-pg.js)
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid,
  legacy_id        text,
  name             text not null default '',
  city             text not null default '',
  industry         text not null default '',
  lead_type        text not null default 'website',
  list             text not null default 'Website',
  lists            jsonb not null default '[]'::jsonb,
  phone            text not null default '',
  website          text not null default '',
  email            text not null default '',
  contact_name     text not null default '',
  owner            text not null default '',
  status           text not null default 'New',
  pipeline_status  text not null default 'new',
  notes            text not null default '',
  source           text not null default '',
  custom_type      text not null default '',
  best_package     text not null default '',
  amount           numeric,
  next_follow_up_at timestamptz,
  last_activity_at timestamptz,
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- B. leads: pipeline columns (all `add column if not exists`)
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists legacy_id         text;
alter table public.leads add column if not exists meta              jsonb;
alter table public.leads add column if not exists address           text;
alter table public.leads add column if not exists zip               text;
alter table public.leads add column if not exists parcel_id         text;
alter table public.leads add column if not exists phones            jsonb not null default '[]'::jsonb;
alter table public.leads add column if not exists phone_dnc         boolean;            -- tri-state: null = unknown
alter table public.leads add column if not exists phone_line_type   text;
alter table public.leads add column if not exists phone_source      text;
alter table public.leads add column if not exists phone_confidence  numeric;
alter table public.leads add column if not exists email_source      text;
alter table public.leads add column if not exists enriched_at       timestamptz;
alter table public.leads add column if not exists next_action       jsonb;              -- {type,due_at,note,task_id?}
alter table public.leads add column if not exists data              jsonb not null default '{}'::jsonb;
alter table public.leads add column if not exists deleted_at        timestamptz;
alter table public.leads add column if not exists updated_at        timestamptz not null default now();
alter table public.leads add column if not exists created_at        timestamptz not null default now();

-- stage: add + backfill exactly once (only when the column is first created), so
-- re-running this file can never overwrite a stage a rep moved by hand.
do $$
begin
  -- pg_attribute, not information_schema.columns: the latter hides columns the current role cannot see.
  if not exists (select 1 from pg_attribute
                 where attrelid = 'public.leads'::regclass and attname = 'stage' and not attisdropped) then
    alter table public.leads add column stage text not null default 'new';
    -- Legacy per-cause status -> stage (spec mapping). The API also derives stage across
    -- list_status; this backfill uses the primary status only.
    update public.leads set stage = case
      when lower(coalesce(status, '')) in ('contract signed', 'deposit collected', 'closed') then 'won'
      when lower(coalesce(status, '')) in ('quoted') then 'estimate_sent'
      when lower(coalesce(status, '')) in ('callback', 'interested', 'contacted', 'follow_up')
        or lower(coalesce(status, '')) like 'called%' then 'contacted'
      when lower(coalesce(status, '')) in ('not interested', 'do not contact', 'lost') then 'lost'
      when lower(coalesce(status, '')) in ('archived') then 'nurture'
      else 'new' end;
  end if;
end $$;

-- value guard on stage (added once, never fails on re-run)
do $$
begin
  alter table public.leads add constraint leads_stage_check
    check (stage in ('new','contacted','assessment_booked','estimate_sent','won','lost','nurture'));
exception when duplicate_object then null;
          when others then raise notice 'leads_stage_check not added: %', sqlerrm;
end $$;

-- Normalise blank parcel ids to NULL so the unique index below ignores them.
update public.leads set parcel_id = null where parcel_id is not null and btrim(parcel_id) = '';

-- legacy_id auto-assign: browser/CLI ids are numeric strings ("1".."227") or "web_..." ids.
-- New rows with no id get max(numeric legacy_id)+1 under an advisory lock, so ids stay
-- numeric for the existing front end. Explicit legacy_ids are never touched.
create or replace function public.leads_assign_legacy_id()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.legacy_id is null or btrim(new.legacy_id) = '' then
    perform pg_advisory_xact_lock(hashtext('leads_legacy_id'));
    select (coalesce(max(legacy_id::bigint), 0) + 1)::text into new.legacy_id
      from public.leads where legacy_id ~ '^[0-9]{1,15}$';
  end if;
  return new;
end $$;

drop trigger if exists leads_assign_legacy_id_trg on public.leads;
create trigger leads_assign_legacy_id_trg before insert on public.leads
  for each row execute function public.leads_assign_legacy_id();

drop trigger if exists leads_touch_updated_at_trg on public.leads;
create trigger leads_touch_updated_at_trg before update on public.leads
  for each row execute function public.touch_updated_at();

-- Indexes. parcel_id uniqueness (live rows only, NULL and blank excluded): created ONLY if no
-- duplicates exist right now. If duplicates exist the migration does NOT fail: it makes
-- a plain index, raises a NOTICE listing the count, and the API still dedupes at app
-- level (api matches by parcel_id before inserting). Resolve the duplicates, then
-- re-run this file and the unique index is created.
do $$
declare dup int;
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'leads_parcel_id_uidx') then
    return;
  end if;
  select count(*) into dup from (
    select parcel_id from public.leads
     where parcel_id is not null and btrim(parcel_id) <> '' and deleted_at is null
     group by parcel_id having count(*) > 1) d;
  if dup = 0 then
    create unique index leads_parcel_id_uidx on public.leads (parcel_id)
      where parcel_id is not null and btrim(parcel_id) <> '' and deleted_at is null;
    drop index if exists public.leads_parcel_id_idx;  -- the stop-gap index from an earlier run (duplicates since resolved)
  else
    raise notice 'leads: % duplicate parcel_id value(s) among live rows; leads_parcel_id_uidx NOT created. Using non-unique index leads_parcel_id_idx; the API dedupes at app level. Fix duplicates and re-run 017.', dup;
    create index if not exists leads_parcel_id_idx on public.leads (parcel_id) where parcel_id is not null;
  end if;
end $$;

create index if not exists leads_legacy_id_idx   on public.leads (legacy_id);
create index if not exists leads_stage_idx       on public.leads (stage) where deleted_at is null;
create index if not exists leads_updated_at_idx  on public.leads (updated_at, id);
create index if not exists leads_name_city_idx   on public.leads (lower(name), lower(city));

alter table public.leads enable row level security;
revoke all on table public.leads from anon, authenticated;
grant select, insert, update, delete on table public.leads to service_role;

-- ---------------------------------------------------------------------------
-- C. lead_activity — append-only timeline
-- ---------------------------------------------------------------------------
create table if not exists public.lead_activity (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null,
  at         timestamptz not null default now(),
  actor      text not null default '',
  type       text not null check (type in ('call','text','email','note','stage_change','enrich','visit','system')),
  direction  text check (direction in ('inbound','outbound')),
  outcome    text,
  body       text,
  meta       jsonb not null default '{}'::jsonb
);
create index if not exists lead_activity_lead_at_idx on public.lead_activity (lead_id, at desc);
create index if not exists lead_activity_type_at_idx on public.lead_activity (type, at desc);
alter table public.lead_activity enable row level security;
revoke all on table public.lead_activity from anon, authenticated;
grant select, insert, update, delete on table public.lead_activity to service_role;

-- ---------------------------------------------------------------------------
-- D. lead_tasks — next actions / follow-ups
-- ---------------------------------------------------------------------------
create table if not exists public.lead_tasks (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null,
  type           text not null default 'call' check (type in ('call','text','email','visit','other')),
  due_at         timestamptz not null,
  note           text,
  done_at        timestamptz,
  created_by     text not null default '',
  is_next_action boolean not null default false,  -- mirror of leads.next_action (set via patch)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists lead_tasks_open_due_idx on public.lead_tasks (due_at) where done_at is null;
create index if not exists lead_tasks_lead_idx     on public.lead_tasks (lead_id, due_at);
drop trigger if exists lead_tasks_touch_updated_at_trg on public.lead_tasks;
create trigger lead_tasks_touch_updated_at_trg before update on public.lead_tasks
  for each row execute function public.touch_updated_at();
alter table public.lead_tasks enable row level security;
revoke all on table public.lead_tasks from anon, authenticated;
grant select, insert, update, delete on table public.lead_tasks to service_role;

-- Foreign keys: best effort, added only when leads.id is uuid-compatible. A failure
-- (for example an unexpected id type on a pre-existing table) never fails the migration.
do $$
begin
  alter table public.lead_activity add constraint lead_activity_lead_fk
    foreign key (lead_id) references public.leads(id) on delete cascade;
exception when duplicate_object then null;
          when others then raise notice 'lead_activity FK not added: %', sqlerrm;
end $$;
do $$
begin
  alter table public.lead_tasks add constraint lead_tasks_lead_fk
    foreign key (lead_id) references public.leads(id) on delete cascade;
exception when duplicate_object then null;
          when others then raise notice 'lead_tasks FK not added: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- E. Estimates + jobs (used by the later Estimates feature; defined here so one
--    migration covers it)
-- ---------------------------------------------------------------------------
create sequence if not exists public.lead_estimate_number_seq start 1001;

create table if not exists public.lead_estimates (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null,
  number        text not null default ('E-' || nextval('public.lead_estimate_number_seq')::text),
  status        text not null default 'draft' check (status in ('draft','sent','accepted','declined','expired')),
  line_items    jsonb not null default '[]'::jsonb,
  subtotal      numeric not null default 0,
  discount      numeric not null default 0,
  total         numeric not null default 0,
  terms         text,
  valid_until   date,
  public_token  text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  sent_at       timestamptz,
  accepted_at   timestamptz,
  accepted_name text,
  accepted_ip   text,
  created_by    text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists lead_estimates_public_token_uidx on public.lead_estimates (public_token);
create unique index if not exists lead_estimates_number_uidx       on public.lead_estimates (number);
create index if not exists lead_estimates_lead_idx                 on public.lead_estimates (lead_id, created_at desc);
drop trigger if exists lead_estimates_touch_updated_at_trg on public.lead_estimates;
create trigger lead_estimates_touch_updated_at_trg before update on public.lead_estimates
  for each row execute function public.touch_updated_at();
alter table public.lead_estimates enable row level security;
revoke all on table public.lead_estimates from anon, authenticated;
grant select, insert, update, delete on table public.lead_estimates to service_role;
revoke all on sequence public.lead_estimate_number_seq from anon, authenticated;  -- Supabase default privileges grant these
grant usage, select on sequence public.lead_estimate_number_seq to service_role;

create table if not exists public.lead_jobs (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null,
  estimate_id    uuid,
  status         text not null default 'scheduled' check (status in ('scheduled','in_progress','complete','cancelled')),
  scheduled_for  timestamptz,
  completed_at   timestamptz,
  invoice_number text,
  invoice_total  numeric,
  invoice_status text not null default 'unbilled' check (invoice_status in ('unbilled','sent','paid')),
  paid_at        timestamptz,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists lead_jobs_lead_idx     on public.lead_jobs (lead_id, created_at desc);
create index if not exists lead_jobs_estimate_idx on public.lead_jobs (estimate_id);
drop trigger if exists lead_jobs_touch_updated_at_trg on public.lead_jobs;
create trigger lead_jobs_touch_updated_at_trg before update on public.lead_jobs
  for each row execute function public.touch_updated_at();
alter table public.lead_jobs enable row level security;
revoke all on table public.lead_jobs from anon, authenticated;
grant select, insert, update, delete on table public.lead_jobs to service_role;

do $$
begin
  alter table public.lead_estimates add constraint lead_estimates_lead_fk
    foreign key (lead_id) references public.leads(id) on delete cascade;
exception when duplicate_object then null;
          when others then raise notice 'lead_estimates FK not added: %', sqlerrm;
end $$;
do $$
begin
  alter table public.lead_jobs add constraint lead_jobs_lead_fk
    foreign key (lead_id) references public.leads(id) on delete cascade;
exception when duplicate_object then null;
          when others then raise notice 'lead_jobs FK not added: %', sqlerrm;
end $$;
do $$
begin
  alter table public.lead_jobs add constraint lead_jobs_estimate_fk
    foreign key (estimate_id) references public.lead_estimates(id) on delete set null;
exception when duplicate_object then null;
          when others then raise notice 'lead_jobs estimate FK not added: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- F. Views for the dashboard (read via service role; no anon/authenticated access)
-- ---------------------------------------------------------------------------
-- security_invoker (PG15+, Supabase runs 15/17): the views run with the caller's privileges, so
-- they can never be a back door around the table grants/RLS (linter 0010). service_role has
-- BYPASSRLS plus table grants, so PostgREST access through service_role is unchanged.
-- Funnel: live leads per stage. Stages with zero leads are absent; the API fills zeros.
create or replace view public.lead_funnel with (security_invoker = true) as
  select stage,
         count(*)::int                                   as leads,
         coalesce(sum(amount), 0)::numeric               as amount
    from public.leads
   where deleted_at is null
   group by stage;

-- Open tasks due today or overdue, "today" being the America/New_York calendar day
-- (the business is in Daytona Beach). bucket = 'overdue' | 'today'.
create or replace view public.lead_tasks_due with (security_invoker = true) as
  select t.id, t.lead_id, t.type, t.due_at, t.note, t.created_by, t.is_next_action,
         case when t.due_at < (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York')
              then 'overdue' else 'today' end            as bucket,
         l.name  as lead_name,
         l.phone as lead_phone,
         l.stage as lead_stage,
         l.phone_dnc as lead_phone_dnc
    from public.lead_tasks t
    join public.leads l on l.id = t.lead_id and l.deleted_at is null
   where t.done_at is null
     and t.due_at < ((date_trunc('day', now() at time zone 'America/New_York') + interval '1 day') at time zone 'America/New_York');

revoke all on table public.lead_funnel     from anon, authenticated;
revoke all on table public.lead_tasks_due  from anon, authenticated;
grant select on table public.lead_funnel    to service_role;
grant select on table public.lead_tasks_due to service_role;

-- Make PostgREST see the new columns/tables/views immediately.
notify pgrst, 'reload schema';
