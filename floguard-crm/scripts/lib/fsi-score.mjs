/**
 * FSI + Must-Have scoring (JS port of fsi/pipeline/config.py + sales MHS).
 * Literature defaults — not calibrated. Never present as an inspection result.
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

/**
 * Must-Have Score — sales prioritization (0–100).
 * Not insurance advice. Tract claim heat is neighborhood aggregate only.
 *
 * Weights (uncalibrated):
 *  0.35 risk (fsi_live)
 *  0.20 claim neighborhood heat
 *  0.15 FloGuard story fit (Zone X + clay)
 *  0.15 capacity (just_value / living area proxies)
 *  0.10 building age pressure (older homes)
 *  0.05 homestead / owner-occ
 */
export function mustHaveScore(row) {
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
  // Zone X clay = best FloGuard segment (unserved standing-water)
  const story = clamp01(0.55 * clay + 0.45 * zoneX + (zone === 'X' && clay >= 0.9 ? 0.15 : 0));

  const jv = Number(row.just_value) || 0;
  const la = Number(row.living_area) || 0;
  // Soft capacity: sweet spot ~$200k–$600k just value, 1200–2800 sf
  let capacity = 0.35;
  if (jv > 0) {
    if (jv >= 180000 && jv <= 650000) capacity = 0.9;
    else if (jv >= 120000 && jv < 180000) capacity = 0.7;
    else if (jv > 650000 && jv <= 900000) capacity = 0.75;
    else if (jv > 900000) capacity = 0.55;
    else capacity = 0.4;
  }
  if (la >= 1200 && la <= 3000) capacity = Math.min(1, capacity + 0.1);

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
  const ownerOcc = hx === 'Y' || hx === 'YES' || hx === '1' || hx === 'X' ? 1 : hx ? 0.4 : 0.55;

  // With FSI: risk-led. Without FSI yet: claim heat + capacity + age drive dial list.
  let raw;
  if (hasFsi) {
    raw =
      0.35 * risk + 0.2 * heat + 0.15 * story + 0.15 * capacity + 0.1 * age + 0.05 * ownerOcc;
  } else {
    raw =
      0.35 * heat + 0.2 * capacity + 0.18 * age + 0.12 * story + 0.1 * ownerOcc + 0.05;
    // Claim-hot neighborhoods get a hard boost so Must dial works pre-LiDAR
    if (heat >= 0.55) raw = Math.min(1, raw + 0.12);
    if (heat >= 0.75 && capacity >= 0.7) raw = Math.min(1, raw + 0.08);
  }
  const score = Math.round(Math.min(100, Math.max(0, raw * 100)) * 10) / 10;

  const reasons = [];
  if (risk >= 0.55) reasons.push('high_fsi');
  if (heat >= 0.45) reasons.push('claim_hot_tract');
  if (zone === 'X' || zone === 'X-SHADED') reasons.push('zone_x');
  if (clay >= 0.9) reasons.push('clay_soil');
  if (age >= 0.85) reasons.push('older_home');
  if (capacity >= 0.75) reasons.push('pay_capacity');
  if (ownerOcc >= 0.9) reasons.push('homestead');
  if (!hasFsi) reasons.push('pre_fsi');

  let band = 'skip';
  // Lite ranking (no LiDAR) compresses fsi_live into ~30–50; bands sit lower
  // until terrain terms expand the spread. Recalibrate after full TWI/HAND.
  if (score >= 58) band = 'must';
  else if (score >= 45) band = 'should';
  else if (score >= 30) band = 'maybe';

  return { score, band, reasons };
}

function clamp01(x) {
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
