/**
 * Server-side DAILY cap on paid enrichment lookups (BatchData + Trestle HTTP calls).
 *
 * Why: `maxPaidLookups` in api/enrich-contacts.js is per request and client supplied (hard max 500),
 * and the function is stateless, so a signed-in rep (or a replayed request, or a buggy client loop)
 * could spend without limit: 30 requests/min x 12 leads x 5 lookups. This module makes every
 * `enrich` call reserve its paid lookups from one budget per calendar day (America/New_York) before
 * any provider is called, and give back what it did not use afterwards.
 *
 * Env: ENRICH_DAILY_PAID_CAP  lookups per day for the whole deployment. Default 200. 0 = no paid
 *      lookups at all (free steps still run). Junk or negative -> default.
 *
 * Stores:
 *   postgres  fsi/sql/022_enrich_daily_spend.sql (table enrich_spend_daily + RPCs
 *             enrich_spend_reserve / enrich_spend_release). Atomic (row lock), shared by every
 *             serverless isolate. This is the real cap.
 *   memory    used when 022 is not applied, Supabase is not configured, or the RPC fails. Per
 *             isolate only: with N warm isolates the effective cap is up to N x cap, and it resets on
 *             a cold start. Better than nothing; apply 022 for a hard cap. Every response says
 *             which store was used (`daily.store`).
 *
 * Reservations are conservative: if the function dies between reserve and release, the unreleased
 * lookups stay counted for that day (over-counting, never under-counting).
 */
import { rest, supabaseConfig } from './supabase-rest.js';

export const DEFAULT_DAILY_PAID_CAP = 200;

export function dailyPaidCap(env = process.env) {
  const raw = env.ENRICH_DAILY_PAID_CAP;
  if (raw == null || String(raw).trim() === '') return DEFAULT_DAILY_PAID_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DAILY_PAID_CAP;
  return Math.floor(n);
}

/** YYYY-MM-DD in America/New_York (the business day the reps work in). */
export function spendDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const mem = new Map(); // day -> reserved
/** Test hook. */
export function _resetMemorySpend() {
  mem.clear();
}

function memReserve(day, want, cap) {
  const cur = mem.get(day) || 0;
  const got = Math.max(0, Math.min(want, cap - cur));
  mem.set(day, cur + got);
  for (const k of mem.keys()) if (k < day) mem.delete(k); // keep the map small
  return { granted: got, reserved: cur + got };
}

function memRelease(day, unused) {
  const cur = mem.get(day) || 0;
  const next = Math.max(0, cur - Math.max(0, unused));
  mem.set(day, next);
  return { reserved: next };
}

function supabaseReady() {
  try {
    supabaseConfig();
    return true;
  } catch {
    return false;
  }
}

async function rpc(name, args) {
  const out = await rest(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
  const row = Array.isArray(out) ? out[0] : out;
  if (!row || typeof row !== 'object' || !Number.isFinite(Number(row.granted ?? row.reserved))) {
    throw new Error(`${name}: unexpected response`);
  }
  return row;
}

/**
 * Reserve up to `want` paid lookups from today's budget.
 * @returns {Promise<{granted:number, cap:number, reserved:number, remaining:number, day:string, store:'postgres'|'memory', warning?:string}>}
 */
export async function reserveDailySpend(want, { now = new Date(), env = process.env } = {}) {
  const cap = dailyPaidCap(env);
  const day = spendDay(now);
  const w = Math.max(0, Math.floor(Number(want) || 0));
  if (supabaseReady()) {
    try {
      const row = await rpc('enrich_spend_reserve', { p_day: day, p_want: w, p_cap: cap });
      const granted = Math.max(0, Math.min(w, Number(row.granted) || 0));
      const reserved = Number(row.reserved) || 0;
      return { granted, cap, reserved, remaining: Math.max(0, cap - reserved), day, store: 'postgres' };
    } catch (e) {
      console.warn('[enrich-spend] daily cap store unavailable, using per-instance memory:', String(e?.message || e).slice(0, 120));
      const m = memReserve(day, w, cap);
      return {
        ...m, cap, remaining: Math.max(0, cap - m.reserved), day, store: 'memory',
        warning: 'daily_cap_store_unavailable: apply fsi/sql/022_enrich_daily_spend.sql for a deployment-wide cap (per-instance cap used)',
      };
    }
  }
  const m = memReserve(day, w, cap);
  return { ...m, cap, remaining: Math.max(0, cap - m.reserved), day, store: 'memory' };
}

/** Give back the part of a reservation that was not spent. Best effort; never throws. */
export async function releaseDailySpend(reservation, used) {
  if (!reservation) return null;
  const unused = Math.max(0, (Number(reservation.granted) || 0) - Math.max(0, Number(used) || 0));
  const spent = Math.max(0, Number(used) || 0);
  try {
    if (reservation.store === 'postgres') {
      const row = await rpc('enrich_spend_release', { p_day: reservation.day, p_unused: unused, p_used: spent });
      const reserved = Number(row.reserved) || 0;
      return { reserved, remaining: Math.max(0, reservation.cap - reserved) };
    }
    const m = memRelease(reservation.day, unused);
    return { reserved: m.reserved, remaining: Math.max(0, reservation.cap - m.reserved) };
  } catch {
    return null; // unreleased lookups stay counted (conservative)
  }
}
