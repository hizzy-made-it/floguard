/**
 * Pull parcel centroids straight from the Volusia appraiser layer so the
 * terrain batch does not need Supabase (useful when the project is paused or
 * egress-capped). Same centroid rule as scripts/ingest-volusia-parcels.mjs
 * (mean of the outer ring), so values line up with parcel_risk.lat/lon.
 *
 * Output: fsi/data/parcel_centroids.csv  (parcel_id,lat,lon)
 * Usage:  node fsi/pipeline/pull_centroids.mjs
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAYER = 'https://maps2.vcgov.org/arcgis/rest/services/Pictometry_Parcels/MapServer/0';
const PAGE = 1000;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../data/parcel_centroids.csv');

function centroid(geom) {
  if (!geom || !geom.coordinates) return null;
  let rings;
  if (geom.type === 'Polygon') rings = geom.coordinates;
  else if (geom.type === 'MultiPolygon') rings = geom.coordinates[0];
  else return null;
  const ring = rings[0];
  if (!ring?.length) return null;
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x; sy += y; n++;
  }
  return n ? { lon: sx / n, lat: sy / n } : null;
}

async function fetchPage(offset, attempt = 0) {
  const q = new URL(`${LAYER}/query`);
  q.searchParams.set('where', '1=1');
  q.searchParams.set('outFields', 'PARID');
  q.searchParams.set('outSR', '4326');
  q.searchParams.set('f', 'geojson');
  q.searchParams.set('orderByFields', 'OBJECTID');
  q.searchParams.set('resultOffset', String(offset));
  q.searchParams.set('resultRecordCount', String(PAGE));
  q.searchParams.set('returnGeometry', 'true');
  q.searchParams.set('geometryPrecision', '6');
  q.searchParams.set('maxAllowableOffset', '0.0002'); // ~20 m generalisation: centroid barely moves, payload shrinks
  try {
    const r = await fetch(q, { signal: AbortSignal.timeout(90_000) });
    if (!r.ok) throw new Error(`arcgis ${r.status}`);
    return await r.json();
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    return fetchPage(offset, attempt + 1);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
const out = createWriteStream(OUT);
out.write('parcel_id,lat,lon\n');
const seen = new Set();
let offset = 0;
let written = 0;
for (;;) {
  const j = await fetchPage(offset);
  const feats = j.features || [];
  if (!feats.length) break;
  for (const f of feats) {
    const id = String(f.properties?.PARID || '').trim();
    if (!id || seen.has(id)) continue;
    const c = centroid(f.geometry);
    if (!c) continue;
    seen.add(id);
    out.write(`${id},${c.lat.toFixed(6)},${c.lon.toFixed(6)}\n`);
    written++;
  }
  offset += feats.length;
  process.stdout.write(`\rpage offset ${offset} · written ${written}`);
  if (feats.length < PAGE && !j.exceededTransferLimit) break;
}
out.end();
console.log(`\nwrote ${written} centroids -> ${OUT}`);
