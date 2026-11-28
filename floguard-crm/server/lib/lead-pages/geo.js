/**
 * Free public GIS lookups for a lead's address. Every call has a timeout and never throws to the
 * caller: a missing piece only downgrades the page from "full" to "simple".
 *
 *   geocode     US Census geocoder (point lands on the street centerline)
 *   parcel      Volusia County parcels (Pictometry_Parcels/MapServer/0), matched by house number
 *   aerial      Volusia 2021 ImageServer -> Volusia 2018 3-in MapServer -> USGS imagery (any US address)
 *   elevation   USGS 3DEP lidar getSamples on a grid inside the lot (metres)
 *
 * Only geometry and lot size are kept from the parcel record (never owner, sale or value fields).
 */

const R = 6378137;
export const toMerc = ([lon, lat]) => [
  (R * lon * Math.PI) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];
export const fromMerc = ([x, y]) => [
  (x / R) * (180 / Math.PI),
  (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI),
];

async function getJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 10000, body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init = { signal: ctrl.signal };
    if (body) {
      init.method = 'POST';
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      init.body = body;
    }
    const r = await fetchImpl(url, init);
    if (!r.ok) {
      console.error('[lead-page:gis]', new URL(url).host, 'status', r.status);
      return null;
    }
    const j = await r.json();
    if (j?.error) console.error('[lead-page:gis]', new URL(url).host, 'error', JSON.stringify(j.error).slice(0, 160));
    return j && !j.error ? j : null;
  } catch (e) {
    console.error('[lead-page:gis]', new URL(url).host, String(e?.name || e).slice(0, 60));
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function getBytes(url, { fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctrl.signal });
    const type = String(r.headers?.get?.('content-type') || '');
    if (!r.ok || (type && !/^image\//i.test(type))) {
      console.error('[lead-page:img]', new URL(url).host, r.status, type.slice(0, 40));
      return null;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 2000 ? buf : null;
  } catch (e) {
    console.error('[lead-page:img]', new URL(url).host, String(e?.name || e).slice(0, 60));
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** "504 NW 31st St, Gainesville FL" -> { number: '504', street: 'NW 31ST ST' } */
export function splitAddress(address) {
  const s = String(address || '').trim();
  const m = s.match(/^\s*(\d+[A-Za-z]?)\s+([^,]+)/);
  if (!m) return { number: '', street: '' };
  return { number: m[1], street: m[2].trim().toUpperCase() };
}

export async function geocode(address, city, opts = {}) {
  const one = [address, city].filter((v) => v && String(v).trim()).join(', ');
  if (!splitAddress(address).number) return null; // need a street number to place the lot
  const q = /\bFL\b|Florida/i.test(one) ? one : `${one}, FL`;
  const url =
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' +
    encodeURIComponent(q);
  const j = await getJson(url, opts);
  const m = j?.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;
  return { lon: m.coordinates.x, lat: m.coordinates.y, matched: String(m.matchedAddress || '') };
}

const PARCEL_URL =
  process.env.LEAD_PAGE_PARCEL_URL ||
  'https://maps2.vcgov.org/arcgis/rest/services/Pictometry_Parcels/MapServer/0/query';

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
}

/** Parcel whose house number matches the lead's; else the parcel nearest the geocoded point. */
export async function findParcel(pt, address, opts = {}) {
  const params = new URLSearchParams({
    geometry: `${pt.lon},${pt.lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: '70',
    units: 'esriSRUnit_Meter',
    outFields: 'ADRNO,ADDRFULL,LANDSQFT',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });
  const j = await getJson(`${PARCEL_URL}?${params}`, opts);
  const feats = (j?.features || []).filter((f) => f?.geometry?.rings?.[0]?.length >= 4);
  if (!feats.length) return null;
  const { number, street } = splitAddress(address);
  const word = street.split(/\s+/).find((w) => w.length > 3 && !/^(NORTH|SOUTH|EAST|WEST)$/.test(w)) || '';
  const sameNo = feats.filter((f) => number && String(Math.round(Number(f.attributes?.ADRNO))) === number.replace(/\D/g, ''));
  let pick = sameNo.find((f) => word && String(f.attributes?.ADDRFULL || '').toUpperCase().includes(word)) || sameNo[0];
  if (!pick) return null; // a neighbour's lot would be worse than no lot
  const ring = pick.geometry.rings.reduce((best, r) => (ringArea(r) > ringArea(best) ? r : best));
  return { ring, lot_sqft: Number(pick.attributes?.LANDSQFT) || null };
}

/** Street-side midpoint of the lot: the edge closest to the geocoded (street centerline) point. */
export function frontage(ring, streetPt) {
  let best = null;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = toMerc(ring[i]);
    const b = toMerc(ring[i + 1]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 3) continue;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const { d } = distToSeg(toMerc([streetPt.lon, streetPt.lat]), a, b);
    if (!best || d < best.d) best = { d, a, b, mid };
  }
  return best ? { mid: fromMerc(best.mid), a: fromMerc(best.a), b: fromMerc(best.b) } : null;
}

const IMAGERY = () =>
  (process.env.LEAD_PAGE_IMAGERY ||
    [
      'image|https://maps2.vcgov.org/arcgis/rest/services/Aerial_2021/ImageServer/exportImage|Volusia County aerial (2021)',
      'map|https://maps2.vcgov.org/arcgis/rest/services/Aerials/MapServer/export|layers=show:1,2|Volusia County 3-in. aerial (2018)',
      'map|https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export||USGS National Map imagery',
    ].join(';'))
    .split(';')
    .map((s) => s.split('|'))
    .map((p) => (p[0] === 'image' ? { kind: 'image', url: p[1], extra: '', credit: p[2] } : { kind: 'map', url: p[1], extra: p[2] || '', credit: p[3] }));

/**
 * Frame around the lot (16:9, ~2.4x the lot), in Web Mercator so pixels map linearly.
 * Returns { jpeg, extent:{xmin,ymin,xmax,ymax}, width, height, credit } or null.
 */
export function frameFor(ring, { width = 1200, height = 675 } = {}) {
  const pts = ring.map(toMerc);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const half = Math.max((w * 2.4) / 2, ((h * 2.4) / 2) * (width / height), 38);
  const halfY = half * (height / width);
  return { xmin: cx - half, xmax: cx + half, ymin: cy - halfY, ymax: cy + halfY, width, height };
}

export async function fetchAerial(frame, opts = {}) {
  const { xmin, ymin, xmax, ymax, width, height } = frame;
  for (const src of IMAGERY()) {
    const p = new URLSearchParams({
      bbox: [xmin, ymin, xmax, ymax].join(','),
      bboxSR: '3857',
      imageSR: '3857',
      size: `${width},${height}`,
      format: 'jpg',
      f: 'json',
    });
    if (src.kind === 'map') {
      p.set('transparent', 'false');
      p.set('dpi', '96');
      for (const kv of src.extra.split('&').filter(Boolean)) {
        const [k, v] = kv.split('=');
        p.set(k, v);
      }
    } else {
      p.set('interpolation', 'RSP_BilinearInterpolation');
    }
    const meta = await getJson(`${src.url}?${p}`, opts);
    const href = meta?.href;
    const ext = meta?.extent;
    if (!href || !ext) continue;
    const jpeg = await getBytes(href, opts);
    if (!jpeg) continue;
    return {
      jpeg,
      extent: { xmin: ext.xmin, ymin: ext.ymin, xmax: ext.xmax, ymax: ext.ymax },
      width: meta.width || width,
      height: meta.height || height,
      credit: src.credit,
    };
  }
  return null;
}

const ELEV_URL =
  process.env.LEAD_PAGE_ELEVATION_URL ||
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples';

/** Grid of ~150 lidar samples inside the lot. Returns [{lon,lat,z}] (z in feet) or null. */
export async function sampleElevation(ring, opts = {}) {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const N = 14;
  const pts = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const p = [x0 + ((i + 0.5) / N) * (x1 - x0), y0 + ((j + 0.5) / N) * (y1 - y0)];
      if (pointInRing(p, ring)) pts.push(p);
    }
  }
  if (pts.length < 12) return null;
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points: pts, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryMultipoint',
    returnFirstValueOnly: 'true',
    f: 'json',
  }).toString();
  const j = await getJson(ELEV_URL, { ...opts, body, timeoutMs: 9000 });
  const samples = (j?.samples || [])
    .map((s) => ({ id: s.locationId, z: Number(s.value) }))
    .filter((s) => Number.isFinite(s.z) && s.z > -50 && s.z < 500 && pts[s.id]);
  if (samples.length < 12) return null;
  return {
    cell: { dlon: (x1 - x0) / N, dlat: (y1 - y0) / N },
    points: samples.map((s) => ({ lon: pts[s.id][0], lat: pts[s.id][1], z: Math.round(s.z * 3.28084 * 100) / 100 })),
  };
}

/** Low ground = the lowest quarter of the lot, if the lot actually has a bowl (>= 0.3 ft relief). */
export function lowGround(elev) {
  if (!elev?.points?.length) return null;
  const zs = elev.points.map((p) => p.z).sort((a, b) => a - b);
  const min = zs[0];
  const max = zs[zs.length - 1];
  if (max - min < 0.3) return { flat: true, min, max, cells: [], low: null };
  const cut = zs[Math.floor(zs.length * 0.25)];
  const cells = elev.points.filter((p) => p.z <= cut);
  const low = elev.points.reduce((a, b) => (b.z < a.z ? b : a));
  return { flat: false, min, max, cells, low, cut };
}

/** Everything the page needs, best effort, in about 15 s worst case. */
export async function enrichAddress(address, city, opts = {}) {
  const out = { geo: null, parcel: null, front: null, frame: null, aerial: null, elev: null };
  out.geo = await geocode(address, city, opts);
  if (!out.geo) return out;
  out.parcel = await findParcel(out.geo, address, opts);
  if (!out.parcel) return out;
  out.front = frontage(out.parcel.ring, out.geo);
  out.frame = frameFor(out.parcel.ring);
  const [aerial, elev] = await Promise.all([fetchAerial(out.frame, opts), sampleElevation(out.parcel.ring, opts)]);
  out.aerial = aerial;
  out.elev = elev;
  return out;
}
