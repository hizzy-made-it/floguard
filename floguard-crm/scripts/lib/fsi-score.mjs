/**
 * FSI + Must-Have scoring (JS port of fsi/pipeline/config.py + sales MHS).
 * Literature defaults — not calibrated. Never present as an inspection result.
 *
 * Dial targets include residential AND commercial/condos (big-ticket jobs).
 * Only vacant land / pure ag / ROW / water are hard-skipped.
 */

export const W_TWI = 0.4;
export const W_HAND = 0.25;
export const W_SOIL = 0.2;
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

export function staticScore(twiN, handN, hsg, zone) {
  return (
    W_TWI * twiN + W_HAND * (1.0 - handN) + W_SOIL * hsgScore(hsg) + W_ZONE * zoneScore(zone)
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

  let raw;
  if (hasFsi) {
    raw =
      0.32 * risk + 0.22 * heat + 0.18 * story + 0.15 * capacity + 0.08 * age + 0.05 * ownerOcc;
  } else {
    raw =
      0.35 * heat + 0.2 * capacity + 0.18 * age + 0.12 * story + 0.1 * ownerOcc + 0.05;
    if (heat >= 0.55) raw = Math.min(1, raw + 0.1);
  }

  // FloGuard gold: Zone X/X-shaded + clay/dual + neighborhood claim heat
  const gold =
    (zone === 'X' || zone === 'X-SHADED') && clay >= 0.55 && heat >= 0.35;
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
