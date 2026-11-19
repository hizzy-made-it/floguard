/**
 * Academy durable stores + session tokens.
 *
 * Backend selection (env ACADEMY_DATA_BACKEND):
 *   storage  — Supabase Storage JSON (default; current production)
 *   postgres — Supabase Postgres tables (org-scoped Sales Rev schema)
 *   dual     — read postgres if ready else storage; write both (migration)
 *   auto     — postgres when org table ready, else storage
 *
 * Service-role only — never expose these helpers to the browser.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { storageGetJson, storagePutJson, supabaseConfig } from './supabase-rest.js';
import * as pg from './academy-pg.js';

const BUCKET = process.env.ACADEMY_STORAGE_BUCKET || 'floguard-academy';
const USERS_OBJECT = 'users.json';
const LEADS_OBJECT = 'leads.json';
const ACTIVITIES_OBJECT = 'activities.json';
const PRACTICE_OBJECT = 'practice.json';
const AI_USAGE_OBJECT = 'ai_usage.json';

/** Default soft cap per user (tokens). Override with ACADEMY_DEFAULT_TOKEN_LIMIT. */
export function defaultTokenLimit() {
  const n = Number(process.env.ACADEMY_DEFAULT_TOKEN_LIMIT || 50000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50000;
}

/**
 * Normalize a desk user for storage + public API.
 * Supports both tokens_used and legacy token_used (Postgres column).
 */
export function normalizeUser(u) {
  if (!u || typeof u !== 'object') return u;
  const roleRaw = String(u.role || 'rep').toLowerCase();
  const role = roleRaw === 'admin' || roleRaw === 'owner' ? roleRaw : 'rep';
  const tokens_used = Number(u.tokens_used ?? u.token_used) || 0;
  const tokens_limit = Number(u.tokens_limit) > 0 ? Number(u.tokens_limit) : defaultTokenLimit();
  return {
    ...u,
    role,
    tokens_used,
    token_used: tokens_used, // keep PG field in sync
    tokens_limit,
    locked: !!u.locked || tokens_used >= tokens_limit,
    unlock_requested: !!u.unlock_requested,
    last_seen: u.last_seen || u.last_login_at || null,
  };
}

/** Comma-separated usernames that always get admin (env ACADEMY_ADMIN_USERNAMES). */
export function adminUsernameSet() {
  const raw = String(process.env.ACADEMY_ADMIN_USERNAMES || 'heath,hizzy').toLowerCase();
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isAdminRole(role) {
  const r = String(role || '').toLowerCase();
  return r === 'admin' || r === 'owner';
}

/** Promote env-listed users; first-ever account becomes admin if none exist. */
export function applyAdminBootstrap(store, username) {
  const users = Array.isArray(store?.users) ? store.users : [];
  const admins = adminUsernameSet();
  const uname = String(username || '').toLowerCase();
  let changed = false;
  for (const u of users) {
    const before = u.role;
    if (admins.has(String(u.username || '').toLowerCase())) {
      if (u.role !== 'admin' && u.role !== 'owner') {
        u.role = 'admin';
        changed = true;
      }
    }
    Object.assign(u, normalizeUser(u));
    if (before !== u.role) changed = true;
  }
  const hasAdmin = users.some((u) => isAdminRole(u.role));
  if (!hasAdmin && users.length === 1) {
    users[0].role = 'admin';
    Object.assign(users[0], normalizeUser(users[0]));
    changed = true;
  } else if (!hasAdmin && uname && admins.has(uname)) {
    const u = users.find((x) => String(x.username || '').toLowerCase() === uname);
    if (u) {
      u.role = 'admin';
      Object.assign(u, normalizeUser(u));
      changed = true;
    }
  }
  return changed;
}

export function publicUser(u) {
  const n = normalizeUser(u);
  return {
    id: n.id,
    username: n.username,
    role: n.role,
    created_at: n.created_at,
    last_login_at: n.last_login_at || null,
    last_seen: n.last_seen || null,
    tokens_used: n.tokens_used,
    tokens_limit: n.tokens_limit,
    locked: !!n.locked,
    unlock_requested: !!n.unlock_requested,
  };
}

/** @returns {'storage'|'postgres'|'dual'|'auto'} */
export function dataBackend() {
  const v = String(process.env.ACADEMY_DATA_BACKEND || 'auto').toLowerCase().trim();
  if (v === 'storage' || v === 'postgres' || v === 'dual' || v === 'auto') return v;
  return 'auto';
}

let _pgReady = null;
let _pgReadyAt = 0;

async function postgresAvailable() {
  const now = Date.now();
  if (_pgReady != null && now - _pgReadyAt < 30_000) return _pgReady;
  _pgReady = await pg.pgIsReady();
  _pgReadyAt = now;
  return _pgReady;
}

/**
 * Users / activities / practice stores (NOT leads; see getLeadsPipeline). These Postgres tables are
 * org-scoped (organizations, desk_users, activities, practice_sessions), which production does not
 * have. Before review R1, ACADEMY_DATA_BACKEND=postgres|dual sent them to Postgres unconditionally,
 * so `postgres` mode threw on every login. Now every mode needs the org tables to be present;
 * otherwise these stores stay on Storage (the leads pipeline is decided separately).
 */
async function usePostgres() {
  const mode = dataBackend();
  if (mode === 'storage') return false;
  return postgresAvailable();
}



async function useDualWrite() {
  return dataBackend() === 'dual' && (await postgresAvailable());
}

// ---------------------------------------------------------------------------
// PIN / session (unchanged crypto)
// ---------------------------------------------------------------------------

export function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(pin), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPin(pin, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const next = scryptSync(String(pin), salt, 64);
    const prev = Buffer.from(hash, 'hex');
    if (prev.length !== next.length) return false;
    return timingSafeEqual(prev, next);
  } catch {
    return false;
  }
}

export function validateUsername(username) {
  const u = String(username || '').trim();
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(u)) {
    return { ok: false, error: 'Username must be 3–32 letters, numbers, or underscores.' };
  }
  return { ok: true, username: u };
}

export function validatePin(pin) {
  const p = String(pin || '').trim();
  if (!/^\d{4,12}$/.test(p)) {
    return { ok: false, error: 'PIN must be 4–12 digits (numbers only).' };
  }
  return { ok: true, pin: p };
}

export function findUser(store, username) {
  const want = String(username || '').toLowerCase();
  return (store.users || []).find((u) => String(u.username || '').toLowerCase() === want) || null;
}

export function newUserId() {
  return randomBytes(16).toString('hex');
}

function sessionSecret() {
  return (
    process.env.ACADEMY_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'dev-insecure-session-secret'
  );
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sign(payloadB64) {
  return b64url(createHmac('sha256', sessionSecret()).update(payloadB64).digest());
}

export function createSessionToken(user, ttlSeconds = 60 * 60 * 24 * 30) {
  const payload = {
    sub: user.id,
    u: user.username,
    org: user.org_id || null,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  const expect = sign(payloadB64);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const payload = JSON.parse(json);
    if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.sub || !payload.u) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Storage helpers (legacy)
// ---------------------------------------------------------------------------

async function storageLoadUsers() {
  const data = await storageGetJson(BUCKET, USERS_OBJECT);
  if (!data || !Array.isArray(data.users)) return { users: [] };
  data.users = data.users.map((u) => normalizeUser(u));
  return data;
}

async function storageSaveUsers(store) {
  const users = (store.users || []).map((u) => normalizeUser(u));
  await storagePutJson(BUCKET, USERS_OBJECT, { users });
}

async function storageLoadAiUsage() {
  const data = await storageGetJson(BUCKET, AI_USAGE_OBJECT);
  if (!data || !Array.isArray(data.events)) return { events: [] };
  return data;
}

async function storageSaveAiUsage(store) {
  const events = Array.isArray(store.events) ? store.events : [];
  while (events.length > 20000) events.shift();
  await storagePutJson(BUCKET, AI_USAGE_OBJECT, { events, updated_at: new Date().toISOString() });
}

async function storageLoadLeads() {
  const data = await storageGetJson(BUCKET, LEADS_OBJECT);
  if (!data || !Array.isArray(data.leads)) return { leads: [], updated_at: null };
  return data;
}

async function storageSaveLeads(store) {
  const updated_at = new Date().toISOString();
  await storagePutJson(BUCKET, LEADS_OBJECT, { leads: store.leads || [], updated_at });
  return updated_at;
}

async function storageLoadActivities() {
  const data = await storageGetJson(BUCKET, ACTIVITIES_OBJECT);
  if (!data || !Array.isArray(data.activities)) return { activities: [], updated_at: null };
  return data;
}

async function storageSaveActivities(store) {
  const updated_at = new Date().toISOString();
  await storagePutJson(BUCKET, ACTIVITIES_OBJECT, {
    activities: store.activities || [],
    updated_at,
  });
  return updated_at;
}

async function storageLoadPractice() {
  const data = await storageGetJson(BUCKET, PRACTICE_OBJECT);
  if (!data || !Array.isArray(data.events)) return { events: [], updated_at: null };
  return data;
}

async function storageSavePractice(store) {
  const updated_at = new Date().toISOString();
  await storagePutJson(BUCKET, PRACTICE_OBJECT, { events: store.events || [], updated_at });
  return updated_at;
}

// ---------------------------------------------------------------------------
// Public load/save (backend-aware)
// ---------------------------------------------------------------------------

export async function loadUsers() {
  let store;
  if (await usePostgres()) {
    try {
      store = await pg.pgLoadUsers();
    } catch (e) {
      if (dataBackend() === 'postgres') throw e;
      console.warn('[academy-db] pg loadUsers failed, storage fallback:', e?.message);
    }
  }
  if (!store) store = await storageLoadUsers();
  store.users = (store.users || []).map((u) => normalizeUser(u));
  return store;
}

export async function saveUsers(store) {
  store = { users: (store.users || []).map((u) => normalizeUser(u)) };
  const mode = dataBackend();
  const dual = await useDualWrite();
  const pgOn = await usePostgres();
  if (pgOn) {
    try {
      await pg.pgSaveUsers(store);
    } catch (e) {
      if (mode === 'postgres') throw e;
      console.warn('[academy-db] pg saveUsers failed:', e?.message);
    }
  }
  // Always keep Storage warm unless pure postgres mode (and Postgres really holds the users)
  if (mode !== 'postgres' || dual || !pgOn) {
    await storageSaveUsers(store);
  }
}

export async function loadAiUsageStore() {
  try {
    return await storageLoadAiUsage();
  } catch {
    return { events: [] };
  }
}

export async function appendAiUsageEvent(entry) {
  const store = await storageLoadAiUsage();
  const events = Array.isArray(store.events) ? store.events : [];
  events.push({
    id: entry.id || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: entry.user_id || '',
    username: entry.username || '',
    mode: entry.mode || 'coach',
    tokens: Number(entry.tokens) || 0,
    ts: entry.ts || new Date().toISOString(),
    kind: entry.kind || 'chat',
  });
  await storageSaveAiUsage({ events });
  return events[events.length - 1];
}

/** Apply token spend; locks user when over limit. Returns public academy usage slice. */
export async function recordUserTokenSpend(userId, tokens, meta = {}) {
  const add = Math.max(0, Math.floor(Number(tokens) || 0));
  const store = await loadUsers();
  const user = (store.users || []).find((u) => String(u.id) === String(userId));
  if (!user) return null;
  user.tokens_used = (Number(user.tokens_used) || 0) + add;
  user.token_used = user.tokens_used;
  user.last_seen = new Date().toISOString();
  if (user.tokens_used >= (user.tokens_limit || defaultTokenLimit())) {
    user.locked = true;
  }
  Object.assign(user, normalizeUser(user));
  await saveUsers(store);
  if (add > 0) {
    try {
      await appendAiUsageEvent({
        user_id: user.id,
        username: user.username,
        mode: meta.mode || 'coach',
        tokens: add,
        kind: 'chat',
      });
    } catch (e) {
      console.warn('[academy-db] ai usage log failed:', e?.message);
    }
  }
  return publicUser(user);
}

// ---------------------------------------------------------------------------
// Leads
//
// Two implementations behind one API:
//   - storage: one JSON blob (<bucket>/leads.json) — legacy, no history, no pipeline
//   - pipeline: Postgres public.leads + lead_activity/lead_tasks (fsi/sql/017)
// ACADEMY_DATA_BACKEND picks: storage -> blob; postgres -> pipeline (error if 017 is not
// applied); dual -> pipeline when ready AND mirror every write to the blob; auto ->
// pipeline when ready, else blob.
// ---------------------------------------------------------------------------

export class BackendError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

/**
 * Resolve the leads pipeline (the academy-pg module) or null when the blob backend is in use.
 * Throws BackendError(503) when ACADEMY_DATA_BACKEND=postgres but 017 is not applied.
 */
export async function getLeadsPipeline() {
  const mode = dataBackend();
  if (mode === 'storage') return null;
  const ready = await pg.pgLeadsReady();
  if (ready) {
    await seedPipelineFromBlobOnce();
    return pg;
  }
  if (mode === 'postgres') {
    throw new BackendError(
      503,
      'leads_pipeline_not_ready',
      'ACADEMY_DATA_BACKEND=postgres but public.leads lacks the 017 pipeline columns. Apply fsi/sql/017_leads_pipeline.sql.',
    );
  }
  if (mode === 'dual') console.warn('[academy-db] dual: leads pipeline not ready (017 not applied); writing blob only');
  return null;
}

let _seedChecked = false;
export function _resetSeedCheck() {
  _seedChecked = false;
}

/**
 * Safety net for the cut-over: the first time this instance uses the Postgres pipeline, if
 * public.leads is empty (live or soft-deleted) while the Storage blob still holds leads, copy
 * the blob in. Without this, flipping the backend (or `auto` after 017 is applied) would show
 * an empty lead list until someone ran scripts/migrate-leads-to-pg.mjs. Idempotent: identity
 * merge means two instances seeding at once converge on the same rows. Never deletes.
 */
async function seedPipelineFromBlobOnce() {
  if (_seedChecked) return;
  _seedChecked = true;
  try {
    const page = await pg.pgListLeadRows({ limit: 1, includeDeleted: true });
    const rows = Array.isArray(page) ? page : page?.rows || page?.leads || [];
    if (rows.length) return;
    const blob = await storageLoadLeads();
    const leads = Array.isArray(blob?.leads) ? blob.leads : [];
    if (!leads.length) return;
    const res = await pg.pgUpsertLeads(leads, { actor: 'system:seed-from-blob' });
    console.warn(`[academy-db] seeded Postgres leads from the Storage blob: ${leads.length} in blob`, {
      inserted: res?.inserted, updated: res?.updated,
    });
  } catch (e) {
    _seedChecked = false; // try again on the next request
    console.warn('[academy-db] seeding Postgres leads from the blob failed:', e?.message);
  }
}

/** dual mode: keep the blob in step with Postgres (full live set). Best effort. */
export async function mirrorLeadsToStorage() {
  if (dataBackend() !== 'dual') return;
  try {
    const store = await pg.pgLoadLeadsStore();
    await storageSaveLeads({ leads: store.leads });
  } catch (e) {
    console.warn('[academy-db] dual: mirroring leads to storage failed:', e?.message);
  }
}

export async function loadLeadsStore() {
  const pipe = await getLeadsPipeline().catch((e) => {
    if (dataBackend() === 'postgres') throw e;
    return null;
  });
  if (pipe) {
    try {
      return await pg.pgLoadLeadsStore();
    } catch (e) {
      if (dataBackend() === 'postgres') throw e;
      console.warn('[academy-db] pg loadLeads failed, storage fallback:', e?.message);
    }
  }
  return storageLoadLeads();
}

/**
 * Full-set save. Blob: overwrite. Pipeline: matched leads overwritten, new leads inserted;
 * leads absent from the set are soft-deleted only with opts.prune (CLI replace).
 */
export async function saveLeadsStore(store, opts = {}) {
  const pipe = await getLeadsPipeline().catch((e) => {
    if (dataBackend() === 'postgres') throw e;
    return null;
  });
  let updated_at = new Date().toISOString();
  if (pipe) {
    try {
      updated_at = await pg.pgSaveLeadsStore(store, opts);
    } catch (e) {
      if (dataBackend() === 'postgres') throw e;
      console.warn('[academy-db] pg saveLeads failed:', e?.message);
    }
  }
  if (!pipe || dataBackend() === 'dual') {
    try {
      updated_at = await storageSaveLeads(store);
    } catch (e) {
      if (!pipe) throw e;
      console.warn('[academy-db] storage saveLeads failed:', e?.message);
    }
  }
  return updated_at;
}

export async function loadActivitiesStore() {
  if (await usePostgres()) {
    try {
      return await pg.pgLoadActivitiesStore();
    } catch (e) {
      if (dataBackend() === 'postgres') throw e;
      console.warn('[academy-db] pg loadActivities failed, storage fallback:', e?.message);
    }
  }
  return storageLoadActivities();
}

export async function saveActivitiesStore(store) {
  const dual = await useDualWrite();
  const pgOn = await usePostgres();
  let updated_at = new Date().toISOString();
  if (pgOn) {
    try {
      updated_at = await pg.pgSaveActivitiesStore(store);
    } catch (e) {
      if (dataBackend() === 'postgres') throw e;
      console.warn('[academy-db] pg saveActivities failed:', e?.message);
    }
  }
  if (dataBackend() !== 'postgres' || dual || !pgOn) {
    try {
      updated_at = await storageSaveActivities(store);
    } catch (e) {
      if (!pgOn) throw e;
    }
  }
  return updated_at;
}

/** Append single activity (efficient path for postgres) */
export async function appendActivityEntry(entry) {
  if (await usePostgres()) {
    try {
      const saved = await pg.pgAppendActivity(entry);
      if (await useDualWrite()) {
        const store = await storageLoadActivities();
        const activities = Array.isArray(store.activities) ? store.activities : [];
        activities.push(entry.id ? { ...entry, ...saved, id: entry.id } : saved);
        while (activities.length > 50000) activities.shift();
        await storageSaveActivities({ activities });
      }
      return saved;
    } catch (e) {
      if (dataBackend() === 'postgres') throw e;
      console.warn('[academy-db] pg appendActivity failed:', e?.message);
    }
  }
  const store = await storageLoadActivities();
  const activities = Array.isArray(store.activities) ? store.activities.slice() : [];
  const row = {
    id: entry.id || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    lead_id: entry.lead_id ?? null,
    lead_key: String(entry.lead_key || ''),
    user: entry.user || 'unknown',
    type: String(entry.type || 'note'),
    at: entry.at || new Date().toISOString(),
    outcome: entry.outcome || '',
    detail: entry.detail && typeof entry.detail === 'object' ? entry.detail : {},
    next_follow_up_at: entry.next_follow_up_at || null,
  };
  activities.push(row);
  while (activities.length > 50000) activities.shift();
  await storageSaveActivities({ activities });
  return row;
}

export async function loadPracticeStore() {
  if (await usePostgres()) {
    try {
      return await pg.pgLoadPracticeStore();
    } catch (e) {
      if (dataBackend() === 'postgres') throw e;
      console.warn('[academy-db] pg loadPractice failed, storage fallback:', e?.message);
    }
  }
  return storageLoadPractice();
}

export async function savePracticeStore(store) {
  const dual = await useDualWrite();
  const pgOn = await usePostgres();
  let updated_at = new Date().toISOString();
  if (pgOn) {
    try {
      updated_at = await pg.pgSavePracticeStore(store);
    } catch (e) {
      if (dataBackend() === 'postgres') throw e;
    }
  }
  if (dataBackend() !== 'postgres' || dual || !pgOn) {
    try {
      updated_at = await storageSavePractice(store);
    } catch (e) {
      if (!pgOn) throw e;
    }
  }
  return updated_at;
}

// Re-export config probe for health checks
export { supabaseConfig };

export async function backendStatus() {
  const mode = dataBackend();
  let pgReady = false;
  try {
    pgReady = await postgresAvailable();
  } catch {
    pgReady = false;
  }
  return {
    mode,
    postgres_ready: pgReady,
    default_org_slug: process.env.ACADEMY_DEFAULT_ORG_SLUG || 'floguard',
  };
}
