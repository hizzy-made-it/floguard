/**
 * Backfill site address / zip / owner on CRM leads from public.parcel_risk
 * using parcel_id. Fixes older FSI map imports that stored parcel but not address
 * (BatchData skip-trace needs a site address).
 *
 * Usage (from floguard-crm/):
 *   node scripts/backfill-lead-addresses.mjs
 *   node scripts/backfill-lead-addresses.mjs --dry-run
 *   node scripts/backfill-lead-addresses.mjs --push-notes
 */
import { loadEnv } from './lib/load-env.mjs';
import { restGet } from '../server/lib/supabase-rest.js';
import { loadLeadsStore, saveLeadsStore } from '../server/lib/academy-db.js';

loadEnv();

const dryRun = process.argv.includes('--dry-run');
const pushNotes = process.argv.includes('--push-notes');

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function zipFromAddress(addr) {
  const m = String(addr || '').match(/\bFL\s*(\d{5})(?:-\d{4})?\b/i)
    || String(addr || '').match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : '';
}

function patchNotes(notes, address) {
  if (!pushNotes || !address) return notes;
  const text = String(notes || '');
  if (/^\s*Site address:\s*/im.test(text)) {
    return text.replace(/^\s*Site address:\s*.*$/im, `Site address: ${address}`);
  }
  if (/^FSI map import/m.test(text)) {
    return text.replace(/^FSI map import\s*$/m, `FSI map import\nSite address: ${address}`);
  }
  return `Site address: ${address}\n${text}`.trim();
}

async function fetchParcelMap(parcelIds) {
  const map = new Map();
  if (!parcelIds.length) return map;
  // PostgREST in.() — batch to stay under URL limits
  for (const batch of chunk(parcelIds, 80)) {
    const list = batch.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',');
    const q =
      `select=parcel_id,address,owner_name,city,zip` +
      `&parcel_id=in.(${list})`;
    try {
      const rows = await restGet('parcel_risk', q);
      for (const row of rows || []) {
        if (row?.parcel_id) map.set(String(row.parcel_id), row);
      }
    } catch (e) {
      console.error('parcel_risk lookup failed:', e.message || e);
      throw e;
    }
  }
  return map;
}

async function main() {
  const store = await loadLeadsStore();
  const leads = Array.isArray(store.leads) ? store.leads : [];
  console.log(`Leads in store: ${leads.length}`);

  const need = leads.filter((l) => {
    const pid = String(l.parcel_id || '').trim();
    const addr = String(l.address || '').trim();
    return pid && !addr;
  });
  console.log(`Missing address but have parcel_id: ${need.length}`);
  if (!need.length) {
    console.log('Nothing to backfill.');
    return;
  }

  const ids = [...new Set(need.map((l) => String(l.parcel_id).trim()))];
  console.log(`Unique parcel_ids to look up: ${ids.length}`);
  const map = await fetchParcelMap(ids);
  console.log(`parcel_risk hits: ${map.size}`);

  let updated = 0;
  let noHit = 0;
  for (const l of leads) {
    const pid = String(l.parcel_id || '').trim();
    if (!pid || String(l.address || '').trim()) continue;
    const row = map.get(pid);
    if (!row || !String(row.address || '').trim()) {
      noHit++;
      continue;
    }
    const addr = String(row.address).trim();
    l.address = addr;
    if (!String(l.zip || '').trim()) {
      l.zip = String(row.zip || '').trim() || zipFromAddress(addr);
    }
    if (!String(l.city || '').trim() && row.city) {
      l.city = String(row.city).trim();
    }
    if (!String(l.owner || '').trim() && row.owner_name) {
      l.owner = String(row.owner_name).trim();
    }
    // Prefer tax-roll owner as contact when empty
    if (!String(l.contact || '').trim() && row.owner_name) {
      l.contact = String(row.owner_name).trim();
    }
    l.notes = patchNotes(l.notes, addr);
    updated++;
  }

  console.log(`Updated: ${updated} · no parcel_risk hit: ${noHit}`);
  if (dryRun) {
    console.log('Dry run — store not saved.');
    return;
  }
  store.leads = leads;
  store.updated_at = new Date().toISOString();
  await saveLeadsStore(store);
  console.log('Saved leads store.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
