/**
 * DEM-lite: Open-Meteo elevation grid → relative bowl depth + flatness
 * → twi_n / hand_n → recompute fsi_static / fsi_live (no full LiDAR).
 *
 * Usage:
 *   node scripts/enrich-dem-lite.mjs
 *   node scripts/enrich-dem-lite.mjs --limit 5000
 */
import { supabaseConfig, restHeaders } from './lib/load-env.mjs';
import {
  staticScore,
  fsiLiveFromStatic,
  percentileNormalize,
  normalizeRain,
  dynamicScore,
  LITE_TWI_N,
  LITE_HAND_N,
} from './lib/fsi-score.mjs';

const { url: SUPABASE_URL, key } = supabaseConfig();
const headers = restHeaders(key, 'resolution=merge-duplicates,return=minimal');
const readHeaders = restHeaders(key, 'return=representation');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const LIMIT = Number(opt('--limit', '0')) || Infinity;

const BOUNDS = { w: -81.45, s: 28.84, e: -80.85, n: 29.48 };
const CELL = 0.02; // ~2 km — DEM-lite
const ELEV_BATCH = 40; // Open-Meteo free tier is strict on minute rate
const PAGE = 500;
const PATCH = 80;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function snapKey(lon, lat) {
  const ix = Math.round((lon - BOUNDS.w) / CELL);
  const iy = Math.round((lat - BOUNDS.s) / CELL);
  const x = Math.round((BOUNDS.w + ix * CELL) * 1000) / 1000;
  const y = Math.round((BOUNDS.s + iy * CELL) * 1000) / 1000;
  return { key: `${x},${y}`, x, y, ix, iy };
}

async function fetchElevations(points) {
  // Open-Meteo elevation: multiple lat/lon pairs
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const u =
    'https://api.open-meteo.com/v1/elevation?latitude=' +
    lats.join(',') +
    '&longitude=' +
    lons.join(',');
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch(u);
    if (r.status === 429) {
      const wait = 65000 + attempt * 15000;
      process.stdout.write(`\n  rate-limited — wait ${Math.round(wait / 1000)}s…`);
      await sleep(wait);
      continue;
    }
    if (!r.ok) throw new Error(`elevation ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return j.elevation || [];
  }
  throw new Error('elevation: rate limit after retries');
}

async function buildElevGrid() {
  console.log('Building elevation grid via Open-Meteo…');
  const points = [];
  for (let lon = BOUNDS.w; lon <= BOUNDS.e + 1e-9; lon += CELL) {
    for (let lat = BOUNDS.s; lat <= BOUNDS.n + 1e-9; lat += CELL) {
      const x = Math.round(lon * 1000) / 1000;
      const y = Math.round(lat * 1000) / 1000;
      points.push({ lon: x, lat: y, key: `${x},${y}` });
    }
  }
  console.log(`  grid points: ${points.length}`);
  const elevByKey = new Map();
  for (let i = 0; i < points.length; i += ELEV_BATCH) {
    const chunk = points.slice(i, i + ELEV_BATCH);
    const elevs = await fetchElevations(chunk);
    chunk.forEach((p, j) => {
      const e = elevs[j];
      if (isFinite(e)) elevByKey.set(p.key, e);
    });
    process.stdout.write(`\r  elev ${Math.min(i + ELEV_BATCH, points.length)}/${points.length}…`);
    await sleep(1200); // stay under Open-Meteo free minute quota
  }
  console.log(`\n  elevations: ${elevByKey.size}`);

  // Local mean + relief → raw TWI/HAND proxies
  const meta = new Map(); // key -> { elev, rel, relief, twiRaw, handRaw }
  for (const p of points) {
    const e = elevByKey.get(p.key);
    if (!isFinite(e)) continue;
    const { ix, iy } = snapKey(p.lon, p.lat);
    const neigh = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const sx = Math.round((BOUNDS.w + (ix + dx) * CELL) * 1000) / 1000;
        const sy = Math.round((BOUNDS.s + (iy + dy) * CELL) * 1000) / 1000;
        const ne = elevByKey.get(`${sx},${sy}`);
        if (isFinite(ne)) neigh.push(ne);
      }
    }
    if (!neigh.length) continue;
    const localMean = neigh.reduce((a, b) => a + b, 0) / neigh.length;
    const localMax = Math.max(...neigh);
    const localMin = Math.min(...neigh);
    const relief = localMax - localMin; // m
    const rel = e - localMean; // negative = bowl
    // HAND proxy: relative elevation (high = high hand)
    const handRaw = rel;
    // TWI proxy: bowls (neg rel) + flats (low relief)
    const flat = 1 / (1 + relief);
    const twiRaw = -rel + 2 * flat;
    meta.set(p.key, { elev: e, rel, relief, twiRaw, handRaw });
  }

  const twiNorm = percentileNormalize([...meta.values()].map((m) => m.twiRaw), 2, 98);
  const handNorm = percentileNormalize([...meta.values()].map((m) => m.handRaw), 2, 98);
  for (const [k, m] of meta) {
    m.twi_n = twiNorm(m.twiRaw);
    m.hand_n = handNorm(m.handRaw);
  }
  console.log(`  terrain cells ready: ${meta.size}`);
  return meta;
}

function nearestTerrain(grid, lon, lat) {
  const { key, ix, iy } = snapKey(lon, lat);
  if (grid.has(key)) return grid.get(key);
  for (let ring = 1; ring <= 3; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const sx = Math.round((BOUNDS.w + (ix + dx) * CELL) * 1000) / 1000;
        const sy = Math.round((BOUNDS.s + (iy + dy) * CELL) * 1000) / 1000;
        const hit = grid.get(`${sx},${sy}`);
        if (hit) return hit;
      }
    }
  }
  return null;
}

async function loadRainD() {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/rainfall_state?county_fips=eq.12127&select=api_value,rain_24h&limit=1`,
      { headers: readHeaders },
    );
    if (!r.ok) return 0.5;
    const rows = await r.json();
    if (!rows?.[0]) return 0.5;
    const { api_n, rain24_n } = normalizeRain(rows[0].api_value, rows[0].rain_24h);
    return dynamicScore(api_n, rain24_n);
  } catch {
    return 0.5;
  }
}

async function loadParcels() {
  const out = [];
  let cursor = '';
  while (out.length < LIMIT) {
    const params = new URLSearchParams({
      select: 'parcel_id,lat,lon,hsg,fema_zone,fsi_static,twi_n,hand_n',
      order: 'parcel_id',
      limit: String(PAGE),
    });
    if (cursor) params.set('parcel_id', `gt.${cursor}`);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/parcel_risk?${params}`, {
      headers: readHeaders,
    });
    if (!r.ok) throw new Error(`parcel ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    if (!rows.length) break;
    for (const row of rows) {
      if (!isFinite(Number(row.lat)) || !isFinite(Number(row.lon))) continue;
      out.push(row);
      if (out.length >= LIMIT) break;
    }
    cursor = rows[rows.length - 1].parcel_id;
    process.stdout.write(`\rloaded parcels ${out.length}…`);
    if (rows.length < PAGE) break;
  }
  console.log(`\nParcels: ${out.length}`);
  return out;
}

async function main() {
  console.log('DEM-lite enrichment (Open-Meteo elevation → TWI/HAND proxies)');
  console.log(`Target: ${SUPABASE_URL}`);
  const grid = await buildElevGrid();
  const d = await loadRainD();
  console.log(`Dynamic D (rainfall): ${d.toFixed(3)}`);
  const parcels = await loadParcels();

  const patches = [];
  let hits = 0;
  for (const p of parcels) {
    const t = nearestTerrain(grid, Number(p.lon), Number(p.lat));
    const twi = t ? t.twi_n : isFinite(Number(p.twi_n)) ? Number(p.twi_n) : LITE_TWI_N;
    const hand = t ? t.hand_n : isFinite(Number(p.hand_n)) ? Number(p.hand_n) : LITE_HAND_N;
    if (t) hits++;
    const s = staticScore(twi, hand, p.hsg, p.fema_zone);
    const live = fsiLiveFromStatic(s, d);
    patches.push({
      parcel_id: p.parcel_id,
      twi_n: Math.round(twi * 10000) / 10000,
      hand_n: Math.round(hand * 10000) / 10000,
      fsi_static: Math.round(s * 10000) / 10000,
      fsi_live: Math.round(live * 100) / 100,
      updated_at: new Date().toISOString(),
    });
  }
  console.log(`Terrain hits: ${hits}/${parcels.length}. Upserting…`);

  const url = `${SUPABASE_URL}/rest/v1/parcel_risk?on_conflict=parcel_id`;
  for (let i = 0; i < patches.length; i += PATCH) {
    const chunk = patches.slice(i, i + PATCH);
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(chunk) });
    if (!r.ok) throw new Error(`upsert ${r.status}: ${(await r.text()).slice(0, 250)}`);
    process.stdout.write(`\rupserted ${Math.min(i + PATCH, patches.length)}/${patches.length}…`);
  }
  const lives = patches.map((p) => p.fsi_live).sort((a, b) => a - b);
  const p10 = lives[Math.floor(lives.length * 0.1)] ?? 0;
  const p90 = lives[Math.floor(lives.length * 0.9)] ?? 0;
  console.log(`\nDone. fsi_live p10=${p10} p90=${p90} spread=${(p90 - p10).toFixed(1)}`);
  console.log('Next: node scripts/score-must-have.mjs');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
