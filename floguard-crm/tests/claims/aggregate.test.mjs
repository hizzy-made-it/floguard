import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  zoneClass,
  normalizeClaim,
  aggregateClaims,
  finalizeBlockGroups,
  eventRows,
  tractRows,
  weightedClaimCount,
  computeHeatRef,
  heatFor,
  applyHeat,
  percentileCont,
  median,
  ZONE_X_WEIGHT,
} from '../../scripts/ingest-nfip-claims.mjs'; // also proves the script imports without running main()

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(path.join(here, 'fixtures/claims-v3-synthetic.json'), 'utf8')).NfipClaims;

const A = '121270825061';
const B = '121270826042';
const C = '121270999991'; // 2010 vintage, not in the 2020 set
const D = '121270825062';
const E = '121270827011';
const Z = '121270828001'; // 2020 block group with no claims
const AS_OF = 2026; // 10y window: >= 2017, 5y window: >= 2022

const META = new Map([
  [A, { tract: A.slice(0, 11), hu: 1000, lat: 29.1, lon: -81.0, bbox: [-81.1, 29.0, -80.9, 29.2], geomGeojson: null }],
  [B, { tract: B.slice(0, 11), hu: 500, lat: 29.2, lon: -81.0, bbox: [-81.1, 29.1, -80.9, 29.3], geomGeojson: null }],
  [D, { tract: D.slice(0, 11), hu: 250, lat: 29.1, lon: -80.9, bbox: null, geomGeojson: null }],
  [E, { tract: E.slice(0, 11), hu: 800, lat: 29.3, lon: -81.0, bbox: null, geomGeojson: null }],
  [Z, { tract: Z.slice(0, 11), hu: null, lat: 29.4, lon: -81.0, bbox: null, geomGeojson: null }],
]);
const BG_SET = new Set(META.keys());

const agg = () => aggregateClaims(FIX, { bgSet: BG_SET, asOfYear: AS_OF });

test('fixture is ~40 synthetic rows in the v3 shape', () => {
  assert.equal(FIX.length, 39);
  for (const k of ['censusGeoid', 'floodZoneCurrent', 'ratedFloodZone', 'dateOfLoss', 'yearOfLoss', 'waterDepth', 'causeOfDamage', 'eventDesignationNumber', 'floodEvent', 'amountPaidOnBuildingClaim', 'amountPaidOnContentsClaim']) {
    assert.ok(k in FIX[0], `fixture row has ${k}`);
  }
  assert.ok(!('censusBlockGroupFips' in FIX[0]), 'v3 uses censusGeoid, not censusBlockGroupFips');
});

test('zoneClass: SFHA vs zone X vs other', () => {
  for (const z of ['A', 'AE', 'AH', 'AO', 'AR', 'A99', 'A07', 'AHB', 'V', 'VE', 'V05', 'ae']) assert.equal(zoneClass(z), 'sfha', z);
  for (const z of ['X', 'B', 'C', 'X-SHADED', 'SHADED X', 'x', 'X PROTECTED BY LEVEE', 'AREA OF MINIMAL FLOOD HAZARD']) assert.equal(zoneClass(z), 'zone_x', z);
  for (const z of ['D', '', null, undefined, '  ', 'UNKNOWN']) assert.equal(zoneClass(z), 'other', String(z));
});

test('normalizeClaim: v3 fields, zone fallback, event key, clamped paid, geoid shapes', () => {
  const n = normalizeClaim({ id: 1, censusGeoid: '121270825061', countyCode: '12127', dateOfLoss: '2022-09-28T00:00:00.000Z', yearOfLoss: 2022, floodZoneCurrent: null, ratedFloodZone: 'ae', waterDepth: 12, floodEvent: 'Hurricane Ian', eventDesignationNumber: 'FL0222', amountPaidOnBuildingClaim: -50, amountPaidOnContentsClaim: 25.5 });
  assert.equal(n.blockGroup, A);
  assert.equal(n.tract, '12127082506');
  assert.equal(n.zone, 'AE');
  assert.equal(n.zoneClass, 'sfha');
  assert.equal(n.paid, 25.5, 'negative building recovery clamps to 0');
  assert.equal(n.eventKey, 'Hurricane Ian');
  assert.equal(n.eventDesignation, 'FL0222');

  assert.equal(normalizeClaim({ censusGeoid: '121270825061005', yearOfLoss: 2020 }).blockGroup, A, '15-digit block geoid truncates to block group');
  const tractOnly = normalizeClaim({ censusGeoid: '12127082506', yearOfLoss: 2020 });
  assert.equal(tractOnly.blockGroup, null);
  assert.equal(tractOnly.tract, '12127082506');
  assert.equal(normalizeClaim({ censusGeoid: null }).tract, null);
  assert.equal(normalizeClaim({ censusGeoid: '12127abc' }).tract, null);

  assert.equal(normalizeClaim({ censusGeoid: A, yearOfLoss: 2019 }).eventKey, 'unnamed-2019');
  assert.equal(normalizeClaim({ censusGeoid: A, yearOfLoss: 2019, eventDesignationNumber: 'FL0119' }).eventKey, 'FL0119');
  assert.equal(normalizeClaim({ censusGeoid: A, dateOfLoss: '2015-01-02T00:00:00.000Z' }).year, 2015, 'year from dateOfLoss when yearOfLoss missing');
  assert.equal(normalizeClaim({ censusBlockGroupFips: A }).blockGroup, A, 'v2-style alias accepted');
  assert.equal(normalizeClaim({ censusGeoid: A, waterDepth: null }).depth, null);
});

test('aggregateClaims: counters, vintage fallback, skips', () => {
  const { stats, fallbackFips } = agg();
  assert.equal(stats.total, 39);
  assert.equal(stats.no_geoid, 3);
  assert.equal(stats.other_county, 1);
  assert.equal(stats.tract_only, 1);
  assert.equal(stats.fallback_tract, 5, 'claims in 2010-vintage FIPS not in the 2020 set');
  assert.equal(stats.fallback_fips, 1);
  assert.deepEqual([...fallbackFips], [[C, 5]]);
  assert.equal(stats.bg_assigned, 29);
  assert.deepEqual(stats.zone, { sfha: 8, zone_x: 19, other: 2 });
});

test('block group A: all / 10y / 5y windows, zone split, paid, depth, last year', () => {
  const a = agg().blockGroups.get(A);
  assert.equal(a.claim_count_all, 14);
  assert.equal(a.claim_count_10y, 12, '2010 and 2003 fall outside >= 2017');
  assert.equal(a.claim_count_5y, 10, 'Irma 2017 falls outside >= 2022');
  assert.equal(a.claim_last_year, 2024);
  assert.equal(a.claim_sfha_10y, 5);
  assert.equal(a.claim_zone_x_10y, 7);
  assert.equal(a.claim_other_10y, 0);
  assert.equal(a.claim_sfha_all, 6);
  assert.equal(a.claim_zone_x_all, 8);
  assert.equal(a.paid_total_10y, 87000, 'building + contents, negative building payment clamped');
  assert.equal(median(a._depths), 12, 'median of depth > 0 in the 10y window');
});

test('windows move with asOfYear', () => {
  const a = aggregateClaims(FIX, { bgSet: BG_SET, asOfYear: 2033 }).blockGroups.get(A);
  assert.equal(a.claim_count_10y, 3, 'only the three 2024 Milton claims remain in >= 2024');
});

test('events are grouped per block group x event x year', () => {
  const { events } = agg();
  const get = (bg, key, y) => events.get(`${bg}|${key}|${y}`);
  const ian = get(A, 'Hurricane Ian', 2022);
  assert.deepEqual(
    { n: ian.claim_count, paid: ian.paid_total, x: ian.zone_x_count, s: ian.sfha_count, edn: ian.event_designation },
    { n: 7, paid: 54000, x: 4, s: 3, edn: 'FL0222' },
  );
  const mil = get(A, 'Hurricane Milton', 2024);
  assert.deepEqual({ n: mil.claim_count, x: mil.zone_x_count, s: mil.sfha_count }, { n: 3, x: 2, s: 1 });
  assert.equal(get(A, 'Hurricane Irma', 2017).claim_count, 2);
  assert.equal(get(A, 'Hurricane Irma', 2017).event_designation, null, 'older events have no EDN');
  assert.equal(get(A, 'unnamed-2010', 2010).event_name, null);
  assert.equal(get(B, 'unnamed-2023', 2023).claim_count, 1);
  assert.equal([...events.values()].filter((e) => e.block_group === A).length, 5);
  assert.ok(![...events.values()].some((e) => e.block_group === C), 'fallback-vintage claims have no event rows');
  assert.equal(eventRows(events, { fromYear: 2024 }).every((e) => e.event_year >= 2024), true);
});

test('tract table still written for every county claim incl. vintage fallback', () => {
  const { tracts } = agg();
  assert.deepEqual([...tracts.keys()].sort(), ['12127082506', '12127082604', '12127082701', '12127099999']);
  const t = tracts.get('12127082506');
  assert.equal(t.claim_count_all, 14 + 2 + 1, 'A + D + one tract-only geoid');
  assert.equal(tracts.get('12127099999').claim_count_all, 5, 'claims in the 2010-only FIPS survive at tract grain');
  const rows = tractRows(tracts, { now: new Date('2026-01-01') });
  assert.ok(rows.every((r) => r.heat >= 0 && r.heat <= 1 && typeof r.multi_loss_flag === 'boolean'));
  assert.deepEqual(Object.keys(rows[0]).sort(), ['census_tract', 'claim_count_10y', 'claim_count_all', 'heat', 'last_loss_year', 'multi_loss_flag', 'paid_sum', 'updated_at']);
});

test('finalizeBlockGroups: every 2020 block group gets a row; rates need housing units; top event', () => {
  const { blockGroups, events } = agg();
  const rows = finalizeBlockGroups(blockGroups, events, META, { asOfYear: AS_OF, now: new Date('2026-11-19T00:00:00Z') });
  assert.equal(rows.length, 5);
  const by = Object.fromEntries(rows.map((r) => [r.block_group, r]));
  assert.equal(by[A].claim_rate_10y, 0.012);
  assert.equal(by[A].claim_rate_zone_x_10y, 0.007);
  assert.equal(by[A].median_water_depth, 12);
  assert.equal(by[A].top_event, 'Hurricane Ian (2022)');
  assert.equal(by[A].top_event_claims, 7);
  assert.equal(by[B].median_water_depth, 5);
  assert.equal(by[D].top_event, null, 'unnamed claims never become a top event');
  assert.equal(by[E].top_event, 'Hurricane Milton (2024)');
  assert.equal(by[Z].claim_count_all, 0);
  assert.equal(by[Z].claim_rate_10y, null, 'no housing units => null rate');
  assert.equal(by[Z].housing_units, null);
  assert.equal(by[Z].heat, 0);
  assert.equal(by[Z].top_event, null);
  assert.equal(by[A].centroid_lat, 29.1);
  assert.equal(by[A].bbox_w, -81.1);
  assert.equal(by[D].bbox_w, null);
  assert.ok(!(C in by), '2010-only FIPS never gets a block-group row');
});

test('heat: zone X claims weigh more than SFHA claims', () => {
  assert.equal(ZONE_X_WEIGHT, 2);
  const sfha = { claim_sfha_10y: 4, claim_zone_x_10y: 0, claim_other_10y: 0 };
  const zx = { claim_sfha_10y: 0, claim_zone_x_10y: 4, claim_other_10y: 0 };
  assert.equal(weightedClaimCount(sfha), 4);
  assert.equal(weightedClaimCount(zx), 8);
  const ref = 20;
  assert.ok(heatFor(weightedClaimCount(zx), ref) > heatFor(weightedClaimCount(sfha), ref));
  const rows = [sfha, zx, { claim_sfha_10y: 0, claim_zone_x_10y: 0, claim_other_10y: 0 }];
  applyHeat(rows);
  assert.ok(rows[1].heat > rows[0].heat && rows[0].heat > 0 && rows[2].heat === 0);
});

test('heat reference: p95 of positive weighted counts, floored at 5, capped heat at 1', () => {
  assert.equal(computeHeatRef([{ claim_sfha_10y: 1 }]), 5, 'floor');
  const many = Array.from({ length: 20 }, (_, i) => ({ claim_sfha_10y: i + 1 })); // 1..20
  assert.ok(Math.abs(computeHeatRef(many) - 19.05) < 1e-9, 'percentile_cont(0.95) of 1..20');
  assert.equal(heatFor(1000, 10), 1);
  assert.equal(percentileCont([2, 7, 17, 19], 0.95), 18.7);
  const rows = finalizeBlockGroups(agg().blockGroups, agg().events, META, { asOfYear: AS_OF });
  const by = Object.fromEntries(rows.map((r) => [r.block_group, r]));
  assert.equal(by[A].heat, 1);
  assert.ok(by[E].heat > by[B].heat && by[B].heat > by[D].heat && by[D].heat > 0);
});
