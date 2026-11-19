/**
 * Browser smoke test for the CRM front end (public/crm).
 *
 *   node --test tests/ui/            (from floguard-crm/)
 *
 * Needs a Chromium and the `playwright-core` package. Neither is a project dependency:
 *   - install once outside the repo, e.g.  npm i --prefix /tmp/pw playwright-core
 *     and run with  PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core
 *   - Chromium: CHROME_PATH=/usr/bin/google-chrome (default tries that, then playwright's own).
 * If either is missing the test is skipped, not failed.
 *
 * What it does (test browser only; real auth is untouched):
 *   - starts scripts/dev-server.mjs on a free port
 *   - stubs /crm/api/* at the network layer: academy-auth `me` returns a demo admin,
 *     academy-leads list returns [], fsi-parcels returns the bundled FIXTURE parcels
 *   - seeds localStorage with a fake session (floguard_desk_auth_v1) and sample leads
 *   - asserts: no console errors / page errors, every nav target opens its panel,
 *     add lead / edit in profile drawer / search filter persist to localStorage,
 *     light + dark theme both render, map panel builds its list
 *   - SCREENS=<dir> also writes screenshots (1440x900 and 390x844, Leads + Flood Map, light + dark)
 * External hosts (map tiles) go through HTTPS_PROXY when set, else are blocked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

async function loadPlaywright() {
  const cands = [process.env.PLAYWRIGHT_CORE, 'playwright-core', '/tmp/etools/node_modules/playwright-core'].filter(Boolean);
  for (const c of cands) {
    try {
      const spec = c.startsWith('/') ? pathToFileURL(path.join(c, 'index.mjs')).href : c;
      const m = await import(spec);
      return m.chromium || m.default?.chromium;
    } catch (e) { /* try next */ }
  }
  return null;
}
function chromePath() {
  for (const p of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined; // let playwright try its bundled build
}
function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
}

export const SAMPLE_LEADS = [
  { id: 1, name: 'Marisol Vega', city: 'Port Orange', address: '412 Heron Bay Dr, Port Orange, FL 32127', zip: '32127', industry: 'Homeowner', list: 'FrenchDrain', lists: ['FrenchDrain', 'YardDrainage'], list_status: { FrenchDrain: 'Interested', YardDrainage: 'New' }, status: 'Interested', phone: '(386) 555-0142', email: 'mvega@example.org', website: '', contact: '', notes: 'Standing water by slab 3 days after storms.', amount: '8400', source: 'fsi-map', parcel_id: '6303-01-00-0420' },
  { id: 2, name: 'Coastal Property Pros', city: 'Daytona Beach', address: '220 Beach St, Daytona Beach, FL 32114', zip: '32114', industry: 'Property management company', list: 'PropertyMgmt', lists: ['PropertyMgmt'], list_status: { PropertyMgmt: 'Quoted' }, status: 'Quoted', phone: '(386) 555-0199', email: '', website: 'coastalpp.example', contact: 'Dana', notes: '40 doors, wet-season complaints.', amount: '15000' },
  { id: 3, name: 'Robert Lindqvist', city: 'Ormond Beach', address: '17 Tomoka Oaks Blvd, Ormond Beach, FL 32174', zip: '32174', industry: 'Homeowner', list: 'SumpPump', lists: ['SumpPump'], list_status: { SumpPump: 'Called - no answer' }, status: 'Called - no answer', phone: '', email: '', website: '', contact: '', notes: '' },
  { id: 4, name: 'Halifax Crawlspace Co', city: 'New Smyrna Beach', address: '', industry: 'Crawl space repair', list: 'SumpPump', lists: ['SumpPump', 'Maintenance'], list_status: { SumpPump: 'Callback', Maintenance: 'New' }, status: 'Callback', phone: '(386) 555-0110', email: 'office@halifaxcrawl.example', website: '', contact: '', notes: '', maintenance_frequency: 'quarterly', maintenance_next_due: new Date().toISOString().slice(0, 10) },
  { id: 5, name: 'Priya Natarajan', city: 'DeLand', address: '905 N Woodland Blvd, DeLand, FL 32720', zip: '32720', industry: 'Homeowner', list: 'YardDrainage', lists: ['YardDrainage'], list_status: { YardDrainage: 'Contract signed' }, status: 'Contract signed', phone: '(386) 555-0177', email: 'priya.n@example.org', website: '', contact: '', notes: 'Lanai floods; channel drain + regrade.', amount: '5200' },
  { id: 6, name: 'Gerald Okafor', city: 'Port Orange', address: '33 Spruce Creek Rd, Port Orange, FL 32127', zip: '32127', industry: 'Homeowner', list: 'FrenchDrain', lists: ['FrenchDrain'], list_status: { FrenchDrain: 'New' }, status: 'New', phone: '', email: '', website: '', contact: '', notes: '' },
];
const USER = { id: 'u_smoke', username: 'smoke', role: 'admin', tokens_used: 12500, tokens_limit: 50000, locked: false };

async function stubApis(context) {
  const { queryFixtures } = await import(pathToFileURL(path.join(root, 'server/lib/fsi-fixtures.js')).href);
  await context.route(/\/crm\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const fn = url.pathname.split('/').pop();
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* ignore */ }
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (fn === 'academy-auth') return json({ ok: true, user: USER });
    if (fn === 'academy-leads') {
      if (body.action === 'list') return json({ ok: true, leads: [] });
      if (body.action === 'prune_placeholders') return json({ ok: true, removed: 0, remaining: 0 });
      return json({ ok: true });
    }
    if (fn === 'fsi-parcels') {
      const parcels = queryFixtures({ action: body.action || 'top', limit: body.limit || 200, minFsi: body.minFsi || 0 });
      return json({ ok: true, source: 'fixtures', count: parcels.length, truncated: false, parcels });
    }
    if (fn === 'academy-admin') return json({ ok: true, users: [USER], activity: [], practice: [], leads: [] });
    if (fn === 'academy-drafts') return json({ ok: true, drafts: [] });
    return json({ ok: true });
  });
}

async function startServer() {
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(root, 'scripts/dev-server.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('dev server did not start')), 10000);
    proc.stdout.on('data', (d) => { if (String(d).includes('dev server')) { clearTimeout(t); res(); } });
    proc.on('exit', (c) => rej(new Error('dev server exited ' + c)));
  });
  return { port, stop: () => proc.kill() };
}

const chromium = await loadPlaywright();
const skip = !chromium ? 'playwright-core not found (set PLAYWRIGHT_CORE)' : false;

test('CRM boots, navigates, edits leads, renders map (desktop + mobile, light + dark)', { skip, timeout: 180000 }, async () => {
  const server = await startServer();
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: proxy ? [`--proxy-server=${proxy}`] : [],
  });
  const screens = process.env.SCREENS ? path.resolve(process.env.SCREENS) : null;
  if (screens) fs.mkdirSync(screens, { recursive: true });
  const base = `http://localhost:${server.port}/crm/`;
  try {
    for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      for (const scheme of ['light', 'dark']) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          colorScheme: scheme,
          ignoreHTTPSErrors: true,
          isMobile: vp.name === 'mobile',
          hasTouch: vp.name === 'mobile',
          deviceScaleFactor: 1,
        });
        if (!proxy) await context.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(new URL(u).hostname), (r) => r.abort());
        await stubApis(context);
        await context.addInitScript(({ user, leads }) => {
          if (sessionStorage.getItem('__smoke_seeded')) return;
          sessionStorage.setItem('__smoke_seeded', '1');
          localStorage.setItem('floguard_desk_auth_v1', JSON.stringify({ token: 'smoke-token', user }));
          localStorage.setItem('floguard_leads_v1', JSON.stringify(leads));
        }, { user: USER, leads: SAMPLE_LEADS });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
        page.on('console', (m) => {
          if (m.type() !== 'error') return;
          const t = m.text();
          // External tile/style fetches may fail offline; app code errors must not.
          if (/openfreemap|hazards\.fema\.gov|ERR_FAILED|ERR_TUNNEL|ERR_CERT|Failed to load resource|AJAXError/i.test(t)) return;
          errors.push('console: ' + t);
        });
        const tag = `${vp.name}-${scheme}`;
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForSelector('#appRoot:not(.hidden)', { timeout: 10000 });
        await page.waitForFunction(() => document.querySelectorAll('#tbody tr').length > 0, null, { timeout: 10000 });
        // Show all causes so every sample lead is in the table
        await page.evaluate(() => document.querySelector('#tabs button[data-list="All"]').click());
        const rows = await page.locator('#tbody tr').count();
        assert.equal(rows, 6, `${tag}: 6 sample leads rendered`);
        await page.waitForTimeout(300);
        if (screens) await page.screenshot({ path: path.join(screens, `leads-${tag}.png`) });

        // Every nav target opens its panel
        const targets = await page.$$eval('#nav button[data-p]', (bs) => bs.map((b) => b.dataset.p));
        assert.ok(targets.length >= 10, `${tag}: 10 nav targets (got ${targets.length})`);
        for (const p of targets) {
          await page.evaluate((name) => goTab(name), p);
          const on = await page.$eval('#p-' + p, (el) => el.classList.contains('on') && el.getBoundingClientRect().height > 0);
          assert.ok(on, `${tag}: panel ${p} visible after nav`);
          const cur = await page.$eval(`#nav button[data-p="${p}"]`, (b) => b.classList.contains('on'));
          assert.ok(cur, `${tag}: nav ${p} marked active`);
        }
        // Real click path on desktop
        if (vp.name === 'desktop') {
          await page.click('#nav button[data-p="leads"]');
          assert.ok(await page.$eval('#p-leads', (el) => el.classList.contains('on')));
        }

        // Flood map panel
        await page.evaluate(() => goTab('fsi'));
        await page.waitForFunction(() => document.querySelectorAll('#fsiList .fsi-row').length > 0, null, { timeout: 15000 });
        await page.waitForTimeout(vp.name === 'desktop' ? 2500 : 2000);
        if (screens) await page.screenshot({ path: path.join(screens, `map-${tag}.png`) });
        // select first ranked target opens detail
        await page.locator('#fsiList .fsi-row').first().click();
        await page.waitForTimeout(400);
        if (screens && scheme === 'light') await page.screenshot({ path: path.join(screens, `map-detail-${tag}.png`) });

        // Leads: add, edit via drawer, filter
        await page.evaluate(() => goTab('leads'));
        await page.evaluate(() => document.querySelector('#tabs button[data-list="All"]').click());
        await page.evaluate(() => document.getElementById('addBtn').click());
        let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('floguard_leads_v1')));
        assert.equal(stored.length, 7, `${tag}: add lead persisted`);
        const newId = stored[0].id;
        await page.evaluate((id) => openProfile(id), newId);
        await page.waitForSelector('#profileDrawer.open');
        if (screens && scheme === 'light') { await page.waitForTimeout(250); await page.screenshot({ path: path.join(screens, `drawer-${tag}.png`) }); }
        await page.fill('#pfAddress', '1 Smoke Test Ln, Port Orange, FL 32127');
        await page.fill('#pfCity', 'Port Orange');
        await page.fill('#pfPhone', '(386) 555-0000');
        // name lives on the table row input; set it through the drawer-less path below
        await page.click('#pfSave');
        await page.evaluate(() => closeProfile());
        await page.locator(`#tbody tr[data-id="${newId}"] input[data-f="name"]`).fill('Smoke Lead');
        stored = await page.evaluate(() => JSON.parse(localStorage.getItem('floguard_leads_v1')));
        const nl = stored.find((l) => l.id === newId);
        assert.equal(nl.name, 'Smoke Lead', `${tag}: inline name edit persisted`);
        assert.equal(nl.phone, '(386) 555-0000', `${tag}: drawer phone edit persisted`);
        assert.equal(nl.address, '1 Smoke Test Ln, Port Orange, FL 32127', `${tag}: drawer address persisted`);
        await page.fill('#search', 'vega');
        assert.equal(await page.locator('#tbody tr').count(), 1, `${tag}: search filters rows`);
        await page.fill('#search', '');
        await page.selectOption('#cityFilter', 'Ormond Beach');
        assert.equal(await page.locator('#tbody tr').count(), 1, `${tag}: city filter`);
        await page.selectOption('#cityFilter', '');

        assert.deepEqual(errors, [], `${tag}: no console/page errors`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.stop();
  }
});
