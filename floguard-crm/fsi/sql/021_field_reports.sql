-- 021: map "Report wrong" field reports as calibration labels (review agent R1, 2026-11-19).
-- Additive and idempotent. Not applied anywhere by the author. Depends on 001 (parcel_risk) and
-- 007 (touch_updated_at). Works before or after 018 (the snapshot reads columns through jsonb).
--
-- Written by api/lead-outcomes.js action 'field_report' (contract: docs/handoff/R1.md). A rep on the
-- map says "water confirmed" or "not a problem" for a parcel. These are NOT sales outcomes (no won /
-- lost), so they do not go into lead_outcomes (that would poison the outcome stream, see F2.md).
-- One live report per (parcel, rep); a rep changing their mind overwrites it, "un-reporting" sets
-- withdrawn_at (the row and its snapshot are kept for audit).
--
-- Calibration: the view parcel_field_report_labels has exactly the proxy-label columns that
-- fsi/pipeline/calibrate.py --proxy reads (parcel_id, date, label, label_source, weight):
--   \copy (select * from parcel_field_report_labels) to 'field_reports.csv' csv header
--   python -m pipeline.calibrate --parcels parcels.csv --outcomes lead_outcomes.csv \
--          --proxy field_reports.csv --target water --out report.json
-- (to combine with proxy_labels.py output, concatenate the two CSVs under one header).
-- weight 0.8: a rep's on-site look, not an assessment with measurements.

create table if not exists public.parcel_field_reports (
  id           uuid primary key default gen_random_uuid(),
  parcel_id    text not null,
  lead_id      text,
  report       text not null check (report in ('water_confirmed', 'not_a_problem')),
  note         text,
  rep          text not null,
  source       text not null default 'crm_map',
  reported_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  withdrawn_at timestamptz,
  inputs_at    jsonb not null default '{}'::jsonb,   -- model inputs of the parcel when first reported
  constraint parcel_field_reports_parcel_rep_key unique (parcel_id, rep)
);
create index if not exists parcel_field_reports_parcel_idx on public.parcel_field_reports (parcel_id) where withdrawn_at is null;

-- Snapshot the parcel's model inputs on first insert (same idea as lead_outcomes_snapshot, but via
-- jsonb so it does not depend on which migrations added which column).
create or replace function public.parcel_field_reports_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare j jsonb;
begin
  if tg_op = 'INSERT' then
    select to_jsonb(p) into j from public.parcel_risk p where p.parcel_id = new.parcel_id;
    if j is not null then
      new.inputs_at := jsonb_strip_nulls(jsonb_build_object(
        'fsi_live', j->'fsi_live', 'fsi_static', j->'fsi_static', 'fsi_static_v2', j->'fsi_static_v2',
        'model_version', j->'model_version', 'fsi_confidence', j->'fsi_confidence',
        'twi_n', j->'twi_n', 'hand_n', j->'hand_n', 'depr_n', j->'depr_n', 'hsg', j->'hsg',
        'fema_zone', j->'fema_zone', 'claim_heat', j->'claim_heat', 'must_have_band', j->'must_have_band',
        'twi_v2_n', j->'twi_v2_n', 'hand_v2_n', j->'hand_v2_n', 'depr_v2_n', j->'depr_v2_n',
        'nbr_rel_m', j->'nbr_rel_m', 'street_rel_m', j->'street_rel_m', 'wt_depth_m', j->'wt_depth_m',
        'drain_class', j->'drain_class'));
    end if;
  else
    new.inputs_at := old.inputs_at;      -- corrections keep the first snapshot
    new.reported_at := old.reported_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists parcel_field_reports_snapshot_trg on public.parcel_field_reports;
create trigger parcel_field_reports_snapshot_trg before insert or update on public.parcel_field_reports
  for each row execute function public.parcel_field_reports_snapshot();

alter table public.parcel_field_reports enable row level security;
revoke all on table public.parcel_field_reports from anon, authenticated;
grant select, insert, update, delete on table public.parcel_field_reports to service_role;

create or replace view public.parcel_field_report_labels with (security_invoker = true) as
select r.parcel_id,
       (r.reported_at at time zone 'America/New_York')::date as date,
       case r.report when 'water_confirmed' then 1 else 0 end as label,
       ('field_report_' || r.report)::text as label_source,
       0.8::real as weight
  from public.parcel_field_reports r
 where r.withdrawn_at is null;
revoke all on table public.parcel_field_report_labels from anon, authenticated;
grant select on table public.parcel_field_report_labels to service_role;

comment on table public.parcel_field_reports is
  'Map field reports (water_confirmed / not_a_problem) per parcel and rep. Calibration labels via parcel_field_report_labels. Not sales outcomes.';

notify pgrst, 'reload schema';
