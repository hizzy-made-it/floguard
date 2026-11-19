-- scenarios: a b c d e
-- Behaviour tests for fsi/sql/020_estimates_additions.sql (added by review agent R1).
\set ON_ERROR_STOP on
set search_path = "$user", public, extensions;

delete from public.lead_jobs where notes = 'T-EST';
delete from public.lead_estimates where created_by = 'T-EST';
delete from public.leads where name = 'T-EST lead';

do $$ declare o uuid; begin
  if to_regclass('public.organizations') is not null then execute 'select id from public.organizations limit 1' into o; end if;
  insert into public.leads (org_id, name) values (o, 'T-EST lead');
end $$;
insert into public.lead_estimates (lead_id, number, created_by)
  select id, 'T-EST-0001', 'T-EST' from public.leads where name = 'T-EST lead';

select t.ok((select customer = '{}'::jsonb and view_count = 0 and voided_at is null
               from public.lead_estimates where number = 'T-EST-0001'), '020 defaults: customer {}, view_count 0');
select t.throws($$update public.lead_estimates set customer = null where number = 'T-EST-0001'$$, 'null value', '020 customer is not null');

-- one job per estimate (the API relies on this to make job creation idempotent)
insert into public.lead_jobs (lead_id, estimate_id, notes)
  select lead_id, id, 'T-EST' from public.lead_estimates where number = 'T-EST-0001';
select t.throws($$insert into public.lead_jobs (lead_id, estimate_id, notes)
  select lead_id, id, 'T-EST' from public.lead_estimates where number = 'T-EST-0001'$$, 'duplicate key', '020 second job for the same estimate is rejected');
select t.lives($$insert into public.lead_jobs (lead_id, estimate_id, notes)
  select lead_id, null, 'T-EST' from public.lead_estimates where number = 'T-EST-0001'$$, '020 jobs without an estimate are not limited');
select t.lives($$insert into public.lead_jobs (lead_id, estimate_id, notes)
  select lead_id, null, 'T-EST' from public.lead_estimates where number = 'T-EST-0001'$$, '020 ... any number of them');

-- the public token stays unique (017) and the number index exists (020)
select t.throws($$insert into public.lead_estimates (lead_id, number, created_by, public_token)
  select lead_id, 'T-EST-0002', 'T-EST', public_token from public.lead_estimates where number = 'T-EST-0001'$$, 'duplicate key', '017/020 public_token unique');
select t.ok(exists (select 1 from pg_indexes where indexname = 'lead_estimates_org_number_idx'), '020 org/number index exists');
select t.ok(not has_table_privilege('anon', 'public.lead_estimates', 'select'), '020 lead_estimates still closed to anon');

delete from public.lead_jobs where notes = 'T-EST';
delete from public.lead_estimates where created_by = 'T-EST';
delete from public.leads where name = 'T-EST lead';
