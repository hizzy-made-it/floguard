/**
 * OpenFEMA NFIP redacted claims → tract aggregates + parcel claim_heat.
 *
 * Compliance: tract / neighborhood grain ONLY. Never implies a named owner
 * filed a claim. Never used as insurance advice.
 *
 * Usage:
 *   node scripts/ingest-nfip-claims.mjs
 *   node scripts/ingest-nfip-claims.mjs --years 15
 */
import { supabaseConfig, restHeaders } from './lib/load-env.mjs';
import { gridKey } from './lib/geo.mjs';

const { url: SUPABASE_URL, key } = supabaseConfig();
const headers = restHeaders(key, 'resolution=merge-duplicates,return=minimal');
const readHeaders = restHeaders(key, 'return=representation');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const YEARS = Number(opt('--years', '12')) || 12;
const COUNTY = '12127'; // Volusia FL
const CELL = 0.02;
const PAGE = 1000;

async function fetchAllClaims() {
  console.log(`OpenFEMA FimaNfipClaims countyCode=${COUNTY}…`);
  const claims = [];
  let skip = 0;
  while (true) {
    const filter = encodeURIComponent(`countyCode eq '${COUNTY}'`);
    const u =
      `https://www.fema.gov/api/open/v2/FimaNfipClaims?$filter=${filter}` +
      `&$top=${PAGE}&$skip=${skip}` +
      `&$select=censusTract,yearOfLoss,amountPaidOnBuildingClaim,amountPaidOnContentsClaim,latitude,longitude,dateOfLoss` +
      `&$orderby=id`;
    const r = await fetch(u);
    if (!r.ok) throw new Error(`OpenFEMA ${r.status}: ${(await r.text()).slice(0, 250)}`);
    const j = await r.json();
    const rows = j.FimaNfipClaims || [];
    claims.push(...rows);
    process.stdout.write(`\r  claims ${claims.length}…`);
    if (rows.length < PAGE) break;
    skip += rows.length;
    if (skip > 100000) break;
  }
  console.log(`\n  total claims: ${claims.length}`);
  return claims;
}

function aggregate(claims) {
  const nowY = new Date().getFullYear();
  const cutoff = nowY - YEARS;

  const tracts = new Map(); // tract -> stats
  const cells = new Map(); // grid key -> stats

  for (const c of claims) {
    const y = Number(c.yearOfLoss) || (c.dateOfLoss ? new Date(c.dateOfLoss).getFullYear() : 0);
    const paid =
      (Number(c.amountPaidOnBuildingClaim) || 0) + (Number(c.amountPaidOnContentsClaim) || 0);
    const tract = c.censusTract ? String(c.censusTract).trim() : null;
    const lat = Number(c.latitude);
    const lon = Number(c.longitude);

    if (tract) {
      if (!tracts.has(tract)) {
        tracts.set(tract, {
          census_tract: tract,
          claim_count_all: 0,
          claim_count_10y: 0,
          paid_sum: 0,
          last_loss_year: null,
          multi_loss_flag: false,
          _years: new Set(),
        });
      }
      const t = tracts.get(tract);
      t.claim_count_all++;
      if (y >= cutoff) t.claim_count_10y++;
      t.paid_sum += paid;
      if (y && (!t.last_loss_year || y > t.last_loss_year)) t.last_loss_year = y;
      if (y) t._years.add(y);
    }

    if (isFinite(lat) && isFinite(lon)) {
      const gk = gridKey(lon, lat, CELL);
      if (!cells.has(gk)) {
        cells.set(gk, { count_all: 0, count_10y: 0, paid: 0, last: null });
      }
      const g = cells.get(gk);
      g.count_all++;
      if (y >= cutoff) g.count_10y++;
      g.paid += paid;
      if (y && (!g.last || y > g.last)) g.last = y;
    }
  }

  // heat 0-1 by log scale of 10y count
  const tractCounts = [...tracts.values()].map((t) => t.claim_count_10y);
  const maxT = Math.max(1, ...tractCounts, 1);
  for (const t of tracts.values()) {
    t.heat = Math.min(1, Math.log1p(t.claim_count_10y) / Math.log1p(maxT));
    t.multi_loss_flag = t._years.size >= 3 || t.claim_count_10y >= 5;
    delete t._years;
    t.updated_at = new Date().toISOString();
  }

  const cellCounts = [...cells.values()].map((g) => g.count_10y);
  const maxC = Math.max(1, ...cellCounts, 1);
  for (const g of cells.values()) {
    g.heat = Math.min(1, Math.log1p(g.count_10y) / Math.log1p(maxC));
  }

  return { tracts, cells, maxT, maxC };
}

async function upsertTracts(tracts) {
  const rows = [...tracts.values()].map((t) => ({
    census_tract: t.census_tract,
    claim_count_10y: t.claim_count_10y,
    claim_count_all: t.claim_count_all,
    paid_sum: Math.round(t.paid_sum * 100) / 100,
    last_loss_year: t.last_loss_year,
    multi_loss_flag: t.multi_loss_flag,
    heat: Math.round(t.heat * 1000) / 1000,
    updated_at: t.updated_at,
  }));
  console.log(`Upserting ${rows.length} nfip_claim_tract rows…`);
  const url = `${SUPABASE_URL}/rest/v1/nfip_claim_tract?on_conflict=census_tract`;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });
    if (!r.ok) throw new Error(`tract upsert ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
}

/**
 * OpenFEMA lat/lon is heavily rounded (~0.1°). A tight grid leaves most of the
 * county at heat=0. Sample every claim-cell center and apply distance falloff
 * out to ~0.12° (~13 km) so whole neighborhoods get a usable heat signal.
 */
function heatAt(lon, lat, cells) {
  let bestHeat = 0;
  let bestCount = 0;
  let bestPaid = 0;
  let bestLast = null;
  const maxR = 0.12;
  for (const [gk, cell] of cells) {
    const [gc, gr] = gk.split(',').map(Number);
    // cell center
    const cx = (gc + 0.5) * CELL;
    const cy = (gr + 0.5) * CELL;
    const d = Math.hypot(lon - cx, lat - cy);
    if (d > maxR) continue;
    // falloff: full heat at center, ~0.25 at maxR
    const w = Math.max(0, 1 - d / maxR);
    const h = cell.heat * (0.25 + 0.75 * w);
    if (h > bestHeat) {
      bestHeat = h;
      bestCount = Math.round(cell.count_10y * w);
      bestPaid = cell.paid * w;
      bestLast = cell.last;
    }
  }
  return {
    heat: Math.round(Math.min(1, bestHeat) * 1000) / 1000,
    count10: bestCount,
    paid: Math.round(bestPaid * 100) / 100,
    last: bestLast,
  };
}

async function paintParcels(cells) {
  console.log(`Painting claim_heat onto parcels (${cells.size} claim cells, falloff 0.12°)…`);
  // Keyset pagination — deep OFFSET times out on large tables
  let cursor = '';
  let updated = 0;
  const PAGE_P = 500;
  const PATCH = 100;

  while (true) {
    const params = new URLSearchParams({
      select: 'parcel_id,lat,lon,census_tract',
      order: 'parcel_id',
      limit: String(PAGE_P),
    });
    if (cursor) params.set('parcel_id', `gt.${cursor}`);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/parcel_risk?${params}`, {
      headers: readHeaders,
    });
    if (!r.ok) throw new Error(`parcel read ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    if (!rows.length) break;

    const patches = [];
    for (const p of rows) {
      const lon = Number(p.lon);
      const lat = Number(p.lat);
      if (!isFinite(lon) || !isFinite(lat)) continue;
      const { heat, count10, paid, last } = heatAt(lon, lat, cells);
      patches.push({
        parcel_id: p.parcel_id,
        claim_heat: heat,
        claim_count_10y: count10,
        claim_paid_sum: paid,
        claim_last_year: last,
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
      if (!pr.ok) throw new Error(`heat patch ${pr.status}: ${(await pr.text()).slice(0, 250)}`);
    }
    updated += patches.length;
    cursor = rows[rows.length - 1].parcel_id;
    process.stdout.write(`\r  parcels painted ${updated}…`);
    if (rows.length < PAGE_P) break;
  }
  console.log(`\n  claim_heat painted on ${updated} parcels`);
}

async function main() {
  console.log(`NFIP claim heat (OpenFEMA, ${YEARS}y window)`);
  console.log(`Target: ${SUPABASE_URL}`);
  const claims = await fetchAllClaims();
  if (!claims.length) {
    console.log('No claims returned.');
    return;
  }
  const { tracts, cells } = aggregate(claims);
  console.log(`Tracts: ${tracts.size}, grid cells with claims: ${cells.size}`);
  await upsertTracts(tracts);
  await paintParcels(cells);
  console.log('Done. Next: node scripts/score-must-have.mjs');
  console.log(
    'Compliance: claim heat is neighborhood aggregate only — never a property-level insurance claim.',
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
