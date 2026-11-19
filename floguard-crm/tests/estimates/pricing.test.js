import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  computeTotals, priceLineItems, mintToken, isTokenShape, TOKEN_RE, looksLikeCardNumber, effectiveStatus, todayNY,
  buildMessage, catalogForClient, termsArePlaceholder, termsText,
} = await import('../../server/lib/estimates.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public/crm/docs/estimate_catalog.json'), 'utf8'));
const pricingDoc = fs.readFileSync(path.join(root, 'public/crm/docs/FloGuard_Pricing_and_Offers.md'), 'utf8');

const line = (over = {}) => ({ catalog_id: 'french_drain_sump_system', quantity: 1, unit_price: 8000, ...over });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('catalog: every item has a source quoting a real doc heading, and its band is in the pricing doc', () => {
  assert.ok(catalog.items.length >= 1);
  for (const it of catalog.items) {
    assert.ok(it.source && it.source.length > 5, `${it.id} has a source`);
    const heading = it.source.split(/[ (]/).slice(0, 3).join(' ');
    assert.ok(pricingDoc.includes('The one price rule') && /Service lines/.test(pricingDoc));
    assert.ok(/^(Service lines|The one price rule)/.test(it.source), `${it.id} source starts with a doc heading (${heading})`);
    assert.equal(it.unit, 'system', 'never per-foot');
  }
  // Every dollar figure in the catalog items appears in the pricing doc.
  for (const it of catalog.items) {
    for (const v of [it.band_low, it.band_high]) {
      assert.ok(pricingDoc.includes(`$${v.toLocaleString('en-US')}`), `$${v} is in the pricing doc`);
    }
  }
  // Nothing the doc does not price is in items.
  const ids = catalog.items.map((i) => i.id).join(' ');
  assert.ok(!/yard|maintenance|property|interior/.test(ids));
  assert.ok(catalog.unpriced_service_lines.length >= 3);
});

test('catalog: terms, deposit, warranty and license stay placeholders (no invented legal text)', () => {
  assert.equal(catalog.terms.placeholder, true);
  assert.match(catalog.terms.text, /^\[\[TERMS — owner to supply; not legal advice\]\]$/);
  assert.ok(termsArePlaceholder(termsText()));
  assert.match(catalog.business.license_line, /^\[\[/);
  assert.equal(catalogForClient().terms_placeholder, true);
});

test('totals are computed on the server from quantity x price; client totals are ignored', () => {
  const r = computeTotals([line({ quantity: 2, unit_price: 5000.5, total: 1, subtotal: 1 })], 500, 'repeat customer');
  assert.equal(r.items[0].total, 10001);
  assert.equal(r.subtotal, 10001);
  assert.equal(r.discount, 500);
  assert.equal(r.total, 9501);
});

test('cents arithmetic does not drift (0.1 + 0.2 style sums)', () => {
  const r = computeTotals([line({ unit_price: 4500.1 }), line({ unit_price: 4500.2 })], 0);
  assert.equal(r.subtotal, 9000.3);
});

test('band: inside the band passes; outside needs band_override_reason', () => {
  assert.equal(priceLineItems([line({ unit_price: 4500 })]).out_of_band, false);
  assert.equal(priceLineItems([line({ unit_price: 12000 })]).out_of_band, false);
  assert.equal(code(() => priceLineItems([line({ unit_price: 4499 })])), 'band_override_required');
  assert.equal(code(() => priceLineItems([line({ unit_price: 12001 })])), 'band_override_required');
  assert.equal(code(() => priceLineItems([line({ unit_price: 13000, band_override_reason: 'no' })])), 'band_override_required', 'reason must be real');
  const ok = priceLineItems([line({ unit_price: 13000, band_override_reason: 'Long discharge run, owner approved' })]);
  assert.equal(ok.out_of_band, true);
  assert.equal(ok.items[0].band_override_reason, 'Long discharge run, owner approved');
});

test('custom lines (not in the pricing doc) always need a reason; units are forced', () => {
  assert.equal(code(() => priceLineItems([{ description: 'Gutter tie-in', unit_price: 900 }])), 'band_override_required');
  const r = priceLineItems([{ description: 'Gutter tie-in', unit_price: 900, unit: 'ft', band_override_reason: 'Owner confirmed $900 on 2026-11-19' }]);
  assert.equal(r.items[0].unit, 'each');
  assert.equal(r.items[0].catalog_id, null);
});

test('per-foot pricing is refused', () => {
  for (const d of ['French drain at $30 per foot', 'Drain $25/ft', 'priced per linear foot', 'trench 200 per ft']) {
    assert.equal(code(() => priceLineItems([{ description: d, unit_price: 100, band_override_reason: 'custom job here' }])), 'per_foot_pricing_not_allowed', d);
  }
  // Descriptive footage is fine (the doc says "typically 150-350 linear ft").
  assert.doesNotThrow(() => priceLineItems([line()]));
});

test('quantity, price, discount validation', () => {
  assert.equal(code(() => priceLineItems([line({ quantity: 0 })])), 'invalid_quantity');
  assert.equal(code(() => priceLineItems([line({ quantity: 1.5 })])), 'invalid_quantity');
  assert.equal(code(() => priceLineItems([line({ unit_price: -1 })])), 'invalid_unit_price');
  assert.equal(code(() => priceLineItems([line({ unit_price: 'abc' })])), 'invalid_unit_price');
  assert.equal(code(() => priceLineItems([line({ catalog_id: 'nope' })])), 'unknown_catalog_item');
  assert.equal(code(() => computeTotals([line()], 9000, 'big')), 'invalid_discount', 'discount > subtotal');
  assert.equal(code(() => computeTotals([line()], -5, 'x')), 'invalid_discount');
  assert.equal(code(() => computeTotals([line()], 100, '')), 'discount_reason_required');
  assert.equal(code(() => priceLineItems('x')), 'invalid_line_items');
});

test('card-number detection (Luhn) so payment data is never stored', () => {
  assert.equal(looksLikeCardNumber('4242 4242 4242 4242'), true);
  assert.equal(looksLikeCardNumber('call 4242-4242-4242-4242 now'), true);
  assert.equal(looksLikeCardNumber('Invoice 20261119'), false);
  assert.equal(looksLikeCardNumber('(386) 259-0023'), false);
  assert.equal(code(() => priceLineItems([line({ description: 'pay with 4242424242424242' })])), 'payment_data_not_accepted');
});

test('tokens: 32 random bytes, base64url, 43 chars, unique, URL safe, not derivable', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const t = mintToken();
    assert.equal(t.length, 43);
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(isTokenShape(t));
    assert.equal(Buffer.from(t, 'base64url').length, 32);
    seen.add(t);
  }
  assert.equal(seen.size, 2000);
  // Roughly uniform over the alphabet (not a counter, uuid or hash of a record id).
  const counts = {};
  for (const t of seen) for (const c of t.slice(0, 42)) counts[c] = (counts[c] || 0) + 1;
  assert.ok(Object.keys(counts).length >= 60);
  const max = Math.max(...Object.values(counts));
  const min = Math.min(...Object.values(counts));
  assert.ok(max / min < 1.5, `byte distribution is flat (${max}/${min})`);
  assert.ok(!isTokenShape('short') && !isTokenShape('a'.repeat(200)) && !isTokenShape('../../etc/passwd'.padEnd(43, 'a')));
  assert.ok(TOKEN_RE.test('a'.repeat(64)), 'legacy 64-char hex defaults still have a valid shape (never usable while draft)');
});

test('effective status: void and expired are derived; expiry is end of valid_until (America/New_York)', () => {
  const sent = { status: 'sent', valid_until: '2026-12-01' };
  assert.equal(effectiveStatus(sent, '2026-12-01'), 'sent');
  assert.equal(effectiveStatus(sent, '2026-12-02'), 'expired');
  assert.equal(effectiveStatus({ ...sent, voided_at: 'x' }, '2026-11-01'), 'void');
  assert.equal(effectiveStatus({ status: 'accepted', valid_until: '2020-01-01' }, '2026-12-02'), 'accepted', 'accepted never expires');
  assert.equal(effectiveStatus({ status: 'draft', valid_until: '2020-01-01' }, '2026-12-02'), 'draft');
  assert.match(todayNY(), /^\d{4}-\d{2}-\d{2}$/);
});

test('message builder: ready-to-copy text, mailto and sms; sms link blocked when DNC', () => {
  const est = { number: 'FG-2026-0001', total: 8000, valid_until: '2026-12-19', customer: { name: 'Marisol Vega' } };
  const m = buildMessage({ lead: { email: 'm@example.org', phone: '(386) 555-0142', phone_dnc: false }, estimate: est, url: 'https://x.test/proposal/T' });
  assert.match(m.body, /Hi Marisol/);
  assert.match(m.body, /https:\/\/x\.test\/proposal\/T/);
  assert.match(m.body, /\$8,000\.00/);
  assert.ok(m.links.mailto.startsWith('mailto:m@example.org?subject='));
  assert.ok(m.links.sms.startsWith('sms:3865550142'));
  const d = buildMessage({ lead: { email: '', phone: '(386) 555-0142', phone_dnc: true }, estimate: est, url: 'u' });
  assert.equal(d.links.sms, null);
  assert.equal(d.links.mailto, null);
  assert.equal(d.to.phone_dnc, true);
});
