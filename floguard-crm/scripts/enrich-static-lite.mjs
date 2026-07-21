/**
 * Static-lite enrichment: FEMA NFHL zone + SSURGO HSG → fsi_static / fsi_live
 * WITHOUT full LiDAR TWI/HAND. Terrain terms park at mild-wet midpoints.
 *
 * Usage:
 *   node scripts/enrich-static-lite.mjs              # all parcels missing fsi_static
 *   node scripts/enrich-static-lite.mjs --limit 5000
 *   node scripts/enrich-static-lite.mjs --force       # recompute even if scored
 *   node scripts/enrich-static-lite.mjs --skip-soil   # FEMA only
 *   node scripts/enrich-static-lite.mjs --skip-fema
 */
import { supabaseConfig, restHeaders } from './lib/load-env.mjs';
import {
  staticScoreLite,
  fsiLiveFromStatic,
  normalizeFemaZone,
  LITE_TWI_N,
  LITE_HAND_N,
} from './lib/fsi-score.mjs';

const { url: SUPABASE_URL, key } = supabaseConfig();
const headers = restHeaders(key, 'resolution=merge-duplicates,return=minimal');
const readHeaders = restHeaders(key, 'return=representation');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const LIMIT = flag('--all') ? Infinity : Number(opt('--limit', '0')) || Infinity;
const FORCE = flag('--force');
const SKIP_SOIL = flag('--skip-soil');
const SKIP_FEMA = flag('--skip-fema');
const PAGE = 1000;
const PATCH_BATCH = 80;

const FEMA_LAYER =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const SDA_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';

// Volusia approx extent
const BOUNDS = { w: -81.45, s: 28.84, e: -80.85, n: 29.48 };
const SOIL_CELL = 0.04; // ~4 km grid for HSG sample (static-lite speed)

async function fetchParcelsPage(offset) {
  const params = new URLSearchParams({
    select: 'parcel_id,lat,lon,hsg,fema_zone,fsi_static,twi_n,hand_n',
    order: 'parcel_id',
    limit: String(PAGE),
    offset: String(offset),
  });
  if (!FORCE) {
    // Prefer rows still unscored
    params.set('or', '(fsi_static.is.null,fema_zone.is.null,hsg.is.null)');
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/parcel_risk?${params}`, {
    headers: { ...readHeaders, Prefer: 'count=exact' },
  });
  if (!r.ok) throw new Error(`parcel page ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function loadAllParcels() {
  const out = [];
  let cursor = '';
  while (out.length < LIMIT) {
    const params = new URLSearchParams({
      select: 'parcel_id,lat,lon,hsg,fema_zone,fsi_static,twi_n,hand_n',
      order: 'parcel_id',
      limit: String(PAGE),
    });
    if (cursor) params.set('parcel_id', `gt.${cursor}`);
    if (!FORCE) {
      params.set('or', '(fsi_static.is.null,fema_zone.is.null,hsg.is.null)');
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/parcel_risk?${params}`, {
      headers: { ...readHeaders, Prefer: 'count=exact' },
    });
    if (!r.ok) throw new Error(`parcel page ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const page = await r.json();
    if (!page.length) break;
    for (const row of page) {
      if (!isFinite(Number(row.lat)) || !isFinite(Number(row.lon))) continue;
      out.push(row);
      if (out.length >= LIMIT) break;
    }
    cursor = page[page.length - 1].parcel_id;
    process.stdout.write(`\rloaded parcels ${out.length}…`);
    if (page.length < PAGE) break;
  }
  console.log(`\nParcels to enrich: ${out.length}`);
  return out;
}

async function fetchJsonRetry(url, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json, application/geo+json' } });
      if (r.status === 502 || r.status === 503 || r.status === 504) {
        lastErr = new Error(`FEMA ${r.status}`);
        await sleep(1500 * (i + 1));
        continue;
      }
      if (!r.ok) throw new Error(`FEMA ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json();
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr || new Error('FEMA fetch failed');
}

/**
 * Point-query FEMA NFHL for a lat/lon. Bulk polygon downloads 504 often;
 * point intersects are reliable. Results cached on a coarse grid.
 */
const _femaPointCache = new Map();

async function lookupFemaZone(lon, lat) {
  // Snap to ~1.1 km grid so neighbors share a lookup (static-lite speed).
  // Finer 0.001° cache was correct but ~10× too many unique FEMA calls for county runs.
  const key = `${(Math.round(lon * 100) / 100).toFixed(2)},${(Math.round(lat * 100) / 100).toFixed(2)}`;
  if (_femaPointCache.has(key)) return _femaPointCache.get(key);

  const q = new URL(FEMA_LAYER);
  q.searchParams.set('geometry', `${lon},${lat}`);
  q.searchParams.set('geometryType', 'esriGeometryPoint');
  q.searchParams.set('inSR', '4326');
  q.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  q.searchParams.set('outFields', 'FLD_ZONE,ZONE_SUBTY,SFHA_TF');
  q.searchParams.set('returnGeometry', 'false');
  q.searchParams.set('f', 'json');
  q.searchParams.set('resultRecordCount', '5');

  try {
    const j = await fetchJsonRetry(q.toString(), 3);
    const feats = j.features || [];
    // Prefer highest-risk zone when multiple
    let best = null;
    let bestRank = -1;
    for (const f of feats) {
      const a = f.attributes || {};
      const z = normalizeFemaZone(a.FLD_ZONE, a.ZONE_SUBTY);
      const rank =
        z === 'VE' ? 100 : z === 'AE' ? 90 : z === 'AO' || z === 'AH' ? 80 : z === 'X-SHADED' ? 40 : z === 'X' ? 20 : 10;
      if (rank > bestRank) {
        bestRank = rank;
        best = z;
      }
    }
    _femaPointCache.set(key, best);
    return best;
  } catch {
    _femaPointCache.set(key, null);
    return null;
  }
}

async function lookupFemaZonesForParcels(parcels) {
  console.log('Looking up FEMA zones (point queries, grid-cached)…');
  const CONCURRENCY = 12;
  let done = 0;
  const zones = new Map(); // parcel_id -> zone
  // First pass: unique cache keys only (one FEMA call per ~1 km cell)
  const keyToParcels = new Map();
  for (const p of parcels) {
    const lon = Number(p.lon);
    const lat = Number(p.lat);
    const key = `${(Math.round(lon * 100) / 100).toFixed(2)},${(Math.round(lat * 100) / 100).toFixed(2)}`;
    if (!keyToParcels.has(key)) keyToParcels.set(key, []);
    keyToParcels.get(key).push(p.parcel_id);
  }
  const keys = [...keyToParcels.keys()];
  console.log(`  unique FEMA cells: ${keys.length} (from ${parcels.length} parcels)`);
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const chunk = keys.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (key) => {
        const [lon, lat] = key.split(',').map(Number);
        const z = await lookupFemaZone(lon, lat);
        for (const pid of keyToParcels.get(key)) {
          if (z) zones.set(pid, z);
        }
      }),
    );
    done = Math.min(i + CONCURRENCY, keys.length);
    process.stdout.write(`\r  FEMA cells ${done}/${keys.length} (zones ${zones.size})…`);
    await sleep(20);
  }
  console.log(`\n  FEMA zones resolved: ${zones.size}`);
  return zones;
}

async function sdaQuery(sql) {
  const r = await fetch(SDA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'format=JSON&query=' + encodeURIComponent(sql),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`SDA ${r.status}: ${text.slice(0, 200)}`);
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`SDA bad JSON: ${text.slice(0, 200)}`);
  }
  return j.Table || j.table || [];
}

/** Sample HSG on a regular grid via SSURGO SDA, return Map key→hsg */
async function sampleSoilGrid() {
  console.log('Sampling SSURGO HSG on grid…');
  const points = [];
  for (let lon = BOUNDS.w; lon <= BOUNDS.e; lon += SOIL_CELL) {
    for (let lat = BOUNDS.s; lat <= BOUNDS.n; lat += SOIL_CELL) {
      points.push({ lon: Math.round(lon * 1000) / 1000, lat: Math.round(lat * 1000) / 1000 });
    }
  }
  console.log(`  grid points: ${points.length}`);

  const mukeyByPt = new Map(); // "lon,lat" -> mukey
  const CONCURRENCY = 6;
  for (let i = 0; i < points.length; i += CONCURRENCY) {
    const chunk = points.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (p) => {
        const wkt = `POINT(${p.lon} ${p.lat})`;
        try {
          const rows = await sdaQuery(
            `SELECT TOP 1 * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${wkt}')`,
          );
          const mukey = rows?.[0]?.[0];
          if (mukey) mukeyByPt.set(`${p.lon},${p.lat}`, String(mukey));
        } catch {
          // soft-fail individual cells
        }
      }),
    );
    process.stdout.write(`\r  soil points ${Math.min(i + CONCURRENCY, points.length)}/${points.length}…`);
    await sleep(40);
  }
  console.log(`\n  mukeys resolved: ${mukeyByPt.size}`);

  const uniqueMukeys = [...new Set(mukeyByPt.values())];
  const hsgByMukey = new Map();
  const M_BATCH = 40;
  for (let i = 0; i < uniqueMukeys.length; i += M_BATCH) {
    const chunk = uniqueMukeys.slice(i, i + M_BATCH);
    const list = chunk.map((m) => `'${m.replace(/'/g, "''")}'`).join(',');
    // Prefer non-null hydgrp; if dominant component is null, take next best
    const sql = `
SELECT mukey, hydgrp FROM (
  SELECT mukey, hydgrp, comppct_r,
    ROW_NUMBER() OVER (
      PARTITION BY mukey
      ORDER BY CASE WHEN hydgrp IS NULL OR LTRIM(RTRIM(hydgrp)) = '' THEN 1 ELSE 0 END, comppct_r DESC
    ) AS rn
  FROM component
  WHERE mukey IN (${list})
    AND hydgrp IS NOT NULL AND LTRIM(RTRIM(hydgrp)) <> ''
) x WHERE rn = 1`;
    try {
      const rows = await sdaQuery(sql);
      for (const row of rows) {
        const mukey = String(row[0]);
        const hyd = row[1] ? String(row[1]).trim().toUpperCase() : null;
        if (hyd) hsgByMukey.set(mukey, hyd);
      }
    } catch (e) {
      console.warn('  HSG batch error:', e.message);
    }
    await sleep(60);
  }
  console.log(`  HSG labels: ${hsgByMukey.size} mukeys`);

  // Build nearest-neighbor lookup grid
  const grid = new Map(); // cell key -> hsg
  for (const [ptKey, mukey] of mukeyByPt) {
    const hsg = hsgByMukey.get(mukey);
    if (hsg) grid.set(ptKey, hsg);
  }
  return grid;
}

function snapSoil(lon, lat) {
  // Same lattice as sampleSoilGrid: BOUNDS origin + n * SOIL_CELL, 3-decimal keys
  const ix = Math.round((lon - BOUNDS.w) / SOIL_CELL);
  const iy = Math.round((lat - BOUNDS.s) / SOIL_CELL);
  const x = Math.round((BOUNDS.w + ix * SOIL_CELL) * 1000) / 1000;
  const y = Math.round((BOUNDS.s + iy * SOIL_CELL) * 1000) / 1000;
  return { x, y, ix, iy };
}

function nearestHsg(grid, lon, lat) {
  const { x, y, ix, iy } = snapSoil(lon, lat);
  const direct = grid.get(`${x},${y}`);
  if (direct) return direct;
  // spiral neighbors on the same lattice
  for (let ring = 1; ring <= 4; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const sx = Math.round((BOUNDS.w + (ix + dx) * SOIL_CELL) * 1000) / 1000;
        const sy = Math.round((BOUNDS.s + (iy + dy) * SOIL_CELL) * 1000) / 1000;
        const h = grid.get(`${sx},${sy}`);
        if (h) return h;
      }
    }
  }
  return null;
}

async function patchRows(rows) {
  // PostgREST upsert on parcel_id
  const url = `${SUPABASE_URL}/rest/v1/parcel_risk?on_conflict=parcel_id`;
  for (let i = 0; i < rows.length; i += PATCH_BATCH) {
    const chunk = rows.slice(i, i + PATCH_BATCH);
    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });
    if (!r.ok) {
      throw new Error(`patch ${r.status}: ${(await r.text()).slice(0, 300)}`);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('Static-lite enrichment (FEMA + soil → FSI)');
  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`force=${FORCE} skipFema=${SKIP_FEMA} skipSoil=${SKIP_SOIL} limit=${LIMIT === Infinity ? 'none' : LIMIT}`);

  const parcels = await loadAllParcels();
  if (!parcels.length) {
    console.log('Nothing to enrich.');
    return;
  }

  let femaByParcel = null;
  if (!SKIP_FEMA) femaByParcel = await lookupFemaZonesForParcels(parcels);

  let soilGrid = null;
  if (!SKIP_SOIL) soilGrid = await sampleSoilGrid();

  const updates = [];
  let withZone = 0,
    withSoil = 0;
  for (const p of parcels) {
    const lon = Number(p.lon);
    const lat = Number(p.lat);
    let zone = p.fema_zone || null;
    let hsg = p.hsg || null;

    if (femaByParcel) {
      const z = femaByParcel.get(p.parcel_id);
      if (z) {
        zone = z;
        withZone++;
      }
    }
    if (soilGrid) {
      const s = nearestHsg(soilGrid, lon, lat);
      if (s) {
        hsg = s;
        withSoil++;
      }
    }

    const twi = isFinite(Number(p.twi_n)) ? Number(p.twi_n) : LITE_TWI_N;
    const hand = isFinite(Number(p.hand_n)) ? Number(p.hand_n) : LITE_HAND_N;
    const s = staticScoreLite(hsg, zone, twi, hand);
    const live = fsiLiveFromStatic(s, 0.5);

    updates.push({
      parcel_id: p.parcel_id,
      fema_zone: zone,
      hsg,
      twi_n: isFinite(Number(p.twi_n)) ? Number(p.twi_n) : LITE_TWI_N,
      hand_n: isFinite(Number(p.hand_n)) ? Number(p.hand_n) : LITE_HAND_N,
      fsi_static: Math.round(s * 10000) / 10000,
      fsi_live: Math.round(live * 100) / 100,
      updated_at: new Date().toISOString(),
    });
  }

  console.log(`Scoring done. zone hits≈${withZone}, soil hits≈${withSoil}. Upserting ${updates.length}…`);
  let written = 0;
  for (let i = 0; i < updates.length; i += PATCH_BATCH) {
    await patchRows(updates.slice(i, i + PATCH_BATCH));
    written += Math.min(PATCH_BATCH, updates.length - i);
    process.stdout.write(`\rupserted ${written}/${updates.length}…`);
  }
  console.log('\nDone. Next: node scripts/ingest-nfip-claims.mjs && node scripts/score-must-have.mjs');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
