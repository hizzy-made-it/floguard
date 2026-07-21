/**
 * Flood Susceptibility Index — parcel reads for the CRM map panel.
 * Spec: docs/FLOOD-SUSCEPTIBILITY-INDEX.md
 *
 * POST body: { action: 'viewport'|'top', bbox?: [w,s,e,n], minFsi?, limit? }
 * Auth: Authorization: Bearer <academy session token>
 *
 * Prefer public.parcel_risk via PostgREST. When the table is missing (migrations
 * not applied), fall back to bundled FIXTURE-* parcels so the map panel stays
 * usable. Real county data still requires fsi/sql/001 + ingest.
 */
import { verifySessionToken } from '../server/lib/academy-db.js';
import { restGet } from '../server/lib/supabase-rest.js';
import { queryFixtures } from '../server/lib/fsi-fixtures.js';
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';

export const config = { maxDuration: 30 };

const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 500;
/** Must dial default page size — tight weekly list, not entire must band. */
const DEFAULT_MUST_LIMIT = 200;

// Never ship owner_name to the browser without a session; never ship phone at all.
// twi_n / hand_n enable client score-breakdown UI when real terrain factors exist.
// claim_* is tract/grid neighborhood aggregate only — never a personal claim flag.
const COLUMNS =
  'parcel_id,address,owner_name,lat,lon,fsi_live,fsi_static,fema_zone,hsg,twi_n,hand_n,' +
  'claim_heat,claim_count_10y,claim_last_year,must_have_score,must_have_band,must_have_reasons,' +
  'year_built,living_area,just_value,city,zip,homestead,dor_use,use_desc';

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

/** If PostgREST rejects unknown optional columns (pre-migration), strip and retry once. */
function isMissingColumnError(err) {
  const msg = String(err?.message || '') + JSON.stringify(err?.body || {});
  return /column|PGRST204|Could not find/i.test(msg);
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

  let box = null;
  if (action === 'viewport') {
    box = validateBbox(body.bbox);
    if (!box) return json(res, 400, { error: 'bbox must be [w,s,e,n] and span at most 1 degree' });
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

  const params = [`select=${COLUMNS}`, `order=${order}`, `limit=${limit}`];
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
    const rows = await restGet('parcel_risk', params.join('&'));
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
