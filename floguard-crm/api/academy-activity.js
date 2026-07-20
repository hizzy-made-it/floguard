/**
 * FloGuard Sales Rev activity log (<bucket>/activities.json).
 * POST body: { action: 'list'|'append'|'list_for_lead', activity?, lead_key?, limit? }
 * Auth: Authorization Bearer session OR X-Academy-Sync-Secret
 */
import { timingSafeEqual } from 'crypto';
import {
  appendActivityEntry,
  loadActivitiesStore,
  verifySessionToken,
} from '../server/lib/academy-db.js';
import { setCors, json, parseBody } from '../server/lib/http.js';

export const config = { maxDuration: 30 };

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function syncSecretOk(req) {
  const configured = process.env.ACADEMY_SYNC_SECRET || '';
  if (!configured) return false;
  const got = String(req.headers?.['x-academy-sync-secret'] || '');
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function newId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON body' });

  const viaSecret = syncSecretOk(req);
  const session = viaSecret ? null : verifySessionToken(bearer(req));
  if (!viaSecret && !session) {
    return json(res, 401, { error: 'Sign in required for activity log.' });
  }

  const action = String(body.action || '').toLowerCase();

  try {
    if (action === 'list') {
      const store = await loadActivitiesStore();
      const limit = Math.min(Number(body.limit) || 500, 2000);
      const acts = (store.activities || []).slice(-limit).reverse();
      return json(res, 200, { activities: acts, count: store.activities?.length || 0 });
    }

    if (action === 'list_for_lead') {
      const key = String(body.lead_key || '').toLowerCase();
      if (!key) return json(res, 400, { error: 'lead_key required' });
      const store = await loadActivitiesStore();
      const acts = (store.activities || [])
        .filter((a) => String(a.lead_key || '').toLowerCase() === key)
        .slice(-200)
        .reverse();
      return json(res, 200, { activities: acts, count: acts.length });
    }

    if (action === 'append') {
      const raw = body.activity;
      if (!raw || typeof raw !== 'object') {
        return json(res, 400, { error: 'activity object required' });
      }
      const entry = {
        id: raw.id || newId(),
        lead_id: raw.lead_id ?? null,
        lead_key: String(raw.lead_key || ''),
        user: raw.user || session?.u || 'unknown',
        type: String(raw.type || 'note'),
        at: raw.at || new Date().toISOString(),
        outcome: raw.outcome || '',
        detail: raw.detail && typeof raw.detail === 'object' ? raw.detail : {},
        next_follow_up_at: raw.next_follow_up_at || null,
      };
      const saved = await appendActivityEntry(entry);
      return json(res, 200, {
        ok: true,
        activity: saved,
        updated_at: saved?.at || entry.at,
      });
    }

    return json(res, 400, { error: 'Unknown action. Use list, list_for_lead, or append.' });
  } catch (e) {
    return json(res, 500, { error: 'Activity store error', detail: String(e?.message || e).slice(0, 300) });
  }
}
