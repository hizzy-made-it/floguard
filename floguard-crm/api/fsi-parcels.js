/**
 * Flood Susceptibility Index — parcel reads for the CRM map panel.
 * Spec: docs/FLOOD-SUSCEPTIBILITY-INDEX.md
 *
 * POST body: { action: 'viewport'|'top'|'storm'|'claims_layer'|'claims_events', bbox?: [w,s,e,n], minFsi?, limit?,
 *              minRainMm?, minBand? }   -- 'storm': parcels in cells with >= minRainMm yesterday (fsi/sql/010)
 *   'claims_layer'  : NFIP claim aggregates per census block group in bbox (fsi/sql/016), optional
 *                     { event, eventYear, includeGeom, limit }. 'claims_events': storm-event list for filter chips.
 *   Contract: docs/handoff/B.md
 * Auth: Authorization: Bearer <academy session token>
 *
 * Prefer public.parcel_risk via PostgREST. When the table is missing (migrations
 * not applied), fall back to bundled FIXTURE-* parcels so the map panel stays
 * usable. Real county data still requires fsi/sql/001 + ingest.
 */
import { verifySessionToken } from '../server/lib/academy-db.js';
import { restGet, rest } from '../server/lib/supabase-rest.js';
import { queryFixtures } from '../server/lib/fsi-fixtures.js';
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';

export const config = { maxDuration: 30 };

const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 500;
/** Must dial default page size — tight weekly list, not entire must band. */
const DEFAULT_MUST_LIMIT = 200;

// Never ship owner_name to the browser without a session; never ship phone at all.
// twi_n / hand_n enable client score-breakdown UI when real terrain factors exist.
// claim_* is a tract / census-block-group neighbourhood aggregate only — never a personal claim flag.
//
// Column lists. COLUMNS_BASE exists on every migrated database. COLUMNS_OPTIONAL are added by later
// migrations (016 block-group claims, ...). When PostgREST reports one as missing the read is retried
// without it (see selectWithColumnFallback), so deploying this file before the SQL is applied is safe.
// To add a column from a newer migration, append it to COLUMNS_OPTIONAL — nothing else needs to change.
export const COLUMNS_BASE = [
  'parcel_id', 'address', 'owner_name', 'lat', 'lon', 'fsi_live', 'fsi_static', 'fema_zone', 'hsg', 'twi_n', 'hand_n',
  'claim_heat', 'claim_count_10y', 'claim_last_year', 'must_have_score', 'must_have_band', 'must_have_reasons',
  'year_built', 'living_area', 'just_value', 'city', 'zip', 'homestead', 'dor_use', 'use_desc', 'lot_sqft',
  'impervious_ratio', 'depr_m', 'depr_n',
];
export const COLUMNS_OPTIONAL = [
  // fsi/sql/016 — block-group claim aggregates (neighbourhood level)
  'block_group', 'claim_bg_count_10y', 'claim_bg_zone_x_10y', 'claim_bg_rate', 'claim_bg_last_year', 'claim_bg_top_event',
];
const COLUMNS = [...COLUMNS_BASE, ...COLUMNS_OPTIONAL].join(',');

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function clampLimit(n) {
  const v = Number.parseInt(n, 10);
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_LIMIT;
  return Math.min(v, MAX_LIMIT);
}

/** Reject a bbox that is malformed or spans more than ~1 degree. A whole-state
 *  box would pull every parcel in the table and blow the response budget. */
function validateBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const [w, s, e, n] = bbox.map(Number);
  if (![w, s, e, n].every(Number.isFinite)) return null;
  if (e <= w || n <= s) return null;
  if (e - w > 1 || n - s > 1) return null;
  return { w, s, e, n };
}

function isMissingTableError(err) {
  const status = err?.status;
  const body = err?.body;
  const msg = String(err?.message || '');
  const code = body?.code || '';
  // PostgREST: PGRST205 table not in schema cache; REST wrapper may surface 404
  if (code === 'PGRST205') return true;
  if (status === 404 && /parcel_risk|schema cache|Could not find the table/i.test(msg + JSON.stringify(body || {}))) {
    return true;
  }
  if (/Could not find the table ['"]public\.parcel_risk/i.test(msg)) return true;
  return false;
}

function projectRow(row) {
  const out = {};
  for (const col of COLUMNS.split(',')) {
    out[col] = row[col] ?? null;
  }
  return out;
}

/** PostgREST / Postgres "unknown column" errors: 42703 (select/filter/order), PGRST204 (schema cache). */
export function isMissingColumnError(err) {
  const msg = String(err?.message || '') + JSON.stringify(err?.body || {});
  const code = err?.body?.code || '';
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    /column\s+(?:"?[\w]+"?\.)?"?[\w]+"?\s+does not exist/i.test(msg) ||
    /Could not find the '[\w]+' column/i.test(msg)
  );
}

/** Name of the offending column, or null when the message does not say. */
export function parseMissingColumn(err) {
  const msg = String(err?.body?.message || '') + ' ' + String(err?.message || '');
  let m = msg.match(/column\s+(?:"?[\w]+"?\.)?"?([\w]+)"?\s+does not exist/i);
  if (m) return m[1];
  m = msg.match(/Could not find the '([\w]+)' column/i);
  return m ? m[1] : null;
}

/** Columns that PostgREST recently rejected, so warm lambdas stop re-probing. col -> expiry (ms). */
const MISSING_TTL_MS = 60_000;
const missingCache = new Map();

export function columnList(excluded = new Set(), base = COLUMNS_BASE, optional = COLUMNS_OPTIONAL) {
  return [...base, ...optional.filter((c) => !excluded.has(c))];
}

/**
 * Run a read with the full column list; if PostgREST says an OPTIONAL column does not exist, drop
 * that column and retry. When the message does not name a droppable column, drop every optional
 * column once. Errors unrelated to columns, or about a base column, are rethrown.
 *
 * @param {object} o
 * @param {(select: string) => string} o.buildQuery  query string for a given select list
 * @param {(table: string, query: string) => Promise<any>} o.get   e.g. restGet
 * @returns {Promise<{rows: any, dropped: string[]}>}
 */
export async function selectWithColumnFallback({
  table = 'parcel_risk',
  buildQuery,
  get,
  base = COLUMNS_BASE,
  optional = COLUMNS_OPTIONAL,
  cache = missingCache,
  now = Date.now,
}) {
  const dropped = new Set();
  for (const [c, exp] of cache) {
    if (exp > now()) {
      if (optional.includes(c)) dropped.add(c);
    } else cache.delete(c);
  }
  for (let attempt = 0; attempt <= optional.length + 1; attempt++) {
    const select = columnList(dropped, base, optional).join(',');
    try {
      const rows = await get(table, buildQuery(select));
      return { rows, dropped: [...dropped] };
    } catch (err) {
      if (!isMissingColumnError(err)) throw err;
      const col = parseMissingColumn(err);
      const drop = col && optional.includes(col) && !dropped.has(col) ? [col] : optional.filter((c) => !dropped.has(c));
      if (!drop.length) throw err;
      for (const c of drop) {
        dropped.add(c);
        cache.set(c, now() + MISSING_TTL_MS);
      }
    }
  }
  throw new Error('selectWithColumnFallback: too many retries');
}

/* ------------------------------------------------------------------------------------------
 * NFIP claim layers (fsi/sql/016). Neighbourhood aggregates only — never a personal claim flag.
 * ------------------------------------------------------------------------------------------ */

const BG_LAYER_COLS = [
  'block_group', 'tract', 'vintage', 'housing_units',
  'claim_count_all', 'claim_count_10y', 'claim_count_5y', 'claim_last_year', 'paid_total_10y', 'median_water_depth',
  'claim_sfha_all', 'claim_zone_x_all', 'claim_other_all', 'claim_sfha_10y', 'claim_zone_x_10y', 'claim_other_10y',
  'claim_rate_10y', 'claim_rate_zone_x_10y', 'heat', 'top_event', 'top_event_claims',
  'centroid_lat', 'centroid_lon', 'bbox_w', 'bbox_s', 'bbox_e', 'bbox_n',
];
const EVENT_COLS = 'block_group,event_key,event_name,event_year,claim_count,paid_total,sfha_count,zone_x_count,other_count';
const CLAIMS_LAYER_DEFAULT_LIMIT = 400;
const CLAIMS_LAYER_MAX_LIMIT = 1000; // Supabase PostgREST default max-rows

const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const intOr0 = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

/** Query string for block groups whose bbox overlaps the viewport box. */
export function buildClaimsLayerQuery(box, { includeGeom = false, limit = CLAIMS_LAYER_DEFAULT_LIMIT } = {}) {
  const cols = includeGeom ? [...BG_LAYER_COLS, 'geom_geojson'] : BG_LAYER_COLS;
  return [
    `select=${cols.join(',')}`,
    `bbox_e=gte.${box.w}`,
    `bbox_w=lte.${box.e}`,
    `bbox_n=gte.${box.s}`,
    `bbox_s=lte.${box.n}`,
    'order=heat.desc.nullslast,claim_count_10y.desc',
    `limit=${limit}`,
  ].join('&');
}

/**
 * DB rows -> API rows. With an event filter (eventRows given) only block groups that have claims for
 * that event are returned, and each row gets `event: {key, year, count, sfha, zone_x, other, paid}`.
 */
export function shapeClaimsLayerRows(bgRows, { eventRows = null, includeGeom = false } = {}) {
  let byBg = null;
  if (eventRows) {
    byBg = new Map();
    for (const e of eventRows) {
      const cur = byBg.get(e.block_group) || { key: e.event_key, year: e.event_year, count: 0, sfha: 0, zone_x: 0, other: 0, paid: 0 };
      cur.count += intOr0(e.claim_count);
      cur.sfha += intOr0(e.sfha_count);
      cur.zone_x += intOr0(e.zone_x_count);
      cur.other += intOr0(e.other_count);
      cur.paid += Number(e.paid_total) || 0;
      cur.year = Math.max(cur.year || 0, intOr0(e.event_year));
      byBg.set(e.block_group, cur);
    }
  }
  const out = [];
  for (const r of bgRows || []) {
    let event;
    if (byBg) {
      event = byBg.get(r.block_group);
      if (!event || event.count <= 0) continue;
      event = { ...event, paid: Math.round(event.paid * 100) / 100 };
    }
    const row = {
      fips: r.block_group,
      tract: r.tract ?? null,
      lon: numOrNull(r.centroid_lon),
      lat: numOrNull(r.centroid_lat),
      bbox: [numOrNull(r.bbox_w), numOrNull(r.bbox_s), numOrNull(r.bbox_e), numOrNull(r.bbox_n)],
      vintage: numOrNull(r.vintage),
      housing_units: numOrNull(r.housing_units),
      count_all: intOr0(r.claim_count_all),
      count_10y: intOr0(r.claim_count_10y),
      count_5y: intOr0(r.claim_count_5y),
      last_year: numOrNull(r.claim_last_year),
      paid_10y: numOrNull(r.paid_total_10y),
      median_depth_in: numOrNull(r.median_water_depth),
      sfha_all: intOr0(r.claim_sfha_all),
      zone_x_all: intOr0(r.claim_zone_x_all),
      other_all: intOr0(r.claim_other_all),
      sfha_10y: intOr0(r.claim_sfha_10y),
      zone_x_10y: intOr0(r.claim_zone_x_10y),
      other_10y: intOr0(r.claim_other_10y),
      rate_10y: numOrNull(r.claim_rate_10y),
      rate_zone_x_10y: numOrNull(r.claim_rate_zone_x_10y),
      heat: numOrNull(r.heat) ?? 0,
      top_event: r.top_event ?? null,
      top_event_claims: numOrNull(r.top_event_claims),
    };
    if (includeGeom) row.geom = r.geom_geojson ?? null;
    if (event) row.event = event;
    out.push(row);
  }
  return out;
}

/** event_list RPC rows -> chips. */
export function shapeClaimsEvents(rows, { namedOnly = true } = {}) {
  const out = [];
  for (const r of rows || []) {
    const name = r.event_name || null;
    const designation = r.event_designation || null;
    const named = Boolean(name || designation);
    if (namedOnly && !named) continue;
    const year = intOr0(r.event_year);
    out.push({
      key: r.event_key,
      name,
      designation,
      year,
      label: `${name || designation || `Unnamed ${year}`} (${year})`,
      total_claims: intOr0(r.total_claims),
      zone_x_claims: intOr0(r.zone_x_claims),
      sfha_claims: intOr0(r.sfha_claims),
      paid_total: numOrNull(r.paid_total),
      block_groups: intOr0(r.block_groups),
      named,
    });
  }
  return out;
}

function isMissingRelationError(err, name) {
  const msg = String(err?.message || '') + JSON.stringify(err?.body || {});
  const code = err?.body?.code || '';
  if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883') return true;
  return err?.status === 404 && new RegExp(`${name}|schema cache|Could not find`, 'i').test(msg);
}

const UNAVAILABLE_NOTE =
  'Block-group claims are not available yet: apply fsi/sql/016_claims_block_group.sql and run scripts/ingest-nfip-claims.mjs.';

async function claimsLayer(body, res) {
  const box = validateBbox(body.bbox);
  if (!box) return json(res, 400, { error: 'bbox must be [w,s,e,n] and span at most 1 degree' });
  const includeGeom = body.includeGeom === true;
  const rawLimit = Number.parseInt(body.limit, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, CLAIMS_LAYER_MAX_LIMIT) : CLAIMS_LAYER_DEFAULT_LIMIT;
  const eventKey = body.event != null && body.event !== '' ? String(body.event).slice(0, 120) : '';
  const eventYear = Number.parseInt(body.eventYear, 10);

  try {
    const evQuery = eventKey
      ? `select=${EVENT_COLS}&event_key=eq.${encodeURIComponent(eventKey)}` +
        (Number.isFinite(eventYear) ? `&event_year=eq.${eventYear}` : '') +
        '&limit=1000'
      : null;
    const [bg, ev] = await Promise.all([
      restGet('nfip_claim_block_group', buildClaimsLayerQuery(box, { includeGeom, limit })),
      evQuery ? restGet('nfip_claim_event', evQuery) : Promise.resolve(null),
    ]);
    const bgRows = Array.isArray(bg) ? bg : [];
    const rows = shapeClaimsLayerRows(bgRows, { eventRows: Array.isArray(ev) ? ev : null, includeGeom });
    return json(res, 200, {
      ok: true,
      source: 'postgres',
      available: true,
      event: eventKey ? { key: eventKey, year: Number.isFinite(eventYear) ? eventYear : null } : null,
      count: rows.length,
      truncated: bgRows.length >= limit,
      rows,
      note: 'Claim figures are neighbourhood (census block group) aggregates from OpenFEMA, never a property-level claim.',
    });
  } catch (err) {
    if (isMissingRelationError(err, 'nfip_claim')) {
      return json(res, 200, { ok: true, source: 'none', available: false, count: 0, truncated: false, rows: [], note: UNAVAILABLE_NOTE });
    }
    return json(res, 500, { error: 'claims layer read failed', detail: String(err?.message || err).slice(0, 300) });
  }
}

async function claimsEvents(body, res) {
  const minClaims = Number.isFinite(Number(body.minClaims)) ? Math.max(0, Math.trunc(Number(body.minClaims))) : 25;
  const namedOnly = body.namedOnly !== false;
  try {
    const rows = await rest('/rest/v1/rpc/nfip_claim_event_list', {
      method: 'POST',
      body: JSON.stringify({ p_min_claims: minClaims }),
    });
    const events = shapeClaimsEvents(Array.isArray(rows) ? rows : [], { namedOnly });
    return json(res, 200, { ok: true, source: 'postgres', available: true, count: events.length, events });
  } catch (err) {
    if (isMissingRelationError(err, 'nfip_claim_event_list')) {
      return json(res, 200, { ok: true, source: 'none', available: false, count: 0, events: [], note: UNAVAILABLE_NOTE });
    }
    return json(res, 500, { error: 'claims events read failed', detail: String(err?.message || err).slice(0, 300) });
  }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const rl = rateLimit(`fsi:${clientIp(req)}`, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return json(res, 429, { error: 'Too many requests' });
  }

  const session = verifySessionToken(bearer(req));
  if (!session) return json(res, 401, { error: 'Unauthorized' });

  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON body' });

  const action = String(body.action || 'viewport');
  const minFsi = Number.isFinite(Number(body.minFsi)) ? Number(body.minFsi) : 0;
  const minMust = Number.isFinite(Number(body.minMust)) ? Number(body.minMust) : 0;
  const mustBand = body.mustBand ? String(body.mustBand).toLowerCase() : '';
  const sort = String(body.sort || 'fsi').toLowerCase(); // fsi | must | heat
  // Default smaller page for Must dial so reps see top N, not thousands
  const rawLimit = body.limit;
  const limit =
    rawLimit != null && rawLimit !== ''
      ? clampLimit(rawLimit)
      : mustBand === 'must' || sort === 'must'
        ? DEFAULT_MUST_LIMIT
        : DEFAULT_LIMIT;

  if (action === 'claims_layer') return claimsLayer(body, res);
  if (action === 'claims_events') return claimsEvents(body, res);

  let box = null;
  if (action === 'viewport') {
    box = validateBbox(body.bbox);
    if (!box) return json(res, 400, { error: 'bbox must be [w,s,e,n] and span at most 1 degree' });
  } else if (action === 'storm') {
    // Post-storm dial list: cells with >= minRainMm on the last completed day,
    // parcels at or above minBand, wettest cells first then score.
    const minRainMm = Number.isFinite(Number(body.minRainMm)) ? Math.max(0, Number(body.minRainMm)) : 25;
    const minBand = ['must', 'should', 'maybe'].includes(String(body.minBand || '').toLowerCase())
      ? String(body.minBand).toLowerCase()
      : 'should';
    try {
      const [cells, parcels] = await Promise.all([
        rest('/rest/v1/rpc/storm_cells', { method: 'POST', body: JSON.stringify({ min_rain_mm: minRainMm }) }),
        rest('/rest/v1/rpc/storm_dial_list', {
          method: 'POST',
          body: JSON.stringify({ min_rain_mm: minRainMm, min_band: minBand, max_rows: limit }),
        }),
      ]);
      const list = Array.isArray(parcels) ? parcels : [];
      return json(res, 200, {
        ok: true,
        source: 'postgres',
        minRainMm,
        minBand,
        cells: Array.isArray(cells) ? cells : [],
        count: list.length,
        truncated: list.length >= limit,
        parcels: list,
      });
    } catch (err) {
      const status = err?.status === 404 ? 503 : 500;
      return json(res, status, {
        error: 'storm list failed',
        detail: String(err?.message || err).slice(0, 300),
        hint: status === 503 ? 'Apply fsi/sql/009 and 010.' : undefined,
      });
    }
  } else if (action !== 'top') {
    return json(res, 400, { error: `Unknown action: ${action}` });
  }

  // Real appraiser rows may have null fsi_live until static/claim scoring runs.
  // minFsi=0 must not hide those (PostgREST gte excludes NULL).
  let order =
    'fsi_live.desc.nullslast,must_have_score.desc.nullslast,just_value.desc.nullslast';
  if (sort === 'must') {
    order = 'must_have_score.desc.nullslast,fsi_live.desc.nullslast,claim_heat.desc.nullslast';
  } else if (sort === 'heat') {
    order = 'claim_heat.desc.nullslast,must_have_score.desc.nullslast,fsi_live.desc.nullslast';
  }

  const params = [`order=${order}`, `limit=${limit}`];
  if (minFsi > 0) {
    params.push(`fsi_live=gte.${minFsi}`);
  }
  if (minMust > 0) {
    params.push(`must_have_score=gte.${minMust}`);
  }
  if (mustBand && ['must', 'should', 'maybe', 'skip'].includes(mustBand)) {
    params.push(`must_have_band=eq.${mustBand}`);
  }
  if (box) {
    params.push(
      `lon=gte.${box.w}`,
      `lon=lte.${box.e}`,
      `lat=gte.${box.s}`,
      `lat=lte.${box.n}`,
    );
  }

  try {
    const { rows } = await selectWithColumnFallback({
      buildQuery: (select) => [`select=${select}`, ...params].join('&'),
      get: restGet,
    });
    const list = Array.isArray(rows) ? rows : [];
    return json(res, 200, {
      ok: true,
      source: 'postgres',
      count: list.length,
      truncated: list.length >= limit,
      parcels: list,
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      const list = queryFixtures({ action, minFsi, minMust, mustBand, sort, limit, box }).map(projectRow);
      return json(res, 200, {
        ok: true,
        source: 'fixtures',
        count: list.length,
        truncated: list.length >= limit,
        parcels: list,
        note:
          'Using bundled FIXTURE parcels — public.parcel_risk is not migrated. Run fsi/sql/001_parcel_risk.sql + 002_seed_fixtures.sql when DATABASE_URL is available.',
      });
    }
    const status = err?.status === 404 ? 503 : 500;
    const detail = String(err?.message || err).slice(0, 300);
    return json(res, status, {
      error: 'parcel_risk read failed',
      detail,
      hint:
        status === 503
          ? 'Run fsi/sql/001_parcel_risk.sql, then 002_seed_fixtures.sql or the ingest pipeline.'
          : undefined,
    });
  }
}
