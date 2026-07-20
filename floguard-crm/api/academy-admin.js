/**
 * FloGuard Sales Rev admin API (single endpoint, action-based).
 * POST { action, ... } with Authorization: Bearer <session>
 *
 * Actions:
 *   summary
 *   users
 *   user_detail  { user_id }
 *   approve      { user_id, admin_pin }  // +50k tokens, unlock
 *   set_role     { user_id, role, admin_pin }  // admin|rep (optional)
 */
import {
  defaultTokenLimit,
  isAdminRole,
  loadActivitiesStore,
  loadAiUsageStore,
  loadLeadsStore,
  loadPracticeStore,
  loadUsers,
  normalizeUser,
  publicUser,
  saveUsers,
  verifySessionToken,
} from '../server/lib/academy-db.js';
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';
import { timingSafeEqual } from 'crypto';

export const config = { maxDuration: 30 };

const APPROVE_BONUS = 50000;

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function adminPinOk(pin) {
  const configured = String(process.env.ACADEMY_ADMIN_PIN || '').trim();
  if (!configured) return { ok: false, error: 'ACADEMY_ADMIN_PIN is not configured on the server.' };
  const got = String(pin || '').trim();
  if (!got) return { ok: false, error: 'Admin PIN required.' };
  const a = Buffer.from(got);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return { ok: false, error: 'Invalid admin PIN.' };
  try {
    if (!timingSafeEqual(a, b)) return { ok: false, error: 'Invalid admin PIN.' };
  } catch {
    return { ok: false, error: 'Invalid admin PIN.' };
  }
  return { ok: true };
}

async function requireAdmin(req) {
  const session = verifySessionToken(bearer(req));
  if (!session) return { error: 'Sign in required.', status: 401 };
  const store = await loadUsers();
  const user = (store.users || []).find((u) => String(u.id) === String(session.sub));
  if (!user) return { error: 'Account not found.', status: 401 };
  if (!isAdminRole(user.role)) {
    return { error: 'Admin role required. Contact an owner to promote your account.', status: 403 };
  }
  return { session, user: normalizeUser(user), store };
}

function dayKey(iso) {
  return String(iso || '').slice(0, 10);
}

function leadCountForUser(leads, username) {
  const u = String(username || '').toLowerCase();
  if (!u) return 0;
  return leads.filter((l) => String(l.owner || '').toLowerCase() === u).length;
}

function leadsByList(leads, username) {
  const u = String(username || '').toLowerCase();
  const out = {};
  for (const l of leads) {
    if (u && String(l.owner || '').toLowerCase() !== u) continue;
    const lists = Array.isArray(l.lists) && l.lists.length ? l.lists : l.list ? [l.list] : [];
    for (const x of lists) {
      out[x] = (out[x] || 0) + 1;
    }
  }
  return out;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const ip = clientIp(req);
  const rl = rateLimit(`admin:${ip}`, { limit: 40, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec || 60));
    return json(res, 429, { error: 'Too many admin requests.' });
  }

  let body = {};
  if (req.method === 'POST') {
    body = parseBody(req) || {};
  }
  // Allow path-style: /api/academy-admin?action=summary or /api/academy-admin/summary via rewrite
  const url = String(req.url || '');
  let action = String(body.action || '').toLowerCase();
  if (!action) {
    if (url.includes('/approve')) action = 'approve';
    else if (url.includes('/users/') && !url.endsWith('/users')) action = 'user_detail';
    else if (url.includes('/users')) action = 'users';
    else if (url.includes('/summary')) action = 'summary';
    else action = 'summary';
  }

  try {
    const gate = await requireAdmin(req);
    if (gate.error) return json(res, gate.status || 403, { error: gate.error });

    const store = await loadUsers();
    const users = (store.users || []).map((u) => normalizeUser(u));

    if (action === 'summary') {
      const leadsStore = await loadLeadsStore();
      const leads = Array.isArray(leadsStore.leads) ? leadsStore.leads : [];
      const usage = await loadAiUsageStore();
      const events = Array.isArray(usage.events) ? usage.events : [];
      const today = new Date().toISOString().slice(0, 10);
      const ai_calls_today = events.filter((e) => dayKey(e.ts) === today).length;
      const total_tokens = users.reduce((s, u) => s + (Number(u.tokens_used) || 0), 0);
      const locked_users = users.filter((u) => u.locked).length;
      const pending_approvals = users.filter((u) => u.unlock_requested).length;
      return json(res, 200, {
        users: users.length,
        total_tokens,
        locked_users,
        pending_approvals,
        ai_calls_today,
        leads: leads.length,
        admin: publicUser(gate.user),
      });
    }

    if (action === 'users') {
      const leadsStore = await loadLeadsStore();
      const leads = Array.isArray(leadsStore.leads) ? leadsStore.leads : [];
      const list = users.map((u) => ({
        ...publicUser(u),
        leads_count: leadCountForUser(leads, u.username),
      }));
      return json(res, 200, { users: list });
    }

    if (action === 'user_detail') {
      const uid = String(body.user_id || body.id || '').trim();
      // path fallback: /users/xyz
      const pathId = (url.match(/\/users\/([^/?#]+)/) || [])[1];
      const id = uid || (pathId ? decodeURIComponent(pathId) : '');
      if (!id) return json(res, 400, { error: 'user_id required' });
      const user = users.find((u) => String(u.id) === id);
      if (!user) return json(res, 404, { error: 'User not found' });

      const leadsStore = await loadLeadsStore();
      const leads = Array.isArray(leadsStore.leads) ? leadsStore.leads : [];
      const usage = await loadAiUsageStore();
      const events = (usage.events || []).filter((e) => String(e.user_id) === id || String(e.username).toLowerCase() === String(user.username).toLowerCase());
      const usage_by_day = {};
      const mode_counts = {};
      for (const e of events) {
        const d = dayKey(e.ts) || 'unknown';
        usage_by_day[d] = (usage_by_day[d] || 0) + (Number(e.tokens) || 0);
        const m = e.mode || 'chat';
        mode_counts[m] = (mode_counts[m] || 0) + 1;
      }
      const practice = await loadPracticeStore();
      const pev = (practice.events || [])
        .filter((e) => String(e.user || '').toLowerCase() === String(user.username).toLowerCase())
        .slice(-20);
      return json(res, 200, {
        user: publicUser(user),
        leads_count: leadCountForUser(leads, user.username),
        leads_by_list: leadsByList(leads, user.username),
        usage_by_day,
        mode_counts,
        events: events.slice(-30).reverse(),
        practice: pev,
      });
    }

    if (action === 'approve') {
      const pinCheck = adminPinOk(body.admin_pin);
      if (!pinCheck.ok) return json(res, 403, { error: pinCheck.error });
      const uid = String(body.user_id || '').trim();
      if (!uid) return json(res, 400, { error: 'user_id required' });
      const user = store.users.find((u) => String(u.id) === uid);
      if (!user) return json(res, 404, { error: 'User not found' });
      const cur = normalizeUser(user);
      cur.tokens_limit = (Number(cur.tokens_limit) || defaultTokenLimit()) + APPROVE_BONUS;
      cur.locked = false;
      cur.unlock_requested = false;
      Object.assign(user, normalizeUser(cur));
      await saveUsers(store);
      return json(res, 200, { ok: true, user: publicUser(user), bonus: APPROVE_BONUS });
    }

    if (action === 'set_role') {
      const pinCheck = adminPinOk(body.admin_pin);
      if (!pinCheck.ok) return json(res, 403, { error: pinCheck.error });
      const uid = String(body.user_id || '').trim();
      let role = String(body.role || 'rep').toLowerCase();
      if (role !== 'admin' && role !== 'owner' && role !== 'rep') role = 'rep';
      const user = store.users.find((u) => String(u.id) === uid);
      if (!user) return json(res, 404, { error: 'User not found' });
      user.role = role;
      Object.assign(user, normalizeUser(user));
      await saveUsers(store);
      return json(res, 200, { ok: true, user: publicUser(user) });
    }

    return json(res, 400, {
      error: 'Unknown action. Use summary, users, user_detail, approve, or set_role.',
    });
  } catch (e) {
    console.error('academy-admin error', e);
    return json(res, 500, { error: 'Admin error', detail: String(e?.message || e).slice(0, 300) });
  }
}
