import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.js';
import { setup, seedLead, auth, pub, sentEstimate } from './helpers/setup.js';

const fake = setup();
const { default: api } = await import('../../api/academy-leads.js');
const { default: leadsApi } = await import('../../api/leads.js');
const est = await import('../../server/lib/estimates.js');
after(() => { est._setClock(null); fake.restore(); });

let L;
beforeEach(() => {
  est._setClock(null);
  est._resetEstimatesReadyCache();
  fake.tables.leads.length = 0;
  fake.tables.lead_activity.length = 0;
  fake.tables.lead_estimates.length = 0;
  fake.tables.lead_jobs.length = 0;
  L = seedLead(fake);
  process.env.ACADEMY_DATA_BACKEND = 'postgres';
});

const row = () => fake.tables.lead_estimates[0];
const acts = (event) => fake.tables.lead_activity.filter((a) => a.meta?.event === event);
const NOT_FOUND = { error: 'not_found' };
const keysDeep = (o, out = new Set()) => {
  if (Array.isArray(o)) o.forEach((x) => keysDeep(x, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); keysDeep(v, out); }
  return out;
};

test('proposal_get: customer-safe whitelist only; internal data never appears', async () => {
  const c = await auth(api, {
    action: 'estimate_create', lead_id: L.id,
    line_items: [{ catalog_id: 'french_drain_sump_system', quantity: 1, unit_price: 13000, band_override_reason: 'SECRET-BAND-REASON long run' }],
    discount: 100, discount_reason: 'SECRET-DISCOUNT-REASON', internal_notes: 'SECRET-INTERNAL-NOTE', notes_to_customer: 'Visible note',
  });
  const s = await auth(api, { action: 'estimate_send', estimate_id: c.body.estimate.id });
  const token = s.body.public_url.split('/proposal/')[1];
  const r = await pub(leadsApi, { action: 'proposal_get', token });
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.headers['x-robots-tag'], /noindex/);
  const p = r.body.proposal;
  const allowed = new Set([
    'ok', 'proposal', 'number', 'status', 'can_accept', 'business', 'name', 'tagline', 'address', 'phone', 'phone_href', 'email', 'website', 'hours', 'license_line',
    'customer', 'line_items', 'description', 'quantity', 'unit', 'unit_price', 'total', 'subtotal', 'discount', 'notes', 'included', 'disclaimers', 'terms', 'text',
    'placeholder', 'consent_text', 'valid_until', 'sent_at', 'accepted_at', 'accepted_name', 'declined_at',
  ]);
  for (const k of keysDeep(r.body)) assert.ok(allowed.has(k), `unexpected key in public response: ${k}`);
  const dump = JSON.stringify(r.body);
  for (const bad of ['SECRET-BAND-REASON', 'SECRET-DISCOUNT-REASON', 'SECRET-INTERNAL-NOTE', 'DO-NOT-LEAK', 'INTERNAL NOTE', 'fsi_score', 'claim_heat', 'website_score',
    L.id, 'mvega@example.org', '555-0142', 'band_low', 'band_override', 'internal_notes', 'public_token', token, 'accepted_ip', 'lead_id', 'org_id', 'created_by']) {
    assert.ok(!dump.includes(bad), `public response leaks: ${bad}`);
  }
  assert.equal(p.customer.name, 'Marisol Vega');
  assert.equal(p.customer.address, '412 Heron Bay Dr, Port Orange 32127');
  assert.equal(p.total, 12900);
  assert.equal(p.notes, 'Visible note');
  assert.equal(p.status, 'sent');
  assert.equal(p.can_accept, true);
  assert.equal(p.business.phone, '(386) 259-0023');
  assert.ok(p.disclaimers.some((d) => /storm surge/.test(d)));
  assert.equal(p.terms.placeholder, true);
});

test('no enumeration: unknown, malformed, draft and voided tokens all return the identical 404', async () => {
  const c = await auth(api, { action: 'estimate_create', lead_id: L.id, line_items: [{ catalog_id: 'french_drain_sump_system', unit_price: 8000 }] });
  const draftToken = row().public_token;
  const { est: e, token } = await sentEstimate(api, L);
  await auth(api, { action: 'estimate_void', estimate_id: e.id, reason: 'test void' });
  const cases = [est.mintToken(), 'short', '../../../etc/passwd', 'x'.repeat(300), '', null, draftToken, token, "' or 1=1 --" + 'a'.repeat(40)];
  const out = [];
  for (const t of cases) {
    const r = await pub(leadsApi, { action: 'proposal_get', token: t });
    assert.equal(r.status, 404, String(t));
    out.push(JSON.stringify(r.body));
  }
  assert.ok(out.every((x) => x === JSON.stringify(NOT_FOUND)));
  for (const a of ['proposal_accept', 'proposal_decline']) {
    const r = await pub(leadsApi, { action: a, token, name: 'Marisol Vega', consent: true });
    assert.deepEqual(r.body, NOT_FOUND);
  }
  assert.equal(c.status, 200);
});

test('token lookup is exact (no prefix/substring/case match)', async () => {
  const { token } = await sentEstimate(api, L);
  for (const t of [token.slice(0, 43 - 1) + (token.endsWith('A') ? 'B' : 'A'), token.toLowerCase() === token ? token.toUpperCase() : token.toLowerCase(), token + 'x']) {
    if (t === token) continue;
    const r = await pub(leadsApi, { action: 'proposal_get', token: t });
    assert.equal(r.status, 404);
  }
  assert.equal((await pub(leadsApi, { action: 'proposal_get', token })).status, 200);
});

test('first view is recorded (viewed_at, count, one activity); preview does not count', async () => {
  const { token } = await sentEstimate(api, L);
  await pub(leadsApi, { action: 'proposal_get', token, preview: true });
  assert.equal(row().viewed_at ?? null, null);
  await pub(leadsApi, { action: 'proposal_get', token });
  const first = row().viewed_at;
  assert.ok(first);
  await pub(leadsApi, { action: 'proposal_get', token });
  assert.equal(row().view_count, 2);
  assert.equal(row().viewed_at, first, 'viewed_at is the FIRST view');
  assert.equal(acts('estimate_viewed').length, 1);
  const rep = await auth(api, { action: 'estimate_get', estimate_id: row().id });
  assert.equal(rep.body.estimate.viewed_at, first);
  assert.equal(rep.body.estimate.view_count, 2);
});

test('accept: needs consent and a full name; records name, time, IP, user-agent, consent wording; lead becomes won', async () => {
  const { token } = await sentEstimate(api, L);
  const noConsent = await pub(leadsApi, { action: 'proposal_accept', token, name: 'Marisol Vega' });
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.body.error, 'consent_required');
  const strict = await pub(leadsApi, { action: 'proposal_accept', token, name: 'Marisol Vega', consent: 'true' });
  assert.equal(strict.body.error, 'consent_required', 'consent must be boolean true');
  for (const n of ['', 'M', 'Marisol', '   ']) {
    const r = await pub(leadsApi, { action: 'proposal_accept', token, name: n, consent: true });
    assert.equal(r.body.error, 'full_name_required', JSON.stringify(n));
  }
  assert.equal(row().status, 'sent');
  const r = await pub(leadsApi, { action: 'proposal_accept', token, name: '  Marisol   Vega ', consent: true }, { ip: '198.51.100.7', ua: 'Mozilla/5.0 (iPhone) Test' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.already_accepted, false);
  assert.equal(r.body.proposal.status, 'accepted');
  assert.equal(r.body.proposal.can_accept, false);
  const d = row();
  assert.equal(d.status, 'accepted');
  assert.equal(d.accepted_name, 'Marisol Vega');
  assert.equal(d.accepted_ip, '198.51.100.7');
  assert.equal(d.accepted_ua, 'Mozilla/5.0 (iPhone) Test');
  assert.match(d.accepted_consent_text, /accept it/);
  assert.ok(d.accepted_at);
  assert.equal(fake.tables.leads[0].stage, 'won');
  assert.equal(acts('estimate_accepted').length, 1);
  assert.ok(fake.tables.lead_activity.some((a) => a.type === 'stage_change' && a.meta.to === 'won' && a.actor === 'customer'));
  assert.ok(!JSON.stringify(r.body).includes('198.51.100.7'), 'IP is not echoed to the customer');
});

test('accept is idempotent: same record, no duplicate side effects, a second name cannot overwrite', async () => {
  const { token } = await sentEstimate(api, L);
  const a = await pub(leadsApi, { action: 'proposal_accept', token, name: 'Marisol Vega', consent: true });
  const at = row().accepted_at;
  const b = await pub(leadsApi, { action: 'proposal_accept', token, name: 'Someone Else', consent: true });
  assert.equal(b.status, 200);
  assert.equal(b.body.already_accepted, true);
  assert.equal(b.body.accepted_name, 'Marisol Vega');
  assert.equal(row().accepted_at, at);
  assert.equal(row().accepted_name, 'Marisol Vega');
  assert.equal(acts('estimate_accepted').length, 1);
  const c = await pub(leadsApi, { action: 'proposal_accept', token, name: '', consent: false });
  assert.equal(c.body.already_accepted, true, 'a repeat click with a bad body still reports the existing acceptance');
  assert.equal(a.status, 200);
});

test('accept: concurrent double submit produces exactly one acceptance', async () => {
  const { token } = await sentEstimate(api, L);
  const rs = await Promise.all([1, 2, 3].map((i) => pub(leadsApi, { action: 'proposal_accept', token, name: `Marisol Vega${i === 1 ? '' : ' Jr'}`, consent: true })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(rs.filter((r) => r.body.already_accepted === false).length >= 1, true);
  assert.equal(acts('estimate_accepted').length, 1);
});

test('expired: cannot accept or decline (410), view still shows expired; accepted estimates never expire', async () => {
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const { token } = await sentEstimate(api, L, { validUntil: tomorrow });
  est._setClock(() => new Date(Date.now() + 5 * 86400e3));
  const g = await pub(leadsApi, { action: 'proposal_get', token });
  assert.equal(g.body.proposal.status, 'expired');
  assert.equal(g.body.proposal.can_accept, false);
  const a = await pub(leadsApi, { action: 'proposal_accept', token, name: 'Marisol Vega', consent: true });
  assert.equal(a.status, 410);
  assert.equal(a.body.error, 'expired');
  assert.equal(row().status, 'sent');
  const d = await pub(leadsApi, { action: 'proposal_decline', token });
  assert.equal(d.status, 410);
  est._setClock(null);
  const ok = await pub(leadsApi, { action: 'proposal_accept', token, name: 'Marisol Vega', consent: true });
  assert.equal(ok.status, 200);
  est._setClock(() => new Date(Date.now() + 400 * 86400e3));
  const later = await pub(leadsApi, { action: 'proposal_get', token });
  assert.equal(later.body.proposal.status, 'accepted');
});

test('expiry boundary: still acceptable on valid_until day, expired the day after', async () => {
  const today = est.todayNY();
  const { token } = await sentEstimate(api, L, { validUntil: today });
  assert.equal((await pub(leadsApi, { action: 'proposal_get', token })).body.proposal.status, 'sent');
  est._setClock(() => new Date(Date.now() + 36 * 3600e3));
  assert.equal((await pub(leadsApi, { action: 'proposal_get', token })).body.proposal.status, 'expired');
});

test('void: a voided estimate returns the same 404 and cannot be accepted', async () => {
  const { est: e, token } = await sentEstimate(api, L);
  await auth(api, { action: 'estimate_void', estimate_id: e.id, reason: 'Wrong address' });
  const r = await pub(leadsApi, { action: 'proposal_accept', token, name: 'Marisol Vega', consent: true });
  assert.equal(r.status, 404);
  assert.equal(row().status, 'sent');
  assert.equal(fake.tables.leads[0].stage, 'estimate_sent');
});

test('decline: recorded with reason, idempotent, blocks later acceptance; accepted blocks decline', async () => {
  const { token } = await sentEstimate(api, L);
  const d = await pub(leadsApi, { action: 'proposal_decline', token, reason: 'Went with someone else' });
  assert.equal(d.status, 200);
  assert.equal(d.body.already_declined, false);
  assert.equal(row().status, 'declined');
  assert.equal(row().decline_reason, 'Went with someone else');
  assert.equal(acts('estimate_declined').length, 1);
  const d2 = await pub(leadsApi, { action: 'proposal_decline', token, reason: 'again' });
  assert.equal(d2.body.already_declined, true);
  assert.equal(acts('estimate_declined').length, 1);
  const a = await pub(leadsApi, { action: 'proposal_accept', token, name: 'Marisol Vega', consent: true });
  assert.equal(a.status, 409);
  assert.equal(a.body.error, 'already_declined');
  assert.equal(fake.tables.leads[0].stage, 'estimate_sent', 'decline does not move the stage');

  fake.tables.lead_estimates.length = 0;
  const { token: t2 } = await sentEstimate(api, L);
  await pub(leadsApi, { action: 'proposal_accept', token: t2, name: 'Marisol Vega', consent: true });
  const d3 = await pub(leadsApi, { action: 'proposal_decline', token: t2 });
  assert.equal(d3.status, 409);
  assert.equal(d3.body.error, 'already_accepted');
});

test('rate limit: per IP (reads), per IP (writes), per token, and guess throttling', async () => {
  const { token } = await sentEstimate(api, L);
  // reads: 30/min/IP
  let last;
  for (let i = 0; i < 31; i++) last = await pub(leadsApi, { action: 'proposal_get', token, preview: true }, { ip: '192.0.2.10' });
  assert.equal(last.status, 429);
  assert.ok(last.headers['retry-after']);
  // writes: 6/min/IP, reported before the token is even looked at
  for (let i = 0; i < 7; i++) last = await pub(leadsApi, { action: 'proposal_accept', token, name: 'x', consent: true }, { ip: '192.0.2.11' });
  assert.equal(last.status, 429);
  // per token: 20 reads/min across many IPs
  for (let i = 0; i < 21; i++) last = await pub(leadsApi, { action: 'proposal_get', token, preview: true }, { ip: `192.0.2.${100 + i}` });
  assert.equal(last.status, 429, 'token bucket trips even when each IP is under its own limit');
  // per token writes: 10/min across many IPs
  const { token: t2 } = await sentEstimate(api, L);
  for (let i = 0; i < 11; i++) last = await pub(leadsApi, { action: 'proposal_accept', token: t2, name: 'x', consent: true }, { ip: `192.0.2.${150 + i}` });
  assert.equal(last.status, 429, 'token write bucket trips');
  // guessing: repeated misses from one IP are throttled long before 30/min
  const results = [];
  for (let i = 0; i < 12; i++) results.push((await pub(leadsApi, { action: 'proposal_get', token: est.mintToken() }, { ip: '192.0.2.12' })).status);
  assert.deepEqual(results.slice(0, 8), Array(8).fill(404));
  assert.ok(results.slice(8).every((s) => s === 429), JSON.stringify(results));
});

test('CORS: same allowlist as the rest of the endpoint', async () => {
  const { token } = await sentEstimate(api, L);
  const ok = await pub(leadsApi, { action: 'proposal_get', token, preview: true }, { origin: 'https://crm.floguardfl.com' });
  assert.equal(ok.headers['access-control-allow-origin'], 'https://crm.floguardfl.com');
  const evil = await pub(leadsApi, { action: 'proposal_get', token, preview: true }, { origin: 'https://evil.example' });
  assert.notEqual(evil.headers['access-control-allow-origin'], 'https://evil.example');
  assert.ok(!('access-control-allow-credentials' in ok.headers));
});

test('token is never logged, even on errors', async () => {
  const { token } = await sentEstimate(api, L);
  const logs = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.map(String).join(' '));
  try {
    await pub(leadsApi, { action: 'proposal_get', token });
    await pub(leadsApi, { action: 'proposal_accept', token, name: 'x', consent: true });
    const real = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network down'); };
    est._resetEstimatesReadyCache();
    const r = await pub(leadsApi, { action: 'proposal_get', token });
    globalThis.fetch = real;
    assert.ok([404, 500].includes(r.status));
    assert.ok(!JSON.stringify(r.body).includes(token));
  } finally {
    Object.assign(console, orig);
    est._resetEstimatesReadyCache();
  }
  assert.ok(logs.every((l) => !l.includes(token)), logs.join('\n'));
});

test('storage backend: proposal actions answer the generic 404', async () => {
  const { token } = await sentEstimate(api, L);
  process.env.ACADEMY_DATA_BACKEND = 'storage';
  const r = await pub(leadsApi, { action: 'proposal_get', token });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, NOT_FOUND);
});

test('proposal actions need no login and expose no auth: the secret header is irrelevant', async () => {
  const { token } = await sentEstimate(api, L);
  const r = await pub(leadsApi, { action: 'proposal_get', token, preview: true });
  assert.equal(r.status, 200);
});
