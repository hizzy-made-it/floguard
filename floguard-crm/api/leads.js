/**
 * Public marketing lead capture.
 * POST JSON: { name, email, phone?, company?, message?, services?, budget?, page?, source? }
 *
 * Also the customer-facing estimate endpoint (no login; the unguessable proposal token is the
 * credential). POST JSON { action: 'proposal_get' | 'proposal_accept' | 'proposal_decline', token, ... }.
 * Contract and security notes: docs/handoff/G.md. Lead intake (no `action`) is unchanged.
 */
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';
import { persistWebLead, validateLeadPayload } from '../server/lib/web-leads.js';
import { getLeadsPipeline, mirrorLeadsToStorage } from '../server/lib/academy-db.js';
import { LeadsError } from '../server/lib/academy-pg.js';
import { notifyNewLead } from '../server/lib/notify.js';
import {
  isTokenShape, tokenHandle, publicProposalAccept, publicProposalDecline, publicProposalGet,
} from '../server/lib/estimates.js';

export const config = { maxDuration: 30 };

const PROPOSAL_ACTIONS = new Set(['proposal_get', 'proposal_accept', 'proposal_decline']);

function notFound(res) {
  // One response for unknown, voided, draft and malformed tokens: no enumeration.
  return json(res, 404, { error: 'not_found' });
}

function tooMany(res, rl) {
  res.setHeader('Retry-After', String(rl.retryAfterSec || 60));
  return json(res, 429, { error: 'Too many requests. Try again shortly.' });
}

async function handleProposal(req, res, body, action) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const ip = clientIp(req);
  const write = action !== 'proposal_get';
  const token = typeof body.token === 'string' ? body.token.trim() : '';

  // Strict limits: per IP, and per token (hashed so the token is never a key or log value).
  let rl = rateLimit(`proposal:${write ? 'w' : 'r'}:${ip}`, write ? { limit: 6, windowMs: 60_000 } : { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return tooMany(res, rl);
  if (isTokenShape(token)) {
    rl = rateLimit(`proposal-token:${write ? 'w' : 'r'}:${tokenHandle(token)}`, write ? { limit: 10, windowMs: 60_000 } : { limit: 20, windowMs: 60_000 });
    if (!rl.ok) return tooMany(res, rl);
  }

  const miss = () => {
    // Guess accounting: repeated misses from one IP get throttled hard.
    const m = rateLimit(`proposal-miss:${ip}`, { limit: 8, windowMs: 10 * 60_000 });
    return m.ok ? notFound(res) : tooMany(res, m);
  };
  if (!isTokenShape(token)) return miss();

  try {
    const pipe = await getLeadsPipeline();
    if (!pipe) return notFound(res); // storage backend: estimates do not exist
    let out = null;
    if (action === 'proposal_get') {
      out = await publicProposalGet(token, { preview: body.preview === true });
      if (!out) return miss();
      return json(res, 200, { ok: true, proposal: out.proposal });
    }
    if (action === 'proposal_accept') {
      out = await publicProposalAccept(token, { name: body.name, consent: body.consent }, { ip, userAgent: String(req.headers?.['user-agent'] || '') });
      if (!out) return miss();
      if (out.stage) await mirrorLeadsToStorage();
      return json(res, 200, { ok: true, already_accepted: out.already_accepted, accepted_at: out.accepted_at, accepted_name: out.accepted_name, number: out.number, proposal: out.proposal });
    }
    out = await publicProposalDecline(token, { reason: body.reason });
    if (!out) return miss();
    return json(res, 200, { ok: true, already_declined: out.already_declined, declined_at: out.declined_at, proposal: out.proposal });
  } catch (e) {
    if (e instanceof LeadsError) return json(res, e.status, { error: e.code, detail: e.message });
    console.error('[proposal] error:', String(e?.message || e).slice(0, 200)); // never logs the token
    return json(res, 500, { error: 'proposal_unavailable' });
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

  const pre = parseBody(req);
  const preAction = pre && typeof pre.action === 'string' ? pre.action.toLowerCase() : '';
  if (PROPOSAL_ACTIONS.has(preAction)) return handleProposal(req, res, pre, preAction);

  const ip = clientIp(req);
  const rl = rateLimit(`leads:${ip}`, { limit: 12, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec || 60));
    return json(res, 429, { error: 'Too many requests. Try again shortly.' });
  }

  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON body' });

  const v = validateLeadPayload(body);
  if (!v.ok) {
    if (v.honeypot) return json(res, 200, { success: true, id: 'ok' });
    return json(res, 400, { error: v.error });
  }

  try {
    const lead = await persistWebLead({
      name: body.name,
      email: body.email,
      phone: body.phone,
      company: body.company,
      message: body.message,
      services: body.services,
      budget: body.budget,
      page: body.page,
      source: body.source || 'website',
    });
    await notifyNewLead({ source: 'website', name: body.name, phone: body.phone, email: body.email, message: body.message, services: body.services });
    return json(res, 200, { success: true, id: lead.id });
  } catch (e) {
    const msg = e?.message || 'Failed to save lead';
    // Fallback: still accept if Resend/webhook configured later; for now report config error clearly
    if (String(msg).includes('Supabase is not configured')) {
      return json(res, 503, {
        error: 'Lead store not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      });
    }
    return json(res, 500, { error: msg.slice(0, 200) });
  }
}
