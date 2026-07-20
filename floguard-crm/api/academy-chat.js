/**
 * Shared OpenAI proxy for FloGuard Sales Rev.
 * Key stays server-side (OPENAI_API_KEY); browser never sees it.
 * Tracks token usage per signed-in user and enforces soft caps.
 */
import { setCors, json, rateLimit, clientIp } from '../server/lib/http.js';
import {
  isAdminRole,
  loadUsers,
  normalizeUser,
  publicUser,
  recordUserTokenSpend,
  verifySessionToken,
} from '../server/lib/academy-db.js';

export const config = { maxDuration: 60 };

const ALLOWED_MODEL = /^(gpt-|o\d|chatgpt-)/i;
const MAX_MESSAGES = 40;
const MAX_CHARS = 60000;

function sanitizeMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return null;
  if (messages.length > MAX_MESSAGES) return null;
  let total = 0;
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') return null;
    const role = String(m.role || '');
    if (!['system', 'user', 'assistant'].includes(role)) return null;
    const content = String(m.content ?? '');
    total += content.length;
    if (total > MAX_CHARS) return null;
    out.push({ role, content });
  }
  return out;
}

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function estimateTokensFromMessages(messages) {
  // ~4 chars per token rough floor when OpenAI usage missing
  let chars = 0;
  for (const m of messages || []) chars += String(m.content || '').length;
  return Math.max(50, Math.ceil(chars / 4));
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
  const rl = rateLimit(`chat:${ip}`, { limit: 20, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec || 60));
    return json(res, 429, { error: 'Chat rate limit. Try again shortly.' });
  }

  let session = null;
  let user = null;
  try {
    const token = bearer(req);
    session = verifySessionToken(token);
    if (!session) {
      return json(res, 401, {
        error: 'Sign in required. Open the CRM and log in with your username + PIN.',
      });
    }
    const store = await loadUsers();
    user = (store.users || []).find((u) => String(u.id) === String(session.sub));
    if (!user) {
      return json(res, 401, { error: 'Account not found. Sign in again.' });
    }
    user = normalizeUser(user);
    // Soft lock — admins bypass for support
    if (user.locked && !isAdminRole(user.role)) {
      return json(res, 402, {
        error: 'TOKEN_LIMIT',
        detail: {
          error: 'TOKEN_LIMIT',
          message: 'Token budget reached. An admin must approve more usage.',
          tokens_used: user.tokens_used,
          tokens_limit: user.tokens_limit,
          locked: true,
        },
      });
    }
  } catch (e) {
    return json(res, 500, { error: 'Auth check failed: ' + (e?.message || 'error') });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(res, 500, { error: 'Platform AI is not configured (missing OPENAI_API_KEY).' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
  }
  body = body || {};

  const messages = sanitizeMessages(body.messages);
  if (!messages) {
    return json(res, 400, { error: 'Invalid or oversized messages payload' });
  }

  let model = String(body.model || 'gpt-4o-mini').trim();
  if (!ALLOWED_MODEL.test(model) || model.length > 64) {
    model = 'gpt-4o-mini';
  }

  const payload = { model, messages };
  if (typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 2) {
    payload.temperature = body.temperature;
  }
  if (typeof body.max_tokens === 'number' && body.max_tokens > 0 && body.max_tokens <= 4000) {
    payload.max_tokens = Math.floor(body.max_tokens);
  }
  if (
    typeof body.max_completion_tokens === 'number' &&
    body.max_completion_tokens > 0 &&
    body.max_completion_tokens <= 4000
  ) {
    payload.max_completion_tokens = Math.floor(body.max_completion_tokens);
  }

  const mode = String(body.mode || 'coach').slice(0, 32);

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return json(res, 502, { error: `OpenAI returned non-JSON (${r.status})` });
    }

    // Record usage on success
    let academy = publicUser(user);
    if (r.ok && user) {
      const usage = data?.usage || {};
      const spent =
        Number(usage.total_tokens) ||
        (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0) ||
        estimateTokensFromMessages(messages);
      try {
        academy = (await recordUserTokenSpend(user.id, spent, { mode })) || academy;
      } catch (e) {
        console.warn('token spend failed', e?.message);
      }
      data.academy = academy;
    }

    res.statusCode = r.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify(data));
  } catch (err) {
    return json(res, 502, { error: 'Failed to reach OpenAI: ' + (err?.message || 'network error') });
  }
}
