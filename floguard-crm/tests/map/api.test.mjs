// api/fsi-parcels.js additions for the map (agent F2): parcel_geom, search, demo fixtures for
// claims/storm when parcel_risk is missing, and the terrain-v2 column group. No network: global
// fetch is replaced by a fake PostgREST for each test.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
process.env.ACADEMY_SESSION_SECRET = 'test-secret';

const { createSessionToken } = await import('../../server/lib/academy-db.js');
const api = await import('../../api/fsi-parcels.js');
const {
  default: handler, COLUMNS_BASE, COLUMNS_OPTIONAL, COLUMNS_TERRAIN_V2, selectParcelRows,
  validateGeomBbox, shapeParcelGeom, sanitizeSearch, buildSearchParams, GEOM_MAX_SPAN,
} = api;

const TOKEN = createSessionToken({ id: 'u1', username: 'rep' });
let ipN = 0;
function call(body) {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.getHeader = (k) => res.headers[k];
  res.end = (b) => { res.body = b || ''; };
  res.writeHead = (c) => { res.statusCode = c; };
  const req = { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body, socket: { remoteAddress: `198.51.100.${++ipN}` } };
  return handler(req, res).then(() => ({ status: res.statusCode, json: JSON.parse(res.body || '{}') }));
}

/** Fake PostgREST. routes: [{ match: RegExp on path+query, status, body }] (first match wins). */
function fakeFetch(routes, log = []) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const key = decodeURIComponent(u.pathname + u.search);
    log.push({ key, body: init.body });
    const r = routes.find((x) => x.match.test(key));
    const status = r ? r.status || 200 : 404;
    const body = r ? r.body : { code: 'PGRST205', message: 'Could not find the table' };
    return new Response(JSON.stringify(typeof body === 'function' ? body(key, init) : body), { status, headers: { 'content-type': 'application/json' } });
  };
}
const missingTable = (name) => ({ status: 404, body: { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache` } });
const missingFn = (name) => ({ status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } });
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

/* ------------------------------- parcel_geom ------------------------------- */

test('parcel_geom: bbox validation caps the span', async () => {
  assert.ok(validateGeomBbox([-81, 29, -81 + GEOM_MAX_SPAN, 29.05]));
  assert.equal(validateGeomBbox([-81, 29, -80.9, 29.05]), null);
  assert.equal(validateGeomBbox([-81, 29, -81.01, 29.05]), null);
  globalThis.fetch = fakeFetch([]);
  const r = await call({ action: 'parcel_geom', bbox: [-81.2, 29, -81, 29.2] });
  assert.equal(r.status, 400);
});

test('parcel_geom: RPC rows -> FeatureCollection, string geojson parsed, null geom dropped', async () => {
  const sq = { type: 'Polygon', coordinates: [[[-81, 29], [-80.999, 29], [-80.999, 29.001], [-81, 29]]] };
  assert.equal(shapeParcelGeom([{ parcel_id: 'a', geom_geojson: JSON.stringify(sq) }, { parcel_id: 'b', geom_geojson: null }, { parcel_id: '', geom_geojson: sq }]).length, 1);
  const log = [];
  globalThis.fetch = fakeFetch([{ match: /rpc\/fsi_parcel_geojson/, body: [{ parcel_id: 'P1', fsi_static: 0.7, fsi_live: 55, geom_geojson: sq }] }], log);
  const r = await call({ action: 'parcel_geom', bbox: [-81.01, 29, -80.99, 29.02], limit: 99999 });
  assert.equal(r.status, 200);
  assert.equal(r.json.available, true);
  assert.equal(r.json.type, 'FeatureCollection');
  assert.equal(r.json.features[0].properties.parcel_id, 'P1');
  assert.deepEqual(r.json.features[0].geometry, sq);
  const sent = JSON.parse(log[0].body);
  assert.deepEqual(sent, { w: -81.01, s: 29, e: -80.99, n: 29.02, lim: 1500 }, 'limit capped at GEOM_MAX_LIMIT');
});

test('parcel_geom: missing RPC -> available:false (no_rpc); empty box -> available:false (no_geom)', async () => {
  globalThis.fetch = fakeFetch([{ match: /rpc\/fsi_parcel_geojson/, ...missingFn('fsi_parcel_geojson') }, { match: /parcel_risk/, body: [{ parcel_id: 'x' }] }]);
  let r = await call({ action: 'parcel_geom', bbox: [-81.01, 29, -80.99, 29.02] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.available, r.json.reason, r.json.features.length], [false, 'no_rpc', 0]);
  globalThis.fetch = fakeFetch([{ match: /rpc\/fsi_parcel_geojson/, body: [] }]);
  r = await call({ action: 'parcel_geom', bbox: [-81.01, 29, -80.99, 29.02] });
  assert.deepEqual([r.json.available, r.json.reason], [false, 'no_geom']);
});

test('parcel_geom: fixture mode (parcel_risk missing) serves demo lots', async () => {
  globalThis.fetch = fakeFetch([{ match: /rpc\/fsi_parcel_geojson/, ...missingFn('fsi_parcel_geojson') }, { match: /parcel_risk/, ...missingTable('parcel_risk') }]);
  const r = await call({ action: 'parcel_geom', bbox: [-81.04, 29.19, -81.0, 29.23] });
  assert.equal(r.json.source, 'fixtures');
  assert.equal(r.json.demo, true);
  assert.ok(r.json.features.some((f) => f.properties.parcel_id === 'FIXTURE-003'));
});

/* ------------------------------- search ------------------------------- */

test('search: sanitising strips PostgREST syntax, short queries rejected', () => {
  assert.equal(sanitizeSearch('  123  Palm (Ave), "x"*%: '), '123 Palm Ave x');
  assert.equal(sanitizeSearch('a'), '');
  assert.equal(sanitizeSearch('x'.repeat(200)).length, 80);
  const p = buildSearchParams('100 Sample', { owner: true });
  const or = decodeURIComponent(p[0].slice(3));
  assert.equal(or, '(address.ilike."*100 Sample*",parcel_id.eq."100 Sample",owner_name.ilike."*100 Sample*")');
  assert.ok(!decodeURIComponent(buildSearchParams('100 Sample', { owner: false })[0]).includes('owner_name'));
  assert.ok(p.includes('limit=10'));
  assert.equal(buildSearchParams('!'), null);
});

test('search: postgres path ships at most 10 rows with the parcel column list', async () => {
  const log = [];
  globalThis.fetch = fakeFetch([{ match: /parcel_risk\?select=/, body: [{ parcel_id: 'P1', address: '100 Palm Ave', owner_name: 'Jane Doe', fsi_live: 50, phone: '555' }] }], log);
  const r = await call({ action: 'search', q: 'palm' });
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'postgres');
  assert.equal(r.json.parcels[0].address, '100 Palm Ave');
  assert.equal(r.json.parcels[0].owner_name, 'Jane Doe');
  assert.ok(!('phone' in r.json.parcels[0]), 'never ships phone');
  assert.match(log[0].key, /or=\(address\.ilike\."\*palm\*"/);
  const r2 = await call({ action: 'search', q: 'x' });
  assert.equal(r2.status, 400);
});

test('search: fixture mode searches the demo parcels', async () => {
  globalThis.fetch = fakeFetch([{ match: /parcel_risk/, ...missingTable('parcel_risk') }]);
  const r = await call({ action: 'search', q: 'FIXTURE-003' });
  assert.equal(r.json.source, 'fixtures');
  assert.deepEqual(r.json.parcels.map((p) => p.parcel_id), ['FIXTURE-003']);
});

test('search requires a session like every other action', async () => {
  const res = { statusCode: 200, headers: {}, setHeader() {}, end() {} };
  await handler({ method: 'POST', headers: {}, body: { action: 'search', q: 'palm' }, socket: { remoteAddress: '203.0.113.77' } }, res);
  assert.equal(res.statusCode, 401);
});

/* ------------------------------- claims / storm demo fixtures ------------------------------- */

test('claims_layer: 016 missing + parcel_risk present -> available:false (no demo data in production)', async () => {
  globalThis.fetch = fakeFetch([{ match: /nfip_claim/, ...missingTable('nfip_claim_block_group') }, { match: /parcel_risk/, body: [{ parcel_id: 'x' }] }]);
  const r = await call({ action: 'claims_layer', bbox: [-81.2, 28.9, -80.8, 29.3] });
  assert.equal(r.json.available, false);
  assert.equal(r.json.rows.length, 0);
});

test('claims_layer / claims_events: fixture mode serves labelled demo block groups and events', async () => {
  globalThis.fetch = fakeFetch([{ match: /nfip_claim/, ...missingTable('nfip_claim_block_group') }, { match: /parcel_risk/, ...missingTable('parcel_risk') }]);
  const r = await call({ action: 'claims_layer', bbox: [-81.2, 28.9, -80.8, 29.3], includeGeom: true });
  assert.equal(r.json.available, true);
  assert.equal(r.json.source, 'fixtures');
  assert.match(r.json.note, /DEMO/);
  assert.ok(r.json.rows.length > 10);
  assert.ok(r.json.rows.every((x) => x.demo === true && /^12127990\d{4}$/.test(x.fips) && x.geom && x.geom.type === 'Polygon'));
  const row = r.json.rows[0];
  for (const k of ['count_10y', 'sfha_10y', 'zone_x_10y', 'paid_10y', 'last_year', 'top_event', 'heat', 'bbox']) assert.ok(k in row, k);
  const ev = await call({ action: 'claims_events' });
  assert.equal(ev.json.available, true);
  assert.ok(ev.json.events.some((e) => e.label === 'Hurricane Ian (2022)'));
  const filt = await call({ action: 'claims_layer', bbox: [-81.2, 28.9, -80.8, 29.3], event: 'Hurricane Ian', eventYear: 2022 });
  assert.ok(filt.json.rows.length > 0 && filt.json.rows.every((x) => x.event && x.event.key === 'Hurricane Ian'));
});

test('storm: fixture mode serves demo rain; otherwise the old 503 hint stays', async () => {
  globalThis.fetch = fakeFetch([{ match: /rpc\/storm_/, ...missingFn('storm_cells') }, { match: /parcel_risk/, ...missingTable('parcel_risk') }]);
  const r = await call({ action: 'storm', minRainMm: 10, minBand: 'maybe' });
  assert.equal(r.status, 200);
  assert.equal(r.json.demo, true);
  assert.ok(r.json.parcels.length > 0 && r.json.parcels.every((p) => p.cell_rain_24h >= 10));
  globalThis.fetch = fakeFetch([{ match: /rpc\/storm_/, ...missingFn('storm_cells') }, { match: /parcel_risk/, body: [{ parcel_id: 'x' }] }]);
  const r2 = await call({ action: 'storm' });
  assert.equal(r2.status, 503);
});

/* ------------------------------- terrain v2 column group ------------------------------- */

const pgErr = (col) => {
  const e = new Error(`Supabase REST 400: column parcel_risk.${col} does not exist`);
  e.status = 400;
  e.body = { code: '42703', message: `column parcel_risk.${col} does not exist` };
  return e;
};
function fakeGet(have, log = []) {
  return async (table, query) => {
    const select = decodeURIComponent(query.match(/select=([^&]+)/)[1]).split(',');
    log.push(select.length);
    const bad = select.find((c) => !have.has(c));
    if (bad) throw pgErr(bad);
    return [{ parcel_id: 'p1', cols: select.length }];
  };
}
const q = (select) => `select=${select}&limit=5`;

test('v2 group: all present -> one read with every column', async () => {
  const log = [];
  const have = new Set([...COLUMNS_BASE, ...COLUMNS_OPTIONAL, ...COLUMNS_TERRAIN_V2]);
  const r = await selectParcelRows({ buildQuery: q, get: fakeGet(have, log), cache: new Map() });
  assert.equal(log.length, 1);
  assert.equal(r.rows[0].cols, have.size);
});

test('v2 group: 018 not applied -> whole group dropped in one step, then cached', async () => {
  const log = [];
  const cache = new Map();
  const have = new Set([...COLUMNS_BASE, ...COLUMNS_OPTIONAL]);
  const r = await selectParcelRows({ buildQuery: q, get: fakeGet(have, log), cache });
  assert.equal(log.length, 2, 'one failed read + one without the group');
  for (const c of COLUMNS_TERRAIN_V2) assert.ok(r.dropped.includes(c));
  const log2 = [];
  await selectParcelRows({ buildQuery: q, get: fakeGet(have, log2), cache });
  assert.equal(log2.length, 1, 'cached: no probe while the TTL runs');
});

test('v2 group: 016 missing but 018 present -> B per-column fallback still works, v2 kept', async () => {
  const log = [];
  const have = new Set([...COLUMNS_BASE, ...COLUMNS_TERRAIN_V2]);
  const r = await selectParcelRows({ buildQuery: q, get: fakeGet(have, log), cache: new Map() });
  assert.deepEqual([...r.dropped].sort(), [...COLUMNS_OPTIONAL].sort());
  assert.equal(r.rows[0].cols, COLUMNS_BASE.length + COLUMNS_TERRAIN_V2.length);
});

test('v2 group: a missing BASE column is still an error', async () => {
  const have = new Set([...COLUMNS_BASE.filter((c) => c !== 'depr_n'), ...COLUMNS_OPTIONAL, ...COLUMNS_TERRAIN_V2]);
  await assert.rejects(selectParcelRows({ buildQuery: q, get: fakeGet(have), cache: new Map() }), /depr_n/);
});

// Review R1: claims_layer with geometry must stay under Vercel's 4.5 MB response limit.
test('claims_layer includeGeom: geometry trimmed from the lowest-heat rows to fit the response budget', async () => {
  const ring = Array.from({ length: 2500 }, (_, i) => [-81 + i * 1e-5, 29 + (i % 7) * 1e-5]);
  const geom = { type: 'Polygon', coordinates: [ring] }; // ~70 KB each
  const rows = Array.from({ length: 120 }, (_, i) => ({
    block_group: `1212708260${String(i).padStart(2, '0')}`, heat: 1 - i / 200, claim_count_10y: 5, geom_geojson: geom,
    bbox_w: -81.1, bbox_s: 29, bbox_e: -81, bbox_n: 29.1,
  }));
  globalThis.fetch = fakeFetch([{ match: /nfip_claim_block_group/, body: rows }]);
  const r = await call({ action: 'claims_layer', bbox: [-81.5, 28.8, -80.8, 29.5], includeGeom: true, limit: 1000 });
  assert.equal(r.status, 200);
  assert.equal(r.json.count, 120, 'every block group is still returned');
  assert.ok(r.json.geom_trimmed > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(r.json)) < 4_500_000);
  assert.ok(r.json.rows[0].geom, 'hottest rows keep their polygon');
  assert.equal(r.json.rows[119].geom, null, 'coolest rows lose it first');
});
