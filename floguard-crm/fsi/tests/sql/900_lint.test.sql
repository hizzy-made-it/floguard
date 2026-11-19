-- scenarios: a b c d e
-- Generic catalog lint over every object created AFTER the 001..015 baseline (so 018+ are covered automatically).
--   * SECURITY DEFINER functions must pin search_path
--   * all functions must pin search_path (Supabase linter 0011)
--   * non-trigger functions: no EXECUTE for anon/authenticated/PUBLIC-by-default (006/016 pattern: revoke + grant service_role)
--   * tables/views: RLS on for tables, no privileges for anon/authenticated, full DML for service_role (004 pattern)
--   * views must be security_invoker (linter 0010); sequences closed to anon/authenticated
\set ON_ERROR_STOP on
set search_path = "$user", public, extensions;

create temp table _fns as
select p.oid, p.oid::regprocedure::text as sig, p.proname, p.prosecdef, p.prorettype = 'trigger'::regtype as is_trigger,
       coalesce((select bool_or(c like 'search_path=%') from unnest(p.proconfig) c), false) as pins_path
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind in ('f', 'p')
   and p.oid::regprocedure::text not in (select sig from t.baseline_fns)
   and p.oid not in (select objid from pg_depend where deptype = 'e');
select t.ok(count(*) > 0, 'lint sees new functions (' || count(*) || ')') from _fns;

select t.ok(pins_path, 'function pins search_path: ' || sig) from _fns where prosecdef;
select t.ok(pins_path, 'function pins search_path (linter 0011): ' || sig) from _fns where not prosecdef;
select t.ok(not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute'),
            'no anon/authenticated EXECUTE: ' || sig) from _fns where not is_trigger;
select t.ok(has_function_privilege('service_role', oid, 'execute'), 'service_role can EXECUTE: ' || sig) from _fns where not is_trigger;

create temp table _rels as
select c.oid, c.relname::text as name, c.relkind, c.relrowsecurity, c.reloptions
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'v', 'S')
   and c.relname not in (select name from t.baseline_rels)
   and c.relname not in ('organizations')            -- legacy test-fixture table, not created by a migration
   and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('i', 'a', 'e'));
select t.ok(relrowsecurity, 'RLS enabled: ' || name) from _rels where relkind = 'r';
select t.ok(not has_table_privilege('anon', oid, 'select,insert,update,delete') and not has_table_privilege('authenticated', oid, 'select,insert,update,delete')
            and not has_any_column_privilege('anon', oid, 'select') and not has_any_column_privilege('authenticated', oid, 'select'),
            'anon/authenticated have no privileges on ' || name) from _rels where relkind in ('r', 'v');
select t.ok(has_table_privilege('service_role', oid, 'select,insert,update,delete'), 'service_role has DML on ' || name) from _rels where relkind = 'r';
select t.ok(has_table_privilege('service_role', oid, 'select'), 'service_role can select view ' || name) from _rels where relkind = 'v';
select t.ok(coalesce(reloptions::text ilike '%security_invoker=true%', false), 'view is security_invoker: ' || name) from _rels where relkind = 'v';
select t.ok(not has_sequence_privilege('anon', oid, 'usage,select,update') and not has_sequence_privilege('authenticated', oid, 'usage,select,update'),
            'anon/authenticated have no privileges on sequence ' || name) from _rels where relkind = 'S';

-- pre-existing 007 helper keeps working after 017 re-declared it
select t.lives($$select pg_get_functiondef('public.touch_updated_at()'::regprocedure)$$, 'touch_updated_at() exists');
-- every public trigger function used by a trigger on the new tables exists and is enabled
select t.ok(tgenabled = 'O', 'trigger enabled: ' || tgname) from pg_trigger
 where not tgisinternal and tgrelid in ('public.leads'::regclass, 'public.lead_tasks'::regclass, 'public.lead_estimates'::regclass, 'public.lead_jobs'::regclass);
-- cron entries from 005..009 survive (016/017 must not touch them)
select t.ok((select count(*) from cron.job) >= 3, 'cron stand-in still has the 005..009 jobs');
