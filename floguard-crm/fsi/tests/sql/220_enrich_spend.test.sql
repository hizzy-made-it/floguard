-- scenarios: a b c d e
-- Behaviour tests for fsi/sql/022_enrich_daily_spend.sql (review agent R1).
\set ON_ERROR_STOP on
set search_path = "$user", public, extensions;

delete from public.enrich_spend_daily where day = '1999-01-01';
select t.eq((select granted from public.enrich_spend_reserve('1999-01-01', 50, 120)), 50, '022 first reservation granted in full');
select t.eq((select granted from public.enrich_spend_reserve('1999-01-01', 50, 120)), 50, '022 second reservation granted in full');
select t.eq((select granted from public.enrich_spend_reserve('1999-01-01', 50, 120)), 20, '022 third reservation capped at what is left');
select t.eq((select granted from public.enrich_spend_reserve('1999-01-01', 50, 120)), 0, '022 nothing left once the cap is reached');
select t.eq((select reserved from public.enrich_spend_release('1999-01-01', 30, 20)), 90, '022 release returns unused lookups');
select t.eq((select used from public.enrich_spend_daily where day = '1999-01-01'), 20, '022 release records what was spent');
select t.eq((select granted from public.enrich_spend_reserve('1999-01-01', 50, 120)), 30, '022 released lookups can be reserved again');
select t.eq((select granted from public.enrich_spend_reserve('1999-01-01', -5, 120)), 0, '022 negative want grants nothing');
select t.eq((select granted from public.enrich_spend_reserve('1999-01-02', 10, 0)), 0, '022 cap 0 grants nothing');
select t.eq((select reserved from public.enrich_spend_release('1999-01-01', 100000, 0)), 0, '022 release never goes below zero');
select t.ok(not has_function_privilege('authenticated', 'public.enrich_spend_reserve(date,integer,integer)', 'execute'), '022 reserve closed to authenticated');
delete from public.enrich_spend_daily where day in ('1999-01-01', '1999-01-02');
