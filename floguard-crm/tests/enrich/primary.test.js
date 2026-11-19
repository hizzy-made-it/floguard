import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPrimaryPhone, makePhoneEntry } from '../../server/lib/contact-enrich.js';

const E = (o) => makePhoneEntry({ number: '3865550100', source: 'batchdata', ...o });

test('never picks a DNC or litigator number', () => {
  const p = pickPrimaryPhone([
    E({ number: '3865550101', line_type: 'mobile', dnc: true, confidence: 0.99 }),
    E({ number: '3865550102', line_type: 'mobile', litigator: true, confidence: 0.98 }),
    E({ number: '3865550103', line_type: 'landline', dnc: false, confidence: 0.4 }),
  ]);
  assert.equal(p.number, '(386) 555-0103');
});
test('mobile beats landline at similar confidence', () => {
  const p = pickPrimaryPhone([
    E({ number: '3865550101', line_type: 'landline', dnc: false, confidence: 0.7 }),
    E({ number: '3865550102', line_type: 'mobile', dnc: false, confidence: 0.65 }),
  ]);
  assert.equal(p.number, '(386) 555-0102');
});
test('a much more confident landline still beats a weak mobile', () => {
  const p = pickPrimaryPhone([
    E({ number: '3865550101', line_type: 'landline', dnc: false, confidence: 0.9 }),
    E({ number: '3865550102', line_type: 'mobile', dnc: false, confidence: 0.3 }),
  ]);
  assert.equal(p.number, '(386) 555-0101');
});
test('scrubbed (dnc=false) beats unscrubbed (dnc=null) at equal confidence', () => {
  const p = pickPrimaryPhone([
    E({ number: '3865550101', line_type: 'mobile', dnc: null, confidence: 0.6 }),
    E({ number: '3865550102', line_type: 'mobile', dnc: false, confidence: 0.6 }),
  ]);
  assert.equal(p.number, '(386) 555-0102');
});
test('returns null when every number is blocked or list empty', () => {
  assert.equal(pickPrimaryPhone([E({ dnc: true })]), null);
  assert.equal(pickPrimaryPhone([]), null);
});
