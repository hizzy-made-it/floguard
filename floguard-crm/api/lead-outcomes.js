/**
 * Lead outcomes — the calibration label stream (fsi/sql/007, item 7).
 * One row per lead once the result is known. The DB trigger snapshots the
 * parcel's model inputs at insert time; later rescoring never rewrites it.
 *
 * POST body: { action: 'record'|'list'|'readiness', ...fields }
 *   record:    { lead_key, outcome: 'won'|'lost'|'no_show', parcel_id?, lead_id?,
 *                address?, city?, zip?, amount?, package?, lost_reason?,
 *                water_confirmed?: boolean, water_where?: string[], water_depth_in?,
 *                water_last_seen?: 'YYYY-MM-DD', assessed_at?: 'YYYY-MM-DD', notes? }
 *              Upserts on lead_key. `rep` is taken from the session, not the body.
 *   list:      { limit? }  newest first
 *   readiness: {}          counts + whether there is enough to fit weights
 *   field_report:      { parcel_id, report: 'water_confirmed'|'not_a_problem'|null, lead_id?, note? }
 *              Map "Report wrong" buttons (fsi/sql/021). One live report per (parcel, rep); a new
 *              value overwrites, report null withdraws. Calibration labels, NOT sales outcomes.
 *   field_report_list: { parcel_id? | parcel_ids?: [..<=200], mine?: bool }  live reports
 *   Contract: docs/handoff/R1.md.
 * Auth: Authorization: Bearer <academy session token>
 */
import { verifySessionToken } from '../server/lib/academy-db.js';
import { rest, restGet } from '../server/lib/supabase-rest.js';
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';

export const config = { maxDuration: 30 };

const OUTCOMES = new Set(['won', 'lost', 'no_show']);
const WATER_WHERE = new Set([
  'yard', 'crawlspace', 'slab_edge', 'driveway', 'patio', 'garage', 'pool_deck', 'street_side', 'other',
]);
const MAX_LIST = 500;
const FIELD_REPORTS = new Map([
  ['water_confirmed', 'water_confirmed'], ['water', 'water_confirmed'],
  ['not_a_problem', 'not_a_problem'], ['no_problem', 'not_a_problem'],
]);
// Parcel ids are used inside PostgREST filters: allow only the characters real ids use.
const PARCEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/ ]{0,39}$/;
const FR_COLS = 'id,parcel_id,lead_id,report,note,rep,reported_at,updated_at,withdrawn_at';
const FR_NOT_READY = { error: 'field_reports_not_ready', hint: 'Apply fsi/sql/021_field_reports.sql.' };

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function str(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDate(v) {
  const s = str(v, 10);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function buildRow(body, rep) {
  const lead_key = str(body.lead_key, 200);
  if (!lead_key) return { error: 'lead_key is required' };
  const outcome = String(body.outcome || '').toLowerCase();
  if (!OUTCOMES.has(outcome)) return { error: "outcome must be 'won', 'lost' or 'no_show'" };

  let water_confirmed = null;
  if (body.water_confirmed === true || body.water_confirmed === 'true') water_confirmed = true;
  if (body.water_confirmed === false || body.water_confirmed === 'false') water_confirmed = false;

  const water_where = Array.isArray(body.water_where)
    ? [...new Set(body.water_where.map((w) => String(w).toLowerCase()).filter((w) => WATER_WHERE.has(w)))]
    : [];

  const row = {
    lead_key,
    lead_id: str(body.lead_id, 100),
    parcel_id: str(body.parcel_id, 40),
    address: str(body.address, 300),
    city: str(body.city, 100),
    zip: str(body.zip, 10),
    outcome,
    amount: num(body.amount),
    package: str(body.package, 100),
    lost_reason: str(body.lost_reason, 300),
    water_confirmed,
    water_where,
    water_depth_in: num(body.water_depth_in),
    water_last_seen: isoDate(body.water_last_seen),
    assessed_at: isoDate(body.assessed_at),
    rep: rep || null,
    notes: str(body.notes, 2000),
    source: 'crm',
  };
  return { row };
}

function parcelIdOrNull(v) {
  const s = v == null ? '' : String(v).trim();
  return PARCEL_ID_RE.test(s) ? s : null;
}

function isMissingTable(err) {
  const code = err?.body?.code || '';
  return code === 'PGRST205' || code === '42P01' || (err?.status === 404 && /parcel_field_report|schema cache|Could not find/i.test(String(err?.message || '') + JSON.stringify(err?.body || {})));
}

/** field_report: upsert (or withdraw) this rep's report for one parcel. */
async function fieldReport(body, rep, res) {
  const parcel_id = parcelIdOrNull(body.parcel_id);
  if (!parcel_id) return json(res, 400, { error: 'parcel_id is required (letters, digits, . _ - / and spaces, max 40)' });
  const raw = body.report === undefined ? body.v : body.report;
  const withdraw = raw === null || raw === '' || String(raw).toLowerCase() === 'clear';
  const report = withdraw ? null : FIELD_REPORTS.get(String(raw).toLowerCase()) || null;
  if (!withdraw && !report) return json(res, 400, { error: "report must be 'water_confirmed', 'not_a_problem' or null" });
  const who = `parcel_id=eq.${encodeURIComponent(parcel_id)}&rep=eq.${encodeURIComponent(rep)}`;
  if (withdraw) {
    const out = await rest(`/rest/v1/parcel_field_reports?${who}&withdrawn_at=is.null&select=${FR_COLS}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: JSON.stringify({ withdrawn_at: new Date().toISOString() }),
    });
    const row = Array.isArray(out) ? out[0] || null : out || null;
    return json(res, 200, { ok: true, withdrawn: Boolean(row), report: row });
  }
  const saved = await rest(`/rest/v1/parcel_field_reports?on_conflict=parcel_id,rep&select=${FR_COLS}`, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: JSON.stringify([{
      parcel_id,
      rep,
      report,
      // only overwrite lead_id / note when the client sends them
      ...(body.lead_id !== undefined ? { lead_id: str(body.lead_id, 100) } : {}),
      ...(body.note !== undefined ? { note: str(body.note, 1000) } : {}),
      source: 'crm_map',
      withdrawn_at: null,
    }]),
  });
  return json(res, 200, { ok: true, withdrawn: false, report: Array.isArray(saved) ? saved[0] : saved });
}

/** field_report_list: live reports for one parcel, a list of parcels, or this rep's. */
async function fieldReportList(body, rep, res) {
  const q = [`select=${FR_COLS}`, 'withdrawn_at=is.null', 'order=updated_at.desc'];
  if (body.parcel_id != null) {
    const id = parcelIdOrNull(body.parcel_id);
    if (!id) return json(res, 400, { error: 'invalid parcel_id' });
    q.push(`parcel_id=eq.${encodeURIComponent(id)}`);
  } else if (Array.isArray(body.parcel_ids)) {
    if (body.parcel_ids.length > 200) return json(res, 400, { error: 'at most 200 parcel_ids' });
    const ids = body.parcel_ids.map(parcelIdOrNull);
    if (!ids.length || ids.some((x) => !x)) return json(res, 400, { error: 'invalid parcel_ids' });
    q.push(`parcel_id=in.(${ids.map((x) => encodeURIComponent(`"${x}"`)).join(',')})`);
  } else if (body.mine !== true) {
    return json(res, 400, { error: 'send parcel_id, parcel_ids or mine:true' });
  }
  if (body.mine === true) q.push(`rep=eq.${encodeURIComponent(rep)}`);
  q.push(`limit=${MAX_LIST}`);
  const rows = (await restGet('parcel_field_reports', q.join('&'))) || [];
  return json(res, 200, { ok: true, count: rows.length, reports: rows });
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const rl = rateLimit(`outcomes:${clientIp(req)}`, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return json(res, 429, { error: 'Too many requests' });
  }

  const session = verifySessionToken(bearer(req));
  if (!session) return json(res, 401, { error: 'Unauthorized' });

  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON body' });
  const action = String(body.action || '').toLowerCase();

  try {
    if (action === 'record') {
      const built = buildRow(body, session.u);
      if (built.error) return json(res, 400, { error: built.error });
      // Upsert on lead_key. The BEFORE INSERT trigger fills the *_at snapshot
      // columns only on first insert; a later correction keeps the original snapshot.
      const saved = await rest('/rest/v1/lead_outcomes?on_conflict=lead_key', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=representation',
        body: JSON.stringify([built.row]),
      });
      return json(res, 200, { ok: true, outcome: Array.isArray(saved) ? saved[0] : saved });
    }

    if (action === 'list') {
      const limit = Math.min(MAX_LIST, Math.max(1, Number(body.limit) || 100));
      const rows = await restGet('lead_outcomes', `select=*&order=created_at.desc&limit=${limit}`);
      return json(res, 200, { ok: true, count: rows.length, outcomes: rows });
    }

    if (action === 'readiness') {
      const r = await rest('/rest/v1/rpc/lead_outcomes_readiness', { method: 'POST', body: '{}' });
      const row = Array.isArray(r) ? r[0] : r;
      return json(res, 200, {
        ok: true,
        ...row,
        note:
          'ready_p_close: >=100 won/lost with a parcel and >=30 won. ready_p_water: >=100 water yes/no with >=30 each. Until then FSI weights stay literature defaults.',
      });
    }

    if (action === 'field_report' || action === 'field_report_list') {
      const rep = String(session.u || '').slice(0, 80) || 'rep';
      try {
        return action === 'field_report' ? await fieldReport(body, rep, res) : await fieldReportList(body, rep, res);
      } catch (err) {
        if (isMissingTable(err)) return json(res, 503, FR_NOT_READY);
        throw err;
      }
    }

    return json(res, 400, { error: "Unknown action. Use 'record', 'list', 'readiness', 'field_report' or 'field_report_list'." });
  } catch (err) {
    const status = err?.status === 404 ? 503 : 500;
    return json(res, status, {
      error: 'lead_outcomes failed',
      detail: String(err?.message || err).slice(0, 300),
      hint: status === 503 ? 'Apply fsi/sql/007_lead_outcomes_and_lot_features.sql.' : undefined,
    });
  }
}
