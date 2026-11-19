// Review agent R1: server-side daily cap on paid enrichment lookups (ENRICH_DAILY_PAID_CAP).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, withMocks } from './_helpers.mjs';

process.env.ACADEMY_SESSION_SECRET = process.env.ACADEMY_SESSION_SECRET || 'test-secret-for-enrich-daily-cap';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const { createSessionToken } = await import('../../server/lib/academy-db.js');
const { default: handler } = await import('../../api/enrich-contacts.js');
const { dailyPaidCap, spendDay, _resetMemorySpend, DEFAULT_DAILY_PAID_CAP } = await import('../../server/lib/enrich-spend.js');

const token = createSessionToken({ id: 'u1', username: 'tester' });
let ipN = 0;
async function call(body) {
  const req = { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `10.7.7.${++ipN}` }, body };
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
  await handler(req, res);
  return res;
}
const L = (id) => ({ id, name: 'SMITH JOHN A', address: '1 Palm Ave, Port Orange, FL 32127', city: 'Port Orange', zip: '32127', email: 'keep@example.net' });
const keys = { BATCHDATA_API_KEY: 'bd', TRESTLE_API_KEY: 'tr' };
const providers = (c) =>
  c.host === 'api.batchdata.com'
    ? { json: { results: { persons: [{ name: { first: 'John', last: 'Smith' }, phoneNumbers: [{ number: '3865550142', type: 'Mobile', dnc: false }] }] } } }
    : c.host === 'api.trestleiq.com'
      ? { json: fixture('trestle-phone-intel-mobile.json') }
      : { text: '' };
const paidCalls = (calls) => calls.filter((c) => c.host === 'api.batchdata.com' || c.host === 'api.trestleiq.com').length;

function withCap(cap, fn) {
  const saved = process.env.ENRICH_DAILY_PAID_CAP;
  process.env.ENRICH_DAILY_PAID_CAP = String(cap);
  _resetMemorySpend();
  return Promise.resolve(fn()).finally(() => {
    if (saved === undefined) delete process.env.ENRICH_DAILY_PAID_CAP;
    else process.env.ENRICH_DAILY_PAID_CAP = saved;
  });
}

test('cap parsing: default, explicit, zero, junk', () => {
  assert.equal(dailyPaidCap({}), DEFAULT_DAILY_PAID_CAP);
  assert.equal(dailyPaidCap({ ENRICH_DAILY_PAID_CAP: '75' }), 75);
  assert.equal(dailyPaidCap({ ENRICH_DAILY_PAID_CAP: '0' }), 0);
  assert.equal(dailyPaidCap({ ENRICH_DAILY_PAID_CAP: '-3' }), DEFAULT_DAILY_PAID_CAP);
  assert.equal(dailyPaidCap({ ENRICH_DAILY_PAID_CAP: 'lots' }), DEFAULT_DAILY_PAID_CAP);
  assert.equal(spendDay(new Date('2026-11-20T03:30:00Z')), '2026-11-19', 'day is America/New_York');
});

test('client maxPaidLookups cannot exceed the daily cap across requests (replays included)', () =>
  withCap(4, () =>
    withMocks({ env: keys, handler: providers }, async (calls) => {
      const body = { action: 'enrich', leads: [L('a'), L('b'), L('c')], maxPaidLookups: 500 };
      const r1 = await call(body);
      assert.equal(r1.statusCode, 200);
      assert.equal(r1.body.budget.max, 4, 'granted only what is left today');
      assert.equal(r1.body.daily.limited, true);
      assert.equal(r1.body.daily.store, 'memory');
      const r2 = await call(body); // replay of the same request
      assert.equal(r2.body.budget.max, 0);
      assert.equal(r2.body.daily.granted, 0);
      assert.equal(paidCalls(calls), 4, 'never more paid HTTP calls than the cap');
      assert.equal(r2.body.results.length, 3, 'free steps still run');
    })));

test('unused lookups are released for later requests', () =>
  withCap(10, () =>
    withMocks({ env: keys, handler: providers }, async (calls) => {
      const r1 = await call({ action: 'enrich', leads: [L('a')], maxPaidLookups: 10 });
      const used = r1.body.budget.used_total;
      assert.ok(used > 0 && used < 10);
      assert.equal(r1.body.daily.remaining, 10 - used);
      const r2 = await call({ action: 'enrich', leads: [L('b')], maxPaidLookups: 10 });
      assert.equal(r2.body.budget.max, 10 - used);
      assert.ok(paidCalls(calls) <= 10);
    })));

test('ENRICH_DAILY_PAID_CAP=0 turns paid lookups off', () =>
  withCap(0, () =>
    withMocks({ env: keys, handler: providers }, async (calls) => {
      const r = await call({ action: 'enrich', leads: [L('a')], maxPaidLookups: 50 });
      assert.equal(r.statusCode, 200);
      assert.equal(r.body.budget.max, 0);
      assert.equal(paidCalls(calls), 0);
    })));

test('postgres store: reserve RPC is called before any provider, release returns the unused part', () =>
  withCap(100, async () => {
    process.env.SUPABASE_URL = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    let reserved = 0;
    const rpcCalls = [];
    try {
      await withMocks({
        env: keys,
        handler: (c) => {
          if (c.host === 'fake.supabase.co') {
            const args = JSON.parse(c.body || '{}');
            rpcCalls.push({ path: c.path, args });
            if (c.path.endsWith('/enrich_spend_reserve')) {
              const g = Math.max(0, Math.min(args.p_want, args.p_cap - reserved));
              reserved += g;
              return { json: [{ granted: g, reserved }] };
            }
            if (c.path.endsWith('/enrich_spend_release')) {
              reserved = Math.max(0, reserved - args.p_unused);
              return { json: [{ granted: 0, reserved }] };
            }
          }
          return providers(c);
        },
      }, async (calls) => {
        const r = await call({ action: 'enrich', leads: [L('a')], maxPaidLookups: 30 });
        assert.equal(r.body.daily.store, 'postgres');
        const firstPaid = calls.findIndex((c) => c.host === 'api.batchdata.com' || c.host === 'api.trestleiq.com');
        const reserveAt = calls.findIndex((c) => c.path.endsWith('/enrich_spend_reserve'));
        assert.ok(reserveAt >= 0 && reserveAt < firstPaid, 'reserve happens before the first paid call');
        assert.equal(rpcCalls[0].args.p_cap, 100);
        assert.equal(rpcCalls[0].args.p_want, 30);
        const rel = rpcCalls.find((x) => x.path.endsWith('/enrich_spend_release'));
        assert.equal(rel.args.p_used, r.body.budget.used_total);
        assert.equal(rel.args.p_unused, 30 - r.body.budget.used_total);
        assert.equal(reserved, r.body.budget.used_total);
      });
    } finally {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  }));

test('postgres store missing (022 not applied): falls back to the per-instance cap and says so', () =>
  withCap(2, async () => {
    process.env.SUPABASE_URL = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    try {
      await withMocks({
        env: keys,
        handler: (c) => (c.host === 'fake.supabase.co' ? { status: 404, json: { code: 'PGRST202', message: 'Could not find the function' } } : providers(c)),
      }, async (calls) => {
        const r = await call({ action: 'enrich', leads: [L('a'), L('b')], maxPaidLookups: 50 });
        assert.equal(r.body.daily.store, 'memory');
        assert.match(r.body.daily.warning, /022/);
        assert.ok(paidCalls(calls) <= 2);
      });
    } finally {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  }));
