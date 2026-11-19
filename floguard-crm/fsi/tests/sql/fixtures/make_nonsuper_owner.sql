-- Re-owns every object of the (cloned) baseline to a NON-superuser login role, like Supabase's `postgres`
-- role (CREATEROLE, not SUPERUSER). Proves 016/017 need no superuser-only operation.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'sb_owner') then create role sb_owner login createrole; end if;
end $$;
alter schema public owner to sb_owner;
alter schema extensions owner to sb_owner;
alter schema cron owner to sb_owner;
alter schema net owner to sb_owner;
alter schema t owner to sb_owner;
do $$ begin  -- PostGIS stand-in domain lives in extensions or public (run-local.sh POSTGIS_SCHEMA)
  execute format('alter domain %s owner to sb_owner',
    (select t.oid::regtype from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where t.typname = 'geometry' and n.nspname in ('public', 'extensions') limit 1));
end $$;
do $$
declare r record;
begin
  for r in select c.oid::regclass as n, c.relkind from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname in ('public','cron','net','t') and c.relkind in ('r','S','v')
              and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a','i')) loop
    execute format('alter %s %s owner to sb_owner',
      case r.relkind when 'S' then 'sequence' when 'v' then 'view' else 'table' end, r.n);
  end loop;
  for r in select p.oid::regprocedure as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname in ('public','cron','net','extensions','t') loop
    execute format('alter function %s owner to sb_owner', r.n);
  end loop;
end $$;
-- default privileges were registered for role postgres; mirror them for the new owner
alter default privileges for role sb_owner in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role sb_owner in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role sb_owner in schema public grant all on sequences to anon, authenticated, service_role;
