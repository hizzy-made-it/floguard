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
