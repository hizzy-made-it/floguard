import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, withMocks } from './_helpers.mjs';

process.env.ACADEMY_SESSION_SECRET = process.env.ACADEMY_SESSION_SECRET || 'test-secret-for-enrich-api-tests';
const { createSessionToken } = await import('../../server/lib/academy-db.js');
const { default: handler } = await import('../../api/enrich-contacts.js');

const token = createSessionToken({ id: 'u1', username: 'tester' });
let ipN = 0;

async function call(body, { auth = true } = {}) {
  const req = {
    method: 'POST',
    headers: { authorization: auth ? `Bearer ${token}` : '', 'x-forwarded-for': `10.9.9.${++ipN}` },
    body,
  };
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b ? JSON.parse(b) : null; },
  };
  await handler(req, res);
  return res;
}
const L = (id) => ({ id, name: 'SMITH JOHN A', address: '1 Palm Ave, Port Orange, FL 32127', city: 'Port Orange', zip: '32127', email: 'keep@example.net' });
const keys = { BATCHDATA_API_KEY: 'bd', TRESTLE_API_KEY: 'tr' };
const handlerFor = (c) =>
  c.host === 'api.batchdata.com'
    ? { json: { results: { persons: [{ name: { first: 'John', last: 'Smith' }, phoneNumbers: [{ number: '3865550142', type: 'Mobile', dnc: false }] }] } } }
    : c.host === 'api.trestleiq.com'
      ? { json: fixture('trestle-phone-intel-mobile.json') }
      : { text: '' };

test('requires auth', async () => {
  const res = await call({ action: 'capabilities' }, { auth: false });
  assert.equal(res.statusCode, 401);
});

test('capabilities exposes provider keys and limits', () =>
  withMocks({ env: { TRESTLE_API_KEY: 'x' }, handler: () => ({}) }, async () => {
    const res = await call({ action: 'capabilities' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.capabilities.trestle, true);
    assert.equal(res.body.capabilities.batchdata, false);
    assert.equal(res.body.max_batch, 12);
  }));

test('estimate makes no provider calls and returns per-lead counts and totals', () =>
  withMocks({ env: keys, handler: () => { throw new Error('no network'); } }, async (calls) => {
    const res = await call({ action: 'estimate', leads: [L('a'), L('b')], maxPaidLookups: 9999 });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.leads.length, 2);
    assert.equal(res.body.leads[0].batchdata, 1);
    assert.equal(res.body.totals.max_lookups, 10);
    assert.equal(res.body.totals.capped_at, 500);
    assert.equal(calls.length, 0);
  }));

test('enrich enforces maxPaidLookups across the batch and reports usage', () =>
  withMocks({ env: keys, handler: handlerFor }, async (calls) => {
    const res = await call({ action: 'enrich', leads: [L('a'), L('b'), L('c')], maxPaidLookups: 3 });
    assert.equal(res.statusCode, 200);
    const paid = calls.filter((c) => c.host !== 'html.duckduckgo.com').length;
    assert.equal(paid, 3);
    assert.equal(res.body.budget.max, 3);
    assert.equal(res.body.budget.used_total, 3);
    assert.equal(res.body.budget.remaining, 0);
    assert.equal(res.body.budget.exhausted, true);
    assert.equal(res.body.results.length, 3);
    assert.ok(res.body.results.every((r) => 'cost' in r && Array.isArray(r.phones)));
  }));

test('enrich defaults the cap to 50 and rejects unknown actions / oversize batches', () =>
  withMocks({ env: {}, handler: () => ({ text: '' }) }, async () => {
    const ok = await call({ action: 'enrich', leads: [L('a')] });
    assert.equal(ok.body.budget.max, 50);
    assert.equal((await call({ action: 'nope' })).statusCode, 400);
    const big = await call({ action: 'enrich', leads: Array.from({ length: 13 }, (_, i) => L(String(i))) });
    assert.equal(big.statusCode, 400);
  }));
