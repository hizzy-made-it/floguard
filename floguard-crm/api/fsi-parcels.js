/**
 * Flood Susceptibility Index — parcel reads for the CRM map panel.
 * Spec: docs/FLOOD-SUSCEPTIBILITY-INDEX.md
 *
 * POST body: { action: 'viewport'|'top', bbox?: [w,s,e,n], minFsi?, limit? }
 * Auth: Authorization: Bearer <academy session token>
 *
 * Request-time work is deliberately trivial: the terrain math ran offline in
 * fsi/pipeline/terrain.py and the daily cron already wrote fsi_live. This
 * handler only reads indexed rows. Do not add scoring logic here.
 *
 * Owner names are public record under FL law, but see spec §8 — this endpoint
 * ranks PROPERTIES. It does not authorize contacting anyone, and phone numbers
 * are deliberately absent from the projection.
 */
import { verifySessionToken } from '../server/lib/academy-db.js';
import { restGet } from '../server/lib/supabase-rest.js';
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';

export const config = { maxDuration: 30 };

const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 500;

// Never ship owner_name to the browser without a session; never ship phone at all.
const COLUMNS = 'parcel_id,address,owner_name,lat,lon,fsi_live,fsi_static,fema_zone,hsg';

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
  const limit = clampLimit(body.limit);
  const minFsi = Number.isFinite(Number(body.minFsi)) ? Number(body.minFsi) : 0;

  const params = [
    `select=${COLUMNS}`,
    `fsi_live=gte.${minFsi}`,
    'order=fsi_live.desc',
    `limit=${limit}`,
  ];

  if (action === 'viewport') {
    const box = validateBbox(body.bbox);
    if (!box) return json(res, 400, { error: 'bbox must be [w,s,e,n] and span at most 1 degree' });
    params.push(
      `lon=gte.${box.w}`,
      `lon=lte.${box.e}`,
      `lat=gte.${box.s}`,
      `lat=lte.${box.n}`,
    );
  } else if (action !== 'top') {
    return json(res, 400, { error: `Unknown action: ${action}` });
  }

  try {
    const rows = await restGet('parcel_risk', params.join('&'));
    const list = Array.isArray(rows) ? rows : [];
    return json(res, 200, {
      ok: true,
      count: list.length,
      truncated: list.length >= limit,
      parcels: list,
    });
  } catch (err) {
    // Surface the real cause. A silent empty array here reads as "no risky
    // parcels in view", which is the opposite of a missing table or bad DSN.
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
