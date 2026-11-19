// Cut-over safety net: when the Postgres pipeline first becomes the leads backend and its table
// is empty while the Storage blob still has leads, the blob is copied in once. Leads must never
// appear to vanish because a backend flag changed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ACADEMY_SYNC_SECRET = 'test-secret';

const { installFakeSupabase, callHandler } = await import('./helpers/fake-supabase.js');
const fake = installFakeSupabase({ pipelineReady: false });
const { default: handler } = await import('../../api/academy-leads.js');
const pg = await import('../../server/lib/academy-pg.js');
const db = await import('../../server/lib/academy-db.js');
after(() => fake.restore());

const call = (body) => callHandler(handler, body);
const mode = (m, ready) => {
  process.env.ACADEMY_DATA_BACKEND = m;
  fake.pipelineReady = ready;
  pg._resetLeadsReadyCache();
  db._resetSeedCheck();
};

test('blob leads are copied into an empty Postgres table on first use, once', async () => {
  mode('storage', false);
  let r = await call({
    action: 'push',
    leads: [
      { name: 'Blob A', city: 'Port Orange', address: '1 A St', parcel_id: 'P-1', phone: '(386) 555-0101' },
      { name: 'Blob B', city: 'Deland', address: '2 B St', parcel_id: 'P-2' },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(fake.tables.leads.length, 0);

  mode('auto', true);
  r = await call({ action: 'list' });
  assert.equal(r.status, 200);
  const names = r.body.leads.map((l) => l.name).sort();
  assert.deepEqual(names, ['Blob A', 'Blob B']);
  assert.equal(fake.tables.leads.length, 2);
  assert.equal(r.body.leads.find((l) => l.name === 'Blob A').phone, '(386) 555-0101');

  // Second request and a fresh instance: no duplicates.
  db._resetSeedCheck();
  r = await call({ action: 'list' });
  assert.equal(r.body.leads.length, 2);
  assert.equal(fake.tables.leads.length, 2);
});

test('a Postgres table that already has leads is never re-seeded from the blob', async () => {
  mode('postgres', true);
  await call({ action: 'delete', id: fake.tables.leads.find((l) => l.name === 'Blob B').id });
  db._resetSeedCheck();
  const r = await call({ action: 'list' });
  assert.deepEqual(r.body.leads.map((l) => l.name), ['Blob A']);
});
