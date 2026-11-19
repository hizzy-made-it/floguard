import './env.js';
import { installFakeSupabase, makeReqRes } from '../../leads/helpers/fake-supabase.js';

let ipSeq = 0;

/** Fake Supabase with the 017 leads tables plus lead_estimates / lead_jobs (020 columns exist in the fake by being schemaless). */
export function setup() {
  const fake = installFakeSupabase();
  fake.tables.lead_estimates = [];
  fake.tables.lead_jobs = [];
  return fake;
}

export const ORG = '00000000-0000-4000-8000-000000000001';

export function seedLead(fake, over = {}) {
  return fake.seedLead({
    name: 'Marisol Vega', address: '412 Heron Bay Dr', city: 'Port Orange', zip: '32127',
    phone: '(386) 555-0142', email: 'mvega@example.org', stage: 'contacted',
    phone_dnc: false, parcel_id: `P-${Math.random().toString(36).slice(2, 8)}`,
    data: { internal_secret: 'DO-NOT-LEAK', website_score: { total: 55 }, fsi_score: 91, claim_heat: 'high' },
    notes: 'INTERNAL NOTE: dislikes the neighbour', ...over,
  });
}

/** Authenticated (sync-secret) call to api/academy-leads.js */
export async function auth(handler, body, { secret = 'test-secret' } = {}) {
  const { req, res } = makeReqRes({ body, secret });
  await handler(req, res);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

/** Public call to api/leads.js with a controllable IP and user-agent. */
export async function pub(handler, body, { ip, ua = 'TestBrowser/1.0', origin } = {}) {
  const { req, res } = makeReqRes({ body });
  req.headers['x-forwarded-for'] = ip || `203.0.113.${(++ipSeq % 250) + 1}`;
  req.headers['user-agent'] = ua;
  if (origin) req.headers.origin = origin;
  await handler(req, res);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

export const LINE = (over = {}) => ({ catalog_id: 'french_drain_sump_system', quantity: 1, unit_price: 8000, ...over });

/** Create + send an estimate through the API; returns { est, token, url }. */
export async function sentEstimate(api, lead, { price = 8000, validUntil } = {}) {
  const c = await auth(api, { action: 'estimate_create', lead_id: lead.id, line_items: [LINE({ unit_price: price })], valid_until: validUntil });
  if (c.status !== 200) throw new Error(`create failed ${JSON.stringify(c.body)}`);
  const s = await auth(api, { action: 'estimate_send', estimate_id: c.body.estimate.id });
  if (s.status !== 200) throw new Error(`send failed ${JSON.stringify(s.body)}`);
  const url = s.body.public_url;
  return { est: s.body.estimate, token: url.split('/proposal/')[1], url };
}
