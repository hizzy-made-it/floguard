-- scenarios: a b c d e
-- Behaviour tests for fsi/sql/017_leads_pipeline.sql. Runs on four starting states:
--   a: no public.leads before 017      b: legacy table, DUPLICATE parcel_ids   c/d: legacy table, no duplicates
\set ON_ERROR_STOP on
set search_path = "$user", public, extensions;
\set mig017 :migdir '/017_leads_pipeline.sql.' :dbname '.rewritten.sql'

select to_regclass('public.organizations') is not null as has_org \gset
select exists (select 1 from public.leads) as had_rows \gset
select exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'leads_parcel_id_uidx') as has_uidx \gset

-- helper: create a lead through plain SQL (org_id supplied when the legacy org table exists)
create or replace function t.mk_lead(p_name text, p_parcel text default null, p_status text default 'New',
                                     p_legacy text default null, p_stage text default null, p_amount numeric default null,
                                     p_deleted boolean default false) returns uuid language plpgsql as $$
declare oid_ uuid; id_ uuid;
begin
  if to_regclass('public.organizations') is not null then select id into oid_ from public.organizations limit 1; end if;
  insert into public.leads (org_id, name, parcel_id, status, legacy_id, stage, amount, deleted_at, phone, phone_dnc)
  values (oid_, p_name, p_parcel, p_status, p_legacy, coalesce(p_stage, 'new'), p_amount,
          case when p_deleted then now() end, '(386) 555-0199', true)
  returning id into id_;
  return id_;
end $$;

delete from public.lead_jobs where lead_id in (select id from public.leads where name like 'T-LEAD-%');
delete from public.leads where name like 'T-LEAD-%';

-- ---------------------------------------------------------------- shape / backfill
select t.ok(to_regclass(x) is not null, '017 creates ' || x) from unnest(array['public.leads','public.lead_activity','public.lead_tasks','public.lead_estimates','public.lead_jobs','public.lead_funnel','public.lead_tasks_due']) x;
select t.ok(exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name = c), '017 leads has column ' || c)
  from unnest(array['stage','phones','phone_dnc','phone_line_type','phone_source','phone_confidence','email_source','enriched_at','next_action','data','deleted_at','parcel_id','address','zip','legacy_id','updated_at']) c;

\if :had_rows
select t.eq((select count(*)::int from public.leads where coalesce(name, '') not like 'T-LEAD-%'), 30, '017 legacy rows untouched in count (30)');
select t.eq((select count(*)::int from public.leads where stage = 'new' and coalesce(name, '') not like 'T-LEAD-%'),           6, '017 backfill: New/blank status -> stage new');
select t.eq((select count(*)::int from public.leads where stage = 'contacted' and coalesce(name, '') not like 'T-LEAD-%'),     9, '017 backfill: Called/Callback/Interested -> contacted');
select t.eq((select count(*)::int from public.leads where stage = 'estimate_sent' and coalesce(name, '') not like 'T-LEAD-%'), 3, '017 backfill: Quoted -> estimate_sent');
select t.eq((select count(*)::int from public.leads where stage = 'won' and coalesce(name, '') not like 'T-LEAD-%'),           6, '017 backfill: Deposit collected/Contract signed -> won');
select t.eq((select count(*)::int from public.leads where stage = 'lost' and coalesce(name, '') not like 'T-LEAD-%'),         3, '017 backfill: Not interested -> lost');
select t.eq((select count(*)::int from public.leads where stage = 'nurture' and coalesce(name, '') not like 'T-LEAD-%'),      3, '017 backfill: Archived -> nurture');
select t.ok(not exists (select 1 from public.leads where updated_at < '2026-09-02 12:00:00+00' or updated_at > '2026-09-04 00:00:00+00'),
            '017 backfill did not bump legacy updated_at');
select t.eq((select count(*)::int from public.leads where parcel_id is not null and btrim(parcel_id) = ''), 0, '017 blank parcel_ids normalised to NULL');
select t.eq((select count(*)::int from public.leads where name is null and legacy_id in ('7','8')), 2, '017 null names tolerated (2 rows kept with NULL name)');
select t.eq((select count(*)::int from public.leads where phones = '[]'::jsonb), 30 + (select count(*)::int from public.leads where name like 'T-LEAD-%'), '017 phones defaults to []');
\endif

-- ---------------------------------------------------------------- re-apply does not redo the stage backfill
select t.mk_lead('T-LEAD-keep', null, 'New', null, 'assessment_booked') as keep_id \gset
select t.mk_lead('T-LEAD-won-new', null, 'New', null, 'won') as won_id \gset
\if :had_rows
update public.leads set stage = 'assessment_booked' where legacy_id = '1';
\endif
select updated_at as before_ts from public.leads where id = :'keep_id' \gset
\i :mig017
select t.eq((select stage from public.leads where id = :'keep_id'), 'assessment_booked', '017 re-run keeps hand-set stage assessment_booked');
select t.eq((select stage from public.leads where id = :'won_id'), 'won', '017 re-run keeps hand-set stage won although status is New');
select t.ok((select updated_at = :'before_ts'::timestamptz from public.leads where id = :'keep_id'), '017 re-run does not touch updated_at');
\if :had_rows
select t.eq((select stage from public.leads where legacy_id = '1'), 'assessment_booked', '017 re-run keeps hand-moved legacy lead stage');
\endif

-- ---------------------------------------------------------------- updated_at trigger
select pg_sleep(0.05);
update public.leads set notes = 'x' where id = :'keep_id';
select t.ok((select updated_at > :'before_ts'::timestamptz from public.leads where id = :'keep_id'), '017 updated_at trigger bumps on update');
select t.ok((select created_at <= updated_at from public.leads where id = :'keep_id'), '017 created_at untouched / <= updated_at');
update public.leads set updated_at = '2001-01-01' where id = :'keep_id';
select t.ok((select updated_at > '2020-01-01' from public.leads where id = :'keep_id'), '017 trigger overrides a client-supplied updated_at');

-- ---------------------------------------------------------------- legacy_id assignment
select max(legacy_id::bigint) as max_before from public.leads where legacy_id ~ '^[0-9]{1,15}$' \gset
select t.mk_lead('T-LEAD-auto1') as auto1 \gset
select t.mk_lead('T-LEAD-auto2') as auto2 \gset
select t.eq((select legacy_id from public.leads where id = :'auto1'), (coalesce(:max_before, 0) + 1)::text, '017 legacy_id auto-assigned max+1');
select t.eq((select legacy_id from public.leads where id = :'auto2'), (coalesce(:max_before, 0) + 2)::text, '017 legacy_id auto-assigned sequentially');
select t.mk_lead('T-LEAD-web', null, 'New', 'web_abc123') as web1 \gset
select t.eq((select legacy_id from public.leads where id = :'web1'), 'web_abc123', '017 explicit non-numeric legacy_id untouched');
select t.mk_lead('T-LEAD-big', null, 'New', '90000') as big1 \gset
select t.mk_lead('T-LEAD-auto3') as auto3 \gset
select t.eq((select legacy_id from public.leads where id = :'auto3'), '90001', '017 next legacy_id follows highest numeric one');
select t.mk_lead('T-LEAD-blank', null, 'New', '  ') as blank1 \gset
select t.ok((select legacy_id ~ '^[0-9]+$' from public.leads where id = :'blank1'), '017 whitespace-only legacy_id is replaced');
select t.mk_lead('T-LEAD-long', null, 'New', '99999999999999999999') as long1 \gset
select t.lives($$select t.mk_lead('T-LEAD-after-long')$$, '017 a 20-digit numeric legacy_id does not break later inserts (regex limits to 15 digits)');

-- ---------------------------------------------------------------- parcel uniqueness
\if :has_uidx
select t.ok(true, '017 unique parcel index exists in this state (no duplicates at apply time)');
select t.mk_lead('T-LEAD-p1', 'T-PARCEL-1') as p1 \gset
select t.throws($$select t.mk_lead('T-LEAD-p1b', 'T-PARCEL-1')$$, 'unique|duplicate', '017 second live lead with same parcel_id rejected');
select t.lives($$select t.mk_lead('T-LEAD-p-null-1'); select t.mk_lead('T-LEAD-p-null-2')$$, '017 many leads with NULL parcel_id allowed');
select t.lives($$select t.mk_lead('T-LEAD-p-blank-1', ''); select t.mk_lead('T-LEAD-p-blank-2', '')$$, '017 many leads with blank parcel_id allowed (index ignores blanks)');
update public.leads set deleted_at = now() where id = :'p1';
select t.lives($$select t.mk_lead('T-LEAD-p1c', 'T-PARCEL-1')$$, '017 parcel_id reusable once the holder is soft-deleted');
select t.ok((select indexdef ~* 'unique' from pg_indexes where indexname = 'leads_parcel_id_uidx'), '017 index is UNIQUE');
select t.ok((select indexdef ~* 'deleted_at is null' from pg_indexes where indexname = 'leads_parcel_id_uidx'), '017 unique index is partial on live rows');
\else
select t.ok(true, '017 duplicates existed: unique index skipped (state b)');
select t.ok(exists (select 1 from pg_indexes where indexname = 'leads_parcel_id_idx'), '017 duplicates: plain parcel_id index created instead');
select t.lives($$select t.mk_lead('T-LEAD-dupA', 'T-PARCEL-D'); select t.mk_lead('T-LEAD-dupB', 'T-PARCEL-D')$$, '017 duplicates state: migration does not block duplicate inserts (API dedupes)');
-- resolve the legacy duplicates (keep lowest legacy_id live, null the rest), then re-run 017: the unique index must appear
delete from public.leads where name = 'T-LEAD-dupB';
select count(*)::int as dups_before from (select parcel_id from public.leads where parcel_id is not null and deleted_at is null group by 1 having count(*) > 1) d \gset
select t.eq(:dups_before, 2, '017 fixture has the 2 duplicated parcel_ids (P-100, P-200)');
update public.leads set parcel_id = null
 where id in (select id from (select id, row_number() over (partition by parcel_id order by legacy_id::int) rn from public.leads where parcel_id in ('P-100','P-200') and deleted_at is null) q where rn > 1);
delete from public.leads where name = 'T-LEAD-dupA';
\i :mig017
select t.ok(exists (select 1 from pg_indexes where indexname = 'leads_parcel_id_uidx'), '017 after dedupe + re-run the unique index is created');
select t.ok(not exists (select 1 from pg_indexes where indexname = 'leads_parcel_id_idx'), '017 plain index dropped once the unique index exists (no redundant index)');
select t.throws($$select t.mk_lead('T-LEAD-q1', 'P-100'); select t.mk_lead('T-LEAD-q2', 'P-100')$$, 'unique|duplicate', '017 after dedupe, duplicate parcel_id is rejected');
\endif

-- ---------------------------------------------------------------- funnel view
create temp table _f0 as select stage, leads, amount from public.lead_funnel;
select t.mk_lead('T-LEAD-f1', null, 'New', null, 'new', 100) \gset
select t.mk_lead('T-LEAD-f2', null, 'New', null, 'won', 200) \gset
select t.mk_lead('T-LEAD-f3', null, 'New', null, 'won', 300) \gset
select t.mk_lead('T-LEAD-f4', null, 'New', null, 'won', 4000, true) as f4 \gset
create temp table _f1 as select stage, leads, amount from public.lead_funnel;
select t.eq((select leads from _f1 where stage = 'new') - coalesce((select leads from _f0 where stage = 'new'), 0), 1, '017 funnel counts a new live lead');
select t.eq((select leads from _f1 where stage = 'won') - coalesce((select leads from _f0 where stage = 'won'), 0), 2, '017 funnel counts live won leads, soft-deleted one excluded');
select t.eq((select amount from _f1 where stage = 'won') - coalesce((select amount from _f0 where stage = 'won'), 0), 500::numeric, '017 funnel amount excludes soft-deleted lead (200+300, not +4000)');
select t.eq((select sum(leads)::int from public.lead_funnel), (select count(*)::int from public.leads where deleted_at is null), '017 funnel total equals live lead count');
select t.ok(not exists (select 1 from public.lead_funnel where stage not in ('new','contacted','assessment_booked','estimate_sent','won','lost','nurture')), '017 funnel only has valid stages');

-- ---------------------------------------------------------------- stage check
select t.throws($$select t.mk_lead('T-LEAD-badstage', null, 'New', null, 'bogus')$$, 'leads_stage_check|check', '017 invalid stage rejected by check constraint');

-- ---------------------------------------------------------------- tasks due (America/New_York)
select t.mk_lead('T-LEAD-task', null, 'New', null, 'contacted') as tl \gset
select t.mk_lead('T-LEAD-task-del', null, 'New', null, 'contacted', null, true) as tl_del \gset
with b as (select (now() at time zone 'America/New_York')::date as d)
insert into public.lead_tasks (lead_id, type, due_at, note, created_by)
select :'tl'::uuid, 'call', ((b.d - 1) + time '23:59') at time zone 'America/New_York', 'overdue-yesterday-2359', 'test' from b union all
select :'tl'::uuid, 'text', (b.d + time '00:01') at time zone 'America/New_York',       'today-0001', 'test' from b union all
select :'tl'::uuid, 'email', (b.d + time '23:59') at time zone 'America/New_York',      'today-2359', 'test' from b union all
select :'tl'::uuid, 'visit', ((b.d + 1) + time '00:01') at time zone 'America/New_York', 'tomorrow-0001', 'test' from b union all
select :'tl_del'::uuid, 'call', (b.d + time '12:00') at time zone 'America/New_York',   'on-deleted-lead', 'test' from b;
insert into public.lead_tasks (lead_id, type, due_at, note, done_at, created_by)
  values (:'tl'::uuid, 'call', now() - interval '3 days', 'done-overdue', now(), 'test');
create temp table _due as select * from public.lead_tasks_due where lead_id = :'tl';
select t.eq((select count(*)::int from _due), 3, '017 tasks_due returns overdue + today (3 of 4 open tasks, ET)');
select t.eq((select bucket from _due where note = 'overdue-yesterday-2359'), 'overdue', '017 yesterday 23:59 ET is overdue');
select t.eq((select bucket from _due where note = 'today-0001'), 'today', '017 today 00:01 ET is today (even if already yesterday in UTC)');
select t.eq((select bucket from _due where note = 'today-2359'), 'today', '017 today 23:59 ET is today (even if already tomorrow in UTC)');
select t.ok(not exists (select 1 from _due where note = 'tomorrow-0001'), '017 tomorrow 00:01 ET is not due');
select t.ok(not exists (select 1 from _due where note = 'done-overdue'), '017 done task excluded');
select t.ok(not exists (select 1 from public.lead_tasks_due where lead_id = :'tl_del'), '017 task of soft-deleted lead excluded');
select t.eq((select lead_phone from _due limit 1), '(386) 555-0199', '017 tasks_due carries lead_phone');
select t.eq((select lead_phone_dnc from _due limit 1), true, '017 tasks_due carries lead_phone_dnc');
select t.eq((select lead_stage from _due limit 1), 'contacted', '017 tasks_due carries lead_stage');
select t.eq((select lead_name from _due limit 1), 'T-LEAD-task', '017 tasks_due carries lead_name');
select t.eq((select is_next_action from _due limit 1), false, '017 is_next_action defaults false');
select t.ok((select due_at < now() from _due where note = 'overdue-yesterday-2359'), 'overdue task is in the past');
select pg_sleep(0.05);
create temp table _tt as select updated_at u0 from public.lead_tasks where note = 'today-0001';
update public.lead_tasks set note = 'today-0001' where note = 'today-0001';
select t.ok((select updated_at > u0 from public.lead_tasks, _tt where note = 'today-0001'), '017 lead_tasks updated_at trigger');

-- ---------------------------------------------------------------- activity / tasks / estimates / jobs FKs
select t.mk_lead('T-LEAD-fk') as fk \gset
select t.throws($$insert into public.lead_activity (lead_id, type) values (gen_random_uuid(), 'note')$$, 'foreign key|violates', '017 activity FK: unknown lead rejected');
select t.throws($$insert into public.lead_tasks (lead_id, due_at) values (gen_random_uuid(), now())$$, 'foreign key|violates', '017 tasks FK: unknown lead rejected');
select t.throws($$insert into public.lead_estimates (lead_id) values (gen_random_uuid())$$, 'foreign key|violates', '017 estimates FK: unknown lead rejected');
select t.throws($$insert into public.lead_jobs (lead_id) values (gen_random_uuid())$$, 'foreign key|violates', '017 jobs FK: unknown lead rejected');
select t.throws(format($$insert into public.lead_activity (lead_id, type) values (%L, 'bogus')$$, :'fk'), 'check', '017 activity type check');
select t.throws(format($$insert into public.lead_activity (lead_id, type, direction) values (%L, 'call', 'sideways')$$, :'fk'), 'check', '017 activity direction check');
select t.throws(format($$insert into public.lead_tasks (lead_id, type, due_at) values (%L, 'fax', now())$$, :'fk'), 'check', '017 task type check');
insert into public.lead_activity (lead_id, type, body) values (:'fk', 'note', 'n1'), (:'fk', 'call', 'c1');
insert into public.lead_tasks (lead_id, due_at) values (:'fk', now());
insert into public.lead_estimates (lead_id, line_items, total) values (:'fk', '[{"d":"x"}]', 1) returning id as est1 \gset
insert into public.lead_estimates (lead_id) values (:'fk') returning id as est2 \gset
insert into public.lead_jobs (lead_id, estimate_id) values (:'fk', :'est1') returning id as job1 \gset
-- estimate delete -> job survives, estimate_id nulled
delete from public.lead_estimates where id = :'est1';
select t.ok((select estimate_id is null from public.lead_jobs where id = :'job1'), '017 jobs.estimate_id set null when estimate deleted');
select t.eq((select count(*)::int from public.lead_jobs where id = :'job1'), 1, '017 job survives estimate delete');
-- lead delete cascades
delete from public.leads where id = :'fk';
select t.eq((select count(*)::int from public.lead_activity where lead_id = :'fk'), 0, '017 hard-deleting a lead cascades to activity');
select t.eq((select count(*)::int from public.lead_tasks where lead_id = :'fk'), 0, '017 ... to tasks');
select t.eq((select count(*)::int from public.lead_estimates where lead_id = :'fk'), 0, '017 ... to estimates');
select t.eq((select count(*)::int from public.lead_jobs where lead_id = :'fk'), 0, '017 ... to jobs');
select t.mk_lead('T-LEAD-soft') as soft \gset
insert into public.lead_activity (lead_id, type) values (:'soft', 'note');
update public.leads set deleted_at = now() where id = :'soft';
select t.eq((select count(*)::int from public.lead_activity where lead_id = :'soft'), 1, '017 soft delete keeps history');

-- ---------------------------------------------------------------- estimates: token + number
select t.mk_lead('T-LEAD-est') as el \gset
insert into public.lead_estimates (lead_id) values (:'el') returning id as e1 \gset
insert into public.lead_estimates (lead_id) values (:'el') returning id as e2 \gset
select t.ok((select count(distinct public_token) = 2 from public.lead_estimates where id in (:'e1', :'e2')), '017 default public_tokens are distinct');
select t.ok((select bool_and(length(public_token) = 64 and public_token ~ '^[0-9a-f]+$') from public.lead_estimates where id in (:'e1', :'e2')), '017 public_token is 64 hex chars');
select t.ok((select count(distinct number) = 2 and bool_and(number ~ '^E-[0-9]+$') from public.lead_estimates where id in (:'e1', :'e2')), '017 estimate numbers distinct E-nnnn');
select public_token as tok1 from public.lead_estimates where id = :'e1' \gset
select t.throws(format($$update public.lead_estimates set public_token = %L where id = %L$$, :'tok1', :'e2'), 'unique|duplicate', '017 public_token uniqueness enforced');
select number as num1 from public.lead_estimates where id = :'e1' \gset
select t.throws(format($$update public.lead_estimates set number = %L where id = %L$$, :'num1', :'e2'), 'unique|duplicate', '017 estimate number uniqueness enforced');
select t.throws(format($$insert into public.lead_estimates (lead_id, status) values (%L, 'weird')$$, :'el'), 'check', '017 estimate status check');
select t.throws(format($$insert into public.lead_jobs (lead_id, status) values (%L, 'weird')$$, :'el'), 'check', '017 job status check');
select t.throws(format($$insert into public.lead_jobs (lead_id, invoice_status) values (%L, 'weird')$$, :'el'), 'check', '017 job invoice_status check');

-- ---------------------------------------------------------------- RLS + grants (004 pattern)
select t.ok((select relrowsecurity from pg_class where oid = ('public.' || x)::regclass), '017 RLS enabled on ' || x)
  from unnest(array['leads','lead_activity','lead_tasks','lead_estimates','lead_jobs']) x;
select t.eq((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('leads','lead_activity','lead_tasks','lead_estimates','lead_jobs')), 0, '017 no permissive policies (deny by default under RLS)');
select t.ok(not has_table_privilege(r, 'public.' || x, p), format('017 %s has no %s on %s', r, p, x))
  from unnest(array['anon','authenticated']) r, unnest(array['leads','lead_activity','lead_tasks','lead_estimates','lead_jobs','lead_funnel','lead_tasks_due']) x,
       unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select t.ok(has_table_privilege('service_role', 'public.' || x, p), format('017 service_role has %s on %s', p, x))
  from unnest(array['leads','lead_activity','lead_tasks','lead_estimates','lead_jobs']) x, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select t.ok(has_table_privilege('service_role', 'public.' || x, 'SELECT'), '017 service_role can select view ' || x) from unnest(array['lead_funnel','lead_tasks_due']) x;
select t.ok(not has_sequence_privilege(r, 'public.lead_estimate_number_seq', 'USAGE'), '017 ' || r || ' has no USAGE on lead_estimate_number_seq') from unnest(array['anon','authenticated']) r;
select t.ok(has_sequence_privilege('service_role', 'public.lead_estimate_number_seq', 'USAGE'), '017 service_role has USAGE on the estimate sequence');

-- live role switch: anon / authenticated denied, service_role allowed
set role anon;
select t.throws('select count(*) from public.leads', 'permission denied', '017 anon cannot select leads');
select t.throws($$insert into public.leads (name) values ('T-LEAD-anon')$$, 'permission denied', '017 anon cannot insert leads');
select t.throws('select * from public.lead_funnel', 'permission denied', '017 anon cannot read lead_funnel');
select t.throws('select * from public.lead_tasks_due', 'permission denied', '017 anon cannot read lead_tasks_due');
select t.throws('select * from public.lead_activity', 'permission denied', '017 anon cannot read lead_activity');
select t.throws('select * from public.lead_estimates', 'permission denied', '017 anon cannot read estimates (public_token stays private)');
reset role;
set role authenticated;
select t.throws('select count(*) from public.leads', 'permission denied', '017 authenticated cannot select leads');
select t.throws($$update public.leads set name = 'x'$$, 'permission denied', '017 authenticated cannot update leads');
select t.throws('select * from public.lead_tasks', 'permission denied', '017 authenticated cannot read lead_tasks');
select t.throws('select * from public.lead_jobs', 'permission denied', '017 authenticated cannot read lead_jobs');
select t.throws('select * from public.lead_funnel', 'permission denied', '017 authenticated cannot read lead_funnel');
reset role;
set role service_role;
select t.lives('select count(*) from public.leads', '017 service_role can select leads');
select t.lives($$insert into public.lead_activity (lead_id, type, body) select id, 'note', 'svc' from public.leads where name = 'T-LEAD-soft'$$, '017 service_role can insert activity');
select t.lives($$update public.leads set notes = 'svc' where name = 'T-LEAD-soft'$$, '017 service_role can update leads (trigger fires without extra privileges)');
select t.lives($$insert into public.leads (org_id, name) values ((select id from public.organizations limit 1), 'T-LEAD-svc')$$, '017 service_role can insert a lead (legacy_id trigger + sequence)') where to_regclass('public.organizations') is not null;
select t.lives($$insert into public.leads (name) values ('T-LEAD-svc')$$, '017 service_role can insert a lead (legacy_id trigger + sequence)') where to_regclass('public.organizations') is null;
select t.lives('select * from public.lead_funnel', '017 service_role can read lead_funnel');
select t.lives('select * from public.lead_tasks_due', '017 service_role can read lead_tasks_due');
select t.lives($$insert into public.lead_estimates (lead_id) select id from public.leads where name = 'T-LEAD-svc'$$, '017 service_role can insert estimate (sequence default)');
reset role;

-- ---------------------------------------------------------------- cleanup
delete from public.lead_jobs where lead_id in (select id from public.leads where name like 'T-LEAD-%');
delete from public.leads where name like 'T-LEAD-%';
