import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyNewLead, buildLeadEmail } from '../../server/lib/notify.js';

test('no key: disabled, no fetch', async () => {
  delete process.env.RESEND_API_KEY;
  let called = false;
  assert.equal(await notifyNewLead({ source: 'web' }, { fetchImpl: async () => { called = true; } }), 'disabled');
  assert.equal(called, false);
});

test('sends to default recipient with escaped html', async () => {
  process.env.RESEND_API_KEY = 'test_key';
  delete process.env.LEAD_NOTIFY_TO;
  let req;
  const out = await notifyNewLead({ source: 'website', name: 'A <b>', phone: '386-555-0100' },
    { fetchImpl: async (url, init) => { req = { url, init }; return { ok: true }; } });
  assert.equal(out, 'sent');
  assert.equal(req.url, 'https://api.resend.com/emails');
  const body = JSON.parse(req.init.body);
  assert.deepEqual(body.to, ['heath@hdconnex.com']);
  assert.match(body.html, /A &lt;b&gt;/);
  assert.match(body.subject, /website/);
  delete process.env.RESEND_API_KEY;
});

test('api error never throws', async () => {
  process.env.RESEND_API_KEY = 'k';
  assert.equal(await notifyNewLead({ source: 'phone' }, { fetchImpl: async () => { throw new Error('x'); } }), 'error');
  assert.equal(await notifyNewLead({ source: 'phone' }, { fetchImpl: async () => ({ ok: false, status: 422 }) }), 'error');
  delete process.env.RESEND_API_KEY;
});

test('empty fields omitted', () => {
  const { text } = buildLeadEmail({ source: 'phone', phone: '(386) 555-0100', email: '' });
  assert.doesNotMatch(text, /Email:/);
});
