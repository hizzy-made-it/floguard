/**
 * Shared FloGuard Sales Rev leads store (<bucket>/leads.json).
 * POST body: { action: 'list'|'push'|'bulk_upsert'|'replace', leads? }
 * Auth (either):
 *   - Authorization: Bearer <academy session token>   (browser reps)
 *   - X-Academy-Sync-Secret: <ACADEMY_SYNC_SECRET>    (LeadAgent CLI)
 * `replace` requires the sync secret (full overwrite — CLI ops only).
 * Merge rule: match by lowercased name+city; union `lists`; incoming
 * non-empty fields win, empty fields never clear existing values.
 */
import { timingSafeEqual } from 'crypto';
import { loadLeadsStore, saveLeadsStore, verifySessionToken } from '../server/lib/academy-db.js';
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';

export const config = { maxDuration: 30 };

const MAX_LEADS = 20000;

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

function leadKey(l) {
  return `${String(l?.name || '').trim().toLowerCase()}|${String(l?.city || '').trim().toLowerCase()}`;
}

/** Category-grid shells and List-A synthetic rows — not dialable businesses. */
function isPlaceholderLead(l) {
  const name = String(l?.name || '').trim();
  if (!name) return true;
  if (/^\(business name\)$/i.test(name)) return true;
  // e.g. "Lawn care / landscaping prospect — Daytona Beach"
  if (/\bprospect\s*[—–-]\s*/i.test(name)) return true;
  const notes = String(l?.notes || '');
  if (/no-website service prospect/i.test(notes) && !name) return true;
  if (
    /Category seed:/i.test(notes) &&
    /\bprospect\b/i.test(name) &&
    !String(l?.phone || '').trim() &&
    !String(l?.website || '').trim()
  ) {
    return true;
  }
  return false;
}

function leadListsOf(l) {
  if (Array.isArray(l?.lists) && l.lists.length) {
    return l.lists.filter((x) => typeof x === 'string' && x);
  }
  return l?.list ? [String(l.list)] : [];
}

function mergeLead(base, inc) {
  const merged = { ...base };
  // Explicit lists array from client is authoritative (checkboxes / uncheck must stick).
  // Without lists, union by primary list label only (partial LeadAgent rows).
  if (Array.isArray(inc?.lists)) {
    const next = leadListsOf(inc);
    if (next.length) {
      merged.lists = next;
      if (inc.list && next.includes(String(inc.list))) merged.list = String(inc.list);
      else merged.list = next[0];
    }
  } else {
    const lists = leadListsOf(base).slice();
    for (const x of leadListsOf(inc)) {
      if (!lists.includes(x)) lists.push(x);
    }
    if (lists.length) merged.lists = lists;
  }
  for (const [k, v] of Object.entries(inc)) {
    if (k === 'lists' || k === 'id' || k === 'name' || k === 'city' || k === 'list_status') continue;
    if (v == null || v === '') continue; // empty never clears existing
    merged[k] = v; // incoming non-empty wins (last write)
  }
  // Per-cause pipeline map (each service line status independent)
  if (inc?.list_status && typeof inc.list_status === 'object' && !Array.isArray(inc.list_status)) {
    const keys = Object.keys(inc.list_status);
    if (keys.length) {
      merged.list_status = { ...(base.list_status || {}), ...inc.list_status };
      // Drop statuses for causes no longer on the lead when lists were replaced
      if (Array.isArray(merged.lists)) {
        const keep = new Set(merged.lists);
        for (const k of Object.keys(merged.list_status)) {
          if (!keep.has(k)) delete merged.list_status[k];
        }
      }
    }
  }
  if (inc?.lists_touched) merged.lists_touched = true;
  return merged;
}

function mergeIntoStore(store, incoming) {
  const leads = Array.isArray(store.leads) ? store.leads.slice() : [];
  const index = new Map(leads.map((l, i) => [leadKey(l), i]));
  let nextId = leads.reduce((m, l) => Math.max(m, Number(l?.id) || 0), 0) + 1;
  let added = 0;
  let merged = 0;
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object' || !String(raw.name || '').trim()) continue;
    const key = leadKey(raw);
    if (index.has(key)) {
      const i = index.get(key);
      leads[i] = mergeLead(leads[i], raw);
      merged += 1;
    } else {
      const copy = { ...raw };
      copy.id = nextId;
      nextId += 1;
      index.set(key, leads.length);
      leads.push(copy);
      added += 1;
    }
  }
  return { leads, added, merged };
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

  const ip = clientIp(req);
  const rl = rateLimit(`leads-api:${ip}`, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec || 60));
    return json(res, 429, { error: 'Too many requests.' });
  }

  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON body' });

  const viaSecret = syncSecretOk(req);
  const session = viaSecret ? null : verifySessionToken(bearer(req));
  if (!viaSecret && !session) {
    return json(res, 401, { error: 'Sign in (or provide a valid sync secret) to use the leads store.' });
  }

  const action = String(body.action || '').toLowerCase();

  try {
    if (action === 'list') {
      const store = await loadLeadsStore();
      return json(res, 200, {
        leads: store.leads,
        count: store.leads.length,
        updated_at: store.updated_at || null,
      });
    }

    if (action === 'push' || action === 'bulk_upsert') {
      const incoming = body.leads;
      if (!Array.isArray(incoming)) {
        return json(res, 400, { error: 'leads must be an array.' });
      }
      if (incoming.length > MAX_LEADS) {
        return json(res, 400, { error: `Too many leads (max ${MAX_LEADS}).` });
      }
      const store = await loadLeadsStore();
      const { leads, added, merged } = mergeIntoStore(store, incoming);
      if (leads.length > MAX_LEADS) {
        return json(res, 400, { error: `Store would exceed ${MAX_LEADS} leads.` });
      }
      const updated_at = await saveLeadsStore({ leads });
      return json(res, 200, { ok: true, count: leads.length, added, merged, updated_at });
    }

    if (action === 'replace') {
      if (!viaSecret) {
        return json(res, 403, { error: 'replace requires the sync secret.' });
      }
      const incoming = body.leads;
      if (!Array.isArray(incoming) || incoming.length > MAX_LEADS) {
        return json(res, 400, { error: 'leads must be an array within the size limit.' });
      }
      const updated_at = await saveLeadsStore({ leads: incoming });
      return json(res, 200, { ok: true, count: incoming.length, updated_at });
    }

    if (action === 'prune_placeholders') {
      const store = await loadLeadsStore();
      const before = Array.isArray(store.leads) ? store.leads : [];
      const kept = before.filter((l) => !isPlaceholderLead(l));
      const removed = before.length - kept.length;
      if (removed > 0) {
        const updated_at = await saveLeadsStore({ leads: kept });
        return json(res, 200, {
          ok: true,
          removed,
          remaining: kept.length,
          leads: kept,
          updated_at,
        });
      }
      return json(res, 200, {
        ok: true,
        removed: 0,
        remaining: kept.length,
        leads: kept,
        updated_at: store.updated_at || null,
      });
    }

    return json(res, 400, {
      error: 'Unknown action. Use list, push, bulk_upsert, replace, or prune_placeholders.',
    });
  } catch (e) {
    return json(res, 500, { error: 'Leads store error', detail: String(e?.message || e).slice(0, 300) });
  }
}
