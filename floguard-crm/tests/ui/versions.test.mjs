/**
 * Every css/js referenced by the CRM pages carries ?v=<content hash>, and the stamps are current.
 * Fix a failure with: node tests/ui/stamp-versions.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, stampPage, unstampable } from './stamp-versions.mjs';

test('cache-busting stamps match file contents', () => {
  for (const page of PAGES) {
    assert.deepEqual(unstampable(page), [], `${page}: local css/js without a content stamp`);
    const { stale } = stampPage(page);
    assert.deepEqual(stale.map((s) => `${s.file}: v=${s.had} != ${s.want}`), [], `${page}: stale stamps; run node tests/ui/stamp-versions.mjs`);
  }
});
