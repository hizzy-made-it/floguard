import test from 'node:test';
import assert from 'node:assert/strict';
import handler, {
  COLUMNS_BASE,
  COLUMNS_OPTIONAL,
  columnList,
  isMissingColumnError,
  parseMissingColumn,
  selectWithColumnFallback,
  buildClaimsLayerQuery,
  shapeClaimsLayerRows,
  shapeClaimsEvents,
} from '../../api/fsi-parcels.js';

// PostgREST shapes, as thrown by server/lib/supabase-rest.js
const pgErr = (col, table = 'parcel_risk') => {
  const e = new Error(`Supabase REST 400: column ${table}.${col} does not exist`);
  e.status = 400;
  e.body = { code: '42703', message: `column ${table}.${col} does not exist` };
  return e;
};
const cacheErr = (col) => {
  const e = new Error(`Supabase REST 400: Could not find the '${col}' column of 'parcel_risk' in the schema cache`);
  e.status = 400;
  e.body = { code: 'PGRST204', message: `Could not find the '${col}' column of 'parcel_risk' in the schema cache` };
  return e;
};
const tableErr = () => {
  const e = new Error("Supabase REST 404: Could not find the table 'public.parcel_risk' in the schema cache");
  e.status = 404;
  e.body = { code: 'PGRST205' };
  return e;
};

/** A fake DB that only has `have` columns and rejects the first unknown one in select order. */
function fakeGet(have, log = []) {
  return async (table, query) => {
    const select = decodeURIComponent(query.match(/select=([^&]+)/)[1]).split(',');
    log.push(select.length);
    const bad = select.find((c) => !have.has(c));
    if (bad) throw pgErr(bad, table);
    return [{ parcel_id: 'p1' }];
  };
}
const q = (select) => `select=${select}&limit=5`;

test('column lists: new block-group columns are optional, existing ones stay base', () => {
  for (const c of ['block_group', 'claim_bg_count_10y', 'claim_bg_zone_x_10y', 'claim_bg_rate', 'claim_bg_last_year', 'claim_bg_top_event']) {
    assert.ok(COLUMNS_OPTIONAL.includes(c), c);
    assert.ok(!COLUMNS_BASE.includes(c), c);
  }
  for (const c of ['parcel_id', 'owner_name', 'claim_heat', 'claim_count_10y', 'depr_n', 'must_have_reasons']) assert.ok(COLUMNS_BASE.includes(c), c);
  assert.ok(!COLUMNS_BASE.includes('phone'), 'phone is never shipped');
  assert.deepEqual(columnList(new Set(['block_group'])).filter((c) => c === 'block_group'), []);
});

test('error parsing handles 42703 and PGRST204, and ignores unrelated errors', () => {
  assert.equal(isMissingColumnError(pgErr('claim_bg_rate')), true);
  assert.equal(parseMissingColumn(pgErr('claim_bg_rate')), 'claim_bg_rate');
  assert.equal(isMissingColumnError(cacheErr('block_group')), true);
  assert.equal(parseMissingColumn(cacheErr('block_group')), 'block_group');
  assert.equal(isMissingColumnError(tableErr()), false, 'a missing table is not a missing column');
  assert.equal(isMissingColumnError(new Error('Supabase REST 500: deadlock detected, column lock timeout')), false);
  assert.equal(parseMissingColumn(new Error('boom')), null);
});

test('fallback: everything present -> one call, nothing dropped', async () => {
  const log = [];
  const cache = new Map();
  const have = new Set([...COLUMNS_BASE, ...COLUMNS_OPTIONAL]);
  const r = await selectWithColumnFallback({ buildQuery: q, get: fakeGet(have, log), cache });
  assert.deepEqual(r.dropped, []);
  assert.equal(log.length, 1);
});

test('fallback: 016 not applied -> drops optional columns one by one and still returns rows', async () => {
  const log = [];
  const cache = new Map();
  const r = await selectWithColumnFallback({ buildQuery: q, get: fakeGet(new Set(COLUMNS_BASE), log), cache });
  assert.deepEqual(r.rows, [{ parcel_id: 'p1' }]);
  assert.deepEqual([...r.dropped].sort(), [...COLUMNS_OPTIONAL].sort());
  assert.equal(log.length, COLUMNS_OPTIONAL.length + 1);
});

test('fallback: only the missing optional column is dropped (e.g. a later agent adds terrain columns)', async () => {
  const cache = new Map();
  const have = new Set([...COLUMNS_BASE, ...COLUMNS_OPTIONAL.filter((c) => c !== 'claim_bg_rate')]);
  const r = await selectWithColumnFallback({ buildQuery: q, get: fakeGet(have), cache });
  assert.deepEqual(r.dropped, ['claim_bg_rate']);
});

test('fallback is generic: extra optional columns passed in are handled the same way', async () => {
  const cache = new Map();
  const optional = [...COLUMNS_OPTIONAL, 'terrain_v2_score', 'terrain_v2_conf'];
  const have = new Set([...COLUMNS_BASE, ...COLUMNS_OPTIONAL, 'terrain_v2_score']);
  const r = await selectWithColumnFallback({ buildQuery: q, get: fakeGet(have), cache, optional });
  assert.deepEqual(r.dropped, ['terrain_v2_conf']);
});

test('fallback: unparseable message drops all optional columns once', async () => {
  const cache = new Map();
  let calls = 0;
  const get = async (t, query) => {
    calls++;
    if (query.includes('block_group')) {
      const e = new Error('Supabase REST 400: column missing');
      e.body = { code: '42703' };
      throw e;
    }
    return ['ok'];
  };
  const r = await selectWithColumnFallback({ buildQuery: q, get, cache });
  assert.equal(calls, 2);
  assert.deepEqual([...r.dropped].sort(), [...COLUMNS_OPTIONAL].sort());
});

test('fallback: a missing BASE column, a table error, or a generic error is rethrown', async () => {
  const cache = new Map();
  await assert.rejects(selectWithColumnFallback({ buildQuery: q, get: fakeGet(new Set(COLUMNS_BASE.filter((c) => c !== 'depr_n')), []), cache }), /depr_n/);
  await assert.rejects(selectWithColumnFallback({ buildQuery: q, get: async () => { throw tableErr(); }, cache: new Map() }), /schema cache/);
  await assert.rejects(selectWithColumnFallback({ buildQuery: q, get: async () => { throw new Error('boom'); }, cache: new Map() }), /boom/);
});

test('fallback: dropped columns are remembered until the TTL expires', async () => {
  const cache = new Map();
  let t = 1000;
  const now = () => t;
  const log = [];
  const get = fakeGet(new Set(COLUMNS_BASE), log);
  await selectWithColumnFallback({ buildQuery: q, get, cache, now });
  const first = log.length;
  await selectWithColumnFallback({ buildQuery: q, get, cache, now });
  assert.equal(log.length, first + 1, 'second request goes straight to the reduced column list');
  t += 120_000; // TTL passed: probe the full list again (e.g. migration applied meanwhile)
  const full = new Set([...COLUMNS_BASE, ...COLUMNS_OPTIONAL]);
  const r = await selectWithColumnFallback({ buildQuery: q, get: fakeGet(full), cache, now });
  assert.deepEqual(r.dropped, []);
});

/* ------------------------------ claims_layer / claims_events ------------------------------ */

const BG = (o = {}) => ({
  block_group: '121270825061', tract: '12127082506', vintage: 2020, housing_units: 1000,
  claim_count_all: 14, claim_count_10y: 12, claim_count_5y: 10, claim_last_year: 2024, paid_total_10y: 87000, median_water_depth: 12,
  claim_sfha_all: 6, claim_zone_x_all: 8, claim_other_all: 0, claim_sfha_10y: 5, claim_zone_x_10y: 7, claim_other_10y: 0,
  claim_rate_10y: 0.012, claim_rate_zone_x_10y: 0.007, heat: 1, top_event: 'Hurricane Ian (2022)', top_event_claims: 7,
  centroid_lat: 29.1, centroid_lon: -81.0, bbox_w: -81.1, bbox_s: 29.0, bbox_e: -80.9, bbox_n: 29.2, geom_geojson: { type: 'Polygon', coordinates: [] }, ...o,
});

test('claims_layer query: bbox overlap on stored bbox columns, ordered by heat, limited', () => {
  const qs = buildClaimsLayerQuery({ w: -81.2, s: 28.9, e: -80.8, n: 29.3 }, { limit: 250 });
  assert.ok(qs.includes('bbox_e=gte.-81.2') && qs.includes('bbox_w=lte.-80.8') && qs.includes('bbox_n=gte.28.9') && qs.includes('bbox_s=lte.29.3'));
  assert.ok(qs.includes('order=heat.desc') && qs.includes('limit=250'));
  assert.ok(!qs.includes('geom_geojson'));
  assert.ok(buildClaimsLayerQuery({ w: 0, s: 0, e: 1, n: 1 }, { includeGeom: true }).includes('geom_geojson'));
});

test('claims_layer rows: GeoJSON-ready shape, zone split, top event, no geom unless asked', () => {
  const [row] = shapeClaimsLayerRows([BG()]);
  assert.equal(row.fips, '121270825061');
  assert.equal(row.lon, -81.0);
  assert.equal(row.lat, 29.1);
  assert.deepEqual(row.bbox, [-81.1, 29.0, -80.9, 29.2]);
  assert.deepEqual({ s: row.sfha_10y, x: row.zone_x_10y, o: row.other_10y }, { s: 5, x: 7, o: 0 });
  assert.equal(row.count_10y, 12);
  assert.equal(row.rate_10y, 0.012);
  assert.equal(row.top_event, 'Hurricane Ian (2022)');
  assert.equal(row.heat, 1);
  assert.ok(!('geom' in row) && !('event' in row));
  assert.deepEqual(shapeClaimsLayerRows([BG()], { includeGeom: true })[0].geom, { type: 'Polygon', coordinates: [] });
  const sparse = shapeClaimsLayerRows([{ block_group: '121270828001' }])[0];
  assert.equal(sparse.count_10y, 0);
  assert.equal(sparse.heat, 0);
  assert.equal(sparse.rate_10y, null);
  assert.equal(sparse.lon, null);
});

test('claims_layer event filter: only block groups with that event, event counts attached', () => {
  const bg = [BG(), BG({ block_group: '121270826042' }), BG({ block_group: '121270828001' })];
  const ev = [
    { block_group: '121270825061', event_key: 'Hurricane Ian', event_year: 2022, claim_count: 7, paid_total: 54000, sfha_count: 3, zone_x_count: 4, other_count: 0 },
    { block_group: '121270826042', event_key: 'Hurricane Ian', event_year: 2022, claim_count: 3, paid_total: 6000.5, sfha_count: 1, zone_x_count: 2, other_count: 0 },
    { block_group: '121270999999', event_key: 'Hurricane Ian', event_year: 2022, claim_count: 9, paid_total: 1, sfha_count: 9, zone_x_count: 0, other_count: 0 }, // outside bbox rows: ignored
  ];
  const rows = shapeClaimsLayerRows(bg, { eventRows: ev });
  assert.deepEqual(rows.map((r) => r.fips), ['121270825061', '121270826042']);
  assert.deepEqual(rows[0].event, { key: 'Hurricane Ian', year: 2022, count: 7, sfha: 3, zone_x: 4, other: 0, paid: 54000 });
  assert.equal(rows[1].event.paid, 6000.5);
});

test('claims_events chips: named events only by default, labelled with year', () => {
  const rows = [
    { event_key: 'Hurricane Ian', event_name: 'Hurricane Ian', event_designation: 'FL0222', event_year: 2022, total_claims: '3488', zone_x_claims: 1200, sfha_claims: 2200, paid_total: 1.5e8, block_groups: 120 },
    { event_key: 'FL0119', event_name: null, event_designation: 'FL0119', event_year: 2019, total_claims: 30, zone_x_claims: 5, sfha_claims: 25, paid_total: 10, block_groups: 8 },
    { event_key: 'unnamed-2023', event_name: null, event_designation: null, event_year: 2023, total_claims: 60, zone_x_claims: 20, sfha_claims: 40, paid_total: 10, block_groups: 30 },
  ];
  const chips = shapeClaimsEvents(rows);
  assert.deepEqual(chips.map((c) => c.label), ['Hurricane Ian (2022)', 'FL0119 (2019)']);
  assert.equal(chips[0].total_claims, 3488);
  assert.equal(chips[0].key, 'Hurricane Ian');
  assert.equal(shapeClaimsEvents(rows, { namedOnly: false }).length, 3);
  assert.equal(shapeClaimsEvents(rows, { namedOnly: false })[2].label, 'Unnamed 2023 (2023)');
});

/* ------------------------------ handler smoke (auth, method, validation) ------------------------------ */

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: '' };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.body = b || ''; };
  r.getHeader = (k) => r.headers[k];
  r.writeHead = (c) => { r.statusCode = c; };
  return r;
}

test('handler: claims actions are behind the same auth and method checks', async () => {
  for (const action of ['claims_layer', 'claims_events']) {
    const res = fakeRes();
    await handler({ method: 'POST', headers: {}, body: { action }, socket: { remoteAddress: '203.0.113.9' } }, res);
    assert.equal(res.statusCode, 401, action);
  }
  const res = fakeRes();
  await handler({ method: 'GET', headers: {}, socket: { remoteAddress: '203.0.113.10' } }, res);
  assert.equal(res.statusCode, 405);
});
