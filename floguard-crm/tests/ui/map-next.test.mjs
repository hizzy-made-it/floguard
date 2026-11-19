/**
 * Browser test for the wave-2 flood map (agent F2): claims layer + storm chips + zone toggle,
 * block-group popup and "Show parcels here", address search -> parcel polygons at high zoom,
 * "Why this score", field report, box select, URL hash restore, available:false fallback,
 * mobile bottom sheet. Desktop 1440x900 and phone 390x844, light and dark.
 *
 *   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node --test tests/ui/map-*.test.mjs
 *   SCREENS=docs/handoff/F2-screens  ... also writes screenshots
 *
 * Same harness as tests/ui/smoke.test.mjs (playwright-core outside the repo, skipped if missing;
 * map tiles through HTTPS_PROXY when set, else blocked). Every /crm/api/* call is stubbed in the
 * test browser; fsi-parcels answers from the bundled demo fixtures, shaped by the real API helpers.
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
  return undefined;
}
function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
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

const USER = { id: 'u_map', username: 'maprep', role: 'admin', tokens_used: 1000, tokens_limit: 50000, locked: false };
/** Terrain-v2 fields (fsi/sql/018) on one parcel so the breakdown shows confidence and detail. */
const V2 = {
  'FIXTURE-003': {
    depr_n: 0.35, fsi_confidence: 0.72, nbr_rel_m: -0.38, street_rel_m: -0.21, wt_depth_m: 0.6, dem_res_m: 1,
    drain_class: 'Poorly drained', fsi_inputs: { dem: 'lidar_1m', geom: 'polygon', soil: 'ssurgo', agreement: 0.81 },
  },
};

async function stubApis(context, { claims = 'demo', log }) {
  const fx = await import(pathToFileURL(path.join(root, 'server/lib/fsi-fixtures.js')).href);
  const api = await import(pathToFileURL(path.join(root, 'api/fsi-parcels.js')).href);
  const addV2 = (p) => ({ ...p, ...(V2[p.parcel_id] || {}) });
  await context.route(/\/crm\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const fn = url.pathname.split('/').pop();
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* ignore */ }
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (fn === 'academy-auth') return json({ ok: true, user: USER });
    if (fn === 'academy-leads') return json(body.action === 'list' ? { ok: true, leads: [] } : { ok: true });
    if (fn === 'academy-admin') return json({ ok: true, users: [USER], activity: [], practice: [], leads: [] });
    if (fn === 'academy-drafts') return json({ ok: true, drafts: [] });
    if (fn !== 'fsi-parcels') return json({ ok: true });
    const action = body.action || 'viewport';
    log.push({ action, body });
    const box = Array.isArray(body.bbox) ? { w: body.bbox[0], s: body.bbox[1], e: body.bbox[2], n: body.bbox[3] } : null;
    if (action === 'claims_layer') {
      if (claims === 'off') return json({ ok: true, source: 'none', available: false, count: 0, truncated: false, rows: [], note: 'not applied' });
      const f = fx.claimsLayerFixtures({ box, event: body.event || '', eventYear: body.eventYear ?? null, limit: body.limit || 400 });
      const rows = api.shapeClaimsLayerRows(f.bgRows, { eventRows: f.eventRows, includeGeom: !!body.includeGeom }).map((r) => ({ ...r, demo: true }));
      return json({ ok: true, source: 'fixtures', available: true, demo: true, count: rows.length, truncated: false, rows, note: 'DEMO' });
    }
    if (action === 'claims_events') {
      if (claims === 'off') return json({ ok: true, source: 'none', available: false, count: 0, events: [] });
      const events = api.shapeClaimsEvents(fx.claimsEventsFixtures({ minClaims: body.minClaims ?? 25 }));
      return json({ ok: true, source: 'fixtures', available: true, demo: true, count: events.length, events });
    }
    if (action === 'parcel_geom') {
      const features = api.shapeParcelGeom(fx.parcelGeomFixtures(box, body.limit || 600));
      return json({ ok: true, source: 'fixtures', available: true, demo: true, type: 'FeatureCollection', count: features.length, truncated: false, features });
    }
    if (action === 'search') {
      const parcels = fx.searchFixtures(api.sanitizeSearch(body.q)).map(addV2);
      return json({ ok: true, source: 'fixtures', count: parcels.length, parcels });
    }
    if (action === 'storm') {
      const s = fx.stormFixtures({ minRainMm: body.minRainMm, minBand: body.minBand, limit: body.limit });
      return json({ ok: true, source: 'fixtures', demo: true, cells: s.cells, count: s.parcels.length, parcels: s.parcels.map(addV2) });
    }
    const parcels = fx.queryFixtures({ action, limit: body.limit || 200, minFsi: body.minFsi || 0, mustBand: body.mustBand, sort: body.sort, box }).map(addV2);
    return json({ ok: true, source: 'fixtures', count: parcels.length, truncated: false, parcels });
  });
}

const chromium = await loadPlaywright();
const skip = !chromium ? 'playwright-core not found (set PLAYWRIGHT_CORE)' : false;

async function newPage(browser, vp, scheme, opts) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, colorScheme: scheme, ignoreHTTPSErrors: true,
    isMobile: vp.name === 'mobile', hasTouch: vp.name === 'mobile', deviceScaleFactor: 1,
  });
  if (!proxy) await context.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(new URL(u).hostname), (r) => r.abort());
  const log = [];
  await stubApis(context, { ...opts, log });
  await context.addInitScript(({ user }) => {
    if (sessionStorage.getItem('__map_seeded')) return;
    sessionStorage.setItem('__map_seeded', '1');
    localStorage.setItem('floguard_desk_auth_v1', JSON.stringify({ token: 'map-token', user }));
    localStorage.setItem('floguard_leads_v1', '[]');
    localStorage.removeItem('floguard_fsi_field_reports_v1');
  }, { user: USER });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/openfreemap|hazards\.fema\.gov|ERR_FAILED|ERR_TUNNEL|ERR_CERT|Failed to load resource|AJAXError/i.test(t)) return;
    errors.push('console: ' + t);
  });
  return { context, page, errors, log };
}

/** Wait until the map is idle (no move in flight, style + sources loaded), then let tiles paint. */
async function settle(page, ms = 900) {
  await page.waitForFunction(() => typeof _fsiMap !== 'undefined' && _fsiMap && _fsiMap.isStyleLoaded() && !_fsiMap.isMoving(), null, { timeout: 15000 });
  await page.waitForTimeout(ms);
}

async function openMap(page, base) {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('#appRoot:not(.hidden)', { timeout: 10000 });
  await page.evaluate(() => goTab('fsi'));
  await page.waitForFunction(() => document.querySelectorAll('#fsiList .fsi-row').length > 0, null, { timeout: 15000 });
}

test('flood map next: claims, events, popup, search, polygons, score breakdown, hash, sheet', { skip, timeout: 300000 }, async () => {
  const server = await startServer();
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  const browser = await chromium.launch({ executablePath: chromePath(), args: proxy ? [`--proxy-server=${proxy}`] : [] });
  const screens = process.env.SCREENS ? path.resolve(process.env.SCREENS) : null;
  if (screens) fs.mkdirSync(screens, { recursive: true });
  const shot = async (page, name) => { if (screens) await page.screenshot({ path: path.join(screens, name) }); };
  const base = `http://localhost:${server.port}/crm/`;
  try {
    for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      for (const scheme of ['light', 'dark']) {
        const tag = `${vp.name}-${scheme}`;
        const { context, page, errors, log } = await newPage(browser, vp, scheme, { claims: 'demo' });
        await openMap(page, base);

        // --- claims layer on by default, with storm chips
        await page.waitForFunction(() => MN.claims.available === true && MN.claims.rows.size > 0, null, { timeout: 15000 });
        await page.waitForFunction(() => document.querySelectorAll('#fsiClaimsEvents .ev-chip').length >= 4, null, { timeout: 10000 });
        assert.equal(await page.isVisible('#fsiClaimsBar'), true, `${tag}: claims bar visible`);
        const legend = await page.textContent('#fsiLegend');
        assert.match(legend, /Claims/, `${tag}: legend lists the claims layer`);
        const theme = await page.evaluate(() => _fsiStyleUrl);
        assert.match(theme, scheme === 'dark' ? /styles\/dark$/ : /styles\/liberty$/, `${tag}: basemap follows the theme`);
        await settle(page);
        if (vp.name === 'mobile') await page.evaluate(() => { document.getElementById('fsiClaimsBar').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); });
        await shot(page, `map-claims-${tag}.png`);
        const toMap = async () => { if (vp.name === 'mobile') { await page.evaluate(() => document.getElementById('fsiMap').scrollIntoView({ block: 'center' })); await page.waitForTimeout(250); } };

        // --- zone toggle (client side) and a storm event (server filter)
        await page.click('#fsiClaimsZone [data-cz="x"]');
        assert.match(await page.textContent('#fsiLegend'), /outside flood zones/, `${tag}: Zone X legend`);
        await page.click('#fsiClaimsEvents .ev-chip:has-text("Ian")');
        await page.waitForFunction(() => MN.claims.event && MN.claims.rows.size > 0 && [...MN.claims.rows.values()].every((r) => r.event), null, { timeout: 10000 });
        assert.ok(log.some((l) => l.action === 'claims_layer' && l.body.event === 'Hurricane Ian' && l.body.eventYear === 2022), `${tag}: event sent to the API`);
        assert.equal(await page.isDisabled('#fsiClaimsWin [data-cw="5y"]'), true, `${tag}: window disabled while a storm is picked`);
        await settle(page, 600);
        await toMap();
        await shot(page, `map-event-${tag}.png`);

        // --- click a block group away from parcel dots -> popup -> "Show parcels here"
        const pt = await page.evaluate(() => {
          const map = _fsiMap;
          const rect = map.getCanvas().getBoundingClientRect();
          const rows = [...MN.claims.rows.values()].filter((r) => r.geom);
          const fixtures = new Set(_fsiState.raw.map((p) => p.block_group));
          rows.sort((a, b) => (fixtures.has(b.fips) ? 1 : 0) - (fixtures.has(a.fips) ? 1 : 0));
          for (const r of rows) {
            const [w, s, e, n] = r.bbox;
            for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) {
              const lon = w + ((e - w) * i) / 6, lat = s + ((n - s) * j) / 6;
              if (!FSI_PURE.pointInGeom(lon, lat, r.geom)) continue;
              const px = map.project([lon, lat]);
              if (px.x < 380 || px.y < 60 || px.x > rect.width - 60 || px.y > rect.height - 120) continue;
              const hits = map.queryRenderedFeatures([px.x, px.y], { layers: ['fsi-dots', 'fsi-clusters', 'fsi-claims-fill'] });
              const ids = hits.map((h) => h.layer.id);
              if (ids.includes('fsi-claims-fill') && !ids.includes('fsi-dots') && !ids.includes('fsi-clusters')) {
                return { x: rect.left + px.x, y: rect.top + px.y, fips: r.fips };
              }
            }
          }
          return null;
        });
        if (vp.name === 'desktop') {
          assert.ok(pt, `${tag}: found a clickable block group`);
          await page.mouse.click(pt.x, pt.y);
          await page.waitForSelector('.bgpop', { timeout: 5000 });
          await page.waitForTimeout(250);
          await shot(page, `map-bgpopup-${tag}.png`);
          const pop = await page.textContent('.bgpop');
          assert.match(pop, /Neighbourhood claims/);
          assert.match(pop, /Never this owner's claim/);
          assert.match(pop, /Top storm/);
          await page.click('.bgpop [data-mn-bg-show]');
          await page.waitForFunction((f) => _fsiState.bg && _fsiState.bg.fips === f, pt.fips, { timeout: 5000 });
          await page.waitForFunction(() => !document.getElementById('fsiActiveFilters').hidden, null, { timeout: 5000 });
          for (let i = 0; i < 40 && !log.some((l) => l.action === 'viewport'); i++) await page.waitForTimeout(100);
          assert.ok(log.some((l) => l.action === 'viewport'), `${tag}: Show parcels here loads the view`);
          await page.click('#fsiActiveFilters [data-mn-clear-bg]');
          assert.equal(await page.evaluate(() => _fsiState.bg), null);
        }
        // back to "All storms" / all claims for the rest
        await page.click('#fsiClaimsEvents .ev-chip[data-ev="all"]');
        await page.click('#fsiClaimsZone [data-cz="all"]');

        // --- address search -> flies to the parcel, opens detail, polygons at zoom >= 15
        await page.fill('#fsiMapSearchInput', '300 Sample');
        await page.waitForSelector('#fsiMapSearchResults .sr-item', { timeout: 8000 });
        assert.ok(log.some((l) => l.action === 'search' && l.body.q === '300 Sample'), `${tag}: search action called`);
        await page.press('#fsiMapSearchInput', 'Enter');
        await page.waitForFunction(() => _fsiState.selectedId === 'FIXTURE-003', null, { timeout: 5000 });
        await page.waitForFunction(() => _fsiMap.getZoom() >= 15 && !_fsiMap.isMoving(), null, { timeout: 15000 });
        await page.waitForFunction(() => MN.poly.cache.has('FIXTURE-003'), null, { timeout: 10000 });
        assert.ok(log.some((l) => l.action === 'parcel_geom'), `${tag}: parcel_geom requested at high zoom`);
        // setData is async (worker): poll until the dot carries poly=1 (hidden at zoom >= 15)
        await page.waitForFunction(() => {
          const f = _fsiMap.querySourceFeatures('fsi').find((x) => x.properties.parcel_id === 'FIXTURE-003');
          return !!f && Number(f.properties.poly) === 1;
        }, null, { timeout: 8000 });
        assert.match(await page.textContent('#fsiDrName'), /Fixture Owner 03/);
        assert.match(await page.textContent('#fsiDrClaims'), /block group/i, `${tag}: neighbourhood claims line`);
        assert.match(await page.textContent('#fsiDrClaims'), /Never this owner/);
        if (vp.name === 'mobile') {
          assert.equal(await page.evaluate(() => document.getElementById('fsiDrawer').classList.contains('is-sheet')), true, `${tag}: detail opens as a bottom sheet`);
          const pos = await page.evaluate(() => getComputedStyle(document.getElementById('fsiDrawer')).position);
          assert.equal(pos, 'fixed');
        }
        await settle(page, 900);
        if (vp.name === 'mobile') await shot(page, `map-sheet-${tag}.png`);
        // polygons screenshot with the map in view (close the sheet on phones)
        if (vp.name === 'mobile') { await page.click('#fsiDrClose'); await page.waitForTimeout(300); await toMap(); }
        await shot(page, `map-polygons-${tag}.png`);
        if (vp.name === 'mobile') await page.evaluate(() => fsiSelect('FIXTURE-003', { fly: false }));

        // --- Why this score
        await page.click('#fsiDrWhy > summary');
        await page.waitForSelector('#fsiDrBreakdown .why-bar', { state: 'visible' });
        assert.equal(await page.locator('#fsiDrBreakdown .why-rows tbody tr').count() >= 7, true, `${tag}: 5 terms + total + rain`);
        const why = await page.textContent('#fsiDrBreakdown');
        assert.match(why, /Input confidence/);
        assert.match(why, /72%/);
        assert.match(why, /Lot vs neighbours/);
        assert.match(why, /not yet calibrated/);
        assert.match(why, /30% × 0\.95/, `${tag}: real TWI weight from fsi-score.mjs`);
        await page.evaluate(() => {
          // scroll the detail pane (side column or bottom sheet) to the breakdown, not the page
          const dr = document.getElementById('fsiDrawer');
          const why = document.getElementById('fsiDrWhy');
          dr.scrollTop = why.getBoundingClientRect().top - dr.getBoundingClientRect().top + dr.scrollTop - 8;
        });
        await page.waitForTimeout(250);
        await shot(page, `map-why-${tag}.png`);

        // --- field report (local)
        await page.click('#fsiDrReport [data-fsi-report="water"]');
        const rep = await page.evaluate(() => JSON.parse(localStorage.getItem('floguard_fsi_field_reports_v1') || '{}'));
        assert.equal(rep['FIXTURE-003'].v, 'water', `${tag}: field report saved`);

        // --- hash state
        const hash = await page.evaluate(() => new Promise((r) => setTimeout(() => r(location.hash), 400)));
        assert.match(hash, /^#map\?/, `${tag}: hash written`);
        assert.match(hash, /sel=FIXTURE-003/);
        assert.match(hash, /lyr=claims/);

        if (vp.name === 'desktop') {
          // --- box select over the county
          await page.click('#fsiDrClose');
          await page.evaluate(() => { _fsiFitting = true; _fsiMap.jumpTo({ center: [-81.1, 29.07], zoom: 9.6 }); fsiLoad('top'); });
          await settle(page, 400);
          await page.evaluate(() => { _fsiState.selected = Object.create(null); fsiRenderList(); });
          await page.click('#fsiBoxSel');
          const r = await page.evaluate(() => { const b = _fsiMap.getCanvas().getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
          await page.mouse.move(r.x + 40, r.y + 60);
          await page.mouse.down();
          await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2, { steps: 4 });
          await page.mouse.move(r.x + r.w - 40, r.y + r.h - 60, { steps: 4 });
          await page.mouse.up();
          const n = await page.evaluate(() => fsiSelectedCount());
          assert.ok(n > 0, `${tag}: box select picked parcels (got ${n})`);
          assert.equal(await page.evaluate(() => MN.box.on), false, `${tag}: box mode ends after one box`);

          // --- a shared link restores the view and the selection
          if (scheme === 'light') {
            const link = base + '#map?c=29.2108%2C-81.0228&z=15.5&lyr=fema%2Cclaims&pre=top&cz=x&sel=FIXTURE-003';
            const p2 = await context.newPage();
            await p2.goto(link, { waitUntil: 'load' });
            await p2.waitForFunction(() => document.documentElement.getAttribute('data-panel') === 'fsi', null, { timeout: 10000 });
            await p2.waitForFunction(() => _fsiState.selectedId === 'FIXTURE-003', null, { timeout: 15000 });
            const st = await p2.evaluate(() => ({ z: _fsiMap.getZoom(), zone: MN.claims.zone, fema: document.getElementById('fsiNfhl').checked, pre: _fsiState.preset }));
            assert.ok(Math.abs(st.z - 15.5) < 0.6, `shared link zoom (got ${st.z})`);
            assert.deepEqual([st.zone, st.fema, st.pre], ['x', true, 'top']);
            await p2.close();
          }
        }

        // --- Storm list preset: yesterday's rain shown
        await page.evaluate(() => { if (_fsiState.selectedId) fsiSelect(null); });
        await page.click('#fsiPresets [data-preset="storm"]');
        await page.waitForFunction(() => /mm of rain/.test(document.getElementById('fsiStats').textContent), null, { timeout: 8000 });
        assert.ok(log.some((l) => l.action === 'storm'), `${tag}: storm action`);
        assert.ok(await page.locator('#fsiList .chip-rain').count() > 0, `${tag}: rain chip on rows`);

        assert.deepEqual(errors, [], `${tag}: no console/page errors`);
        await context.close();
      }
    }

    // --- available:false: quiet state, tract heat still works
    const { context, page, errors } = await newPage(browser, { name: 'desktop', width: 1440, height: 900 }, 'light', { claims: 'off' });
    await openMap(page, base);
    await page.waitForFunction(() => MN.claims.available === false, null, { timeout: 10000 });
    assert.match(await page.textContent('#fsiClaimsStatus'), /Claims data not loaded yet/);
    assert.equal(await page.evaluate(() => document.getElementById('fsiClaimsBar').classList.contains('is-unavailable')), true);
    await page.click('#fsiClaimsStatus [data-mn-use-heat]');
    await page.waitForFunction(() => _fsiMap.getLayer('fsi-claim-heat'), null, { timeout: 5000 });
    assert.equal(await page.isChecked('#fsiClaimHeat'), true);
    await settle(page, 600);
    await shot(page, 'map-claims-unavailable-desktop-light.png');
    assert.deepEqual(errors, [], 'unavailable: no console/page errors');
    await context.close();
  } finally {
    await browser.close();
    server.stop();
  }
});
