/**
 * HTTP side of lead pages, called from api/leads.js (no new files under api/: function cap).
 *
 *   GET  /p/<token>              -> api/leads?lead_page=<token>              HTML page
 *   GET  /p/<token>/before.png   -> api/leads?lead_page=<token>&img=before   PNG
 *   GET  /p/<token>/after.png    -> api/leads?lead_page=<token>&img=after    PNG
 *   POST api/leads {action:'lead_forward', ...}   X-Lead-Forward-Secret: <LEAD_FORWARD_SECRET>
 *        from the website backend: saves the lead to the CRM, builds the page, sends the reply when
 *        sending is switched on and `send` is true.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { json, rateLimit, clientIp } from '../http.js';
import { persistWebLead } from '../web-leads.js';
import {
  isPageToken, pageHandle, getLeadPage, getLeadImage, upsertLeadPage, sendAutoReply,
  buildAutoReply, pageUrl, assetBase, buildRecord, autoReplyConfig,
} from './index.js';
import { renderLeadPage, renderNotFound } from './page-html.js';
import { enrichAddress } from './geo.js';
import { renderPng } from './visuals.js';

const PAGE_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function send(res, status, type, body, extra = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries({ ...PAGE_HEADERS, ...extra })) res.setHeader(k, v);
  res.setHeader('Content-Type', type);
  res.end(body);
}

const notFound = (res) => send(res, 404, 'text/html; charset=utf-8', renderNotFound(), { 'Cache-Control': 'no-store' });

// --- built-in sample (/p/sample): a real lot, made live, never stored -------------------------
const SAMPLE_LEAD = {
  name: 'Sample Homeowner',
  address: '5512 N Lancewood Cir',
  location: 'Port Orange',
  property_type: 'Single-family home',
  issues: ['Standing water in the yard', 'Water near the foundation'],
  water_location: ['Backyard', 'Side yard'],
  water_duration: 'More than 2 days',
  frequency: 'Every heavy rain',
  affected_size: 'Most of the backyard',
  timeline: 'As soon as possible',
};
let sample = null; // { rec, jpeg, at }
async function samplePage() {
  if (String(process.env.LEAD_PAGE_SAMPLE || 'on').toLowerCase() === 'off') return null;
  if (sample && Date.now() - sample.at < 6 * 3600 * 1000) return sample;
  const enrich = await enrichAddress(SAMPLE_LEAD.address, SAMPLE_LEAD.location);
  const rec = buildRecord(SAMPLE_LEAD, enrich);
  sample = { rec, jpeg: enrich.aerial?.jpeg || null, at: Date.now() };
  return sample;
}

export async function handleLeadPageGet(req, res, query) {
  const token = String(query.get('lead_page') || '');
  const img = String(query.get('img') || '');
  const ip = clientIp(req);
  const rl = rateLimit(`leadpage:${ip}`, { limit: 120, windowMs: 60_000 });
  if (!rl.ok) return send(res, 429, 'text/plain; charset=utf-8', 'Too many requests', { 'Retry-After': '60' });
  const logoUrl = `${assetBase()}/crm/logo.png`;
  try {
    if (token === 'sample') {
      const s = await samplePage();
      if (!s) return notFound(res);
      if (img) {
        if (!['before', 'after'].includes(img) || s.rec.version !== 'full' || !s.jpeg) return notFound(res);
        const png = await renderPng({ ...s.rec, aerial_b64: s.jpeg.toString('base64') }, img);
        return send(res, 200, 'image/png', png, { 'Cache-Control': 'public, max-age=3600' });
      }
      if (query.get('email') === '1') {
        const m = buildAutoReply(s.rec, { url: pageUrl('sample'), imgBase: pageUrl('sample'), logoUrl });
        return send(res, 200, 'text/html; charset=utf-8', m.html, { 'Cache-Control': 'no-store' });
      }
      const nonce = randomBytes(16).toString('base64');
      return send(res, 200, 'text/html; charset=utf-8', renderLeadPage(s.rec, { token: 'sample', nonce, logoUrl }), cspHeaders(nonce));
    }
    if (!isPageToken(token)) {
      const m = rateLimit(`leadpage-miss:${ip}`, { limit: 10, windowMs: 10 * 60_000 });
      return m.ok ? notFound(res) : send(res, 429, 'text/plain; charset=utf-8', 'Too many requests');
    }
    const trl = rateLimit(`leadpage-t:${pageHandle(token)}`, { limit: 40, windowMs: 60_000 });
    if (!trl.ok) return send(res, 429, 'text/plain; charset=utf-8', 'Too many requests', { 'Retry-After': '60' });
    if (img) {
      const png = await getLeadImage(token, img);
      if (!png) return notFound(res);
      // Images are public to anyone holding the link (they sit in the email); cache them hard.
      return send(res, 200, 'image/png', png, { 'Cache-Control': 'public, max-age=86400' });
    }
    const rec = await getLeadPage(token);
    if (!rec) {
      const m = rateLimit(`leadpage-miss:${ip}`, { limit: 10, windowMs: 10 * 60_000 });
      return m.ok ? notFound(res) : send(res, 429, 'text/plain; charset=utf-8', 'Too many requests');
    }
    const nonce = randomBytes(16).toString('base64');
    return send(res, 200, 'text/html; charset=utf-8', renderLeadPage(rec, { token, nonce, logoUrl }), cspHeaders(nonce));
  } catch (e) {
    console.error('[lead-page] get failed:', String(e?.message || e).slice(0, 160)); // never logs the token
    return send(res, 503, 'text/plain; charset=utf-8', 'This page is temporarily unavailable. Call (386) 259-0023.', { 'Cache-Control': 'no-store' });
  }
}

function cspHeaders(nonce) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': [
      "default-src 'none'",
      `img-src 'self' ${assetBase()} data:`,
      `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
      'font-src https://fonts.gstatic.com',
      `script-src 'nonce-${nonce}'`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  };
}

const h = (s) => createHash('sha256').update(String(s)).digest();
function secretOk(req) {
  const want = String(process.env.LEAD_FORWARD_SECRET || '');
  const got = String(req.headers?.['x-lead-forward-secret'] || '');
  return want.length >= 24 && got.length > 0 && timingSafeEqual(h(want), h(got));
}

/**
 * POST {action:'lead_forward', source_id, lead:{name,email,phone,address,location,...}, send?, preview?, persist?}
 * -> { ok, url, version, reasons, reused, sent, email? }
 */
export async function handleLeadForward(req, res, body) {
  if (!secretOk(req)) return json(res, 401, { error: 'unauthorized' });
  const lead = body.lead && typeof body.lead === 'object' ? body.lead : null;
  const sourceId = String(body.source_id || '').slice(0, 120);
  if (!lead || !String(lead.name || '').trim()) return json(res, 400, { error: 'lead_required' });
  try {
    const page = await upsertLeadPage(lead, { sourceId, refresh: body.refresh === true });
    if (!page.reused && body.persist !== false) {
      try {
        await persistWebLead({
          name: lead.name, email: lead.email, phone: lead.phone, message: lead.message, address: lead.address,
          city: lead.location || lead.city, source: lead.source || 'website', page_url: page.url,
          quiz: {
            issues: lead.issues, water_location: lead.water_location, water_duration: lead.water_duration,
            frequency: lead.frequency, affected_size: lead.affected_size, timeline: lead.timeline,
            property_type: lead.property_type || lead.propertyType, location: lead.location,
          },
        });
      } catch (e) {
        console.error('[lead-forward] crm save failed:', String(e?.message || e).slice(0, 160));
      }
    }
    let sent = 'not_requested';
    if (body.send === true) sent = await sendAutoReply(page.token, page.rec, lead.email);
    const out = {
      ok: true, url: page.url, version: page.rec.version, reasons: page.rec.reasons, reused: page.reused, sent,
      already_sent_at: page.rec.email?.sent_at || null, sending_enabled: autoReplyConfig().enabled,
    };
    if (body.preview === true) {
      out.email = buildAutoReply(page.rec, { url: page.url, imgBase: page.url, logoUrl: `${assetBase()}/crm/logo.png` });
    }
    return json(res, 200, out);
  } catch (e) {
    console.error('[lead-forward] failed:', String(e?.message || e).slice(0, 200));
    return json(res, 500, { error: 'lead_page_failed', detail: String(e?.message || e).slice(0, 200) });
  }
}
