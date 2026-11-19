// Review R1: api/lead-outcomes.js actions field_report / field_report_list (fsi/sql/021).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ACADEMY_SESSION_SECRET = process.env.ACADEMY_SESSION_SECRET || 'test-secret-field-reports';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
const { createSessionToken } = await import('../../server/lib/academy-db.js');
const { default: handler } = await import('../../api/lead-outcomes.js');

const amy = createSessionToken({ id: 'u1', username: 'amy' });
const bob = createSessionToken({ id: 'u2', username: 'bob' });
let ipN = 0;

// tiny PostgREST fake for parcel_field_reports
const table = [];
let missing = false;
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input));
  const method = init.method || 'GET';
  calls.push({ method, path: u.pathname, search: u.search, body: init.body, prefer: init.headers?.Prefer });
  const reply = (status, data) => new Response(data === undefined ? '' : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (missing) return reply(404, { code: 'PGRST205', message: "Could not find the table 'public.parcel_field_reports' in the schema cache" });
  if (!u.pathname.endsWith('/parcel_field_reports')) return reply(500, { message: 'unexpected ' + u.pathname });
  const p = u.searchParams;
  const eqv = (k) => (p.get(k) || '').replace(/^eq\./, '');
  const match = (r) =>
    (!p.get('parcel_id') || (p.get('parcel_id').startsWith('in.(')
      ? p.get('parcel_id').slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')).includes(r.parcel_id)
      : r.parcel_id === eqv('parcel_id'))) &&
    (!p.get('rep') || r.rep === eqv('rep')) &&
    (!p.get('withdrawn_at') || r.withdrawn_at == null);
  if (method === 'POST') {
    const [row] = JSON.parse(init.body);
    let cur = table.find((r) => r.parcel_id === row.parcel_id && r.rep === row.rep);
    if (!cur) { cur = { id: `id-${table.length + 1}`, lead_id: null, note: null, reported_at: 't0' }; table.push(cur); }
    Object.assign(cur, row, { updated_at: 't' + calls.length });
    return reply(201, [cur]);
  }
  if (method === 'PATCH') {
    const patch = JSON.parse(init.body);
    const hit = table.filter(match);
    hit.forEach((r) => Object.assign(r, patch));
    return reply(200, hit);
  }
  return reply(200, table.filter(match));
};
test.after(() => { globalThis.fetch = realFetch; });

async function call(body, token = amy) {
  const req = { method: 'POST', headers: { authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': `10.5.5.${++ipN}` }, body };
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
  await handler(req, res);
  return res;
}

test('needs a session', async () => {
  assert.equal((await call({ action: 'field_report', parcel_id: 'P-1', report: 'water_confirmed' }, null)).statusCode, 401);
});

test('records a report; rep comes from the session, not the body', async () => {
  const r = await call({ action: 'field_report', parcel_id: '6303-01-00-0420', report: 'water_confirmed', rep: 'mallory', note: 'standing water by slab', lead_id: 'L-9' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.withdrawn, false);
  assert.equal(r.body.report.rep, 'amy');
  assert.equal(r.body.report.report, 'water_confirmed');
  assert.equal(r.body.report.lead_id, 'L-9');
  const post = calls.filter((c) => c.method === 'POST').pop();
  assert.match(post.search, /on_conflict=parcel_id%2Crep|on_conflict=parcel_id,rep/);
  assert.match(post.prefer, /merge-duplicates/);
});

test('F2 aliases (water / no_problem) map to the stored values; a change overwrites, keeps lead_id/note', async () => {
  const r = await call({ action: 'field_report', parcel_id: '6303-01-00-0420', report: 'no_problem' });
  assert.equal(r.body.report.report, 'not_a_problem');
  assert.equal(r.body.report.lead_id, 'L-9', 'lead_id not cleared when omitted');
  assert.equal(r.body.report.note, 'standing water by slab');
  assert.equal(table.filter((x) => x.parcel_id === '6303-01-00-0420').length, 1);
});

test('report null withdraws only this rep\'s report', async () => {
  await call({ action: 'field_report', parcel_id: '6303-01-00-0420', report: 'water' }, bob);
  const w = await call({ action: 'field_report', parcel_id: '6303-01-00-0420', report: null });
  assert.equal(w.statusCode, 200);
  assert.equal(w.body.withdrawn, true);
  const list = await call({ action: 'field_report_list', parcel_id: '6303-01-00-0420' });
  assert.deepEqual(list.body.reports.map((x) => x.rep), ['bob']);
  const again = await call({ action: 'field_report', parcel_id: '6303-01-00-0420', report: null });
  assert.equal(again.body.withdrawn, false, 'nothing left to withdraw');
});

test('list by many parcels or mine', async () => {
  await call({ action: 'field_report', parcel_id: 'FIXTURE-002', report: 'water_confirmed' });
  const many = await call({ action: 'field_report_list', parcel_ids: ['6303-01-00-0420', 'FIXTURE-002'] });
  assert.equal(many.body.count, 2);
  const mine = await call({ action: 'field_report_list', mine: true });
  assert.deepEqual(mine.body.reports.map((x) => x.parcel_id), ['FIXTURE-002']);
});

test('validation: report value, parcel ids that could break a PostgREST filter, list size', async () => {
  assert.equal((await call({ action: 'field_report', parcel_id: 'P-1', report: 'won' })).statusCode, 400);
  for (const bad of ['', 'a,b', 'x)', '"q"', 'p*', 'a.b,or(c', 'x'.repeat(41), null]) {
    assert.equal((await call({ action: 'field_report', parcel_id: bad, report: 'water' })).statusCode, 400, JSON.stringify(bad));
  }
  assert.equal((await call({ action: 'field_report_list', parcel_ids: ['ok', 'bad,id'] })).statusCode, 400);
  assert.equal((await call({ action: 'field_report_list', parcel_ids: Array.from({ length: 201 }, (_, i) => `P${i}`) })).statusCode, 400);
  assert.equal((await call({ action: 'field_report_list' })).statusCode, 400);
});

test('021 not applied: 503 with a hint, never a 500', async () => {
  missing = true;
  try {
    const r = await call({ action: 'field_report', parcel_id: 'P-2', report: 'water' });
    assert.equal(r.statusCode, 503);
    assert.equal(r.body.error, 'field_reports_not_ready');
  } finally {
    missing = false;
  }
});

test('record (won/lost) is unchanged and still rejects field-report values as outcomes', async () => {
  const r = await call({ action: 'record', lead_key: 'k1', outcome: 'water_confirmed' });
  assert.equal(r.statusCode, 400);
});
