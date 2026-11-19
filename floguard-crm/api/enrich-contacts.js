/**
 * Bulk contact enrichment for CRM leads (phone / email / website).
 *
 * POST { action: 'enrich'|'capabilities'|'estimate', leads?: [...], force?: bool,
 *        allowPaid?: bool, maxPaidLookups?: number }
 * Auth: Authorization: Bearer <academy session>
 *
 * Returns per-lead results; client merges into local leads and re-pushes store.
 * Max 12 leads per request (Vercel time budget). Client should batch.
 *
 * Spend guard: maxPaidLookups (default 50, hard cap 500) bounds paid provider HTTP calls
 * (BatchData + Trestle) in THIS request. The function is stateless, so a client running many
 * batches subtracts `budget.used_total` from its run total and sends the remainder next time.
 * 'estimate' makes no provider calls; it returns per-lead provider and lookup counts.
 *
 * Daily cap (server side, review R1): every 'enrich' reserves its paid lookups from a per-day
 * budget (env ENRICH_DAILY_PAID_CAP, default 200; fsi/sql/022 for a deployment-wide counter,
 * per-instance memory otherwise) BEFORE any provider call, so neither a client-sent
 * maxPaidLookups nor replayed requests can exceed it. Response `daily` reports it.
 */
import { verifySessionToken } from '../server/lib/academy-db.js';
import {
  enrichOneLead,
  enrichCapabilities,
  estimateLead,
  createBudget,
  clampMaxPaidLookups,
} from '../server/lib/contact-enrich.js';
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';
import { dailyPaidCap, releaseDailySpend, reserveDailySpend } from '../server/lib/enrich-spend.js';

export const config = { maxDuration: 60 };

const MAX_BATCH = 12;
const SOFT_BUDGET_MS = 50_000; // leave ~10s of the 60s maxDuration for the response
const PHONE_SOURCES = new Set(['batchdata', 'trestle', 'web', 'search', 'manual', 'google_voice']);

function slimPhones(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 10)
    .filter((p) => p && typeof p === 'object' && String(p.number || '').trim())
    .map((p) => ({
      number: String(p.number).trim(),
      line_type: String(p.line_type || 'unknown'),
      dnc: p.dnc === true ? true : p.dnc === false ? false : null,
      litigator: p.litigator === true ? true : p.litigator === false ? false : null,
      source: PHONE_SOURCES.has(p.source) ? p.source : 'manual',
      confidence: Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : 0.5,
      found_at: String(p.found_at || ''),
      ...(typeof p.name_match === 'string' ? { name_match: p.name_match } : {}),
      ...(Array.isArray(p.checks) ? { checks: p.checks.map(String).slice(0, 6) } : {}),
    }));
}

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function slimLead(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  if (!name && !String(raw.address || '').trim()) return null;
  return {
    id: raw.id,
    name,
    address: String(raw.address || '').trim(),
    city: String(raw.city || '').trim(),
    zip: String(raw.zip || '').trim(),
    phone: String(raw.phone || '').trim(),
    email: String(raw.email || '').trim(),
    website: String(raw.website || '').trim(),
    industry: String(raw.industry || '').trim(),
    lists: Array.isArray(raw.lists) ? raw.lists.map(String) : [],
    source: String(raw.source || '').trim(),
    parcel_id: String(raw.parcel_id || '').trim(),
    // existing contact metadata so verification does not re-pay for known numbers
    phones: slimPhones(raw.phones),
    phone_source: String(raw.phone_source || '').trim(),
    phone_line_type: String(raw.phone_line_type || '').trim(),
    phone_confidence: raw.phone_confidence,
    phone_dnc: raw.phone_dnc === true ? true : raw.phone_dnc === false ? false : null,
  };
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

  const rl = rateLimit(`enrich:${clientIp(req)}`, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return json(res, 429, { error: 'Too many requests — slow down bulk enrich' });
  }

  const session = verifySessionToken(bearer(req));
  if (!session) return json(res, 401, { error: 'Unauthorized' });

  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON body' });

  const action = String(body.action || 'enrich');
  if (action === 'capabilities') {
    return json(res, 200, {
      ok: true,
      capabilities: enrichCapabilities(),
      max_batch: MAX_BATCH,
    });
  }
  if (action !== 'enrich' && action !== 'estimate') {
    return json(res, 400, { error: `Unknown action: ${action}` });
  }

  const rawList = Array.isArray(body.leads) ? body.leads : [];
  if (!rawList.length) {
    return json(res, 400, { error: 'leads[] required' });
  }
  if (rawList.length > MAX_BATCH) {
    return json(res, 400, {
      error: `Max ${MAX_BATCH} leads per request — client should batch`,
      max_batch: MAX_BATCH,
    });
  }

  const leads = rawList.map(slimLead).filter(Boolean);
  const force = !!body.force;
  const allowPaid = body.allowPaid !== false;
  const maxPaidLookups = clampMaxPaidLookups(body.maxPaidLookups);

  if (action === 'estimate') {
    const per = leads.map((l) => estimateLead(l, { force, allowPaid }));
    const sum = (k) => per.reduce((n, e) => n + (e[k] || 0), 0);
    return json(res, 200, {
      ok: true,
      capabilities: enrichCapabilities(),
      max_paid_lookups: maxPaidLookups,
      leads: per,
      totals: {
        leads: per.length,
        batchdata: sum('batchdata'),
        trestle_phone_intel: sum('trestle_phone_intel'),
        trestle_reverse_phone: sum('trestle_reverse_phone'),
        expected_lookups: sum('expected_lookups'),
        max_lookups: sum('max_lookups'),
        capped_at: maxPaidLookups,
        daily_cap: dailyPaidCap(),
      },
    });
  }

  const started = Date.now();
  const deadline = started + SOFT_BUDGET_MS;
  // Reserve paid lookups from today's server-side budget before any provider is called.
  const caps = enrichCapabilities();
  const wantsPaid = allowPaid && maxPaidLookups > 0 && Boolean(caps.batchdata || caps.trestle);
  const reservation = wantsPaid ? await reserveDailySpend(maxPaidLookups) : null;
  const budget = createBudget(reservation ? reservation.granted : wantsPaid ? 0 : maxPaidLookups);
  const results = [];

  // Sequential: polite to free search endpoints; avoids burst blocks
  for (const lead of leads) {
    try {
      // Soft time budget — leave ~8s for response
      if (Date.now() > deadline) {
        results.push({
          id: lead.id,
          status: 'timeout_budget',
          detail: 'batch time budget — retry remaining',
          phone: '',
          email: '',
          website: '',
          sources: [],
        });
        continue;
      }
      const r = await enrichOneLead(lead, { force, allowPaid, budget, deadline });
      results.push(r);
    } catch (e) {
      results.push({
        id: lead.id,
        status: 'error',
        detail: e?.message || String(e),
        phone: '',
        email: '',
        website: '',
        sources: [],
      });
    }
  }

  const summary = {
    requested: leads.length,
    found: results.filter((r) => r.status === 'found').length,
    partial: results.filter((r) => r.status === 'partial').length,
    not_found: results.filter((r) => r.status === 'not_found').length,
    complete: results.filter((r) => r.status === 'complete').length,
    blocked: results.filter((r) => r.status === 'blocked').length,
    errors: results.filter((r) => r.status === 'error' || r.status === 'timeout_budget')
      .length,
    ms: Date.now() - started,
  };
  const budgetOut = {
    max: budget.max,
    remaining: budget.remaining,
    used_total: budget.max - budget.remaining,
    used: budget.used,
    exhausted: budget.exhausted,
  };
  const released = reservation ? await releaseDailySpend(reservation, budgetOut.used_total) : null;
  const daily = reservation
    ? {
        cap: reservation.cap,
        requested: maxPaidLookups,
        granted: reservation.granted,
        remaining: released ? released.remaining : reservation.remaining,
        day: reservation.day,
        store: reservation.store,
        limited: reservation.granted < maxPaidLookups,
        ...(reservation.warning ? { warning: reservation.warning } : {}),
      }
    : { cap: dailyPaidCap(), requested: wantsPaid ? maxPaidLookups : 0, granted: 0, store: null, limited: false };

  return json(res, 200, {
    ok: true,
    capabilities: enrichCapabilities(),
    summary,
    budget: budgetOut,
    daily,
    results,
    dnc_reminder:
      'Scrub phone against DNC and honor CAN-SPAM before outreach. Enrichment is not consent.',
  });
}
