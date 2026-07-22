/**
 * Apply FSI SQL migrations when DATABASE_URL is set.
 *
 *   npm run apply-fsi-sql
 *
 * Requires: DATABASE_URL (Postgres connection string from Supabase
 * Dashboard → Project Settings → Database). Service role JWT is not enough.
 *
 * Without DATABASE_URL the Flood Map still works via bundled FIXTURE parcels
 * in api/fsi-parcels.js — this script is for the real public.parcel_risk table.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv(path.join(root, '.env')), ...process.env };
const databaseUrl = (env.DATABASE_URL || '').trim();

if (!databaseUrl) {
  console.error(`Missing DATABASE_URL.

Add the Supabase Postgres URI to floguard-crm/.env:
  DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@aws-0-....pooler.supabase.com:6543/postgres

Dashboard: Project Settings → Database → Connection string (URI).

Until then the map uses bundled FIXTURE parcels (no SQL required).
`);
  process.exit(1);
}

const files = [
  path.join(root, 'fsi', 'sql', '001_parcel_risk.sql'),
  path.join(root, 'fsi', 'sql', '002_seed_fixtures.sql'),
  path.join(root, 'fsi', 'sql', '003_postgis_security_harden.sql'),
  path.join(root, 'fsi', 'sql', '004_must_have_and_appraiser.sql'),
];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error('Missing', file);
    process.exit(1);
  }
  console.log('Applying', path.relative(root, file), '…');
  const r = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', file], {
    encoding: 'utf8',
    shell: true,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`psql failed for ${file} (exit ${r.status}). Is psql installed and DATABASE_URL correct?`);
    process.exit(r.status || 1);
  }
  console.log('OK', path.basename(file));
}

console.log('\nFSI schema + fixtures applied. Re-open Flood Map (Top countywide).');
