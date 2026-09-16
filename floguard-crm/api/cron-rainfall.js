/**
 * Daily rainfall refresh (Vercel Cron) — serverless port of scripts/refresh-rainfall.mjs.
 *
 * 1. Open-Meteo daily precipitation for the county centroid
 * 2. API_t = k * API_(t-1) + P_t  → rainfall_state
 * 3. D = w5*API_n + w6*Rain24_n   → stored as rainfall_state.d
 *    (the 312k-row fsi_live rewrite takes ~55s, past PostgREST's timeout, so
 *    pg_cron job 'fsi_apply_dynamic_daily' applies it at 12:00 UTC — fsi/sql/005)
 * 4. Touch academy storage (users.json) so Supabase never idles into auto-pause.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>. Vercel sends this automatically for
 * scheduled invocations when CRON_SECRET is set in project env. Refuses to run without it.
 *
 * Schedule lives in vercel.json ("crons"). Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://crm.floguardfl.com/api/cron-rainfall
 */
import { restGet, restInsert, storageGetJson } from '../server/lib/supabase-rest.js';
import { advanceApi, normalizeRain, dynamicScore } from '../scripts/lib/fsi-score.mjs';
import { json } from '../server/lib/http.js';

export const config = { maxDuration: 60 };

const BUCKET = process.env.ACADEMY_STORAGE_BUCKET || 'floguard-academy';
const COUNTY = '12127'; // Volusia FL
const CENTROID = { lat: 29.028, lon: -81.0755 };

function authorized(req) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  return String(h) === `Bearer ${secret}`;
}

async function fetchRain() {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', String(CENTROID.lat));
  u.searchParams.set('longitude', String(CENTROID.lon));
  u.searchParams.set('daily', 'precipitation_sum');
  u.searchParams.set('past_days', '14');
  u.searchParams.set('forecast_days', '1');
  u.searchParams.set('timezone', 'America/New_York');
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const totals = j.daily?.precipitation_sum || [];
  const dates = j.daily?.time || [];
  // Last completed day (yesterday); today's total is partial.
  let rain24 = 0;
  let day = dates[dates.length - 1];
  if (totals.length >= 2) {
    rain24 = Number(totals[totals.length - 2]) || 0;
    day = dates[dates.length - 2];
  } else if (totals.length) {
    rain24 = Number(totals[totals.length - 1]) || 0;
  }
  let apiFromHistory = 0;
  for (const p of totals.slice(0, -1)) apiFromHistory = advanceApi(apiFromHistory, Number(p) || 0);
  return { rain24, day, apiFromHistory };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }
  if (!authorized(req)) {
    return json(res, 401, { error: 'Unauthorized (CRON_SECRET missing or mismatched).' });
  }

  const started = Date.now();
  try {
    const { rain24, day, apiFromHistory } = await fetchRain();

    const prevRows = await restGet('rainfall_state', `county_fips=eq.${COUNTY}&select=*&limit=1`);
    const prev = Array.isArray(prevRows) ? prevRows[0] : null;
    const prevAt = prev?.observed_at ? Date.parse(prev.observed_at) : NaN;
    const staleDays = Number.isFinite(prevAt) ? (Date.now() - prevAt) / 86_400_000 : Infinity;

    // Carry API forward only if the chain is unbroken (ran within ~2 days);
    // otherwise re-seed from the 14-day history so a gap doesn't freeze old saturation.
    let api;
    let mode;
    if (prev && Number.isFinite(Number(prev.api_value)) && staleDays <= 2) {
      api = advanceApi(Number(prev.api_value), rain24);
      mode = 'advanced';
    } else {
      api = apiFromHistory;
      mode = 'reseeded_14d';
    }

    const { api_n, rain24_n } = normalizeRain(api, rain24);
    const d = Math.round(dynamicScore(api_n, rain24_n) * 1000) / 1000;

    const state = {
      county_fips: COUNTY,
      api_value: Math.round(api * 100) / 100,
      rain_24h: Math.round(rain24 * 100) / 100,
      d,
      observed_at: new Date().toISOString(),
    };
    await restInsert('rainfall_state', [state], { upsert: true, onConflict: 'county_fips' });

    // Keepalive touch on the academy bucket (login path reads this object).
    let usersOk = false;
    try {
      const users = await storageGetJson(BUCKET, 'users.json');
      usersOk = !!users;
    } catch (e) {
      console.warn('[cron-rainfall] storage touch failed:', e?.message);
    }

    return json(res, 200, {
      ok: true,
      county: COUNTY,
      rain_day: day,
      rain_24h_mm: state.rain_24h,
      api_mm: state.api_value,
      api_mode: mode,
      d,
      fsi_live_apply: 'pg_cron fsi_apply_dynamic_daily @ 12:00 UTC',
      storage_touched: usersOk,
      ms: Date.now() - started,
    });
  } catch (e) {
    console.error('[cron-rainfall]', e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
}
