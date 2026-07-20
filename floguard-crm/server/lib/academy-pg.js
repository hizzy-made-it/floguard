/**
 * Postgres-backed Academy stores (org-scoped).
 * Shape compatibility: load* returns same JSON shapes as Storage-backed helpers.
 */
import { restDelete, restGet, restInsert, restPatch } from './supabase-rest.js';

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

// --- Leads -----------------------------------------------------------------

function listsOf(l) {
  if (Array.isArray(l?.lists) && l.lists.length) {
    return l.lists.filter((x) => typeof x === 'string' && x);
  }
  return l?.list ? [String(l.list)] : [];
}

function leadToRow(l, orgId) {
  const lists = listsOf(l);
  const list = lists[0] || l.list || 'Website';
  const status = l.status != null && l.status !== '' ? String(l.status) : 'New';
  const legacy =
    l.id != null && l.id !== ''
      ? String(l.id)
      : null;
  return {
    org_id: orgId,
    legacy_id: legacy,
    name: String(l.name || '').trim() || '(unnamed)',
    city: String(l.city || ''),
    industry: String(l.industry || ''),
    lead_type: String(l.lead_type || 'website'),
    list: String(list),
    lists,
    phone: String(l.phone || ''),
    website: String(l.website || ''),
    email: String(l.email || ''),
    contact_name: String(l.contact || l.contact_name || ''),
    owner: String(l.owner || ''),
    status,
    pipeline_status: pipelineFromStatus(status),
    notes: String(l.notes || ''),
    source: String(l.source || ''),
    custom_type: String(l.custom_type || ''),
    best_package: String(l.package || l.best_package || ''),
    amount:
      l.amount === '' || l.amount == null || Number.isNaN(Number(l.amount))
        ? null
        : Number(l.amount),
    next_follow_up_at: l.next_follow_up_at || null,
    last_activity_at: l.last_activity_at || null,
    meta: {
      company: l.company || undefined,
      categories: l.categories || undefined,
      list_status: l.list_status || undefined,
      lists_touched: l.lists_touched || undefined,
    },
  };
}

function leadFromRow(row) {
  const lists = Array.isArray(row.lists) && row.lists.length ? row.lists : [row.list].filter(Boolean);
  const id =
    row.legacy_id != null && row.legacy_id !== ''
      ? Number.isFinite(Number(row.legacy_id)) && String(Number(row.legacy_id)) === String(row.legacy_id)
        ? Number(row.legacy_id)
        : row.legacy_id
      : row.id;
  return {
    id,
    uuid: row.id,
    name: row.name || '',
    city: row.city || '',
    industry: row.industry || '',
    lead_type: row.lead_type || 'website',
    list: row.list || lists[0] || 'Website',
    lists,
    phone: row.phone || '',
    website: row.website || '',
    email: row.email || '',
    contact: row.contact_name || '',
    owner: row.owner || '',
    status: row.status || 'New',
    pipeline_status: row.pipeline_status || pipelineFromStatus(row.status),
    notes: row.notes || '',
    source: row.source || '',
    package: row.best_package || '',
    amount: row.amount != null ? row.amount : '',
    next_follow_up_at: row.next_follow_up_at || '',
    last_activity_at: row.last_activity_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    list_status:
      row.meta && typeof row.meta === 'object' && row.meta.list_status
        ? row.meta.list_status
        : undefined,
    lists_touched:
      row.meta && typeof row.meta === 'object' ? !!row.meta.lists_touched : undefined,
  };
}

export async function pgLoadLeadsStore() {
  const orgId = await resolveOrgId();
  const rows = await restGet(
    'leads',
    `select=*&org_id=eq.${orgId}&order=updated_at.desc&limit=20000`,
  );
  const leads = (rows || []).map(leadFromRow);
  let updated_at = null;
  for (const r of rows || []) {
    if (r.updated_at && (!updated_at || r.updated_at > updated_at)) updated_at = r.updated_at;
  }
  return { leads, updated_at };
}

/**
 * Full-set save (matches Storage replace semantics).
 * Upserts by (org_id, legacy_id) when legacy_id present; otherwise by name+city match.
 */
export async function pgSaveLeadsStore(store) {
  const orgId = await resolveOrgId();
  const incoming = Array.isArray(store.leads) ? store.leads : [];
  const existing = await restGet(
    'leads',
    `select=id,legacy_id,name,city&org_id=eq.${orgId}&limit=20000`,
  );
  const byLegacy = new Map();
  const byKey = new Map();
  for (const r of existing || []) {
    if (r.legacy_id != null && r.legacy_id !== '') byLegacy.set(String(r.legacy_id), r);
    const k = `${String(r.name || '').trim().toLowerCase()}|${String(r.city || '').trim().toLowerCase()}`;
    byKey.set(k, r);
  }

  const keepUuids = new Set();
  let nextNum =
    Math.max(
      0,
      ...(existing || []).map((r) => Number(r.legacy_id) || 0),
      ...incoming.map((l) => Number(l?.id) || 0),
    ) + 1;

  for (const l of incoming) {
    if (!l || typeof l !== 'object') continue;
    if (!String(l.name || '').trim()) continue;
    let legacy =
      l.id != null && l.id !== ''
        ? String(l.id)
        : null;
    if (!legacy) {
      legacy = String(nextNum);
      nextNum += 1;
      l.id = Number(legacy) || legacy;
    }
    const row = leadToRow({ ...l, id: legacy }, orgId);
    const prev =
      byLegacy.get(String(legacy)) ||
      byKey.get(
        `${String(l.name || '').trim().toLowerCase()}|${String(l.city || '').trim().toLowerCase()}`,
      );

    if (prev?.id) {
      keepUuids.add(prev.id);
      await restPatch('leads', `id=eq.${prev.id}`, {
        ...row,
        // do not rewrite id uuid
        org_id: orgId,
      });
    } else {
      const inserted = await restInsert('leads', row);
      const id = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
      if (id) keepUuids.add(id);
    }
  }

  // Remove leads not present in the full set (true replace)
  for (const r of existing || []) {
    if (!keepUuids.has(r.id)) {
      await restDelete('leads', `id=eq.${r.id}`);
    }
  }

  return new Date().toISOString();
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
