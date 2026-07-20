/**
 * FloGuard Sales Rev auth: username + PIN (min 4 digits).
 * POST body: { action: 'register'|'login'|'me'|'logout'|'request_unlock', username?, pin?, token? }
 * Also accepts Authorization: Bearer <token> for me / request_unlock.
 */
import {
  applyAdminBootstrap,
  createSessionToken,
  defaultTokenLimit,
  findUser,
  hashPin,
  loadUsers,
  newUserId,
  normalizeUser,
  publicUser,
  saveUsers,
  validatePin,
  validateUsername,
  verifyPin,
  verifySessionToken,
} from '../server/lib/academy-db.js';
import { setCors, json as sendJson, parseBody as parseJsonBody, rateLimit, clientIp } from '../server/lib/http.js';

export const config = { maxDuration: 30 };

function json(res, status, body) {
  sendJson(res, status, body);
}

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
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const ip = clientIp(req);
  const rl = rateLimit(`auth:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec || 60));
    return json(res, 429, { error: 'Too many auth attempts.' });
  }

  const body = parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON body' });

  const action = String(body.action || '').toLowerCase();

  try {
    if (action === 'register') {
      const vu = validateUsername(body.username);
      if (!vu.ok) return json(res, 400, { error: vu.error });
      const vp = validatePin(body.pin);
      if (!vp.ok) return json(res, 400, { error: vp.error });

      const store = await loadUsers();
      if (findUser(store, vu.username)) {
        return json(res, 409, { error: 'That username is already taken.' });
      }

      const user = normalizeUser({
        id: newUserId(),
        username: vu.username,
        pin_hash: hashPin(vp.pin),
        role: 'rep',
        tokens_used: 0,
        tokens_limit: defaultTokenLimit(),
        locked: false,
        unlock_requested: false,
        created_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      });
      store.users.push(user);
      applyAdminBootstrap(store, vu.username);
      await saveUsers(store);

      const saved = findUser(store, vu.username) || user;
      const token = createSessionToken(saved);
      return json(res, 201, { ok: true, token, user: publicUser(saved) });
    }

    if (action === 'login') {
      const vu = validateUsername(body.username);
      if (!vu.ok) return json(res, 400, { error: vu.error });
      const vp = validatePin(body.pin);
      if (!vp.ok) return json(res, 400, { error: vp.error });

      const store = await loadUsers();
      const user = findUser(store, vu.username);
      if (!user || !verifyPin(vp.pin, user.pin_hash)) {
        return json(res, 401, { error: 'Invalid username or PIN.' });
      }

      user.last_login_at = new Date().toISOString();
      user.last_seen = user.last_login_at;
      Object.assign(user, normalizeUser(user));
      applyAdminBootstrap(store, vu.username);
      await saveUsers(store);

      const token = createSessionToken(user);
      return json(res, 200, { ok: true, token, user: publicUser(user) });
    }

    if (action === 'me') {
      const token = body.token || bearer(req);
      const session = verifySessionToken(token);
      if (!session) return json(res, 401, { error: 'Not signed in.' });

      const store = await loadUsers();
      applyAdminBootstrap(store, session.u);
      const user = (store.users || []).find((u) => u.id === session.sub);
      if (!user) return json(res, 401, { error: 'Account not found.' });
      user.last_seen = new Date().toISOString();
      Object.assign(user, normalizeUser(user));
      await saveUsers(store);
      return json(res, 200, { ok: true, user: publicUser(user) });
    }

    if (action === 'request_unlock') {
      const token = body.token || bearer(req);
      const session = verifySessionToken(token);
      if (!session) return json(res, 401, { error: 'Not signed in.' });
      const store = await loadUsers();
      const user = (store.users || []).find((u) => u.id === session.sub);
      if (!user) return json(res, 401, { error: 'Account not found.' });
      user.unlock_requested = true;
      user.last_seen = new Date().toISOString();
      Object.assign(user, normalizeUser(user));
      await saveUsers(store);
      return json(res, 200, { ok: true, user: publicUser(user) });
    }

    if (action === 'logout') {
      return json(res, 200, { ok: true });
    }

    return json(res, 400, {
      error: 'Unknown action. Use register, login, me, request_unlock, or logout.',
    });
  } catch (err) {
    console.error('academy-auth error', err);
    return json(res, 500, { error: err?.message || 'Auth server error' });
  }
}
