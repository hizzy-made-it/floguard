/**
 * Assign census_tract to parcels via Census Bureau reverse geocode on a grid,
 * then re-paint claim_heat from nfip_claim_tract (cleaner than 0.1° OpenFEMA cells).
 *
 * Usage:
 *   node scripts/join-census-tracts.mjs
 */
import { supabaseConfig, restHeaders } from './lib/load-env.mjs';

const { url: SUPABASE_URL, key } = supabaseConfig();
const headers = restHeaders(key, 'resolution=merge-duplicates,return=minimal');
const readHeaders = restHeaders(key, 'return=representation');

const BOUNDS = { w: -81.45, s: 28.84, e: -80.85, n: 29.48 };
const CELL = 0.03;
const PAGE = 500;
const PATCH = 100;

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

async function geocodeTract(lon, lat) {
  const u =
    'https://geocoding.geo.census.gov/geocoder/geographies/coordinates?' +
    `x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`census ${r.status}`);
  const j = await r.json();
  const tracts = j?.result?.geographies?.['Census Tracts'] || [];
  const t = tracts[0];
  return t?.GEOID ? String(t.GEOID) : null;
}

async function buildTractGrid() {
  console.log('Census tract grid (Census Bureau geocoder)…');
  const points = [];
  for (let lon = BOUNDS.w; lon <= BOUNDS.e + 1e-9; lon += CELL) {
    for (let lat = BOUNDS.s; lat <= BOUNDS.n + 1e-9; lat += CELL) {
      const x = Math.round(lon * 1000) / 1000;
      const y = Math.round(lat * 1000) / 1000;
      points.push({ lon: x, lat: y, key: `${x},${y}` });
    }
  }
  console.log(`  cells: ${points.length}`);
  const tractByKey = new Map();
  let ok = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    try {
      const geoid = await geocodeTract(p.lon, p.lat);
      if (geoid) {
        tractByKey.set(p.key, geoid);
        ok++;
      }
    } catch {
      // soft-fail cell
    }
    if ((i + 1) % 10 === 0 || i === points.length - 1) {
      process.stdout.write(`\r  geocoded ${i + 1}/${points.length} (ok ${ok})…`);
    }
    await sleep(120); // be polite to Census
  }
  console.log(`\n  tract cells: ${tractByKey.size}`);
  return tractByKey;
}

function nearestTract(grid, lon, lat) {
  const { key, ix, iy } = snapKey(lon, lat);
  if (grid.has(key)) return grid.get(key);
  for (let ring = 1; ring <= 4; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const sx = Math.round((BOUNDS.w + (ix + dx) * CELL) * 1000) / 1000;
        const sy = Math.round((BOUNDS.s + (iy + dy) * CELL) * 1000) / 1000;
        const t = grid.get(`${sx},${sy}`);
        if (t) return t;
      }
    }
  }
  return null;
}

async function loadClaimTracts() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/nfip_claim_tract?select=census_tract,heat,claim_count_10y,paid_sum,last_loss_year&limit=5000`,
    { headers: readHeaders },
  );
  if (!r.ok) throw new Error(`nfip_claim_tract ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  const map = new Map();
  for (const row of rows) {
    map.set(String(row.census_tract), row);
  }
  console.log(`Claim tracts loaded: ${map.size}`);
  return map;
}

async function paintParcels(tractGrid, claimMap) {
  console.log('Assigning census_tract + claim heat from tract table…');
  let cursor = '';
  let updated = 0;
  let withTract = 0;
  let withHeat = 0;

  while (true) {
    const params = new URLSearchParams({
      select: 'parcel_id,lat,lon',
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

    const patches = [];
    for (const p of rows) {
      const lon = Number(p.lon);
      const lat = Number(p.lat);
      if (!isFinite(lon) || !isFinite(lat)) continue;
      const tract = nearestTract(tractGrid, lon, lat);
      const claim = tract ? claimMap.get(tract) : null;
      if (tract) withTract++;
      if (claim) withHeat++;
      patches.push({
        parcel_id: p.parcel_id,
        census_tract: tract,
        claim_heat: claim ? Math.round(Number(claim.heat) * 1000) / 1000 : 0,
        claim_count_10y: claim ? claim.claim_count_10y : 0,
        claim_paid_sum: claim ? claim.paid_sum : 0,
        claim_last_year: claim ? claim.last_loss_year : null,
        updated_at: new Date().toISOString(),
      });
    }

    const upUrl = `${SUPABASE_URL}/rest/v1/parcel_risk?on_conflict=parcel_id`;
    for (let i = 0; i < patches.length; i += PATCH) {
      const chunk = patches.slice(i, i + PATCH);
      const pr = await fetch(upUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(chunk),
      });
      if (!pr.ok) throw new Error(`patch ${pr.status}: ${(await pr.text()).slice(0, 250)}`);
    }
    updated += patches.length;
    cursor = rows[rows.length - 1].parcel_id;
    process.stdout.write(`\r  painted ${updated}…`);
    if (rows.length < PAGE) break;
  }
  console.log(`\n  parcels ${updated} · with tract ${withTract} · with claim heat ${withHeat}`);
}

async function main() {
  console.log('Census tract join + tract-level claim heat');
  console.log(`Target: ${SUPABASE_URL}`);
  const tractGrid = await buildTractGrid();
  const claimMap = await loadClaimTracts();
  await paintParcels(tractGrid, claimMap);
  console.log('Done. Next: node scripts/score-must-have.mjs');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
