/**
 * Phone intake: turn Twilio calls / voicemails / texts into CRM leads (shared leads.json)
 * and send the one-time auto text-back.
 *
 * Safety switches (all default OFF):
 *   AUTO_SMS_ENABLED=true        — without this, NO text is ever sent (leads are still created)
 *   AUTO_SMS_TEST_ONLY=+1386...  — when set, auto-texts go only to this number (for go-live testing)
 * Optional:
 *   AUTO_SMS_TEXT                — overrides the default message below
 *   AUTO_SMS_COOLDOWN_HOURS      — default 72; one auto-text per number per window
 */
import { loadLeadsStore, saveLeadsStore } from './academy-db.js';
import { sendSms } from './twilio.js';

export const DEFAULT_AUTO_SMS =
  "Hi, it's Heath with FloGuard. Sorry we missed your call! The first step is a quick form at " +
  'https://floguardfl.com/contact so we can get a good picture of the issue. ' +
  "We'll follow up shortly. Reply STOP to opt out.";

const MAX_LEADS = 20000;

export function digits10(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

export function prettyPhone(phone) {
  const d = digits10(phone);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(phone || '');
}

export function e164(phone) {
  const d = digits10(phone);
  return d.length === 10 ? `+1${d}` : String(phone || '');
}

function cleanCallerName(n) {
  const s = String(n || '').trim();
  if (!s || /^(unknown|wireless caller|anonymous|unavailable|private)/i.test(s)) return '';
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function stamp() {
  return new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Create or update the lead for this phone number. Matches on phone digits first.
 * @returns {{ lead: object, created: boolean }}
 */
export async function upsertPhoneLead({ phone, callerName, city, note, patch = {} }) {
  const d = digits10(phone);
  if (d.length < 10) throw new Error('No usable caller number');
  const store = await loadLeadsStore();
  const leads = Array.isArray(store.leads) ? store.leads.slice() : [];
  const idx = leads.findIndex((l) => digits10(l?.phone) === d);
  const line = note ? `[${stamp()}] ${note}` : '';
  let lead;
  let created = false;
  if (idx >= 0) {
    lead = { ...leads[idx], ...patch };
    if (line) lead.notes = [String(leads[idx].notes || '').trim(), line].filter(Boolean).join('\n');
    leads[idx] = lead;
  } else {
    const nextId = leads.reduce((m, l) => Math.max(m, Number(l?.id) || 0), 0) + 1;
    const name = cleanCallerName(callerName) || `Caller ${prettyPhone(d)}`;
    lead = {
      id: nextId,
      name,
      city: String(city || '').trim(),
      address: '',
      phone: prettyPhone(d),
      email: '',
      contact: name,
      industry: '',
      source: 'phone_intake',
      status: 'New',
      list: 'FrenchDrain',
      lists: ['FrenchDrain'],
      list_status: { FrenchDrain: 'New' },
      notes: line,
      created_at: new Date().toISOString(),
      ...patch,
    };
    leads.push(lead);
    created = true;
  }
  while (leads.length > MAX_LEADS) leads.shift();
  await saveLeadsStore({ ...store, leads });
  return { lead, created };
}

/**
 * Send the auto text-back once per cooldown window. Never throws; returns a reason string.
 */
export async function maybeAutoText(lead, toPhone) {
  if (process.env.AUTO_SMS_ENABLED !== 'true') return 'disabled';
  if (lead?.sms_opt_out) return 'opted_out';
  const to = e164(toPhone);
  const testOnly = process.env.AUTO_SMS_TEST_ONLY ? e164(process.env.AUTO_SMS_TEST_ONLY) : '';
  if (testOnly && to !== testOnly) return 'test_only';
  const hours = Number(process.env.AUTO_SMS_COOLDOWN_HOURS || 72);
  const last = Date.parse(lead?.last_autotext_at || '') || 0;
  if (last && Date.now() - last < hours * 3600_000) return 'cooldown';
  try {
    await sendSms({ to, body: process.env.AUTO_SMS_TEXT || DEFAULT_AUTO_SMS });
    await upsertPhoneLead({
      phone: to,
      note: 'Auto text-back sent (contact form link).',
      patch: { last_autotext_at: new Date().toISOString() },
    });
    return 'sent';
  } catch (e) {
    console.error('[phone-intake] auto text failed:', e?.message);
    return 'error';
  }
}
