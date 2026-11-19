import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ACADEMY_DATA_BACKEND = 'postgres';

const { installFakeSupabase } = await import('./helpers/fake-supabase.js');
const fake = installFakeSupabase({ pipelineReady: false });
const { migrateLeads, parseLeadsExport } = await import('../../scripts/migrate-leads-to-pg.mjs');
after(() => fake.restore());

const BLOB = [
  { id: 1, name: 'Alpha', city: 'Daytona Beach', phone: '(386) 555-0001', status: 'Quoted', lists: ['FrenchDrain'], list: 'FrenchDrain' },
  { id: 2, name: 'Beta', city: 'Ormond Beach', status: 'New' },
  { id: 3, name: 'John Smith', city: 'Ormond Beach', address: '12 Oak St' },
  { id: 4, name: 'John Smith', city: 'Ormond Beach', address: '99 Pine Ave' },
  { id: 5, name: 'Dup Alpha', city: 'Daytona Beach', parcel_id: 'P1' },
  { id: 6, name: 'Dup Alpha 2', city: 'Daytona Beach', parcel_id: 'p1 ' },
  { name: '' },
];

test('parseLeadsExport accepts the browser backup, {leads}, and bare arrays', () => {
  assert.equal(parseLeadsExport(JSON.stringify({ version: 1, exported_at: 'x', leads: [{ name: 'a' }] })).length, 1);
  assert.equal(parseLeadsExport(JSON.stringify({ leads: [{ name: 'a' }, { name: 'b' }] })).length, 2);
  assert.equal(parseLeadsExport('[{"name":"a"}]').length, 1);
  assert.throws(() => parseLeadsExport('{"x":1}'));
});

test('dry run before 017 is applied plans against an empty table and writes nothing', async () => {
  const r = await migrateLeads(BLOB, { dryRun: true });
  assert.equal(r.ready, false);
  assert.equal(r.applied, false);
  assert.deepEqual(
    { insert: r.counts.insert, update: r.counts.update, invalid: r.counts.skip_invalid },
    { insert: 5, update: 0, invalid: 1 },
  );
  assert.equal(fake.tables.leads.length, 0);
  await assert.rejects(migrateLeads(BLOB, { dryRun: false }), /017/);
});

test('dry run on a ready table: counts only, no writes', async () => {
  fake.pipelineReady = true;
  const writes = () => fake.calls.filter((c) => c.method !== 'GET').length;
  const w = writes();
  const r = await migrateLeads(BLOB, { dryRun: true });
  assert.equal(r.ready, true);
  assert.equal(r.counts.insert, 5);
  assert.equal(r.counts.skip_invalid, 1);
  assert.equal(writes(), w);
  assert.equal(fake.tables.leads.length, 0);
});

test('real run inserts, keeps numeric ids as legacy_id, derives stage', async () => {
  const r = await migrateLeads(BLOB, { dryRun: false });
  assert.equal(r.applied, true);
  assert.equal(fake.tables.leads.length, 5);
  assert.deepEqual(fake.tables.leads.map((l) => l.legacy_id).sort(), ['1', '2', '3', '4', '5']);
  assert.equal(fake.tables.leads.find((l) => l.name === 'Alpha').stage, 'estimate_sent');
  assert.equal(fake.tables.leads.filter((l) => l.name === 'John Smith').length, 2);
});

test('idempotent: re-running updates nothing and inserts nothing; dry run reports all unchanged', async () => {
  const before = JSON.stringify(fake.tables.leads);
  const dry = await migrateLeads(BLOB, { dryRun: true });
  assert.deepEqual({ i: dry.counts.insert, u: dry.counts.update }, { i: 0, u: 0 });
  assert.equal(dry.counts.skip_noop, 5, 'distinct existing leads matched by the incoming rows');
  const real = await migrateLeads(BLOB, { dryRun: false });
  assert.equal(real.counts.insert, 0);
  assert.equal(JSON.stringify(fake.tables.leads), before, 'nothing rewritten');
  assert.equal(fake.tables.leads.length, 5);
});

test('new data on re-run is an update; a second source (browser export) merges by identity', async () => {
  const more = [
    { id: 1, name: 'Alpha', city: 'Daytona Beach', email: 'alpha@example.com' },
    { id: 900, name: 'Beta', city: 'Ormond Beach', phone: '(386) 555-0002' },
    { id: 901, name: 'Brand New', city: 'Port Orange' },
  ];
  const dry = await migrateLeads(more, { dryRun: true });
  assert.deepEqual({ i: dry.counts.insert, u: dry.counts.update }, { i: 1, u: 2 });
  await migrateLeads(more, { dryRun: false });
  assert.equal(fake.tables.leads.find((l) => l.name === 'Alpha').email, 'alpha@example.com');
  assert.equal(fake.tables.leads.find((l) => l.name === 'Beta').phone, '(386) 555-0002');
  assert.equal(fake.tables.leads.find((l) => l.name === 'Brand New').legacy_id, '901');
  assert.equal(fake.tables.leads.length, 6);
});

test('conflicts are counted: parcel and name+city point at two different existing leads', async () => {
  const r = await migrateLeads([{ name: 'Alpha', city: 'Daytona Beach', parcel_id: 'P1' }], { dryRun: true });
  assert.equal(r.counts.conflict, 1);
  assert.equal(r.conflicts[0].reason, 'parcel_and_name_match_different_leads');
});

test('soft-deleted leads are skipped, not resurrected', async () => {
  const row = fake.tables.leads.find((l) => l.name === 'Brand New');
  row.deleted_at = '2026-11-19T00:00:00+00:00';
  const r = await migrateLeads([{ name: 'Brand New', city: 'Port Orange', phone: '1' }], { dryRun: true });
  assert.deepEqual({ i: r.counts.insert, u: r.counts.update, d: r.counts.skip_deleted }, { i: 0, u: 0, d: 1 });
});
