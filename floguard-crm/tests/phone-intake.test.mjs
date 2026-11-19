/**
 * Offline test for the Twilio phone-intake webhooks.
 * Mocks Supabase Storage (leads.json) and the Twilio REST API via a fetch shim.
 * Run: node --test tests/phone-intake.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignature } from '../server/lib/twilio.js';

process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock';
process.env.ACADEMY_DATA_BACKEND = 'storage';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'tok';
process.env.TWILIO_FROM_NUMBER = '+13865550000';
process.env.PUBLIC_BASE_URL = 'https://crm.floguardfl.com/crm';
process.env.FORWARD_TO_NUMBER = '+13865551111';

let store = { leads: [{ id: 7, name: 'Existing', city: 'Port Orange', phone: '(386) 481-8988', notes: 'old' }] };
const sent = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.twilio.com/')) {
    sent.push(Object.fromEntries(new URLSearchParams(String(init.body))));
    return new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 });
  }
  if (u.includes('/storage/v1/object/')) {
    if ((init.method || 'GET') === 'GET') return new Response(JSON.stringify(store), { status: 200 });
    store = JSON.parse(String(init.body));
    return new Response('{}', { status: 200 });
  }
  return new Response('not mocked: ' + u, { status: 500 });
};

function mkReq(path, params, { query = '', badSig = false } = {}) {
  const url = `${process.env.PUBLIC_BASE_URL}${path}${query}`;
  return {
    method: 'POST',
    url: `${path}${query}`,
    headers: { 'x-twilio-signature': badSig ? 'nope' : computeSignature('tok', url, params) },
    body: params,
  };
}
function mkRes() {
  const r = { statusCode: 0, headers: {}, body: '' };
  r.setHeader = (k, v) => (r.headers[k.toLowerCase()] = v);
  r.end = (b) => (r.body = String(b || ''));
  return r;
}
const call = async (mod, req) => {
  const res = mkRes();
  await (await import(mod)).default(req, res);
  return res;
};

test('signature matches the official twilio library', { skip: !process.env.TWILIO_LIB && 'set TWILIO_LIB=<path to twilio/lib/index.js> to cross-check' }, async () => {
  const { validateRequest } = (await import(process.env.TWILIO_LIB)).default;
  const params = { CallSid: 'CA1', From: '+16178772497', To: '+13865550000', Digits: '1' };
  const url = 'https://crm.floguardfl.com/crm/api/voice-inbound';
  const sig = computeSignature('tok', url, params);
  assert.equal(validateRequest('tok', sig, url, params), true);
});

test('rejects unsigned requests', async () => {
  const res = await call('../api/voice-inbound.js', mkReq('/api/voice-inbound', { From: '+15555550123' }, { badSig: true }));
  assert.equal(res.statusCode, 403);
});

test('inbound call creates a lead and forwards to cell', async () => {
  const res = await call(
    '../api/voice-inbound.js',
    mkReq('/api/voice-inbound', { From: '+16105550199', CallerName: 'SMITH JOHN', FromCity: 'DAYTONA BEACH' }),
  );
  assert.match(res.body, /<Dial timeout="20"[^>]*action="https:\/\/crm\.floguardfl\.com\/crm\/api\/voice-status"/);
  assert.match(res.body, /<Number>\+13865551111<\/Number>/);
  const lead = store.leads.find((l) => l.phone === '(610) 555-0199');
  assert.equal(lead.name, 'Smith John');
  assert.equal(lead.city, 'Daytona Beach');
  assert.equal(lead.source, 'phone_intake');
  assert.equal(lead.id, 8);
});

test('missed call with auto-SMS OFF: no text, goes to voicemail', async () => {
  delete process.env.AUTO_SMS_ENABLED;
  const res = await call('../api/voice-status.js', mkReq('/api/voice-status', { From: '+16105550199', DialCallStatus: 'no-answer' }));
  assert.match(res.body, /<Record /);
  assert.match(res.body, /transcribeCallback="https:\/\/crm\.floguardfl\.com\/crm\/api\/voice-transcript"/);
  assert.equal(sent.length, 0);
});

test('test-only mode blocks texts to anyone but the test number', async () => {
  process.env.AUTO_SMS_ENABLED = 'true';
  process.env.AUTO_SMS_TEST_ONLY = '+13865559999';
  await call('../api/voice-status.js', mkReq('/api/voice-status', { From: '+16105550199', DialCallStatus: 'busy' }));
  assert.equal(sent.length, 0);
  delete process.env.AUTO_SMS_TEST_ONLY;
});

test('missed call with auto-SMS ON: one text with the contact link, then cooldown', async () => {
  process.env.AUTO_SMS_ENABLED = 'true';
  await call('../api/voice-status.js', mkReq('/api/voice-status', { From: '+16105550199', DialCallStatus: 'no-answer' }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].To, '+16105550199');
  assert.equal(sent[0].From, '+13865550000');
  assert.match(sent[0].Body, /floguardfl\.com\/contact/);
  await call('../api/voice-status.js', mkReq('/api/voice-status', { From: '+16105550199', DialCallStatus: 'no-answer' }));
  assert.equal(sent.length, 1, 'cooldown prevents a second text');
});

test('answered call does not text', async () => {
  const res = await call('../api/voice-status.js', mkReq('/api/voice-status', { From: '+13864818988', DialCallStatus: 'completed' }));
  assert.match(res.body, /<Hangup\/>/);
  assert.equal(sent.length, 1);
  const lead = store.leads.find((l) => l.id === 7);
  assert.match(lead.notes, /Call answered/);
  assert.equal(lead.name, 'Existing', 'matched existing lead by phone');
});

test('voicemail recording + transcript land on the lead', async () => {
  await call(
    '../api/voice-status.js',
    mkReq('/api/voice-status', { From: '+16105550199', RecordingUrl: 'https://api.twilio.com/rec/RE1', RecordingDuration: '22' }, { query: '?stage=recorded' }),
  );
  await call(
    '../api/voice-transcript.js',
    mkReq('/api/voice-transcript', { From: '+16105550199', TranscriptionStatus: 'completed', TranscriptionText: 'Yard floods every rain' }),
  );
  const lead = store.leads.find((l) => l.phone === '(610) 555-0199');
  assert.match(lead.notes, /Voicemail left \(22s\)/);
  assert.match(lead.notes, /Yard floods every rain/);
});

test('STOP text opts the number out of future auto-texts', async () => {
  await call('../api/sms-inbound.js', mkReq('/api/sms-inbound', { From: '+17275550142', Body: 'STOP' }));
  const lead = store.leads.find((l) => l.phone === '(727) 555-0142');
  assert.equal(lead.sms_opt_out, true);
  await call('../api/voice-status.js', mkReq('/api/voice-status', { From: '+17275550142', DialCallStatus: 'no-answer' }));
  assert.equal(sent.length, 1);
});
