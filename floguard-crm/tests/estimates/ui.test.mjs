/**
 * Browser test for the estimate editor (public/crm/js/20-estimates.js) and the customer proposal page
 * (public/crm/proposal.html). Skipped when playwright-core / Chrome are missing (same setup as tests/ui):
 *
 *   npm i --prefix /tmp/pw playwright-core
 *   SCREENS=docs/handoff/G-screens PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core node --test tests/estimates/ui.test.mjs
 *
 * Real handlers (api/academy-leads.js, api/leads.js, server/lib/estimates.js) run in this process against the
 * in-memory fake Supabase; the browser's /crm/api/* calls are routed to them. Static files come from scripts/dev-server.mjs.
 */
import './helpers/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { setup, seedLead } from './helpers/setup.js';
import { makeReqRes } from '../leads/helpers/fake-supabase.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

async function loadPlaywright() {
  const cands = [process.env.PLAYWRIGHT_CORE, 'playwright-core', '/tmp/etools/node_modules/playwright-core', '/tmp/pw/node_modules/playwright-core'].filter(Boolean);
  for (const c of cands) {
    try {
      const spec = c.startsWith('/') ? pathToFileURL(path.join(c, 'index.mjs')).href : c;
      const m = await import(spec);
      return m.chromium || m.default?.chromium;
    } catch (e) { /* next */ }
  }
  return null;
}
const chromePath = () => [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && fs.existsSync(p));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

const chromium = await loadPlaywright();
const skip = !chromium ? 'playwright-core not found (set PLAYWRIGHT_CORE)' : false;

test('estimate editor and proposal page: build, send, view, accept, job, invoice record (desktop + mobile + print)', { skip, timeout: 240000 }, async () => {
  const fake = setup();
  const { default: academy } = await import('../../api/academy-leads.js');
  const { default: leadsApi } = await import('../../api/leads.js');
  const lead = seedLead(fake, { name: 'Marisol Vega' });

  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(root, 'scripts/dev-server.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('dev server did not start')), 10000);
    proc.stdout.on('data', (d) => { if (String(d).includes('dev server')) { clearTimeout(t); res(); } });
    proc.on('exit', (c) => rej(new Error('dev server exited ' + c)));
  });
  const screens = process.env.SCREENS ? path.resolve(process.env.SCREENS) : null;
  if (screens) fs.mkdirSync(screens, { recursive: true });
  const shot = async (page, name, opts = {}) => { if (screens) await page.screenshot({ path: path.join(screens, name), ...opts }); };
  const browser = await chromium.launch({ executablePath: chromePath() });
  const base = `http://localhost:${port}/crm/`;
  const errors = [];

  async function routeApis(context, { storageBackend = false } = {}) {
    await context.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(new URL(u).hostname), (r) => r.abort());
    await context.route(/\/crm\/api\//, async (route) => {
      const fn = new URL(route.request().url()).pathname.split('/').pop();
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* ignore */ }
      const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
      const real = async (handler, extra = {}) => {
        const { req, res } = makeReqRes({ body, secret: 'test-secret' });
        Object.assign(req.headers, { 'user-agent': 'UITest/1.0', origin: `http://localhost:${port}`, ...extra });
        req.headers['x-forwarded-for'] = '203.0.113.9';
        await handler(req, res);
        return route.fulfill({ status: res.statusCode, contentType: 'application/json', headers: Object.fromEntries(Object.entries(res.headers).filter(([k]) => k !== 'content-type')), body: JSON.stringify(res.body) });
      };
      if (fn === 'academy-auth') return json({ ok: true, user: { id: 'u', username: 'smoke', role: 'admin', tokens_used: 0, tokens_limit: 50000 } });
      if (fn === 'leads') return real(leadsApi);
      if (fn === 'academy-leads') {
        if (/^(estimate_|job_|invoice_|jobs_)/.test(body.action || '')) return real(academy);
        if (body.action === 'list') return json({ ok: true, leads: [] });
        return json({ ok: true });
      }
      return json({ ok: true });
    });
  }
  const seedBrowser = (context) => context.addInitScript(({ id, uuid }) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.setItem('floguard_desk_auth_v1', JSON.stringify({ token: 'smoke-token', user: { id: 'u', username: 'smoke', role: 'admin' } }));
    localStorage.setItem('floguard_leads_v1', JSON.stringify([{ id, uuid, name: 'Marisol Vega', city: 'Port Orange', address: '412 Heron Bay Dr', zip: '32127', industry: 'Homeowner', list: 'FrenchDrain', lists: ['FrenchDrain'], list_status: { FrenchDrain: 'Interested' }, status: 'Interested', phone: '(386) 555-0142', email: 'mvega@example.org', notes: '' }]));
  }, { id: Number(lead.legacy_id), uuid: lead.id });

  try {
    for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      fake.tables.lead_estimates.length = 0; fake.tables.lead_jobs.length = 0; fake.tables.lead_activity.length = 0;
      fake.tables.leads.find((l) => l.id === lead.id).stage = 'contacted';
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.name === 'mobile', hasTouch: vp.name === 'mobile', colorScheme: 'light', acceptDownloads: false });
      await routeApis(context);
      await seedBrowser(context);
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${vp.name} pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`${vp.name} console: ${m.text()}`); });
      await page.goto(base, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof openProfile === 'function' && document.getElementById('appRoot') && !document.getElementById('appRoot').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
      await page.evaluate((id) => openProfile(id), Number(lead.legacy_id));
      await page.waitForSelector('#pfActBar [data-fg-estimate]', { timeout: 8000 });
      await shot(page, `drawer-entry-${vp.name}.png`);

      // --- editor -------------------------------------------------------------
      await page.click('#pfActBar [data-fg-estimate]');
      await page.waitForSelector('.est-modal #estAddSel');
      assert.ok(await page.locator('.est-warn', { hasText: 'Draft terms' }).count(), 'draft-terms warning is visible in the editor');
      await page.selectOption('#estAddSel', 'french_drain_sump_system');
      await page.click('[data-est=addLine]');
      await page.fill('#estLp0', '13000');
      assert.match(await page.locator('[data-band="0"]').innerText(), /Outside band/);
      await page.waitForSelector('[data-reason="0"]:not([hidden])');
      assert.match(await page.locator('#estSum').innerText(), /\$13,000\.00/);
      await shot(page, `editor-out-of-band-${vp.name}.png`);
      await page.click('[data-est=save]');
      await page.waitForSelector('.est-err');
      assert.match(await page.locator('.est-err').innerText(), /band/i, 'server refuses an out-of-band price without a reason');
      await page.fill('#estLp0', '8200');
      assert.match(await page.locator('[data-band="0"]').innerText(), /Inside band/);
      await page.fill('#estNotes', 'Gate code is on file. Crew arrives between 8 and 10.');
      await page.click('[data-est=save]');
      await page.waitForSelector('.est-ok');
      assert.match(await page.locator('#estTitle').innerText(), /FG-\d{4}-0001/);
      await shot(page, `editor-draft-${vp.name}.png`);

      // --- preview (draft) opens the proposal page with the draft handed over by postMessage ---------
      const [pv] = await Promise.all([context.waitForEvent('page'), page.click('[data-est=preview]')]);
      await pv.waitForSelector('.pp-doc', { timeout: 10000 });
      assert.match(await pv.locator('.pp-banner--preview').innerText(), /PREVIEW/);
      assert.match(await pv.locator('.pp-sum-total').innerText(), /\$8,200\.00/);
      assert.equal(await pv.locator('.pp-accept button[type=submit]').isDisabled(), true, 'cannot accept a preview');
      await shot(pv, `proposal-preview-${vp.name}.png`, { fullPage: true });
      await pv.close();

      // --- send -----------------------------------------------------------------------------------
      await page.click('[data-est=send]');
      await page.waitForSelector('[data-est=sendNow]');
      await page.click('[data-est=sendNow]');
      await page.waitForSelector('#estSend');
      const url = await page.inputValue('#estUrl');
      assert.match(url, /^https:\/\/crm\.example\.test\/proposal\/[A-Za-z0-9_-]{43}$/);
      assert.match(await page.inputValue('#estMsg'), /FG-/);
      assert.ok(await page.locator('#estSend a[href^="mailto:"]').count());
      assert.ok(await page.locator('#estSend a[href^="sms:"]').count());
      await shot(page, `editor-sent-${vp.name}.png`);
      const token = url.split('/proposal/')[1];

      // --- customer page: view, print, accept -----------------------------------------------------------
      const cust = await context.newPage();
      cust.on('pageerror', (e) => errors.push(`${vp.name} proposal pageerror: ${e.message}`));
      cust.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`${vp.name} proposal console: ${m.text()}`); });
      await cust.goto(`${base}proposal.html?t=${token}`, { waitUntil: 'load' });
      await cust.waitForSelector('.pp-doc');
      assert.match(await cust.locator('.pp-for-name').innerText(), /Marisol Vega/);
      assert.match(await cust.locator('.pp-sum-total').innerText(), /\$8,200\.00/);
      assert.ok(await cust.locator('.pp-draft-flag').count(), 'draft terms flag is shown while terms are placeholders');
      assert.equal(await cust.locator('script[src*="js/0"], script[src*="js/1"]').count(), 0, 'no CRM bundle on the customer page');
      assert.equal(await cust.evaluate(() => typeof getToken), 'undefined', 'no CRM globals');
      const src = fs.readFileSync(path.join(root, 'public/crm/js/proposal.js'), 'utf8');
      assert.ok(!/localStorage|sessionStorage|getToken|innerHTML|document\.write|eval\(/.test(src), 'proposal.js never touches storage or auth and never uses innerHTML');
      assert.match(await cust.locator('meta[name=robots]').getAttribute('content'), /noindex/);
      await shot(cust, `proposal-${vp.name}.png`, { fullPage: true });
      if (vp.name === 'desktop') {
        await cust.emulateMedia({ media: 'print' });
        assert.equal(await cust.locator('.pp-accept').isVisible(), false, 'accept block hidden when printing');
        await shot(cust, 'proposal-print.png', { fullPage: true });
        const pdf = await cust.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.55in', bottom: '0.55in', left: '0.55in', right: '0.55in' } });
        const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
        assert.ok(pages >= 1 && pages <= 2, `prints to ${pages} page(s)`);
        if (screens) fs.writeFileSync(path.join(screens, 'proposal-print.pdf'), pdf);
        await cust.emulateMedia({ media: 'screen' });
      }
      // bad submissions are blocked client side
      await cust.click('.pp-accept button[type=submit]');
      assert.match(await cust.locator('.pp-msg').innerText(), /first and last name/);
      await cust.fill('#ppName', 'Marisol Vega');
      await cust.click('.pp-accept button[type=submit]');
      assert.match(await cust.locator('.pp-msg').innerText(), /tick the box/);
      await cust.check('#ppConsent');
      await cust.click('.pp-accept button[type=submit]');
      await cust.waitForSelector('.pp-banner--ok');
      assert.match(await cust.locator('.pp-banner--ok').innerText(), /Accepted by Marisol Vega/);
      await shot(cust, `proposal-accepted-${vp.name}.png`, { fullPage: true });
      await cust.reload({ waitUntil: 'load' });
      await cust.waitForSelector('.pp-banner--ok');
      assert.equal(await cust.locator('.pp-accept').count(), 0, 'no accept form after acceptance');
      await cust.close();
      assert.equal(fake.tables.leads.find((l) => l.id === lead.id).stage, 'won');

      // --- back in the CRM: status timeline, job, invoice record ------------------------------------------
      await page.click('[data-est=back]');
      await page.waitForSelector('.est-item');
      await page.click('.est-item >> nth=0');
      await page.waitForSelector('.est-tl');
      const tl = await page.locator('.est-tl').innerText();
      assert.match(tl, /Sent to customer/); assert.match(tl, /Customer opened the link/); assert.match(tl, /Accepted by Marisol Vega/);
      await page.fill('#estJobWhen', '2026-12-04T09:30');
      await page.click('[data-est=mkJob]');
      await page.waitForSelector('#estJob');
      await shot(page, `editor-accepted-job-${vp.name}.png`);
      await page.selectOption('#estJStatus', 'complete');
      await page.click('[data-est=saveJob]');
      await page.waitForFunction(() => /Job saved/.test(document.querySelector('.est-ok')?.textContent || ''));
      await page.fill('#estIN', 'INV-1001');
      await page.selectOption('#estIS', 'sent');
      await page.click('[data-est=saveInv]');
      await page.waitForFunction(() => /Invoice record saved/.test(document.querySelector('.est-ok')?.textContent || ''));
      assert.equal(fake.tables.lead_jobs[0].invoice_status, 'sent');
      assert.equal(fake.tables.lead_jobs[0].invoice_number, 'INV-1001');
      await shot(page, `editor-invoice-${vp.name}.png`);

      // --- void on a fresh estimate kills the link ------------------------------------------------------------
      await page.click('[data-est=back]');
      await page.click('[data-est=new]');
      await page.selectOption('#estAddSel', 'exterior_french_drain');
      await page.click('[data-est=addLine]');
      await page.fill('#estLp0', '5000');
      await page.click('[data-est=send]');
      await page.click('[data-est=sendNow]');
      await page.waitForSelector('#estSend');
      const tok2 = (await page.inputValue('#estUrl')).split('/proposal/')[1];
      await page.click('[data-est=void]');
      await page.fill('#estVoidR', 'Wrong customer');
      await page.click('[data-est=voidNow]');
      await page.waitForFunction(() => /voided/.test(document.querySelector('.est-ok')?.textContent || ''));
      const gone = await context.newPage();
      await gone.goto(`${base}proposal.html?t=${tok2}`, { waitUntil: 'load' });
      await gone.waitForSelector('.pp-error-card');
      assert.match(await gone.locator('.pp-error-card').innerText(), /Estimate not found/);
      await gone.close();
      await context.close();
    }

    // --- storage backend: friendly message instead of a failure -----------------------------------------
    process.env.ACADEMY_DATA_BACKEND = 'storage';
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await routeApis(context);
    await seedBrowser(context);
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof openProfile === 'function');
    await page.evaluate((id) => openProfile(id), Number(lead.legacy_id));
    await page.click('#pfActBar [data-fg-estimate]');
    await page.waitForSelector('.est-dboff');
    assert.match(await page.locator('.est-dboff').innerText(), /Estimates need the database switched on/);
    await shot(page, 'editor-db-off.png');
    await context.close();
    process.env.ACADEMY_DATA_BACKEND = 'postgres';

    assert.deepEqual(errors, [], errors.join('\n'));
  } finally {
    await browser.close();
    proc.kill();
    fake.restore();
  }
});
