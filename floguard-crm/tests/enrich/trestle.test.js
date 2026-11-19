import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneIntel, reversePhone, reverseAddress, trestleLineType } from '../../server/lib/trestle.js';
import { fixture, withMocks, trestleHost } from './_helpers.mjs';

const env = { TRESTLE_API_KEY: 'test-key' };

test('phoneIntel sends x-api-key, E.164-free 10 digits, and the litigator add-on', () =>
  withMocks({ env, handler: () => ({ json: fixture('trestle-phone-intel-mobile.json') }) }, async (calls) => {
    const r = await phoneIntel('(386) 555-0142', { retryDelayMs: 0 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].host, trestleHost);
    assert.equal(calls[0].path, '/3.0/phone_intel');
    assert.equal(calls[0].headers['x-api-key'], 'test-key');
    assert.equal(calls[0].params.phone, '3865550142');
    assert.equal(calls[0].params.add_ons, 'litigator_checks');
    assert.deepEqual(
      [r.ok, r.line_type, r.litigator, r.activity_score, r.is_valid],
      [true, 'mobile', false, 85, true]
    );
  }));

test('litigator risk true is surfaced; absent add-on is null, not false', () =>
  withMocks({ env, handler: (c) => ({ json: fixture(c.params.phone === '3865550199' ? 'trestle-phone-intel-landline-dead.json' : 'trestle-phone-intel-litigator.json') }) }, async () => {
    assert.equal((await phoneIntel('3865550142')).litigator, true);
    const dead = await phoneIntel('3865550199');
    assert.equal(dead.litigator, null);
    assert.equal(dead.line_type, 'landline');
  }));

test('line type enum mapping', () => {
  assert.equal(trestleLineType('FixedVOIP'), 'voip');
  assert.equal(trestleLineType('NonFixedVOIP'), 'voip');
  assert.equal(trestleLineType('TollFree'), 'unknown');
  assert.equal(trestleLineType(null), 'unknown');
});

test('one retry on 500 then success; two failures return {error}', async () => {
  let n = 0;
  await withMocks({ env, handler: () => (++n === 1 ? { status: 500, json: { error: 'boom' } } : { json: fixture('trestle-phone-intel-mobile.json') }) }, async (calls) => {
    const r = await phoneIntel('3865550142', { retryDelayMs: 0 });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 2);
  });
  await withMocks({ env, handler: () => ({ status: 429, json: { errorCode: 'RATE_LIMIT_EXCEEDED' } }) }, async (calls) => {
    const r = await phoneIntel('3865550142', { retryDelayMs: 0 });
    assert.ok(r.error);
    assert.equal(r.status, 429);
    assert.equal(calls.length, 2);
  });
});

test('403 is not retried; missing key / bad phone make no HTTP call', async () => {
  await withMocks({ env, handler: () => ({ status: 403, json: { errorCode: 'AUTHENTICATION_FAILED' } }) }, async (calls) => {
    const r = await phoneIntel('3865550142', { retryDelayMs: 0 });
    assert.equal(r.status, 403);
    assert.equal(calls.length, 1);
  });
  await withMocks({ env: {}, handler: () => ({ json: {} }) }, async (calls) => {
    assert.match((await phoneIntel('3865550142')).error, /TRESTLE_API_KEY/);
    assert.equal(calls.length, 0);
  });
  await withMocks({ env, handler: () => ({ json: {} }) }, async (calls) => {
    assert.equal((await phoneIntel('123')).error, 'invalid_phone');
    assert.equal(calls.length, 0);
  });
});

test('never throws on network failure', () =>
  withMocks({ env, handler: () => { throw new Error('ECONNRESET'); } }, async () => {
    const r = await phoneIntel('3865550142', { retryDelayMs: 0 });
    assert.match(r.error, /ECONNRESET/);
  }));

test('reversePhone and reverseAddress map names; address result carries no phones', () =>
  withMocks({ env, handler: (c) => ({ json: c.path === '/3.2/phone' ? fixture('trestle-reverse-phone-smith.json') : fixture('trestle-reverse-address.json') }) }, async (calls) => {
    const rp = await reversePhone('3865550142', { postalHint: '32127' });
    assert.equal(rp.owners[0].lastname, 'Smith');
    assert.equal(calls[0].params['phone.postal_code_hint'], '32127');
    const ra = await reverseAddress({ street: '123 Palm Ave', city: 'Port Orange', zip: '32127' });
    assert.equal(calls[1].path, '/3.1/location');
    assert.equal(calls[1].params.street_line_1, '123 Palm Ave');
    assert.equal(ra.residents[0].name, 'John A Smith');
    assert.equal('phones' in ra.residents[0], false);
  }));
