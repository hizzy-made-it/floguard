// Review R1: ACADEMY_DATA_BACKEND=auto in the exact production state (no organizations, no leads
// table) before 017, and after 017 created public.leads (still no organizations).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ACADEMY_SYNC_SECRET = 'test-secret';
process.env.ACADEMY_DATA_BACKEND = 'auto';

const { installFakeSupabase, callHandler } = await import('./helpers/fake-supabase.js');
const fake = installFakeSupabase();
delete fake.tables.organizations;
const savedLeads = fake.tables.leads;
delete fake.tables.leads; // before 017: no public.leads
const { default: handler } = await import('../../api/academy-leads.js');
const pg = await import('../../server/lib/academy-pg.js');
after(() => fake.restore());
const call = (body) => callHandler(handler, body);

test('auto, before 017: legacy actions use the Storage blob; pipeline actions answer 501', async () => {
  const r = await call({ action: 'push', leads: [{ name: 'Blob Lead', city: 'X' }] });
  assert.equal(r.status, 200);
  const blob = JSON.parse(fake.storage.get('floguard-academy/leads.json'));
  assert.ok(blob.leads.some((l) => l.name === 'Blob Lead'));
  assert.equal((await call({ action: 'funnel' })).status, 501);
});

test('auto, after 017 (leads table, still no organizations): Postgres pipeline, single tenant', async () => {
  fake.tables.leads = savedLeads;
  pg._resetLeadsReadyCache();
  const r = await call({ action: 'push', leads: [{ name: 'Pg Lead', city: 'X' }] });
  assert.equal(r.status, 200);
  assert.ok(fake.tables.leads.some((l) => l.name === 'Pg Lead' && (l.org_id ?? null) === null));
  assert.equal((await call({ action: 'funnel' })).status, 200);
});
