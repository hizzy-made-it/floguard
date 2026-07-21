/**
 * Compute Must-Have Score (MHS) for every parcel_risk row.
 * Two-pass: (1) score all dial targets (2) percentile bands countywide.
 *
 * Keeps residential + commercial + condos. Hard-skips vacant/ag/ROW only.
 *
 * Usage:
 *   node scripts/score-must-have.mjs
 *   node scripts/score-must-have.mjs --limit 10000
 */
import { supabaseConfig, restHeaders } from './lib/load-env.mjs';
import {
  mustHaveScore,
  percentileCuts,
  BAND_MUST_TOP,
  BAND_SHOULD_TOP,
  BAND_MAYBE_TOP,
} from './lib/fsi-score.mjs';

const { url: SUPABASE_URL, key } = supabaseConfig();
const headers = restHeaders(key, 'resolution=merge-duplicates,return=minimal');
const readHeaders = restHeaders(key, 'return=representation');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const LIMIT = Number(opt('--limit', '0')) || Infinity;
const PAGE_SIZE = 500;
const PATCH = 100;

async function fetchAllRows() {
  const out = [];
  let cursor = '';
  while (out.length < LIMIT) {
    const params = new URLSearchParams({
      select:
        'parcel_id,fsi_live,fsi_static,fema_zone,hsg,claim_heat,just_value,living_area,year_built,homestead,dor_use,use_desc,address',
      order: 'parcel_id',
      limit: String(PAGE_SIZE),
    });
    if (cursor) params.set('parcel_id', `gt.${cursor}`);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/parcel_risk?${params}`, {
      headers: readHeaders,
    });
    if (!r.ok) throw new Error(`read ${r.status}: ${(await r.text()).slice(0, 250)}`);
    const rows = await r.json();
    if (!rows.length) break;
    for (const row of rows) {
      out.push(row);
      if (out.length >= LIMIT) break;
    }
    cursor = rows[rows.length - 1].parcel_id;
    process.stdout.write(`\rloaded ${out.length}…`);
    if (rows.length < PAGE_SIZE) break;
  }
  console.log(`\nRows loaded: ${out.length}`);
  return out;
}

async function upsertPatches(patches) {
  const upUrl = `${SUPABASE_URL}/rest/v1/parcel_risk?on_conflict=parcel_id`;
  for (let i = 0; i < patches.length; i += PATCH) {
    const chunk = patches.slice(i, i + PATCH);
    const pr = await fetch(upUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });
    if (!pr.ok) throw new Error(`patch ${pr.status}: ${(await pr.text()).slice(0, 250)}`);
  }
}

async function main() {
  console.log('Must-Have Score pass (percentile bands · keep commercial/condos)');
  console.log(`Target: ${SUPABASE_URL}`);
  console.log(
    `Band targets: must top ${BAND_MUST_TOP * 100}% · should top ${BAND_SHOULD_TOP * 100}% · maybe top ${BAND_MAYBE_TOP * 100}% of dial-eligible`,
  );

  const rows = await fetchAllRows();

  // Pass 1 — raw scores (no band yet)
  const scored = [];
  const dialScores = [];
  for (const row of rows) {
    const { score, reasons, gold } = mustHaveScore(row, { assignBand: false });
    const isSkip = reasons.includes('not_dial_target');
    scored.push({ row, score, reasons, gold, isSkip });
    if (!isSkip) dialScores.push(score);
  }

  dialScores.sort((a, b) => a - b);
  const cuts = percentileCuts(dialScores);
  console.log(
    `Dial-eligible: ${dialScores.length} · cuts must≥${cuts.must} should≥${cuts.should} maybe≥${cuts.maybe}`,
  );

  // Pass 2 — assign bands + write
  const bands = { must: 0, should: 0, maybe: 0, skip: 0 };
  let goldCount = 0;
  const patches = [];
  const now = new Date().toISOString();

  for (const s of scored) {
    let band = 'skip';
    if (!s.isSkip) {
      if (s.score >= cuts.must) band = 'must';
      else if (s.score >= cuts.should) band = 'should';
      else if (s.score >= cuts.maybe) band = 'maybe';
      else band = 'skip';
    }
    bands[band]++;
    if (s.gold) goldCount++;
    patches.push({
      parcel_id: s.row.parcel_id,
      must_have_score: s.score,
      must_have_band: band,
      must_have_reasons: s.reasons,
      updated_at: now,
    });
  }

  console.log(`Upserting ${patches.length}… gold_segment flags: ${goldCount}`);
  let written = 0;
  for (let i = 0; i < patches.length; i += PATCH * 5) {
    await upsertPatches(patches.slice(i, i + PATCH * 5));
    written = Math.min(patches.length, i + PATCH * 5);
    process.stdout.write(`\rupserted ${written}…`);
  }

  console.log(`\nDone. bands: ${JSON.stringify(bands)}`);
  console.log('Map: Flood Map → Must dial (top ~3% of improved parcels, residential+commercial+condo).');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
