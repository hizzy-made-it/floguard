// The public endpoint api/leads.js also serves the marketing site's lead form.
// Adding proposal_* actions must not change a single intake behaviour.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.js';
import { setup, pub } from './helpers/setup.js';
import { makeReqRes } from '../leads/helpers/fake-supabase.js';

process.env.ACADEMY_DATA_BACKEND = 'storage'; // production setting
const fake = setup();
const { default: leadsApi } = await import('../../api/leads.js');
after(() => fake.restore());

const form = { name: 'Pat Example', email: 'pat@example.org', phone: '(386) 555-0100', message: 'Water by the slab', source: 'website' };

test('GET is 405, OPTIONS is 204', async () => {
  const g = makeReqRes({ method: 'GET' });
  await leadsApi(g.req, g.res);
  assert.equal(g.res.statusCode, 405);
  assert.deepEqual(g.res.body, { error: 'Method not allowed' });
  const o = makeReqRes({ method: 'OPTIONS' });
  await leadsApi(o.req, o.res);
  assert.equal(o.res.statusCode, 204);
});

test('invalid JSON string body is 400', async () => {
  const r = await pub(leadsApi, '{not json');
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'Invalid JSON body' });
});

test('validation errors and honeypot are unchanged', async () => {
  const a = await pub(leadsApi, { name: 'P', email: 'pat@example.org' });
  assert.equal(a.status, 400);
  assert.equal(a.body.error, 'Name is required (min 2 characters).');
  const b = await pub(leadsApi, { name: 'Pat', email: 'nope' });
  assert.equal(b.body.error, 'Valid email is required.');
  const h = await pub(leadsApi, { ...form, hp: 'bot' });
  assert.equal(h.status, 200);
  assert.deepEqual(h.body, { success: true, id: 'ok' });
});

test('a valid form is stored to web-leads.json and returns { success, id }', async () => {
  const r = await pub(leadsApi, form);
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.match(r.body.id, /^[0-9a-f]{24}$/);
  const stored = JSON.parse(fake.storage.get('floguard-academy/web-leads.json'));
  assert.equal(stored.leads.at(-1).email, 'pat@example.org');
  assert.equal(stored.leads.at(-1).id, r.body.id);
});

test('an unrelated or missing `action` field is still treated as a lead form', async () => {
  const r = await pub(leadsApi, { ...form, action: 'subscribe' });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  const r2 = await pub(leadsApi, { ...form, action: 'proposal' }); // not a proposal_* action
  assert.equal(r2.body.success, true);
});

test('intake keeps its own 12/min/IP limit, and proposal traffic does not share it', async () => {
  const ip = '198.18.0.1';
  let last;
  for (let i = 0; i < 13; i++) last = await pub(leadsApi, form, { ip });
  assert.equal(last.status, 429);
  assert.equal(last.body.error, 'Too many requests. Try again shortly.');
  const p = await pub(leadsApi, { action: 'proposal_get', token: 'a'.repeat(43) }, { ip });
  assert.equal(p.status, 404, 'proposal bucket is separate from the intake bucket');
});
