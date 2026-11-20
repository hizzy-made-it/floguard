import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertSql, chunkBySize, buildClaimsSqlFiles, dollarTag } from '../../scripts/lib/claims-sql.mjs';

test('upsertSql builds a typed upsert and rejects bad identifiers', () => {
  const sql = upsertSql('nfip_claim_tract', [{ census_tract: '12127080100', heat: 0.5 }], 'census_tract');
  assert.match(sql, /insert into public\.nfip_claim_tract \(census_tract, heat\)/);
  assert.match(sql, /jsonb_populate_recordset\(null::public\.nfip_claim_tract/);
  assert.match(sql, /on conflict \(census_tract\) do update set heat = excluded\.heat;/);
  assert.throws(() => upsertSql('x; drop table y', [{ a: 1 }], 'a'));
  assert.throws(() => upsertSql('t', [{ 'a b': 1 }], 'a'));
});

test('dollar-quote tag never collides with the payload', () => {
  const payload = JSON.stringify([{ top_event: 'storm $claims$ and $claims1$' }]);
  const tag = dollarTag(payload);
  assert.ok(!payload.includes(`$${tag}$`));
  const sql = upsertSql('nfip_claim_event', [{ block_group: '1', event_key: 'k', event_year: 2022, name: "O'Brien $claims$" }], 'block_group,event_key,event_year');
  assert.equal(sql.split('$claims1$').length, 3);
});

test('chunkBySize keeps every row and respects the limit', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ i, pad: 'x'.repeat(100) }));
  const chunks = chunkBySize(rows, 1000);
  assert.equal(chunks.flat().length, 50);
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.ok(Buffer.byteLength(JSON.stringify(c)) <= 1100);
  assert.equal(chunkBySize([{ big: 'y'.repeat(5000) }], 1000).length, 1);
});

test('buildClaimsSqlFiles: counts before geometry, geometry split out, finish last', () => {
  const bgRows = [
    { block_group: '121270801001', tract: '12127080100', claim_count_10y: 3, heat: 0.4, geom_geojson: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    { block_group: '121270801002', tract: '12127080100', claim_count_10y: 0, heat: 0, geom_geojson: null },
  ];
  const files = buildClaimsSqlFiles({ bgRows, evRows: [{ block_group: '121270801001', event_key: 'ian', event_year: 2022, claim_count: 3 }], trRows: [] });
  const names = files.map((f) => f.name);
  assert.deepEqual(names, ['01_block_groups_01.sql', '02_events_01.sql', '04_geometry_01.sql', '05_finish.sql']);
  assert.ok(!files[0].sql.includes('geom_geojson'), 'counts file carries no geometry');
  assert.match(files[2].sql, /update public\.nfip_claim_block_group b set geom_geojson/);
  assert.ok(!files[2].sql.includes('121270801002'), 'rows without geometry are skipped');
  assert.match(files[3].sql, /nfip_claim_bg_build_geom/);
});
