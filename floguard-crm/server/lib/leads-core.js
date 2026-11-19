/**
 * Lead domain logic — pure functions, no I/O. Shared by api/academy-leads.js (both
 * the Storage-blob path and the Postgres path) and scripts/migrate-leads-to-pg.mjs.
 *
 * Contract: docs/superpowers/specs/2026-11-19-crm-next-design.md
 * ("Shared lead contact contract") and floguard-crm/docs/handoff/C.md.
 */

export const STAGES = ['new', 'contacted', 'assessment_booked', 'estimate_sent', 'won', 'lost', 'nurture'];
export const ACTIVITY_TYPES = ['call', 'text', 'email', 'note', 'stage_change', 'enrich', 'visit', 'system'];
export const TASK_TYPES = ['call', 'text', 'email', 'visit', 'other'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v.trim());

/** Fields the server owns; never taken from a client lead. */
const SYSTEM_KEYS = new Set(['id', 'uuid', 'created_at', 'updated_at', 'deleted_at', 'legacy_id', 'restore']);

// ---------------------------------------------------------------------------
// Stage derivation
// ---------------------------------------------------------------------------

const STATUS_TO_STAGE = {
  '': 'new',
  new: 'new',
  'called - no answer': 'contacted',
  callback: 'contacted',
  interested: 'contacted',
  contacted: 'contacted',
  follow_up: 'contacted',
  quoted: 'estimate_sent',
  'deposit collected': 'won',
  'contract signed': 'won',
  closed: 'won',
  won: 'won',
  'not interested': 'lost',
  'do not contact': 'lost',
  lost: 'lost',
  archived: 'nurture',
  nurture: 'nurture',
};
const PROGRESS = { new: 0, contacted: 1, estimate_sent: 2, won: 3 };

export function stageFromStatus(status) {
  const s = String(status ?? '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(STATUS_TO_STAGE, s)) return STATUS_TO_STAGE[s];
  if (/^called\b/.test(s)) return 'contacted';
  return 'new';
}

/** Canonical stage string or null. Accepts "Estimate Sent", "estimate-sent", etc. */
export function normStage(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STAGES.includes(s) ? s : null;
}

/**
 * Derive stage from the legacy per-cause status strings only (ignores any stored stage).
 * `status` is the rollup of the primary cause; `list_status` is {cause: status}.
 * Across causes the most advanced progress wins (won > estimate_sent > contacted).
 * With no progress: a terminal primary status (lost/nurture) wins; if every cause is
 * terminal it is lost (any lost) else nurture; otherwise new.
 */
export function deriveStage(lead) {
  const per = lead?.list_status && typeof lead.list_status === 'object' && !Array.isArray(lead.list_status)
    ? Object.values(lead.list_status).filter((x) => x != null && x !== '')
    : [];
  const stages = [stageFromStatus(lead?.status), ...per.map(stageFromStatus)];
  let best = null;
  for (const s of stages) {
    if (s in PROGRESS && PROGRESS[s] > 0 && (best == null || PROGRESS[s] > PROGRESS[best])) best = s;
  }
  if (best) return best;
  const primary = stageFromStatus(lead?.status);
  if (primary === 'lost' || primary === 'nurture') return primary;
  const causeStages = per.map(stageFromStatus);
  if (causeStages.length && causeStages.every((s) => s === 'lost' || s === 'nurture')) {
    return causeStages.includes('lost') ? 'lost' : 'nurture';
  }
  return 'new';
}

/** pipeline_status column (older 5-value rollup used by academy-pg before 017). */
export function pipelineFromStage(stage) {
  return { new: 'new', contacted: 'contacted', assessment_booked: 'follow_up', estimate_sent: 'follow_up', won: 'closed', lost: 'lost', nurture: 'lost' }[stage] || 'new';
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const SUFFIX = {
  street: 'st', avenue: 'ave', drive: 'dr', road: 'rd', boulevard: 'blvd', lane: 'ln', court: 'ct',
  circle: 'cir', place: 'pl', terrace: 'ter', highway: 'hwy', parkway: 'pkwy', trail: 'trl',
  north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

export const normName = (v) => String(v ?? '').trim().toLowerCase();
export const normCity = (v) => String(v ?? '').trim().toLowerCase();
export function normParcel(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
}
/** Street part only (before the first comma), abbreviations folded, punctuation dropped. */
export function normAddress(v) {
  const street = String(v ?? '').split(',')[0].toLowerCase();
  return street
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIX[w] || w)
    .join(' ');
}
export function phoneDigits(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

/** Legacy merge key (kept for LeadAgent / backward compatibility). */
export function leadKey(l) {
  return `${normName(l?.name)}|${normCity(l?.city)}`;
}

const eqOrEmpty = (a, b) => !a || !b || a === b;

/** Two leads could be the same record: same name; city/address/parcel equal when both present. */
function compatible(a, b) {
  return (
    normName(a?.name) === normName(b?.name) &&
    eqOrEmpty(normCity(a?.city), normCity(b?.city)) &&
    eqOrEmpty(normAddress(a?.address), normAddress(b?.address)) &&
    eqOrEmpty(normParcel(a?.parcel_id), normParcel(b?.parcel_id))
  );
}

/**
 * In-memory identity index. Match order for an incoming lead:
 *   1. uuid (incoming `uuid`, or `id` when it is a UUID)
 *   2. legacy id (`id` as stored legacy_id) — only if the leads are otherwise compatible,
 *      because numeric ids are assigned per browser and collide across devices
 *   3. parcel_id
 *   4. name+city (the legacy key) — but when both sides have an address they must match,
 *      and when both have a parcel_id they must match, so two different owners with the
 *      same name in the same city stay separate
 * Soft-deleted entries are indexed so a stale browser cannot resurrect them, but live
 * entries are always preferred.
 */
export class LeadIndex {
  constructor(leads = []) {
    this.entries = [];
    this.byUuid = new Map();
    this.byLegacy = new Map();
    this.byParcel = new Map();
    this.byKey = new Map();
    for (const l of leads) this.add(l);
  }

  static _push(map, k, entry) {
    if (!k) return;
    const arr = map.get(k);
    if (arr) {
      if (!arr.includes(entry)) arr.push(entry);
    } else map.set(k, [entry]);
  }

  /** @returns {{lead: object}} entry */
  add(lead) {
    const entry = { lead };
    this.entries.push(entry);
    this._index(entry);
    return entry;
  }

  _index(entry) {
    const l = entry.lead;
    if (l.uuid) this.byUuid.set(String(l.uuid).toLowerCase(), entry);
    if (l.id != null && l.id !== '') LeadIndex._push(this.byLegacy, String(l.id), entry);
    LeadIndex._push(this.byParcel, normParcel(l.parcel_id), entry);
    LeadIndex._push(this.byKey, leadKey(l), entry);
  }

  /** Call after mutating entry.lead (keys may have changed). Stale keys are re-verified on lookup. */
  reindex(entry) {
    this._index(entry);
  }

  static _pick(cands, test) {
    const ok = (cands || []).filter(test);
    return ok.find((e) => !e.lead.deleted_at) || ok[0] || null;
  }

  /**
   * @returns {{entry: object|null, via: string|null, conflict: string|null}}
   */
  find(inc) {
    const out = { entry: null, via: null, conflict: null };
    // 1. uuid
    const u = String(inc?.uuid || (isUuid(inc?.id) ? inc.id : '') || '').toLowerCase();
    if (u && this.byUuid.has(u)) {
      out.entry = this.byUuid.get(u);
      out.via = 'uuid';
      return out;
    }
    // 2. legacy id, guarded by compatibility
    if (inc?.id != null && inc.id !== '' && !isUuid(inc.id)) {
      const e = LeadIndex._pick(this.byLegacy.get(String(inc.id)), (x) => String(x.lead.id) === String(inc.id) && compatible(x.lead, inc));
      if (e) {
        out.entry = e;
        out.via = 'id';
        return out;
      }
    }
    // 3. parcel
    const p = normParcel(inc?.parcel_id);
    const keyEntry = LeadIndex._pick(this.byKey.get(leadKey(inc)), (x) => leadKey(x.lead) === leadKey(inc) && compatible(x.lead, inc));
    if (p) {
      const e = LeadIndex._pick(this.byParcel.get(p), (x) => normParcel(x.lead.parcel_id) === p);
      if (e) {
        out.entry = e;
        out.via = 'parcel';
        if (keyEntry && keyEntry !== e && !keyEntry.lead.deleted_at && !e.lead.deleted_at) out.conflict = 'parcel_and_name_match_different_leads';
        return out;
      }
    }
    // 4. name+city (+address/parcel compatibility)
    if (keyEntry) {
      const cands = (this.byKey.get(leadKey(inc)) || []).filter((x) => leadKey(x.lead) === leadKey(inc) && compatible(x.lead, inc));
      const ia = normAddress(inc?.address);
      const exact = ia ? cands.find((x) => normAddress(x.lead.address) === ia && !x.lead.deleted_at) : null;
      out.entry = exact || keyEntry;
      out.via = 'name_city';
      const live = cands.filter((x) => !x.lead.deleted_at);
      if (!exact && live.length > 1) out.conflict = 'ambiguous_name_city';
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const isEmptyVal = (v) =>
  v == null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

export function leadListsOf(l) {
  if (Array.isArray(l?.lists) && l.lists.length) return l.lists.filter((x) => typeof x === 'string' && x);
  return l?.list ? [String(l.list)] : [];
}

/** Merge phone arrays by digit string. dnc/litigator true is sticky per number. */
export function mergePhones(base, inc) {
  const out = [];
  const idx = new Map();
  const put = (p) => {
    if (!p || typeof p !== 'object') return;
    const key = phoneDigits(p.number);
    if (!key) return;
    if (!idx.has(key)) {
      idx.set(key, out.length);
      out.push({ ...p });
      return;
    }
    const cur = out[idx.get(key)];
    for (const [k, v] of Object.entries(p)) {
      if (k === 'dnc' || k === 'litigator') {
        if (cur[k] === true) continue; // sticky
        if (v === true || (v === false && cur[k] == null)) cur[k] = v;
        else if (v != null && cur[k] == null) cur[k] = v;
        continue;
      }
      if (v == null || v === '') continue;
      if (k === 'line_type' && v === 'unknown' && cur[k]) continue;
      cur[k] = v;
    }
  };
  (Array.isArray(base) ? base : []).forEach(put);
  (Array.isArray(inc) ? inc : []).forEach(put);
  return out;
}

function cleanNextAction(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const type = TASK_TYPES.includes(String(v.type)) ? String(v.type) : 'other';
  const due = v.due_at ? new Date(v.due_at) : null;
  if (!due || Number.isNaN(due.getTime())) return null;
  const out = { type, due_at: due.toISOString(), note: String(v.note ?? '') };
  if (v.task_id) out.task_id = String(v.task_id);
  return out;
}
export { cleanNextAction };

function ts(v) {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/**
 * Merge an incoming lead into a base lead (push / bulk_upsert / enrichment).
 *  - incoming non-empty fields win; empty never clears (so a stale or partial client
 *    cannot blank data)
 *  - lists: an explicit incoming `lists` array is authoritative (checkbox semantics)
 *  - phones merged per number; phone_dnc === true is sticky (see rules in handoff)
 *  - stage: explicit valid incoming stage wins unless the incoming copy is older than
 *    the server row; otherwise re-derived from legacy statuses only when those changed
 * @param {object} opts { replace?: boolean, skipStale?: boolean }  replace = incoming is the whole truth for
 *   ordinary fields (CLI `replace`); system-owned fields (stage, next_action, phones,
 *   DNC, parcel) are still preserved.
 */
export function mergeLead(base, inc, opts = {}) {
  const replace = !!opts.replace;
  const stale = ts(inc?.updated_at) != null && ts(base?.updated_at) != null && ts(inc.updated_at) < ts(base.updated_at);
  // skipStale: a copy older than the stored row is dropped entirely (full-set saves by
  // web-leads/backfill must not overwrite edits made after they loaded the set)
  if (opts.skipStale && stale) return base;
  let merged;
  if (replace) {
    merged = { ...(inc || {}) };
    for (const k of SYSTEM_KEYS) if (k in base) merged[k] = base[k];
    for (const k of ['stage', 'next_action', 'phones', 'phone_dnc', 'parcel_id', 'enriched_at']) {
      if (isEmptyVal(merged[k]) && !isEmptyVal(base[k])) merged[k] = base[k];
    }
    if (isEmptyVal(merged.name)) merged.name = base.name;
  } else {
    merged = { ...base };
  }

  // lists
  if (Array.isArray(inc?.lists)) {
    const next = leadListsOf(inc);
    if (next.length) {
      merged.lists = next;
      merged.list = inc.list && next.includes(String(inc.list)) ? String(inc.list) : next[0];
    }
  } else if (!replace) {
    const lists = leadListsOf(base).slice();
    for (const x of leadListsOf(inc)) if (!lists.includes(x)) lists.push(x);
    if (lists.length) merged.lists = lists;
  }

  const SPECIAL = new Set(['lists', 'list_status', 'phones', 'phone_dnc', 'stage', 'next_action', 'name', 'city']);
  if (!replace) {
    for (const [k, v] of Object.entries(inc || {})) {
      if (SYSTEM_KEYS.has(k) || SPECIAL.has(k)) continue;
      if (isEmptyVal(v)) continue;
      merged[k] = v;
    }
    if (isEmptyVal(base?.city) && !isEmptyVal(inc?.city)) merged.city = inc.city;
    if (isEmptyVal(base?.name) && !isEmptyVal(inc?.name)) merged.name = inc.name;
  }

  // phones + DNC
  const phones = mergePhones(base?.phones, inc?.phones);
  if (phones.length) merged.phones = phones;
  const baseDigits = phoneDigits(base?.phone);
  const mergedDigits = phoneDigits(merged.phone);
  const entryDnc = mergedDigits ? phones.find((p) => phoneDigits(p.number) === mergedDigits)?.dnc : undefined;
  let dnc = base?.phone_dnc ?? null;
  const incDnc = inc?.phone_dnc;
  if (incDnc === true) dnc = true;
  else if (incDnc === false) {
    if (dnc !== true) dnc = false;
    else if (mergedDigits && baseDigits && mergedDigits !== baseDigits && entryDnc !== true) dnc = false; // different number, scrubbed clean
  } else if (dnc == null && typeof incDnc === 'boolean') dnc = incDnc;
  if (entryDnc === true) dnc = true;
  merged.phone_dnc = dnc;

  // list_status
  if (inc?.list_status && typeof inc.list_status === 'object' && !Array.isArray(inc.list_status)) {
    if (Object.keys(inc.list_status).length) {
      merged.list_status = { ...(replace ? {} : base?.list_status || {}), ...inc.list_status };
      if (Array.isArray(merged.lists)) {
        const keep = new Set(merged.lists);
        for (const k of Object.keys(merged.list_status)) if (!keep.has(k)) delete merged.list_status[k];
      }
    }
  } else if (base?.list_status && !('list_status' in merged)) merged.list_status = base.list_status;
  if (inc?.lists_touched) merged.lists_touched = true;

  // next_action (replace wholesale; ignore stale copies)
  const na = stale ? null : cleanNextAction(inc?.next_action);
  if (na) merged.next_action = na;

  // stage
  const incStage = stale ? null : normStage(inc?.stage);
  if (incStage) merged.stage = incStage;
  else {
    const baseStage = normStage(base?.stage);
    if (!baseStage) merged.stage = deriveStage(merged);
    else {
      merged.stage = baseStage;
      if (deriveStage(merged) !== deriveStage(base)) merged.stage = deriveStage(merged); // legacy status moved
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Row mapping (Postgres)
// ---------------------------------------------------------------------------

const TS_FIELDS = ['next_follow_up_at', 'last_activity_at', 'enriched_at'];
// lead key -> column
const COLUMN_MAP = {
  name: 'name', city: 'city', address: 'address', zip: 'zip', parcel_id: 'parcel_id',
  industry: 'industry', lead_type: 'lead_type', list: 'list', lists: 'lists',
  phone: 'phone', website: 'website', email: 'email', contact: 'contact_name', owner: 'owner',
  status: 'status', notes: 'notes', source: 'source', custom_type: 'custom_type',
  package: 'best_package', amount: 'amount',
  next_follow_up_at: 'next_follow_up_at', last_activity_at: 'last_activity_at',
  phones: 'phones', phone_dnc: 'phone_dnc', phone_line_type: 'phone_line_type',
  phone_source: 'phone_source', phone_confidence: 'phone_confidence', email_source: 'email_source',
  enriched_at: 'enriched_at', stage: 'stage', next_action: 'next_action',
};
const ALIASES = { contact_name: 'contact', best_package: 'package' };
const NON_DATA = new Set([...Object.keys(COLUMN_MAP), ...Object.keys(ALIASES), ...SYSTEM_KEYS, 'pipeline_status', 'data', 'meta', 'org_id']);

const str = (v) => (v == null ? '' : String(v).trim());
const strRaw = (v) => (v == null ? '' : String(v));
const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
function isoOrNull(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * API lead -> PostgREST row (no id/created_at/updated_at; those are server-owned).
 * `legacy_id` is only set when `opts.legacyId` is provided (migration / explicit ids).
 */
export function leadToRow(l, { orgId = null } = {}) {
  const lists = leadListsOf(l);
  const status = l.status != null && l.status !== '' ? String(l.status) : 'New';
  const stage = normStage(l.stage) || deriveStage(l);
  const data = {};
  for (const [k, v] of Object.entries(l)) {
    if (NON_DATA.has(k) || v === undefined) continue;
    data[k] = v;
  }
  const raw = {};
  const row = {
    name: str(l.name) || '(unnamed)',
    city: str(l.city),
    address: strRaw(l.address) || null,
    zip: strRaw(l.zip) || null,
    parcel_id: str(l.parcel_id) || null,
    industry: str(l.industry),
    lead_type: str(l.lead_type) || 'website',
    list: String(lists[0] || l.list || 'Website'),
    lists,
    phone: str(l.phone),
    website: str(l.website),
    email: str(l.email),
    contact_name: str(l.contact ?? l.contact_name),
    owner: str(l.owner),
    status,
    pipeline_status: pipelineFromStage(stage),
    notes: strRaw(l.notes),
    source: str(l.source),
    custom_type: str(l.custom_type),
    best_package: str(l.package ?? l.best_package),
    amount: numOrNull(l.amount),
    phones: Array.isArray(l.phones) ? l.phones : [],
    phone_dnc: typeof l.phone_dnc === 'boolean' ? l.phone_dnc : null,
    phone_line_type: str(l.phone_line_type) || null,
    phone_source: str(l.phone_source) || null,
    phone_confidence: numOrNull(l.phone_confidence),
    email_source: str(l.email_source) || null,
    stage,
    next_action: cleanNextAction(l.next_action),
  };
  for (const f of TS_FIELDS) {
    const iso = isoOrNull(l[f]);
    row[f] = iso;
    if (l[f] != null && l[f] !== '' && (iso == null || String(l[f]) !== iso)) raw[f] = l[f];
  }
  if (Object.keys(raw).length) data.raw = raw;
  row.data = data;
  if (orgId) row.org_id = orgId;
  if (l.deleted_at !== undefined) row.deleted_at = l.deleted_at || null;
  return row;
}

/** PostgREST row -> API lead. */
export function rowToLead(row) {
  const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? { ...row.data } : {};
  const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : {};
  const raw = data.raw && typeof data.raw === 'object' ? data.raw : {};
  delete data.raw;
  for (const k of ['company', 'categories', 'list_status', 'lists_touched']) {
    if (data[k] === undefined && meta[k] !== undefined) data[k] = meta[k];
  }
  const lists = Array.isArray(row.lists) && row.lists.length ? row.lists : [row.list].filter(Boolean);
  const legacy = row.legacy_id;
  const id =
    legacy != null && legacy !== ''
      ? /^[0-9]{1,15}$/.test(String(legacy)) ? Number(legacy) : String(legacy)
      : row.id;
  const tsOut = (f) => {
    const col = row[f];
    const r = raw[f];
    if (r !== undefined && (col == null || Date.parse(r) === Date.parse(col))) return r;
    return col ?? null;
  };
  const lead = {
    ...data,
    id,
    uuid: row.id,
    name: row.name || '',
    city: row.city || '',
    address: row.address || '',
    zip: row.zip || '',
    parcel_id: row.parcel_id || '',
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
    pipeline_status: row.pipeline_status || pipelineFromStage(row.stage),
    notes: row.notes || '',
    source: row.source || '',
    custom_type: row.custom_type || '',
    package: row.best_package || '',
    amount: row.amount != null ? row.amount : '',
    next_follow_up_at: tsOut('next_follow_up_at') || '',
    last_activity_at: tsOut('last_activity_at'),
    phones: Array.isArray(row.phones) ? row.phones : [],
    phone_dnc: typeof row.phone_dnc === 'boolean' ? row.phone_dnc : null,
    phone_line_type: row.phone_line_type || '',
    phone_source: row.phone_source || '',
    phone_confidence: row.phone_confidence != null ? Number(row.phone_confidence) : null,
    email_source: row.email_source || '',
    enriched_at: tsOut('enriched_at'),
    stage: normStage(row.stage) || 'new',
    next_action: row.next_action && typeof row.next_action === 'object' ? row.next_action : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (row.deleted_at) lead.deleted_at = row.deleted_at;
  return lead;
}

/** Stable signature of what would be written; used to skip no-op updates. */
export function rowSignature(row) {
  const { org_id, ...rest } = row; // eslint-disable-line no-unused-vars
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    return v;
  };
  return JSON.stringify(sort(rest));
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Plan an upsert of `incoming` onto `existing` (both API-shaped leads).
 * Pure: returns what to insert/update, plus counts. `existing` is not mutated.
 * @returns {{
 *   inserts: object[], updates: {prev:object,next:object,stageChange:{from:string,to:string}|null,via:string}[],
 *   counts: {insert:number, update:number, skip_noop:number, skip_invalid:number, skip_deleted:number, conflict:number},
 *   conflicts: {name:string, reason:string}[],
 *   matched: object[]   // final lead for every valid incoming row (used by replace/prune)
 * }}
 */
export function planUpsert(existing, incoming, { replace = false, skipStale = false } = {}) {
  const index = new LeadIndex(existing);
  const touched = new Map(); // entry -> {prev, isNew}
  const counts = { insert: 0, update: 0, skip_noop: 0, skip_invalid: 0, skip_deleted: 0, conflict: 0 };
  const conflicts = [];
  const seenNoop = new Set();
  const matched = new Set();

  for (const raw of incoming || []) {
    if (!raw || typeof raw !== 'object' || !str(raw.name)) {
      counts.skip_invalid += 1;
      continue;
    }
    const { entry, conflict } = index.find(raw);
    if (entry) matched.add(entry);
    if (conflict) {
      counts.conflict += 1;
      conflicts.push({ name: str(raw.name), reason: conflict });
    }
    if (!entry) {
      const fresh = mergeLead({}, { ...raw }, {});
      for (const k of SYSTEM_KEYS) delete fresh[k];
      if (raw.id != null && raw.id !== '' && !isUuid(raw.id)) fresh.client_id = raw.id; // provenance only
      fresh.stage = normStage(raw.stage) || deriveStage(fresh);
      const e = index.add(fresh);
      matched.add(e);
      touched.set(e, { prev: null, isNew: true });
      continue;
    }
    if (entry.lead.deleted_at && raw.restore !== true) {
      counts.skip_deleted += 1;
      continue;
    }
    const prev = entry.lead;
    let next = mergeLead(prev, raw, { replace, skipStale });
    if (entry.lead.deleted_at && raw.restore === true) next = { ...next, deleted_at: null };
    entry.lead = next;
    index.reindex(entry);
    if (!touched.has(entry)) touched.set(entry, { prev, isNew: false });
  }

  const inserts = [];
  const updates = [];
  for (const [entry, info] of touched) {
    if (info.isNew) {
      inserts.push(entry.lead);
      counts.insert += 1;
      continue;
    }
    const a = rowSignature(leadToRow(info.prev));
    const b = rowSignature(leadToRow(entry.lead));
    if (a === b && !!info.prev.deleted_at === !!entry.lead.deleted_at) {
      seenNoop.add(entry);
      continue;
    }
    const from = normStage(info.prev.stage) || 'new';
    const to = normStage(entry.lead.stage) || 'new';
    updates.push({ prev: info.prev, next: entry.lead, stageChange: from !== to ? { from, to } : null });
    counts.update += 1;
  }
  counts.skip_noop = seenNoop.size;
  return { inserts, updates, counts, conflicts, matched: [...matched].map((e) => e.lead) };
}

/** Storage-blob path: apply a plan to the legacy `{leads}` array, assigning numeric ids. */
export function applyPlanToStoreLeads(existing, plan) {
  const byRef = new Map(plan.updates.map((u) => [u.prev, u.next]));
  const leads = existing.map((l) => byRef.get(l) || l);
  let nextId = existing.reduce((m, l) => Math.max(m, Number(l?.id) || 0), 0) + 1;
  for (const l of plan.inserts) {
    const copy = { ...l };
    delete copy.client_id;
    copy.id = nextId;
    nextId += 1;
    leads.push(copy);
  }
  return leads;
}
