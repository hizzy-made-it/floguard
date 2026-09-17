/**
 * Push fsi/data/parcel_terrain.csv (from fsi/pipeline/terrain_run.py) into
 * parcel_risk via the terrain_apply RPC, then recompute fsi_static / fsi_live / bands.
 *
 * Usage:
 *   node --env-file=.env scripts/upload-terrain.mjs
 *   node --env-file=.env scripts/upload-terrain.mjs --no-recompute
 *
 * If PostgREST is unreachable (project paused / egress cap), use the pg_net path
 * in fsi/sql/011 instead: host the CSV parts and call terrain_load_enqueue(urls).
 */
import { readFileSync } from 'node:fs';
import { supabaseConfig, restHeaders } from './lib/load-env.mjs';

const { url, key } = supabaseConfig();
const headers = restHeaders(key);
const CSV = new URL('../fsi/data/parcel_terrain.csv', import.meta.url);
const BATCH = 2000;
const recompute = !process.argv.includes('--no-recompute');

const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
const [hdr, ...body] = lines;
if (hdr !== 'parcel_id,twi,hand,twi_n,hand_n') throw new Error(`unexpected header: ${hdr}`);
const rows = body.map((l) => {
  const [parcel_id, twi, hand, twi_n, hand_n] = l.split(',');
  return { parcel_id, twi: +twi, hand: +hand, twi_n: +twi_n, hand_n: +hand_n };
});
console.log(`rows: ${rows.length}`);

let applied = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const r = await fetch(`${url}/rest/v1/rpc/terrain_apply`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ rows: chunk }),
  });
  if (!r.ok) throw new Error(`terrain_apply ${r.status}: ${(await r.text()).slice(0, 300)}`);
  applied += Number(await r.text()) || 0;
  process.stdout.write(`\rapplied ${applied} / ${rows.length}`);
}
console.log();

if (recompute) {
  console.log('fsi_recompute_static() — several minutes, runs inside Postgres…');
  const r = await fetch(`${url}/rest/v1/rpc/fsi_recompute_static`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ county: '12127' }),
  });
  console.log(r.status, (await r.text()).slice(0, 500));
  if (!r.ok) console.log('PostgREST timed out? Run in pg_cron: set statement_timeout=\'1800s\'; select fsi_recompute_static();');
}
