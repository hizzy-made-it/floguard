import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.js';
import { setup, seedLead, auth, LINE, sentEstimate } from './helpers/setup.js';

const fake = setup();
const { default: api } = await import('../../api/academy-leads.js');
const est = await import('../../server/lib/estimates.js');
after(() => { est._setClock(null); fake.restore(); });

const lead = () => fake.tables.leads.find((l) => l.name === 'Marisol Vega');
const acts = (leadId, event) => fake.tables.lead_activity.filter((a) => a.lead_id === leadId && (!event || a.meta?.event === event));
let L;
beforeEach(() => {
  est._resetEstimatesReadyCache();
  fake.tables.leads.length = 0;
  fake.tables.lead_activity.length = 0;
  fake.tables.lead_estimates.length = 0;
  fake.tables.lead_jobs.length = 0;
  L = seedLead(fake);
  process.env.ACADEMY_DATA_BACKEND = 'postgres';
});

test('auth: estimate actions need a session or the sync secret', async () => {
  const r = await auth(api, { action: 'estimate_list', lead_id: L.id }, { secret: 'wrong' });
  assert.equal(r.status, 401);
});

test('create: totals computed server-side, client totals ignored, draft status, customer snapshot, activity', async () => {
  const r = await auth(api, {
    action: 'estimate_create', lead_id: L.id, subtotal: 1, total: 1,
    line_items: [LINE({ quantity: 2, unit_price: 5000, total: 3 })], discount: 250, discount_reason: 'repeat customer',
    notes_to_customer: 'Gate code is on file.', internal_notes: 'rep only',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const e = r.body.estimate;
  assert.equal(e.status, 'draft');
  assert.equal(e.subtotal, 10000);
  assert.equal(e.total, 9750);
  assert.equal(e.line_items[0].total, 10000);
  assert.equal(e.customer.name, 'Marisol Vega');
  assert.equal(e.customer.address, '412 Heron Bay Dr, Port Orange 32127');
  assert.equal(e.public_url, null, 'no public url while draft');
  assert.match(e.number, /^FG-\d{4}-0001$/);
  assert.equal(acts(L.id, 'estimate_created').length, 1);
  assert.equal(fake.tables.lead_estimates[0].org_id, L.org_id);
  assert.equal(r.body.proposal.status, 'draft');
});

test('create: out-of-band price is rejected without a reason, accepted with one', async () => {
  const bad = await auth(api, { action: 'estimate_create', lead_id: L.id, line_items: [LINE({ unit_price: 20000 })] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'band_override_required');
  const ok = await auth(api, { action: 'estimate_create', lead_id: L.id, line_items: [LINE({ unit_price: 20000, band_override_reason: 'Two systems worth of trench, owner ok' })] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.estimate.out_of_band, true);
});

test('numbering: sequential per org and year, no gaps or reuse', async () => {
  const nums = [];
  for (let i = 0; i < 4; i++) {
    const r = await auth(api, { action: 'estimate_create', lead_id: L.id, line_items: [LINE()] });
    nums.push(r.body.estimate.number);
  }
  const y = est.todayNY().slice(0, 4);
  assert.deepEqual(nums, [1, 2, 3, 4].map((n) => `FG-${y}-${String(n).padStart(4, '0')}`));
});

test('numbering: a unique-index collision (concurrent create) is retried, never duplicated', async () => {
  const y = est.todayNY().slice(0, 4);
  const real = globalThis.fetch;
  let hit = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === 'string' ? input : input.url);
    if ((init.method || 'GET') === 'POST' && url.includes('/rest/v1/lead_estimates') && hit++ === 0) {
      return new Response(JSON.stringify({ message: 'duplicate key value violates unique constraint "lead_estimates_number_uidx"', code: '23505' }), { status: 409 });
    }
    return real(input, init);
  };
  try {
    const r = await auth(api, { action: 'estimate_create', lead_id: L.id, line_items: [LINE()] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.estimate.number, `FG-${y}-0001`);
    assert.equal(fake.tables.lead_estimates.length, 1);
  } finally {
    globalThis.fetch = real;
  }
});

test('numbering: a new year restarts at 0001 and old-format numbers are ignored', async () => {
  fake.tables.lead_estimates.push({ id: 'x', number: 'FG-2025-0099', org_id: L.org_id });
  fake.tables.lead_estimates.push({ id: 'y', number: 'E-1001', org_id: L.org_id });
  const r = await auth(api, { action: 'estimate_create', lead_id: L.id, line_items: [LINE()] });
  assert.match(r.body.estimate.number, new RegExp(`^FG-${est.todayNY().slice(0, 4)}-0001$`));
});

test('update: drafts only; recomputes totals; conflict on stale updated_at', async () => {
  const c = await auth(api, { action: 'estimate_create', lead_id: L.id, line_items: [LINE()] });
  const id = c.body.estimate.id;
  const u = await auth(api, { action: 'estimate_update', estimate_id: id, line_items: [LINE({ unit_price: 6500 })], updated_at: c.body.estimate.updated_at });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(u.body.estimate.total, 6500);
  const stale = await auth(api, { action: 'estimate_update', estimate_id: id, notes_to_customer: 'x', updated_at: c.body.estimate.updated_at });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'conflict');
  await auth(api, { action: 'estimate_send', estimate_id: id });
  const after = await auth(api, { action: 'estimate_update', estimate_id: id, notes_to_customer: 'late edit' });
  assert.equal(after.status, 409);
  assert.equal(after.body.error, 'not_draft');
});

test('send: mints a 43-char token, sets valid_until, returns url + copy-ready message + links, moves stage, writes activity', async () => {
  const c = await auth(api, { action: 'estimate_create', lead_id: L.id, line_items: [LINE()] });
  const draftToken = fake.tables.lead_estimates[0].public_token;
  const r = await auth(api, { action: 'estimate_send', estimate_id: c.body.estimate.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = fake.tables.lead_estimates[0];
  assert.notEqual(row.public_token, draftToken, 'token is minted at send');
  assert.match(row.public_token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.body.public_url, `https://crm.example.test/proposal/${row.public_token}`);
  assert.equal(row.status, 'sent');
  assert.ok(row.valid_until > est.todayNY(), 'valid_until is in the future');
  assert.match(r.body.message.body, /FG-/);
  assert.ok(r.body.links.mailto.startsWith('mailto:mvega@example.org'));
  assert.ok(r.body.links.sms.startsWith('sms:3865550142'));
  assert.ok(r.body.warnings.includes('terms_placeholder'));
  assert.equal(lead().stage, 'estimate_sent');
  assert.equal(lead().pipeline_status, 'follow_up');
  assert.equal(acts(L.id, 'estimate_sent').length, 1);
  assert.equal(acts(L.id).filter((a) => a.type === 'stage_change' && a.meta.to === 'estimate_sent').length, 1);
  // nothing was emailed or texted: the only network traffic is the fake Supabase (PostgREST/Storage)
  assert.ok(fake.calls.every((x) => x.path.startsWith('/rest/v1/') || x.path.startsWith('/storage/v1/')));
});

test('send: does not regress a won lead; refuses empty estimates; DNC blocks the sms link', async () => {
  const empty = await auth(api, { action: 'estimate_create', lead_id: L.id, line_items: [] });
  const bad = await auth(api, { action: 'estimate_send', estimate_id: empty.body.estimate.id });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'estimate_incomplete');
  fake.tables.leads[0].stage = 'won';
  fake.tables.leads[0].phone_dnc = true;
  const { est: e } = await sentEstimate(api, L);
  assert.equal(lead().stage, 'won');
  const g = await auth(api, { action: 'estimate_send', estimate_id: e.id, valid_until: est.todayNY().slice(0, 4) + '-12-30' });
  assert.equal(g.body.links.sms, null);
  assert.ok(g.body.warnings.includes('phone_dnc'));
});

test('send: re-send keeps the same token (old link still works); valid_until can be extended', async () => {
  const { est: e, token } = await sentEstimate(api, L);
  const later = new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
  const r = await auth(api, { action: 'estimate_send', estimate_id: e.id, valid_until: later });
  assert.equal(r.status, 200);
  assert.equal(fake.tables.lead_estimates[0].public_token, token);
  assert.equal(r.body.estimate.valid_until, later);
  assert.equal(acts(L.id, 'estimate_resent').length, 1);
});

test('void: link dies, reason required, accepted estimates cannot be voided, idempotent', async () => {
  const { est: e } = await sentEstimate(api, L);
  const noReason = await auth(api, { action: 'estimate_void', estimate_id: e.id });
  assert.equal(noReason.status, 400);
  const v = await auth(api, { action: 'estimate_void', estimate_id: e.id, reason: 'Customer changed scope' });
  assert.equal(v.status, 200);
  assert.equal(v.body.estimate.status, 'void');
  assert.equal(v.body.estimate.public_url, null);
  assert.equal(acts(L.id, 'estimate_voided').length, 1);
  const again = await auth(api, { action: 'estimate_void', estimate_id: e.id, reason: 'again' });
  assert.equal(again.body.already_void, true);
  const send = await auth(api, { action: 'estimate_send', estimate_id: e.id });
  assert.equal(send.status, 409);
  const e2 = await sentEstimate(api, L);
  fake.tables.lead_estimates.find((r) => r.id === e2.est.id).status = 'accepted';
  const noVoid = await auth(api, { action: 'estimate_void', estimate_id: e2.est.id, reason: 'oops' });
  assert.equal(noVoid.status, 409);
  assert.equal(noVoid.body.error, 'already_accepted');
});

test('list/get: by lead, newest first; get returns proposal preview and job', async () => {
  const a = await sentEstimate(api, L);
  await auth(api, { action: 'estimate_create', lead_id: L.id, line_items: [LINE()] });
  const r = await auth(api, { action: 'estimate_list', lead_id: L.id });
  assert.equal(r.body.estimates.length, 2);
  assert.ok(r.body.estimates[0].created_at >= r.body.estimates[1].created_at);
  const g = await auth(api, { action: 'estimate_get', estimate_id: a.est.id });
  assert.equal(g.body.estimate.id, a.est.id);
  assert.equal(g.body.job, null);
  assert.equal(g.body.proposal.number, a.est.number);
  const nf = await auth(api, { action: 'estimate_get', estimate_id: '11111111-1111-4111-8111-111111111111' });
  assert.equal(nf.status, 404);
});

test('job + invoice record: needs acceptance, idempotent, schedule/status/completion, invoice record only', async () => {
  const { est: e } = await sentEstimate(api, L, { price: 9000 });
  const early = await auth(api, { action: 'job_create_from_estimate', estimate_id: e.id });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'not_accepted');
  fake.tables.lead_estimates[0].status = 'accepted';
  fake.tables.lead_estimates[0].accepted_at = '2026-11-20T10:00:00Z';
  const sched = '2026-12-02T14:00:00.000Z';
  const j = await auth(api, { action: 'job_create_from_estimate', estimate_id: e.id, scheduled_for: sched, notes: 'Gate code 1234' });
  assert.equal(j.status, 200, JSON.stringify(j.body));
  assert.equal(j.body.job.status, 'scheduled');
  assert.equal(j.body.job.scheduled_for, sched);
  assert.equal(j.body.suggested_invoice_total, 9000);
  const j2 = await auth(api, { action: 'job_create_from_estimate', estimate_id: e.id });
  assert.equal(j2.body.already_exists, true);
  assert.equal(fake.tables.lead_jobs.length, 1);

  const id = j.body.job.id;
  const up = await auth(api, { action: 'job_update', job_id: id, status: 'in_progress', scheduled_for: '2026-12-03T14:00:00Z' });
  assert.equal(up.body.job.status, 'in_progress');
  const done = await auth(api, { action: 'job_update', job_id: id, status: 'complete' });
  assert.equal(done.body.job.status, 'complete');
  assert.ok(done.body.job.completed_at, 'completion stamped');
  const badStatus = await auth(api, { action: 'job_update', job_id: id, status: 'banana' });
  assert.equal(badStatus.status, 400);

  const sent = await auth(api, { action: 'invoice_mark', job_id: id, invoice_number: 'INV-1001', invoice_status: 'sent' });
  assert.equal(sent.body.job.invoice_status, 'sent');
  assert.ok(sent.body.job.invoice_sent_at);
  assert.equal(sent.body.job.invoice_total, 9000, 'defaults to the estimate total');
  assert.match(sent.body.note, /Record only/);
  const paid = await auth(api, { action: 'invoice_mark', job_id: id, invoice_status: 'paid', invoice_total: 8750.5 });
  assert.equal(paid.body.job.invoice_status, 'paid');
  assert.ok(paid.body.job.paid_at);
  assert.equal(paid.body.job.invoice_total, 8750.5);
  assert.ok(acts(L.id, 'job_created').length === 1 && acts(L.id, 'invoice_marked').length === 2);

  const list = await auth(api, { action: 'jobs_list' });
  assert.equal(list.body.jobs.length, 1);
  assert.equal(list.body.jobs[0].estimate_number, e.number);
  assert.equal(list.body.jobs[0].lead_name, 'Marisol Vega');
  const filtered = await auth(api, { action: 'jobs_list', status: 'scheduled' });
  assert.equal(filtered.body.jobs.length, 0);
});

test('invoice_mark never accepts payment details', async () => {
  const { est: e } = await sentEstimate(api, L);
  fake.tables.lead_estimates[0].status = 'accepted';
  const j = await auth(api, { action: 'job_create_from_estimate', estimate_id: e.id });
  const id = j.body.job.id;
  for (const extra of [{ card_number: '4242424242424242' }, { cvv: '123' }, { routing_number: '021000021' }, { bank_account: '1' }]) {
    const r = await auth(api, { action: 'invoice_mark', job_id: id, invoice_status: 'paid', ...extra });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(r.body.error, 'payment_data_not_accepted');
  }
  const n = await auth(api, { action: 'job_update', job_id: id, notes: 'paid with 4242 4242 4242 4242' });
  assert.equal(n.status, 400);
  const inv = await auth(api, { action: 'invoice_mark', job_id: id, invoice_number: '4242424242424242' });
  assert.equal(inv.status, 400);
  assert.equal(fake.tables.lead_jobs[0].invoice_status ?? 'unbilled', 'unbilled');
});

test('storage backend: every estimate action returns 501 postgres_backend_required', async () => {
  process.env.ACADEMY_DATA_BACKEND = 'storage';
  for (const action of ['estimate_create', 'estimate_update', 'estimate_list', 'estimate_get', 'estimate_send', 'estimate_void', 'estimate_catalog', 'job_create_from_estimate', 'job_update', 'invoice_mark', 'jobs_list']) {
    const r = await auth(api, { action, lead_id: L.id });
    assert.equal(r.status, 501, action);
    assert.equal(r.body.error, 'postgres_backend_required', action);
  }
});

test('postgres backend without 017 pipeline: 503 leads_pipeline_not_ready (same as C)', async () => {
  const pg = await import('../../server/lib/academy-pg.js');
  const f1 = globalThis.fetch;
  const f2 = (await import('../leads/helpers/fake-supabase.js')).installFakeSupabase({ pipelineReady: false });
  pg._resetLeadsReadyCache();
  const r = await auth(api, { action: 'estimate_list', lead_id: 'x' });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'leads_pipeline_not_ready');
  f2.restore();
  globalThis.fetch = f1; // back to the main fake for the next tests
  pg._resetLeadsReadyCache();
});

test('020 not applied: estimates_not_ready 503 with a pointer to the SQL files', async () => {
  const saved = fake.tables.lead_jobs;
  delete fake.tables.lead_jobs;
  est._resetEstimatesReadyCache();
  const r = await auth(api, { action: 'estimate_list', lead_id: L.id });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'estimates_not_ready');
  assert.match(r.body.detail, /020_estimates_additions/);
  fake.tables.lead_jobs = saved;
  est._resetEstimatesReadyCache();
});
