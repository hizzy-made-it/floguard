import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClaimsUrl,
  fetchAllClaims,
  fetchJsonRetry,
  sinceToYearStart,
  apiConfig,
  parseTigerFeatures,
  buildTigerUrl,
  fetchBlockGroups2020,
  TIGERWEB_BG_2020,
} from '../../scripts/ingest-nfip-claims.mjs';
import { parseArgs } from '../../scripts/ingest-nfip-claims.mjs';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

test('buildClaimsUrl: v3 endpoint, filter, paging, select, no lat/long requested', () => {
  const u = buildClaimsUrl({ top: 5000, skip: 10000, inlinecount: true });
  assert.ok(u.startsWith('https://www.fema.gov/api/open/v3/NfipClaims?'));
  assert.ok(u.includes(`$filter=${encodeURIComponent("countyCode eq '12127'")}`));
  assert.ok(u.includes('$top=5000') && u.includes('$skip=10000') && u.includes('$orderby=id'));
  assert.ok(u.includes('$inlinecount=allpages'));
  const sel = decodeURIComponent(u.match(/\$select=([^&]+)/)[1]).split(',');
  assert.ok(sel.includes('censusGeoid') && sel.includes('floodEvent') && sel.includes('eventDesignationNumber'));
  assert.ok(!sel.includes('latitude') && !sel.includes('longitude'), 'redacted lat/long are not used');
});

test('buildClaimsUrl: --api-version v2 uses the frozen dataset name and no $select', () => {
  const u = buildClaimsUrl({ apiVersion: 'v2' });
  assert.ok(u.startsWith('https://www.fema.gov/api/open/v2/FimaNfipClaims?'));
  assert.ok(!u.includes('$select'));
  assert.throws(() => apiConfig('v9'), /Unknown --api-version/);
});

test('--since snaps to Jan 1 of that year and filters dateOfLoss', () => {
  assert.deepEqual(sinceToYearStart('2024-06-15'), { year: 2024, iso: '2024-01-01T00:00:00.000Z' });
  assert.equal(sinceToYearStart(null), null);
  assert.throws(() => sinceToYearStart('last week'), /4-digit year/);
  const u = decodeURIComponent(buildClaimsUrl({ since: '2024-06-15' }));
  assert.ok(u.includes("countyCode eq '12127' and dateOfLoss ge '2024-01-01T00:00:00.000Z'"));
});

test('parseArgs', () => {
  const o = parseArgs(['--since', '2023', '--api-version', 'v2', '--dry-run', '--page', '99999']);
  assert.equal(o.since, '2023');
  assert.equal(o.apiVersion, 'v2');
  assert.equal(o.dryRun, true);
  assert.equal(o.page, 10000, 'page size capped at the OpenFEMA limit');
  assert.equal(parseArgs([]).apiVersion, 'v3');
  assert.equal(parseArgs(['--since', '--dry-run']).since, null, 'flag after --since is not swallowed as its value');
});

test('fetchAllClaims pages with $skip until a short page', async () => {
  const calls = [];
  const mk = (n, start) => Array.from({ length: n }, (_, i) => ({ id: start + i }));
  const fetchImpl = async (url) => {
    calls.push(url);
    const skip = Number(url.match(/\$skip=(\d+)/)[1]);
    if (skip === 0) return okJson({ metadata: { count: 25 }, NfipClaims: mk(10, 0) });
    if (skip === 10) return okJson({ metadata: {}, NfipClaims: mk(10, 10) });
    return okJson({ metadata: {}, NfipClaims: mk(5, 20) });
  };
  const { claims, total } = await fetchAllClaims({ top: 10, fetchImpl });
  assert.equal(claims.length, 25);
  assert.equal(total, 25);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].includes('$inlinecount=allpages') && !calls[1].includes('$inlinecount'));
  assert.deepEqual(calls.map((u) => Number(u.match(/\$skip=(\d+)/)[1])), [0, 10, 20]);
});

test('fetchJsonRetry retries at most 3 times then throws', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    return { ok: false, status: 503, text: async () => 'down' };
  };
  await assert.rejects(fetchJsonRetry('http://x', { fetchImpl, backoffMs: 1 }), /503/);
  assert.equal(n, 4, '1 attempt + 3 retries');
  n = 0;
  const flaky = async () => (++n < 3 ? { ok: false, status: 500, text: async () => 'e' } : okJson({ ok: 1 }));
  assert.deepEqual(await fetchJsonRetry('http://x', { fetchImpl: flaky, backoffMs: 1 }), { ok: 1 });
});

const square = (x, y, s = 0.1) => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });

test('parseTigerFeatures: signed centroid strings, housing units, bbox, bad GEOIDs dropped', () => {
  const fc = {
    features: [
      { type: 'Feature', geometry: square(-81.1, 29.1), properties: { GEOID: '121270825061', HU100: 1601, POP100: 3130, CENTLAT: '+29.1381261', CENTLON: '-081.0233252' } },
      { type: 'Feature', geometry: square(-81.0, 29.0), properties: { GEOID: '121270825062', HU100: 0 } },
      { type: 'Feature', geometry: square(-81.0, 29.0), properties: { GEOID: '12127' } },
      { type: 'Feature', geometry: null, properties: { GEOID: '121270825063', INTPTLAT: '+29.5', INTPTLON: '-081.5' } },
    ],
  };
  const m = parseTigerFeatures(fc);
  assert.equal(m.size, 3);
  const a = m.get('121270825061');
  assert.equal(a.hu, 1601);
  assert.equal(a.lat, 29.1381261);
  assert.equal(a.lon, -81.0233252);
  assert.equal(a.tract, '12127082506');
  [-81.1, 29.1, -81.0, 29.2].forEach((v, i) => assert.ok(Math.abs(a.bbox[i] - v) < 1e-9, `bbox[${i}]`));
  const b = m.get('121270825062');
  assert.ok(Math.abs(b.lat - 29.05) < 1e-9 && Math.abs(b.lon - -80.95) < 1e-9, 'centroid falls back to bbox centre');
  assert.equal(m.get('121270825063').geometry, null);
  assert.equal(m.get('121270825063').lat, 29.5);
});

test('TIGERweb URL targets the Census2020 block-group layer for Volusia', () => {
  assert.ok(TIGERWEB_BG_2020.includes('/Census2020/Tracts_Blocks/MapServer/1'));
  const u = new URL(buildTigerUrl({ offset: 100, count: 100, generalize: 0.0003 }));
  assert.equal(u.searchParams.get('where'), "STATE='12' AND COUNTY='127'");
  assert.equal(u.searchParams.get('outSR'), '4326');
  assert.equal(u.searchParams.get('f'), 'geojson');
  assert.equal(u.searchParams.get('resultOffset'), '100');
  assert.equal(u.searchParams.get('maxAllowableOffset'), '0.0003');
  assert.ok(u.searchParams.get('outFields').includes('HU100'));
  assert.equal(new URL(buildTigerUrl({ geometry: false })).searchParams.get('returnGeometry'), 'false');
});

test('fetchBlockGroups2020 pages until a short page', async () => {
  const feat = (i) => ({ type: 'Feature', geometry: square(-81 + i * 0.01, 29), properties: { GEOID: `12127${String(i).padStart(7, '0')}` } });
  const fetchImpl = async (url) => {
    const off = Number(new URL(url).searchParams.get('resultOffset'));
    return okJson({ features: Array.from({ length: off === 0 ? 3 : 1 }, (_, i) => feat(off + i)) });
  };
  const m = await fetchBlockGroups2020({ fetchImpl, page: 3 });
  assert.equal(m.size, 4);
});
