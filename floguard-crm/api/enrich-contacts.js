/**
 * Bulk contact enrichment for CRM leads (phone / email / website).
 *
 * POST { action: 'enrich'|'capabilities', leads?: [...], force?: bool, allowPaid?: bool }
 * Auth: Authorization: Bearer <academy session>
 *
 * Returns per-lead results; client merges into local leads and re-pushes store.
 * Max 12 leads per request (Vercel time budget). Client should batch.
 */
import { verifySessionToken } from '../server/lib/academy-db.js';
import {
  enrichOneLead,
  enrichCapabilities,
} from '../server/lib/contact-enrich.js';
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';

export const config = { maxDuration: 60 };

const MAX_BATCH = 12;

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
  if (action !== 'enrich') {
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
  const started = Date.now();
  const results = [];

  // Sequential: polite to free search endpoints; avoids burst blocks
  for (const lead of leads) {
    try {
      // Soft time budget — leave ~8s for response
      if (Date.now() - started > 50_000) {
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
      const r = await enrichOneLead(lead, { force, allowPaid });
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
    errors: results.filter((r) => r.status === 'error' || r.status === 'timeout_budget')
      .length,
    ms: Date.now() - started,
  };

  return json(res, 200, {
    ok: true,
    capabilities: enrichCapabilities(),
    summary,
    results,
    dnc_reminder:
      'Scrub phone against DNC and honor CAN-SPAM before outreach. Enrichment is not consent.',
  });
}
