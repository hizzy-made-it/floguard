-- scenarios: a b c d e
-- Behaviour tests for fsi/sql/016_claims_block_group.sql (+ must-have scoring from 015 afterwards).
-- Formula under test (documented in 016):
--   weighted = 1*sfha_10y + 2*zone_x_10y + 1*other_10y
--   heat     = min(1, ln(1+weighted) / ln(1+ref)),  ref = max(5, percentile_cont(0.95) of weighted over weighted>0)
\set ON_ERROR_STOP on
set search_path = "$user", public, extensions;

-- cleanup of any previous run
delete from public.parcel_risk where parcel_id like 'T-CLM-%';
delete from public.nfip_claim_event where block_group like '9912700%';
delete from public.nfip_claim_block_group where block_group like '9912700%';
delete from public.nfip_claim_tract where census_tract like '99127%';
-- isolate: the county-wide p95 must only see our rows
create temp table _saved_bg as select * from public.nfip_claim_block_group;
delete from public.nfip_claim_block_group;

-- block groups (fake state code 99 so they cannot collide with real data)
insert into public.nfip_claim_block_group
  (block_group, tract, housing_units, claim_count_all, claim_count_10y, claim_last_year, paid_total_10y,
   claim_sfha_10y, claim_zone_x_10y, claim_other_10y, top_event, geom_geojson) values
  ('991270001001', '99127000100',  400,  3,  2, 2022,  20000, 2, 0, 0, 'Hurricane Ian (2022)', '{"type":"Polygon","coordinates":[]}'),
  ('991270001002', '99127000100',  800,  7,  3, 2022,  35000, 0, 3, 0, 'Hurricane Ian (2022)', null),
  ('991270002001', '99127000200',  500,  6,  3, 2020,  15000, 1, 1, 1, null,                   null),
  ('991270002002', '99127000200',  500,  0,  0, null,      0, 0, 0, 0, null,                   null),
  ('991270003001', '99127000300', 1000, 15, 10, 2024, 220000, 0,10, 0, 'Hurricane Ian (2022)', null),
  ('991270003002', '99127000300', 1000, 12, 10, 2024, 180000,10, 0, 0, 'Hurricane Ian (2022)', null),
  ('991270004001', '99127000400', null,  2,  1, 2023,   5000, 0, 1, 0, null,                   null),
  ('991270004002', '99127000400',    0,  2,  1, 2023,   5000, 0, 1, 0, null,                   null);

select t.eq(public.nfip_recompute_block_group_heat(), 8, '016 recompute touches every block-group row');
select t.eq((select count(*) from public.nfip_claim_block_group where heat < 0 or heat > 1)::int, 0, '016 heat stays within 0..1');

-- ref = max(5, p95{2,2,2,4,6,10,20}) = 17; computed independently below from the documented formula
create temp table _exp as
with w as (select block_group, 1.0*claim_sfha_10y + 2.0*claim_zone_x_10y + 1.0*claim_other_10y as w from public.nfip_claim_block_group),
     r as (select greatest(5, percentile_cont(0.95) within group (order by w)) as ref from w where w > 0)
select w.block_group, w.w, least(1, ln(1 + w.w) / ln(1 + r.ref)) as heat, r.ref from w, r;
select t.near((select ref from _exp limit 1), 17.0, '016 p95 reference matches hand calc (weighted {2,2,2,4,6,10,20}: position 5.7 -> 10 + 0.7*10 = 17.0)') ;
select t.near((select heat from public.nfip_claim_block_group where block_group = '991270001001'), 0.380094, '016 heat bg w=2  = ln3/ln18', 1e-4);
select t.near((select heat from public.nfip_claim_block_group where block_group = '991270001002'), 0.673239, '016 heat bg w=6  = ln7/ln18 (3 zone X claims)', 1e-4);
select t.near((select heat from public.nfip_claim_block_group where block_group = '991270002001'), 0.556827, '016 heat bg w=4  = ln5/ln18 (1 sfha + 1 zone X + 1 other)', 1e-4);
select t.near((select heat from public.nfip_claim_block_group where block_group = '991270003002'), 0.829615, '016 heat bg w=10 = ln11/ln18 (10 SFHA claims)', 1e-4);
select t.eq((select heat from public.nfip_claim_block_group where block_group = '991270003001'), 1::real, '016 heat caps at 1 (10 zone X claims, w=20 > ref)');
select t.eq((select heat from public.nfip_claim_block_group where block_group = '991270002002'), 0::real, '016 zero-claim block group has heat 0');
select t.ok((select heat from public.nfip_claim_block_group where block_group = '991270003001')
          > (select heat from public.nfip_claim_block_group where block_group = '991270003002'),
          '016 zone-X weighting: 10 zone X claims out-heat 10 SFHA claims');
select t.ok(not exists (select 1 from public.nfip_claim_block_group b join _exp e using (block_group) where abs(b.heat - e.heat) > 1e-5),
          '016 stored heat equals independent formula for every row');
select t.eq((select claim_rate_10y from public.nfip_claim_block_group where block_group = '991270003001'), 0.01::real, '016 rate = count_10y / housing_units');
select t.eq((select claim_rate_zone_x_10y from public.nfip_claim_block_group where block_group = '991270003001'), 0.01::real, '016 zone-X rate');
select t.ok((select claim_rate_10y is null from public.nfip_claim_block_group where block_group = '991270004001'), '016 rate null when housing_units is null');
select t.ok((select claim_rate_10y is null from public.nfip_claim_block_group where block_group = '991270004002'), '016 rate null when housing_units = 0 (no divide by zero)');
select t.eq(public.nfip_weighted_count(null, null, null), 0::double precision, '016 nfip_weighted_count treats nulls as 0');
select t.eq(public.nfip_weighted_count(1, 1, 1), 4::double precision, '016 nfip_weighted_count 1+2+1');

-- recompute is stable: same heat on a second call
create temp table _h1 as select block_group, heat, claim_rate_10y from public.nfip_claim_block_group;
select public.nfip_recompute_block_group_heat();
select t.ok(not exists (select 1 from public.nfip_claim_block_group b join _h1 h using (block_group)
                         where b.heat is distinct from h.heat or b.claim_rate_10y is distinct from h.claim_rate_10y),
            '016 recompute is stable on repeat');

-- empty table: ref falls back to 5 and nothing errors
create temp table _bgs as select * from public.nfip_claim_block_group;
delete from public.nfip_claim_block_group;
select t.eq(public.nfip_recompute_block_group_heat(), 0, '016 recompute on empty table returns 0');
insert into public.nfip_claim_block_group select * from _bgs;

-- geometry builder (stand-in functions only locally; real PostGIS path is unverifiable here)
select t.eq(public.nfip_claim_bg_build_geom(), 1, '016 build_geom touches only rows with geom_geojson');

-- parcels ---------------------------------------------------------------
insert into public.nfip_claim_tract (census_tract, claim_count_10y, claim_count_all, paid_sum, last_loss_year, heat)
  values ('99127000900', 4, 9, 12345, 2019, 0.42), ('99127000100', 99, 99, 999, 2001, 0.99);
-- common scoring attributes: improved house, zone X, clay soil, fsi_live 50
insert into public.parcel_risk (parcel_id, lat, lon, block_group, census_tract, claim_heat, claim_bg_count_10y, claim_count_10y,
                                fema_zone, hsg, fsi_live, just_value, living_area, year_built, homestead) values
  ('T-CLM-1', 29.1, -81.1, '991270001002', '99127000100', 0.9,  null, null, 'X', 'D', 50, 300000, 2000, 1970, 'Y'),  -- hot bg, tract also present (bg wins)
  ('T-CLM-2', 29.1, -81.1, '991270002002', '99127000200', 0.9,  null, null, 'X', 'D', 50, 300000, 2000, 1970, 'Y'),  -- zero-claim bg => heat 0
  ('T-CLM-3', 29.1, -81.1, null,           '99127000900', 0.1,  null, null, 'X', 'D', 50, 300000, 2000, 1970, 'Y'),  -- no bg: tract fallback 0.42
  ('T-CLM-4', 29.1, -81.1, '990000000000', '99127000900', 0.1,  null, null, 'X', 'D', 50, 300000, 2000, 1970, 'Y'),  -- bg not in table: tract fallback
  ('T-CLM-5', 29.1, -81.1, null,           null,           0.33, null, null, 'X', 'D', 50, 300000, 2000, 1970, 'Y'),  -- nothing to apply: untouched
  ('T-CLM-6', 29.1, -81.1, '991270003001', '99127000300', 0.0,  null, null, 'X', 'D', 50, 300000, 2000, 1970, 'Y'),  -- zone X heavy bg => 1
  ('T-CLM-7', 29.1, -81.1, null,           '99127000900', 0.8,  5,    5,    'X', 'D', 50, 300000, 2000, 1970, 'Y'),  -- stale claim_bg_* must be cleared on fallback
  ('T-CLM-8', 29.1, -81.1, '991270003002', '99127000300', 0.0,  null, null, 'AE','D', 50, 300000, 2000, 1970, 'Y');  -- sfha heavy bg

-- bad bucket arguments
select t.throws('select public.nfip_apply_block_group_claims(8, 8)', 'bad bucket', '016 apply rejects bucket >= buckets');
select t.throws('select public.nfip_apply_block_group_claims(0, 0)', 'bad bucket', '016 apply rejects buckets < 1');
select t.throws('select public.nfip_apply_block_group_claims(8, -1)', 'bad bucket', '016 apply rejects negative bucket');

-- all 8 buckets, as the ingest does
create temp table _applied as
  select b, public.nfip_apply_block_group_claims(8, b) as n from generate_series(0, 7) b;
-- changed: T1 T2 T3 T4 T6 T7 T8 = 7 parcels (T5 untouched). Every parcel falls in exactly one bucket.
select t.eq((select sum(n) from _applied)::int, 7, '016 apply over buckets 0..7 changes each eligible parcel exactly once (7 of 8)');
select t.eq((select claim_heat from public.parcel_risk where parcel_id = 'T-CLM-1'), (select heat from public.nfip_claim_block_group where block_group = '991270001002'), '016 parcel heat = block-group heat (not the tract value)');
select t.eq((select claim_bg_count_10y from public.parcel_risk where parcel_id = 'T-CLM-1'), 3, '016 parcel claim_bg_count_10y');
select t.eq((select claim_bg_zone_x_10y from public.parcel_risk where parcel_id = 'T-CLM-1'), 3, '016 parcel claim_bg_zone_x_10y');
select t.eq((select claim_bg_rate from public.parcel_risk where parcel_id = 'T-CLM-1'), (3.0/800)::real, '016 parcel claim_bg_rate');
select t.eq((select claim_bg_last_year from public.parcel_risk where parcel_id = 'T-CLM-1'), 2022, '016 parcel claim_bg_last_year');
select t.eq((select claim_bg_top_event from public.parcel_risk where parcel_id = 'T-CLM-1'), 'Hurricane Ian (2022)', '016 parcel claim_bg_top_event');
select t.eq((select claim_count_10y from public.parcel_risk where parcel_id = 'T-CLM-1'), 3, '016 legacy claim_count_10y kept consistent');
select t.eq((select claim_paid_sum from public.parcel_risk where parcel_id = 'T-CLM-1'), 35000::real, '016 legacy claim_paid_sum kept consistent');
select t.eq((select claim_last_year from public.parcel_risk where parcel_id = 'T-CLM-1'), 2022, '016 legacy claim_last_year kept consistent');
select t.eq((select claim_heat from public.parcel_risk where parcel_id = 'T-CLM-2'), 0::real, '016 zero-claim block group overrides stale heat with 0');
select t.eq((select claim_heat from public.parcel_risk where parcel_id = 'T-CLM-3'), 0.42::real, '016 tract fallback when block_group is null');
select t.eq((select claim_count_10y from public.parcel_risk where parcel_id = 'T-CLM-3'), 4, '016 tract fallback sets claim_count_10y');
select t.eq((select claim_paid_sum from public.parcel_risk where parcel_id = 'T-CLM-3'), 12345::real, '016 tract fallback sets claim_paid_sum');
select t.eq((select claim_last_year from public.parcel_risk where parcel_id = 'T-CLM-3'), 2019, '016 tract fallback sets claim_last_year');
select t.eq((select claim_heat from public.parcel_risk where parcel_id = 'T-CLM-4'), 0.42::real, '016 tract fallback when block_group is absent from the table');
select t.eq((select claim_heat from public.parcel_risk where parcel_id = 'T-CLM-5'), 0.33::real, '016 parcel with no block group and no tract is left alone');
select t.eq((select claim_heat from public.parcel_risk where parcel_id = 'T-CLM-6'), 1::real, '016 zone X heavy block group parcel heat = 1');
select t.ok((select claim_bg_count_10y is null and claim_bg_rate is null and claim_bg_top_event is null from public.parcel_risk where parcel_id = 'T-CLM-7'), '016 fallback clears stale claim_bg_* columns');
select t.eq((select claim_heat from public.parcel_risk where parcel_id = 'T-CLM-7'), 0.42::real, '016 fallback heat replaces stale heat');
select t.ok((select claim_heat from public.parcel_risk where parcel_id = 'T-CLM-6') > (select claim_heat from public.parcel_risk where parcel_id = 'T-CLM-8'),
            '016 zone X block group parcel is hotter than equal-count SFHA block group parcel');

-- idempotent: second full pass changes nothing, in any bucketing
select t.eq((select sum(public.nfip_apply_block_group_claims(8, b))::int from generate_series(0, 7) b), 0, '016 apply is a no-op on the second pass (8 buckets)');
select t.eq(public.nfip_apply_block_group_claims(1, 0), 0, '016 apply is a no-op with a single bucket too');
-- (1,0) path on fresh data gives the same totals as 8 buckets
update public.parcel_risk set claim_heat = 0.5, claim_bg_count_10y = null where parcel_id like 'T-CLM-%' and parcel_id <> 'T-CLM-5';
select t.eq(public.nfip_apply_block_group_claims(1, 0), 7, '016 single-bucket apply repairs the same 7 parcels');

-- block-group edit flows through on re-apply
update public.nfip_claim_block_group set claim_zone_x_10y = 5 where block_group = '991270001001';
select public.nfip_recompute_block_group_heat();
insert into public.parcel_risk (parcel_id, block_group, census_tract) values ('T-CLM-9', '991270001001', '99127000100');
select t.ok(public.nfip_apply_block_group_claims(1, 0) >= 1, '016 apply picks up new parcel (and parcels whose heat moved with the new p95 ref) after a block-group edit');
select t.eq((select claim_heat from public.parcel_risk where parcel_id = 'T-CLM-9'), (select heat from public.nfip_claim_block_group where block_group = '991270001001'), '016 new parcel gets recomputed heat');

-- must-have scoring from 015 still runs and consumes the new claim_heat
select t.lives('select public.must_have_rescore()', '015 must_have_rescore() still runs after 016');
select t.ok((select 'claim_hot_tract' = any(must_have_reasons) from public.parcel_risk where parcel_id = 'T-CLM-6'), '015 reason claim_hot_tract set from block-group heat (heat 1)');
select t.ok((select 'gold_segment' = any(must_have_reasons) from public.parcel_risk where parcel_id = 'T-CLM-6'), '015 gold_segment (zone X + clay + heat>=0.35) fires on a hot block group');
select t.ok((select not ('gold_segment' = any(must_have_reasons)) from public.parcel_risk where parcel_id = 'T-CLM-2'), '015 gold_segment does not fire on a zero-claim block group');
select t.ok((select must_have_score from public.parcel_risk where parcel_id = 'T-CLM-6') > (select must_have_score from public.parcel_risk where parcel_id = 'T-CLM-2'), '015 hot block group scores above zero-claim block group');
select t.lives('select * from public.must_have_band_counts()', '015 must_have_band_counts() runs');
select t.lives($$select public.must_have_apply_batch(public.must_have_cuts(), b, 8) from generate_series(0, 7) b$$, '015 batched must_have_cuts + apply_batch run');
select t.lives($$select * from public.must_have_raw(50, null, 'X', 'D', 0.5, 300000, 2000, 1970, 'Y')$$, '015 must_have_raw 9-arg call still resolves (defaults)');

-- event list
insert into public.nfip_claim_event (block_group, event_key, event_year, event_name, event_designation, claim_count, paid_total, sfha_count, zone_x_count, other_count) values
  ('991270001001', 'Hurricane Ian', 2022, 'Hurricane Ian', 'FL0222',  7, 1000, 3, 4, 0),
  ('991270001002', 'Hurricane Ian', 2022, 'Hurricane Ian', 'FL0222',  5, 2000, 1, 4, 0),
  ('991270003001', 'Hurricane Ian', 2022, 'Hurricane Ian', 'FL0222', 20, 3000, 0,20, 0),
  ('991270001001', 'Hurricane Nicole', 2022, 'Hurricane Nicole', null, 6,  500, 3, 3, 0),
  ('991270001002', 'Hurricane Nicole', 2022, 'Hurricane Nicole', null, 4,  500, 0, 4, 0),
  ('991270003002', 'unnamed-2023', 2023, null, null, 30, 700, 30, 0, 0);
create temp table _ev25 as select * from public.nfip_claim_event_list();
create temp table _ev5  as select * from public.nfip_claim_event_list(5);
select t.eq((select count(*)::int from _ev25 where event_key in ('Hurricane Ian','Hurricane Nicole','unnamed-2023')), 2, '016 event_list default min 25 hides the 10-claim event');
select t.eq((select count(*)::int from _ev5 where event_key in ('Hurricane Ian','Hurricane Nicole','unnamed-2023')), 3, '016 event_list(5) includes it');
select t.eq((select total_claims from _ev25 where event_key = 'Hurricane Ian'), 32::bigint, '016 event_list sums claims');
select t.eq((select zone_x_claims from _ev25 where event_key = 'Hurricane Ian'), 28::bigint, '016 event_list sums zone X claims');
select t.eq((select sfha_claims from _ev25 where event_key = 'Hurricane Ian'), 4::bigint, '016 event_list sums SFHA claims');
select t.eq((select block_groups from _ev25 where event_key = 'Hurricane Ian'), 3::bigint, '016 event_list counts block groups');
select t.eq((select is_named from _ev25 where event_key = 'Hurricane Ian'), true, '016 named event flagged');
select t.eq((select is_named from _ev25 where event_key = 'unnamed-2023'), false, '016 unnamed bucket not flagged named');
select t.eq((select event_designation from _ev25 where event_key = 'Hurricane Ian'), 'FL0222', '016 designation carried');
select t.ok((select array_position(array_agg(event_key order by n), 'unnamed-2023') < array_position(array_agg(event_key order by n), 'Hurricane Ian')
               from (select row_number() over () n, event_key from public.nfip_claim_event_list(5)) q where event_key in ('Hurricane Ian','unnamed-2023')),
            '016 event_list ordered newest year first');
select t.lives('select * from public.nfip_claim_event_list(null)', '016 event_list(null) does not error');

-- cleanup
delete from public.parcel_risk where parcel_id like 'T-CLM-%';
delete from public.nfip_claim_event where block_group like '9912700%';
delete from public.nfip_claim_block_group where block_group like '9912700%';
delete from public.nfip_claim_tract where census_tract like '99127%';
insert into public.nfip_claim_block_group select * from _saved_bg;
