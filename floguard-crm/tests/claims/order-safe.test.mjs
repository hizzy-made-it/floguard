// Review R1: scripts/join-census-tracts.mjs repainted claim_heat from the tract table for every
// parcel, undoing block-group heat when run after the claims ingest. It now re-applies the
// block-group values (nfip_apply_block_group_claims) afterwards, so both orders end the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reapplyBlockGroupHeat } from '../../scripts/lib/claims.mjs';

// Minimal in-memory model of the two writers (semantics of 016 nfip_apply_block_group_claims and
// of join-census-tracts.mjs paintParcels).
function world() {
  const bg = new Map([['121270001001', { heat: 0.9, claim_count_10y: 12 }]]);
  const tract = new Map([['12127000100', { heat: 0.3, claim_count_10y: 40 }]]);
  const parcels = [
    { parcel_id: 'P1', block_group: '121270001001', census_tract: null, claim_heat: 0 },
    { parcel_id: 'P2', block_group: null, census_tract: null, claim_heat: 0 },
  ];
  const tractOf = () => '12127000100';
  const joinTracts = async (rpc) => {
    for (const p of parcels) {
      p.census_tract = tractOf(p);
      p.claim_heat = tract.get(p.census_tract)?.heat ?? 0;
    }
    if (rpc) await reapplyBlockGroupHeat({ rpc });
  };
  const rpc = async (name, { p_buckets, p_bucket }) => {
    assert.equal(name, 'nfip_apply_block_group_claims');
    let n = 0;
    parcels.forEach((p, i) => {
      if (i % p_buckets !== p_bucket) return;
      const b = bg.get(p.block_group);
      const next = b ? b.heat : tract.get(p.census_tract)?.heat ?? p.claim_heat;
      if (next !== p.claim_heat) { p.claim_heat = next; n++; }
    });
    return n;
  };
  const ingest = async () => { for (let b = 0; b < 8; b++) await rpc('nfip_apply_block_group_claims', { p_buckets: 8, p_bucket: b }); };
  return { parcels, joinTracts, ingest, rpc };
}

test('tract join then claims ingest: block-group heat wins, tract fallback elsewhere', async () => {
  const w = world();
  await w.joinTracts(w.rpc);
  await w.ingest();
  assert.deepEqual(w.parcels.map((p) => p.claim_heat), [0.9, 0.3]);
});

test('claims ingest then tract join: same result (was 0.3 for P1 before the fix)', async () => {
  const w = world();
  await w.ingest();
  await w.joinTracts(w.rpc);
  assert.deepEqual(w.parcels.map((p) => p.claim_heat), [0.9, 0.3]);
  const old = world();
  await old.ingest();
  await old.joinTracts(null); // previous behaviour: no re-apply
  assert.equal(old.parcels[0].claim_heat, 0.3, 'demonstrates the defect the re-apply fixes');
});

test('reapplyBlockGroupHeat: every bucket once; missing 016 is a no-op; other errors surface', async () => {
  const seen = [];
  const r = await reapplyBlockGroupHeat({ rpc: async (n, b) => { seen.push(b.p_bucket); return 2; } });
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(r, { applied: true, changed: 16 });
  const missing = await reapplyBlockGroupHeat({ rpc: async () => { throw new Error('rpc nfip_apply_block_group_claims 404: {"code":"PGRST202"}'); } });
  assert.deepEqual(missing, { applied: false, changed: 0, reason: 'no_016' });
  await assert.rejects(reapplyBlockGroupHeat({ rpc: async () => { throw new Error('rpc 500: boom'); } }), /boom/);
});

test('join-census-tracts.mjs calls the re-apply after painting tracts', () => {
  const src = readFileSync(new URL('../../scripts/join-census-tracts.mjs', import.meta.url), 'utf8');
  const paint = src.indexOf('await paintParcels(');
  const reapply = src.indexOf('await reapplyBlockGroupHeat(');
  assert.ok(paint > 0 && reapply > paint, 're-apply runs after the tract paint in main()');
});
