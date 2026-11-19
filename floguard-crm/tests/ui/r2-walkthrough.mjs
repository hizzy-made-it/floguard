/**
 * R2 walkthrough: drives the whole integrated CRM and writes screenshots + a metrics JSON.
 * Not a test (no assertions beyond "it ran"); run by hand:
 *
 *   PLAYWRIGHT_CORE=/tmp/etools/node_modules/playwright-core node tests/ui/r2-walkthrough.mjs before
 *   ... after
 *
 * Output: docs/handoff/R2-screens/<label>/*.png, metrics.json, and contact sheets (sheet-*.png)
 * when ImageMagick `montage` is on PATH. Viewports 1440x900, 1024x768, 390x844; light and dark;
 * server mode (fake Postgres leads API) and local mode (501). Every /crm/api/* call is stubbed.
 */
import '../estimates/helpers/env.js';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { loadPlaywright, chromePath, startServer, FakeLeadsServer, fakeEnrich, stubAll, f1Leads, watchErrors, root } from './lib/crm-harness.mjs';
import { setup } from '../estimates/helpers/setup.js';
import { makeReqRes } from '../leads/helpers/fake-supabase.js';

const label = process.argv[2] || 'before';
const PROXY = process.env.NO_TILES ? '' : (process.env.HTTPS_PROXY || process.env.https_proxy || '');
const only = process.argv[3] || '';
const out = path.join(root, 'docs/handoff/R2-screens', label);
fs.mkdirSync(out, { recursive: true });
const chromium = await loadPlaywright();
if (!chromium) { console.error('playwright-core not found'); process.exit(2); }

const VPS = [
  { name: 'd1440', width: 1440, height: 900 },
  { name: 'd1024', width: 1024, height: 768 },
  { name: 'm390', width: 390, height: 844, mobile: true },
];
const uuidOf = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const metrics = { label, at: new Date().toISOString(), screens: {}, errors: {}, perf: {} };

const fake = setup();
const { default: academy } = await import('../../api/academy-leads.js');
const { default: leadsApi } = await import('../../api/leads.js');

function allLeads() {
  const base = f1Leads();
  const fillers = Array.from({ length: 22 }, (_, i) => ({ id: 100 + i, name: `Filler Owner ${i + 1}`, city: ['Holly Hill', 'Port Orange', 'DeLand', 'Ormond Beach'][i % 4], address: `${10 + i} Ridgewood Ave, Holly Hill, FL 32117`, list: 'FrenchDrain', lists: ['FrenchDrain'], list_status: { FrenchDrain: ['New', 'Interested', 'Quoted', 'Callback'][i % 4] }, status: ['New', 'Interested', 'Quoted', 'Callback'][i % 4], phone: i % 3 ? '' : `(386) 555-02${String(i).padStart(2, '0')}`, amount: i % 4 === 2 ? 6000 + i * 100 : undefined, fsi_score: 40 + (i * 7) % 55 }));
  return base.concat(fillers);
}

async function probe(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const overflowX = de.scrollWidth - de.clientWidth;
    const map = document.getElementById('fsiMap');
    const r = map && map.offsetParent ? map.getBoundingClientRect() : null;
    const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const small = [];
    if (innerWidth < 500) {
      document.querySelectorAll('button, a[href], select, input:not([type=hidden]), summary, [role=button]').forEach((el) => {
        if (!vis(el)) return;
        if (el.closest('.mapboxgl-ctrl-attrib, .maplibregl-ctrl-attrib')) return;
        const b = el.getBoundingClientRect();
        if (b.bottom < 0 || b.top > innerHeight) return;
        if (b.height < 40 || b.width < 32) small.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]} ${Math.round(b.width)}x${Math.round(b.height)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`);
      });
    }
    return { overflowX, mapTop: r ? Math.round(r.top) : null, mapH: r ? Math.round(r.height) : null, mapPct: r ? Math.round(100 * Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top)) / innerHeight) : null, small: small.slice(0, 40), smallCount: small.length };
  });
}

async function shot(page, name, { full = false } = {}) {
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: full });
  try { metrics.screens[name] = await probe(page); } catch (e) { metrics.screens[name] = { err: String(e.message) }; }
}

async function newCtx(browser, vp, scheme, { mode = 'server', session = true } = {}) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  if (!PROXY) await context.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(new URL(u).hostname), (r) => r.abort());
  const calls = [];
  const leads = new FakeLeadsServer(allLeads(), { mode });
  leads.rows[0].activity.push({ id: 'seed1', lead_id: uuidOf(1), at: new Date(Date.now() - 2 * 86400000).toISOString(), actor: 'sean', type: 'call', direction: 'outbound', outcome: 'talked', body: 'Walked the side yard on the phone; wants an assessment.', meta: {} });
  await stubAll(context, {
    leads, calls, enrich: fakeEnrich({ calls }), estimates: { handler: academy, makeReqRes }, publicLeads: leadsApi,
    drafts: [{ id: 'd1', created_at: new Date().toISOString(), lead_key: 'Marisol Vega', subject: 'Standing water by your slab', status: 'pending', body: 'Hi Marisol,\n\nThanks for the call…', meta: { name: 'Marisol Vega', email: 'mvega@example.org' } }],
  });
  if (session) {
    await context.addInitScript(({ leads }) => {
      if (sessionStorage.getItem('__r2')) return;
      sessionStorage.setItem('__r2', '1');
      localStorage.setItem('floguard_desk_auth_v1', JSON.stringify({ token: 'smoke-token', user: { id: 'u_smoke', username: 'smoke', role: 'admin', tokens_used: 12500, tokens_limit: 50000, locked: false } }));
      localStorage.setItem('floguard_leads_v1', JSON.stringify(leads));
    }, { leads: allLeads() });
  }
  const page = await context.newPage();
  const errors = watchErrors(page);
  return { context, page, calls, errors, leads };
}

async function boot(page, server) {
  await page.goto(server.base, { waitUntil: 'load' });
  await page.waitForSelector('#appRoot:not(.hidden)', { timeout: 15000 });
  await page.waitForFunction(() => window.FG && FG.ready && document.querySelectorAll('#tbody tr[data-id]').length > 0, null, { timeout: 15000 });
  await page.evaluate(() => { document.querySelector('#tabs button[data-list="All"]').click(); window.launchUri = function () { return true; }; });
  await page.waitForTimeout(400);
}

async function closeAll(page) {
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(80); }
  await page.evaluate(() => { try { closeProfile(); } catch (e) { /* */ } document.querySelectorAll('.fg-modal-bg').forEach((m) => m.remove()); const e = document.querySelector('.est-bg'); if (e && e.hidden && getComputedStyle(e).display !== 'none') { window.__estBgLeak = true; e.style.display = 'none'; } });
}

async function walkServer(browser, server, vp, scheme) {
  const tag = `${vp.name}-${scheme}`;
  fake.tables.leads.length = 0; fake.tables.lead_estimates.length = 0; fake.tables.lead_jobs.length = 0; fake.tables.lead_activity.length = 0;
  fake.seedLead({ id: uuidOf(1), name: 'Marisol Vega', address: '412 Heron Bay Dr', city: 'Port Orange', zip: '32127', phone: '(386) 555-0142', email: 'mvega@example.org', stage: 'contacted', phone_dnc: false, parcel_id: '6303-01-00-0420' });
  const { context, page, errors } = await newCtx(browser, vp, scheme);
  await boot(page, server);
  await page.waitForFunction(() => document.documentElement.dataset.leadsMode === 'server', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, `leads-${tag}`);
  if (vp.name === 'd1440') await shot(page, `leads-full-${tag}`, { full: true });
  // board
  await page.click('#viewToggle [data-view="board"]');
  await shot(page, `board-${tag}`);
  await page.click('#viewToggle [data-view="table"]');
  // drawer
  await page.evaluate(() => openProfile(1));
  await page.waitForSelector('#profileDrawer.open');
  await page.waitForTimeout(500);
  await shot(page, `drawer-${tag}`);
  await page.evaluate(() => { const d = document.querySelector('#profileDrawer .drawer'); const a = document.getElementById('pfActivitySec'); if (d && a) d.scrollTop = a.offsetTop - 40; });
  await shot(page, `drawer-timeline-${tag}`);
  // estimate editor from the drawer
  const estBtn = page.locator('#pfActBar [data-fg-estimate], #pfExtActions [data-ext-action="estimate"]');
  metrics.screens[`estimate-buttons-${tag}`] = { count: await estBtn.count() };
  if (await estBtn.count()) {
    await estBtn.first().click();
    await page.waitForSelector('.est-modal', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const add = await page.$('#estAddSel');
    if (add) { await page.selectOption('#estAddSel', 'french_drain_sump_system'); await page.click('[data-est=addLine]'); await page.fill('#estLp0', '8200'); }
    await shot(page, `estimate-${tag}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  await closeAll(page);
  // enrich modal
  await page.click('#enrichBtn');
  await page.waitForSelector('.fg-modal', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, `enrich-${tag}`);
  await closeAll(page);
  // DNC blocked dial modal
  const call3 = page.locator('#tbody tr[data-id="3"] [data-dial="call"]');
  if (await call3.count()) { await call3.first().click({ force: true }); await page.waitForSelector('.fg-blocked', { timeout: 3000 }).catch(() => {}); await shot(page, `dnc-${tag}`); await closeAll(page); }
  // toast
  await page.evaluate(() => FG.toast('Marisol Vega moved to Estimate sent.', { kind: 'ok', action: { label: 'Undo', fn() {} } }));
  await shot(page, `toast-${tag}`);
  // map
  await page.evaluate(() => goTab('fsi'));
  await page.waitForFunction(() => document.querySelectorAll('#fsiList .fsi-row').length > 0, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await shot(page, `map-${tag}`);
  await page.locator('#fsiList .fsi-row').first().click().catch(() => {});
  await page.waitForTimeout(700);
  await shot(page, `map-detail-${tag}`);
  await page.evaluate(() => { const w = document.getElementById('fsiDrWhy'); if (w) w.open = true; });
  await page.waitForTimeout(300);
  await shot(page, `map-why-${tag}`);
  await page.evaluate(() => { const c = document.getElementById('fsiDrClose'); if (c) c.click(); });
  await page.waitForTimeout(200);
  // layers
  await page.click('#fsiLayersBtn').catch(() => {});
  await shot(page, `map-layers-${tag}`);
  await page.click('#fsiLayersBtn').catch(() => {});
  // search
  await page.fill('#fsiMapSearchInput', 'palm').catch(() => {});
  await page.waitForTimeout(900);
  await shot(page, `map-search-${tag}`);
  await page.fill('#fsiMapSearchInput', '').catch(() => {});
  await page.keyboard.press('Escape');
  // storm preset
  await page.click('#fsiPresets [data-preset="storm"]').catch(() => {});
  await page.waitForTimeout(1200);
  await shot(page, `map-storm-${tag}`);
  // other panels
  for (const p of ['drafts', 'docs', 'coach', 'roleplay', 'review', 'playbook', 'settings', 'admin']) {
    await page.evaluate((n) => goTab(n), p);
    await page.waitForTimeout(450);
    if (p === 'drafts') await page.click('.draft-open').catch(() => {});
    await shot(page, `${p}-${tag}`);
  }
  metrics.errors[tag] = errors.slice();
  await context.close();
}

async function walkLocal(browser, server, vp, scheme) {
  const tag = `${vp.name}-${scheme}`;
  const { context, page, errors } = await newCtx(browser, vp, scheme, { mode: 'local' });
  await boot(page, server);
  await page.waitForFunction(() => document.documentElement.dataset.leadsMode === 'local', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, `local-leads-${tag}`);
  await page.evaluate(() => openProfile(1));
  await page.waitForSelector('#profileDrawer.open');
  const estBtn = page.locator('#pfActBar [data-fg-estimate], #pfExtActions [data-ext-action="estimate"]');
  if (await estBtn.count()) { await estBtn.first().click(); await page.waitForTimeout(800); await shot(page, `local-estimate-${tag}`); }
  metrics.errors['local-' + tag] = errors.slice();
  await context.close();
}

async function walkLogin(browser, server, vp, scheme) {
  const { context, page } = await newCtx(browser, vp, scheme, { session: false });
  await page.goto(server.base, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await shot(page, `login-${vp.name}-${scheme}`);
  await context.close();
}

async function walkProposal(browser, server) {
  fake.tables.leads.length = 0; fake.tables.lead_estimates.length = 0;
  const lead = fake.seedLead({ id: uuidOf(1), name: 'Marisol Vega', address: '412 Heron Bay Dr', city: 'Port Orange', zip: '32127', stage: 'contacted', phone: '(386) 555-0142', phone_dnc: false });
  const call = async (body) => { const { req, res } = makeReqRes({ body, secret: 'test-secret' }); await academy(req, res); return res.body; };
  const c = await call({ action: 'estimate_create', lead_id: lead.id, line_items: [{ catalog_id: 'french_drain_sump_system', quantity: 1, unit_price: 8200 }], notes_to_customer: 'Crew arrives between 8 and 10.' });
  const s = await call({ action: 'estimate_send', estimate_id: c.estimate.id });
  const token = s.public_url.split('/proposal/')[1];
  for (const vp of [VPS[0], VPS[2]]) {
    const { context, page } = await newCtx(browser, vp, 'light', { session: false });
    await page.goto(`${server.base}proposal.html?t=${token}`, { waitUntil: 'load' });
    await page.waitForSelector('.pp-doc', { timeout: 8000 }).catch(() => {});
    await shot(page, `proposal-${vp.name}`, { full: true });
    if (vp.name === 'd1440') { await page.emulateMedia({ media: 'print' }); await shot(page, 'proposal-print', { full: true }); }
    await context.close();
  }
}

async function perf(browser, server) {
  const { context, page } = await newCtx(browser, VPS[0], 'light');
  const reqs = [];
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname) || u.pathname.includes('/api/')) return;
    let size = 0; try { size = (await r.body()).length; } catch (e) { /* */ }
    reqs.push({ path: u.pathname, size, type: r.request().resourceType() });
  });
  const t0 = Date.now();
  await boot(page, server);
  const bootMs = Date.now() - t0;
  const sum = (f) => reqs.filter(f).reduce((n, r) => n + r.size, 0);
  metrics.perf.firstLoad = { requests: reqs.length, js: sum((r) => r.path.endsWith('.js')), css: sum((r) => r.path.endsWith('.css')), fonts: sum((r) => /woff2?$/.test(r.path)), html: sum((r) => r.path.endsWith('/') || r.path.endsWith('.html')), total: sum(() => true), bootMs, list: reqs.map((r) => `${r.path} ${r.size}`) };
  // 2,000 leads: render time of the table
  const t = await page.evaluate(async () => {
    const big = []; for (let i = 0; i < 2000; i++) big.push({ id: 5000 + i, name: 'Bulk Owner ' + i, city: ['Holly Hill', 'Port Orange', 'DeLand'][i % 3], address: i + ' Palm Ave', list: 'FrenchDrain', lists: ['FrenchDrain'], list_status: { FrenchDrain: 'New' }, status: 'New', phone: i % 2 ? '(386) 555-' + String(1000 + i).slice(-4) : '', fsi_score: i % 100 });
    state.push(...big.map(normalizeLead));
    const runs = [];
    for (let k = 0; k < 3; k++) { const a = performance.now(); render(); runs.push(performance.now() - a); await new Promise((r) => setTimeout(r, 50)); }
    const rows = document.querySelectorAll('#tbody tr').length;
    // board
    const b0 = performance.now(); document.querySelector('#viewToggle [data-view="board"]').click(); const board = performance.now() - b0;
    document.querySelector('#viewToggle [data-view="table"]').click();
    // search keystroke
    const s0 = performance.now(); const inp = document.getElementById('search'); inp.value = 'bulk owner 19'; inp.dispatchEvent(new Event('input', { bubbles: true })); const search = performance.now() - s0;
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
    return { renderMs: runs.map((x) => Math.round(x)), rows, boardMs: Math.round(board), searchMs: Math.round(search), domNodes: document.getElementsByTagName('*').length };
  });
  metrics.perf.leads2000 = t;
  await context.close();
}

const server = await startServer();
const browser = await chromium.launch({ executablePath: chromePath(), args: PROXY ? [`--proxy-server=${PROXY}`] : [] });
try {
  if (!only || only === 'perf') await perf(browser, server);
  for (const vp of VPS) {
    for (const scheme of ['light', 'dark']) {
      if (!only || only === 'server') await walkServer(browser, server, vp, scheme);
      if (!only || only === 'login') await walkLogin(browser, server, vp, scheme);
      if ((!only || only === 'local') && vp.name !== 'd1024') await walkLocal(browser, server, vp, scheme);
      console.log('done', vp.name, scheme);
    }
  }
  if (!only || only === 'proposal') await walkProposal(browser, server);
} finally {
  await browser.close();
  server.stop();
  fake.restore();
}
fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 1));

// Contact sheets: one per screen kind, 6 variants side by side, for quick review.
try {
  const files = fs.readdirSync(out).filter((f) => f.endsWith('.png') && !f.startsWith('sheet-'));
  const kinds = [...new Set(files.map((f) => f.replace(/-(d1440|d1024|m390)(-(light|dark))?\.png$/, '')))];
  for (const k of kinds) {
    const set = files.filter((f) => f.startsWith(k + '-') && /-(d1440|d1024|m390)/.test(f) && f.replace(/-(d1440|d1024|m390)(-(light|dark))?\.png$/, '') === k).sort();
    if (set.length < 2) continue;
    execFileSync('montage', [...set.map((f) => path.join(out, f)), '-tile', `${Math.min(set.length, 2)}x`, '-geometry', '720x450>+6+6', '-background', '#888', '-title', k, path.join(out, `sheet-${k}.png`)]);
  }
} catch (e) { console.error('montage failed', e.message); }
console.log(JSON.stringify({ perf: metrics.perf.firstLoad && { ...metrics.perf.firstLoad, list: undefined }, leads2000: metrics.perf.leads2000, errors: metrics.errors }, null, 1));
