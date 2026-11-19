-- Stand-in for the PRODUCTION public.leads table as it existed before 017 (its DDL is not in the repo).
-- Shape inferred from `git show be167fd:floguard-crm/server/lib/academy-pg.js` (leadFromRow / leadToRow):
-- org-scoped (organizations FK), legacy_id text, lists (text[] or jsonb), meta jsonb, pipeline_status, ...
-- Variables: dups (1 = duplicate parcel_ids), parcelcol (1 = table already has parcel_id/address/zip), listtype.
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null default '',
  created_at timestamptz not null default now());
insert into public.organizations (slug, name) values ('floguard', 'FloGuard') on conflict do nothing;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  legacy_id text,
  name text,                       -- nullable on purpose: production rows may have null names
  city text, industry text, lead_type text default 'website', list text default 'Website',
  lists :listtype default null, phone text, website text, email text, contact_name text, owner text,
  status text default 'New', pipeline_status text default 'new', notes text, source text,
  custom_type text, best_package text, amount numeric, next_follow_up_at timestamptz, last_activity_at timestamptz,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, legacy_id)
);
\if :parcelcol
alter table public.leads add column parcel_id text, add column address text, add column zip text;
\endif

-- 30 rows. legacy ids 1..27 numeric strings, 28..30 web_* ids.
insert into public.leads (org_id, legacy_id, name, city, phone, status, pipeline_status, amount, meta, created_at, updated_at)
select (select id from public.organizations where slug = 'floguard'),
       case when g <= 27 then g::text else 'web_' || g end,
       case when g in (7, 8) then null when g = 9 then '' else 'Owner ' || g end,
       case when g % 3 = 0 then 'Daytona Beach' when g % 3 = 1 then 'Ormond Beach' else 'Port Orange' end,
       case when g % 4 = 0 then '(386) 555-01' || lpad(g::text, 2, '0') else '' end,
       (array['New','Called - no answer','Callback','Interested','Quoted','Deposit collected','Contract signed','Not interested','Archived',''])[1 + g % 10],
       'new',
       case when g % 5 = 0 then g * 100 end,
       case when g % 6 = 0 then '{"list_status":{"flood":"Quoted"},"lists_touched":true}'::jsonb else '{}'::jsonb end,
       timestamptz '2026-09-01 12:00:00+00' + (g || ' hours')::interval,
       timestamptz '2026-09-02 12:00:00+00' + (g || ' hours')::interval
  from generate_series(1, 30) g;

\if :parcelcol
update public.leads set parcel_id = case
    when :dups = 1 and legacy_id in ('5', '6') then 'P-100'
    when :dups = 1 and legacy_id in ('10', '11', '12') then 'P-200'
    when legacy_id in ('20', '21', '22') then ''           -- blanks are normalised to NULL by 017
    when legacy_id::text ~ '^[0-9]+$' and legacy_id::int <= 27 and legacy_id::int not in (7, 8) then 'P-' || (1000 + legacy_id::int)
    else null end,
  address = case when legacy_id in ('1', '2', '3') then (legacy_id || ' Main St') end;
\endif
