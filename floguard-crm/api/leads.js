/**
 * Public marketing lead capture.
 * POST JSON: { name, email, phone?, company?, message?, services?, budget?, page?, source? }
 */
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';
import { persistWebLead, validateLeadPayload } from '../server/lib/web-leads.js';

export const config = { maxDuration: 30 };

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
