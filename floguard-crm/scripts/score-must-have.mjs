/**
 * Compute Must-Have Score (MHS) for every parcel_risk row.
 *
 * Usage:
 *   node scripts/score-must-have.mjs
 *   node scripts/score-must-have.mjs --limit 10000
 */
import { supabaseConfig, restHeaders } from './lib/load-env.mjs';
import { mustHaveScore } from './lib/fsi-score.mjs';

const { url: SUPABASE_URL, key } = supabaseConfig();
const headers = restHeaders(key, 'resolution=merge-duplicates,return=minimal');
const readHeaders = restHeaders(key, 'return=representation');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const LIMIT = Number(opt('--limit', '0')) || Infinity;
const PAGE = 1000;
const PATCH = 100;

async function main() {
  console.log('Must-Have Score pass');
  console.log(`Target: ${SUPABASE_URL}`);

  let cursor = '';
  let written = 0;
  const bands = { must: 0, should: 0, maybe: 0, skip: 0 };
  const PAGE_SIZE = 500;

  while (written < LIMIT) {
    const params = new URLSearchParams({
      select:
        'parcel_id,fsi_live,fsi_static,fema_zone,hsg,claim_heat,just_value,living_area,year_built,homestead',
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

    const patches = [];
    for (const row of rows) {
      if (written + patches.length >= LIMIT) break;
      const { score, band, reasons } = mustHaveScore(row);
      bands[band] = (bands[band] || 0) + 1;
      patches.push({
        parcel_id: row.parcel_id,
        must_have_score: score,
        must_have_band: band,
        must_have_reasons: reasons,
        updated_at: new Date().toISOString(),
      });
    }

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

    written += patches.length;
    cursor = rows[rows.length - 1].parcel_id;
    process.stdout.write(`\rscored ${written}…`);
    if (rows.length < PAGE_SIZE || written >= LIMIT) break;
  }

  console.log(`\nDone. bands: ${JSON.stringify(bands)}`);
  console.log('Map: Flood Map → Must dial preset (must_have_band=must).');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
