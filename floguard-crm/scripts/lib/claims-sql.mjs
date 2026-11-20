/**
 * Turn the claims ingest result into SQL files that can be pasted into (or fetched by) the
 * Supabase SQL editor. For when the service-role key is not available on the machine running
 * the ingest: `node scripts/ingest-nfip-claims.mjs --emit-sql out/dir`.
 *
 * Each file is one transaction-safe upsert built on jsonb_populate_recordset, so column types
 * come from the table itself. Files are split so no single statement is too large for the editor.
 * Aggregates only: these rows are census block-group / tract totals, never a property's claim.
 */

/** A dollar-quote tag that cannot occur in the payload. */
export function dollarTag(payload, base = 'claims') {
  let tag = base;
  let i = 0;
  while (payload.includes(`$${tag}$`)) tag = `${base}${++i}`;
  return tag;
}

function columnsOf(rows) {
  const cols = new Set();
  for (const r of rows) for (const k of Object.keys(r)) cols.add(k);
  return [...cols];
}

/** One upsert statement for `rows` into public.<table>, conflict target `conflict` (comma list). */
export function upsertSql(table, rows, conflict) {
  if (!rows.length) return `-- ${table}: no rows\n`;
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`bad table name ${table}`);
  const cols = columnsOf(rows);
  for (const c of cols) if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`bad column name ${c}`);
  const keys = conflict.split(',').map((s) => s.trim());
  const sets = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
  const payload = JSON.stringify(rows);
  const tag = dollarTag(payload);
  return (
    `insert into public.${table} (${cols.join(', ')})\n` +
    `select ${cols.join(', ')} from jsonb_populate_recordset(null::public.${table}, $${tag}$${payload}$${tag}$::jsonb)\n` +
    `on conflict (${keys.join(', ')}) do ${sets.length ? `update set ${sets.join(', ')}` : 'nothing'};\n`
  );
}

/** Split rows so each chunk's JSON stays under maxBytes (at least one row per chunk). */
export function chunkBySize(rows, maxBytes) {
  const out = [];
  let cur = [];
  let size = 2;
  for (const r of rows) {
    const n = Buffer.byteLength(JSON.stringify(r)) + 1;
    if (cur.length && size + n > maxBytes) {
      out.push(cur);
      cur = [];
      size = 2;
    }
    cur.push(r);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * @returns {{name: string, sql: string}[]} files in apply order. Geometry (geom_geojson) is split
 * from the block-group counts so the counts land even if a geometry chunk fails.
 */
export function buildClaimsSqlFiles({ bgRows, evRows, trRows }, { maxBytes = 400_000 } = {}) {
  const files = [];
  const head = '-- NFIP claim aggregates (OpenFEMA). Neighbourhood totals only, never a property-level claim.\n';
  const counts = bgRows.map(({ geom_geojson, ...rest }) => rest);
  chunkBySize(counts, maxBytes).forEach((rows, i) => {
    files.push({ name: `01_block_groups_${String(i + 1).padStart(2, '0')}.sql`, sql: head + upsertSql('nfip_claim_block_group', rows, 'block_group') });
  });
  chunkBySize(evRows, maxBytes).forEach((rows, i) => {
    files.push({ name: `02_events_${String(i + 1).padStart(2, '0')}.sql`, sql: head + upsertSql('nfip_claim_event', rows, 'block_group,event_key,event_year') });
  });
  chunkBySize(trRows, maxBytes).forEach((rows, i) => {
    files.push({ name: `03_tracts_${String(i + 1).padStart(2, '0')}.sql`, sql: head + upsertSql('nfip_claim_tract', rows, 'census_tract') });
  });
  const geoms = bgRows.filter((r) => r.geom_geojson).map((r) => ({ block_group: r.block_group, geom_geojson: r.geom_geojson }));
  chunkBySize(geoms, maxBytes).forEach((rows, i) => {
    const payload = JSON.stringify(rows);
    const tag = dollarTag(payload);
    files.push({
      name: `04_geometry_${String(i + 1).padStart(2, '0')}.sql`,
      sql:
        head +
        `update public.nfip_claim_block_group b set geom_geojson = v.geom_geojson\n` +
        `  from jsonb_to_recordset($${tag}$${payload}$${tag}$::jsonb) as v(block_group text, geom_geojson jsonb)\n` +
        ` where b.block_group = v.block_group;\n`,
    });
  });
  files.push({
    name: '05_finish.sql',
    sql:
      head +
      '-- Build PostGIS geometry, then run 023 assignment + 016 apply in buckets (see fsi/sql/023).\n' +
      'select public.nfip_claim_bg_build_geom() as geometries_built;\n',
  });
  return files;
}
