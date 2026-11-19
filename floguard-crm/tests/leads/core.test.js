import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveStage, leadToRow, mergeLead, normAddress, planUpsert, rowToLead, applyPlanToStoreLeads,
} from '../../server/lib/leads-core.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

test('stage derivation follows the spec mapping', () => {
  const cases = [
    ['New', 'new'], ['', 'new'], [undefined, 'new'],
    ['Called - no answer', 'contacted'], ['Callback', 'contacted'], ['Interested', 'contacted'],
    ['Quoted', 'estimate_sent'],
    ['Deposit collected', 'won'], ['Contract signed', 'won'],
    ['Not interested', 'lost'], ['Do not contact', 'lost'],
    ['Archived', 'nurture'],
    ['  quoted ', 'estimate_sent'], ['something odd', 'new'],
  ];
  for (const [status, stage] of cases) assert.equal(deriveStage({ status }), stage, `status ${JSON.stringify(status)}`);
});

test('stage derivation across causes: most advanced progress wins; terminal only when all terminal', () => {
  assert.equal(deriveStage({ status: 'New', list_status: { A: 'Not interested', B: 'Quoted' } }), 'estimate_sent');
  assert.equal(deriveStage({ status: 'Callback', list_status: { A: 'Contract signed' } }), 'won');
  assert.equal(deriveStage({ status: 'New', list_status: { A: 'Not interested', B: 'New' } }), 'new');
  assert.equal(deriveStage({ status: 'Not interested', list_status: { A: 'Not interested', B: 'Archived' } }), 'lost');
  assert.equal(deriveStage({ status: 'Archived', list_status: { A: 'Archived' } }), 'nurture');
});

test('same name + city but different address stays two leads', () => {
  const existing = [{ id: 1, name: 'John Smith', city: 'Ormond Beach', address: '12 Oak St' }];
  const plan = planUpsert(existing, [{ name: 'John Smith', city: 'Ormond Beach', address: '99 Pine Ave' }]);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.updates.length, 0);
});

test('same name + city + same address (abbreviation/zip tolerant) merges', () => {
  const existing = [{ id: 1, name: 'John Smith', city: 'Ormond Beach', address: '12 Oak Street, Ormond Beach, FL 32174' }];
  const plan = planUpsert(existing, [{ name: 'John Smith', city: 'Ormond Beach', address: '12 oak st', phone: '(386) 555-0100' }]);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].next.phone, '(386) 555-0100');
  assert.equal(normAddress('12 Oak Street, Ormond Beach'), normAddress('12 OAK ST.'));
});

test('legacy behaviour kept: name+city with no address on either side still merges', () => {
  const existing = [{ id: 1, name: 'Acme Plumbing', city: 'Daytona Beach', phone: '' }];
  const plan = planUpsert(existing, [{ name: 'ACME plumbing ', city: 'daytona beach', phone: '386' }]);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates[0].next.phone, '386');
});

test('an address-less incoming lead fills the address of the existing one', () => {
  const plan = planUpsert([{ id: 1, name: 'A B', city: 'X' }], [{ name: 'A B', city: 'X', address: '1 Main St' }]);
  assert.equal(plan.updates[0].next.address, '1 Main St');
});

test('same name+city but different parcel_id stays separate; same parcel merges even when the name differs', () => {
  const existing = [{ id: 1, name: 'Pat Lee', city: 'Daytona Beach', parcel_id: '5238-01-00-0010' }];
  assert.equal(planUpsert(existing, [{ name: 'Pat Lee', city: 'Daytona Beach', parcel_id: '5238-01-00-0020' }]).inserts.length, 1);
  const p = planUpsert(existing, [{ name: 'Lee Family Trust', city: 'Daytona Beach', parcel_id: ' 5238-01-00-0010 ', notes: 'x' }]);
  assert.equal(p.inserts.length, 0);
  assert.equal(p.updates[0].prev.id, 1);
  assert.equal(p.updates[0].next.name, 'Pat Lee', 'existing name kept');
});

test('uuid beats everything; numeric id only matches when the lead is otherwise compatible', () => {
  const existing = [
    { id: 5, uuid: U1, name: 'John Smith', city: 'Ormond Beach', address: '12 Oak St' },
    { id: 6, uuid: U2, name: 'Jane Roe', city: 'Daytona Beach' },
  ];
  // uuid match even though the name changed
  assert.equal(planUpsert(existing, [{ uuid: U2, name: 'Jane Doe', city: 'Daytona Beach', notes: 'renamed' }]).updates[0].prev.uuid, U2);
  assert.equal(planUpsert(existing, [{ id: U2, name: 'whoever', notes: 'n' }]).updates[0].prev.uuid, U2);
  // another browser's local id 5 for a different person must not overwrite John Smith
  const p = planUpsert(existing, [{ id: 5, name: 'Totally Different', city: 'Port Orange' }]);
  assert.equal(p.inserts.length, 1);
  assert.equal(p.updates.length, 0);
  // id 5 + same person -> match
  assert.equal(planUpsert(existing, [{ id: 5, name: 'John Smith', city: 'Ormond Beach', notes: 'hi' }]).updates[0].prev.uuid, U1);
});

test('two incoming leads in one batch dedupe against each other', () => {
  const plan = planUpsert([], [
    { name: 'New Co', city: 'X', address: '1 A St' },
    { name: 'new co', city: 'x', phone: '386-555-0101' },
    { name: 'New Co', city: 'X', address: '2 B St' },
  ]);
  assert.equal(plan.inserts.length, 2);
  assert.equal(plan.inserts.find((l) => l.address === '1 A St').phone, '386-555-0101');
});

test('invalid rows are skipped and counted', () => {
  const plan = planUpsert([], [null, {}, { name: '  ' }, { name: 'ok', city: 'x' }]);
  assert.deepEqual(plan.counts, { insert: 1, update: 0, skip_noop: 0, skip_invalid: 3, skip_deleted: 0, conflict: 0 });
});

test('soft-deleted leads are not resurrected by a stale push, unless restore:true', () => {
  const existing = [{ id: 1, uuid: U1, name: 'Gone', city: 'X', deleted_at: '2026-11-01T00:00:00Z' }];
  const p = planUpsert(existing, [{ name: 'Gone', city: 'X', phone: '1' }]);
  assert.equal(p.counts.skip_deleted, 1);
  assert.equal(p.inserts.length + p.updates.length, 0);
  const r = planUpsert(existing, [{ name: 'Gone', city: 'X', restore: true }]);
  assert.equal(r.updates[0].next.deleted_at, null);
});

test('no-op merges produce no update (so updated_at is not bumped by every browser push)', () => {
  const existing = [rowToLead({ id: U1, legacy_id: '3', name: 'Same', city: 'X', status: 'New', stage: 'new', lists: ['FrenchDrain'], list: 'FrenchDrain', updated_at: '2026-11-19T12:00:00+00:00', created_at: '2026-11-19T12:00:00+00:00', data: {} })];
  const plan = planUpsert(existing, [{ ...existing[0] }]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.counts.skip_noop, 1);
});

// ---- DNC ------------------------------------------------------------------

test('phone_dnc === true is never cleared by an empty incoming value', () => {
  const base = { name: 'A', city: 'X', phone: '(386) 555-0100', phone_dnc: true };
  for (const empty of [undefined, null, '', false]) {
    const inc = { name: 'A', city: 'X', phone: '(386) 555-0100' };
    if (empty !== undefined) inc.phone_dnc = empty;
    assert.equal(mergeLead(base, inc).phone_dnc, true, `incoming ${JSON.stringify(empty)}`);
  }
});

test('phone_dnc: unknown can become known; a different, scrubbed-clean number may be false', () => {
  assert.equal(mergeLead({ name: 'A', phone_dnc: null }, { phone_dnc: true }).phone_dnc, true);
  assert.equal(mergeLead({ name: 'A', phone_dnc: null }, { phone_dnc: false }).phone_dnc, false);
  const base = { name: 'A', phone: '(386) 555-0100', phone_dnc: true, phones: [{ number: '(386) 555-0100', dnc: true }] };
  const m = mergeLead(base, { phone: '(386) 555-0199', phone_dnc: false, phones: [{ number: '(386) 555-0199', dnc: false }] });
  assert.equal(m.phone_dnc, false);
  assert.equal(m.phones.find((p) => p.number.endsWith('0100')).dnc, true, 'old number stays flagged');
});

test('per-number dnc in phones[] is sticky and a DNC primary number forces phone_dnc true', () => {
  const base = { name: 'A', phone: '3865550100', phone_dnc: null, phones: [{ number: '(386) 555-0100', dnc: true, source: 'batchdata' }] };
  const m = mergeLead(base, { phone: '(386) 555-0100', phones: [{ number: '386-555-0100', dnc: null, line_type: 'mobile', confidence: 0.9 }] });
  assert.equal(m.phones.length, 1);
  assert.equal(m.phones[0].dnc, true);
  assert.equal(m.phones[0].line_type, 'mobile');
  assert.equal(m.phone_dnc, true);
});

// ---- generic merge + stage --------------------------------------------------

test('empty values never clear; lists union unless an explicit array is sent', () => {
  const base = { name: 'A', city: 'X', phone: '1', notes: 'keep', lists: ['A'], list: 'A' };
  const m = mergeLead(base, { name: 'A', city: 'X', phone: '', notes: null, list: 'B' });
  assert.equal(m.phone, '1');
  assert.equal(m.notes, 'keep');
  assert.deepEqual(m.lists, ['A', 'B']);
  assert.deepEqual(mergeLead(base, { lists: ['C'], list: 'C' }).lists, ['C']);
});

test('stage: explicit wins; stale copy ignored; status change re-derives; manual-only stage survives unrelated pushes', () => {
  const base = { name: 'A', status: 'New', stage: 'assessment_booked', updated_at: '2026-11-19T12:00:10Z' };
  assert.equal(mergeLead(base, { name: 'A', notes: 'x' }).stage, 'assessment_booked');
  assert.equal(mergeLead(base, { stage: 'won' }).stage, 'won');
  assert.equal(mergeLead(base, { stage: 'won', updated_at: '2026-11-19T12:00:00Z' }).stage, 'assessment_booked', 'stale');
  assert.equal(mergeLead(base, { stage: 'Estimate Sent' }).stage, 'estimate_sent');
  assert.equal(mergeLead(base, { status: 'Quoted' }).stage, 'estimate_sent');
  assert.equal(mergeLead({ name: 'A', status: 'New' }, { name: 'A', status: 'New' }).stage, 'new');
  assert.equal(mergeLead({ name: 'A', status: 'Callback' }, {}).stage, 'contacted', 'absent -> derived');
});

test('next_action: valid object replaces, stale copy and nulls are ignored', () => {
  const base = { name: 'A', next_action: { type: 'call', due_at: '2026-11-20T15:00:00.000Z', note: 'a' }, updated_at: '2026-11-19T12:00:10Z' };
  const nxt = { type: 'text', due_at: '2026-11-21T15:00:00Z', note: 'b' };
  assert.equal(mergeLead(base, { next_action: nxt }).next_action.type, 'text');
  assert.equal(mergeLead(base, { next_action: nxt, updated_at: '2026-11-19T12:00:00Z' }).next_action.type, 'call');
  assert.equal(mergeLead(base, { next_action: null }).next_action.type, 'call');
  assert.equal(mergeLead(base, { next_action: { type: 'call' } }).next_action.type, 'call', 'invalid ignored');
});

test('row round trip keeps unknown browser fields and original date strings', () => {
  const lead = {
    id: 7, name: 'Round Trip', city: 'X', address: '1 A St', parcel_id: 'P-1', phone: '(386) 555-0100',
    next_follow_up_at: '2026-11-20', website_score: { total: 40, grade: 'D' }, suggested_causes: ['FrenchDrain'],
    list_status: { FrenchDrain: 'Quoted' }, lists: ['FrenchDrain'], list: 'FrenchDrain', status: 'Quoted', amount: '1500',
    mgmt_company_id: 'm1', weird: { nested: [1, 2] },
  };
  const row = leadToRow(lead);
  assert.equal(row.stage, 'estimate_sent');
  assert.equal(row.amount, 1500);
  assert.equal(row.next_follow_up_at, '2026-11-20T00:00:00.000Z');
  const back = rowToLead({ ...row, id: U1, legacy_id: '7', created_at: 'c', updated_at: 'u' });
  assert.equal(back.id, 7);
  assert.equal(back.uuid, U1);
  assert.equal(back.next_follow_up_at, '2026-11-20');
  assert.deepEqual(back.website_score, lead.website_score);
  assert.deepEqual(back.weird, lead.weird);
  assert.deepEqual(back.list_status, lead.list_status);
  assert.deepEqual(back.suggested_causes, lead.suggested_causes);
  assert.equal(back.mgmt_company_id, 'm1');
});

test('storage path: plan applies with numeric ids and drops provenance', () => {
  const existing = [{ id: 3, name: 'Old', city: 'X' }];
  const plan = planUpsert(existing, [{ id: 99, name: 'Fresh', city: 'Y' }, { name: 'Old', city: 'X', phone: '1' }]);
  const leads = applyPlanToStoreLeads(existing, plan);
  assert.equal(leads.length, 2);
  assert.equal(leads[0].phone, '1');
  assert.equal(leads[1].id, 4);
  assert.equal('client_id' in leads[1], false);
});
