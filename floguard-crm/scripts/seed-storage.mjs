/**
 * Provision FloGuard CRM storage:
 *  1. Create the private Supabase bucket (ACADEMY_STORAGE_BUCKET, default floguard-academy)
 *  2. Seed empty JSON stores (users, leads, activities, practice, ai_usage, web-leads)
 *  3. Verify a read round-trip
 *
 * Reads env from floguard-crm/.env (or process.env). Never prints secret values.
 * Run: npm run seed-storage
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
const url = (env.SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = env.ACADEMY_STORAGE_BUCKET || 'floguard-academy';

if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set them in floguard-crm/.env)');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function ensureBucket() {
  const r = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (r.ok) return console.log(`bucket ${BUCKET}: created`);
  const t = await r.text();
  if (r.status === 409 || /already exists/i.test(t)) return console.log(`bucket ${BUCKET}: already exists`);
  throw new Error(`bucket create failed (${r.status}): ${t.slice(0, 200)}`);
}

async function putIfMissing(object, body) {
  const head = await fetch(`${url}/storage/v1/object/${BUCKET}/${object}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (head.ok) return console.log(`${object}: exists (untouched)`);
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${object}`, {
    method: 'POST',
    headers: { ...headers, 'x-upsert': 'false' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${object} seed failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  console.log(`${object}: seeded`);
}

async function main() {
  await ensureBucket();
  const now = new Date().toISOString();
  await putIfMissing('users.json', { users: [], updated_at: now });
  await putIfMissing('leads.json', { leads: [], updated_at: now });
  await putIfMissing('activities.json', { activities: [], updated_at: now });
  await putIfMissing('practice.json', { events: [], updated_at: now });
  await putIfMissing('ai_usage.json', { usage: [], updated_at: now });
  await putIfMissing('drafts.json', { drafts: [], updated_at: now });
  await putIfMissing('web-leads.json', { leads: [], updated_at: now });

  const check = await fetch(`${url}/storage/v1/object/${BUCKET}/users.json`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!check.ok) throw new Error(`read-back failed (${check.status})`);
  console.log('read-back users.json: OK');
  console.log('\nProvisioning complete.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
