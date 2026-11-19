#!/usr/bin/env node
// JS <-> SQL contract check against a migrated local database (run by run-local.sh).
//   env: PGHOST (socket dir), PGPORT, PGUSER, PGDATABASE
// 1. every column name the JS writes/selects exists in the migrated schema
// 2. the JS heat formula (scripts/lib/claims.mjs) agrees with public.nfip_recompute_block_group_heat()
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const crm = path.resolve(here, '../../..');
const mod = (p) => import(pathToFileURL(path.join(crm, p)).href);

const psql = (sql, input) =>
  execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', input }).trim();
const psqlFile = (sql) => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { encoding: 'utf8', input: sql }).trim();

const cols = {};
for (const line of psql("select table_name || '.' || column_name from information_schema.columns where table_schema = 'public'").split('\n')) {
  const [t, c] = line.split('.');
  (cols[t] ||= new Set()).add(c);
}

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' -- ' + detail}`);
  if (!ok) fails++;
};
const subset = (name, table, keys) => {
  const missing = [...keys].filter((k) => !cols[table]?.has(k));
  check(`${name}: all ${keys.size ?? keys.length} columns exist in public.${table}`, missing.length === 0, `missing: ${missing.join(', ')}`);
};

// ---------------------------------------------------------------- claims (016)
const claims = await mod('scripts/lib/claims.mjs');
const api = await mod('api/fsi-parcels.js');

const aggKey = '121270825061';
const agg = new Map([[aggKey, {
  block_group: aggKey, tract: aggKey.slice(0, 11), claim_count_all: 5, claim_count_10y: 4, claim_count_5y: 3, claim_last_year: 2023,
  paid_total_10y: 1000, claim_sfha_all: 1, claim_zone_x_all: 3, claim_other_all: 1, claim_sfha_10y: 1, claim_zone_x_10y: 2, claim_other_10y: 1,
  _depths: [10, 20],
}]]);
const bgMeta = new Map([[aggKey, { tract: aggKey.slice(0, 11), hu: 800, lat: 29.1, lon: -81.0, bbox: [-81.1, 29.0, -80.9, 29.2], geomGeojson: { type: 'Polygon', coordinates: [] } }]]);
const events = new Map([['e', { block_group: aggKey, event_key: 'Hurricane Ian', event_year: 2022, event_name: 'Hurricane Ian', event_designation: 'FL0222', claim_count: 4, paid_total: 10, sfha_count: 1, zone_x_count: 2, other_count: 1 }]]);
const bgRows = claims.finalizeBlockGroups(agg, events, bgMeta, { asOfYear: 2026 });
subset('ingest block-group rows', 'nfip_claim_block_group', new Set(Object.keys(bgRows[0])));
subset('ingest event rows', 'nfip_claim_event', new Set(Object.keys(claims.eventRows(events)[0])));
const tracts = new Map([['t', { census_tract: '12127082506', claim_count_10y: 1, claim_count_all: 2, paid_sum: 3, last_loss_year: 2020, multi_loss_flag: false, heat: 0.5 }]]);
subset('ingest tract rows', 'nfip_claim_tract', new Set(Object.keys(claims.tractRows(tracts)[0])));
const q = api.buildClaimsLayerQuery({ w: -82, s: 29, e: -81, n: 30 }, { includeGeom: true });
const sel = new URLSearchParams(q).get('select').split(',');
subset('claims_layer select list', 'nfip_claim_block_group', new Set(sel));
const evCols = fs_read(path.join(crm, 'api/fsi-parcels.js')).match(/const EVENT_COLS = '([^']+)'/)[1].split(',');
subset('claims_layer event select list', 'nfip_claim_event', new Set(evCols));
subset('parcel read columns (COLUMNS_BASE + COLUMNS_OPTIONAL)', 'parcel_risk', new Set([...api.COLUMNS_BASE, ...api.COLUMNS_OPTIONAL]));
subset('parcel patches written by the ingest', 'parcel_risk', new Set(['parcel_id', 'block_group']));

// JS heat vs SQL heat on 300 pseudo-random block groups
let seed = 42;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor((seed / 4294967296) * n); };
const rows = [];
for (let i = 0; i < 300; i++) {
  const sfha = rnd(4) === 0 ? 0 : rnd(15), zx = rnd(3) === 0 ? 0 : rnd(25), other = rnd(6) === 0 ? 1 : 0;
  rows.push({ block_group: `99${String(1000000000 + i)}`.slice(0, 12), claim_sfha_10y: sfha, claim_zone_x_10y: zx, claim_other_10y: other, claim_count_10y: sfha + zx + other, heat: 0 });
}
claims.applyHeat(rows);
const values = rows.map((r) => `('${r.block_group}', ${r.claim_sfha_10y}, ${r.claim_zone_x_10y}, ${r.claim_other_10y}, ${r.claim_count_10y}, 1000)`).join(',');
const out = psqlFile(`
  begin;
  create temp table _saved as select * from public.nfip_claim_block_group;
  delete from public.nfip_claim_block_group;
  insert into public.nfip_claim_block_group (block_group, claim_sfha_10y, claim_zone_x_10y, claim_other_10y, claim_count_10y, housing_units) values ${values};
  select public.nfip_recompute_block_group_heat();
  select block_group || ',' || heat from public.nfip_claim_block_group order by 1;
  rollback;`);
const sqlHeat = new Map(out.split('\n').filter((l) => l.includes(',')).map((l) => l.split(',')));
let maxDiff = 0;
for (const r of rows) maxDiff = Math.max(maxDiff, Math.abs(Number(sqlHeat.get(r.block_group)) - r.heat));
check(`JS applyHeat equals SQL nfip_recompute_block_group_heat on ${rows.length} rows (max diff ${maxDiff.toExponential(2)}; JS rounds to 3 dp)`, sqlHeat.size === rows.length && maxDiff <= 0.0006, `rows ${sqlHeat.size}, maxDiff ${maxDiff}`);

// ---------------------------------------------------------------- leads (017)
const core = await mod('server/lib/leads-core.js');
const lead = {
  id: 7, name: 'Pat Owner', city: 'Ormond Beach', address: '1 Main St', zip: '32174', parcel_id: 'P-1', industry: 'x', lead_type: 'flood',
  list: 'Flood', lists: ['Flood'], phone: '(386) 555-0100', website: 'w', email: 'e@x.co', contact: 'c', owner: 'o', status: 'Quoted',
  notes: 'n', source: 's', custom_type: 'ct', package: 'p', amount: 5, phones: [{ number: '(386) 555-0100' }], phone_dnc: false,
  phone_line_type: 'mobile', phone_source: 'batchdata', phone_confidence: 0.9, email_source: 'web', enriched_at: '2026-11-01T00:00:00Z',
  next_follow_up_at: '2026-11-25', last_activity_at: '2026-11-02T00:00:00Z', next_action: { type: 'call', due_at: '2026-11-20T15:00:00Z', note: 'x' },
  website_score: 3, deleted_at: null,
};
const leadRow = core.leadToRow(lead, { orgId: null });
subset('leadToRow keys', 'leads', new Set(Object.keys(leadRow)));
subset('leads select used by readiness probe', 'leads', new Set(['id', 'stage', 'data', 'deleted_at', 'parcel_id']));
subset('lead_activity insert (activity_add)', 'lead_activity', new Set(['lead_id', 'actor', 'type', 'direction', 'outcome', 'body', 'meta', 'at']));
subset('lead_tasks insert (task_add / next_action)', 'lead_tasks', new Set(['lead_id', 'type', 'due_at', 'note', 'created_by', 'is_next_action', 'done_at']));
subset('lead_tasks_due view (tasks_due response)', 'lead_tasks_due', new Set(['id', 'lead_id', 'type', 'due_at', 'note', 'created_by', 'is_next_action', 'bucket', 'lead_name', 'lead_phone', 'lead_stage', 'lead_phone_dnc']));
subset('lead_funnel view (funnel response)', 'lead_funnel', new Set(['stage', 'leads', 'amount']));
check('JS STAGES equal the SQL stage CHECK list',
  JSON.stringify(core.STAGES.slice().sort()) === JSON.stringify(
    psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'leads_stage_check'").match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, '')).sort()),
  psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'leads_stage_check'"));
const act = psql("select pg_get_constraintdef(c.oid) from pg_constraint c where conrelid = 'public.lead_activity'::regclass and contype = 'c' and pg_get_constraintdef(c.oid) like '%note%'");
check('JS ACTIVITY_TYPES equal the SQL activity type CHECK list', JSON.stringify(core.ACTIVITY_TYPES.slice().sort()) === JSON.stringify([...act.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort()), act);
const tk = psql("select pg_get_constraintdef(c.oid) from pg_constraint c where conrelid = 'public.lead_tasks'::regclass and contype = 'c' and pg_get_constraintdef(c.oid) like '%visit%'");
check('JS TASK_TYPES equal the SQL task type CHECK list', JSON.stringify(core.TASK_TYPES.slice().sort()) === JSON.stringify([...tk.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort()), tk);

// stage derivation: SQL backfill (primary status only) must agree with JS stageFromStatus for the statuses the backfill names
const statuses = ['New', '', 'Called - no answer', 'Callback', 'Interested', 'Quoted', 'Deposit collected', 'Contract signed', 'Not interested', 'Do not contact', 'Archived'];
const sqlStages = psql(`select s, case
      when lower(coalesce(s, '')) in ('contract signed', 'deposit collected', 'closed') then 'won'
      when lower(coalesce(s, '')) in ('quoted') then 'estimate_sent'
      when lower(coalesce(s, '')) in ('callback', 'interested', 'contacted', 'follow_up') or lower(coalesce(s, '')) like 'called%' then 'contacted'
      when lower(coalesce(s, '')) in ('not interested', 'do not contact', 'lost') then 'lost'
      when lower(coalesce(s, '')) in ('archived') then 'nurture' else 'new' end
    from unnest(array[${statuses.map((s) => `'${s}'`).join(',')}]) s`).split('\n').map((l) => l.split('|'));
const bad = sqlStages.filter(([s, st]) => core.stageFromStatus(s) !== st).map(([s, st]) => `${s}: sql=${st} js=${core.stageFromStatus(s)}`);
check('017 backfill CASE matches JS stageFromStatus for every named legacy status', bad.length === 0, bad.join('; '));

function fs_read(p) { return execFileSync('cat', [p], { encoding: 'utf8' }); }
process.exit(fails ? 1 : 0);
