// The browser mirrors the FSI weights from scripts/lib/fsi-score.mjs (source of truth) in
// public/crm/js/19a-map-pure.js. This test fails when the two drift apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as score from '../../scripts/lib/fsi-score.mjs';
import { loadPure } from './_load-pure.mjs';

const { FSI_SCORE, P } = loadPure();
const plain = (o) => JSON.parse(JSON.stringify(o));

test('every mirrored constant equals scripts/lib/fsi-score.mjs', () => {
  const keys = Object.keys(FSI_SCORE);
  assert.ok(keys.length >= 14, 'mirror has the expected constants');
  for (const k of keys) {
    assert.ok(k in score, `${k} exists in fsi-score.mjs`);
    assert.deepEqual(plain(FSI_SCORE[k]), plain(score[k]), `${k} matches`);
  }
});

test('mirror covers every static/dynamic weight exported by fsi-score.mjs', () => {
  const weights = Object.keys(score).filter((k) => /^W_/.test(k));
  for (const k of [...weights, 'ALPHA', 'HSG_SCORE', 'HSG_DEFAULT', 'FEMA_ZONE_SCORE', 'FEMA_ZONE_DEFAULT', 'LITE_TWI_N', 'LITE_HAND_N']) {
    assert.ok(k in FSI_SCORE, `${k} is mirrored`);
  }
});

test('browser scoring helpers agree with fsi-score.mjs', () => {
  for (const h of [null, '', 'A', 'b', 'C', 'D', 'A/D', 'B/D', 'X']) assert.equal(P.hsgScore(h), score.hsgScore(h), `hsg ${h}`);
  for (const z of [null, 'AE', 've', 'AO', 'AH', 'X', 'X-SHADED', '0.2 PCT ANNUAL CHANCE', 'X500', 'AREA OF MINIMAL FLOOD HAZARD', 'D']) {
    assert.equal(P.zoneScore(z), score.zoneScore(z), `zone ${z}`);
  }
  const p = { twi_n: 0.8, hand_n: 0.3, depr_n: 0.4, hsg: 'C', fema_zone: 'X' };
  const b = P.scoreBreakdown(p);
  assert.ok(Math.abs(b.computed - score.staticScore(0.8, 0.3, 'C', 'X', 0.4)) < 1e-12);
  const lite = P.scoreBreakdown({ hsg: 'D', fema_zone: 'AE' });
  assert.ok(Math.abs(lite.computed - score.staticScoreLite('D', 'AE')) < 1e-12, 'missing TWI/HAND use the pipeline defaults');
});
