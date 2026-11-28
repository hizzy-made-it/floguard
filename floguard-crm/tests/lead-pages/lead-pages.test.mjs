import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AERIAL = readFileSync(path.join(here, 'fixtures/aerial.jpg'));
const OUT = process.env.LEAD_PAGE_TEST_OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

// Real lot geometry (5508 N Lancewood Cir, Volusia parcel layer, Nov 2026).
const RING = [
  [-80.976027072104984, 29.113184648951098],
  [-80.976538675222784, 29.113162738340666],
  [-80.97660118005733, 29.113320744623408],
  [-80.976052996155474, 29.113348149216655],
  [-80.976027072104984, 29.113184648951098],
];
const STREET_PT = { x: -80.9763, y: 29.11336 };

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.LEAD_FORWARD_SECRET = 'x'.repeat(32);
process.env.RESEND_API_KEY = 'rk';

const store = new Map();
const calls = [];
let gis = { census: true, parcel: true, aerial: true, elev: true };

function res(status, body, type = 'application/json') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) },
    json: async () => JSON.parse(buf.toString()), text: async () => buf.toString(),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
  };
}

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  calls.push({ host: u.host, path: u.pathname, init });
  if (u.host === 'sb.test') {
    const key = decodeURIComponent(u.pathname.replace('/storage/v1/object/', ''));
    if (!init.method || init.method === 'GET') return store.has(key) ? res(200, store.get(key), 'application/octet-stream') : res(404, '{}');
    store.set(key, Buffer.isBuffer(init.body) ? init.body : Buffer.from(String(init.body)));
    return res(200, { Key: key });
  }
  if (u.host === 'geocoding.geo.census.gov') return res(200, { result: { addressMatches: gis.census ? [{ coordinates: STREET_PT, matchedAddress: '5508 LANCEWOOD CIR N' }] : [] } });
  if (u.pathname.endsWith('/MapServer/0/query')) {
    return res(200, { features: gis.parcel ? [{ attributes: { ADRNO: 5508, ADDRFULL: '5508 N LANCEWOOD CIR', LANDSQFT: 10106, OWNER1: 'SECRET OWNER' }, geometry: { rings: [RING] } }] : [] });
  }
  if (u.pathname.endsWith('/exportImage') || u.pathname.endsWith('/export')) {
    if (!gis.aerial) return res(500, 'down', 'text/plain');
    const [xmin, ymin, xmax, ymax] = u.searchParams.get('bbox').split(',').map(Number);
    return res(200, { href: 'https://img.test/out.jpg', extent: { xmin, ymin, xmax, ymax }, width: 1200, height: 675 });
  }
  if (u.host === 'img.test') return res(200, AERIAL, 'image/jpeg');
  if (u.pathname.endsWith('/getSamples')) {
    if (!gis.elev) return res(200, { error: { code: 500 } });
    const geom = JSON.parse(new URLSearchParams(init.body).get('geometry'));
    // Lower toward the west end of the lot: a bowl about 1 ft deep.
    const samples = geom.points.map(([x, y], i) => ({ locationId: i, value: String(2.9 + (x + 80.9766) * 900 + Math.abs(y - 29.11326) * 300) }));
    return res(200, { samples });
  }
  if (u.host === 'api.resend.com') return res(200, { id: 'em_1' });
  throw new Error(`unexpected fetch ${url}`);
};

const lp = await import('../../server/lib/lead-pages/index.js');
const { default: handler } = await import('../../api/leads.js');

function call({ method = 'POST', url = '/api/leads', body, headers = {}, query } = {}) {
  return new Promise((resolve) => {
    const out = { headers: {}, statusCode: 200 };
    const resObj = {
      setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; },
      end: (b) => { out.body = b; resolve(out); },
      set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; },
    };
    handler({ method, url, headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 200)}`, ...headers }, body: body ? JSON.stringify(body) : undefined, query }, resObj);
  });
}

const LEAD = {
  name: 'Dana Johnson', email: 'heath@hdconnex.com', phone: '386-555-0100', message: 'call me after 5, gate code 1234',
  address: '5508 N Lancewood Cir', location: 'Port Orange', issues: ['Standing water in the yard'],
  water_location: ['Backyard'], water_duration: 'More than 2 days', property_type: 'Single-family home',
};
const SECRET = { 'x-lead-forward-secret': 'x'.repeat(32) };

test('slug is readable and the token carries 96 random bits', () => {
  assert.equal(lp.makeSlug('Mark Johnson', '504 NW 31st St, Gainesville'), 'johnson-504-nw-31st');
  assert.equal(lp.makeSlug('José Núñez', '12 Ocean Shore Blvd Apt 4'), 'nunez-12-ocean-shore');
  const t = lp.mintPageToken('Mark Johnson', '504 NW 31st St');
  assert.ok(lp.isPageToken(t), t);
  assert.match(t, /^johnson-504-nw-31st-[A-Za-z0-9_-]{16}$/);
  assert.equal(lp.isPageToken('johnson-504'), false);
  assert.equal(lp.isPageToken('../../etc/passwd-AAAAAAAAAAAAAAAA'), false);
});

test('forward without the secret is refused', async () => {
  const r = await call({ body: { action: 'lead_forward', lead: LEAD } });
  assert.equal(r.statusCode, 401);
});

let fullToken;
test('full version: page, images and email built; nothing sent while sending is off', async () => {
  delete process.env.LEAD_AUTOREPLY_ENABLED;
  const r = await call({ headers: SECRET, body: { action: 'lead_forward', source_id: 'mongo:1', lead: LEAD, send: true, preview: true } });
  assert.equal(r.statusCode, 200, r.body);
  const j = JSON.parse(r.body);
  assert.equal(j.version, 'full', JSON.stringify(j.reasons));
  assert.equal(j.sent, 'disabled');
  assert.ok(!calls.some((c) => c.host === 'api.resend.com'));
  fullToken = j.url.split('/p/')[1];
  assert.match(fullToken, /^johnson-5508-n-lancewood-/);
  // The stored record holds no contact details, message or owner data.
  const rec = JSON.stringify([...store.entries()].filter(([k]) => k.includes('lead-pages/') && k.endsWith('.json')).map(([, v]) => v.toString()));
  for (const secret of ['555-0100', 'gate code', 'SECRET OWNER', 'Johnson']) assert.ok(!rec.includes(secret), secret);
  assert.match(j.email.subject, /5508 N Lancewood Cir/);
  assert.match(j.email.html, /before\.png/);
  assert.match(j.email.html, /after\.png/);
  assert.doesNotMatch(j.email.html, /gate code/);
  if (OUT) writeFileSync(path.join(OUT, 'email-full.html'), j.email.html);
});

test('re-forwarding the same lead reuses its page (no duplicate CRM lead)', async () => {
  const saves = calls.filter((c) => c.path.includes('web-leads.json') && c.init.method === 'POST').length;
  const r = await call({ headers: SECRET, body: { action: 'lead_forward', source_id: 'mongo:1', lead: LEAD } });
  const j = JSON.parse(r.body);
  assert.equal(j.reused, true);
  assert.equal(j.url.split('/p/')[1], fullToken);
  assert.equal(calls.filter((c) => c.path.includes('web-leads.json') && c.init.method === 'POST').length, saves);
});

test('page and images serve; unknown tokens 404', async () => {
  const page = await call({ method: 'GET', url: `/api/leads?lead_page=${fullToken}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-security-policy'], /script-src 'nonce-/);
  assert.match(page.headers['x-robots-tag'], /noindex/);
  assert.match(page.body, /Your Drainage Plan/);
  assert.match(page.body, /5508 N Lancewood Cir/);
  assert.doesNotMatch(page.body, /555-0100|gate code|heath@hdconnex/);
  for (const which of ['before', 'after']) {
    const img = await call({ method: 'GET', url: '/api/leads', query: { lead_page: fullToken, img: which } });
    assert.equal(img.statusCode, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.equal(Buffer.from(img.body).subarray(1, 4).toString(), 'PNG');
    if (OUT) writeFileSync(path.join(OUT, `${which}.png`), img.body);
  }
  if (OUT) writeFileSync(path.join(OUT, 'page-full.html'), page.body);
  const miss = await call({ method: 'GET', url: '/api/leads?lead_page=nobody-1-AAAAAAAAAAAAAAAA' });
  assert.equal(miss.statusCode, 404);
  const bad = await call({ method: 'GET', url: '/api/leads?lead_page=%3Cscript%3E' });
  assert.equal(bad.statusCode, 404);
});

test('simple version when the address has no county parcel', async () => {
  gis = { census: true, parcel: false, aerial: true, elev: true };
  const r = await call({ headers: SECRET, body: { action: 'lead_forward', source_id: 'mongo:2', lead: { ...LEAD, name: 'Sam <b>Lee</b>', address: '9 Elm St' }, preview: true } });
  const j = JSON.parse(r.body);
  assert.equal(j.version, 'simple');
  assert.deepEqual(j.reasons, ['no_county_parcel']);
  assert.doesNotMatch(j.email.html, /before\.png/);
  assert.match(j.email.html, /Sam/);
  assert.doesNotMatch(j.email.html, /<b>Lee/);
  const t = j.url.split('/p/')[1];
  const page = await call({ method: 'GET', url: `/api/leads?lead_page=${t}` });
  assert.match(page.body, /Thanks for reaching out/);
  const img = await call({ method: 'GET', url: `/api/leads?lead_page=${t}&img=before` });
  assert.equal(img.statusCode, 404);
  if (OUT) { writeFileSync(path.join(OUT, 'email-simple.html'), j.email.html); writeFileSync(path.join(OUT, 'page-simple.html'), page.body); }
  gis = { census: true, parcel: true, aerial: true, elev: true };
});

test('full version without lidar still gets a lot-only concept', async () => {
  gis = { census: true, parcel: true, aerial: true, elev: false };
  const r = await call({ headers: SECRET, body: { action: 'lead_forward', source_id: 'mongo:3', lead: LEAD } });
  const j = JSON.parse(r.body);
  assert.equal(j.version, 'full');
  assert.ok(j.reasons.includes('no_lidar'));
  const t = j.url.split('/p/')[1];
  const img = await call({ method: 'GET', url: `/api/leads?lead_page=${t}&img=after` });
  assert.equal(img.statusCode, 200);
  if (OUT) writeFileSync(path.join(OUT, 'after-nolidar.png'), img.body);
  gis = { census: true, parcel: true, aerial: true, elev: true };
});

test('sending: test-only address gate, then one email per page', async () => {
  process.env.LEAD_AUTOREPLY_ENABLED = 'true';
  process.env.LEAD_AUTOREPLY_TEST_ONLY = 'someone-else@example.com';
  let j = JSON.parse((await call({ headers: SECRET, body: { action: 'lead_forward', source_id: 'mongo:1', lead: LEAD, send: true } })).body);
  assert.equal(j.sent, 'test_only');
  process.env.LEAD_AUTOREPLY_TEST_ONLY = 'heath@hdconnex.com';
  j = JSON.parse((await call({ headers: SECRET, body: { action: 'lead_forward', source_id: 'mongo:1', lead: LEAD, send: true } })).body);
  assert.equal(j.sent, 'sent');
  const sent = calls.filter((c) => c.host === 'api.resend.com');
  assert.equal(sent.length, 1);
  const body = JSON.parse(sent[0].init.body);
  assert.deepEqual(body.to, ['heath@hdconnex.com']);
  assert.equal(body.reply_to, 'heath@hdconnex.com');
  j = JSON.parse((await call({ headers: SECRET, body: { action: 'lead_forward', source_id: 'mongo:1', lead: LEAD, send: true } })).body);
  assert.equal(j.sent, 'already_sent');
  delete process.env.LEAD_AUTOREPLY_ENABLED;
  delete process.env.LEAD_AUTOREPLY_TEST_ONLY;
});

test('public intake without an action is unchanged (no page, no reply)', async () => {
  const before = calls.length;
  const r = await call({ body: { name: 'Pat Doe', email: 'pat@example.com', address: '1 A St' } });
  assert.equal(r.statusCode, 200, r.body);
  const after = calls.slice(before);
  assert.ok(!after.some((c) => c.host === 'geocoding.geo.census.gov'));
  // Only the existing new-lead alert to Heath goes out; nothing to the person who filled the form.
  for (const c of after.filter((x) => x.host === 'api.resend.com')) assert.doesNotMatch(c.init.body, /pat@example\.com"\]/);
});
