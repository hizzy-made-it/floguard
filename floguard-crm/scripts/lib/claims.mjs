/**
 * NFIP claims, pure logic: OpenFEMA fetch + paging, zone classes, block-group / event / tract
 * aggregation, claim heat, TIGERweb block-group parsing, parcel -> block-group assignment.
 * No Supabase, no env, no process side effects, so tests can import it freely.
 *
 * Compliance: every output is a neighbourhood aggregate. Nothing here can say a named owner filed a claim.
 *
 * Confirmed against the live API on 2026-11-19 (see docs/handoff/B.md):
 *   endpoint   https://www.fema.gov/api/open/v3/NfipClaims   (entity key "NfipClaims")
 *   NOT        v3/FimaNfipClaims (404). v2/FimaNfipClaims is the frozen dataset.
 *   fields     censusGeoid (12-digit block group), countyCode, dateOfLoss, yearOfLoss,
 *              ratedFloodZone, floodZoneCurrent, waterDepth (inches), causeOfDamage,
 *              eventDesignationNumber, floodEvent, amountPaidOnBuildingClaim,
 *              amountPaidOnContentsClaim, asOfDate, id. latitude/longitude exist but are 0.1 degree.
 */
import { buildGridIndex, findFirstContaining, geomBbox } from './geo.mjs';

export const OPENFEMA_BASE = 'https://www.fema.gov/api/open';
export const COUNTY_FIPS = '12127'; // Volusia FL

/** Per API version: dataset path segment, response array key, and $select list (null = all fields). */
export const API_VERSIONS = {
  v3: {
    version: 'v3',
    dataset: 'NfipClaims',
    arrayKey: 'NfipClaims',
    select: [
      'id',
      'censusGeoid',
      'countyCode',
      'dateOfLoss',
      'yearOfLoss',
      'ratedFloodZone',
      'floodZoneCurrent',
      'waterDepth',
      'causeOfDamage',
      'eventDesignationNumber',
      'floodEvent',
      'amountPaidOnBuildingClaim',
      'amountPaidOnContentsClaim',
      'asOfDate',
    ],
  },
  // Frozen 2026-06-01. Field names for v2 are not re-verified here, so no $select (fetch everything);
  // normalizeClaim() accepts the aliases censusBlockGroupFips / floodZone.
  v2: { version: 'v2', dataset: 'FimaNfipClaims', arrayKey: 'FimaNfipClaims', select: null },
};

/** Zone X claims weigh double: a claim outside the SFHA is the drainage signal (see sql/016). */
export const SFHA_WEIGHT = 1;
export const ZONE_X_WEIGHT = 2;
export const OTHER_ZONE_WEIGHT = 1;
export const HEAT_REF_FLOOR = 5;

export const WINDOW_10Y = 10;
export const WINDOW_5Y = 5;

/* ---------------------------------------------------------------------------------------------
 * OpenFEMA fetch
 * ------------------------------------------------------------------------------------------- */

export function apiConfig(apiVersion = 'v3') {
  const cfg = API_VERSIONS[String(apiVersion).toLowerCase()];
  if (!cfg) throw new Error(`Unknown --api-version ${apiVersion} (use v3 or v2)`);
  return cfg;
}

/** 'YYYY-MM-DD' or 'YYYY' -> Jan 1 of that year as 'YYYY-01-01T00:00:00.000Z'. Event rows are keyed by
 *  year, so an incremental pull must always cover whole years. */
export function sinceToYearStart(since) {
  if (!since) return null;
  const m = String(since).match(/^(\d{4})/);
  if (!m) throw new Error(`--since must start with a 4-digit year, got ${since}`);
  return { year: Number(m[1]), iso: `${m[1]}-01-01T00:00:00.000Z` };
}

export function buildClaimsUrl({
  apiVersion = 'v3',
  county = COUNTY_FIPS,
  since = null,
  top = 5000,
  skip = 0,
  inlinecount = false,
} = {}) {
  const cfg = apiConfig(apiVersion);
  let filter = `countyCode eq '${county}'`;
  const s = sinceToYearStart(since);
  if (s) filter += ` and dateOfLoss ge '${s.iso}'`;
  const q = [`$filter=${encodeURIComponent(filter)}`, `$top=${top}`, `$skip=${skip}`, '$orderby=id'];
  if (cfg.select) q.push(`$select=${cfg.select.join(',')}`);
  if (inlinecount) q.push('$inlinecount=allpages');
  return `${OPENFEMA_BASE}/${cfg.version}/${cfg.dataset}?${q.join('&')}`;
}

export async function fetchJsonRetry(url, { fetchImpl = fetch, retries = 3, backoffMs = 1500, label = 'fetch' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetchImpl(url);
      if (!r.ok) throw new Error(`${label} ${r.status}: ${String(await r.text()).slice(0, 200)}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((res) => setTimeout(res, backoffMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Page through every claim for the county. `top` is the page size; OpenFEMA allows up to 10000. */
export async function fetchAllClaims({
  apiVersion = 'v3',
  county = COUNTY_FIPS,
  since = null,
  top = 5000,
  fetchImpl = fetch,
  backoffMs = 1500,
  maxRows = 500000,
  log = () => {},
} = {}) {
  const cfg = apiConfig(apiVersion);
  const out = [];
  let skip = 0;
  let total = null;
  for (;;) {
    const url = buildClaimsUrl({ apiVersion, county, since, top, skip, inlinecount: skip === 0 });
    const j = await fetchJsonRetry(url, { fetchImpl, backoffMs, label: `OpenFEMA ${cfg.version}` });
    const rows = j[cfg.arrayKey] || Object.values(j).find(Array.isArray) || [];
    if (skip === 0) total = j?.metadata?.count ?? null;
    out.push(...rows);
    log(`  claims ${out.length}${total != null ? ` / ${total}` : ''}`);
    if (rows.length < top) break;
    skip += rows.length;
    if (skip >= maxRows) throw new Error(`claims paging exceeded ${maxRows} rows; refusing to continue`);
  }
  return { claims: out, total };
}

/* ---------------------------------------------------------------------------------------------
 * Claim normalisation
 * ------------------------------------------------------------------------------------------- */

/** sfha = zones starting A or V (A, AE, AH, AO, AR, A99, A07, V, VE, AHB...). zone_x = X, B, C, shaded X. other = D / blank. */
export function zoneClass(zone) {
  const z = String(zone ?? '')
    .trim()
    .toUpperCase();
  if (!z) return 'other';
  if (/MINIMAL|MODERATE|SHADED|0\.2|500/.test(z)) return 'zone_x';
  if (/^(X|B|C)(\b|$|[^A-Z])/.test(z)) return 'zone_x';
  if (/^(A|V)/.test(z)) return 'sfha';
  return 'other';
}

function digits(v) {
  const s = String(v ?? '').trim();
  return /^\d+$/.test(s) ? s : '';
}

/**
 * Raw OpenFEMA row -> the fields the aggregation needs. Prefers floodZoneCurrent, falls back to
 * ratedFloodZone (floodZoneCurrent is null on ~30% of Volusia rows).
 * geoid: 12 digits = block group; longer is truncated to 12; 11 digits = tract only (bg null).
 */
export function normalizeClaim(raw) {
  const gd = digits(raw.censusGeoid ?? raw.censusBlockGroupFips);
  const bg = gd.length >= 12 ? gd.slice(0, 12) : null;
  const tract = gd.length >= 11 ? gd.slice(0, 11) : null;
  const date = raw.dateOfLoss ? String(raw.dateOfLoss).slice(0, 10) : null;
  const year = Number(raw.yearOfLoss) || (date ? Number(date.slice(0, 4)) : 0) || 0;
  const zone = String(raw.floodZoneCurrent ?? raw.ratedFloodZone ?? raw.floodZone ?? '')
    .trim()
    .toUpperCase();
  const depthN = raw.waterDepth == null || raw.waterDepth === '' ? NaN : Number(raw.waterDepth);
  const paid =
    Math.max(0, Number(raw.amountPaidOnBuildingClaim) || 0) +
    Math.max(0, Number(raw.amountPaidOnContentsClaim) || 0);
  const name = raw.floodEvent ? String(raw.floodEvent).trim() : '';
  const edn = raw.eventDesignationNumber ? String(raw.eventDesignationNumber).trim() : '';
  const eventKey = name || edn || (year ? `unnamed-${year}` : '');
  return {
    id: raw.id ?? null,
    county: digits(raw.countyCode) || null,
    blockGroup: bg,
    tract,
    year,
    date,
    zone,
    zoneClass: zoneClass(zone),
    depth: Number.isFinite(depthN) ? depthN : null,
    paid,
    eventKey,
    eventName: name || null,
    eventDesignation: edn || null,
  };
}

/* ---------------------------------------------------------------------------------------------
 * Aggregation
 * ------------------------------------------------------------------------------------------- */

const round = (n, d) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export function median(values) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Linear-interpolation percentile over an ascending array; matches Postgres percentile_cont. */
export function percentileCont(sortedAsc, p) {
  const n = sortedAsc.length;
  if (!n) return null;
  const pos = (n - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

function newBg(fips) {
  return {
    block_group: fips,
    tract: fips.slice(0, 11),
    claim_count_all: 0,
    claim_count_10y: 0,
    claim_count_5y: 0,
    claim_last_year: null,
    paid_total_10y: 0,
    claim_sfha_all: 0,
    claim_zone_x_all: 0,
    claim_other_all: 0,
    claim_sfha_10y: 0,
    claim_zone_x_10y: 0,
    claim_other_10y: 0,
    _depths: [],
  };
}

const ZKEY = { sfha: 'claim_sfha', zone_x: 'claim_zone_x', other: 'claim_other' };

/**
 * Aggregate normalised claims.
 * @param {object[]} rawRows        OpenFEMA rows (any version)
 * @param {object}   opts
 * @param {Set|Map}  opts.bgSet     block-group FIPS that exist in the 2020 polygons. Claims in other FIPS
 *                                  (2010 vintage, or tract-only) fall back to tract aggregation only.
 * @param {number}   opts.asOfYear  year the windows are measured from (default: current year)
 * @param {number}   opts.tractYears window for the legacy tract table (default 12, as the old script)
 * @param {string}   opts.countyPrefix only count claims whose geoid starts with this (default 12127)
 * @returns {{blockGroups: Map, events: Map, tracts: Map, stats: object}}
 */
export function aggregateClaims(rawRows, { bgSet, asOfYear = new Date().getFullYear(), tractYears = 12, countyPrefix = COUNTY_FIPS } = {}) {
  const has = (f) => (bgSet ? bgSet.has(f) : true);
  const y10 = asOfYear - (WINDOW_10Y - 1);
  const y5 = asOfYear - (WINDOW_5Y - 1);
  const tractCutoff = asOfYear - tractYears;

  const blockGroups = new Map();
  const events = new Map();
  const tracts = new Map();
  const fallbackFips = new Map(); // fips -> claim count (2010-vintage or otherwise unmatched)
  const stats = {
    total: 0,
    no_geoid: 0,
    other_county: 0,
    no_year: 0,
    bg_assigned: 0,
    tract_only: 0, // geoid was 11 digits
    fallback_tract: 0, // 12-digit FIPS not in the 2020 set
    fallback_fips: 0,
    zone: { sfha: 0, zone_x: 0, other: 0 },
  };

  for (const raw of rawRows) {
    stats.total++;
    const c = normalizeClaim(raw);
    if (!c.tract) {
      stats.no_geoid++;
      continue;
    }
    if (!c.tract.startsWith(countyPrefix)) {
      stats.other_county++;
      continue;
    }
    if (!c.year) stats.no_year++;

    // ---- legacy tract table: every county claim, as the old script did (tract = geoid[0..11]) ----
    let t = tracts.get(c.tract);
    if (!t) {
      t = {
        census_tract: c.tract,
        claim_count_all: 0,
        claim_count_10y: 0,
        paid_sum: 0,
        last_loss_year: null,
        multi_loss_flag: false,
        _years: new Set(),
      };
      tracts.set(c.tract, t);
    }
    t.claim_count_all++;
    if (c.year && c.year >= tractCutoff) t.claim_count_10y++;
    t.paid_sum += c.paid;
    if (c.year && (!t.last_loss_year || c.year > t.last_loss_year)) t.last_loss_year = c.year;
    if (c.year) t._years.add(c.year);

    // ---- block group ----
    if (!c.blockGroup) {
      stats.tract_only++;
      continue;
    }
    if (!has(c.blockGroup)) {
      stats.fallback_tract++;
      fallbackFips.set(c.blockGroup, (fallbackFips.get(c.blockGroup) || 0) + 1);
      continue;
    }
    stats.bg_assigned++;
    stats.zone[c.zoneClass]++;

    let b = blockGroups.get(c.blockGroup);
    if (!b) {
      b = newBg(c.blockGroup);
      blockGroups.set(c.blockGroup, b);
    }
    const zk = ZKEY[c.zoneClass];
    b.claim_count_all++;
    b[`${zk}_all`]++;
    const in10 = c.year >= y10;
    const in5 = c.year >= y5;
    if (in10) {
      b.claim_count_10y++;
      b[`${zk}_10y`]++;
      b.paid_total_10y += c.paid;
      if (c.depth != null && c.depth > 0) b._depths.push(c.depth);
    }
    if (in5) b.claim_count_5y++;
    if (c.year && (!b.claim_last_year || c.year > b.claim_last_year)) b.claim_last_year = c.year;

    // ---- event grouping (year-keyed, so incremental pulls can replace whole years) ----
    if (c.year) {
      const ek = `${c.blockGroup}|${c.eventKey}|${c.year}`;
      let e = events.get(ek);
      if (!e) {
        e = {
          block_group: c.blockGroup,
          event_key: c.eventKey,
          event_year: c.year,
          event_name: c.eventName,
          event_designation: c.eventDesignation,
          claim_count: 0,
          paid_total: 0,
          sfha_count: 0,
          zone_x_count: 0,
          other_count: 0,
        };
        events.set(ek, e);
      }
      // a name / designation may be missing on some rows of the same event; keep any we see
      e.event_name = e.event_name || c.eventName;
      e.event_designation = e.event_designation || c.eventDesignation;
      e.claim_count++;
      e.paid_total += c.paid;
      e[c.zoneClass === 'zone_x' ? 'zone_x_count' : c.zoneClass === 'sfha' ? 'sfha_count' : 'other_count']++;
    }
  }

  for (const t of tracts.values()) {
    t.multi_loss_flag = t._years.size >= 3 || t.claim_count_10y >= 5;
    delete t._years;
  }
  // legacy tract heat: log scale of the windowed count against the county max (unchanged behaviour)
  const maxT = Math.max(1, ...[...tracts.values()].map((t) => t.claim_count_10y));
  for (const t of tracts.values()) t.heat = Math.min(1, Math.log1p(t.claim_count_10y) / Math.log1p(maxT));

  stats.fallback_fips = fallbackFips.size;
  return { blockGroups, events, tracts, fallbackFips, stats, windows: { y10, y5, asOfYear } };
}

/* ---------------------------------------------------------------------------------------------
 * Heat (mirrors fsi/sql/016 nfip_weighted_count + nfip_recompute_block_group_heat)
 * ------------------------------------------------------------------------------------------- */

export function weightedClaimCount(r) {
  return (
    SFHA_WEIGHT * (r.claim_sfha_10y || 0) +
    ZONE_X_WEIGHT * (r.claim_zone_x_10y || 0) +
    OTHER_ZONE_WEIGHT * (r.claim_other_10y || 0)
  );
}

/** Reference for log scaling: p95 of weighted counts over block groups with weighted > 0, floored at 5. */
export function computeHeatRef(rows) {
  const w = rows
    .map(weightedClaimCount)
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  const p95 = w.length ? percentileCont(w, 0.95) : 0;
  return Math.max(HEAT_REF_FLOOR, p95);
}

export function heatFor(weighted, ref) {
  return Math.min(1, Math.log1p(weighted) / Math.log1p(ref));
}

/** Fill `heat` on every row in place; returns the reference used. */
export function applyHeat(rows) {
  const ref = computeHeatRef(rows);
  for (const r of rows) r.heat = round(heatFor(weightedClaimCount(r), ref), 3);
  return ref;
}

/* ---------------------------------------------------------------------------------------------
 * Block-group rows (aggregates + 2020 polygon metadata)
 * ------------------------------------------------------------------------------------------- */

/**
 * @param {Map} agg            blockGroups from aggregateClaims
 * @param {Map} events         events from aggregateClaims
 * @param {Map<string,object>} bgMeta  fips -> { tract, hu, lat, lon, bbox, geomGeojson }
 */
export function finalizeBlockGroups(agg, events, bgMeta, { asOfYear = new Date().getFullYear(), now = new Date() } = {}) {
  const y10 = asOfYear - (WINDOW_10Y - 1);

  // top named event per block group in the 10y window
  const best = new Map();
  for (const e of events.values()) {
    if (!e.event_name || e.event_year < y10) continue;
    const cur = best.get(e.block_group);
    if (
      !cur ||
      e.claim_count > cur.claim_count ||
      (e.claim_count === cur.claim_count && (e.paid_total > cur.paid_total || (e.paid_total === cur.paid_total && e.event_year > cur.event_year)))
    ) {
      best.set(e.block_group, e);
    }
  }

  const rows = [];
  for (const [fips, meta] of bgMeta) {
    const a = agg.get(fips) || newBg(fips);
    const hu = Number.isFinite(meta.hu) && meta.hu > 0 ? Math.round(meta.hu) : null;
    const top = best.get(fips);
    rows.push({
      block_group: fips,
      tract: meta.tract || fips.slice(0, 11),
      vintage: 2020,
      housing_units: hu,
      claim_count_all: a.claim_count_all,
      claim_count_10y: a.claim_count_10y,
      claim_count_5y: a.claim_count_5y,
      claim_last_year: a.claim_last_year,
      paid_total_10y: round(a.paid_total_10y, 2),
      median_water_depth: a._depths.length ? round(median(a._depths), 1) : null,
      claim_sfha_all: a.claim_sfha_all,
      claim_zone_x_all: a.claim_zone_x_all,
      claim_other_all: a.claim_other_all,
      claim_sfha_10y: a.claim_sfha_10y,
      claim_zone_x_10y: a.claim_zone_x_10y,
      claim_other_10y: a.claim_other_10y,
      claim_rate_10y: hu ? round(a.claim_count_10y / hu, 5) : null,
      claim_rate_zone_x_10y: hu ? round(a.claim_zone_x_10y / hu, 5) : null,
      heat: 0,
      top_event: top ? `${top.event_name} (${top.event_year})` : null,
      top_event_claims: top ? top.claim_count : null,
      centroid_lat: meta.lat ?? null,
      centroid_lon: meta.lon ?? null,
      bbox_w: meta.bbox?.[0] ?? null,
      bbox_s: meta.bbox?.[1] ?? null,
      bbox_e: meta.bbox?.[2] ?? null,
      bbox_n: meta.bbox?.[3] ?? null,
      geom_geojson: meta.geomGeojson ?? null,
      updated_at: now.toISOString(),
    });
  }
  applyHeat(rows);
  return rows;
}

export function eventRows(events, { now = new Date(), fromYear = 0 } = {}) {
  return [...events.values()]
    .filter((e) => e.event_year >= fromYear)
    .map((e) => ({ ...e, paid_total: round(e.paid_total, 2), updated_at: now.toISOString() }));
}

export function tractRows(tracts, { now = new Date() } = {}) {
  return [...tracts.values()].map((t) => ({
    census_tract: t.census_tract,
    claim_count_10y: t.claim_count_10y,
    claim_count_all: t.claim_count_all,
    paid_sum: round(t.paid_sum, 2),
    last_loss_year: t.last_loss_year,
    multi_loss_flag: t.multi_loss_flag,
    heat: round(t.heat, 3),
    updated_at: now.toISOString(),
  }));
}

/* ---------------------------------------------------------------------------------------------
 * TIGERweb Census-2020 block groups
 * ------------------------------------------------------------------------------------------- */

/** Jan-1-2020-vintage Census Block Groups. Layer 1 of the Census2020 service (layer 5 is the 2010 set).
 *  Volusia: 343 block groups in 2020 vs 289 in 2010 (confirmed 2026-11-19). */
export const TIGERWEB_BG_2020 =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/Tracts_Blocks/MapServer/1';

export function buildTigerUrl({ state = '12', county = '127', offset = 0, count = 100, geometry = true, generalize = 0 } = {}) {
  const q = new URLSearchParams({
    where: `STATE='${state}' AND COUNTY='${county}'`,
    outFields: 'GEOID,TRACT,BLKGRP,HU100,POP100,CENTLAT,CENTLON,INTPTLAT,INTPTLON',
    returnGeometry: geometry ? 'true' : 'false',
    outSR: '4326',
    geometryPrecision: generalize ? '5' : '6',
    resultOffset: String(offset),
    resultRecordCount: String(count),
    orderByFields: 'GEOID',
    f: 'geojson',
  });
  if (geometry && generalize) q.set('maxAllowableOffset', String(generalize)); // degrees
  return `${TIGERWEB_BG_2020}/query?${q}`;
}

function signedNum(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).trim().replace(/^\+/, ''));
  return Number.isFinite(n) ? n : null;
}

/** GeoJSON FeatureCollection from TIGERweb -> Map(fips -> meta incl. geometry). */
export function parseTigerFeatures(fc) {
  const out = new Map();
  for (const f of fc?.features || []) {
    const p = f.properties || {};
    const fips = digits(p.GEOID);
    if (fips.length !== 12) continue;
    const geom = f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') ? f.geometry : null;
    const bbox = geom ? geomBbox(geom) : null;
    let lat = signedNum(p.CENTLAT) ?? signedNum(p.INTPTLAT);
    let lon = signedNum(p.CENTLON) ?? signedNum(p.INTPTLON);
    if ((lat == null || lon == null) && bbox) {
      lon = (bbox[0] + bbox[2]) / 2;
      lat = (bbox[1] + bbox[3]) / 2;
    }
    out.set(fips, {
      fips,
      tract: fips.slice(0, 11),
      hu: signedNum(p.HU100),
      pop: signedNum(p.POP100),
      lat,
      lon,
      bbox,
      geometry: geom,
    });
  }
  return out;
}

export async function fetchBlockGroups2020({ state = '12', county = '127', generalize = 0, geometry = true, fetchImpl = fetch, backoffMs = 1500, page = 100, log = () => {} } = {}) {
  const all = new Map();
  for (let offset = 0; ; offset += page) {
    const fc = await fetchJsonRetry(buildTigerUrl({ state, county, offset, count: page, geometry, generalize }), {
      fetchImpl,
      backoffMs,
      label: 'TIGERweb',
    });
    const got = parseTigerFeatures(fc);
    for (const [k, v] of got) all.set(k, v);
    log(`  block groups ${all.size}`);
    if ((fc?.features || []).length < page) break;
    if (offset > 5000) throw new Error('TIGERweb paging runaway');
  }
  return all;
}

/* ---------------------------------------------------------------------------------------------
 * Parcel -> block group (point in polygon)
 * ------------------------------------------------------------------------------------------- */

export function buildBlockGroupIndex(bgMeta, cellDeg = 0.02) {
  const feats = [];
  for (const [fips, m] of bgMeta) {
    if (m.geometry) feats.push({ geometry: m.geometry, properties: { fips } });
  }
  return buildGridIndex(feats, cellDeg);
}

export function assignBlockGroup(index, lon, lat) {
  const x = Number(lon);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const f = findFirstContaining(index, x, y);
  return f ? f.properties.fips : null;
}

/** parcels: [{parcel_id, lat, lon, block_group?}] -> patches for rows whose block group changed. */
export function buildParcelPatches(parcels, index, { reassignAll = false } = {}) {
  const patches = [];
  const c = { seen: 0, assigned: 0, outside: 0, bad_coords: 0, unchanged: 0 };
  for (const p of parcels) {
    c.seen++;
    if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) {
      c.bad_coords++;
      continue;
    }
    const fips = assignBlockGroup(index, p.lon, p.lat);
    if (!fips) c.outside++;
    else c.assigned++;
    if (!reassignAll && p.block_group === fips) {
      c.unchanged++;
      continue;
    }
    patches.push({ parcel_id: p.parcel_id, block_group: fips });
  }
  return { patches, counts: c };
}

/**
 * Re-apply block-group claim heat after something repainted parcel claim_heat at tract grain
 * (scripts/join-census-tracts.mjs). Makes the tract join and the claims ingest safe in either
 * order: block-group parcels get their block-group values back, the rest keep the tract fallback
 * (which now also sees the freshly assigned census_tract). Review R1.
 *
 * @param {object} o
 * @param {(name: string, body: object) => Promise<any>} o.rpc  PostgREST RPC caller; must throw an
 *        Error whose message contains the HTTP status ("404") or PGRST202 when the function is missing
 * @returns {Promise<{applied: boolean, changed: number, reason?: string}>}
 */
export async function reapplyBlockGroupHeat({ rpc, buckets = 8, log = () => {} } = {}) {
  let changed = 0;
  for (let b = 0; b < buckets; b++) {
    try {
      changed += Number(await rpc('nfip_apply_block_group_claims', { p_buckets: buckets, p_bucket: b })) || 0;
    } catch (e) {
      const msg = String(e?.message || e);
      if (b === 0 && /\b404\b|PGRST202|42883|Could not find the function|does not exist/i.test(msg)) {
        log('  block-group claims not installed (fsi/sql/016 not applied): tract heat stands.');
        return { applied: false, changed: 0, reason: 'no_016' };
      }
      throw e;
    }
  }
  log(`  block-group heat re-applied over tract heat: ${changed} rows changed`);
  return { applied: true, changed };
}
