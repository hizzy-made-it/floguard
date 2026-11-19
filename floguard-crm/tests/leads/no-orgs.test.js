// Review R1: production has NO public.organizations (and no desk_users/activities/practice tables).
// 017 takes the create-from-scratch path; the leads pipeline must work single-tenant (org_id null),
// and ACADEMY_DATA_BACKEND=postgres must not take login (users store) down.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ACADEMY_SYNC_SECRET = 'test-secret';
process.env.ACADEMY_SESSION_SECRET = 'test-session-secret-no-orgs';
process.env.ACADEMY_DATA_BACKEND = 'postgres';

const { installFakeSupabase, callHandler } = await import('./helpers/fake-supabase.js');
const fake = installFakeSupabase();
delete fake.tables.organizations; // production state (pre-flight 2026-11-19)
const { default: handler } = await import('../../api/academy-leads.js');
const db = await import('../../server/lib/academy-db.js');

after(() => fake.restore());
const call = (body) => callHandler(handler, body);

test('leads pipeline works with no organizations table: rows unscoped (org_id null), no org filter', async () => {
  let r = await call({ action: 'push', leads: [{ name: 'Solo Org Lead', city: 'Deltona', phone: '(386) 555-0700' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = fake.tables.leads.find((l) => l.name === 'Solo Org Lead');
  assert.ok(row);
  assert.equal(row.org_id ?? null, null);
  r = await call({ action: 'list' });
  assert.equal(r.status, 200);
  assert.ok(r.body.leads.some((l) => l.name === 'Solo Org Lead'));
  r = await call({ action: 'patch', lead_id: row.id, updated_at: row.updated_at, patch: { stage: 'contacted' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call({ action: 'task_add', lead_id: row.id, due_at: '2026-11-19T15:00:00Z', type: 'call' });
  assert.equal(r.status, 200);
  r = await call({ action: 'tasks_due' });
  assert.equal(r.status, 200);
  r = await call({ action: 'funnel' });
  assert.equal(r.status, 200);
  assert.ok(!fake.calls.some((c) => c.path === '/rest/v1/leads' && /org_id=/.test(c.search)), 'no org_id filter is sent');
});

test('the missing organizations table is looked up once, not on every call', () => {
  const orgCalls = fake.calls.filter((c) => c.path === '/rest/v1/organizations').length;
  assert.ok(orgCalls <= 2, `organizations probed ${orgCalls} times`);
});

test('ACADEMY_DATA_BACKEND=postgres without org tables: users load from and save to storage (login keeps working)', async () => {
  fake.storage.set('floguard-academy/users.json', JSON.stringify({ users: [{ id: 'u1', username: 'amy', pin_hash: 'x:y', role: 'rep' }] }));
  const store = await db.loadUsers();
  assert.deepEqual(store.users.map((u) => u.username), ['amy']);
  await db.saveUsers({ users: [...store.users, { id: 'u2', username: 'bob', pin_hash: 'x:y', role: 'rep' }] });
  const saved = JSON.parse(fake.storage.get('floguard-academy/users.json'));
  assert.deepEqual(saved.users.map((u) => u.username), ['amy', 'bob'], 'saves are not dropped');
});
