/**
 * Minimal Twilio helpers (no SDK): webhook signature check, TwiML, outbound SMS.
 *
 * Env:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN   — required
 *   TWILIO_FROM_NUMBER                      — the FloGuard Twilio number (E.164), or
 *   TWILIO_MESSAGING_SERVICE_SID            — preferred once A2P 10DLC is approved
 *   PUBLIC_BASE_URL                         — e.g. https://crm.floguardfl.com/crm (what Twilio calls)
 */
import { createHmac, timingSafeEqual } from 'crypto';

export function twilioConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/** Parse a Twilio form POST whether Vercel pre-parsed it or not. */
export function formParams(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return { ...b };
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : String(b || '');
  return Object.fromEntries(new URLSearchParams(raw));
}

/** The exact URL Twilio requested (needed for the signature). */
export function publicUrl(req, path) {
  const base = (process.env.PUBLIC_BASE_URL || 'https://crm.floguardfl.com/crm').replace(/\/$/, '');
  const qs = String(req.url || '').includes('?') ? String(req.url).slice(String(req.url).indexOf('?')) : '';
  return `${base}${path}${qs}`;
}

/** https://www.twilio.com/docs/usage/security#validating-requests */
export function computeSignature(authToken, url, params) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + (params[k] ?? ''), url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function validTwilioRequest(req, path, params) {
  if (process.env.TWILIO_SKIP_SIGNATURE === 'true' && process.env.VERCEL_ENV !== 'production') return true;
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  const got = String(req.headers?.['x-twilio-signature'] || '');
  if (!token || !got) return false;
  const want = computeSignature(token, publicUrl(req, path), params);
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function sendTwiml(res, inner) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner || ''}</Response>`);
}

export function forbidden(res) {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Invalid Twilio signature');
}

/** Send one SMS through the Twilio REST API. Throws on failure. */
export async function sendSms({ to, body }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const form = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  } else if (process.env.TWILIO_FROM_NUMBER) {
    form.set('From', process.env.TWILIO_FROM_NUMBER);
  } else {
    throw new Error('Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER');
  }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Twilio SMS ${r.status}: ${data?.message || 'send failed'}`);
  return data;
}
