/**
 * R2: wiring between the four front-end pieces, and the R1 backend contracts coded defensively.
 *  - storm banner -> Flood map Storm list preset
 *  - Estimate button once in the drawer action row; sending moves stage chip/board without reload
 *  - Esc closes the estimate editor, not the drawer under it; closed editor does not block clicks
 *  - estimate send with phone_litigator: no SMS link, reason shown (R1 item 4)
 *  - map "Add to leads" carries parcel_id + flood fields, never duplicates; field reports POST
 *    field_report, stay queued on 503, withdraw sends null, team reports from field_report_list (R1 item 1)
 *  - enrich modal daily cap shown; run stops when daily.granted === 0 (R1 item 2)
 *  - replaced DNC number in phones[] stays blocked (R1 item 6)
 *  - leads table pages (150 rows + Show more) for big lists
 *
 *   PLAYWRIGHT_CORE=/tmp/etools/node_modules/playwright-core node --test tests/ui/r2-integration.test.mjs
 */
import '../estimates/helpers/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaywright, chromePath, startServer, FakeLeadsServer, stubAll, f1Leads, watchErrors } from './lib/crm-harness.mjs';
import { setup } from '../estimates/helpers/setup.js';
import { makeReqRes } from '../leads/helpers/fake-supabase.js';

const chromium = await loadPlaywright();
const skip = !chromium ? 'playwright-core not found (set PLAYWRIGHT_CORE)' : false;
const uuidOf = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

test('R2 integration: storm, estimates, map -> leads, field reports, enrich daily cap, DNC history, paging', { skip, timeout: 240000 }, async () => {
  const fake = setup();
  const { default: academy } = await import('../../api/academy-leads.js');
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    fake.seedLead({ id: uuidOf(1), name: 'Marisol Vega', address: '412 Heron Bay Dr', city: 'Port Orange', zip: '32127', stage: 'contacted', phone: '(386) 555-0142', phone_dnc: false });
    const base = f1Leads();
    // R1 item 6: a replaced DNC number stays in phones[] with dnc:true
    base[0].phones.push({ number: '(386) 555-0999', line_type: 'landline', dnc: true, litigator: false, source: 'batchdata', confidence: 0.6 });
    const many = Array.from({ length: 400 }, (_, i) => ({ id: 1000 + i, name: `Bulk ${i}`, city: 'Holly Hill', address: `${i} Palm Ave`, list: 'FrenchDrain', lists: ['FrenchDrain'], list_status: { FrenchDrain: 'New' }, status: 'New' }));
    const all = base.concat(many);
    const leads = new FakeLeadsServer(all);
    const calls = [];
    let reportMode = 'down';
    const daily = { cap: 100, granted: 24, remaining: 40, limited: true, store: 'postgres', warning: '' };
    const enrich = (body) => {
      calls.push({ fn: 'enrich-contacts', action: body.action, body });
      const caps = { free_directory: true, batchdata: true, trestle: true, default_max_paid_lookups: 50, hard_max_paid_lookups: 500 };
      if (body.action === 'capabilities') return [200, { ok: true, capabilities: caps, max_batch: 12 }];
      const n = (body.leads || []).length;
      if (body.action === 'estimate') return [200, { ok: true, capabilities: caps, daily, leads: [], totals: { leads: n, batchdata: n, trestle_phone_intel: n, trestle_reverse_phone: 0, expected_lookups: 2 * n, max_lookups: 3 * n, daily_cap: 100 } }];
      const granted = calls.filter((c) => c.action === 'enrich').length === 1 ? 24 : 0;
      return [200, { ok: true, capabilities: caps, daily: { ...daily, granted, remaining: granted ? 16 : 0, warning: granted ? '' : 'Daily paid lookup limit reached for today.' }, budget: { max: 50, used_total: granted, exhausted: false }, results: (body.leads || []).map((l) => ({ id: l.id, status: 'not_found', sources: ['search'] })) }];
    };
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(new URL(u).hostname), (r) => r.abort());
    await stubAll(context, {
      leads, calls, enrich,
      estimates: {
        handler: academy, makeReqRes,
        transform(action, body) {
          if (action === 'estimate_send' && body && body.estimate) {
            leads.touch(uuidOf(1), { stage: 'estimate_sent' }); // what the server does to the lead
            return { ...body, warnings: [...(body.warnings || []), 'phone_litigator'], message: { ...(body.message || {}), to: { phone_litigator: true } }, links: { ...(body.links || {}), sms: 'sms:+13865550142' } };
          }
          return body;
        },
      },
      outcomes(body) {
        if (body.action === 'field_report') return reportMode === 'down' ? [503, { error: 'field_reports_not_ready' }] : [200, { ok: true, withdrawn: body.report === null, report: { id: 'r1', parcel_id: body.parcel_id, report: body.report, rep: 'smoke' } }];
        if (body.action === 'field_report_list') return [200, { ok: true, count: 2, reports: [{ parcel_id: body.parcel_id, report: 'water_confirmed', rep: 'dana', reported_at: '2026-11-10T12:00:00Z' }, { parcel_id: body.parcel_id, report: 'water_confirmed', rep: 'luis', reported_at: '2026-11-12T12:00:00Z' }] }];
        return [200, { ok: true }];
      },
    });
    await context.addInitScript(({ leads }) => {
      if (sessionStorage.getItem('__r2i')) return;
      sessionStorage.setItem('__r2i', '1');
      localStorage.setItem('floguard_desk_auth_v1', JSON.stringify({ token: 'smoke-token', user: { id: 'u_smoke', username: 'smoke', role: 'admin', tokens_used: 1, tokens_limit: 50000 } }));
      localStorage.setItem('floguard_leads_v1', JSON.stringify(leads));
    }, { leads: all });
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(server.base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.FG && FG.ready && document.querySelectorAll('#tbody tr[data-id]').length > 0, null, { timeout: 15000 });
    await page.evaluate(() => { document.querySelector('#tabs button[data-list="All"]').click(); window.launchUri = () => true; });
    await page.waitForFunction(() => document.documentElement.dataset.leadsMode === 'server', null, { timeout: 8000 });

    // paging: 408 leads -> 150 rows + a Show more row
    assert.equal(await page.locator('#tbody tr[data-id]').count(), 150);
    await page.click('#tbody .more-row [data-more="page"]');
    assert.equal(await page.locator('#tbody tr[data-id]').count(), 300);
    await page.fill('#search', 'bulk 39');
    assert.ok(await page.locator('#tbody tr[data-id]').count() <= 150, 'search resets to the first page');
    await page.fill('#search', '');

    // R1 item 6: the old DNC number is listed but blocked
    await page.evaluate(() => openProfile(1));
    await page.waitForSelector('#profileDrawer.open');
    const old = page.locator('#pfPhones .ph-row[data-num="(386) 555-0999"]');
    assert.equal(await old.count(), 1, 'replaced DNC number still listed');
    assert.ok(await old.evaluate((el) => el.classList.contains('is-blocked')), 'replaced DNC number is blocked');
    assert.equal(await old.locator('[data-ph-act="call"]').getAttribute('aria-disabled'), 'true');

    // Estimate button: once, in the action row with Call/Text/Email
    assert.equal(await page.locator('#profileDrawer [data-ext-action="estimate"], #profileDrawer [data-fg-estimate]').count(), 1, 'one Estimate button');
    const rowTop = await page.evaluate(() => [document.querySelector('#pfActBar [data-act="call"]').getBoundingClientRect().top, document.querySelector('#pfExtActions [data-ext-action="estimate"]').getBoundingClientRect().top]);
    assert.ok(Math.abs(rowTop[0] - rowTop[1]) < 4, `Estimate sits on the action row (${rowTop})`);
    // editor; Esc closes only the editor; nothing is left blocking clicks
    await page.click('#pfExtActions [data-ext-action="estimate"]');
    await page.waitForSelector('.est-modal #estAddSel', { timeout: 8000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.est-bg').hidden);
    assert.ok(await page.$eval('#profileDrawer', (el) => el.classList.contains('open')), 'drawer stays open under the editor');
    assert.equal(await page.$eval('.est-bg', (el) => getComputedStyle(el).display), 'none', 'closed editor is display:none');
    // build + send; litigator -> no Messages link, reason shown; stage updates without reload
    await page.click('#pfExtActions [data-ext-action="estimate"]');
    await page.waitForSelector('.est-modal #estAddSel', { timeout: 8000 });
    await page.selectOption('#estAddSel', 'exterior_french_drain');
    await page.click('[data-est=addLine]');
    await page.fill('#estLp0', '6000');
    await page.click('[data-est=send]');
    await page.click('[data-est=sendNow]');
    await page.waitForSelector('#estSend');
    assert.equal(await page.locator('#estSend a[href^="sms:"]').count(), 0, 'no SMS link for a litigator number');
    assert.match(await page.locator('#estSend').innerText(), /litigator/i);
    await page.waitForFunction(() => FG.stageOf(FG.leadById(1)) === 'estimate_sent', null, { timeout: 8000 });
    await page.keyboard.press('Escape');
    assert.match(await page.locator('#tbody tr[data-id="1"] .stage-chip').innerText(), /Estimate sent/, 'stage chip updated in the table');
    await page.keyboard.press('Escape');

    // enrich modal: daily cap shown; run stops when the server grants 0
    await page.click('#enrichBtn');
    await page.waitForSelector('.en-daily', { timeout: 8000 });
    assert.match(await page.locator('.en-daily').innerText(), /40 of 100/);
    await page.locator('.fg-modal-foot .btn.p').click();
    await page.waitForFunction(() => /daily lookup limit/i.test(document.getElementById('enPtxt')?.textContent || ''), null, { timeout: 10000 });
    assert.equal(calls.filter((c) => c.action === 'enrich').length, 2, 'no more batches after daily.granted === 0');
    await page.keyboard.press('Escape');

    // storm banner -> map Storm list preset
    await page.waitForSelector('#stormBanner:not([hidden])', { timeout: 8000 });
    await page.click('#stormOpen');
    await page.waitForFunction(() => _fsiState.preset === 'storm' && document.querySelector('#fsiPresets [data-preset="storm"]').classList.contains('on'), null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#fsiList .fsi-row').length > 0, null, { timeout: 15000 });
    assert.ok(calls.some((c) => c.fn === 'fsi-parcels' && c.action === 'storm'));

    // map -> leads: fields carried, no duplicates
    await page.click('#fsiPresets [data-preset="top"]');
    await page.waitForFunction(() => _fsiState.preset === 'top' && document.querySelectorAll('#fsiList .fsi-row').length > 0, null, { timeout: 15000 });
    await page.locator('#fsiList .fsi-row').first().click();
    const pid = await page.evaluate(() => _fsiState.selectedId);
    const before = await page.evaluate(() => state.length);
    await page.click('#fsiDrActs [data-fsi-act="lead"]');
    await page.click('#fsiDrActs [data-fsi-act="lead"]');
    assert.equal(await page.evaluate(() => state.length), before + 1, 'same parcel added once');
    const added = await page.evaluate((id) => state.find((l) => l.parcel_id === id), pid);
    assert.ok(added && added.fsi_live != null && added.fema_zone !== undefined, 'flood fields carried onto the lead');
    // field reports: 503 keeps the queue; recovers later; withdraw sends null; team line from the list
    await page.waitForFunction(() => /Team: 2 water confirmed/.test(document.querySelector('.fsi-report-team')?.textContent || ''), null, { timeout: 8000 });
    await page.click('#fsiDrReport [data-fsi-report="water"]');
    await page.waitForTimeout(400);
    let rep = await page.evaluate((id) => JSON.parse(localStorage.getItem('floguard_fsi_field_reports_v1'))[id], pid);
    assert.equal(rep.synced, undefined, 'still queued after 503');
    assert.ok(calls.some((c) => c.fn === 'lead-outcomes' && c.body.action === 'field_report' && c.body.report === 'water_confirmed' && c.body.parcel_id === pid));
    reportMode = 'up';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('floguard_fsi_field_reports_v1'))[id].synced === true, pid, { timeout: 5000 });
    await page.click('#fsiDrReport [data-fsi-report="water"]'); // toggle off = withdraw
    await page.waitForFunction((id) => !JSON.parse(localStorage.getItem('floguard_fsi_field_reports_v1'))[id], pid, { timeout: 5000 });
    assert.ok(calls.some((c) => c.fn === 'lead-outcomes' && c.body.action === 'field_report' && c.body.report === null), 'withdraw sends report:null');

    assert.deepEqual(errors, [], errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.stop();
    fake.restore();
  }
});
