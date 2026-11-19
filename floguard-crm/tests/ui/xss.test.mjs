/**
 * R2 XSS regression: seeds HTML/attribute-breaking payloads into every string the app renders from
 * leads, parcels, search results, drafts, admin rows, activity, estimates and the proposal page, walks
 * the integrated app, and asserts no payload ever executes (window.__xss stays empty). Also checks
 * that tel:/sms: links built from data are encoded and that nothing but the session lives in storage.
 *
 *   PLAYWRIGHT_CORE=/tmp/etools/node_modules/playwright-core node --test tests/ui/xss.test.mjs
 */
import '../estimates/helpers/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaywright, chromePath, startServer, FakeLeadsServer, fakeEnrich, stubAll, watchErrors } from './lib/crm-harness.mjs';
import { setup } from '../estimates/helpers/setup.js';
import { makeReqRes } from '../leads/helpers/fake-supabase.js';

const chromium = await loadPlaywright();
const skip = !chromium ? 'playwright-core not found (set PLAYWRIGHT_CORE)' : false;
/** Breaks out of text, double- and single-quoted attributes; records which field fired. */
const X = (tag) => `"'><img src=x onerror="window.__xss.push('${tag}')"><svg onload="window.__xss.push('${tag}-svg')">`;
const uuidOf = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

function evilLeads() {
  const now = Date.now();
  return [
    { id: 1, name: X('name'), city: 'Port Orange', address: X('address'), zip: '32127', industry: X('industry'), contact: X('contact'), owner: X('owner'), email: 'a@example.org', notes: X('notes'),
      list: 'FrenchDrain', lists: ['FrenchDrain'], list_status: { FrenchDrain: 'Interested' }, status: 'Interested', phone: '(386) 555-0142', parcel_id: X('parcel'), source: X('source'), website: 'javascript:window.__xss.push("website-href")',
      phones: [{ number: '(386) 555-0142', line_type: 'mobile', dnc: false, litigator: false, source: X('phsrc'), confidence: 0.8, name_match: X('namematch') }, { number: X('phonenum'), line_type: X('linetype'), dnc: null, source: 'web' }],
      next_action: { type: 'call', due_at: new Date(now - 3600e3).toISOString(), note: X('nanote') }, amount: 5000, mgmt_company_name: X('mgmt') },
    { id: 2, name: 'Plain Lead', city: X('city'), address: '1 Main St', list: 'FrenchDrain', lists: ['FrenchDrain'], list_status: { FrenchDrain: 'New' }, status: 'New', phone: '' },
  ];
}

test('no stored or reflected XSS anywhere in the app or on the proposal page', { skip, timeout: 240000 }, async () => {
  const fake = setup();
  const { default: academy } = await import('../../api/academy-leads.js');
  const { default: leadsApi } = await import('../../api/leads.js');
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    fake.seedLead({ id: uuidOf(1), name: X('est-lead'), address: X('est-addr'), city: 'Port Orange', zip: '32127', stage: 'contacted', phone: '(386) 555-0142', phone_dnc: false });
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844, mobile: true }]) {
      const context = await browser.newContext({ viewport: vp, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
      await context.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(new URL(u).hostname), (r) => r.abort());
      const calls = [];
      const leads = new FakeLeadsServer(evilLeads());
      leads.rows[0].activity.push({ id: 'a1', lead_id: uuidOf(1), at: new Date().toISOString(), actor: X('actor'), type: 'call', direction: 'outbound', outcome: X('outcome'), body: X('activity'), meta: { note: X('meta') } });
      const evilParcel = (p) => ({ ...p, owner_name: X('p-owner'), address: X('p-address'), city: X('p-city'), use_desc: X('p-use'), fema_zone: X('p-zone'), hsg: X('p-hsg'), claim_bg_top_event: X('p-event'), drain_class: X('p-drain') });
      await stubAll(context, {
        leads, calls, enrich: fakeEnrich({ calls, results: { 1: { status: 'found', phone: X('en-phone'), phones: [{ number: X('en-num'), line_type: 'mobile', source: X('en-src') }], warnings: [X('en-warn')], sources: [X('en-source')] } } }),
        estimates: { handler: academy, makeReqRes }, publicLeads: leadsApi, parcelMap: evilParcel,
        searchExtra: (ps) => ps.map(evilParcel),
        drafts: [{ id: X('d-id'), created_at: X('d-when'), lead_key: X('d-lead'), subject: X('d-subject'), status: X('d-status'), body: X('d-body'), meta: { name: X('d-name'), email: X('d-email') } }],
        admin: () => ({ ok: true, users: [{ id: 'u1', username: X('adm-user'), role: X('adm-role'), tokens_used: 1, tokens_limit: 2 }], activity: [{ username: X('adm-act'), action: X('adm-action') }], practice: [{ username: X('adm-prac') }], leads: [] }),
        chat: X('chat-reply'),
      });
      await context.addInitScript(({ leads }) => {
        window.__xss = [];
        if (sessionStorage.getItem('__x')) return;
        sessionStorage.setItem('__x', '1');
        localStorage.setItem('floguard_desk_auth_v1', JSON.stringify({ token: 'smoke-token', user: { id: 'u_smoke', username: 'smoke', role: 'admin', tokens_used: 1, tokens_limit: 50000 } }));
        localStorage.setItem('floguard_leads_v1', JSON.stringify(leads));
      }, { leads: evilLeads() });
      const page = await context.newPage();
      const errors = watchErrors(page);
      await page.goto(server.base, { waitUntil: 'load' });
      await page.waitForFunction(() => window.FG && FG.ready && document.querySelectorAll('#tbody tr[data-id]').length > 0, null, { timeout: 15000 });
      await page.evaluate(() => { document.querySelector('#tabs button[data-list="All"]').click(); window.launchUri = (u) => { (window.__uris = window.__uris || []).push(u); return true; }; });
      await page.waitForFunction(() => document.documentElement.dataset.leadsMode === 'server', null, { timeout: 8000 });
      await page.click('#viewToggle [data-view="board"]');
      await page.waitForTimeout(200);
      await page.click('#viewToggle [data-view="table"]');
      // drawer + timeline + more menu
      await page.evaluate(() => openProfile(1));
      await page.waitForSelector('#profileDrawer.open');
      await page.waitForTimeout(600);
      await page.click('#pfActBar .act-more summary');
      await page.keyboard.press('Escape');
      // estimate editor (lead name/address go into the customer block)
      await page.click('#pfExtActions [data-ext-action="estimate"]');
      await page.waitForSelector('.est-modal #estAddSel, .est-modal .est-item', { timeout: 8000 });
      if (await page.locator('.est-modal .est-item').count()) await page.click('[data-est=new]');
      await page.waitForSelector('.est-modal #estAddSel', { timeout: 8000 });
      await page.selectOption('#estAddSel', 'exterior_french_drain');
      await page.click('[data-est=addLine]');
      await page.fill('#estLp0', '6000');
      await page.locator('.est-line textarea').first().fill(X('est-desc'));
      await page.fill('#estNotes', X('est-notes'));
      await page.click('[data-est=save]');
      await page.waitForSelector('.est-ok', { timeout: 8000 });
      await page.evaluate(() => FG.estimates.list(FG.leadById(1)));
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      // enrich run (provider strings rendered in results)
      await page.click('#enrichBtn');
      await page.waitForSelector('.fg-modal');
      await page.waitForTimeout(400);
      const run = page.locator('.fg-modal-foot .btn.p');
      if (await run.count()) { await run.first().click(); await page.waitForTimeout(1200); }
      await page.keyboard.press('Escape');
      // dial flow: outcome modal shows the number
      const call = page.locator('#tbody tr[data-id="1"] [data-dial="call"]').first();
      if (await call.count()) { await call.click({ force: true }); await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); }
      // map: list, detail, why, search
      await page.evaluate(() => goTab('fsi'));
      await page.waitForFunction(() => document.querySelectorAll('#fsiList .fsi-row').length > 0, null, { timeout: 15000 }).catch(async (e) => { console.log('MAPDBG', JSON.stringify(errors), await page.evaluate(() => [document.getElementById('fsiStats').textContent, window.__xss, typeof _fsiMap, _fsiState.raw.length])); throw e; });
      await page.locator('#fsiList .fsi-row').first().click();
      await page.evaluate(() => { const w = document.getElementById('fsiDrWhy'); if (w) w.open = true; });
      await page.fill('#fsiMapSearchInput', 'sample');
      await page.waitForTimeout(900);
      await page.click('#fsiPresets [data-preset="storm"]');
      await page.waitForTimeout(800);
      // other panels
      for (const p of ['drafts', 'admin', 'docs', 'coach', 'roleplay', 'review', 'playbook', 'settings']) { await page.evaluate((n) => goTab(n), p); await page.waitForTimeout(300); }
      await page.evaluate(() => goTab('drafts'));
      await page.waitForTimeout(300);
      await page.click('.draft-open').catch(() => {});
      await page.evaluate(() => goTab('coach'));
      await page.fill('#coachInput', 'hello').catch(() => {});
      await page.click('#coachSend').catch(() => {});
      await page.waitForTimeout(600);
      await page.waitForTimeout(500);
      const fired = await page.evaluate(() => window.__xss);
      assert.deepEqual(fired, [], `payload executed in the app (${vp.width}px): ${fired.join(', ')}`);
      // tel:/sms: hrefs and launched URIs carry only dial characters
      const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href^="tel:"],a[href^="sms:"],a[href^="mailto:"]')].map((a) => a.getAttribute('href')).concat(window.__uris || []));
      for (const h of hrefs) assert.ok(!/[<>"' ]/.test(h), `unencoded link: ${h}`);
      // storage: only the session and app data, no other tokens
      const keys = await page.evaluate(() => Object.keys(localStorage));
      const tokenish = keys.filter((k) => /token|secret|key|auth/i.test(k) && k !== 'floguard_desk_auth_v1');
      assert.deepEqual(tokenish, [], `unexpected credential-like storage keys: ${tokenish}`);
      assert.deepEqual(errors.filter((e) => !/AJAX|style|glyph|Failed to fetch/i.test(e)), [], errors.join('\n'));
      await context.close();
    }

    // proposal page with hostile customer + line text
    const call = async (body) => { const { req, res } = makeReqRes({ body, secret: 'test-secret' }); await academy(req, res); return res.body; };
    const c = await call({ action: 'estimate_create', lead_id: uuidOf(1), line_items: [{ catalog_id: 'exterior_french_drain', quantity: 1, unit_price: 6000, description: X('pp-line') }], notes_to_customer: X('pp-notes'), customer: { name: X('pp-name'), address: X('pp-addr') } });
    assert.ok(c.estimate, JSON.stringify(c));
    const s = await call({ action: 'estimate_send', estimate_id: c.estimate.id });
    const token = s.public_url.split('/proposal/')[1];
    const context = await browser.newContext();
    await context.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(new URL(u).hostname), (r) => r.abort());
    await stubAll(context, { leads: new FakeLeadsServer([]), estimates: { handler: academy, makeReqRes }, publicLeads: leadsApi });
    await context.addInitScript(() => { window.__xss = []; });
    const pp = await context.newPage();
    await pp.goto(`${server.base}proposal.html?t=${token}`, { waitUntil: 'load' });
    await pp.waitForSelector('.pp-doc', { timeout: 8000 });
    assert.match(await pp.locator('.pp-doc').innerText(), /onerror/, 'payload rendered as text');
    assert.deepEqual(await pp.evaluate(() => window.__xss), [], 'payload executed on the proposal page');
    await context.close();
  } finally {
    await browser.close();
    server.stop();
    fake.restore();
  }
});
