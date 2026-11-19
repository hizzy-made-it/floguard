import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ACADEMY_SYNC_SECRET = 'test-secret';

const { installFakeSupabase, callHandler } = await import('./helpers/fake-supabase.js');
const fake = installFakeSupabase({ pipelineReady: false });
const { default: handler } = await import('../../api/academy-leads.js');
const pg = await import('../../server/lib/academy-pg.js');
after(() => fake.restore());

const call = (body) => callHandler(handler, body);
const blob = () => JSON.parse(fake.storage.get('floguard-academy/leads.json') || '{"leads":[]}').leads;
const mode = (m, ready) => {
  process.env.ACADEMY_DATA_BACKEND = m;
  fake.pipelineReady = ready;
  pg._resetLeadsReadyCache();
};

test('postgres mode without 017 applied: clear 503, not a silent fallback', async () => {
  mode('postgres', false);
  const r = await call({ action: 'list' });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'leads_pipeline_not_ready');
});

test('auto mode: blob until 017 is applied, then Postgres', async () => {
  mode('auto', false);
  let r = await call({ action: 'push', leads: [{ name: 'Auto One', city: 'X' }] });
  assert.equal(r.status, 200);
  assert.equal(blob().length, 1);
  assert.equal(fake.tables.leads.length, 0);
  assert.equal((await call({ action: 'funnel' })).status, 501);

  mode('auto', true);
  r = await call({ action: 'push', leads: [{ name: 'Auto Two', city: 'X' }] });
  assert.equal(r.status, 200);
  assert.equal(fake.tables.leads.length, 1);
  assert.equal(blob().length, 1, 'auto does not keep writing the blob');
  assert.equal((await call({ action: 'funnel' })).status, 200);
});

test('dual mode writes Postgres and mirrors the blob; pipeline actions work', async () => {
  mode('dual', true);
  const r = await call({ action: 'push', leads: [{ name: 'Dual One', city: 'Y', phone: '386' }] });
  assert.equal(r.status, 200);
  assert.ok(fake.tables.leads.some((l) => l.name === 'Dual One'));
  assert.ok(blob().some((l) => l.name === 'Dual One'), 'blob mirrors Postgres');
  const row = fake.tables.leads.find((l) => l.name === 'Dual One');
  const p = await call({ action: 'patch', lead_id: row.id, patch: { notes: 'patched' } });
  assert.equal(p.status, 200);
  assert.equal(blob().find((l) => l.name === 'Dual One').notes, 'patched');
});

test('dual mode before 017: blob only, pipeline actions 501', async () => {
  mode('dual', false);
  const r = await call({ action: 'push', leads: [{ name: 'Dual Pre', city: 'Z' }] });
  assert.equal(r.status, 200);
  assert.ok(blob().some((l) => l.name === 'Dual Pre'));
  assert.equal((await call({ action: 'tasks_due' })).status, 501);
});

test('academy-db loadLeadsStore/saveLeadsStore (used by web-leads, backfill) work on the pipeline', async () => {
  mode('postgres', true);
  const db = await import('../../server/lib/academy-db.js');
  const store = await db.loadLeadsStore();
  const n = store.leads.length;
  store.leads.push({ name: 'From Web Form', city: 'Q', email: 'a@b.co', status: 'new', source: 'web_form', id: 'web_abc' });
  await db.saveLeadsStore(store);
  const again = await db.loadLeadsStore();
  assert.equal(again.leads.length, n + 1);
  const web = again.leads.find((l) => l.name === 'From Web Form');
  assert.equal(web.id, 'web_abc', 'non-numeric legacy ids survive');
  // saving the same full set again changes nothing and deletes nothing
  await db.saveLeadsStore(again);
  assert.equal((await db.loadLeadsStore()).leads.length, n + 1);
});

test('full-set save does not clobber an edit made after the set was loaded', async () => {
  mode('postgres', true);
  const db = await import('../../server/lib/academy-db.js');
  const store = await db.loadLeadsStore();
  const target = store.leads.find((l) => l.name === 'From Web Form');
  const row = fake.tables.leads.find((l) => l.id === target.uuid);
  // another writer edits the lead after our load
  await callHandler(handler, { action: 'patch', lead_id: target.uuid, patch: { notes: 'edited meanwhile', stage: 'contacted' } });
  // we modify a different lead and save the stale full set
  store.leads.find((l) => l.name === 'Auto Two').notes = 'caller change';
  await db.saveLeadsStore(store);
  assert.equal(row.notes, 'edited meanwhile');
  assert.equal(row.stage, 'contacted');
  assert.equal(fake.tables.leads.find((l) => l.name === 'Auto Two').notes, 'caller change');
});
