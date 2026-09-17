/**
 * Offline twin of verify-mhs-sql.mjs for when PostgREST is unreachable (egress cap,
 * paused project). Feed it rows exported from the SQL editor / MCP as a JSON array
 * with the same columns verify-mhs-sql.mjs selects.
 *
 * Usage:  node fsi/tests/verify-mhs-json.mjs path/to/rows.json
 */
import { readFileSync } from 'node:fs';
import { mustHaveScore } from '../../scripts/lib/fsi-score.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node fsi/tests/verify-mhs-json.mjs rows.json');
  process.exit(2);
}
const rows = JSON.parse(readFileSync(file, 'utf8'));

let scoreMismatch = 0;
let reasonMismatch = 0;
const samples = [];
for (const row of rows) {
  const js = mustHaveScore(row, { assignBand: false });
  const sqlScore = Number(row.must_have_score);
  const sqlReasons = Array.isArray(row.must_have_reasons) ? row.must_have_reasons : [];
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
if (samples.length) console.log('samples:', JSON.stringify(samples, null, 1));
process.exit(scoreMismatch || reasonMismatch ? 1 : 0);
