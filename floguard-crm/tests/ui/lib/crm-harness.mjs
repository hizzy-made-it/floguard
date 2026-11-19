/**
 * Shared harness for the browser tests in tests/ui (not a test file itself).
 * - loadPlaywright(): playwright-core from PLAYWRIGHT_CORE, node resolution, or /tmp/etools (null if absent)
 * - startServer(): scripts/dev-server.mjs on a free port
 * - FakeLeadsServer: in-memory stand-in for /api/academy-leads (Postgres backend contract, handoff C.md):
 *   list (since), push, patch (409 on a stale updated_at), get, delete, activity_add/list, task_done,
 *   tasks_due, funnel. mode 'local' answers the new actions with 501 postgres_backend_required.
 * - stubApis(context, opts): routes /crm/api/* to the fakes (leads, enrich-contacts, fsi-parcels storm,
 *   lead-outcomes, auth) and records every call in opts.calls.
 */
import fs from 'fs';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../../..');

export async function loadPlaywright() {
  const cands = [process.env.PLAYWRIGHT_CORE, 'playwright-core', '/tmp/pw/node_modules/playwright-core', '/tmp/etools/node_modules/playwright-core'].filter(Boolean);
  for (const c of cands) {
    try {
      const spec = c.startsWith('/') ? pathToFileURL(path.join(c, 'index.mjs')).href : c;
      const m = await import(spec);
      return m.chromium || m.default?.chromium;
    } catch (e) { /* try next */ }
  }
  return null;
}
export function chromePath() {
  for (const p of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}
function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
}
export async function startServer() {
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(root, 'scripts/dev-server.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('dev server did not start')), 10000);
    proc.stdout.on('data', (d) => { if (String(d).includes('dev server')) { clearTimeout(t); res(); } });
    proc.on('exit', (c) => rej(new Error('dev server exited ' + c)));
  });
  return { port, base: `http://localhost:${port}/crm/`, stop: () => proc.kill() };
}

export const USER = { id: 'u_smoke', username: 'smoke', role: 'admin', tokens_used: 12500, tokens_limit: 50000, locked: false };

const day = 86400000;
const iso = (ms) => new Date(ms).toISOString();
function todayAt(h, m = 0, offsetDays = 0) { const d = new Date(); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + offsetDays); return d.toISOString(); }

/** Leads covering every phone state the UI must handle. */
export function f1Leads() {
  const now = Date.now();
  return [
    { id: 1, name: 'Marisol Vega', city: 'Port Orange', address: '412 Heron Bay Dr, Port Orange, FL 32127', zip: '32127', industry: 'Homeowner', list: 'FrenchDrain', lists: ['FrenchDrain', 'YardDrainage'], list_status: { FrenchDrain: 'Interested', YardDrainage: 'New' }, status: 'Interested', phone: '(386) 555-0142', email: 'mvega@example.org', notes: 'Standing water by slab 3 days after storms.', amount: 8400, source: 'fsi-map', parcel_id: '6303-01-00-0420',
      phones: [{ number: '(386) 555-0142', line_type: 'mobile', dnc: false, litigator: false, source: 'batchdata', confidence: 0.85, name_match: 'match', found_at: iso(now - 3 * day) }],
      phone_dnc: false, phone_line_type: 'mobile', phone_source: 'batchdata', phone_confidence: 0.85, enriched_at: iso(now - 3 * day), stage_changed_at: iso(now - 4 * day) },
    { id: 2, name: 'Coastal Property Pros', city: 'Daytona Beach', address: '220 Beach St, Daytona Beach, FL 32114', zip: '32114', industry: 'Property management company', list: 'PropertyMgmt', lists: ['PropertyMgmt'], list_status: { PropertyMgmt: 'Quoted' }, status: 'Quoted', phone: '(386) 555-0199', contact: 'Dana', notes: '40 doors, wet-season complaints.', amount: 15000,
      phones: [{ number: '(386) 555-0199', line_type: 'landline', dnc: null, litigator: null, source: 'web', confidence: 0.4 }], phone_line_type: 'landline', phone_source: 'web', phone_confidence: 0.4, stage_changed_at: iso(now - 9 * day) },
    { id: 3, name: 'Robert Lindqvist', city: 'Ormond Beach', address: '17 Tomoka Oaks Blvd, Ormond Beach, FL 32174', zip: '32174', industry: 'Homeowner', list: 'SumpPump', lists: ['SumpPump'], list_status: { SumpPump: 'Called - no answer' }, status: 'Called - no answer', phone: '(386) 555-0123',
      phones: [{ number: '(386) 555-0123', line_type: 'landline', dnc: true, litigator: false, source: 'batchdata', confidence: 0.7 }], phone_dnc: true, phone_line_type: 'landline', phone_source: 'batchdata',
      next_action: { type: 'call', due_at: todayAt(9, 0, -1), note: 'Second attempt' } },
    { id: 4, name: 'Halifax Crawlspace Co', city: 'New Smyrna Beach', address: '', industry: 'Crawl space repair', list: 'SumpPump', lists: ['SumpPump', 'Maintenance'], list_status: { SumpPump: 'Callback', Maintenance: 'New' }, status: 'Callback', phone: '(386) 555-0110', email: 'office@halifaxcrawl.example',
      phones: [{ number: '(386) 555-0110', line_type: 'voip', dnc: false, litigator: true, source: 'trestle', confidence: 0.6 }], phone_dnc: false, phone_line_type: 'voip',
      maintenance_frequency: 'quarterly', maintenance_next_due: new Date().toISOString().slice(0, 10) },
    { id: 5, name: 'Priya Natarajan', city: 'DeLand', address: '905 N Woodland Blvd, DeLand, FL 32720', zip: '32720', industry: 'Homeowner', list: 'YardDrainage', lists: ['YardDrainage'], list_status: { YardDrainage: 'Contract signed' }, status: 'Contract signed', phone: '(386) 555-0177', email: 'priya.n@example.org', notes: 'Lanai floods; channel drain + regrade.', amount: 5200, stage_changed_at: iso(now - 2 * day) },
    { id: 6, name: 'Gerald Okafor', city: 'Port Orange', address: '33 Spruce Creek Rd, Port Orange, FL 32127', zip: '32127', industry: 'Homeowner', list: 'FrenchDrain', lists: ['FrenchDrain'], list_status: { FrenchDrain: 'New' }, status: 'New', phone: '', email: '' },
    { id: 7, name: 'Dana Whitfield', city: 'South Daytona', address: '1810 Reed Canal Rd, South Daytona, FL 32119', zip: '32119', industry: 'Homeowner', list: 'FrenchDrain', lists: ['FrenchDrain'], list_status: { FrenchDrain: 'Interested' }, status: 'Interested', stage: 'assessment_booked', phone: '(386) 555-0163', amount: 9800,
      phones: [{ number: '(386) 555-0163', line_type: 'mobile', dnc: false, litigator: false, source: 'batchdata', confidence: 0.8, name_match: 'match' }], phone_dnc: false, phone_line_type: 'mobile',
      next_action: { type: 'visit', due_at: todayAt(16, 30), note: 'Site assessment, side yard' }, stage_changed_at: iso(now - 1 * day) },
    { id: 8, name: 'Luis Ortega', city: 'DeLand', address: '44 W Minnesota Ave, DeLand, FL 32720', zip: '32720', industry: 'Homeowner', list: 'YardDrainage', lists: ['YardDrainage'], list_status: { YardDrainage: 'New' }, status: 'New', phone: '(386) 555-0188',
      phones: [{ number: '(386) 555-0188', line_type: 'voip', dnc: null, litigator: null, source: 'search', confidence: 0.2 }, { number: '(386) 555-0191', line_type: 'mobile', dnc: null, litigator: false, source: 'trestle', confidence: 0.75, name_match: 'partial' }],
      phone_line_type: 'voip', phone_source: 'search', phone_confidence: 0.2, suggested_phone: '(386) 555-0191' },
  ];
}

const STATUS_STAGE = { new: 'new', 'called - no answer': 'contacted', callback: 'contacted', interested: 'contacted', quoted: 'estimate_sent', 'deposit collected': 'won', 'contract signed': 'won', 'not interested': 'lost', 'do not contact': 'lost', archived: 'nurture' };
function stageOf(l) { return l.stage || STATUS_STAGE[String(l.status || 'new').toLowerCase()] || 'new'; }

export class FakeLeadsServer {
  constructor(leads, { mode = 'server' } = {}) {
    this.mode = mode;
    this.calls = [];
    this.clock = Date.now() - 60000;
    this.rows = leads.map((l, i) => {
      const r = JSON.parse(JSON.stringify(l));
      r.uuid = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
      r.stage = stageOf(r);
      r.created_at = this.tick();
      r.updated_at = this.tick();
      if (r.next_action) r.next_action.task_id = `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
      r.activity = [];
      return r;
    });
    this.outcomes = [];
  }
  tick() { this.clock += 1000; return new Date(this.clock).toISOString(); }
  find(ref) { return this.rows.find((r) => r.uuid === ref || String(r.id) === String(ref)); }
  pub(r) { const { activity, ...rest } = r; return JSON.parse(JSON.stringify(rest)); }
  addActivity(r, a) { const row = { id: 'a' + Math.random().toString(36).slice(2, 9), lead_id: r.uuid, at: a.at || new Date().toISOString(), actor: a.actor || 'smoke', type: a.type, direction: a.direction || null, outcome: a.outcome || null, body: a.body || '', meta: a.meta || {} }; r.activity.push(row); return row; }
  /** Simulate an edit from another device: bump updated_at (and optionally change fields). */
  touch(ref, fields = {}) { const r = this.find(ref); Object.assign(r, fields); r.updated_at = this.tick(); return r; }
  handle(body) {
    const a = body.action;
    this.calls.push({ action: a, body });
    const NEW = ['patch', 'get', 'delete', 'activity_add', 'activity_list', 'task_add', 'task_done', 'tasks_due', 'funnel'];
    if (this.mode === 'local' && (NEW.includes(a) || (a === 'list' && (body.since || body.cursor || body.limit)))) {
      return [501, { error: 'postgres_backend_required', detail: 'Set ACADEMY_DATA_BACKEND=postgres' }];
    }
    if (a === 'list') {
      let rows = this.rows;
      if (this.mode === 'local') return [200, { ok: true, leads: rows.filter((r) => !r.deleted_at).map((r) => { const p = this.pub(r); delete p.uuid; delete p.updated_at; return p; }) }];
      if (body.since) rows = rows.filter((r) => r.updated_at > body.since);
      else rows = rows.filter((r) => !r.deleted_at);
      return [200, { ok: true, leads: rows.map((r) => this.pub(r)), count: rows.length, updated_at: this.clock, next_cursor: null, has_more: false }];
    }
    if (a === 'push' || a === 'bulk_upsert') return [200, { ok: true, count: this.rows.length, added: 0, merged: (body.leads || []).length, updated: 0 }];
    if (a === 'prune_placeholders') return [200, { ok: true, removed: 0, remaining: this.rows.length }];
    if (a === 'patch') {
      const r = this.find(body.lead_id);
      if (!r) return [404, { error: 'not_found' }];
      if (body.updated_at && body.updated_at !== r.updated_at) return [409, { error: 'conflict', detail: 'stale', lead: this.pub(r) }];
      const p = body.patch || {};
      if (p.phone_dnc === false && r.phone_dnc === true && !body.confirm_dnc_clear) return [400, { error: 'dnc_clear_requires_confirmation' }];
      const from = r.stage;
      for (const [k, v] of Object.entries(p)) {
        if (['id', 'uuid', 'created_at', 'updated_at', 'deleted_at'].includes(k)) continue;
        if (v === null || v === '') delete r[k]; else r[k] = v;
      }
      if (p.next_action) r.next_action = { ...p.next_action, task_id: 't' + Math.random().toString(36).slice(2, 9) };
      if ('stage' in p && p.stage !== from) this.addActivity(r, { type: 'stage_change', body: `Stage: ${from} -> ${p.stage}`, meta: { from, to: p.stage, via: 'patch' } });
      r.updated_at = this.tick();
      return [200, { ok: true, lead: this.pub(r) }];
    }
    if (a === 'get') { const r = this.find(body.lead_id); return r ? [200, { ok: true, lead: this.pub(r), activity: r.activity.slice().reverse(), tasks: [] }] : [404, { error: 'not_found' }]; }
    if (a === 'delete') { const r = this.find(body.lead_id); if (!r) return [404, { error: 'not_found' }]; r.deleted_at = new Date().toISOString(); r.updated_at = this.tick(); return [200, { ok: true, id: r.uuid, deleted_at: r.deleted_at, updated_at: r.updated_at }]; }
    if (a === 'activity_add') { const r = this.find(body.lead_id); if (!r) return [404, { error: 'not_found' }]; return [200, { ok: true, activity: this.addActivity(r, body) }]; }
    if (a === 'activity_list') { const r = this.find(body.lead_id); if (!r) return [404, { error: 'not_found' }]; return [200, { ok: true, activity: r.activity.slice().reverse(), count: r.activity.length }]; }
    if (a === 'tasks_due') {
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const tasks = this.rows.filter((r) => !r.deleted_at && r.next_action && new Date(r.next_action.due_at) <= end).map((r) => ({
        id: r.next_action.task_id, lead_id: r.uuid, type: r.next_action.type, due_at: r.next_action.due_at, note: r.next_action.note || '', is_next_action: true,
        bucket: new Date(r.next_action.due_at) < new Date() ? 'overdue' : 'today', lead_name: r.name, lead_phone: r.phone, lead_stage: r.stage, lead_phone_dnc: r.phone_dnc === true,
      }));
      return [200, { ok: true, tasks, counts: { overdue: tasks.filter((t) => t.bucket === 'overdue').length, today: tasks.filter((t) => t.bucket === 'today').length, total: tasks.length }, as_of: new Date().toISOString() }];
    }
    if (a === 'task_done') {
      const r = this.rows.find((x) => x.next_action && x.next_action.task_id === body.task_id);
      if (!r) return [404, { error: 'not_found' }];
      const task = { id: body.task_id, done_at: new Date().toISOString() };
      delete r.next_action; r.updated_at = this.tick();
      this.addActivity(r, { type: 'system', body: 'Task done' });
      return [200, { ok: true, task, lead: this.pub(r) }];
    }
    if (a === 'funnel') {
      const live = this.rows.filter((r) => !r.deleted_at);
      const STAGES = ['new', 'contacted', 'assessment_booked', 'estimate_sent', 'won', 'lost', 'nurture'];
      const funnel = Object.fromEntries(STAGES.map((s) => [s, live.filter((r) => r.stage === s).length]));
      return [200, { ok: true, funnel, stages: STAGES.map((s) => ({ stage: s, leads: funnel[s], amount: 0 })), total: live.length }];
    }
    return [400, { error: 'unknown_action' }];
  }
}

/** Enrich stub: two paid lookups per lead; result per lead id from `results` (default not_found). */
export function fakeEnrich({ calls, results = {}, capabilities } = {}) {
  const caps = capabilities || { free_directory: true, free_website_scrape: true, batchdata: true, trestle: true, trestle_role: 'verification', dnc_scrub: 'batchdata', litigator_check: ['batchdata', 'trestle'], default_max_paid_lookups: 50, hard_max_paid_lookups: 500 };
  return (body) => {
    calls.push({ fn: 'enrich-contacts', action: body.action, body });
    if (body.action === 'capabilities') return [200, { ok: true, capabilities: caps, max_batch: 12 }];
    const leads = body.leads || [];
    if (leads.length > 12) return [400, { error: 'Max 12 leads per request' }];
    if (body.action === 'estimate') {
      const per = leads.map((l) => ({ id: l.id, providers: ['batchdata', 'trestle'], batchdata: 1, trestle_phone_intel: 1, trestle_reverse_phone: 1, free: ['directory_search'], expected_lookups: 2, max_lookups: 3 }));
      const sum = (k) => per.reduce((n, e) => n + e[k], 0);
      return [200, { ok: true, capabilities: caps, leads: per, totals: { leads: per.length, batchdata: sum('batchdata'), trestle_phone_intel: sum('trestle_phone_intel'), trestle_reverse_phone: sum('trestle_reverse_phone'), expected_lookups: sum('expected_lookups'), max_lookups: sum('max_lookups'), capped_at: body.maxPaidLookups ?? 50 } }];
    }
    const max = Number(body.maxPaidLookups ?? 50);
    let used = 0;
    const out = leads.map((l) => {
      const r = results[String(l.id)] || { status: 'not_found', sources: ['search'] };
      if (used + 2 <= max) used += 2; else used = max;
      return { id: l.id, phone: '', email: '', website: '', sources: [], ...r };
    });
    return [200, { ok: true, capabilities: caps, summary: {}, budget: { max, remaining: max - used, used_total: used, used: { batchdata: Math.ceil(used / 2) }, exhausted: used >= max }, results: out }];
  };
}

export const STORM = {
  ok: true, source: 'postgres', minRainMm: 25, minBand: 'must',
  cells: [{ cell_id: 'c1', lat: 29.1, lon: -81.0, rain_24h: 41, api_value: 60, d: 1, rain_day: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }, { cell_id: 'c2', lat: 29.0, lon: -81.3, rain_24h: 29, api_value: 40, d: 1, rain_day: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }],
  parcels: [
    ...Array.from({ length: 9 }, (_, i) => ({ parcel_id: 'P' + i, address: `${100 + i} Palm Ave`, city: 'Port Orange' })),
    ...Array.from({ length: 5 }, (_, i) => ({ parcel_id: 'D' + i, address: `${200 + i} Oak St`, city: 'DeLand' })),
    ...Array.from({ length: 3 }, (_, i) => ({ parcel_id: 'O' + i, address: `${300 + i} Granada Blvd`, city: 'Ormond Beach' })),
  ],
};

/**
 * Route /crm/api/* for one browser context.
 * opts: { leads: FakeLeadsServer, enrich: fn, storm: object|null, calls: [] }
 */
export async function stubApis(context, opts) {
  const { queryFixtures } = await import(pathToFileURL(path.join(root, 'server/lib/fsi-fixtures.js')).href);
  const calls = opts.calls || [];
  await context.route(/\/crm\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const fn = url.pathname.split('/').pop();
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* ignore */ }
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (fn === 'academy-auth') return json({ ok: true, user: USER });
    if (fn === 'academy-leads') { const [s, o] = opts.leads.handle(body); return json(o, s); }
    if (fn === 'enrich-contacts' && opts.enrich) { const [s, o] = opts.enrich(body); return json(o, s); }
    if (fn === 'lead-outcomes') { calls.push({ fn, body }); return json({ ok: true, outcome: { lead_key: body.lead_key, outcome: body.outcome } }); }
    if (fn === 'fsi-parcels') {
      if (body.action === 'storm') { calls.push({ fn, action: 'storm', body }); return opts.storm ? json(opts.storm) : json({ error: 'storm list failed' }, 503); }
      const parcels = queryFixtures({ action: body.action || 'top', limit: body.limit || 200, minFsi: body.minFsi || 0 });
      return json({ ok: true, source: 'fixtures', count: parcels.length, truncated: false, parcels });
    }
    if (fn === 'academy-activity') { calls.push({ fn, body }); return json({ ok: true }); }
    if (fn === 'academy-admin') return json({ ok: true, users: [USER], activity: [], practice: [], leads: [] });
    if (fn === 'academy-drafts') return json({ ok: true, drafts: [] });
    return json({ ok: true });
  });
}

/** Seed session + leads once per tab (survives reloads in the same tab only via sessionStorage flag). */
export async function seed(context, { leads, extra = {} }) {
  await context.addInitScript(({ user, leads, extra }) => {
    if (sessionStorage.getItem('__f1_seeded')) return;
    sessionStorage.setItem('__f1_seeded', '1');
    localStorage.setItem('floguard_desk_auth_v1', JSON.stringify({ token: 'smoke-token', user }));
    localStorage.setItem('floguard_leads_v1', JSON.stringify(leads));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, { user: USER, leads, extra });
}

export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/openfreemap|hazards\.fema\.gov|ERR_FAILED|ERR_TUNNEL|ERR_CERT|Failed to load resource|AJAXError/i.test(t)) return;
    errors.push('console: ' + t);
  });
  return errors;
}
export { todayAt };

/**
 * One stub for the whole integrated app (R2 walkthrough + XSS test):
 * leads (FakeLeadsServer), enrich, the full fsi-parcels contract from the demo fixtures shaped by the
 * real API helpers (claims, events, polygons, search, storm), lead-outcomes (incl. field_report),
 * drafts, admin, chat, and estimates through the real handler when opts.estimates is given
 * ({ handler, makeReqRes }).
 * opts: { leads, enrich, calls, drafts, admin, searchExtra(parcels), parcelMap(p), outcomes(body) -> [status, json], chat }
 */
export async function stubAll(context, opts) {
  const fx = await import(pathToFileURL(path.join(root, 'server/lib/fsi-fixtures.js')).href);
  const api = await import(pathToFileURL(path.join(root, 'api/fsi-parcels.js')).href);
  const calls = opts.calls || [];
  const pm = opts.parcelMap || ((p) => p);
  await context.route(/\/crm\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const fn = url.pathname.split('/').pop();
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* ignore */ }
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (fn === 'academy-auth') return json({ ok: true, user: opts.user || USER });
    if (fn === 'academy-leads') {
      if (opts.estimates && /^(estimate_|job_|invoice_|jobs_)/.test(body.action || '')) {
        const { req, res } = opts.estimates.makeReqRes({ body, secret: 'test-secret' });
        Object.assign(req.headers, { 'user-agent': 'UITest/1.0', origin: url.origin, 'x-forwarded-for': '203.0.113.9' });
        await opts.estimates.handler(req, res);
        calls.push({ fn, action: body.action, body, status: res.statusCode });
        const out = opts.estimates.transform ? (opts.estimates.transform(body.action, res.body, res.statusCode) || res.body) : res.body;
        return route.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(out) });
      }
      const [s, o] = opts.leads.handle(body); return json(o, s);
    }
    if (fn === 'leads' && opts.publicLeads) {
      const { req, res } = opts.estimates.makeReqRes({ body });
      Object.assign(req.headers, { 'user-agent': 'UITest/1.0', origin: url.origin, 'x-forwarded-for': '203.0.113.10' });
      await opts.publicLeads(req, res);
      return route.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.body) });
    }
    if (fn === 'enrich-contacts' && opts.enrich) { const [s, o] = opts.enrich(body); return json(o, s); }
    if (fn === 'lead-outcomes') {
      calls.push({ fn, action: body.action, body });
      if (opts.outcomes) { const [s, o] = opts.outcomes(body); return json(o, s); }
      return json({ ok: true, outcome: { lead_key: body.lead_key, outcome: body.outcome } });
    }
    if (fn === 'academy-drafts') return json({ ok: true, backend: 'postgres', drafts: opts.drafts || [] });
    if (fn === 'academy-admin') return json(opts.admin ? opts.admin(body) : { ok: true, users: [opts.user || USER], activity: [], practice: [], leads: [], summary: {} });
    if (fn === 'academy-chat') return json({ ok: true, choices: [{ message: { role: 'assistant', content: opts.chat || 'Lead with the standing-water question, then book the assessment.' } }] });
    if (fn !== 'fsi-parcels') { calls.push({ fn, body }); return json({ ok: true }); }
    const action = body.action || 'viewport';
    calls.push({ fn, action, body });
    const box = Array.isArray(body.bbox) ? { w: body.bbox[0], s: body.bbox[1], e: body.bbox[2], n: body.bbox[3] } : null;
    if (action === 'claims_layer') {
      const f = fx.claimsLayerFixtures({ box, event: body.event || '', eventYear: body.eventYear ?? null, limit: body.limit || 400 });
      const rows = api.shapeClaimsLayerRows(f.bgRows, { eventRows: f.eventRows, includeGeom: !!body.includeGeom }).map((r) => ({ ...r, demo: true }));
      return json({ ok: true, source: 'fixtures', available: true, demo: true, count: rows.length, truncated: false, rows, note: 'DEMO' });
    }
    if (action === 'claims_events') {
      const events = api.shapeClaimsEvents(fx.claimsEventsFixtures({ minClaims: body.minClaims ?? 25 }));
      return json({ ok: true, source: 'fixtures', available: true, demo: true, count: events.length, events });
    }
    if (action === 'parcel_geom') {
      const features = api.shapeParcelGeom(fx.parcelGeomFixtures(box, body.limit || 600));
      return json({ ok: true, source: 'fixtures', available: true, demo: true, type: 'FeatureCollection', count: features.length, truncated: false, features });
    }
    if (action === 'search') {
      let parcels = fx.searchFixtures(api.sanitizeSearch(body.q)).map(pm);
      if (opts.searchExtra) parcels = opts.searchExtra(parcels, body.q);
      return json({ ok: true, source: 'fixtures', count: parcels.length, parcels });
    }
    if (action === 'storm') {
      if (opts.storm === null) return json({ error: 'storm list failed' }, 503);
      const s = fx.stormFixtures({ minRainMm: body.minRainMm, minBand: body.minBand, limit: body.limit });
      return json({ ok: true, source: 'fixtures', demo: true, minRainMm: body.minRainMm || 25, minBand: body.minBand || 'must', cells: s.cells, count: s.parcels.length, parcels: s.parcels.map(pm) });
    }
    let parcels = fx.queryFixtures({ action, limit: body.limit || 200, minFsi: body.minFsi || 0, mustBand: body.mustBand, sort: body.sort, box }).map(pm);
    if (opts.manyParcels) parcels = opts.manyParcels(parcels, body);
    return json({ ok: true, source: 'fixtures', count: parcels.length, truncated: false, parcels });
  });
}
