/**
 * Push fsi/data/parcel_depression.csv (from fsi/pipeline/depression_run.py)
 * into parcel_risk.depr_m / depr_n via the depr_apply RPC (fsi/sql/013).
 * Recompute afterwards with fsi_recompute_static() (pg_cron with a raised
 * statement_timeout, or the 012 batches on a tight disk).
 *
 * Usage:  node --env-file=.env scripts/upload-depression.mjs
 */
import { readFileSync } from 'node:fs';
import { supabaseConfig, restHeaders } from './lib/load-env.mjs';

const { url, key } = supabaseConfig();
const headers = restHeaders(key);
const CSV = new URL('../fsi/data/parcel_depression.csv', import.meta.url);
const BATCH = 4000;

const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
const [hdr, ...body] = lines;
if (hdr !== 'parcel_id,depr_m,depr_n') throw new Error(`unexpected header: ${hdr}`);
const rows = body.map((l) => {
  const [parcel_id, depr_m, depr_n] = l.split(',');
  return { parcel_id, depr_m: +depr_m, depr_n: +depr_n };
});
console.log(`rows: ${rows.length}`);

let applied = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const r = await fetch(`${url}/rest/v1/rpc/depr_apply`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ rows: rows.slice(i, i + BATCH) }),
  });
  if (!r.ok) throw new Error(`depr_apply ${r.status}: ${(await r.text()).slice(0, 300)}`);
  applied += Number(await r.text()) || 0;
  process.stdout.write(`\rapplied ${applied} / ${rows.length}`);
}
console.log('\ndone. Next: recompute static (fsi_recompute_static or the 012 batches).');
