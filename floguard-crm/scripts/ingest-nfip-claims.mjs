/**
 * OpenFEMA NFIP redacted claims (v3) -> block-group + event + tract aggregates -> parcel claim_heat.
 *
 * Compliance: neighbourhood grain ONLY (block group / tract). Never implies a named owner filed a
 * claim. Never used as insurance advice.
 *
 * WHY THERE IS NO LAT/LONG GRID ANY MORE
 *   OpenFEMA redacts claim latitude/longitude to 0.1 degree (~11 km). The old script binned those
 *   points into 0.02 degree cells and faded heat out over 0.12 degrees, which invented a precision
 *   the data does not have: every claim in a 0.1 degree box landed on one cell centre. Each v3 claim
 *   instead carries `censusGeoid`, a 12-digit census block-group FIPS, which is the finest location
 *   OpenFEMA actually publishes. Everything here is keyed on that.
 *
 * ENDPOINT
 *   v3: https://www.fema.gov/api/open/v3/NfipClaims   (v2 FimaNfipClaims is frozen at 2026-06-01)
 *
 * VINTAGE
 *   Claim geoids can be 2010 or 2020 block groups. Parcels are matched against the 2020 TIGERweb
 *   polygons, so claims whose FIPS is not in the 2020 set cannot be placed on the map. They are still
 *   counted in the tract table (tract = first 11 digits) and the number is logged.
 *
 * Usage:
 *   node scripts/ingest-nfip-claims.mjs                       full run (needs fsi/sql/016 applied)
 *   node scripts/ingest-nfip-claims.mjs --dry-run             fetch + aggregate, print summary, write nothing
 *   node scripts/ingest-nfip-claims.mjs --emit-sql out/claims  write SQL files instead of calling the database
 *                                                          (no service key needed; apply them in the SQL editor,
 *                                                          then fsi/sql/023's assign + 016's apply)
 *   node scripts/ingest-nfip-claims.mjs --since 2024          refresh nfip_claim_event for loss years >= 2024 only
 *   node scripts/ingest-nfip-claims.mjs --api-version v2      frozen legacy dataset (not recommended)
 *   flags: --years N (tract window, default 12)  --page N (default 5000, max 10000)
 *          --no-geom (skip polygon upload)  --skip-parcels  --reassign-all
 *
 * --since note: every v3 record carries the same asOfDate (the file refresh date), so it cannot be used
 * for incremental pulls. --since filters on dateOfLoss, snapped to Jan 1 of that year because event rows
 * are keyed by year. It refreshes nfip_claim_event only; block-group totals need a full run.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { supabaseConfig, restHeaders } from './lib/load-env.mjs';
import {
  fetchAllClaims,
  fetchBlockGroups2020,
  aggregateClaims,
  finalizeBlockGroups,
  eventRows,
  tractRows,
  buildBlockGroupIndex,
  buildParcelPatches,
  sinceToYearStart,
  COUNTY_FIPS,
} from './lib/claims.mjs';

export * from './lib/claims.mjs';

export function parseArgs(argv) {
  const flag = (n) => argv.includes(n);
  const opt = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
  };
  const page = Math.min(10000, Math.max(100, Number(opt('--page', '5000')) || 5000));
  return {
    apiVersion: opt('--api-version', 'v3'),
    since: opt('--since', null),
    years: Number(opt('--years', '12')) || 12,
    page,
    dryRun: flag('--dry-run'),
    emitSql: (() => { const i = argv.indexOf('--emit-sql'); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; })(),
    noGeom: flag('--no-geom'),
    skipParcels: flag('--skip-parcels'),
    reassignAll: flag('--reassign-all'),
  };
}

const log = (s) => process.stdout.write(`${s}\n`);

/* ------------------------------ Supabase helpers (main only) ------------------------------ */

function makeDb() {
  const { url, key } = supabaseConfig();
  const writeH = restHeaders(key, 'resolution=merge-duplicates,return=minimal');
  const readH = restHeaders(key, 'return=representation');
  return {
    url,
    async upsert(table, rows, onConflict, batch = 100) {
      const u = `${url}/rest/v1/${table}?on_conflict=${onConflict}`;
      for (let i = 0; i < rows.length; i += batch) {
        const r = await fetch(u, { method: 'POST', headers: writeH, body: JSON.stringify(rows.slice(i, i + batch)) });
        if (!r.ok) throw new Error(`${table} upsert ${r.status}: ${(await r.text()).slice(0, 300)}${hint016(r.status)}`);
      }
    },
    async get(pathAndQuery) {
      const r = await fetch(`${url}/rest/v1/${pathAndQuery}`, { headers: readH });
      if (!r.ok) throw new Error(`GET ${pathAndQuery.slice(0, 60)} ${r.status}: ${(await r.text()).slice(0, 200)}${hint016(r.status)}`);
      return r.json();
    },
    async rpc(name, body = {}) {
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: readH, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`rpc ${name} ${r.status}: ${(await r.text()).slice(0, 200)}${hint016(r.status)}`);
      return r.json();
    },
  };
}

function hint016(status) {
  return status === 404 || status === 400 ? '  (is fsi/sql/016_claims_block_group.sql applied?)' : '';
}

async function assignParcels(db, index, { reassignAll }) {
  log('Assigning block_group to parcels (point in polygon on parcel lat/lon)…');
  let cursor = '';
  const total = { seen: 0, assigned: 0, outside: 0, bad_coords: 0, unchanged: 0, written: 0 };
  const PAGE_P = 1000;
  for (;;) {
    const params = new URLSearchParams({ select: 'parcel_id,lat,lon,block_group', order: 'parcel_id', limit: String(PAGE_P) });
    if (!reassignAll) params.set('block_group', 'is.null');
    if (cursor) params.set('parcel_id', `gt.${cursor}`);
    const rows = await db.get(`parcel_risk?${params}`);
    if (!rows.length) break;
    const { patches, counts } = buildParcelPatches(rows, index, { reassignAll });
    for (const k of Object.keys(counts)) total[k] += counts[k];
    const withBg = patches.filter((p) => p.block_group);
    if (withBg.length) await db.upsert('parcel_risk', withBg, 'parcel_id');
    total.written += withBg.length;
    cursor = rows[rows.length - 1].parcel_id;
    process.stdout.write(`\r  parcels seen ${total.seen}, assigned ${total.assigned}…`);
    if (rows.length < PAGE_P) break;
  }
  process.stdout.write('\n');
  log(`  parcels ${total.seen} · in a 2020 block group ${total.assigned} · outside all polygons ${total.outside} · bad coords ${total.bad_coords} · rows written ${total.written}`);
}

/* ----------------------------------------- main ----------------------------------------- */

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  const asOfYear = new Date().getFullYear();
  const since = sinceToYearStart(o.since);
  log(`NFIP claims -> block group (OpenFEMA ${o.apiVersion}, county ${COUNTY_FIPS}${since ? `, loss years >= ${since.year}` : ''}${o.dryRun ? ', DRY RUN' : ''})`);

  const db = o.dryRun || o.emitSql ? null : makeDb();
  if (db) log(`Target: ${db.url}`);

  log('OpenFEMA claims…');
  const { claims, total } = await fetchAllClaims({ apiVersion: o.apiVersion, since: o.since, top: o.page, log: (s) => process.stdout.write(`\r${s}   `) });
  process.stdout.write('\n');
  log(`  fetched ${claims.length}${total != null ? ` (server count ${total})` : ''}`);
  if (!claims.length) {
    log('No claims returned.');
    return;
  }

  log('Census 2020 block groups (TIGERweb)…');
  const needGeom = !since;
  const bgFull = await fetchBlockGroups2020({ geometry: needGeom, log: (s) => process.stdout.write(`\r${s}   `) });
  process.stdout.write('\n');
  log(`  2020 block groups in county: ${bgFull.size}`);

  const agg = aggregateClaims(claims, { bgSet: bgFull, asOfYear, tractYears: o.years });
  const s = agg.stats;
  const pct = (n) => (s.total ? `${((100 * n) / s.total).toFixed(1)}%` : '0%');
  log(
    `Claims ${s.total}: block-group ${s.bg_assigned} (${pct(s.bg_assigned)}) · ` +
      `vintage fallback to tract ${s.fallback_tract} claims in ${s.fallback_fips} FIPS not in the 2020 set (${pct(s.fallback_tract)}) · ` +
      `tract-only geoid ${s.tract_only} · no geoid ${s.no_geoid} · other county ${s.other_county}`,
  );
  log(`  zone split on block-group claims: SFHA ${s.zone.sfha} · zone X ${s.zone.zone_x} · other ${s.zone.other}`);

  // ---- --since: events only ----
  if (since) {
    const ev = eventRows(agg.events, { fromYear: since.year });
    log(`Event rows for loss years >= ${since.year}: ${ev.length}`);
    if (!o.dryRun) {
      await db.upsert('nfip_claim_event', ev, 'block_group,event_key,event_year', 500);
      log('Upserted nfip_claim_event. Block-group totals unchanged; run without --since to refresh them.');
    }
    return;
  }

  // ---- full run ----
  let bgMeta = bgFull;
  for (const m of bgMeta.values()) m.geomGeojson = null;
  if (!o.noGeom) {
    log('Generalised polygons for the map layer…');
    const light = await fetchBlockGroups2020({ generalize: 0.0003, log: (s2) => process.stdout.write(`\r${s2}   `) });
    process.stdout.write('\n');
    for (const [k, v] of light) if (bgMeta.has(k)) bgMeta.get(k).geomGeojson = v.geometry;
  }

  const bgRows = finalizeBlockGroups(agg.blockGroups, agg.events, bgMeta, { asOfYear });
  const evRows = eventRows(agg.events);
  const trRows = tractRows(agg.tracts);
  const hot = [...bgRows].sort((a, b) => b.heat - a.heat).slice(0, 5);
  log(`Block-group rows ${bgRows.length} (with claims ${bgRows.filter((r) => r.claim_count_all > 0).length}) · event rows ${evRows.length} · tract rows ${trRows.length}`);
  log('  hottest: ' + hot.map((r) => `${r.block_group} heat ${r.heat} (${r.claim_zone_x_10y} zone X / ${r.claim_sfha_10y} SFHA)`).join('; '));

  if (o.emitSql) {
    const { buildClaimsSqlFiles } = await import('./lib/claims-sql.mjs');
    const fs = await import('node:fs');
    fs.mkdirSync(o.emitSql, { recursive: true });
    const files = buildClaimsSqlFiles({ bgRows, evRows, trRows });
    for (const f of files) fs.writeFileSync(path.join(o.emitSql, f.name), f.sql);
    log(`--emit-sql: wrote ${files.length} files to ${o.emitSql} (nothing sent to the database). Apply them in name order, then fsi/sql/023.`);
    return;
  }
  if (o.dryRun) {
    log('Dry run: nothing written.');
    return;
  }

  log(`Upserting ${bgRows.length} nfip_claim_block_group rows…`);
  await db.upsert('nfip_claim_block_group', bgRows, 'block_group', 50);
  log(`Upserting ${evRows.length} nfip_claim_event rows…`);
  await db.upsert('nfip_claim_event', evRows, 'block_group,event_key,event_year', 500);
  log(`Upserting ${trRows.length} nfip_claim_tract rows (legacy, backward compatible)…`);
  await db.upsert('nfip_claim_tract', trRows, 'census_tract');
  if (!o.noGeom) {
    try {
      log(`  geometry built for ${await db.rpc('nfip_claim_bg_build_geom')} block groups`);
    } catch (e) {
      log(`  WARN geometry build skipped: ${e.message}`);
    }
  }

  if (o.skipParcels) {
    log('--skip-parcels: not touching parcel_risk.');
  } else {
    await assignParcels(db, buildBlockGroupIndex(bgMeta), { reassignAll: o.reassignAll });
    log('Applying block-group aggregates + claim_heat to parcels (tract fallback where no block group)…');
    const BUCKETS = 8;
    let changed = 0;
    for (let b = 0; b < BUCKETS; b++) {
      changed += Number(await db.rpc('nfip_apply_block_group_claims', { p_buckets: BUCKETS, p_bucket: b })) || 0;
      process.stdout.write(`\r  bucket ${b + 1}/${BUCKETS}, rows changed ${changed}…`);
    }
    process.stdout.write('\n');
  }
  log('Done. Next: node scripts/score-must-have.mjs');
  log('Compliance: claim data is a neighbourhood aggregate only, never a property-level insurance claim.');
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
