/**
 * FSI + Must-Have scoring (JS port of fsi/pipeline/config.py + sales MHS).
 * Literature defaults — not calibrated. Never present as an inspection result.
 *
 * Dial targets include residential AND commercial/condos (big-ticket jobs).
 * Only vacant land / pure ag / ROW / water are hard-skipped.
 */

// Static weights (sum 1.0). 2026-09-17: W_DEPR added for closed basins (fsi/sql/013);
// TWI and HAND gave up 0.05 each. HAND is height above *flowing* drainage and
// misses the Deltona/DeBary lake-basin pattern; depression depth catches it.
// 2026-09-17 (sql/014): DEPR raised to 0.20 (from TWI and soil) so closed basins
// can cross a band cut; see fsi/README.md "closed-basin term".
export const W_TWI = 0.3;
export const W_HAND = 0.2;
export const W_DEPR = 0.2;
export const W_SOIL = 0.15;
export const W_ZONE = 0.15;
export const ALPHA = 1.0;

export const HSG_SCORE = { A: 0.2, B: 0.4, C: 0.7, D: 1.0 };
export const HSG_DEFAULT = 0.55;
export const FEMA_ZONE_SCORE = {
  AE: 1.0,
  VE: 1.0,
  AO: 0.8,
  AH: 0.8,
  'X-SHADED': 0.6,
  X: 0.45,
};
export const FEMA_ZONE_DEFAULT = 0.6;

/** Neutral terrain when LiDAR TWI/HAND not yet computed. */
export const LITE_TWI_N = 0.55;
export const LITE_HAND_N = 0.45;

/** Percentile targets for county bands (of dial-eligible parcels only). */
export const BAND_MUST_TOP = 0.03; // top 3% → must
export const BAND_SHOULD_TOP = 0.15; // top 15% cumulative → should (excl must)
export const BAND_MAYBE_TOP = 0.4; // top 40% cumulative → maybe

export function hsgScore(hsg) {
  if (!hsg) return HSG_DEFAULT;
  let key = String(hsg).trim().toUpperCase();
  if (key.includes('/')) {
    // Dual groups (A/D): take the wetter half — undrained condition.
    const parts = key.split('/').map((p) => HSG_SCORE[p] ?? HSG_DEFAULT);
    return Math.max(...parts);
  }
  return HSG_SCORE[key] ?? HSG_DEFAULT;
}

export function zoneScore(zone) {
  if (!zone) return FEMA_ZONE_DEFAULT;
  const z = String(zone).trim().toUpperCase();
  if (z === 'AREA OF MINIMAL FLOOD HAZARD') return FEMA_ZONE_SCORE.X;
  if (z.includes('0.2') || z.includes('SHADED') || z === 'X500') return FEMA_ZONE_SCORE['X-SHADED'];
  return FEMA_ZONE_SCORE[z] ?? FEMA_ZONE_DEFAULT;
}

/** Normalize NFHL FLD_ZONE + ZONE_SUBTY → compact label. */
export function normalizeFemaZone(fldZone, zoneSubty) {
  const z = String(fldZone || '')
    .trim()
    .toUpperCase();
  const sub = String(zoneSubty || '')
    .trim()
    .toUpperCase();
  if (!z || z === 'AREA NOT INCLUDED') return null;
  if (z === 'X' || z === 'C' || z === 'B') {
    if (
      sub.includes('0.2') ||
      sub.includes('500') ||
      sub.includes('SHADED') ||
      sub.includes('PROTECTED BY LEVEE')
    ) {
      return 'X-SHADED';
    }
    return 'X';
  }
  if (['AE', 'VE', 'AO', 'AH', 'A', 'V', 'AR', 'A99'].includes(z)) {
    if (z === 'A' || z === 'A99' || z === 'AR') return 'AE';
    if (z === 'V') return 'VE';
    return z;
  }
  return z || null;
}

export function staticScore(twiN, handN, hsg, zone, deprN = 0) {
  return (
    W_TWI * twiN +
    W_HAND * (1.0 - handN) +
    W_DEPR * clamp01(Number(deprN) || 0) +
    W_SOIL * hsgScore(hsg) +
    W_ZONE * zoneScore(zone)
  );
}

/**
 * Static-lite: no LiDAR. Emphasize soil + zone so ranking still separates
 * clay bowls from sandy ridges; terrain weights park at mild-wet Florida mid.
 */
export function staticScoreLite(hsg, zone, twiN = LITE_TWI_N, handN = LITE_HAND_N) {
  return staticScore(twiN, handN, hsg, zone);
}

/** Dry-spell default D ≈ 0.5 → floor at half static. */
export function fsiLiveFromStatic(s, d = 0.5, alpha = ALPHA) {
  return 100.0 * s ** alpha * (0.5 + 0.5 * d);
}

export const W_API = 0.6;
export const W_RAIN24 = 0.4;
export const API_CAP_MM = 150;
export const RAIN24_CAP_MM = 75;
export const API_DECAY_K = 0.87;

export function dynamicScore(apiN, rain24N) {
  return W_API * clamp01(apiN) + W_RAIN24 * clamp01(rain24N);
}

export function advanceApi(prevApi, rainToday) {
  return API_DECAY_K * prevApi + rainToday;
}

/** Normalize raw API / rain24 mm to 0–1 via saturating caps (not county min/max). */
export function normalizeRain(apiMm, rain24Mm) {
  return {
    api_n: clamp01((Number(apiMm) || 0) / API_CAP_MM),
    rain24_n: clamp01((Number(rain24Mm) || 0) / RAIN24_CAP_MM),
  };
}

/**
 * Percentile-clip then 0–1 scale. Used for DEM-lite TWI/HAND.
 * @param {number[]} values
 * @param {number} loPct  e.g. 2
 * @param {number} hiPct  e.g. 98
 */
export function percentileNormalize(values, loPct = 2, hiPct = 98) {
  const clean = values.filter((v) => isFinite(v)).slice().sort((a, b) => a - b);
  if (clean.length < 2) return () => 0.5;
  const at = (p) => {
    const i = Math.max(0, Math.min(clean.length - 1, Math.floor((p / 100) * (clean.length - 1))));
    return clean[i];
  };
  const lo = at(loPct);
  const hi = at(hiPct);
  const span = hi - lo || 1;
  return (v) => {
    if (!isFinite(v)) return 0.5;
    return Math.max(0, Math.min(1, (v - lo) / span));
  };
}

/**
 * Keep residential, commercial, and condos — all can be big-money drainage jobs.
 * Hard-skip only vacant land / pure ag / ROW / water / unimproved shells.
 */
export function isDialTarget(row) {
  const la = Number(row.living_area) || 0;
  const jv = Number(row.just_value) || 0;
  const yb = Number(row.year_built) || 0;
  const blob = `${row.use_desc || ''} ${row.dor_use || ''} ${row.address || ''}`.toUpperCase();

  const vacantLike =
    /\bVACANT\b|\bVAC\b|RIGHT.?OF.?WAY|\bROW\b|WETLAND|MARSH|\bLAKE\b|\bPOND\b|\bRIVER\b|RAILROAD|SUBMERGED|COMMON AREA|CONSERVATION|TIMBER|PASTURE|GRAZING|AGRICULT|ORCHARD|GROVE|MINING|DUMP|LANDFILL|UNIMPROVED/.test(
      blob,
    );

  // Improved footprint: living area, significant just value, or year built
  const improved = la > 0 || jv >= 75000 || yb > 1800;

  if (vacantLike && !improved) return false;
  if (!improved) return false;
  return true;
}

/**
 * Must-Have Score — sales prioritization (0–100 raw).
 * Band assignment is percentile-based in score-must-have.mjs (county calibration).
 * Not insurance advice. Claim heat is neighborhood aggregate only.
 */
export function mustHaveScore(row, opts = {}) {
  const assignBand = opts.assignBand !== false; // default true for fixtures / ad-hoc
  const cuts = opts.cuts || null; // { must, should, maybe } score floors

  if (!isDialTarget(row)) {
    return { score: 0, band: 'skip', reasons: ['not_dial_target'] };
  }

  const live = Number(row.fsi_live);
  const sStat = Number(row.fsi_static);
  const hasFsi = isFinite(live) || isFinite(sStat);
  const risk = isFinite(live)
    ? clamp01(live / 100)
    : isFinite(sStat)
      ? clamp01(sStat)
      : 0;

  const heat = clamp01(Number(row.claim_heat) || 0);

  const zone = String(row.fema_zone || '').toUpperCase();
  const hsg = String(row.hsg || '').toUpperCase();
  const clay = hsg === 'D' || hsg.includes('D') ? 1 : hsg === 'C' || hsg.includes('C') ? 0.55 : 0.15;
  const zoneX = zone === 'X' || zone === 'X-SHADED' ? 1 : ['AE', 'VE', 'AO', 'AH'].includes(zone) ? 0.45 : 0.3;
  // Zone X + poor drain = FloGuard gold (unserved standing water)
  const story = clamp01(0.55 * clay + 0.45 * zoneX + (zoneX >= 0.9 && clay >= 0.55 ? 0.2 : 0));

  const jv = Number(row.just_value) || 0;
  const la = Number(row.living_area) || 0;
  // Capacity: residential sweet spot AND commercial/condo big jobs (high JV)
  let capacity = 0.35;
  if (jv > 0) {
    if (jv >= 2_000_000) capacity = 0.95; // large commercial / multi-unit
    else if (jv >= 900_000) capacity = 0.88;
    else if (jv >= 180_000 && jv < 900_000) capacity = 0.9;
    else if (jv >= 120_000) capacity = 0.7;
    else capacity = 0.4;
  }
  if (la >= 1200 && la <= 3500) capacity = Math.min(1, capacity + 0.08);
  if (la > 3500) capacity = Math.min(1, capacity + 0.12); // large building / multi-unit shell

  const yb = Number(row.year_built) || 0;
  let age = 0.4;
  if (yb > 1800) {
    if (yb < 1980) age = 1.0;
    else if (yb < 1995) age = 0.85;
    else if (yb < 2005) age = 0.65;
    else if (yb < 2015) age = 0.45;
    else age = 0.25;
  }

  const hx = String(row.homestead || '')
    .trim()
    .toUpperCase();
  // Homestead helps residential; commercial is neutral (not penalized)
  const ownerOcc = hx === 'Y' || hx === 'YES' || hx === '1' || hx === 'X' ? 1 : hx ? 0.4 : 0.55;

  // Lot-level stormwater term (fsi/sql/008): impervious_ratio 0.10→0, 0.50→1.
  // Small lot (<8k sqft) with ≥20% hardscape gets +0.15. Null → neutral 0.3.
  const impRaw = row.impervious_ratio;
  const imp = impRaw == null || impRaw === '' ? null : Number(impRaw);
  const lot = Number(row.lot_sqft) || 0;
  let hardscape = 0.3;
  if (imp != null && isFinite(imp)) {
    hardscape = clamp01((imp - 0.1) / 0.4);
    if (lot > 0 && lot < 8000 && imp >= 0.2) hardscape = Math.min(1, hardscape + 0.15);
  }

  let raw;
  if (hasFsi) {
    // 2026-09-17 (sql/014): claim heat 0.20 -> 0.12, terrain risk 0.30 -> 0.38.
    // NFIP claims are coastal insured homes; heat at 0.20 kept inland basins out of every band.
    raw =
      0.38 * risk + 0.12 * heat + 0.17 * story + 0.14 * capacity +
      0.07 * hardscape + 0.07 * age + 0.05 * ownerOcc;
  } else {
    raw =
      0.33 * heat + 0.19 * capacity + 0.16 * age + 0.12 * story +
      0.07 * hardscape + 0.08 * ownerOcc + 0.05;
    if (heat >= 0.55) raw = Math.min(1, raw + 0.1);
  }

  // FloGuard gold: Zone X/X-shaded + clay/dual + neighborhood claim heat
  // sql/015: a closed basin (>= 0.5 m bowl at the lot) is a second way into gold.
  const deprN = clamp01(Number(row.depr_n) || 0);
  // A deep closed basin (>= 1 m) qualifies regardless of soil: sand still floods when
  // the basin has no outlet and the water table rises (Deltona / Orange City / DeBary 2022).
  const gold =
    (zone === 'X' || zone === 'X-SHADED') &&
    ((clay >= 0.55 && (heat >= 0.35 || deprN >= 0.5)) || deprN >= 1.0);
  if (gold) raw = Math.min(1, raw + 0.14);

  // Secondary: SFHA without soil/claim story — still dialable, slightly demoted vs gold
  if (['AE', 'VE', 'AO', 'AH'].includes(zone) && clay < 0.5 && heat < 0.3) {
    raw *= 0.9;
  }

  // Big commercial in claim-hot / clay zones: boost (big-money jobs)
  if (jv >= 900_000 && (heat >= 0.4 || clay >= 0.55)) {
    raw = Math.min(1, raw + 0.06);
  }

  const score = Math.round(Math.min(100, Math.max(0, raw * 100)) * 10) / 10;

  const reasons = [];
  if (risk >= 0.45) reasons.push('high_fsi');
  if (heat >= 0.4) reasons.push('claim_hot_tract');
  if (zone === 'X' || zone === 'X-SHADED') reasons.push('zone_x');
  if (clay >= 0.55) reasons.push(clay >= 0.9 ? 'clay_soil' : 'poor_drain_soil');
  if (gold) reasons.push('gold_segment');
  if (deprN >= 0.5) reasons.push('closed_basin');
  if (imp != null && isFinite(imp) && hardscape >= 0.6) reasons.push('hardscape_pooling');
  if (age >= 0.85) reasons.push('older_building');
  if (capacity >= 0.75) reasons.push('pay_capacity');
  if (jv >= 900_000) reasons.push('commercial_scale');
  if (ownerOcc >= 0.9) reasons.push('homestead');
  if (!hasFsi) reasons.push('pre_fsi');

  let band = 'skip';
  if (assignBand) {
    if (cuts) {
      if (score >= cuts.must) band = 'must';
      else if (score >= cuts.should) band = 'should';
      else if (score >= cuts.maybe) band = 'maybe';
      else band = 'skip';
    } else {
      // Fallback fixed cuts when percentiles not provided (fixtures / unit tests)
      if (score >= 62) band = 'must';
      else if (score >= 48) band = 'should';
      else if (score >= 32) band = 'maybe';
    }
  }

  return { score, band, reasons, gold };
}

/** Given sorted scores ascending, return { must, should, maybe } floors. */
export function percentileCuts(sortedAsc, mustTop = BAND_MUST_TOP, shouldTop = BAND_SHOULD_TOP, maybeTop = BAND_MAYBE_TOP) {
  if (!sortedAsc.length) return { must: 100, should: 100, maybe: 100 };
  const n = sortedAsc.length;
  const at = (p) => {
    // top p fraction → index from high end
    const idx = Math.max(0, Math.min(n - 1, Math.floor(n * (1 - p))));
    return sortedAsc[idx];
  };
  return {
    must: at(mustTop),
    should: at(shouldTop),
    maybe: at(maybeTop),
  };
}

function clamp01(x) {
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/* ------------------------------------------------------------------------------------------------
 * Terrain v2 static score (review R1; spec docs/handoff/D.md). Mirror of fsi/pipeline/config_v2.py
 * static_score_v2() and SQL fsi_static_v2_expr() (fsi/sql/018). tests/map/fsi-v2-mirror.test.mjs
 * compares it with numbers produced by the Python code (tests/map/fixtures/fsi-v2-python.json).
 * v1 above is untouched and stays the live model until fsi_model_version = 'v2'.
 *
 *   S2 = 0.20*TWI2 + 0.15*(1-HAND2) + 0.15*DEPR2 + 0.15*BOWL + 0.10*SOIL2 + 0.10*WT + 0.15*Z
 *
 * Note on Z: SQL zone_score() and Python zone_score() look the label up exactly
 * (FEMA_ZONE_SCORE[upper(trim)], else 0.6). The v1 JS zoneScore() above also maps raw NFHL labels
 * ("AREA OF MINIMAL FLOOD HAZARD" -> 0.45, "0.2 PCT" -> 0.6). To stay identical to what the
 * database stores, v2 uses the exact lookup (zoneScoreExact). Stored fema_zone values are already
 * normalised by normalizeFemaZone(), so both agree on real rows.
 * ---------------------------------------------------------------------------------------------- */
export const W2 = { twi: 0.2, hand: 0.15, depr: 0.15, bowl: 0.15, soil: 0.1, wt: 0.1, zone: 0.15 };
export const DRAIN_CLASS_SCORE = {
  'VERY POORLY DRAINED': 1.0,
  'POORLY DRAINED': 0.85,
  'SOMEWHAT POORLY DRAINED': 0.65,
  'MODERATELY WELL DRAINED': 0.4,
  'WELL DRAINED': 0.2,
  'SOMEWHAT EXCESSIVELY DRAINED': 0.1,
  'EXCESSIVELY DRAINED': 0.05,
};
export const V2_DEFAULTS = { twi: 0.55, hand: 0.45, depr: 0, bowl: 0.2, soil: HSG_DEFAULT, wt: 0.5 };
export const BOWL_FULL_M = 0.6;
export const BOWL_W_NBR = 0.6;
export const WT_FULL_M = 2.0;

const fin = (v) => v != null && v !== '' && Number.isFinite(Number(v));
const c01 = (x) => Math.max(0, Math.min(1, x));

export function drainClassScore(dc) {
  if (dc == null || String(dc).trim() === '') return null;
  return DRAIN_CLASS_SCORE[String(dc).trim().toUpperCase()] ?? null;
}

export function ksatScore(k) {
  if (!fin(k)) return null;
  const v = Number(k);
  if (v <= 0) return 1;
  return c01((2 - Math.log10(v)) / 2);
}

export function soilScoreV2(hsgEff, dc, ksat) {
  const parts = [];
  const h = hsgEff == null ? '' : String(hsgEff).trim().toUpperCase();
  if (h in HSG_SCORE) parts.push(HSG_SCORE[h]);
  const d = drainClassScore(dc);
  if (d != null) parts.push(d);
  const k = ksatScore(ksat);
  if (k != null) parts.push(k);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : V2_DEFAULTS.soil;
}

export function bowlScore(nbrRel, streetRel) {
  const n = fin(nbrRel);
  const s = fin(streetRel);
  let rel;
  if (n && s) rel = BOWL_W_NBR * Number(nbrRel) + (1 - BOWL_W_NBR) * Number(streetRel);
  else if (n) rel = Number(nbrRel);
  else if (s) rel = Number(streetRel);
  else return V2_DEFAULTS.bowl;
  return c01(-rel / BOWL_FULL_M);
}

export function wtScore(wt) {
  return fin(wt) ? c01(1 - Number(wt) / WT_FULL_M) : V2_DEFAULTS.wt;
}

export function zoneScoreExact(zone) {
  if (zone == null || String(zone).trim() === '') return FEMA_ZONE_DEFAULT;
  return FEMA_ZONE_SCORE[String(zone).trim().toUpperCase()] ?? FEMA_ZONE_DEFAULT;
}

// toFixed rounds the exact binary value (as Python round() does); Math.round(x*1e4) can flip ties.
const round4 = (x) => Number(x.toFixed(4));

/** v2 static score from the 018 parcel_risk columns. Rounded to 4 dp like SQL/Python. */
export function staticScoreV2({
  twi_v2_n: twi = null, hand_v2_n: hand = null, depr_v2_n: depr = null, nbr_rel_m: nbr = null,
  street_rel_m: street = null, hsg_eff: hsgEff = null, drain_class: dc = null, ksat_um_s: ksat = null,
  wt_depth_m: wt = null, fema_zone: zone = null,
} = {}) {
  const v = (x, d) => (fin(x) ? Number(x) : d);
  return round4(
    W2.twi * c01(v(twi, V2_DEFAULTS.twi)) +
      W2.hand * (1 - c01(v(hand, V2_DEFAULTS.hand))) +
      W2.depr * c01(v(depr, V2_DEFAULTS.depr)) +
      W2.bowl * bowlScore(nbr, street) +
      W2.soil * soilScoreV2(hsgEff, dc, ksat) +
      W2.wt * wtScore(wt) +
      W2.zone * zoneScoreExact(zone),
  );
}

/**
 * The static score a parcel row is actually scored with: the stored v2 score when the row says
 * model_version 'v2' (fsi_static_dispatch in SQL 018), else v1 from its terms.
 */
export function staticScoreForRow(row = {}) {
  if (row.model_version === 'v2' && fin(row.fsi_static_v2)) return Number(row.fsi_static_v2);
  return staticScore(
    fin(row.twi_n) ? Number(row.twi_n) : LITE_TWI_N,
    fin(row.hand_n) ? Number(row.hand_n) : LITE_HAND_N,
    row.hsg,
    row.fema_zone,
    fin(row.depr_n) ? Number(row.depr_n) : 0,
  );
}
