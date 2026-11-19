// Review R1: the copy-ready SMS link must not be offered for a TCPA-litigator primary number.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.js';
const { buildMessage } = await import('../../server/lib/estimates.js');

const estimate = { number: 'FG-2026-0001', total: 4500, customer: { name: 'Jo Smith' }, valid_until: '2026-12-19' };
test('litigator primary number: no sms link, flagged', () => {
  const m = buildMessage({ lead: { name: 'Jo Smith', phone: '(386) 555-0100', phone_dnc: false, phones: [{ number: '386-555-0100', litigator: true }] }, estimate, url: 'https://x/p/t' });
  assert.equal(m.links.sms, null);
  assert.equal(m.to.phone_litigator, true);
});
test('clean number still gets the sms link; DNC still blocks it', () => {
  const lead = { name: 'Jo Smith', phone: '(386) 555-0100', phones: [{ number: '386-555-0100', litigator: false }] };
  assert.match(buildMessage({ lead, estimate, url: 'u' }).links.sms, /^sms:3865550100/);
  assert.equal(buildMessage({ lead: { ...lead, phone_dnc: true }, estimate, url: 'u' }).links.sms, null);
});
