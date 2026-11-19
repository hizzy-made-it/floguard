// Review agent R1: regression tests for defects found in the leads pipeline.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ACADEMY_SYNC_SECRET = 'test-secret';
process.env.ACADEMY_DATA_BACKEND = 'postgres';

const { installFakeSupabase, callHandler } = await import('./helpers/fake-supabase.js');
const fake = installFakeSupabase();
const { default: handler } = await import('../../api/academy-leads.js');
const { mergeLead } = await import('../../server/lib/leads-core.js');

after(() => fake.restore());
const call = (body, opts) => callHandler(handler, body, opts);
const byName = (n) => fake.tables.leads.find((l) => l.name === n && !l.deleted_at);
const digits = (s) => String(s || '').replace(/\D/g, '');

// ---------------------------------------------------------------------------------------------
// DNC: replacing the primary number must not erase the do-not-call record of the old number.
// Before the fix the flag lived only on the scalar `phone_dnc`; switching to another number and
// back again silently made a DNC number dialable (no confirm_dnc_clear involved).
// ---------------------------------------------------------------------------------------------
test('merge: changing the primary number keeps the old number flagged; switching back restores DNC', () => {
  const base = { name: 'A', city: 'X', phone: '(386) 555-0100', phone_dnc: true, phones: [] };
  const moved = mergeLead(base, { phone: '(386) 555-0199', phone_dnc: false });
  assert.equal(moved.phone_dnc, false, 'new, scrubbed-clean number may be dialable (documented C.md rule)');
  const old = (moved.phones || []).find((p) => digits(p.number) === '3865550100');
  assert.ok(old, 'old number is kept in phones[]');
  assert.equal(old.dnc, true, 'old number keeps its DNC flag');
  const back = mergeLead(moved, { phone: '(386) 555-0100', phone_dnc: false });
  assert.equal(back.phone_dnc, true, 'returning to the DNC number restores the flag');
});

test('patch: phone replaced and then restored does not clear DNC without confirm_dnc_clear', async () => {
  await call({ action: 'push', leads: [{ name: 'Dnc Swap', city: 'X', phone: '(386) 555-0300', phone_dnc: true }] });
  const id = byName('Dnc Swap').id;
  let r = await call({ action: 'patch', lead_id: id, patch: { phone: '(386) 555-0301' } });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.lead.phone_dnc, true, 'flag belonged to the old number');
  assert.equal(r.body.lead.phones.find((p) => digits(p.number) === '3865550300')?.dnc, true, 'old number recorded as DNC');
  r = await call({ action: 'patch', lead_id: id, patch: { phone: '(386) 555-0300' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.lead.phone_dnc, true, 'DNC is back for the DNC number');
  r = await call({ action: 'patch', lead_id: id, patch: { phone: '(386) 555-0300', phone_dnc: false } });
  assert.equal(r.status, 400, 'clearing still needs the confirm flag');
  assert.equal(r.body.error, 'dnc_clear_requires_confirmation');
});

// ---------------------------------------------------------------------------------------------
// Lost update: push/bulk_upsert loads every lead, merges, then PATCHes by id with no concurrency
// guard. A patch (or task/stage change) that lands in between was overwritten with the stale copy.
// ---------------------------------------------------------------------------------------------
test('push does not overwrite a concurrent patch that landed after it read the leads', async () => {
  await call({ action: 'push', leads: [{ name: 'Race Push', city: 'X', notes: 'v1', status: 'New' }] });
  const row = byName('Race Push');
  const realFetch = globalThis.fetch;
  let bumped = false;
  globalThis.fetch = async (input, init) => {
    const u = String(input);
    if (!bumped && (init?.method || 'GET') === 'PATCH' && u.includes('/rest/v1/leads') && u.includes(row.id)) {
      bumped = true; // another rep's patch wins the race
      await realFetch(`https://fake.supabase.co/rest/v1/leads?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ notes: 'rep B note', stage: 'assessment_booked' }) });
    }
    return realFetch(input, init);
  };
  try {
    const r = await call({ action: 'push', leads: [{ name: 'Race Push', city: 'X', owner: 'rep A' }] });
    assert.equal(r.status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
  const after = byName('Race Push');
  assert.equal(after.owner, 'rep A', 'the push change landed');
  assert.equal(after.notes, 'rep B note', 'the concurrent patch was not reverted');
  assert.equal(after.stage, 'assessment_booked', 'the concurrent stage move was not reverted');
});
