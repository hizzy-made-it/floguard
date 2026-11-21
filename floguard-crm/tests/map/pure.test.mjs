import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './_load-pure.mjs';

const { P } = loadPure();
const plain = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------- score breakdown ------------------------------- */

test('scoreBreakdown: terms sum to S, rain multiplier from stored live/static', () => {
  const b = P.scoreBreakdown({ twi_n: 0.95, hand_n: 0.05, depr_n: 0, hsg: 'D', fema_zone: 'AE', fsi_static: 0.82, fsi_live: 61.5 });
  assert.equal(b.terms.length, 5);
  const sum = b.terms.reduce((s, t) => s + t.contrib, 0);
  assert.ok(Math.abs(sum - b.computed) < 1e-12);
  assert.ok(Math.abs(b.computed - (0.3 * 0.95 + 0.2 * 0.95 + 0 + 0.15 * 1 + 0.15 * 1)) < 1e-12);
  assert.ok(Math.abs(b.rainMult - 61.5 / 82) < 1e-9);
  assert.ok(Math.abs(b.wetness - (2 * (61.5 / 82) - 1)) < 1e-9);
  assert.equal(b.adjusted, true, 'stored S differs from the terms by > 0.02');
});

test('scoreBreakdown: missing inputs are flagged, not invented as parcel data', () => {
  const b = P.scoreBreakdown({});
  const src = Object.fromEntries(b.terms.map((t) => [t.key, t.source]));
  assert.deepEqual(src, { twi: 'default', hand: 'default', depr: 'missing', soil: 'default', zone: 'default' });
  assert.equal(b.rainMult, null);
  assert.equal(b.stored, null);
});

/* ------------------------------- class breaks / claims ------------------------------- */

test('classBreaks: quantiles over positive values, strictly increasing, nicely rounded', () => {
  assert.deepEqual(plain(P.classBreaks([], 5)), []);
  assert.deepEqual(plain(P.classBreaks([0, 0, 0], 5)), []);
  const br = P.classBreaks([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 5);
  assert.equal(br.length, 4);
  for (let i = 1; i < br.length; i++) assert.ok(br[i] > br[i - 1]);
  assert.deepEqual(plain(br), [5, 9, 13, 17]);
  // duplicates collapse
  assert.deepEqual(plain(P.classBreaks([3, 3, 3, 3], 5)), [3]);
  // small rates keep two decimals
  const small = P.classBreaks([0.12, 0.33, 0.51, 0.74, 0.9, 1.4], 5);
  assert.ok(small.every((v) => Math.round(v * 100) === v * 100));
  assert.equal(P.classOf(0, br), 0);
  assert.equal(P.classOf(5, br), 1);
  assert.equal(P.classOf(99, br), 4);
});

const ROW = (o = {}) => ({
  fips: '121270825061', housing_units: 1000,
  count_all: 14, count_10y: 12, count_5y: 10,
  sfha_all: 6, zone_x_all: 8, other_all: 0, sfha_10y: 5, zone_x_10y: 7, other_10y: 0, ...o,
});

test('claimsMetric: zone x window, events, 5y zone fallback, rate per 100 homes', () => {
  assert.deepEqual(plain(P.claimsMetric(ROW(), { zone: 'all', win: '10y' })), { count: 12, weighted: 5 + 14 + 0, rate: 1.2, hu: 1000, fallback: null });
  assert.equal(P.claimsMetric(ROW(), { zone: 'x', win: '10y' }).count, 7);
  assert.equal(P.claimsMetric(ROW(), { zone: 'sfha', win: 'all' }).count, 6);
  assert.equal(P.claimsMetric(ROW(), { zone: 'all', win: '5y' }).count, 10);
  const fb = P.claimsMetric(ROW(), { zone: 'x', win: '5y' });
  assert.equal(fb.count, 7);
  assert.equal(fb.fallback, '10y');
  const ev = P.claimsMetric(ROW({ event: { count: 4, sfha: 1, zone_x: 3, other: 0 } }), { zone: 'x', win: 'all', event: true });
  assert.equal(ev.count, 3);
  assert.equal(P.claimsMetric(ROW({ housing_units: null }), {}).rate, null);
});

test('claimsModel: rate mode when most rows know housing units, legend matches breaks', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ROW({ fips: String(i), count_10y: i * 3, housing_units: 500 }));
  const m = P.claimsModel(rows, { zone: 'all', win: '10y' });
  assert.equal(m.mode, 'rate');
  assert.equal(m.legend.length, m.breaks.length + 1);
  assert.equal(m.items[0].zero, true);
  assert.ok(m.items.every((x) => typeof x.color === 'string'));
  const noHu = P.claimsModel(rows.map((r) => ({ ...r, housing_units: null })), { zone: 'x' });
  assert.equal(noHu.mode, 'count');
  assert.deepEqual(plain(noHu.ramp), plain(P.CLAIMS_RAMPS.x));
  const mixed = P.claimsModel([ROW(), ROW({ housing_units: null }), ROW()], {});
  assert.equal(mixed.mode, 'rate');
  assert.equal(mixed.items[1].cls, -1, 'unknown housing units -> no-data colour in rate mode');
  assert.equal(mixed.items[1].color, P.CLAIMS_NODATA);
  assert.equal(P.legendLabel({ from: 0.4, to: 1.2 }, 'rate'), '0.40–1.2');
  assert.equal(P.legendLabel({ from: 12, to: null }, 'count'), '12+');
});

test('claimsLine: block-group first, tract fallback, never personal', () => {
  const bg = P.claimsLine({ claim_bg_count_10y: 12, claim_bg_zone_x_10y: 7, claim_bg_rate: 0.0075, claim_bg_last_year: 2024, claim_bg_top_event: 'Hurricane Ian (2022)' });
  assert.equal(bg.level, 'bg');
  assert.match(bg.text, /12 NFIP claims in this block group in 10 years/);
  assert.match(bg.text, /7 outside mapped flood zones/);
  assert.match(bg.text, /0.75 per 100 homes/);
  assert.match(bg.text, /Hurricane Ian \(2022\)/);
  const tract = P.claimsLine({ claim_count_10y: 9, claim_heat: 0.6 });
  assert.equal(tract.level, 'tract');
  assert.match(tract.text, /census tract/);
  assert.equal(P.claimsLine({}).level, null);
  for (const t of [bg.text, tract.text]) assert.doesNotMatch(t, /\byou\b|owner filed|your claim/i);
});

test('v2Rows: keep source LiDAR and the processing grid distinct', () => {
  const describe = (fsi_inputs) => plain(P.v2Rows({ dem_res_m: 1, fsi_inputs }).map(({ label, value }) => [label, value]));
  const archive = { release: 'terrain-v2-corridor-2026-11-20', huc12: '030802010700' };
  assert.deepEqual(describe({ ...archive, huc12: 30802010700 }), describe(archive));
  assert.deepEqual(describe(archive), [['Elevation data source', '1 m LiDAR'], ['Terrain processing grid', '2 m']]);
  assert.deepEqual(describe({ ...archive, huc12: '030802010100' }).at(-1), ['Terrain processing grid', '1 m']);
  assert.deepEqual(describe({ ...archive, grid_cell_m: 3 }).at(-1), ['Terrain processing grid', '3 m']);
  assert.deepEqual(describe({ ...archive, release: 'future-release' }), [['Elevation data source', '1 m LiDAR']]);
  assert.deepEqual(describe({ ...archive, grid_cell_m: 0 }), [['Elevation data source', '1 m LiDAR']]);
});

test('v2Rows / inputsList: render present fields only', () => {
  assert.deepEqual(plain(P.v2Rows({})), []);
  const rows = P.v2Rows({ nbr_rel_m: -0.42, wt_depth_m: 0.6, dem_res_m: 1, drain_class: 'Poorly drained', twi_v2_n: null });
  assert.deepEqual(plain(rows.map((r) => r.value)), ['−0.42 m', '0.60 m', 'Poorly drained', '1 m LiDAR']);
  assert.deepEqual(plain(P.inputsList({ dem: 'lidar_1m', soil: { src: 'ssurgo', cov: 0.9 } })), [
    { key: 'dem', value: 'lidar_1m' }, { key: 'soil', value: 'src: ssurgo, cov: 0.9' },
  ]);
  assert.deepEqual(plain(P.inputsList('not json')), []);
});

/* ------------------------------- geometry ------------------------------- */

test('pointInGeom: polygons, holes, multipolygons; inBlockGroup fallbacks', () => {
  const sq = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  assert.equal(P.pointInGeom(1, 1, sq), true);
  assert.equal(P.pointInGeom(5, 5, sq), false, 'inside the hole');
  assert.equal(P.pointInGeom(11, 1, sq), false);
  const multi = { type: 'MultiPolygon', coordinates: [sq.coordinates, [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]] };
  assert.equal(P.pointInGeom(25, 25, multi), true);
  const bg = { fips: 'A', geom: sq, bbox: [0, 0, 10, 10] };
  assert.equal(P.inBlockGroup({ block_group: 'A', lon: 50, lat: 50 }, bg), true, 'column wins');
  assert.equal(P.inBlockGroup({ block_group: 'B', lon: 1, lat: 1 }, bg), false);
  assert.equal(P.inBlockGroup({ lon: 1, lat: 1 }, bg), true);
  assert.equal(P.inBlockGroup({ lon: 5, lat: 5 }, { fips: 'A', bbox: [0, 0, 10, 10] }), true, 'bbox fallback');
  assert.deepEqual(plain(P.idsInBox([{ parcel_id: 1, lon: 1, lat: 1 }, { parcel_id: 2, lon: 20, lat: 1 }], [0, 0, 10, 10])), ['1']);
  const padded = P.padBbox([0, 0, 1, 1], 0.25, 1);
  assert.deepEqual(plain(padded), [0, 0, 1, 1], 'capped at maxSpan around the centre');
  assert.equal(P.bboxContains([0, 0, 2, 2], [0.5, 0.5, 1, 1]), true);
});

/* ------------------------------- URL hash ------------------------------- */

test('hash state: encode -> decode round trip, defaults omitted', () => {
  const st = {
    center: [-81.1, 29.05], zoom: 13.25, layers: ['fema', 'claims'], op: { fema: 30, claims: 70, parcels: 90 },
    preset: 'storm', zone: 'x', win: '5y', event: { key: 'Hurricane Ian', year: 2022 },
    q: 'palm & co', city: 'PORT ORANGE', band: 3, min: 40, lim: 300, bg: '121270825061', sel: 'FIXTURE-003',
  };
  const h = P.encodeHash(st);
  assert.ok(h.startsWith('map?'));
  const back = P.decodeHash('#' + h);
  assert.deepEqual(plain(back), plain(st));
  const short = P.encodeHash({ center: [-81, 29], zoom: 11, layers: ['claims'], op: { ...P.HASH_DEFAULTS.op }, preset: 'must', zone: 'all', win: '10y' });
  assert.equal(short, 'map?c=29%2C-81&z=11&lyr=claims');
  assert.deepEqual(plain(P.decodeHash('#map?lyr=-')), { layers: [] });
});

test('hash state: hostile or junk values are dropped', () => {
  assert.equal(P.decodeHash('#leads'), null);
  assert.equal(P.decodeHash(''), null);
  const d = P.decodeHash('#map?c=999,5&z=80&lyr=fema,evil&pre=drop_tables&cz=zz&cw=1y&band=9&op=1,2&min=-4&ev=%E0%A4%A&sel=' + 'x'.repeat(500));
  assert.deepEqual(plain(d), { layers: ['fema'], sel: 'x'.repeat(120) });
});
