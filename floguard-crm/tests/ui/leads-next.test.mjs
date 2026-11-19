/**
 * Leads workspace (F1) browser tests. Same runner rules as smoke.test.mjs:
 *   PLAYWRIGHT_CORE=/path/to/playwright-core node --test tests/ui/*.test.mjs
 * Skipped (not failed) when playwright-core or Chrome is missing.
 *
 * 1. Server mode (fake Postgres leads API): capability detection, storm banner, Today strip
 *    complete, DNC / litigator blocked dial, not-scrubbed confirm + outcome logger + next action,
 *    timeline + quick note + drawer focus trap, board drag and keyboard move, Won close-out ->
 *    lead_outcomes, Lost cancel, 409 conflict re-apply, enrich modal with spend cap across batches,
 *    keyboard shortcuts, bulk owner.
 * 2. Local mode (501 postgres_backend_required): Local mode hint, next action + Today + snooze from
 *    localStorage, board keyboard move with local activity, DNC block, blob push, free-only enrich.
 * 3. Screens: table, board, drawer, enrich modal, Today strip at 1440x900 and 390x844, light + dark.
 *    Files are written only when SCREENS=<dir> is set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  loadPlaywright, chromePath, startServer, FakeLeadsServer, fakeEnrich, STORM, stubApis, seed, f1Leads, watchErrors,
} from './lib/crm-harness.mjs';

const chromium = await loadPlaywright();
const skip = !chromium ? 'playwright-core not found (set PLAYWRIGHT_CORE)' : false;
const uuidOf = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

async function openApp(browser, server, o) {
  const context = await browser.newContext({
    viewport: o.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    colorScheme: o.scheme || 'light', isMobile: !!o.mobile, hasTouch: !!o.mobile, deviceScaleFactor: 1, ignoreHTTPSErrors: true,
  });
  await context.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(new URL(u).hostname), (r) => r.abort());
  const calls = [];
  await stubApis(context, { leads: o.leads, enrich: fakeEnrich({ calls, results: o.enrichResults || {}, capabilities: o.capabilities }), storm: o.storm === undefined ? STORM : o.storm, calls });
  await seed(context, { leads: o.local, extra: o.extra || {} });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto(server.base, { waitUntil: 'load' });
  await page.waitForSelector('#appRoot:not(.hidden)', { timeout: 10000 });
  await page.waitForFunction(() => window.FG && FG.ready && document.querySelectorAll('#tbody tr[data-id]').length > 0, null, { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('#tabs button[data-list="All"]').click();
    window.__launched = [];
    // Capture tel:/sms: instead of handing them to the OS
    window.launchUri = function (u) { window.__launched.push(u); return true; };
  });
  return { context, page, calls, errors };
}
const leadCalls = (srv, action) => srv.calls.filter((c) => c.action === action);
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('floguard_leads_v1')));

test('leads workspace: server mode flows', { skip, timeout: 180000 }, async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    const base = f1Leads();
    const fillers = Array.from({ length: 18 }, (_, i) => ({ id: 100 + i, name: `Filler Owner ${i + 1}`, city: 'Holly Hill', address: `${10 + i} Ridgewood Ave, Holly Hill, FL 32117`, list: 'FrenchDrain', lists: ['FrenchDrain'], list_status: { FrenchDrain: 'New' }, status: 'New', phone: '' }));
    const all = base.concat(fillers);
    const leads = new FakeLeadsServer(all);
    leads.rows[1].activity.push({ id: 'seed1', lead_id: uuidOf(2), at: new Date(Date.now() - 2 * 86400000).toISOString(), actor: 'sean', type: 'email', direction: 'outbound', outcome: 'opened', body: 'Sent the drainage one-pager', meta: {} });
    const enrichResults = {
      6: { status: 'found', phone: '(386) 555-0300', phones: [{ number: '(386) 555-0300', line_type: 'mobile', dnc: false, litigator: false, source: 'batchdata', confidence: 0.8, name_match: 'match' }], phone_dnc: false, phone_line_type: 'mobile', phone_source: 'batchdata', phone_confidence: 0.8, sources: ['batchdata', 'trestle'] },
      100: { status: 'blocked', phones: [{ number: '(386) 555-0301', line_type: 'landline', dnc: true, litigator: false, source: 'batchdata', confidence: 0.7 }], phone_dnc: true, sources: ['batchdata'], warnings: ['All numbers are DNC or litigator'] },
    };
    const { context, page, calls, errors } = await openApp(browser, server, { leads, local: all, enrichResults });

    // capability detection -> server mode
    await page.waitForFunction(() => document.documentElement.dataset.leadsMode === 'server', null, { timeout: 8000 });
    await page.waitForFunction(() => state.every((l) => l.uuid), null, { timeout: 8000 });

    // storm banner (reuses fsi-parcels action:'storm')
    await page.waitForSelector('#stormBanner:not([hidden])');
    const stormTxt = await page.textContent('#stormBanner');
    assert.match(stormTxt, /Rain yesterday in Port Orange, DeLand, Ormond Beach/);
    assert.match(stormTxt, /17 high-score parcels/);
    assert.ok(calls.some((c) => c.fn === 'fsi-parcels' && c.action === 'storm'), 'storm list requested');
    await page.evaluate(() => { window.__storm = null; document.addEventListener('fg:storm-open', (e) => { window.__storm = e.detail; }, { once: true }); });
    await page.click('#stormOpen');
    assert.ok(await page.$eval('#p-fsi', (el) => el.classList.contains('on')), 'storm link opens the flood map');
    assert.equal(await page.evaluate(() => window.__storm && window.__storm.parcels.length), 17);
    await page.evaluate(() => goTab('leads'));

    // Today strip: overdue (Robert, DNC -> call disabled) + due today (Dana)
    await page.waitForFunction(() => document.querySelectorAll('#todayStrip .td-item').length === 2);
    const robert = page.locator('#todayStrip .td-item', { hasText: 'Robert Lindqvist' });
    assert.equal(await robert.locator('[data-td="dial"]').getAttribute('aria-disabled'), 'true', 'Today: DNC lead cannot be dialed');
    await page.locator('#todayStrip .td-item', { hasText: 'Dana Whitfield' }).locator('[data-td="done"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#todayStrip .td-item').length === 1);
    assert.equal(leadCalls(leads, 'task_done')[0]?.body.task_id, '10000000-0000-4000-8000-000000000007', 'task_done with the server task id');
    assert.ok(!leads.find(uuidOf(7)).next_action, 'server task closed');

    // DNC-blocked dial from the table
    const rowCall = (id) => page.locator(`#tbody tr[data-id="${id}"] [data-dial="call"]`);
    assert.equal(await rowCall(3).getAttribute('aria-disabled'), 'true', 'DNC number: call disabled');
    assert.equal(await rowCall(4).getAttribute('aria-disabled'), 'true', 'litigator number: call disabled');
    await rowCall(3).click({ force: true });
    await page.waitForSelector('.fg-blocked');
    assert.match(await page.textContent('.fg-blocked'), /Do Not Call registry/);
    assert.match(await page.textContent('.fg-blocked'), /door hanger/);
    assert.deepEqual(await page.evaluate(() => window.__launched), [], 'nothing dialed for a DNC number');
    await page.locator('.fg-blocked .fg-modal-foot .btn.p').click();
    await page.waitForFunction(() => !document.querySelector('.fg-blocked'));
    await page.waitForFunction(() => state.find((l) => l.id === 3).next_action?.type === 'visit');
    assert.ok(leadCalls(leads, 'patch').some((c) => c.body.lead_id === uuidOf(3) && c.body.patch.next_action?.type === 'visit'), 'mail / door hanger next action sent');

    // Not-scrubbed number: confirm, dial, outcome logger, next action
    await rowCall(2).click();
    await page.waitForSelector('.fg-dnc-warn');
    await page.click('#fgDialAnyway');
    await page.waitForSelector('.fg-outcome-modal');
    assert.deepEqual(await page.evaluate(() => window.__launched), ['tel:+13865550199']);
    await page.click('.fg-outcome-modal [data-outcome="no_answer"]');
    await page.waitForSelector('#fgOutSaveNext');
    assert.equal(await page.inputValue('#fgOutType'), 'text', 'no answer on a call suggests a text');
    await page.click('#fgOutSaveNext');
    await page.waitForFunction(() => !document.querySelector('.fg-outcome-modal'));
    await page.waitForFunction(() => !!state.find((l) => l.id === 2).next_action);
    const act = leadCalls(leads, 'activity_add').find((c) => c.body.lead_id === uuidOf(2) && c.body.type === 'call');
    assert.ok(act, 'call logged on the server timeline');
    assert.equal(act.body.outcome, 'no_answer');
    assert.equal(act.body.direction, 'outbound');

    // "Asked not to call" marks the number DNC (with confirmation) and blocks it from then on
    await rowCall(8).click();
    await page.click('#fgDialAnyway');
    await page.click('.fg-outcome-modal [data-outcome="dnc_request"]');
    await page.waitForSelector('#fgConfirmDnc');
    await page.click('#fgConfirmDnc');
    await page.waitForSelector('#fgOutSaveNext');
    await page.click('#fgOutNoNext');
    await page.waitForFunction(() => state.find((l) => l.id === 8).phone_dnc === true);
    assert.ok(leadCalls(leads, 'patch').some((c) => c.body.lead_id === uuidOf(8) && c.body.patch.phone_dnc === true), 'DNC request sent to the server');
    assert.equal(leads.find(uuidOf(8)).phone_dnc, true);
    assert.equal(await rowCall(8).getAttribute('aria-disabled'), 'true', 'number blocked after the DNC request');

    // Drawer: timeline (server + new), quick note, focus trap
    await page.evaluate(() => openProfile(2));
    await page.waitForSelector('#profileDrawer.open');
    await page.waitForFunction(() => /No answer/.test(document.getElementById('pfTimeline').textContent) && /one-pager/.test(document.getElementById('pfTimeline').textContent));
    await page.fill('#pfQuickNoteText', 'Gate code 4412, dog in yard');
    await page.press('#pfQuickNoteText', 'Enter');
    await page.waitForFunction(() => /Gate code 4412/.test(document.getElementById('pfTimeline').textContent));
    assert.ok(await page.evaluate(() => /Landline/.test(document.getElementById('pfPhones').textContent) && /Not scrubbed/.test(document.getElementById('pfPhones').textContent)), 'phone chips in the drawer');
    // Extension hook for other agents (estimates)
    await page.evaluate(() => FG.leadDrawer.addAction({ id: 'test-estimate', label: 'Estimate', icon: 'clipboard-check', kind: 'o', onClick(l) { window.__ext = l.id; } }));
    await page.click('#pfExtActions [data-ext-action="test-estimate"]');
    assert.equal(await page.evaluate(() => window.__ext), 2, 'drawer extension action gets the lead');
    for (let i = 0; i < 60; i++) await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.querySelector('#profileDrawer .drawer').contains(document.activeElement)), 'focus stays in the drawer');
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.evaluate(() => document.querySelector('#profileDrawer .drawer').contains(document.activeElement)), 'shift+tab stays in the drawer');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('profileDrawer').classList.contains('open'));

    // Board: drag Gerald (New) to Contacted
    await page.click('#viewToggle [data-view="board"]');
    await page.waitForSelector('#leadsBoard .bd-card[data-id="6"]');
    const card = await page.locator('#leadsBoard .bd-card[data-id="6"] .bd-name').boundingBox();
    const col = await page.locator('#leadsBoard .bd-col[data-stage="contacted"] .bd-list').boundingBox();
    await page.mouse.move(card.x + 20, card.y + 8);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(card.x + 20 + ((col.x + 60 - card.x - 20) * i) / 8, card.y + 8 + ((col.y + 30 - card.y - 8) * i) / 8);
    await page.mouse.up();
    await page.waitForSelector('#leadsBoard .bd-col[data-stage="contacted"] .bd-card[data-id="6"]');
    assert.ok(leadCalls(leads, 'patch').some((c) => c.body.lead_id === uuidOf(6) && c.body.patch.stage === 'contacted'), 'drag sends stage patch');
    assert.equal(leads.find(uuidOf(6)).stage, 'contacted');
    assert.ok(leads.find(uuidOf(6)).activity.some((a) => a.type === 'stage_change'), 'server logged stage_change');

    // Keyboard path: stage select on the card
    await page.selectOption('#leadsBoard .bd-card[data-id="8"] select.bd-stage', 'estimate_sent');
    await page.waitForSelector('#leadsBoard .bd-col[data-stage="estimate_sent"] .bd-card[data-id="8"]');
    assert.equal(leads.find(uuidOf(8)).stage, 'estimate_sent');

    // Won -> close-out modal -> lead_outcomes
    await page.selectOption('#leadsBoard .bd-card[data-id="2"] select.bd-stage', 'won');
    await page.waitForSelector('.fg-closeout');
    await page.fill('#coAmount', '15000');
    await page.selectOption('#coWater', 'true');
    await page.check('.co-where input[value="yard"]');
    await page.click('#coSave');
    await page.waitForSelector('#leadsBoard .bd-col[data-stage="won"] .bd-card[data-id="2"]');
    const rec = calls.find((c) => c.fn === 'lead-outcomes');
    assert.ok(rec, 'outcome recorded');
    assert.equal(rec.body.outcome, 'won');
    assert.equal(rec.body.lead_key, uuidOf(2));
    assert.equal(rec.body.amount, 15000);
    assert.equal(rec.body.water_confirmed, true);
    assert.deepEqual(rec.body.water_where, ['yard']);
    assert.equal(leads.find(uuidOf(2)).stage, 'won');
    assert.equal((await stored(page)).find((l) => l.id === 2).list_status.PropertyMgmt, 'Contract signed', 'cause status follows Won');

    // Lost -> cancel keeps the lead where it was
    const patchesBefore = leadCalls(leads, 'patch').length;
    await page.selectOption('#leadsBoard .bd-card[data-id="1"] select.bd-stage', 'lost');
    await page.waitForSelector('.fg-closeout');
    await page.click('.fg-closeout .fg-modal-foot .btn.ghost');
    await page.waitForFunction(() => !document.querySelector('.fg-closeout'));
    await page.waitForSelector('#leadsBoard .bd-col[data-stage="contacted"] .bd-card[data-id="1"]');
    assert.equal(leadCalls(leads, 'patch').length, patchesBefore, 'cancelled close-out sends nothing');

    // 409: another device edits Marisol, then we move her
    leads.touch(uuidOf(1), { notes: 'Edited on the office PC' });
    await page.selectOption('#leadsBoard .bd-card[data-id="1"] select.bd-stage', 'assessment_booked');
    await page.waitForSelector('#leadsBoard .bd-col[data-stage="assessment_booked"] .bd-card[data-id="1"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.fg-toast-msg')].some((t) => /changed on another device/.test(t.textContent)));
    const mp = leadCalls(leads, 'patch').filter((c) => c.body.lead_id === uuidOf(1));
    assert.equal(mp.length, 2, 'stale patch then a re-applied patch');
    assert.notEqual(mp[0].body.updated_at, mp[1].body.updated_at, 'second patch carries the server token');
    assert.equal(leads.find(uuidOf(1)).stage, 'assessment_booked');
    assert.equal(leads.find(uuidOf(1)).notes, 'Edited on the office PC', 'the other edit survives');
    await page.waitForFunction(() => /office PC/.test(state.find((l) => l.id === 1).notes));

    // Enrich modal: all missing a phone (19 leads -> batches of 12 + 7), cap 30
    await page.click('#viewToggle [data-view="table"]');
    await page.click('#enrichBtn');
    await page.waitForSelector('.fg-enrich .en-est-grid');
    assert.equal(await page.textContent('.fg-enrich input[value="missing"] + span .num'), '19');
    assert.match(await page.textContent('#enProviders'), /BatchData/);
    await page.$eval('#enCap', (el) => { el.value = '30'; el.dataset.touched = '1'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('#enRun');
    await page.waitForSelector('#enSummary:not([hidden])', { timeout: 15000 });
    const runs = calls.filter((c) => c.fn === 'enrich-contacts' && c.action === 'enrich');
    assert.equal(runs.length, 2, 'two batches');
    assert.equal(runs[0].body.maxPaidLookups, 30);
    assert.equal(runs[1].body.maxPaidLookups, 6, 'second batch gets the remaining budget (30 - 24)');
    assert.ok(runs[0].body.leads.length <= 12);
    assert.ok(calls.some((c) => c.fn === 'enrich-contacts' && c.action === 'capabilities'), 'capabilities first');
    assert.ok(calls.some((c) => c.fn === 'enrich-contacts' && c.action === 'estimate'), 'estimate before run');
    const summary = await page.textContent('#enSummary');
    assert.match(summary, /1\s*found/);
    assert.match(summary, /1\s*blocked/);
    assert.match(summary, /30\s*paid lookups/);
    await page.click('#enRun'); // "Done"
    await page.waitForFunction(() => !document.querySelector('.fg-enrich'));
    const after = await stored(page);
    assert.equal(after.find((l) => l.id === 6).phone, '(386) 555-0300', 'found number applied');
    assert.equal(after.find((l) => l.id === 100).enrich_status, 'blocked');
    assert.equal(await page.locator('#tbody tr[data-id="100"] [data-dial="call"]').getAttribute('aria-disabled'), 'true', 'enriched DNC number stays blocked');
    await page.evaluate(() => openProfile(100));
    await page.waitForSelector('#profileDrawer.open');
    assert.match(await page.textContent('#pfEnrichState'), /Enrichment: blocked/, 'blocked enrichment is labelled');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('profileDrawer').classList.contains('open'));

    // Keyboard shortcuts
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
    await page.keyboard.press('Escape');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    const activeId = await page.evaluate(() => document.querySelector('#tbody tr.kb-active')?.dataset.id);
    assert.ok(activeId, 'j highlights a row');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#profileDrawer.open');
    assert.equal(await page.evaluate(() => String(profileLeadId)), activeId);
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await page.waitForSelector('.fg-help');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.fg-help'));

    // Bulk owner on two selected rows
    await page.check('#tbody tr[data-id="7"] input.row-sel');
    await page.check('#tbody tr[data-id="8"] input.row-sel');
    assert.equal(await page.textContent('#bulkCount'), '2 selected');
    await page.fill('#bulkOwner', 'sean');
    await page.click('#bulkOwnerApply');
    await page.waitForFunction(() => state.find((l) => l.id === 7).owner === 'sean' && state.find((l) => l.id === 8).owner === 'sean');
    assert.equal(leads.find(uuidOf(8)).owner, 'sean');

    assert.deepEqual(errors, [], 'no console/page errors');
    await context.close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('leads workspace: local mode (501) keeps working', { skip, timeout: 120000 }, async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    const leads = new FakeLeadsServer(f1Leads(), { mode: 'local' });
    const { context, page, calls, errors } = await openApp(browser, server, {
      leads, local: f1Leads(), storm: null,
      capabilities: { free_directory: true, batchdata: false, trestle: false, default_max_paid_lookups: 50, hard_max_paid_lookups: 500 },
    });
    await page.waitForFunction(() => document.documentElement.dataset.leadsMode === 'local', null, { timeout: 8000 });
    assert.match(await page.getAttribute('#syncPill', 'title'), /Local mode/);
    assert.ok(await page.$eval('#stormBanner', (el) => el.hidden), 'no storm data -> no banner');

    // Today strip from local next_action
    await page.waitForFunction(() => document.querySelectorAll('#todayStrip .td-item').length === 2);

    // Set a next action in the drawer (due later today)
    await page.evaluate(() => openProfile(6));
    await page.waitForSelector('#profileDrawer.open #pfNaDue');
    const due = await page.evaluate(() => { const d = new Date(Date.now() + 5 * 60000); const e = FG.endOfDay(); return FG.toLocalInput((d > e ? e : d).toISOString()); });
    await page.fill('#pfNaDue', due);
    await page.fill('#pfNaNote', 'Ask about the side yard');
    await page.click('#pfNextSave');
    await page.waitForFunction(() => state.find((l) => l.id === 6).next_action?.note === 'Ask about the side yard');
    assert.equal(leadCalls(leads, 'patch').length, 0, 'no per-lead patch in local mode (no uuid)');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#todayStrip .td-item').length === 3);
    const g = page.locator('#todayStrip .td-item', { hasText: 'Gerald Okafor' });
    await g.locator('summary').click();
    await g.locator('[data-snooze="tomorrow"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#todayStrip .td-item').length === 2);
    const gl = (await stored(page)).find((l) => l.id === 6);
    assert.ok(new Date(gl.next_action.due_at) > new Date(new Date().setHours(23, 59, 59, 0)), 'snoozed to tomorrow');

    // Board keyboard move (local) + local activity in the timeline
    await page.click('#viewToggle [data-view="board"]');
    await page.selectOption('#leadsBoard .bd-card[data-id="6"] select.bd-stage', 'contacted');
    await page.waitForSelector('#leadsBoard .bd-col[data-stage="contacted"] .bd-card[data-id="6"]');
    assert.equal((await stored(page)).find((l) => l.id === 6).stage, 'contacted');
    const acts = await page.evaluate(() => JSON.parse(localStorage.getItem('floguard_activities_v1') || '[]'));
    assert.ok(acts.some((a) => a.lead_id === 6 && a.type === 'stage_change'), 'local stage_change activity');
    await page.evaluate(() => openProfile(6));
    await page.waitForFunction(() => /New → Contacted/.test(document.getElementById('pfTimeline').textContent));
    await page.keyboard.press('Escape');

    // Alt+Arrow moves the focused card one stage
    await page.focus('#leadsBoard .bd-card[data-id="6"]');
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForSelector('#leadsBoard .bd-col[data-stage="assessment_booked"] .bd-card[data-id="6"]');

    // DNC block works offline too
    await page.click('#viewToggle [data-view="table"]');
    await page.locator('#tbody tr[data-id="3"] [data-dial="text"]').click({ force: true });
    await page.waitForSelector('.fg-blocked');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => window.__launched), []);

    // Saved filter chips + column sort
    await page.click('#filterChips [data-chip="dnc"]');
    assert.equal(await page.locator('#tbody tr[data-id]').count(), 2, 'DNC chip: DNC + litigator leads');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('floguard_leads_chips_v1')).dnc), true, 'chip saved');
    await page.click('#chipClear');
    await page.selectOption('#chipStage', 'won');
    assert.equal(await page.locator('#tbody tr[data-id]').count(), 1, 'stage chip');
    await page.click('#chipClear');
    await page.click('.th-sort[data-sort="name"]');
    assert.equal(await page.locator('#tbody tr[data-id]').first().getAttribute('data-id'), '2', 'sorted by name (Coastal first)');
    assert.equal(await page.getAttribute('.th-sort[data-sort="name"]', 'class'), 'th-sort on');
    await page.click('.th-sort[data-sort="name"]');
    assert.equal(await page.locator('#tbody tr[data-id]').first().getAttribute('data-id'), '3', 'descending: Robert Lindqvist first');

    // Identity: same name + city but a different address stays a separate owner; same address merges
    const merged = await page.evaluate(() => {
      const before = state.length;
      mergeServerLeads([{ name: 'Gerald Okafor', city: 'Port Orange', address: '99 Other Rd, Port Orange, FL 32127', list: 'FrenchDrain', lists: ['FrenchDrain'] }]);
      const afterOther = state.length;
      mergeServerLeads([{ name: 'Gerald Okafor', city: 'Port Orange', address: '33 Spruce Creek Rd, Port Orange, FL 32127', email: 'g@example.org' }]);
      return { before, afterOther, afterSame: state.length, email: state.find((l) => l.id === 6).email };
    });
    assert.equal(merged.afterOther, merged.before + 1, 'different address -> new lead');
    assert.equal(merged.afterSame, merged.afterOther, 'same address -> merged');
    assert.equal(merged.email, 'g@example.org');

    // Free-only enrich
    await page.click('#enrichBtn');
    await page.waitForSelector('.fg-enrich .en-note');
    assert.match(await page.textContent('.fg-enrich .en-note'), /No paid provider is configured/);
    assert.ok(await page.$eval('#enCap', (el) => el.disabled), 'spend cap disabled without paid providers');
    await page.keyboard.press('Escape');

    // Blob sync still used
    await page.waitForTimeout(1700);
    assert.ok(leadCalls(leads, 'push').length >= 1, 'blob push still runs');
    assert.deepEqual(errors, [], 'no console/page errors');
    await context.close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('leads workspace: screens (desktop + mobile, light + dark)', { skip, timeout: 240000 }, async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: chromePath() });
  const screens = process.env.SCREENS ? path.resolve(process.env.SCREENS) : null;
  if (screens) fs.mkdirSync(screens, { recursive: true });
  const shot = async (page, name, opts) => { if (screens) await page.screenshot({ path: path.join(screens, name), ...(opts || {}) }); };
  try {
    for (const vp of ['desktop', 'mobile']) {
      for (const scheme of ['light', 'dark']) {
        const tag = `${vp}-${scheme}`;
        const leads = new FakeLeadsServer(f1Leads());
        const now = Date.now();
        const a = (h, type, outcome, body, meta = {}) => ({ id: 's' + h, lead_id: uuidOf(1), at: new Date(now - h * 3600000).toISOString(), actor: 'sean', type, direction: type === 'note' || type === 'stage_change' || type === 'enrich' ? null : 'outbound', outcome, body, meta });
        leads.rows[0].activity.push(
          a(98, 'enrich', null, 'Enriched: found · 1 number · batchdata, trestle'),
          a(96, 'stage_change', null, 'Stage: new -> contacted', { from: 'new', to: 'contacted' }),
          a(50, 'call', 'left_vm', 'Left voicemail · mentioned the free assessment'),
          a(26, 'text', 'talked', 'Talked · wants a quote before the rainy season'),
          a(3, 'note', null, 'Side yard holds water along the fence line'),
        );
        const { context, page, errors } = await openApp(browser, server, { leads, local: f1Leads(), mobile: vp === 'mobile', scheme });
        await page.waitForFunction(() => document.documentElement.dataset.leadsMode === 'server', null, { timeout: 8000 });
        await page.waitForSelector('#stormBanner:not([hidden])');
        await page.waitForFunction(() => document.querySelectorAll('#todayStrip .td-item').length === 2);
        await page.waitForTimeout(300);
        if (vp === 'mobile') await page.evaluate(() => window.scrollTo(0, document.querySelector('#p-leads .table-head').getBoundingClientRect().top + window.scrollY - 64));
        await page.waitForTimeout(150);
        await shot(page, `table-${tag}.png`);
        await page.evaluate(() => window.scrollTo(0, 0));
        // Today strip + funnel (clip)
        const top = await page.locator('#funnelStrip').boundingBox();
        const bot = await page.locator('#todayStrip').boundingBox();
        await shot(page, `today-${tag}.png`, { clip: { x: 0, y: Math.max(0, top.y - 12), width: vp === 'desktop' ? 1440 : 390, height: Math.min(bot.y + bot.height - top.y + 24, vp === 'desktop' ? 900 : 844) } });
        // Board
        await page.click('#viewToggle [data-view="board"]');
        await page.waitForSelector('#leadsBoard .bd-card');
        await page.evaluate(() => window.scrollTo(0, document.querySelector('#p-leads .table-head').getBoundingClientRect().top + window.scrollY - 70));
        await page.waitForTimeout(250);
        await shot(page, `board-${tag}.png`);
        // Drawer with pipeline, phones and timeline
        await page.click('#viewToggle [data-view="table"]');
        await page.evaluate(() => { window.scrollTo(0, 0); openProfile(1); });
        await page.waitForFunction(() => /Side yard holds water/.test(document.getElementById('pfTimeline').textContent));
        await page.evaluate(() => { const d = document.querySelector('#profileDrawer .drawer'); d.scrollTop = document.getElementById('pfPipeline').offsetTop - d.querySelector('.drawer-head').offsetHeight - 4; });
        await page.waitForTimeout(250);
        await shot(page, `drawer-${tag}.png`);
        await page.evaluate(() => { const d = document.querySelector('#profileDrawer .drawer'); d.scrollTop = document.getElementById('pfActivitySec').offsetTop - d.querySelector('.drawer-head').offsetHeight - 4; });
        await page.waitForTimeout(150);
        await shot(page, `drawer-timeline-${tag}.png`);
        await page.keyboard.press('Escape');
        // Enrich modal with estimate
        await page.click('#enrichBtn');
        await page.waitForSelector('.fg-enrich .en-est-grid');
        await page.waitForTimeout(250);
        await shot(page, `enrich-${tag}.png`);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.fg-modal-bg'));
        // Blocked dial explanation
        if (vp === 'desktop' && scheme === 'light') {
          await page.locator('#tbody tr[data-id="3"] [data-dial="call"]').click({ force: true });
          await page.waitForSelector('.fg-blocked');
          await page.waitForTimeout(200);
          await shot(page, `dnc-blocked-${tag}.png`);
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !document.querySelector('.fg-modal-bg'));
          await page.locator('#tbody tr[data-id="2"] [data-dial="call"]').click();
          await page.click('#fgDialAnyway');
          await page.click('.fg-outcome-modal [data-outcome="talked"]');
          await page.waitForSelector('#fgOutSaveNext');
          await page.waitForTimeout(200);
          await shot(page, `outcome-${tag}.png`);
          await page.click('#fgOutSaveNext');
        }
        assert.deepEqual(errors, [], `${tag}: no console/page errors`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.stop();
  }
});
