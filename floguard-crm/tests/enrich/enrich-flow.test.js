import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichOneLead,
  enrichCapabilities,
  estimateLead,
  createBudget,
  clampMaxPaidLookups,
} from '../../server/lib/contact-enrich.js';
import { fixture, withMocks, ddgHtml } from './_helpers.mjs';

const keys = { BATCHDATA_API_KEY: 'bd', TRESTLE_API_KEY: 'tr' };
const lead = (o = {}) => ({
  id: 'L1',
  name: 'SMITH JOHN A',
  address: '123 Palm Ave, Port Orange, FL 32127',
  city: 'Port Orange',
  zip: '32127',
  phone: '',
  email: 'keep@example.net',
  website: '',
  ...o,
});
const bdBody = (phones) => ({
  results: { persons: [{ name: { first: 'John', last: 'Smith' }, phoneNumbers: phones }] },
});
const BD_UNSCRUBBED_LIT = bdBody([{ number: '3865550142', type: 'Mobile', dnc: false }]);

function router({ bd, ddg = '', intel = 'trestle-phone-intel-mobile.json', reverse = 'trestle-reverse-phone-smith.json' } = {}) {
  return (c) => {
    if (c.host === 'api.batchdata.com') return { json: bd ?? {} };
    if (c.host === 'html.duckduckgo.com') return { text: ddg };
    if (c.host === 'api.trestleiq.com') {
      return { json: fixture(c.path === '/3.0/phone_intel' ? intel : reverse) };
    }
    return { status: 404, text: '' };
  };
}
const hosts = (calls) => calls.map((c) => c.host + (c.host.includes('trestle') ? c.path : ''));

test('provider order: BatchData first, then Trestle verification; free search skipped when BatchData hits', () =>
  withMocks({ env: keys, handler: router({ bd: BD_UNSCRUBBED_LIT }) }, async (calls) => {
    const r = await enrichOneLead(lead());
    assert.deepEqual(hosts(calls), ['api.batchdata.com', 'api.trestleiq.com/3.0/phone_intel']);
    assert.equal(r.phone, '(386) 555-0142');
    assert.equal(r.phone_source, 'batchdata');
    assert.equal(r.phone_line_type, 'mobile');
    assert.equal(r.phone_dnc, false);
    assert.equal(r.phones[0].litigator, false, 'litigator filled in by Trestle');
    assert.ok(r.phones[0].checks.includes('trestle:litigator'));
    assert.equal(r.status, 'found');
    assert.equal(r.email, '', 'email not needed -> not returned');
    assert.equal(r.cost.batchdata, 1);
    assert.equal(r.cost.trestle_phone_intel, 1);
    assert.equal(r.cost.trestle_litigator_addons, 1);
    assert.equal(r.cost.lookups, 2);
  }));

test('BatchData miss -> free search -> Trestle; web number is unscrubbed (dnc null) with modest confidence', () =>
  withMocks({ env: keys, handler: router({ bd: {}, ddg: ddgHtml('(386) 555-0142') }) }, async (calls) => {
    const r = await enrichOneLead(lead());
    const order = hosts(calls);
    assert.equal(order[0], 'api.batchdata.com');
    assert.equal(order[1], 'html.duckduckgo.com');
    assert.deepEqual(order.slice(2), ['api.trestleiq.com/3.0/phone_intel', 'api.trestleiq.com/3.2/phone']);
    const p = r.phones[0];
    assert.equal(p.source, 'search');
    assert.equal(p.dnc, null);
    assert.equal(r.phone_dnc, null);
    assert.equal(p.name_match, 'match');
    assert.ok(p.confidence < 0.7 && p.confidence >= 0.3, `confidence ${p.confidence}`);
  }));

test('free search with no Trestle key: dnc null, low confidence, no paid calls', () =>
  withMocks({ env: {}, handler: router({ ddg: ddgHtml('(386) 555-0142') }) }, async (calls) => {
    const r = await enrichOneLead(lead());
    assert.ok(calls.every((c) => c.host === 'html.duckduckgo.com'));
    assert.equal(r.phone, '(386) 555-0142');
    assert.equal(r.phone_dnc, null);
    assert.equal(r.phone_confidence, 0.2);
    assert.equal(r.phone_line_type, 'unknown');
    assert.equal(r.email_source, '');
  }));

test('owner mismatch is labelled and lowers confidence', () =>
  withMocks({ env: keys, handler: router({ bd: {}, ddg: ddgHtml('(386) 555-0142'), reverse: 'trestle-reverse-phone-jones.json' }) }, async () => {
    const r = await enrichOneLead(lead());
    assert.equal(r.phones[0].name_match, 'mismatch');
    assert.ok(r.warnings.some((w) => /does not match lead name/.test(w)));
    const ok = await withMocks({ env: keys, handler: router({ bd: {}, ddg: ddgHtml('(386) 555-0142') }) }, () => enrichOneLead(lead()));
    assert.ok(r.phones[0].confidence < ok.phones[0].confidence - 0.3);
  }));

test('BatchData DNC / litigator numbers are never the primary; Trestle only verifies unknowns', () =>
  withMocks({ env: keys, handler: router({ bd: fixture('batchdata-skiptrace.json') }) }, async (calls) => {
    const r = await enrichOneLead(lead({ email: '' }));
    assert.equal(r.phone, '(386) 555-0101');
    assert.equal(r.phone_dnc, false);
    assert.equal(r.phones.length, 4);
    assert.equal(r.email, 'john.smith@gmail.com');
    assert.equal(r.email_source, 'batchdata');
    // only 0104 lacked a litigator answer
    assert.equal(calls.filter((c) => c.host === 'api.trestleiq.com').length, 1);
    assert.equal(calls.find((c) => c.host === 'api.trestleiq.com').params.phone, '3865550104');
  }));

test('every number blocked -> status blocked, no primary', () =>
  withMocks({ env: { BATCHDATA_API_KEY: 'bd' }, handler: router({ bd: bdBody([{ number: '3865550102', type: 'Land Line', dnc: true, tcpa: false }]) }) }, async () => {
    const r = await enrichOneLead(lead());
    assert.equal(r.phone, '');
    assert.equal(r.status, 'blocked');
    assert.equal(r.phones.length, 1);
    assert.equal(r.phones[0].dnc, true);
  }));

test('Trestle litigator hit blocks a number BatchData did not flag', () =>
  withMocks({ env: keys, handler: router({ bd: BD_UNSCRUBBED_LIT, intel: 'trestle-phone-intel-litigator.json' }) }, async () => {
    const r = await enrichOneLead(lead());
    assert.equal(r.phones[0].litigator, true);
    assert.equal(r.phone, '');
    assert.equal(r.status, 'blocked');
  }));

test('never overwrites: existing phone and email stay, input is not mutated', () =>
  withMocks({ env: keys, handler: router({ bd: BD_UNSCRUBBED_LIT }) }, async (calls) => {
    const input = Object.freeze(lead({ phone: '(386) 555-0000', email: 'owner@example.net' }));
    const r = await enrichOneLead(input);
    assert.equal(r.phone, '(386) 555-0000');
    assert.equal(r.email, 'owner@example.net');
    assert.equal(r.status, 'complete');
    assert.ok(!calls.some((c) => c.host === 'api.batchdata.com'), 'no skip-trace for a complete lead');
    assert.equal(r.phones[0].number, '(386) 555-0000');
    assert.equal(r.phones[0].source, 'manual');
    assert.equal(r.phones[0].line_type, 'mobile', 'existing number gets verified metadata');
  }));

test('existing phone kept as primary; a better number is only suggested', () =>
  withMocks({ env: { BATCHDATA_API_KEY: 'bd' }, handler: router({ bd: fixture('batchdata-skiptrace.json') }) }, async () => {
    const r = await enrichOneLead(lead({ phone: '(386) 555-0000', email: '' }));
    assert.equal(r.phone, '', 'phone field untouched');
    assert.equal(r.suggested_phone, '(386) 555-0101');
    assert.equal(r.phone_source, 'manual', 'phone_* describe the kept primary');
    assert.equal(r.email, 'john.smith@gmail.com');
    assert.equal(r.phones.length, 5);
  }));

test('force replaces the primary choice but still returns the full list', () =>
  withMocks({ env: { BATCHDATA_API_KEY: 'bd' }, handler: router({ bd: fixture('batchdata-skiptrace.json') }) }, async () => {
    const r = await enrichOneLead(lead({ phone: '(386) 555-0000', email: 'a@b.co' }), { force: true });
    assert.equal(r.phone, '(386) 555-0101');
  }));

test('allowPaid=false makes no BatchData or Trestle calls', () =>
  withMocks({ env: keys, handler: router({ ddg: ddgHtml('(386) 555-0142') }) }, async (calls) => {
    const r = await enrichOneLead(lead(), { allowPaid: false });
    assert.ok(calls.every((c) => c.host === 'html.duckduckgo.com'));
    assert.equal(r.cost.lookups, 0);
  }));

test('spend guard: cap of 1 allows BatchData, blocks Trestle, and says so', () =>
  withMocks({ env: keys, handler: router({ bd: BD_UNSCRUBBED_LIT }) }, async (calls) => {
    const budget = createBudget(1);
    const r = await enrichOneLead(lead(), { budget });
    assert.deepEqual(hosts(calls), ['api.batchdata.com']);
    assert.equal(budget.remaining, 0);
    assert.equal(budget.exhausted, true);
    assert.equal(budget.used.batchdata, 1);
    assert.ok(r.warnings.some((w) => /spend guard/.test(w)));
    assert.equal(r.phone, '(386) 555-0142', 'still returns what the paid call found');
    assert.equal(r.phones[0].litigator, null, 'unverified stays unknown');
  }));

test('spend guard is shared across leads in a request', () =>
  withMocks({ env: { BATCHDATA_API_KEY: 'bd' }, handler: router({ bd: BD_UNSCRUBBED_LIT, ddg: '' }) }, async (calls) => {
    const budget = createBudget(2);
    for (const id of ['a', 'b', 'c']) await enrichOneLead(lead({ id }), { budget });
    assert.equal(calls.filter((c) => c.host === 'api.batchdata.com').length, 2);
    assert.equal(budget.remaining, 0);
  }));

test('clampMaxPaidLookups: default 50, hard cap 500', () => {
  assert.equal(clampMaxPaidLookups(undefined), 50);
  assert.equal(clampMaxPaidLookups('abc'), 50);
  assert.equal(clampMaxPaidLookups(-5), 50);
  assert.equal(clampMaxPaidLookups(0), 0);
  assert.equal(clampMaxPaidLookups(120), 120);
  assert.equal(clampMaxPaidLookups(99999), 500);
  assert.equal(createBudget(99999).max, 500);
});

test('past deadline skips paid steps', () =>
  withMocks({ env: keys, handler: router({ bd: BD_UNSCRUBBED_LIT }) }, async (calls) => {
    const r = await enrichOneLead(lead(), { deadline: Date.now() - 1 });
    assert.ok(!calls.some((c) => c.host === 'api.batchdata.com'));
    assert.equal(r.cost.lookups, 0);
  }));

test('estimateLead reports providers and lookup counts without any HTTP', () =>
  withMocks({ env: keys, handler: () => { throw new Error('no network expected'); } }, async (calls) => {
    const e = estimateLead(lead());
    assert.deepEqual(e.providers, ['batchdata', 'trestle']);
    assert.equal(e.batchdata, 1);
    assert.equal(e.trestle_phone_intel, 3);
    assert.equal(e.trestle_reverse_phone, 1);
    assert.equal(e.max_lookups, 5);
    assert.ok(e.expected_lookups >= 2 && e.expected_lookups <= e.max_lookups);
    assert.equal(estimateLead(lead(), { allowPaid: false }).max_lookups, 0);
    const done = estimateLead(lead({ phone: '(386) 555-0000', email: 'a@b.co', phones: [{ number: '(386) 555-0000', line_type: 'mobile', litigator: false, dnc: false, source: 'manual', confidence: 0.5, checks: ['trestle:phone_intel'] }] }));
    assert.equal(done.max_lookups, 0);
    assert.equal(calls.length, 0);
  }));

test('capabilities reports which providers have keys', async () => {
  await withMocks({ env: {}, handler: () => ({}) }, async () => {
    const c = enrichCapabilities();
    assert.equal(c.batchdata, false);
    assert.equal(c.trestle, false);
    assert.equal(c.default_max_paid_lookups, 50);
    assert.equal(c.hard_max_paid_lookups, 500);
  });
  await withMocks({ env: keys, handler: () => ({}) }, async () => {
    const c = enrichCapabilities();
    assert.equal(c.batchdata, true);
    assert.equal(c.trestle, true);
    assert.deepEqual(c.litigator_check, ['batchdata', 'trestle']);
  });
});
