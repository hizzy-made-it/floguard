-- scenarios: a b c d e
-- Behaviour tests for fsi/sql/021_field_reports.sql (review agent R1).
\set ON_ERROR_STOP on
set search_path = "$user", public, extensions;

delete from public.parcel_field_reports where parcel_id like 'T-FR-%';
delete from public.parcel_risk where parcel_id like 'T-FR-%';
insert into public.parcel_risk (parcel_id, lat, lon, fsi_live, fsi_static, hsg, fema_zone) values ('T-FR-1', 29.1, -81.1, 61.5, 0.62, 'D', 'X');

insert into public.parcel_field_reports (parcel_id, report, rep) values ('T-FR-1', 'water_confirmed', 'amy');
select t.ok((select (inputs_at->>'fsi_live')::real = 61.5 and inputs_at->>'hsg' = 'D' from public.parcel_field_reports where parcel_id = 'T-FR-1' and rep = 'amy'),
            '021 first insert snapshots the parcel inputs');
update public.parcel_risk set fsi_live = 10 where parcel_id = 'T-FR-1';
insert into public.parcel_field_reports (parcel_id, report, rep) values ('T-FR-1', 'not_a_problem', 'amy')
  on conflict (parcel_id, rep) do update set report = excluded.report, inputs_at = excluded.inputs_at, reported_at = excluded.reported_at;
select t.eq((select count(*)::int from public.parcel_field_reports where parcel_id = 'T-FR-1'), 1, '021 one row per parcel and rep (upsert)');
select t.ok((select report = 'not_a_problem' and (inputs_at->>'fsi_live')::real = 61.5 from public.parcel_field_reports where parcel_id = 'T-FR-1'),
            '021 a correction keeps the first snapshot even when the upsert sends one');
insert into public.parcel_field_reports (parcel_id, report, rep) values ('T-FR-1', 'water_confirmed', 'bob');
insert into public.parcel_field_reports (parcel_id, report, rep) values ('T-FR-9', 'water_confirmed', 'bob');
select t.eq((select inputs_at from public.parcel_field_reports where parcel_id = 'T-FR-9'), '{}'::jsonb, '021 unknown parcel: empty snapshot, report kept');
select t.throws($$insert into public.parcel_field_reports (parcel_id, report, rep) values ('T-FR-1', 'won', 'cy')$$, 'check constraint', '021 report must be water_confirmed or not_a_problem');

-- calibration view: proxy-label columns, withdrawn rows excluded
select t.eq((select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns where table_name = 'parcel_field_report_labels'),
            'parcel_id,date,label,label_source,weight', '021 label view has the calibrate.py --proxy columns');
select t.eq((select sum(label)::int from public.parcel_field_report_labels where parcel_id like 'T-FR-%'), 2, '021 labels: water=1, not a problem=0');
update public.parcel_field_reports set withdrawn_at = now() where parcel_id = 'T-FR-1' and rep = 'bob';
select t.eq((select count(*)::int from public.parcel_field_report_labels where parcel_id = 'T-FR-1'), 1, '021 withdrawn reports leave the label view');
select t.ok(not has_table_privilege('anon', 'public.parcel_field_reports', 'select') and not has_table_privilege('authenticated', 'public.parcel_field_report_labels', 'select'),
            '021 closed to anon/authenticated');

delete from public.parcel_field_reports where parcel_id like 'T-FR-%';
delete from public.parcel_risk where parcel_id like 'T-FR-%';
