/**
 * Synthetic FIXTURE-* parcels for the CRM Flood Map when public.parcel_risk
 * is not migrated yet. Same rows as fsi/sql/002_seed_fixtures.sql /
 * fsi/fixtures/parcel_risk.json. Removable once Postgres + ingest are live.
 */
export const FIXTURE_PARCELS = [
  { parcel_id: 'FIXTURE-001', address: 'FIXTURE - 100 Sample St', owner_name: 'Fixture Owner 01', lat: 29.0283, lon: -81.3031, twi_n: 0.95, hand_n: 0.05, hsg: 'D', fema_zone: 'X', fsi_static: 0.885, fsi_live: 66.37 },
  { parcel_id: 'FIXTURE-002', address: 'FIXTURE - 200 Sample St', owner_name: 'Fixture Owner 02', lat: 29.2858, lon: -81.0559, twi_n: 0.1, hand_n: 0.9, hsg: 'A', fema_zone: 'X', fsi_static: 0.1725, fsi_live: 12.94 },
  { parcel_id: 'FIXTURE-003', address: 'FIXTURE - 300 Sample St', owner_name: 'Fixture Owner 03', lat: 29.2108, lon: -81.0228, twi_n: 0.95, hand_n: 0.05, hsg: 'D', fema_zone: 'AE', fsi_static: 0.9675, fsi_live: 72.56 },
  { parcel_id: 'FIXTURE-004', address: 'FIXTURE - 400 Sample St', owner_name: 'Fixture Owner 04', lat: 28.9005, lon: -81.2637, twi_n: 0.88, hand_n: 0.12, hsg: 'C', fema_zone: 'X', fsi_static: 0.7795, fsi_live: 58.46 },
  { parcel_id: 'FIXTURE-005', address: 'FIXTURE - 500 Sample St', owner_name: 'Fixture Owner 05', lat: 28.9489, lon: -81.2984, twi_n: 0.82, hand_n: 0.2, hsg: 'D', fema_zone: 'X-SHADED', fsi_static: 0.818, fsi_live: 61.35 },
  { parcel_id: 'FIXTURE-006', address: 'FIXTURE - 600 Sample St', owner_name: 'Fixture Owner 06', lat: 29.1383, lon: -81.0059, twi_n: 0.75, hand_n: 0.25, hsg: 'C', fema_zone: 'X', fsi_static: 0.695, fsi_live: 52.13 },
  { parcel_id: 'FIXTURE-007', address: 'FIXTURE - 700 Sample St', owner_name: 'Fixture Owner 07', lat: 29.0258, lon: -80.927, twi_n: 0.7, hand_n: 0.3, hsg: 'D', fema_zone: 'AO', fsi_static: 0.775, fsi_live: 58.12 },
  { parcel_id: 'FIXTURE-008', address: 'FIXTURE - 800 Sample St', owner_name: 'Fixture Owner 08', lat: 28.9889, lon: -80.9023, twi_n: 0.65, hand_n: 0.35, hsg: 'B', fema_zone: 'X', fsi_static: 0.57, fsi_live: 42.75 },
  { parcel_id: 'FIXTURE-009', address: 'FIXTURE - 900 Sample St', owner_name: 'Fixture Owner 09', lat: 28.8831, lon: -81.3087, twi_n: 0.6, hand_n: 0.4, hsg: 'C', fema_zone: 'AH', fsi_static: 0.65, fsi_live: 48.75 },
  { parcel_id: 'FIXTURE-010', address: 'FIXTURE - 1000 Sample St', owner_name: 'Fixture Owner 10', lat: 29.0611, lon: -81.2094, twi_n: 0.55, hand_n: 0.45, hsg: 'A/D', fema_zone: 'X', fsi_static: 0.625, fsi_live: 46.88 },
  { parcel_id: 'FIXTURE-011', address: 'FIXTURE - 1100 Sample St', owner_name: 'Fixture Owner 11', lat: 29.1702, lon: -81.0784, twi_n: 0.5, hand_n: 0.5, hsg: 'B', fema_zone: 'X-SHADED', fsi_static: 0.495, fsi_live: 37.12 },
  { parcel_id: 'FIXTURE-012', address: 'FIXTURE - 1200 Sample St', owner_name: 'Fixture Owner 12', lat: 29.2295, lon: -81.1122, twi_n: 0.45, hand_n: 0.55, hsg: 'C', fema_zone: 'X', fsi_static: 0.5, fsi_live: 37.5 },
  { parcel_id: 'FIXTURE-013', address: 'FIXTURE - 1300 Sample St', owner_name: 'Fixture Owner 13', lat: 29.0447, lon: -80.9138, twi_n: 0.4, hand_n: 0.6, hsg: 'B', fema_zone: 'VE', fsi_static: 0.49, fsi_live: 36.75 },
  { parcel_id: 'FIXTURE-014', address: 'FIXTURE - 1400 Sample St', owner_name: 'Fixture Owner 14', lat: 28.9312, lon: -81.1855, twi_n: 0.35, hand_n: 0.65, hsg: 'A', fema_zone: 'X', fsi_static: 0.335, fsi_live: 25.12 },
  { parcel_id: 'FIXTURE-015', address: 'FIXTURE - 1500 Sample St', owner_name: 'Fixture Owner 15', lat: 29.1055, lon: -81.2508, twi_n: 0.3, hand_n: 0.7, hsg: 'B', fema_zone: 'X', fsi_static: 0.3425, fsi_live: 25.69 },
  { parcel_id: 'FIXTURE-016', address: 'FIXTURE - 1600 Sample St', owner_name: 'Fixture Owner 16', lat: 29.2571, lon: -81.139, twi_n: 0.25, hand_n: 0.75, hsg: 'C', fema_zone: 'X', fsi_static: 0.37, fsi_live: 27.75 },
  { parcel_id: 'FIXTURE-017', address: 'FIXTURE - 1700 Sample St', owner_name: 'Fixture Owner 17', lat: 28.972, lon: -81.0466, twi_n: 0.2, hand_n: 0.8, hsg: 'A', fema_zone: 'X-SHADED', fsi_static: 0.26, fsi_live: 19.5 },
  { parcel_id: 'FIXTURE-018', address: 'FIXTURE - 1800 Sample St', owner_name: 'Fixture Owner 18', lat: 29.193, lon: -81.2233, twi_n: 0.15, hand_n: 0.85, hsg: 'B', fema_zone: 'X', fsi_static: 0.245, fsi_live: 18.38 },
  { parcel_id: 'FIXTURE-019', address: 'FIXTURE - 1900 Sample St', owner_name: 'Fixture Owner 19', lat: 28.9166, lon: -81.0912, twi_n: 0.92, hand_n: 0.08, hsg: 'D', fema_zone: 'X', fsi_static: 0.8655, fsi_live: 64.91 },
  { parcel_id: 'FIXTURE-020', address: 'FIXTURE - 2000 Sample St', owner_name: 'Fixture Owner 20', lat: 29.274, lon: -80.9581, twi_n: 0.05, hand_n: 0.95, hsg: 'A', fema_zone: 'X', fsi_static: 0.14, fsi_live: 10.5 },
  { parcel_id: 'FIXTURE-021', address: 'FIXTURE - 2100 Sample St', owner_name: 'Fixture Owner 21', lat: 29.0938, lon: -81.1647, twi_n: 0.72, hand_n: 0.28, hsg: null, fema_zone: null, fsi_static: 0.668, fsi_live: 50.1 },
];

/**
 * Filter/sort fixture parcels the same way PostgREST would for viewport|top.
 * @param {{ action: string, minFsi: number, limit: number, box: null|{w:number,s:number,e:number,n:number} }} q
 */
function enrichFixture(p, i) {
  // Synthetic dial fields so Must / claim-hot presets work offline
  const live = Number(p.fsi_live) || 0;
  const heat = Math.min(1, Math.max(0, (live - 20) / 80));
  const mhs = Math.round(Math.min(100, live * 0.9 + heat * 15 + (String(p.hsg || '').includes('D') ? 8 : 0)));
  // Rough top-tier fixtures as must so Must dial preset works offline
  let band = 'skip';
  if (mhs >= 58) band = 'must';
  else if (mhs >= 42) band = 'should';
  else if (mhs >= 28) band = 'maybe';
  const commercial = i % 7 === 0;
  return {
    ...p,
    claim_heat: Math.round(heat * 1000) / 1000,
    claim_count_10y: Math.round(heat * 20),
    claim_last_year: heat > 0.4 ? 2024 : null,
    must_have_score: mhs,
    must_have_band: band,
    must_have_reasons:
      band === 'must'
        ? commercial
          ? ['high_fsi', 'commercial_scale', 'fixture']
          : ['high_fsi', 'gold_segment', 'fixture']
        : [],
    year_built: 1975 + (i % 40),
    living_area: commercial ? 8000 + i * 200 : 1400 + i * 50,
    just_value: commercial ? 1_200_000 + i * 50000 : 220000 + i * 12000,
    city: 'Port Orange',
    zip: '32127',
    homestead: commercial ? null : i % 3 === 0 ? 'Y' : null,
    dor_use: commercial ? '11' : '01',
    use_desc: commercial ? 'COMMERCIAL STORE' : 'SINGLE FAMILY',
    ...fixtureParcelClaims(p),
  };
}

export function queryFixtures(q) {
  const minFsi = Number(q.minFsi) || 0;
  const minMust = Number(q.minMust) || 0;
  const mustBand = q.mustBand ? String(q.mustBand).toLowerCase() : '';
  const sort = String(q.sort || 'fsi').toLowerCase();
  const limit = Math.max(1, Number(q.limit) || 500);
  let rows = FIXTURE_PARCELS.map(enrichFixture).filter((p) => Number(p.fsi_live) >= minFsi);
  if (minMust > 0) rows = rows.filter((p) => Number(p.must_have_score) >= minMust);
  if (mustBand) rows = rows.filter((p) => String(p.must_have_band) === mustBand);
  if (q.action === 'viewport' && q.box) {
    const { w, s, e, n } = q.box;
    rows = rows.filter(
      (p) =>
        Number(p.lon) >= w &&
        Number(p.lon) <= e &&
        Number(p.lat) >= s &&
        Number(p.lat) <= n,
    );
  }
  const sorter =
    sort === 'must'
      ? (a, b) => Number(b.must_have_score) - Number(a.must_have_score)
      : sort === 'heat'
        ? (a, b) => Number(b.claim_heat) - Number(a.claim_heat)
        : (a, b) => Number(b.fsi_live) - Number(a.fsi_live);
  rows = rows
    .slice()
    .sort(sorter)
    .slice(0, limit);
  return rows;
}

/* ------------------------------------------------------------------------------------------
 * DEMO block-group claims, storm events, parcel polygons and search (local dev and tests only).
 * Served by api/fsi-parcels.js only when public.parcel_risk itself is missing (fixture mode),
 * so they can never be mistaken for live data: every row carries demo: true, every fips sits in
 * tract 99xxxx, and the API marks the response source: 'fixtures'. Numbers are made up but
 * shaped like OpenFEMA block-group aggregates (fsi/sql/016). Neighbourhood level only.
 * ------------------------------------------------------------------------------------------ */

/** Demo grid over the fixture parcels' extent (Volusia). */
const BG_GRID = { w: -81.36, s: 28.86, e: -80.86, n: 29.32, cols: 10, rows: 9 };
const THIS_YEAR = 2026;

/** Small deterministic PRNG so demo numbers are stable across runs. */
function hash01(i, salt = 0) {
  let x = (i + 1) * 374761393 + salt * 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  x = x ^ (x >>> 16);
  return ((x >>> 0) % 10000) / 10000;
}

const round = (v, d = 5) => Math.round(v * 10 ** d) / 10 ** d;

/** Shared jittered vertex so neighbouring demo polygons tile without gaps. */
function gridVertex(ci, ri) {
  const { w, s, e, n, cols, rows } = BG_GRID;
  const dx = (e - w) / cols;
  const dy = (n - s) / rows;
  const edge = ci === 0 || ri === 0 || ci === cols || ri === rows;
  const jx = edge ? 0 : (hash01(ci * 31 + ri, 7) - 0.5) * dx * 0.35;
  const jy = edge ? 0 : (hash01(ci * 17 + ri, 11) - 0.5) * dy * 0.35;
  return [round(w + ci * dx + jx), round(s + ri * dy + jy)];
}

function cellOf(lon, lat) {
  const { w, s, e, n, cols, rows } = BG_GRID;
  if (!(lon >= w && lon < e && lat >= s && lat < n)) return -1;
  const ci = Math.min(cols - 1, Math.floor(((lon - w) / (e - w)) * cols));
  const ri = Math.min(rows - 1, Math.floor(((lat - s) / (n - s)) * rows));
  return ri * cols + ci;
}

export const FIXTURE_EVENTS = [
  { key: 'Hurricane Milton', name: 'Hurricane Milton', designation: 'FL1024', year: 2024, share: 0.22 },
  { key: 'Hurricane Ian', name: 'Hurricane Ian', designation: 'FL0222', year: 2022, share: 0.34 },
  { key: 'Hurricane Nicole', name: 'Hurricane Nicole', designation: 'FL0322', year: 2022, share: 0.08 },
  { key: 'Hurricane Irma', name: 'Hurricane Irma', designation: null, year: 2017, share: 0.18 },
  { key: 'Hurricane Matthew', name: 'Hurricane Matthew', designation: null, year: 2016, share: 0.1 },
];

let _bgCache = null;
/** DB-shaped nfip_claim_block_group rows (+ geom_geojson) and nfip_claim_event rows. */
function buildDemoClaims() {
  if (_bgCache) return _bgCache;
  const { cols, rows } = BG_GRID;
  // Fixture parcels pull nearby demo block groups up (wet terrain, more claims), like real data tends to.
  const parcels = FIXTURE_PARCELS.map((p) => ({ cell: cellOf(p.lon, p.lat), live: Number(p.fsi_live) || 0 }));
  const bg = [];
  const ev = [];
  for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < cols; ci++) {
      const i = ri * cols + ci;
      // East of the barrier island the grid is ocean: skip the far-east column north of New Smyrna.
      if (ci === cols - 1 && ri > 2) continue;
      const near = parcels.filter((p) => p.cell === i).reduce((m, p) => Math.max(m, p.live), 0);
      const base = hash01(i, 3);
      const housing = 300 + Math.round(hash01(i, 5) * 1700);
      const all = Math.round(base * base * 40 + near * 0.55 + (near > 0 ? 6 : 0));
      const c10 = Math.round(all * (0.7 + hash01(i, 13) * 0.25));
      const c5 = Math.round(c10 * (0.45 + hash01(i, 17) * 0.4));
      const xShare = 0.25 + hash01(i, 19) * 0.55; // share of claims outside mapped flood zones
      const x10 = Math.round(c10 * xShare);
      const o10 = c10 > 6 && hash01(i, 23) > 0.7 ? 1 : 0;
      const s10 = Math.max(0, c10 - x10 - o10);
      const xAll = Math.round(all * xShare);
      const oAll = o10;
      const sAll = Math.max(0, all - xAll - oAll);
      const tract = String(990000 + Math.floor(i / 3)).padStart(6, '0');
      const fips = `12127${tract}${(i % 3) + 1}`;
      const ring = [gridVertex(ci, ri), gridVertex(ci + 1, ri), gridVertex(ci + 1, ri + 1), gridVertex(ci, ri + 1), gridVertex(ci, ri)];
      const xs = ring.map((v) => v[0]);
      const ys = ring.map((v) => v[1]);
      let top = null;
      let topClaims = 0;
      for (let k = 0; k < FIXTURE_EVENTS.length; k++) {
        const e = FIXTURE_EVENTS[k];
        const n = Math.round(all * e.share * (0.6 + hash01(i * 7 + k, 29) * 0.8));
        if (n <= 0) continue;
        const ex = Math.round(n * xShare);
        ev.push({
          block_group: fips, event_key: e.key, event_name: e.name, event_year: e.year,
          claim_count: n, paid_total: Math.round(n * (18000 + hash01(i + k, 31) * 26000)),
          sfha_count: n - ex, zone_x_count: ex, other_count: 0,
        });
        if (n > topClaims) { topClaims = n; top = `${e.name} (${e.year})`; }
      }
      const hasClaims = all > 0;
      bg.push({
        demo: true,
        block_group: fips, tract: `12127${tract}`, vintage: 2020,
        // A few demo block groups lack housing units, to exercise the "weighted count" colour path.
        housing_units: hash01(i, 37) < 0.06 ? null : housing,
        claim_count_all: all, claim_count_10y: c10, claim_count_5y: c5,
        claim_last_year: hasClaims ? THIS_YEAR - Math.floor(hash01(i, 41) * 4) : null,
        paid_total_10y: hasClaims ? Math.round(c10 * (21000 + hash01(i, 43) * 30000)) : 0,
        median_water_depth: hasClaims ? Math.round(4 + hash01(i, 47) * 20) : null,
        claim_sfha_all: sAll, claim_zone_x_all: xAll, claim_other_all: oAll,
        claim_sfha_10y: s10, claim_zone_x_10y: x10, claim_other_10y: o10,
        claim_rate_10y: null, claim_rate_zone_x_10y: null,
        heat: 0, top_event: top, top_event_claims: topClaims || null,
        centroid_lat: round((Math.min(...ys) + Math.max(...ys)) / 2), centroid_lon: round((Math.min(...xs) + Math.max(...xs)) / 2),
        bbox_w: Math.min(...xs), bbox_s: Math.min(...ys), bbox_e: Math.max(...xs), bbox_n: Math.max(...ys),
        geom_geojson: { type: 'Polygon', coordinates: [ring] },
      });
    }
  }
  // Same heat formula as scripts/lib/claims.mjs: weighted = sfha + 2*zone_x + other, log-scaled to p95.
  const weighted = (r) => r.claim_sfha_10y + 2 * r.claim_zone_x_10y + r.claim_other_10y;
  const ws = bg.map(weighted).filter((v) => v > 0).sort((a, b) => a - b);
  const ref = Math.max(5, ws.length ? ws[Math.floor(0.95 * (ws.length - 1))] : 5);
  for (const r of bg) {
    r.heat = Math.round(Math.min(1, Math.log1p(weighted(r)) / Math.log1p(ref)) * 1000) / 1000;
    if (r.housing_units) {
      r.claim_rate_10y = round(r.claim_count_10y / r.housing_units, 5);
      r.claim_rate_zone_x_10y = round(r.claim_zone_x_10y / r.housing_units, 5);
    }
  }
  _bgCache = { bg, ev };
  return _bgCache;
}

/** claim_bg_* parcel columns (fsi/sql/016) for a fixture parcel, from its demo block group. */
function fixtureParcelClaims(p) {
  const cell = cellOf(Number(p.lon), Number(p.lat));
  const { bg } = buildDemoClaims();
  const tract = String(990000 + Math.floor(cell / 3)).padStart(6, '0');
  const fips = cell >= 0 ? `12127${tract}${(cell % 3) + 1}` : null;
  const r = fips ? bg.find((b) => b.block_group === fips) : null;
  if (!r) return { block_group: null, claim_bg_count_10y: null, claim_bg_zone_x_10y: null, claim_bg_rate: null, claim_bg_last_year: null, claim_bg_top_event: null };
  return {
    block_group: r.block_group,
    claim_bg_count_10y: r.claim_count_10y,
    claim_bg_zone_x_10y: r.claim_zone_x_10y,
    claim_bg_rate: r.claim_rate_10y,
    claim_bg_last_year: r.claim_last_year,
    claim_bg_top_event: r.top_event,
  };
}

/**
 * Demo rows for action 'claims_layer', in the DB shape the API's shapeClaimsLayerRows() takes.
 * @returns {{ bgRows: object[], eventRows: object[]|null }}
 */
export function claimsLayerFixtures({ box, event = '', eventYear = null, limit = 400 } = {}) {
  const { bg, ev } = buildDemoClaims();
  let rows = bg.filter((r) => !box || (r.bbox_e >= box.w && r.bbox_w <= box.e && r.bbox_n >= box.s && r.bbox_s <= box.n));
  rows = rows.slice().sort((a, b) => b.heat - a.heat || b.claim_count_10y - a.claim_count_10y).slice(0, limit);
  const eventRows = event
    ? ev.filter((e) => e.event_key === event && (eventYear == null || !Number.isFinite(eventYear) || e.event_year === eventYear))
    : null;
  return { bgRows: rows, eventRows };
}

/** Demo rows for action 'claims_events', in the nfip_claim_event_list() RPC shape. */
export function claimsEventsFixtures({ minClaims = 25 } = {}) {
  const { ev } = buildDemoClaims();
  const out = [];
  for (const e of FIXTURE_EVENTS) {
    const rows = ev.filter((r) => r.event_key === e.key);
    const total = rows.reduce((s, r) => s + r.claim_count, 0);
    if (total < minClaims) continue;
    out.push({
      event_key: e.key, event_name: e.name, event_designation: e.designation, event_year: e.year,
      total_claims: total,
      zone_x_claims: rows.reduce((s, r) => s + r.zone_x_count, 0),
      sfha_claims: rows.reduce((s, r) => s + r.sfha_count, 0),
      paid_total: rows.reduce((s, r) => s + r.paid_total, 0),
      block_groups: rows.length,
    });
  }
  return out.sort((a, b) => b.event_year - a.event_year || b.total_claims - a.total_claims);
}

/**
 * Demo parcel polygons (fsi_parcel_geojson RPC shape: parcel_id, fsi_static, fsi_live, geom_geojson):
 * a lot-sized rectangle around each fixture parcel plus a few unlisted neighbours, so the
 * high-zoom polygon view has something to draw offline.
 */
export function parcelGeomFixtures(box, lim = 600) {
  const out = [];
  const lot = (lon, lat, wM, hM, rot) => {
    const dLon = wM / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
    const dLat = hM / 2 / 110540;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const pts = [[-dLon, -dLat], [dLon, -dLat], [dLon, dLat], [-dLon, dLat]].map(([x, y]) => [round(lon + x * c - y * s, 6), round(lat + x * s + y * c, 6)]);
    return { type: 'Polygon', coordinates: [[...pts, pts[0]]] };
  };
  FIXTURE_PARCELS.forEach((p, i) => {
    const rot = (hash01(i, 53) - 0.5) * 0.5;
    out.push({ parcel_id: p.parcel_id, fsi_static: p.fsi_static, fsi_live: p.fsi_live, geom_geojson: lot(p.lon, p.lat, 24, 38, rot) });
    // neighbours on the same block (not in the dial list)
    for (let k = 1; k <= 4; k++) {
      const side = k % 2 ? 1 : -1;
      const step = Math.ceil(k / 2);
      const dLon = (side * step * 26) / (111320 * Math.cos((p.lat * Math.PI) / 180));
      out.push({
        parcel_id: `${p.parcel_id}-N${k}`,
        fsi_static: round(Math.max(0.05, Number(p.fsi_static) - 0.12 + hash01(i * 5 + k, 59) * 0.2), 3),
        fsi_live: null,
        geom_geojson: lot(p.lon + dLon * Math.cos(rot), p.lat + dLon * Math.sin(rot) * 0.9, 24, 38, rot),
      });
    }
  });
  const inBox = (g) => {
    if (!box) return true;
    const ring = g.coordinates[0];
    return ring.some(([x, y]) => x >= box.w && x <= box.e && y >= box.s && y <= box.n);
  };
  return out.filter((r) => inBox(r.geom_geojson)).slice(0, lim);
}

/** Demo address / owner / parcel-id search over the enriched fixture parcels. */
export function searchFixtures(q, { owner = true, limit = 10 } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [];
  return FIXTURE_PARCELS.map(enrichFixture)
    .filter((p) =>
      String(p.parcel_id).toLowerCase() === needle ||
      String(p.address || '').toLowerCase().includes(needle) ||
      (owner && String(p.owner_name || '').toLowerCase().includes(needle)))
    .sort((a, b) => Number(b.fsi_live) - Number(a.fsi_live))
    .slice(0, limit);
}

/**
 * Demo post-storm list (storm_cells / storm_dial_list RPC shapes, fsi/sql/010): pretends a band of
 * rain fell over the east of the county yesterday. Fixture mode only.
 */
export function stormFixtures({ minRainMm = 25, minBand = 'should', limit = 200 } = {}) {
  const ok = minBand === 'must' ? ['must'] : minBand === 'maybe' ? ['must', 'should', 'maybe'] : ['must', 'should'];
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10); // 'yesterday'
  const rainAt = (lon, lat) => Math.round(Math.max(0, 85 - Math.abs(lon + 80.98) * 260 - Math.abs(lat - 29.12) * 90) * 10) / 10;
  const parcels = FIXTURE_PARCELS.map(enrichFixture)
    .map((p) => {
      const cell = `demo-${Math.round(p.lat * 20)}-${Math.round(p.lon * 20)}`;
      return { ...p, rain_cell: cell, cell_rain_24h: rainAt(p.lon, p.lat), cell_api: 60, cell_d: 0.7, rain_day: day };
    })
    .filter((p) => p.cell_rain_24h >= minRainMm && ok.includes(p.must_have_band))
    .sort((a, b) => b.cell_rain_24h - a.cell_rain_24h || b.must_have_score - a.must_have_score)
    .slice(0, limit);
  const cells = [];
  const seen = new Set();
  for (const p of parcels) {
    if (seen.has(p.rain_cell)) continue;
    seen.add(p.rain_cell);
    cells.push({ cell_id: p.rain_cell, lat: p.lat, lon: p.lon, rain_24h: p.cell_rain_24h, api_value: 60, d: 0.7, rain_day: day });
  }
  return { cells, parcels };
}
