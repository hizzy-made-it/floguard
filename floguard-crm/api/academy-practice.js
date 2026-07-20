/**
 * FloGuard Sales Rev practice events (roleplay/pitch scores) → <bucket>/practice.json
 * POST { action: 'list'|'append', event? }
 * Auth: Bearer session
 */
import { loadPracticeStore, savePracticeStore, verifySessionToken } from '../server/lib/academy-db.js';
import { setCors, json, parseBody } from '../server/lib/http.js';

export const config = { maxDuration: 30 };

const MAX_EVENTS = 20000;

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const session = verifySessionToken(bearer(req));
  if (!session) return json(res, 401, { error: 'Sign in required' });

  const action = String(body.action || '').toLowerCase();
  try {
    if (action === 'list') {
      const store = await loadPracticeStore();
      return json(res, 200, { events: store.events || [], count: (store.events || []).length });
    }
    if (action === 'append') {
      const raw = body.event || {};
      const store = await loadPracticeStore();
      const events = Array.isArray(store.events) ? store.events.slice() : [];
      const entry = {
        id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        user: session.u,
        type: String(raw.type || 'roleplay'), // roleplay | review | coach
        score: raw.score != null ? Number(raw.score) : null,
        at: new Date().toISOString(),
        note: String(raw.note || '').slice(0, 500),
      };
      events.push(entry);
      while (events.length > MAX_EVENTS) events.shift();
      await savePracticeStore({ events });
      return json(res, 200, { ok: true, event: entry });
    }
    return json(res, 400, { error: 'Unknown action' });
  } catch (e) {
    return json(res, 500, { error: String(e?.message || e).slice(0, 300) });
  }
}
