/**
 * Postgres-backed Academy stores (org-scoped).
 * Shape compatibility: load* returns same JSON shapes as Storage-backed helpers.
 */
import { restDelete, restGet, restInsert, restPatch } from './supabase-rest.js';
import {
  ACTIVITY_TYPES, STAGES, TASK_TYPES, carryDncPhone, cleanNextAction, deriveStage, isUuid, leadToRow, mergeLead,
  mergePhones, normStage, phoneDigits, planUpsert, rowToLead,
} from './leads-core.js';

const DEFAULT_SLUG = process.env.ACADEMY_DEFAULT_ORG_SLUG || 'floguard';

const STATUS_TO_PIPELINE = {
  New: 'new',
  '': 'new',
  'Called - no answer': 'contacted',
  Callback: 'follow_up',
  Interested: 'follow_up',
  Quoted: 'follow_up',
  'Deposit collected': 'closed',
  'Contract signed': 'closed',
  'Not interested': 'lost',
  Archived: 'lost',
  new: 'new',
  contacted: 'contacted',
  follow_up: 'follow_up',
  closed: 'closed',
  lost: 'lost',
};

let cachedOrg = null;
let cachedOrgAt = 0;

export function pipelineFromStatus(status) {
  const s = String(status || '');
  return STATUS_TO_PIPELINE[s] || STATUS_TO_PIPELINE[s.toLowerCase()] || 'new';
}

export async function getDefaultOrg() {
  const now = Date.now();
  if (cachedOrg && now - cachedOrgAt < 60_000) return cachedOrg;
  const rows = await restGet(
    'organizations',
    `select=*&slug=eq.${encodeURIComponent(DEFAULT_SLUG)}&limit=1`,
  );
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(
      `Default org slug "${DEFAULT_SLUG}" not found. Apply supabase/migrations/20260712_sales_rev_orgs.sql`,
    );
  }
  cachedOrg = rows[0];
  cachedOrgAt = now;
  return cachedOrg;
}

export async function resolveOrgId() {
  const org = await getDefaultOrg();
  return org.id;
}

// --- Users -----------------------------------------------------------------

function userFromRow(row) {
  const tokens_used = Number(row.token_used ?? row.tokens_used) || 0;
  return {
    id: row.id,
    username: row.username,
    pin_hash: row.pin_hash,
    created_at: row.created_at,
    last_login_at: row.last_login_at || null,
    locked: !!row.locked,
    role: row.role || 'rep',
    org_id: row.org_id,
    email: row.email || '',
    tokens_used,
    token_used: tokens_used,
    unlock_requested: !!row.unlock_requested,
  };
}

export async function pgLoadUsers() {
  const orgId = await resolveOrgId();
  const rows = await restGet(
    'desk_users',
    `select=*&org_id=eq.${orgId}&order=created_at.asc`,
  );
  return { users: (rows || []).map(userFromRow) };
}

export async function pgSaveUsers(store) {
  const orgId = await resolveOrgId();
  const users = Array.isArray(store.users) ? store.users : [];
  const existing = await restGet('desk_users', `select=id&org_id=eq.${orgId}`);
  const keep = new Set(users.map((u) => String(u.id)));
  for (const row of existing || []) {
    if (!keep.has(String(row.id))) {
      await restDelete('desk_users', `id=eq.${encodeURIComponent(row.id)}`);
    }
  }
  for (const u of users) {
    if (!u?.id || !u?.username) continue;
    const payload = {
      id: String(u.id),
      org_id: orgId,
      username: String(u.username),
      pin_hash: String(u.pin_hash || ''),
      email: String(u.email || ''),
      role: u.role || 'rep',
      locked: !!u.locked,
      token_used: Number(u.tokens_used ?? u.token_used) || 0,
      last_login_at: u.last_login_at || null,
      created_at: u.created_at || new Date().toISOString(),
    };
    await restInsert('desk_users', payload, { upsert: true, onConflict: 'id' });
  }
}

// --- Leads (017 pipeline schema) -------------------------------------------
//
// Rows live in public.leads (see fsi/sql/017_leads_pipeline.sql). All identity/merge
// logic is in leads-core.js; this section is only I/O.

export class LeadsError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const PAGE = 1000; // PostgREST default max-rows on Supabase
const ENC = encodeURIComponent;

let _leadsReady = null;
let _leadsReadyAt = 0;

/** True when public.leads has the 017 pipeline columns (stage, data, deleted_at, parcel_id). */
export async function pgLeadsReady({ force = false } = {}) {
  const now = Date.now();
  if (!force && _leadsReady != null && now - _leadsReadyAt < 30_000) return _leadsReady;
  try {
    await restGet('leads', 'select=id,stage,data,deleted_at,parcel_id&limit=1');
    _leadsReady = true;
  } catch {
    _leadsReady = false;
  }
  _leadsReadyAt = now;
  return _leadsReady;
}

/** Test hook. */
export function _resetLeadsReadyCache() {
  _leadsReady = null;
  _leadsReadyAt = 0;
}

async function orgIdOrNull() {
  try {
    return await resolveOrgId();
  } catch {
    return null;
  }
}

function orgClause(orgId) {
  return orgId ? `&org_id=eq.${ENC(orgId)}` : '';
}

/**
 * Keyset page of lead rows ordered by (updated_at, id) ascending.
 * cursor = "<updated_at>|<id>" of the last row seen; since = ISO timestamp (exclusive).
 */
export async function pgListLeadRows({ since = null, cursor = null, limit = PAGE, includeDeleted = false, orgId } = {}) {
  const org = orgId === undefined ? await orgIdOrNull() : orgId;
  const lim = Math.max(1, Math.min(Number(limit) || PAGE, PAGE));
  let q = `select=*&order=updated_at.asc,id.asc&limit=${lim + 1}${orgClause(org)}`;
  if (!includeDeleted) q += '&deleted_at=is.null';
  if (cursor) {
    const i = String(cursor).lastIndexOf('|');
    const ts = i > 0 ? String(cursor).slice(0, i) : '';
    const id = i > 0 ? String(cursor).slice(i + 1) : '';
    if (!ts || !id || Number.isNaN(Date.parse(ts))) throw new LeadsError(400, 'bad_cursor', 'cursor is not valid');
    q += `&or=(updated_at.gt.${ENC(ts)},and(updated_at.eq.${ENC(ts)},id.gt.${ENC(id)}))`;
  } else if (since) {
    if (Number.isNaN(Date.parse(since))) throw new LeadsError(400, 'bad_since', 'since must be an ISO timestamp');
    q += `&updated_at=gt.${ENC(since)}`;
  }
  const rows = (await restGet('leads', q)) || [];
  const has_more = rows.length > lim;
  const page = has_more ? rows.slice(0, lim) : rows;
  const last = page[page.length - 1];
  return { rows: page, has_more, next_cursor: has_more && last ? `${last.updated_at}|${last.id}` : null };
}

async function loadAllLeadRows({ includeDeleted = false, orgId } = {}) {
  const org = orgId === undefined ? await orgIdOrNull() : orgId;
  const all = [];
  let cursor = null;
  for (let i = 0; i < 100; i += 1) {
    const { rows, has_more, next_cursor } = await pgListLeadRows({ cursor, includeDeleted, orgId: org });
    all.push(...rows);
    if (!has_more) break;
    cursor = next_cursor;
  }
  return all;
}

function maxUpdated(rows) {
  let m = null;
  for (const r of rows || []) if (r.updated_at && (!m || r.updated_at > m)) m = r.updated_at;
  return m;
}

/** Legacy-shaped full load: { leads, updated_at } of live leads. */
export async function pgLoadLeadsStore() {
  const rows = await loadAllLeadRows();
  return { leads: rows.map(rowToLead), updated_at: maxUpdated(rows) };
}

/** Paged/changed-since list for the API. includeDeleted defaults on when `since`/`cursor` is used. */
export async function pgListLeads({ since = null, cursor = null, limit = null, includeDeleted } = {}) {
  const paged = !!(since || cursor || limit);
  // deleted rows are reported only for change feeds (`since`), consistently across pages
  const inclDel = includeDeleted ?? !!since;
  if (!paged) {
    const rows = await loadAllLeadRows({ includeDeleted: inclDel });
    return { leads: rows.map(rowToLead), updated_at: maxUpdated(rows), next_cursor: null, has_more: false };
  }
  const { rows, has_more, next_cursor } = await pgListLeadRows({ since, cursor, limit: limit || PAGE, includeDeleted: inclDel });
  return { leads: rows.map(rowToLead), updated_at: maxUpdated(rows), next_cursor, has_more };
}

async function insertRows(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    try {
      const res = await restInsert('leads', chunk);
      out.push(...(Array.isArray(res) ? res : [res]));
    } catch (e) {
      if (e?.status !== 409 && e?.status !== 400) throw e;
      // unique parcel_id race / bad row: fall back to one-by-one so one bad row cannot sink the batch
      for (const r of chunk) {
        try {
          const res = await restInsert('leads', r);
          out.push(...(Array.isArray(res) ? res : [res]));
        } catch (e2) {
          if (e2?.status === 409 && r.parcel_id) {
            const found = await restGet('leads', `select=*&parcel_id=eq.${ENC(r.parcel_id)}&deleted_at=is.null&limit=1`);
            if (found?.[0]) {
              const merged = leadToRow(mergeLead(rowToLead(found[0]), rowToLead({ ...r, id: found[0].id })), {});
              const res2 = await restPatch('leads', `id=eq.${found[0].id}`, merged);
              out.push(...(Array.isArray(res2) ? res2 : [res2]));
              continue;
            }
          }
          throw e2;
        }
      }
    }
  }
  return out;
}

async function addActivityRows(rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 200) await restInsert('lead_activity', rows.slice(i, i + 200));
}

/**
 * Upsert leads with the shared identity/merge rules.
 * @param {object[]} incoming
 * @param {{replace?:boolean, prune?:boolean, dryRun?:boolean, keepClientIds?:boolean, actor?:string}} opts
 *   replace  incoming is authoritative for ordinary fields (CLI replace); system fields kept
 *   prune    soft-delete live leads not present in `incoming` (CLI replace)
 *   skipStale  drop incoming leads whose updated_at is older than the stored row
 *   dryRun   plan only, write nothing
 *   keepClientIds  new rows keep the incoming numeric id as legacy_id (migration)
 *   maxLive  refuse (400 too_many_leads) when the live count would exceed this
 */
export async function pgUpsertLeads(incoming, opts = {}) {
  const { replace = false, skipStale = false, prune = false, dryRun = false, keepClientIds = false, actor = 'sync', maxLive = null } = opts;
  const orgId = await orgIdOrNull();
  const rows = await loadAllLeadRows({ includeDeleted: true, orgId });
  const existing = rows.map(rowToLead);
  const plan = planUpsert(existing, incoming, { replace, skipStale });
  const liveBefore = existing.filter((l) => !l.deleted_at).length;

  let toPrune = [];
  if (prune) {
    const keep = new Set(plan.matched.map((l) => l.uuid).filter(Boolean));
    toPrune = existing.filter((l) => !l.deleted_at && !keep.has(l.uuid));
  }
  const result = {
    counts: plan.counts,
    conflicts: plan.conflicts,
    added: plan.inserts.length,
    merged: plan.updates.length + plan.counts.skip_noop,
    updated: plan.updates.length,
    pruned: toPrune.length,
    count: liveBefore + plan.inserts.length - toPrune.length,
    updated_at: null,
  };
  if (dryRun) return result;
  if (maxLive != null && result.count > maxLive) {
    throw new LeadsError(400, 'too_many_leads', `Store would exceed ${maxLive} leads.`);
  }

  // inserts
  const usedLegacy = new Set(existing.map((l) => String(l.id)));
  const insertRowsOut = plan.inserts.map((l) => {
    const row = leadToRow(l, { orgId });
    delete row.deleted_at;
    // Numeric client ids are per-browser and collide, so they only survive a migration
    // (keepClientIds); non-numeric ids ("web_<id>" from the web form) are globally unique.
    const cid = l.client_id;
    const keepable = cid != null && cid !== '' && (keepClientIds || !/^[0-9]+$/.test(String(cid)));
    if (keepable && !usedLegacy.has(String(cid))) {
      row.legacy_id = String(l.client_id);
      usedLegacy.add(String(l.client_id));
    }
    return row;
  });
  const inserted = await insertRows(insertRowsOut);

  // updates
  const written = [...inserted];
  const activity = [];
  const naSync = [];
  for (const u of plan.updates) {
    const out = await restPatch('leads', `id=eq.${ENC(u.prev.uuid)}`, leadToRow(u.next, { orgId }));
    const row = Array.isArray(out) ? out[0] : out;
    if (row) written.push(row);
    if (u.stageChange) {
      activity.push({
        lead_id: u.prev.uuid,
        actor,
        type: 'stage_change',
        body: `Stage: ${u.stageChange.from} -> ${u.stageChange.to}`,
        meta: { from: u.stageChange.from, to: u.stageChange.to, via: 'sync' },
      });
    }
    if (JSON.stringify(u.prev.next_action || null) !== JSON.stringify(u.next.next_action || null)) {
      naSync.push({ uuid: u.prev.uuid, na: u.next.next_action || null });
    }
  }
  for (const r of inserted) {
    const na = r.next_action && typeof r.next_action === 'object' ? r.next_action : null;
    if (na) naSync.push({ uuid: r.id, na });
  }
  await addActivityRows(activity);
  for (const s of naSync) await syncNextActionTask(s.uuid, s.na, actor);

  if (toPrune.length) {
    const now = new Date().toISOString();
    for (let i = 0; i < toPrune.length; i += 100) {
      const ids = toPrune.slice(i, i + 100).map((l) => l.uuid).join(',');
      await restPatch('leads', `id=in.(${ids})`, { deleted_at: now });
    }
  }
  result.updated_at = maxUpdated(written) || new Date().toISOString();
  return result;
}

/**
 * Full-set save (academy-db saveLeadsStore contract). Matched rows are overwritten with the
 * incoming values, new leads inserted. Leads missing from the set are only soft-deleted
 * when opts.prune is true (CLI `replace`); other callers (web-leads, backfill) pass the
 * full set they loaded and must not lose rows created concurrently.
 */
export async function pgSaveLeadsStore(store, opts = {}) {
  const incoming = Array.isArray(store.leads) ? store.leads : [];
  const r = await pgUpsertLeads(incoming, { replace: true, skipStale: !opts.prune, prune: !!opts.prune, actor: opts.actor || 'sync' });
  return r.updated_at || new Date().toISOString();
}

// --- single-lead operations ---

export async function pgResolveLeadRow(ref, { includeDeleted = false } = {}) {
  const s = ref == null ? '' : String(ref).trim();
  if (!s) throw new LeadsError(400, 'lead_ref_required', 'lead_id (uuid or numeric id) is required.');
  const orgId = await orgIdOrNull();
  const filter = isUuid(s) ? `id=eq.${ENC(s)}` : `legacy_id=eq.${ENC(s)}`;
  const rows = await restGet('leads', `select=*&${filter}${orgClause(orgId)}&order=updated_at.desc&limit=2`);
  const live = (rows || []).filter((r) => !r.deleted_at);
  const row = live[0] || (includeDeleted ? rows?.[0] : null);
  if (!row) throw new LeadsError(404, 'not_found', `Lead ${s} not found.`);
  return row;
}

const sameInstant = (a, b) => a != null && b != null && (String(a) === String(b) || Date.parse(a) === Date.parse(b));

export async function pgGetLead(ref, { activityLimit = 100 } = {}) {
  const row = await pgResolveLeadRow(ref);
  const [activity, tasks] = await Promise.all([
    restGet('lead_activity', `select=*&lead_id=eq.${ENC(row.id)}&order=at.desc&limit=${Math.min(Number(activityLimit) || 100, 500)}`),
    restGet('lead_tasks', `select=*&lead_id=eq.${ENC(row.id)}&order=due_at.asc&limit=200`),
  ]);
  const open = (tasks || []).filter((t) => !t.done_at);
  const done = (tasks || []).filter((t) => t.done_at).sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))).slice(0, 50);
  return { lead: rowToLead(row), activity: activity || [], tasks: [...open, ...done] };
}

const PATCH_BLOCKED = new Set(['id', 'uuid', 'created_at', 'updated_at', 'deleted_at', 'legacy_id', 'pipeline_status']);

/**
 * Partial update of one lead with optimistic concurrency.
 * @returns {{lead: object}|{conflict: object}}  conflict.lead is the server copy
 */
export async function pgPatchLead(ref, patch, { expectedUpdatedAt = null, actor = 'sync', confirmDncClear = false } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new LeadsError(400, 'patch_required', 'patch must be an object.');
  const row = await pgResolveLeadRow(ref);
  if (expectedUpdatedAt && !sameInstant(row.updated_at, expectedUpdatedAt)) return { conflict: rowToLead(row) };

  const base = rowToLead(row);
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (PATCH_BLOCKED.has(k) || v === undefined) continue;
    if (k === 'name') {
      if (!String(v ?? '').trim()) throw new LeadsError(400, 'name_required', 'name cannot be empty.');
      next.name = v;
    } else if (k === 'stage') {
      const s = normStage(v);
      if (!s) throw new LeadsError(400, 'invalid_stage', `stage must be one of ${STAGES.join(', ')}.`);
      next.stage = s;
    } else if (k === 'next_action') {
      if (v === null) next.next_action = null;
      else {
        const na = cleanNextAction(v);
        if (!na) throw new LeadsError(400, 'invalid_next_action', 'next_action needs a valid due_at (and type call|text|email|visit|other).');
        next.next_action = na;
      }
    } else if (k === 'phones') {
      next.phones = mergePhones(base.phones, Array.isArray(v) ? v : []);
    } else if (k === 'list_status') {
      next.list_status = v && typeof v === 'object' && !Array.isArray(v) ? { ...(base.list_status || {}), ...v } : base.list_status;
    } else if (k === 'lists') {
      if (Array.isArray(v) && v.length) {
        next.lists = v.filter((x) => typeof x === 'string' && x);
        if (!next.lists.includes(next.list)) next.list = next.lists[0];
      }
    } else if (k === 'phone_dnc') {
      next.phone_dnc = typeof v === 'boolean' ? v : null;
    } else {
      next[k] = v;
    }
  }
  // DNC safety: clearing a true flag needs an explicit confirmation flag
  const wasDnc = base.phone_dnc === true;
  if (wasDnc && 'phone_dnc' in patch && next.phone_dnc !== true) {
    if (!confirmDncClear) throw new LeadsError(400, 'dnc_clear_requires_confirmation', 'Send confirm_dnc_clear:true to clear a do-not-call flag.');
  } else if (wasDnc && !('phone_dnc' in patch)) {
    // phone replaced by hand: the flag belonged to the old number
    if ('phone' in patch && phoneDigits(next.phone) !== phoneDigits(base.phone)) {
      next.phones = carryDncPhone(next.phones, base.phone); // keep the old number's DNC record
      const entry = (next.phones || []).find((p) => phoneDigits(p.number) === phoneDigits(next.phone));
      next.phone_dnc = entry && typeof entry.dnc === 'boolean' ? entry.dnc : null;
    } else next.phone_dnc = true;
  }
  // a DNC-true entry for the primary number always wins
  const prim = (next.phones || []).find((p) => phoneDigits(p.number) === phoneDigits(next.phone));
  if (prim?.dnc === true && next.phone_dnc !== true && !('phone_dnc' in patch)) next.phone_dnc = true;
  if (!normStage(next.stage)) next.stage = deriveStage(next);
  // legacy status moved by the patch (and stage not set explicitly) -> re-derive
  if (!('stage' in patch) && ('status' in patch || 'list_status' in patch) && deriveStage(next) !== deriveStage(base)) {
    next.stage = deriveStage(next);
  }

  const out = await restPatch(
    'leads',
    `id=eq.${ENC(row.id)}&updated_at=eq.${ENC(row.updated_at)}`,
    leadToRow(next, { orgId: row.org_id || null }),
  );
  const saved = Array.isArray(out) ? out[0] : out;
  if (!saved) {
    // someone wrote between our read and write
    const fresh = await pgResolveLeadRow(row.id, { includeDeleted: true });
    return { conflict: rowToLead(fresh) };
  }

  const activity = [];
  const from = normStage(base.stage) || 'new';
  const to = normStage(next.stage) || 'new';
  if (from !== to) {
    activity.push({ lead_id: row.id, actor, type: 'stage_change', body: `Stage: ${from} -> ${to}`, meta: { from, to, via: 'patch' } });
  }
  if (wasDnc && next.phone_dnc !== true && confirmDncClear) {
    activity.push({ lead_id: row.id, actor, type: 'system', body: 'Do-not-call flag cleared by hand', meta: { event: 'dnc_cleared' } });
  }
  await addActivityRows(activity);
  if (JSON.stringify(base.next_action || null) !== JSON.stringify(next.next_action || null)) {
    await syncNextActionTask(row.id, next.next_action || null, actor);
  }
  return { lead: rowToLead(saved) };
}

export async function pgDeleteLead(ref, { actor = 'sync', restore = false, expectedUpdatedAt = null } = {}) {
  const row = await pgResolveLeadRow(ref, { includeDeleted: restore });
  if (expectedUpdatedAt && !sameInstant(row.updated_at, expectedUpdatedAt)) return { conflict: rowToLead(row) };
  const deleted_at = restore ? null : new Date().toISOString();
  const out = await restPatch('leads', `id=eq.${ENC(row.id)}`, { deleted_at });
  const saved = Array.isArray(out) ? out[0] : out;
  await addActivityRows([
    { lead_id: row.id, actor, type: 'system', body: restore ? 'Lead restored' : 'Lead deleted', meta: { event: restore ? 'restore' : 'delete' } },
  ]);
  return { id: row.id, deleted_at, updated_at: saved?.updated_at || null };
}

// --- activity ---

export async function pgAddLeadActivity(ref, a, { actor = 'sync' } = {}) {
  const row = await pgResolveLeadRow(ref);
  const type = String(a?.type || '').toLowerCase();
  if (!ACTIVITY_TYPES.includes(type)) throw new LeadsError(400, 'invalid_type', `type must be one of ${ACTIVITY_TYPES.join(', ')}.`);
  const direction = a?.direction == null || a.direction === '' ? null : String(a.direction).toLowerCase();
  if (direction && direction !== 'inbound' && direction !== 'outbound') throw new LeadsError(400, 'invalid_direction', 'direction must be inbound or outbound.');
  let at = null;
  if (a?.at) {
    if (Number.isNaN(Date.parse(a.at))) throw new LeadsError(400, 'invalid_at', 'at must be an ISO timestamp.');
    at = new Date(a.at).toISOString();
  }
  const rec = {
    lead_id: row.id,
    actor: String(actor).slice(0, 80),
    type,
    direction,
    outcome: a?.outcome == null ? null : String(a.outcome).slice(0, 200),
    body: a?.body == null ? null : String(a.body).slice(0, 5000),
    meta: a?.meta && typeof a.meta === 'object' && !Array.isArray(a.meta) ? a.meta : {},
  };
  if (at) rec.at = at;
  const out = await restInsert('lead_activity', rec);
  return Array.isArray(out) ? out[0] : out;
}

export async function pgListLeadActivity(ref, { limit = 100, before = null } = {}) {
  const row = await pgResolveLeadRow(ref, { includeDeleted: true });
  let q = `select=*&lead_id=eq.${ENC(row.id)}&order=at.desc&limit=${Math.min(Number(limit) || 100, 500)}`;
  if (before) {
    if (Number.isNaN(Date.parse(before))) throw new LeadsError(400, 'invalid_before', 'before must be an ISO timestamp.');
    q += `&at=lt.${ENC(before)}`;
  }
  return (await restGet('lead_activity', q)) || [];
}

// --- tasks ---

function mirrorFromTask(t) {
  return t ? { type: t.type, due_at: t.due_at, note: t.note || '', task_id: t.id } : null;
}

/** Recompute leads.next_action from the earliest open task. Returns the updated lead row. */
async function mirrorNextAction(leadUuid) {
  const open = await restGet('lead_tasks', `select=*&lead_id=eq.${ENC(leadUuid)}&done_at=is.null&order=due_at.asc&limit=1`);
  const out = await restPatch('leads', `id=eq.${ENC(leadUuid)}`, { next_action: mirrorFromTask(open?.[0]) });
  return Array.isArray(out) ? out[0] : out;
}

/**
 * Make the open "next action" task match na (used when next_action is set via patch/push).
 * Closes open is_next_action tasks that differ, inserts one when na is set.
 */
async function syncNextActionTask(leadUuid, na, actor, { mirror = false } = {}) {
  const open = (await restGet('lead_tasks', `select=*&lead_id=eq.${ENC(leadUuid)}&done_at=is.null&is_next_action=eq.true&limit=50`)) || [];
  let keep = null;
  const now = new Date().toISOString();
  for (const t of open) {
    if (na && !keep && t.type === na.type && Date.parse(t.due_at) === Date.parse(na.due_at) && String(t.note || '') === String(na.note || '')) {
      keep = t;
      continue;
    }
    await restPatch('lead_tasks', `id=eq.${ENC(t.id)}`, { done_at: now });
  }
  if (na && !keep) {
    const out = await restInsert('lead_tasks', {
      lead_id: leadUuid, type: na.type, due_at: na.due_at, note: na.note || null, created_by: String(actor).slice(0, 80), is_next_action: true,
    });
    keep = Array.isArray(out) ? out[0] : out;
  }
  if (mirror && keep && na && !na.task_id) {
    await restPatch('leads', `id=eq.${ENC(leadUuid)}`, { next_action: { ...na, task_id: keep.id } });
  }
  return keep;
}

export async function pgAddTask(ref, t, { actor = 'sync' } = {}) {
  const row = await pgResolveLeadRow(ref);
  const type = String(t?.type || 'call').toLowerCase();
  if (!TASK_TYPES.includes(type)) throw new LeadsError(400, 'invalid_type', `type must be one of ${TASK_TYPES.join(', ')}.`);
  if (!t?.due_at || Number.isNaN(Date.parse(t.due_at))) throw new LeadsError(400, 'invalid_due_at', 'due_at must be an ISO timestamp.');
  const out = await restInsert('lead_tasks', {
    lead_id: row.id,
    type,
    due_at: new Date(t.due_at).toISOString(),
    note: t.note == null ? null : String(t.note).slice(0, 1000),
    created_by: String(actor).slice(0, 80),
  });
  const task = Array.isArray(out) ? out[0] : out;
  const lead = await mirrorNextAction(row.id);
  return { task, lead: lead ? rowToLead(lead) : null };
}

export async function pgCompleteTask(taskId, { actor = 'sync', note = null } = {}) {
  const id = String(taskId || '').trim();
  if (!isUuid(id)) throw new LeadsError(400, 'task_id_required', 'task_id (uuid) is required.');
  const found = await restGet('lead_tasks', `select=*&id=eq.${ENC(id)}&limit=1`);
  const t = found?.[0];
  if (!t) throw new LeadsError(404, 'not_found', `Task ${id} not found.`);
  let task = t;
  if (!t.done_at) {
    const out = await restPatch('lead_tasks', `id=eq.${ENC(id)}&done_at=is.null`, { done_at: new Date().toISOString() });
    task = (Array.isArray(out) ? out[0] : out) || t;
    await addActivityRows([
      { lead_id: t.lead_id, actor, type: 'system', body: `Task done: ${t.type}${t.note ? ` - ${t.note}` : ''}${note ? ` (${String(note).slice(0, 300)})` : ''}`, meta: { event: 'task_done', task_id: t.id } },
    ]);
  }
  const lead = await mirrorNextAction(t.lead_id);
  return { task, lead: lead ? rowToLead(lead) : null };
}

export async function pgTasksDue({ leadId = null } = {}) {
  let q = 'select=*&order=due_at.asc&limit=1000';
  if (leadId) {
    const row = await pgResolveLeadRow(leadId);
    q += `&lead_id=eq.${ENC(row.id)}`;
  }
  const tasks = (await restGet('lead_tasks_due', q)) || [];
  const overdue = tasks.filter((t) => t.bucket === 'overdue').length;
  return { tasks, counts: { overdue, today: tasks.length - overdue, total: tasks.length } };
}

export async function pgFunnel() {
  const rows = (await restGet('lead_funnel', 'select=*')) || [];
  const by = new Map(rows.map((r) => [r.stage, r]));
  const stages = STAGES.map((s) => ({ stage: s, leads: Number(by.get(s)?.leads) || 0, amount: Number(by.get(s)?.amount) || 0 }));
  const extra = rows.filter((r) => !STAGES.includes(r.stage)).map((r) => ({ stage: r.stage, leads: Number(r.leads) || 0, amount: Number(r.amount) || 0 }));
  const all = [...stages, ...extra];
  const funnel = Object.fromEntries(all.map((r) => [r.stage, r.leads]));
  return { funnel, stages: all, total: all.reduce((n, r) => n + r.leads, 0) };
}

/** Soft-delete placeholder shells (prune_placeholders on the pipeline backend). */
export async function pgSoftDeleteLeads(uuids) {
  const now = new Date().toISOString();
  for (let i = 0; i < uuids.length; i += 100) {
    await restPatch('leads', `id=in.(${uuids.slice(i, i + 100).join(',')})`, { deleted_at: now });
  }
}

// --- Activities ------------------------------------------------------------

function activityFromRow(row) {
  return {
    id: row.id,
    lead_id: row.lead_id,
    lead_key: row.lead_key || '',
    user: row.user_name || '',
    type: row.type || 'note',
    at: row.at,
    outcome: row.outcome || '',
    detail: row.detail && typeof row.detail === 'object' ? row.detail : {},
    next_follow_up_at: row.next_follow_up_at || null,
  };
}

export async function pgLoadActivitiesStore() {
  const orgId = await resolveOrgId();
  const rows = await restGet(
    'activities',
    `select=*&org_id=eq.${orgId}&order=at.asc&limit=50000`,
  );
  const activities = (rows || []).map(activityFromRow);
  const updated_at = activities.length ? activities[activities.length - 1].at : null;
  return { activities, updated_at };
}

export async function pgSaveActivitiesStore(store) {
  // Full rewrite is expensive; used rarely. Prefer appendActivityPg.
  const orgId = await resolveOrgId();
  await restDelete('activities', `org_id=eq.${orgId}`);
  const activities = Array.isArray(store.activities) ? store.activities : [];
  const chunk = 200;
  for (let i = 0; i < activities.length; i += chunk) {
    const slice = activities.slice(i, i + chunk).map((a) => ({
      org_id: orgId,
      lead_id: null, // optional uuid link; lead_key used for matching
      lead_key: String(a.lead_key || ''),
      user_name: String(a.user || a.user_name || ''),
      type: String(a.type || 'note'),
      outcome: String(a.outcome || ''),
      detail: a.detail && typeof a.detail === 'object' ? a.detail : {},
      next_follow_up_at: a.next_follow_up_at || null,
      at: a.at || new Date().toISOString(),
    }));
    if (slice.length) await restInsert('activities', slice);
  }
  return new Date().toISOString();
}

export async function pgAppendActivity(entry) {
  const orgId = await resolveOrgId();
  const row = {
    org_id: orgId,
    lead_id: null,
    lead_key: String(entry.lead_key || ''),
    user_name: String(entry.user || entry.user_name || ''),
    type: String(entry.type || 'note'),
    outcome: String(entry.outcome || ''),
    detail: entry.detail && typeof entry.detail === 'object' ? entry.detail : {},
    next_follow_up_at: entry.next_follow_up_at || null,
    at: entry.at || new Date().toISOString(),
  };
  // Try resolve lead_id from uuid field if provided
  if (entry.lead_uuid) row.lead_id = entry.lead_uuid;
  const inserted = await restInsert('activities', row);
  const saved = Array.isArray(inserted) ? inserted[0] : inserted;
  return activityFromRow(saved || { ...row, id: entry.id });
}

// --- Practice --------------------------------------------------------------

function practiceFromRow(row) {
  const p = row.payload || {};
  return {
    id: row.id,
    user: p.user || '',
    type: row.mode || p.type || 'roleplay',
    score: row.score != null ? Number(row.score) : p.score ?? null,
    at: row.created_at,
    note: p.note || '',
  };
}

export async function pgLoadPracticeStore() {
  const orgId = await resolveOrgId();
  const rows = await restGet(
    'practice_sessions',
    `select=*&org_id=eq.${orgId}&order=created_at.asc&limit=20000`,
  );
  return {
    events: (rows || []).map(practiceFromRow),
    updated_at: rows?.length ? rows[rows.length - 1].created_at : null,
  };
}

export async function pgSavePracticeStore(store) {
  const orgId = await resolveOrgId();
  await restDelete('practice_sessions', `org_id=eq.${orgId}`);
  const events = Array.isArray(store.events) ? store.events : [];
  for (const e of events) {
    await restInsert('practice_sessions', {
      org_id: orgId,
      mode: String(e.type || 'roleplay'),
      score: e.score != null ? Number(e.score) : null,
      payload: { user: e.user || '', note: e.note || '', type: e.type || 'roleplay' },
      created_at: e.at || new Date().toISOString(),
    });
  }
  return new Date().toISOString();
}

export async function pgAppendPractice(event) {
  const orgId = await resolveOrgId();
  const inserted = await restInsert('practice_sessions', {
    org_id: orgId,
    mode: String(event.type || 'roleplay'),
    score: event.score != null ? Number(event.score) : null,
    payload: {
      user: event.user || '',
      note: String(event.note || '').slice(0, 500),
      type: event.type || 'roleplay',
    },
  });
  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  return practiceFromRow(row);
}

/** True if organizations table is reachable and default org exists */
export async function pgIsReady() {
  try {
    await getDefaultOrg();
    return true;
  } catch {
    return false;
  }
}
