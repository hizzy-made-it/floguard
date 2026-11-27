/**
 * Per-lead public pages + the auto-reply email that links to them.
 *
 * A page lives at  <LEAD_PAGE_BASE_URL>/p/<token>   (token = readable slug + 16 random chars, ~96 bits,
 * e.g. johnson-504-nw-31st-Xq3vT0kP9aLm2Rw7). The token is the only credential: unknown or malformed
 * tokens all get the same 404, pages are noindex/no-referrer, and the page shows only what the lead
 * typed into the form about the property (no email, phone or free-text message).
 *
 * Storage (Supabase Storage, private bucket, service role only):
 *   lead-pages/<sha256(token)>.json          the page record
 *   lead-pages/<sha256(token)>/aerial.jpg    aerial photo of the lot
 *   lead-pages/<sha256(token)>/{before,after}.png   rendered images (cached)
 *   lead-pages/by-source/<sha256(source)>.json      { token } so re-running for the same lead reuses its page
 *
 * Version:
 *   full   the address matched a county parcel AND an aerial photo came back. The page and the email get
 *          the before/after images (lidar low ground when 3DEP answers, otherwise a lot-only concept).
 *   simple anything less. The page and email are the templated version with no property images.
 *
 * Sending is off unless LEAD_AUTOREPLY_ENABLED=true. LEAD_AUTOREPLY_TEST_ONLY=<email> limits every send to
 * that one address (others are skipped and reported as "test_only").
 */
import { randomBytes, createHash } from 'node:crypto';
import { storageGetJson, storagePutJson, storageGetBytes, storagePutBytes } from '../supabase-rest.js';
import { enrichAddress, lowGround } from './geo.js';
import { renderPng, planLayout } from './visuals.js';
import { buildAutoReply } from './email.js';

const BUCKET = () => process.env.ACADEMY_STORAGE_BUCKET || 'floguard-academy';
const PREFIX = 'lead-pages';

export const TOKEN_RE = /^[a-z0-9-]{1,60}-[A-Za-z0-9_-]{16}$/;
export const isPageToken = (t) => typeof t === 'string' && t.length <= 80 && TOKEN_RE.test(t);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
export const pageHandle = (t) => sha(t).slice(0, 32);

export function baseUrl() {
  return String(process.env.LEAD_PAGE_BASE_URL || 'https://crm.floguardfl.com').replace(/\/+$/, '');
}
/** Where the page's own assets (logo) are served from; the CRM host serves /crm/*. */
export function assetBase() {
  return String(process.env.LEAD_PAGE_ASSET_BASE || 'https://crm.floguardfl.com').replace(/\/+$/, '');
}
export const pageUrl = (token) => `${baseUrl()}/p/${token}`;

const STREET_TYPES = new Set(['st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane', 'ct', 'court', 'cir', 'circle', 'blvd', 'way', 'pl', 'place', 'ter', 'terrace', 'trl', 'trail', 'pkwy', 'hwy', 'loop', 'run', 'pt', 'cv', 'sq']);

/** "Mark Johnson", "504 NW 31st St" -> "johnson-504-nw-31st" (max 40 chars, ascii only). */
export function makeSlug(name, address) {
  const clean = (s) => String(s || '').normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase();
  const last = clean(name).split(/\s+/).filter((w) => /[a-z]/.test(w)).pop() || 'home';
  const words = clean(address).split(',')[0].split(/[^a-z0-9]+/).filter(Boolean);
  const out = [last.replace(/[^a-z]/g, '').slice(0, 18) || 'home'];
  for (const w of words) {
    if (STREET_TYPES.has(w) || /^(apt|unit|ste|suite)$/.test(w)) break;
    out.push(w);
    if (out.length >= 5) break;
  }
  return out.join('-').replace(/-+/g, '-').slice(0, 40).replace(/-$/, '');
}

export function mintPageToken(name, address) {
  return `${makeSlug(name, address)}-${randomBytes(12).toString('base64url')}`;
}

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);

/** What a page may show. Only property facts the lead typed; never email, phone or the free-text message. */
export function publicLeadFields(lead) {
  const name = str(lead.name, 80);
  return {
    first_name: name.split(/\s+/)[0] || 'there',
    address: str(lead.address, 140),
    city: str(lead.location || lead.city, 60),
    property_type: str(lead.property_type || lead.propertyType, 60),
    issues: list(lead.issues),
    water_location: list(lead.water_location),
    water_duration: str(lead.water_duration, 60),
    frequency: str(lead.frequency, 60),
    affected_size: str(lead.affected_size, 60),
    existing_drainage: list(lead.existing_drainage),
    damages: list(lead.damages),
    timeline: str(lead.timeline, 60),
    photos_count: Array.isArray(lead.photos) ? lead.photos.length : 0,
  };
}

async function loadRecord(token) {
  if (!isPageToken(token)) return null;
  return storageGetJson(BUCKET(), `${PREFIX}/${sha(token)}.json`);
}
async function saveRecord(token, rec) {
  await storagePutJson(BUCKET(), `${PREFIX}/${sha(token)}.json`, rec);
}

/** Turn the GIS lookups into the stored record (no raw parcel attributes beyond lot size). */
export function buildRecord(lead, enrich, now = new Date()) {
  const fields = publicLeadFields(lead);
  const rec = { v: 1, created_at: now.toISOString(), ...fields, version: 'simple', reasons: [] };
  if (!enrich?.geo) rec.reasons.push(fields.address ? 'address_not_found' : 'no_address');
  else if (!enrich.parcel) rec.reasons.push('no_county_parcel');
  else if (!enrich.aerial) rec.reasons.push('no_aerial');
  if (enrich?.geo) rec.geo = { lon: enrich.geo.lon, lat: enrich.geo.lat };
  if (enrich?.parcel) {
    rec.parcel = { ring: enrich.parcel.ring, lot_sqft: enrich.parcel.lot_sqft };
    rec.front = enrich.front;
  }
  if (enrich?.elev) {
    rec.elev = enrich.elev;
    const lg = lowGround(enrich.elev);
    rec.low_ground = lg && !lg.flat ? lg : null;
    rec.flat_lot = !!lg?.flat;
  } else if (enrich?.parcel) rec.reasons.push('no_lidar');
  if (enrich?.aerial) {
    rec.aerial = { extent: enrich.aerial.extent, width: enrich.aerial.width, height: enrich.aerial.height, credit: enrich.aerial.credit };
  }
  if (rec.parcel && rec.aerial) {
    rec.version = 'full';
    const lay = planLayout(rec);
    rec.layout = { discharge_ft: lay.discharge_ft, collector_ft: lay.collector_ft };
  }
  return rec;
}

/**
 * Create (or reuse, by source id) the page for a lead. Never throws on GIS problems; throws only when
 * storage is not configured. Returns { token, url, rec, reused }.
 */
export async function upsertLeadPage(lead, { sourceId = '', fetchImpl, refresh = false } = {}) {
  const srcKey = sourceId ? `${PREFIX}/by-source/${sha(`v1:${sourceId}`)}.json` : null;
  if (srcKey && !refresh) {
    const idx = await storageGetJson(BUCKET(), srcKey);
    if (idx?.token) {
      const rec = await loadRecord(idx.token);
      if (rec) return { token: idx.token, url: pageUrl(idx.token), rec, reused: true };
    }
  }
  let token = null;
  if (srcKey && refresh) token = (await storageGetJson(BUCKET(), srcKey))?.token || null;
  token = token || mintPageToken(lead.name, lead.address);
  const enrich = await enrichAddress(str(lead.address, 140), str(lead.location || lead.city, 60), { fetchImpl });
  const rec = buildRecord(lead, enrich);
  if (enrich.aerial?.jpeg) await storagePutBytes(BUCKET(), `${PREFIX}/${sha(token)}/aerial.jpg`, enrich.aerial.jpeg, 'image/jpeg');
  await saveRecord(token, rec);
  if (srcKey) await storagePutJson(BUCKET(), srcKey, { token, created_at: rec.created_at });
  return { token, url: pageUrl(token), rec, reused: false };
}

/** Page record for rendering, or null (unknown token). */
export async function getLeadPage(token) {
  return loadRecord(token);
}

/** before/after PNG for a page (cached in storage after the first render). */
export async function getLeadImage(token, which) {
  if (!['before', 'after'].includes(which)) return null;
  const rec = await loadRecord(token);
  if (!rec || rec.version !== 'full') return null;
  const key = `${PREFIX}/${sha(token)}/${which}.png`;
  const cached = await storageGetBytes(BUCKET(), key);
  if (cached) return cached;
  const jpeg = await storageGetBytes(BUCKET(), `${PREFIX}/${sha(token)}/aerial.jpg`);
  if (!jpeg) return null;
  const png = await renderPng({ ...rec, aerial_b64: jpeg.toString('base64') }, which);
  try {
    await storagePutBytes(BUCKET(), key, png, 'image/png');
  } catch {
    /* cache is optional */
  }
  return png;
}

// ---------------------------------------------------------------------------
// Auto-reply
// ---------------------------------------------------------------------------

const recentSends = new Map(); // per isolate: one auto-reply per address per 12 h
const SEND_GAP_MS = 12 * 3600 * 1000;

export function autoReplyConfig() {
  return {
    enabled: String(process.env.LEAD_AUTOREPLY_ENABLED || '').toLowerCase() === 'true',
    testOnly: String(process.env.LEAD_AUTOREPLY_TEST_ONLY || '').trim().toLowerCase(),
    from: process.env.LEAD_AUTOREPLY_FROM || 'FloGuard <leads@hdconnex.com>',
    replyTo: process.env.LEAD_AUTOREPLY_REPLY_TO || 'heath@hdconnex.com',
    bcc: String(process.env.LEAD_AUTOREPLY_BCC || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/**
 * Send the reply for a page. Returns 'sent' | 'disabled' | 'test_only' | 'no_email' | 'already_sent' |
 * 'throttled' | 'error'. Records the outcome on the page record (never the address itself).
 */
export async function sendAutoReply(token, rec, email, { fetchImpl = globalThis.fetch, force = false } = {}) {
  const cfg = autoReplyConfig();
  const to = String(email || '').trim().toLowerCase();
  if (!cfg.enabled) return 'disabled';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return 'no_email';
  if (cfg.testOnly && to !== cfg.testOnly) return 'test_only';
  if (rec.email?.sent_at && !force) return 'already_sent';
  const last = recentSends.get(sha(to));
  if (last && Date.now() - last < SEND_GAP_MS && !force) return 'throttled';
  if (!process.env.RESEND_API_KEY) return 'disabled';
  const msg = buildAutoReply(rec, { url: pageUrl(token), imgBase: `${pageUrl(token)}`, logoUrl: `${assetBase()}/crm/logo.png` });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  let status = 'error';
  try {
    const body = { from: cfg.from, to: [to], reply_to: cfg.replyTo, subject: msg.subject, html: msg.html, text: msg.text };
    if (cfg.bcc.length) body.bcc = cfg.bcc;
    const r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    status = r.ok ? 'sent' : 'error';
    if (!r.ok) console.error('[lead-page] resend', r.status);
  } catch (e) {
    console.error('[lead-page] send failed:', String(e?.message || e).slice(0, 120));
  } finally {
    clearTimeout(t);
  }
  if (status === 'sent') {
    recentSends.set(sha(to), Date.now());
    rec.email = { sent_at: new Date().toISOString(), version: rec.version };
    try {
      await saveRecord(token, rec);
    } catch {
      /* the email went; the marker is best effort */
    }
  }
  return status;
}

export { buildAutoReply };
