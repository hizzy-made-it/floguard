// Review R1: the in-memory rate-limit map must not grow without bound (one bucket per IP/token).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, _bucketCount, clientIp } from '../../server/lib/http.js';

test('rate limit buckets are bounded', () => {
  for (let i = 0; i < 12000; i++) rateLimit(`proposal-token:r:${i}`, { limit: 20, windowMs: 60_000 });
  assert.ok(_bucketCount() <= 5000, `buckets ${_bucketCount()}`);
  const k = 'still-limits';
  for (let i = 0; i < 3; i++) rateLimit(k, { limit: 3 });
  assert.equal(rateLimit(k, { limit: 3 }).ok, false, 'limiting still works');
});

test('clientIp takes the first x-forwarded-for hop (Vercel overwrites the header, so it is not client-controlled there)', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }), '203.0.113.9');
  assert.equal(clientIp({ headers: {} }), 'unknown');
});
