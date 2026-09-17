/**
 * Proves fsi/sql/006 (mhs_score in SQL) matches scripts/lib/fsi-score.mjs.
 * Pulls a spread of parcel_risk rows AFTER mhs_rescore_all() has run and
 * recomputes the JS score + reasons for each; any mismatch fails.
 *
 * Usage:  node --env-file=.env fsi/tests/verify-mhs-sql.mjs [--n 3000]
 */
import { supabaseConfig, restHeaders } from '../../scripts/lib/load-env.mjs';
import { mustHaveScore } from '../../scripts/lib/fsi-score.mjs';

const { url, key } = supabaseConfig();
const headers = restHeaders(key, 'return=representation');
const args = process.argv.slice(2);
const N = Number(args[args.indexOf('--n') + 1]) || 3000;

const SELECT =
  'parcel_id,fsi_live,fsi_static,fema_zone,hsg,claim_heat,just_value,living_area,year_built,homestead,dor_use,use_desc,address,impervious_ratio,lot_sqft,must_have_score,must_have_band,must_have_reasons';

async function page(offset, limit) {
  const r = await fetch(`${url}/rest/v1/parcel_risk?select=${SELECT}&order=parcel_id&offset=${offset}&limit=${limit}`, { headers });
  if (!r.ok) throw new Error(`read ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Spread across the id space: 6 windows of N/6 rows.
const rows = [];
const windows = 6;
const per = Math.ceil(N / windows);
for (let w = 0; w < windows; w++) {
  rows.push(...(await page(w * 50_000, per)));
}

let scoreMismatch = 0;
let reasonMismatch = 0;
const bands = {};
const samples = [];
for (const row of rows) {
  const js = mustHaveScore(row, { assignBand: false });
  const sqlScore = Number(row.must_have_score);
  const sqlReasons = Array.isArray(row.must_have_reasons) ? row.must_have_reasons : [];
  bands[row.must_have_band] = (bands[row.must_have_band] || 0) + 1;
  if (Math.abs(js.score - sqlScore) > 0.11) {
    scoreMismatch++;
    if (samples.length < 5) samples.push({ id: row.parcel_id, js: js.score, sql: sqlScore });
  }
  if (js.reasons.join(',') !== sqlReasons.join(',')) {
    reasonMismatch++;
    if (samples.length < 10) samples.push({ id: row.parcel_id, js: js.reasons, sql: sqlReasons });
  }
}

console.log(`rows=${rows.length} scoreMismatch=${scoreMismatch} reasonMismatch=${reasonMismatch}`);
console.log('bands in sample:', bands);
if (samples.length) console.log('samples:', JSON.stringify(samples, null, 1));
process.exit(scoreMismatch || reasonMismatch ? 1 : 0);
