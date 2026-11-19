#!/usr/bin/env node
/**
 * Migrate shared leads into Postgres (public.leads, fsi/sql/017).
 *
 *   node scripts/migrate-leads-to-pg.mjs --dry-run
 *   node scripts/migrate-leads-to-pg.mjs --file ~/Downloads/floguard_leads_backup.json
 *   node scripts/migrate-leads-to-pg.mjs --file a.json --file b.json --no-storage
 *
 * Sources (merged in this order, later wins on non-empty fields):
 *   1. <bucket>/leads.json from Supabase Storage (skipped with --no-storage)
 *   2. each --file: a browser "JSON backup" ({version, leads:[...]}), {leads:[...]}, or a bare array
 *
 * Idempotent: identity matching (uuid/id, parcel_id, name+city+address — see
 * server/lib/leads-core.js) means re-running updates/skips instead of duplicating; rows that
 * would not change are not written. Existing numeric ids are kept as legacy_id for new rows.
 * Nothing is deleted.
 *
 * --dry-run prints counts (insert / update / skip / conflict) and writes nothing. If 017 has
 * not been applied yet, the dry run plans against an empty table (so it shows what the
 * first real run would insert).
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env or floguard-crm/.env). Optional:
 * ACADEMY_STORAGE_BUCKET (default floguard-academy), ACADEMY_DEFAULT_ORG_SLUG (default floguard).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/** Accepts {leads:[...]}, a bare array, or a browser backup {version, exported_at, leads}. */
export function parseLeadsExport(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.leads)) return data.leads;
  throw new Error('Unrecognised export: expected an array or an object with a "leads" array.');
}

/**
 * @param {object[]} incoming
 * @param {{dryRun?:boolean}} opts
 * @returns {Promise<{dryRun:boolean, ready:boolean, counts:object, conflicts:object[], existing:number, applied:boolean}>}
 */
export async function migrateLeads(incoming, { dryRun = false } = {}) {
  const pg = await import('../server/lib/academy-pg.js');
  const { planUpsert } = await import('../server/lib/leads-core.js');
  const ready = await pg.pgLeadsReady({ force: true });
  if (!ready) {
    if (!dryRun) {
      throw new Error('public.leads is missing the 017 pipeline columns. Apply fsi/sql/017_leads_pipeline.sql first.');
    }
    const plan = planUpsert([], incoming);
    return { dryRun, ready, counts: plan.counts, conflicts: plan.conflicts, existing: 0, applied: false };
  }
  const r = await pg.pgUpsertLeads(incoming, { dryRun, keepClientIds: true, actor: 'migrate' });
  return { dryRun, ready, counts: r.counts, conflicts: r.conflicts, existing: r.count - r.added, applied: !dryRun };
}

function parseArgs(argv) {
  const a = { dryRun: false, files: [], storage: true };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--no-storage') a.storage = false;
    else if (v === '--file') a.files.push(argv[(i += 1)]);
    else if (v.startsWith('--file=')) a.files.push(v.slice(7));
    else if (v === '-h' || v === '--help') a.help = true;
    else throw new Error(`Unknown argument: ${v}`);
  }
  return a;
}

async function main() {
  loadEnvFile(path.join(root, '.env'));
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/migrate-leads-to-pg.mjs [--dry-run] [--file export.json]... [--no-storage]');
    return;
  }
  const incoming = [];
  const sources = [];
  if (args.storage) {
    const { storageGetJson } = await import('../server/lib/supabase-rest.js');
    const bucket = process.env.ACADEMY_STORAGE_BUCKET || 'floguard-academy';
    const blob = await storageGetJson(bucket, 'leads.json');
    const leads = blob && Array.isArray(blob.leads) ? blob.leads : [];
    incoming.push(...leads);
    sources.push(`storage ${bucket}/leads.json: ${leads.length}`);
  }
  for (const f of args.files) {
    const leads = parseLeadsExport(fs.readFileSync(f, 'utf8'));
    incoming.push(...leads);
    sources.push(`file ${f}: ${leads.length}`);
  }
  if (!incoming.length) {
    console.log('Nothing to migrate (no source returned leads).');
    return;
  }
  console.log(`Sources:\n  ${sources.join('\n  ')}\nTotal incoming rows: ${incoming.length}`);
  const r = await migrateLeads(incoming, { dryRun: args.dryRun });
  const c = r.counts;
  console.log(
    `${r.dryRun ? 'DRY RUN' : 'APPLIED'}${r.ready ? '' : ' (017 not applied yet; planned against an empty table)'}\n` +
      `  insert:   ${c.insert}\n  update:   ${c.update}\n` +
      `  skip:     ${c.skip_noop + c.skip_invalid + c.skip_deleted} (unchanged ${c.skip_noop}, invalid ${c.skip_invalid}, soft-deleted ${c.skip_deleted})\n` +
      `  conflict: ${c.conflict}`,
  );
  for (const x of r.conflicts.slice(0, 20)) console.log(`    conflict: ${x.name} (${x.reason})`);
  if (r.conflicts.length > 20) console.log(`    ... ${r.conflicts.length - 20} more`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
}
