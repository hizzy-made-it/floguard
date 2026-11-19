import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ACADEMY_SYNC_SECRET = 'test-secret';
process.env.ACADEMY_DATA_BACKEND = 'storage';

const { installFakeSupabase, callHandler } = await import('./helpers/fake-supabase.js');
const fake = installFakeSupabase();
const { default: handler } = await import('../../api/academy-leads.js');
after(() => fake.restore());

const call = (body, opts) => callHandler(handler, body, opts);
const blob = () => JSON.parse(fake.storage.get('floguard-academy/leads.json') || '{"leads":[]}').leads;

test('list on an empty blob keeps the legacy shape', async () => {
  const r = await call({ action: 'list' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { leads: [], count: 0, updated_at: null });
});

test('push assigns numeric ids and returns { ok, count, added, merged, updated_at }', async () => {
  const r = await call({ action: 'push', leads: [{ name: 'A Co', city: 'X', phone: '1' }, { name: 'B Co', city: 'Y' }, { name: '' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.count, 2);
  assert.equal(r.body.added, 2);
  assert.equal(r.body.merged, 0);
  assert.ok(r.body.updated_at);
  assert.deepEqual(blob().map((l) => l.id), [1, 2]);
  assert.equal(blob()[0].stage, 'new');
});

test('merge by legacy key; empty never clears; lists union; id/name/city never overwritten', async () => {
  const r = await call({ action: 'bulk_upsert', leads: [{ id: 77, name: 'a co', city: 'x', phone: '', website: 'a.com', lists: ['FrenchDrain'], list: 'FrenchDrain' }] });
  assert.equal(r.body.added, 0);
  assert.equal(r.body.merged, 1);
  const a = blob()[0];
  assert.equal(a.phone, '1');
  assert.equal(a.website, 'a.com');
  assert.equal(a.id, 1);
  assert.equal(a.name, 'A Co');
  assert.deepEqual(a.lists, ['FrenchDrain']);
});

test('two different owners with the same name in the same city no longer collapse when addresses differ', async () => {
  await call({ action: 'push', leads: [{ name: 'John Smith', city: 'Ormond Beach', address: '12 Oak St' }] });
  await call({ action: 'push', leads: [{ name: 'John Smith', city: 'Ormond Beach', address: '99 Pine Ave' }] });
  assert.equal(blob().filter((l) => l.name === 'John Smith').length, 2);
  await call({ action: 'push', leads: [{ name: 'John Smith', city: 'Ormond Beach', address: '12 Oak Street', notes: 'same man' }] });
  assert.equal(blob().filter((l) => l.name === 'John Smith').length, 2);
  assert.equal(blob().find((l) => l.notes === 'same man').name, 'John Smith');
  assert.equal(blob().filter((l) => l.notes === 'same man').length, 1);
});

test('DNC is sticky through the blob path too', async () => {
  await call({ action: 'push', leads: [{ name: 'Do Not Call', city: 'X', phone: '386', phone_dnc: true }] });
  await call({ action: 'push', leads: [{ name: 'Do Not Call', city: 'X', phone: '386', phone_dnc: false }] });
  await call({ action: 'push', leads: [{ name: 'Do Not Call', city: 'X', phone: '386' }] });
  assert.equal(blob().find((l) => l.name === 'Do Not Call').phone_dnc, true);
});

test('an unchanged push does not rewrite the blob', async () => {
  const writes = () => fake.calls.filter((c) => c.method !== 'GET' && c.path.includes('leads.json')).length;
  const before = writes();
  const r = await call({ action: 'push', leads: blob() });
  assert.equal(r.status, 200);
  assert.equal(writes(), before);
  assert.equal(r.body.added, 0);
});

test('replace is secret-only and overwrites the blob exactly', async () => {
  assert.equal((await call({ action: 'replace', leads: [] }, { secret: 'bad', token: 'bad' })).status, 401);
  const r = await call({ action: 'replace', leads: [{ id: 5, name: 'Only', city: 'One' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 1);
  assert.deepEqual(blob().map((l) => l.name), ['Only']);
});

test('prune_placeholders keeps its legacy shape', async () => {
  await call({ action: 'push', leads: [{ name: 'Pest prospect — Daytona', city: 'x', notes: 'Category seed: y' }] });
  const r = await call({ action: 'prune_placeholders' });
  assert.equal(r.body.removed, 1);
  assert.ok(Array.isArray(r.body.leads));
});

test('pipeline-only actions fail loudly with 501 postgres_backend_required, never a silent no-op', async () => {
  for (const body of [
    { action: 'get', lead_id: '1' }, { action: 'patch', lead_id: '1', patch: { notes: 'x' } }, { action: 'delete', lead_id: '1' },
    { action: 'activity_add', lead_id: '1', type: 'note' }, { action: 'activity_list', lead_id: '1' },
    { action: 'task_add', lead_id: '1', due_at: '2026-11-20T00:00:00Z' }, { action: 'task_done', task_id: 'x' },
    { action: 'tasks_due' }, { action: 'funnel' }, { action: 'list', since: '2026-01-01T00:00:00Z' }, { action: 'list', limit: 10 },
  ]) {
    const r = await call(body);
    assert.equal(r.status, 501, JSON.stringify(body));
    assert.equal(r.body.error, 'postgres_backend_required');
  }
  assert.equal(fake.calls.filter((c) => c.path.startsWith('/rest/v1/leads')).length, 0, 'storage mode never touches the leads table');
});
