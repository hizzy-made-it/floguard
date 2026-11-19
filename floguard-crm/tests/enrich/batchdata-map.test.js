import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBatchDataResponse } from '../../server/lib/contact-enrich.js';
import { fixture } from './_helpers.mjs';

const lead = { name: 'SMITH JOHN A' };

test('maps number, line type, DNC and litigator per phone', () => {
  const { phones, emails } = mapBatchDataResponse(fixture('batchdata-skiptrace.json'), lead);
  assert.equal(phones.length, 4);
  const by = Object.fromEntries(phones.map((p) => [p.number, p]));
  assert.deepEqual(
    [by['(386) 555-0101'].line_type, by['(386) 555-0101'].dnc, by['(386) 555-0101'].litigator],
    ['mobile', false, false]
  );
  assert.deepEqual(
    [by['(386) 555-0102'].line_type, by['(386) 555-0102'].dnc],
    ['landline', true]
  );
  assert.deepEqual(
    [by['(386) 555-0103'].line_type, by['(386) 555-0103'].litigator],
    ['voip', true]
  );
  assert.deepEqual(emails, ['john.smith@gmail.com']);
  assert.ok(phones.every((p) => p.source === 'batchdata'));
});
test('missing flags are null (unknown), never false', () => {
  const { phones } = mapBatchDataResponse(fixture('batchdata-skiptrace.json'), lead);
  const bare = phones.find((p) => p.number === '(386) 555-0104');
  assert.equal(bare.dnc, null);
  assert.equal(bare.litigator, null);
  assert.equal(bare.line_type, 'mobile');
  assert.ok(bare.confidence < phones[0].confidence, 'unreachable lowers confidence');
});
test('person name matching the lead raises confidence and is labelled', () => {
  const { phones } = mapBatchDataResponse(fixture('batchdata-skiptrace.json'), lead);
  assert.equal(phones[0].name_match, 'match');
  const other = mapBatchDataResponse(fixture('batchdata-skiptrace.json'), { name: 'JONES MARIA' });
  assert.equal(other.phones[0].name_match, 'mismatch');
  assert.ok(other.phones[0].confidence < phones[0].confidence);
});
test('bare-string phones (unknown plan shape) still map, with unknown metadata', () => {
  const { phones } = mapBatchDataResponse({ data: { phone: '386-555-0199' } }, {});
  assert.equal(phones[0].number, '(386) 555-0199');
  assert.equal(phones[0].dnc, null);
});

// Review R1: shapes confirmed in BatchData's help center (help.batchdata.io articles 12859857
// "BatchData V3 SkipTrace API" and 12856069 "Understanding your property skip trace results",
// read 2026-11-19): results.persons[].phoneNumbers[] {number, carrier, type, tested, reachable,
// score, dnc, tcpa(V3)}, persons[].emails[] {email, tested|verified}, person-level `litigator`
// and `dnc.tcpa` (an object, not a boolean).
test('person-level dnc.tcpa (object) is read as the TCPA/litigator flag when the phone has none', () => {
  const data = {
    status: { code: 200, text: 'OK' },
    results: { persons: [{
      name: { first: 'John', last: 'Smith' },
      dnc: { tcpa: true },
      phoneNumbers: [{ number: '3865550111', type: 'Mobile', reachable: true, dnc: false, score: 90 }],
      emails: [{ email: 'john.smith@gmail.com', tested: true }],
    }] },
  };
  const { phones, emails } = mapBatchDataResponse(data, lead);
  assert.equal(phones[0].litigator, true);
  assert.equal(phones[0].dnc, false, 'phone-level dnc still wins for DNC');
  assert.deepEqual(emails, ['john.smith@gmail.com']);
});
test('person-level dnc object never masquerades as a DNC boolean', () => {
  const data = { results: { persons: [{ dnc: { tcpa: false }, phoneNumbers: [{ number: '3865550112', type: 'Land Line' }] }] } };
  const { phones } = mapBatchDataResponse(data, lead);
  assert.equal(phones[0].dnc, null);
  assert.equal(phones[0].litigator, false);
});
