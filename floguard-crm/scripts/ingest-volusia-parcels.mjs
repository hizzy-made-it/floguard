/**
 * Ingest Volusia ParcelOwners into parcel_risk via Supabase REST (service role).
 * No DATABASE_URL required — uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.
 *
 * Default layer: maps2.vcgov.org Pictometry_Parcels/ParcelOwners
 *
 * Usage:
 *   node scripts/ingest-volusia-parcels.mjs              # pilot: first 2k residential
 *   node scripts/ingest-volusia-parcels.mjs --all         # full county (long)
 *   node scripts/ingest-volusia-parcels.mjs --limit 500
 *   node scripts/ingest-volusia-parcels.mjs --where "CITYNAME='PORT ORANGE'"
 *
 * After load, FIXTURE-* rows remain until you delete them:
 *   node scripts/ingest-volusia-parcels.mjs --purge-fixtures
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const envFile = path.join(root, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const LAYER =
  process.env.FSI_PARCEL_LAYER_URL ||
  'https://maps2.vcgov.org/arcgis/rest/services/Pictometry_Parcels/MapServer/0';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PAGE = Math.min(1000, Number(process.env.FSI_PAGE_SIZE) || 500);
const BATCH = 100;

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(name);
}
function opt(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

if (!SUPABASE_URL || !KEY) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (floguard project).');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=minimal',
};

function centroid(geom) {
  if (!geom || !geom.coordinates) return null;
  let rings;
  if (geom.type === 'Polygon') rings = geom.coordinates;
  else if (geom.type === 'MultiPolygon') rings = geom.coordinates[0];
  else return null;
  const ring = rings[0];
  if (!ring?.length) return null;
  let sx = 0,
    sy = 0,
    n = 0;
  for (const [x, y] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x;
    sy += y;
    n++;
  }
  if (!n) return null;
  return { lon: sx / n, lat: sy / n };
}

function addrFrom(props) {
  if (props.ADDRFULL && String(props.ADDRFULL).trim()) {
    const city = props.CITYNAME || '';
    const zip = props.ZIP1 || '';
    return [String(props.ADDRFULL).trim(), city, zip ? `FL ${zip}` : 'FL']
      .filter(Boolean)
      .join(', ')
      .replace(/\s+/g, ' ');
  }
  const parts = [props.ADRNO, props.ADRDIR, props.ADRSTR, props.ADRSUF, props.UNITNO]
    .filter((x) => x != null && String(x).trim() !== '')
    .join(' ');
  const city = props.CITYNAME || '';
  return [parts, city, props.ZIP1 ? `FL ${props.ZIP1}` : '']
    .filter(Boolean)
    .join(', ')
    .replace(/\s+/g, ' ');
}

function rowFromFeature(f) {
  const p = f.properties || f.attributes || {};
  const id = String(p.PARID || p.ALTKEY || p.PID || p.ALT_ID || '').trim();
  if (!id) return null;
  const c = centroid(f.geometry);
  if (!c) return null;
  const year = Number(p.ACT_YR_BLT || p.EFF_YR_BLT);
  const living = Number(p.RES_TOTAL_SFLA || p.TOT_LVG_AR);
  const just = Number(p.TOTJUST || p.JV);
  return {
    parcel_id: id,
    address: addrFrom(p) || null,
    owner_name: p.OWNER1 || p.OWNER2 || null,
    lat: c.lat,
    lon: c.lon,
    city: p.CITYNAME || null,
    zip: p.ZIP1 ? String(p.ZIP1) : null,
    alt_key: p.ALTKEY != null ? String(p.ALTKEY) : null,
    dor_use: p.PC || p.CLASS || null,
    use_desc: p.PC_DESC || null,
    year_built: Number.isFinite(year) && year > 1800 ? Math.floor(year) : null,
    living_area: Number.isFinite(living) && living > 0 ? living : null,
    just_value: Number.isFinite(just) && just > 0 ? just : null,
    homestead: p.HXFLAG || null,
    last_sale_price:
      Number.isFinite(Number(p.LASTSALEPRICE)) && Number(p.LASTSALEPRICE) > 0
        ? Number(p.LASTSALEPRICE)
        : null,
    updated_at: new Date().toISOString(),
  };
}

/** Dedupe by parcel_id — ArcGIS can emit the same PARID twice in one page;
 *  Postgres ON CONFLICT DO UPDATE rejects double-hits in a single statement. */
function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row?.parcel_id) continue;
    map.set(row.parcel_id, row); // last wins
  }
  return [...map.values()];
}

async function upsertBatch(rows) {
  const unique = dedupeRows(rows);
  if (!unique.length) return;
  const url = `${SUPABASE_URL}/rest/v1/parcel_risk?on_conflict=parcel_id`;
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(unique),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`upsert ${r.status}: ${t.slice(0, 400)}`);
  }
}

async function purgeFixtures() {
  const url = `${SUPABASE_URL}/rest/v1/parcel_risk?parcel_id=like.FIXTURE-*`;
  const r = await fetch(url, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=minimal' },
  });
  if (!r.ok) throw new Error(`purge fixtures ${r.status}: ${await r.text()}`);
  console.log('Purged FIXTURE-* rows.');
}

async function fetchPage(offset, where) {
  const q = new URL(LAYER.replace(/\/$/, '') + '/query');
  q.searchParams.set('where', where);
  q.searchParams.set('outFields', '*');
  q.searchParams.set('outSR', '4326');
  q.searchParams.set('f', 'geojson');
  q.searchParams.set('resultOffset', String(offset));
  q.searchParams.set('resultRecordCount', String(PAGE));
  q.searchParams.set('returnGeometry', 'true');
  const r = await fetch(q);
  if (!r.ok) throw new Error(`arcgis ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function main() {
  if (flag('--purge-fixtures')) {
    await purgeFixtures();
    return;
  }

  // Residential-ish filter: has living units or residential class codes common in Volusia
  // CLASS '01' often residential; also allow improved with beds / SFLA.
  const where =
    opt('--where') ||
    (flag('--all')
      ? '1=1'
      : "(RES_TOTAL_SFLA > 0 OR LIVUNIT > 0 OR CLASS IN ('01','02','04'))");

  const limit = flag('--all') ? Infinity : Number(opt('--limit', '2000'));
  console.log(`Layer: ${LAYER}`);
  console.log(`Where: ${where}`);
  console.log(`Limit: ${limit === Infinity ? 'none' : limit}`);
  console.log(`Target: ${SUPABASE_URL}`);

  // Ensure extended columns exist (ignore errors if migration not applied — base cols still work)
  let offset = 0;
  let written = 0;
  let skipped = 0;
  let batch = [];

  while (written < limit) {
    const payload = await fetchPage(offset, where);
    const features = payload.features || [];
    if (!features.length) break;

    for (const f of features) {
      if (written + batch.length >= limit) break;
      const row = rowFromFeature(f);
      if (!row) {
        skipped++;
        continue;
      }
      batch.push(row);
      if (batch.length >= BATCH) {
        try {
          await upsertBatch(batch);
        } catch (e) {
          // Fallback: strip extended columns if migration 004 not applied
          if (String(e.message).includes('column') || String(e.message).includes('PGRST')) {
            const slim = batch.map(
              ({ parcel_id, address, owner_name, lat, lon, updated_at }) => ({
                parcel_id,
                address,
                owner_name,
                lat,
                lon,
                updated_at,
              }),
            );
            await upsertBatch(slim);
          } else throw e;
        }
        written += batch.length;
        process.stdout.write(`\rupserted ${written}…`);
        batch = [];
      }
    }

    offset += features.length;
    const more = payload.exceededTransferLimit;
    if (!more && features.length < PAGE) break;
    if (written >= limit) break;
  }
  if (batch.length) {
    try {
      await upsertBatch(batch);
    } catch (e) {
      const slim = batch.map(({ parcel_id, address, owner_name, lat, lon, updated_at }) => ({
        parcel_id,
        address,
        owner_name,
        lat,
        lon,
        updated_at,
      }));
      await upsertBatch(slim);
    }
    written += batch.length;
  }
  console.log(`\nDone: ${written} parcels upserted, ${skipped} skipped.`);
  console.log('Next: open Flood Map → Top countywide. Optionally --purge-fixtures after verifying.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
