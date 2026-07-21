/**
 * Daily rainfall refresh for Volusia (Open-Meteo) → rainfall_state + fsi_live.
 *
 * API_t = k * API_(t-1) + P_t
 * D = w5*API_n + w6*Rain24_n
 * FSI = 100 * S^alpha * (0.5 + 0.5*D)
 *
 * Usage:
 *   node scripts/refresh-rainfall.mjs
 *   node scripts/refresh-rainfall.mjs --county 12127
 */
import { supabaseConfig, restHeaders } from './lib/load-env.mjs';
import {
  advanceApi,
  normalizeRain,
  dynamicScore,
  fsiLiveFromStatic,
} from './lib/fsi-score.mjs';

const { url: SUPABASE_URL, key } = supabaseConfig();
const headers = restHeaders(key, 'resolution=merge-duplicates,return=minimal');
const readHeaders = restHeaders(key, 'return=representation');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const COUNTY = opt('--county', '12127');
const CENTROIDS = {
  12127: { lat: 29.028, lon: -81.0755 },
};

async function fetchRain() {
  const c = CENTROIDS[COUNTY];
  if (!c) throw new Error(`No centroid for county ${COUNTY}`);
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', String(c.lat));
  u.searchParams.set('longitude', String(c.lon));
  u.searchParams.set('daily', 'precipitation_sum');
  u.searchParams.set('past_days', '14');
  u.searchParams.set('forecast_days', '1');
  u.searchParams.set('timezone', 'America/New_York');
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const totals = j.daily?.precipitation_sum || [];
  const dates = j.daily?.time || [];
  // Use last completed day (yesterday) when available — last but one if today incomplete
  let rain24 = 0;
  let day = dates[dates.length - 1];
  if (totals.length >= 2) {
    rain24 = Number(totals[totals.length - 2]) || 0;
    day = dates[dates.length - 2];
  } else if (totals.length) {
    rain24 = Number(totals[totals.length - 1]) || 0;
  }
  // API rebuild from last 14 days of history if no prior state
  let apiFromHistory = 0;
  for (const p of totals.slice(0, -1)) {
    apiFromHistory = advanceApi(apiFromHistory, Number(p) || 0);
  }
  return { rain24, day, apiFromHistory, totals, dates };
}

async function loadState() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/rainfall_state?county_fips=eq.${COUNTY}&select=*&limit=1`,
    { headers: readHeaders },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0] || null;
}

async function saveState(apiValue, rain24) {
  const row = {
    county_fips: COUNTY,
    api_value: Math.round(apiValue * 100) / 100,
    rain_24h: Math.round(rain24 * 100) / 100,
    observed_at: new Date().toISOString(),
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rainfall_state?on_conflict=county_fips`, {
    method: 'POST',
    headers,
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`rainfall_state ${r.status}: ${(await r.text()).slice(0, 250)}`);
  return row;
}

async function rewriteFsiLive(d) {
  console.log(`Rewriting fsi_live with D=${d.toFixed(3)}…`);
  let cursor = '';
  let updated = 0;
  const PAGE = 500;
  const PATCH = 100;
  while (true) {
    const params = new URLSearchParams({
      select: 'parcel_id,fsi_static',
      order: 'parcel_id',
      limit: String(PAGE),
    });
    if (cursor) params.set('parcel_id', `gt.${cursor}`);
    // Only rewrite rows that have static score
    params.set('fsi_static', 'not.is.null');
    const r = await fetch(`${SUPABASE_URL}/rest/v1/parcel_risk?${params}`, {
      headers: readHeaders,
    });
    if (!r.ok) throw new Error(`read ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    if (!rows.length) break;

    const patches = rows.map((row) => {
      const s = Number(row.fsi_static) || 0;
      return {
        parcel_id: row.parcel_id,
        fsi_live: Math.round(fsiLiveFromStatic(s, d) * 100) / 100,
        updated_at: new Date().toISOString(),
      };
    });

    const upUrl = `${SUPABASE_URL}/rest/v1/parcel_risk?on_conflict=parcel_id`;
    for (let i = 0; i < patches.length; i += PATCH) {
      const chunk = patches.slice(i, i + PATCH);
      const pr = await fetch(upUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(chunk),
      });
      if (!pr.ok) throw new Error(`patch ${pr.status}: ${(await pr.text()).slice(0, 250)}`);
    }
    updated += patches.length;
    cursor = rows[rows.length - 1].parcel_id;
    process.stdout.write(`\r  fsi_live ${updated}…`);
    if (rows.length < PAGE) break;
  }
  console.log(`\n  updated ${updated} parcels`);
}

async function main() {
  console.log(`Rainfall refresh county ${COUNTY}`);
  console.log(`Target: ${SUPABASE_URL}`);
  const { rain24, day, apiFromHistory } = await fetchRain();
  console.log(`Rain day ${day}: ${rain24} mm`);

  const prev = await loadState();
  let api;
  if (prev && isFinite(Number(prev.api_value))) {
    api = advanceApi(Number(prev.api_value), rain24);
    console.log(`API advanced from ${prev.api_value} → ${api.toFixed(2)}`);
  } else {
    api = apiFromHistory;
    console.log(`API seeded from 14-day history → ${api.toFixed(2)}`);
  }

  const state = await saveState(api, rain24);
  console.log('rainfall_state:', state);

  const { api_n, rain24_n } = normalizeRain(api, rain24);
  const d = dynamicScore(api_n, rain24_n);
  console.log(`D = ${d.toFixed(3)} (api_n=${api_n.toFixed(3)} rain24_n=${rain24_n.toFixed(3)})`);

  await rewriteFsiLive(d);
  console.log('Done. Optional: node scripts/score-must-have.mjs');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
