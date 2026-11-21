/**
 * New-lead email alerts via Resend (https://resend.com/docs/api-reference/emails/send-email).
 *
 *   RESEND_API_KEY     required; without it nothing is sent (leads are still saved)
 *   LEAD_NOTIFY_TO     comma-separated recipients, default heath@hdconnex.com
 *   LEAD_NOTIFY_FROM   default "FloGuard CRM <leads@hdconnex.com>" (hdconnex.com is the verified
 *                      Resend domain; switch to an @floguardfl.com address once that domain is verified)
 *
 * Never throws and never blocks a webhook for more than ~4 s.
 */

const DEFAULT_TO = 'heath@hdconnex.com';
const DEFAULT_FROM = 'FloGuard CRM <leads@hdconnex.com>';
const CRM_URL = 'https://crm.floguardfl.com/crm/';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function buildLeadEmail({ source, name, phone, email, city, message, services }) {
  const who = name || phone || email || 'Unknown';
  const subject = `New FloGuard lead (${source}): ${who}`.slice(0, 200);
  const rows = [
    ['Source', source],
    ['Name', name],
    ['Phone', phone],
    ['Email', email],
    ['City', city],
    ['Services', Array.isArray(services) ? services.join(', ') : services],
    ['Message', message],
  ].filter(([, v]) => v != null && String(v).trim() !== '');
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nOpen the CRM: ${CRM_URL}`;
  const html =
    `<table cellpadding="4" style="font:14px/1.4 -apple-system,Segoe UI,Arial,sans-serif">` +
    rows.map(([k, v]) => `<tr><td style="color:#666;vertical-align:top">${esc(k)}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('') +
    `</table><p><a href="${CRM_URL}">Open the CRM</a></p>`;
  return { subject, text, html };
}

export async function notifyNewLead(lead, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return 'disabled';
  const to = String(process.env.LEAD_NOTIFY_TO || DEFAULT_TO).split(',').map((s) => s.trim()).filter(Boolean);
  const from = process.env.LEAD_NOTIFY_FROM || DEFAULT_FROM;
  const { subject, text, html } = buildLeadEmail(lead);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text, html }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error('[notify] resend', r.status);
      return 'error';
    }
    return 'sent';
  } catch (e) {
    console.error('[notify] failed:', String(e?.message || e).slice(0, 120));
    return 'error';
  } finally {
    clearTimeout(t);
  }
}
