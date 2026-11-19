/**
 * Estimates -> proposal -> acceptance -> job -> invoice record.
 *
 * Authenticated actions are dispatched from api/academy-leads.js (runEstimateAction); the
 * three customer-facing actions from api/leads.js (publicProposalGet/Accept/Decline).
 * Postgres only (public.lead_estimates / public.lead_jobs from fsi/sql/017 + 020).
 * No payment processing: invoice fields are a record only and card-like numbers are refused.
 *
 * Contract: docs/handoff/G.md.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import catalog from '../../public/crm/docs/estimate_catalog.json' with { type: 'json' };
import { restGet, restInsert, restPatch } from './supabase-rest.js';
import { LeadsError, pgResolveLeadRow, resolveOrgId } from './academy-pg.js';
import { pipelineFromStage } from './leads-core.js';

const ENC = encodeURIComponent;
const MAX_LINES = 30;
const MAX_QTY = 100;
const MAX_UNIT_PRICE = 250000;
const MAX_DISCOUNT_RATIO = 1; // discount can never exceed the subtotal

export const ESTIMATE_ACTIONS = [
  'estimate_catalog', 'estimate_create', 'estimate_update', 'estimate_list', 'estimate_get',
  'estimate_send', 'estimate_void', 'job_create_from_estimate', 'job_update', 'invoice_mark', 'jobs_list',
];
export const JOB_STATUSES = ['scheduled', 'in_progress', 'complete', 'cancelled'];
export const INVOICE_STATUSES = ['unbilled', 'sent', 'paid'];

// ---------------------------------------------------------------------------
// Clock + small helpers
// ---------------------------------------------------------------------------

let clock = () => new Date();
/** Test hook. */
export function _setClock(fn) {
  clock = fn || (() => new Date());
}
const nowIso = () => clock().toISOString();

/** Calendar day in the business timezone, YYYY-MM-DD. */
export function todayNY(d = clock()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

const cents = (n) => Math.round(Number(n) * 100);
const dollars = (c) => c / 100;
const clip = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

function luhn(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
/** True when the text contains a Luhn-valid 13-19 digit run (payment card number). */
export function looksLikeCardNumber(text) {
  const s = String(text ?? '');
  const m = s.match(/(?:\d[ -]?){13,19}/g) || [];
  return m.some((run) => {
    const d = run.replace(/\D/g, '');
    return d.length >= 13 && d.length <= 19 && luhn(d);
  });
}

/** Free text from a client: trimmed, length-capped, and never a card number. */
function text(v, max, field) {
  const s = clip(v, max);
  if (s && looksLikeCardNumber(s)) {
    throw new LeadsError(400, 'payment_data_not_accepted', `${field} looks like a payment card number. This system never stores card data.`);
  }
  return s;
}

const PAYMENT_KEY_RE = /(card|cvv|cvc|routing|account_?number|iban|ssn|bank)/i;
function rejectPaymentKeys(body) {
  for (const k of Object.keys(body || {})) {
    if (PAYMENT_KEY_RE.test(k)) throw new LeadsError(400, 'payment_data_not_accepted', `Field "${k}" is not accepted. This system records invoices only; it never stores payment details.`);
  }
}

const sha = (s) => createHash('sha256').update(String(s)).digest();
/** Constant-time string equality (hashes first so lengths never leak). */
export function safeEqual(a, b) {
  return timingSafeEqual(sha(a), sha(b));
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** 32 random bytes, base64url: 43 chars, 256 bits, URL-safe, not derived from any record data. */
export function mintToken() {
  return randomBytes(32).toString('base64url');
}
export const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;
export const isTokenShape = (t) => typeof t === 'string' && TOKEN_RE.test(t);
/** Stable, non-reversible handle for rate-limit buckets (so the raw token is never a map key or log value). */
export const tokenHandle = (t) => createHash('sha256').update(String(t)).digest('hex').slice(0, 24);

export function publicBaseUrl() {
  return String(process.env.ESTIMATE_PUBLIC_BASE_URL || 'https://crm.floguardfl.com').replace(/\/+$/, '');
}
export const publicUrl = (token) => `${publicBaseUrl()}/proposal/${token}`;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const itemById = new Map(catalog.items.map((i) => [i.id, i]));

export function catalogForClient() {
  return {
    version: catalog.version,
    price_rule: catalog.price_rule,
    business: catalog.business,
    items: catalog.items,
    unpriced_service_lines: catalog.unpriced_service_lines,
    custom_line: catalog.custom_line,
    included: catalog.included,
    disclaimers: catalog.disclaimers,
    terms_placeholder: termsArePlaceholder(termsText()),
    consent_text: catalog.acceptance.consent_text,
    default_valid_days: defaultValidDays(),
  };
}

export const defaultValidDays = () => {
  const n = Number(process.env.ESTIMATE_DEFAULT_VALID_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 30;
};

/** Terms snapshot text: the catalog's terms, deposit and warranty blocks. Placeholders stay placeholders. */
export function termsText() {
  const t = catalog.terms;
  return [t.text, t.deposit, t.warranty].filter(Boolean).join('\n\n');
}
export const termsArePlaceholder = (s) => /\[\[/.test(String(s || ''));

// ---------------------------------------------------------------------------
// Line items + totals (the only place totals are computed; client totals are ignored)
// ---------------------------------------------------------------------------

const PER_FOOT_RE = /(per|\/)\s*(linear\s*)?(foot|feet|ft|lf)\b|\bper\s*l\.?f\b|\$\s*\d+(\.\d+)?\s*\/\s*(ft|lf|foot)/i;

/**
 * Validate and normalise line items; compute every amount server-side.
 * @returns {{items: object[], subtotal: number, out_of_band: boolean}}
 */
export function priceLineItems(input) {
  if (input == null) input = [];
  if (!Array.isArray(input)) throw new LeadsError(400, 'invalid_line_items', 'line_items must be an array.');
  if (input.length > MAX_LINES) throw new LeadsError(400, 'invalid_line_items', `At most ${MAX_LINES} line items.`);
  let subtotal = 0;
  let outOfBand = false;
  const items = input.map((raw, i) => {
    const at = `line ${i + 1}`;
    if (!raw || typeof raw !== 'object') throw new LeadsError(400, 'invalid_line_items', `${at}: must be an object.`);
    const catId = raw.catalog_id == null || raw.catalog_id === '' ? null : String(raw.catalog_id);
    const cat = catId ? itemById.get(catId) : null;
    if (catId && !cat) throw new LeadsError(400, 'unknown_catalog_item', `${at}: catalog item "${catId}" does not exist.`);
    const qty = Number(raw.quantity ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new LeadsError(400, 'invalid_quantity', `${at}: quantity must be a whole number from 1 to ${MAX_QTY}.`);
    const price = Number(raw.unit_price);
    if (raw.unit_price == null || raw.unit_price === '' || !Number.isFinite(price) || price < 0 || price > MAX_UNIT_PRICE) {
      throw new LeadsError(400, 'invalid_unit_price', `${at}: unit_price must be a number from 0 to ${MAX_UNIT_PRICE}.`);
    }
    const priceC = cents(price);
    const description = text(raw.description || cat?.default_description || '', 800, `${at} description`);
    if (!description) throw new LeadsError(400, 'description_required', `${at}: description is required.`);
    if (PER_FOOT_RE.test(description)) {
      throw new LeadsError(400, 'per_foot_pricing_not_allowed', `${at}: FloGuard never prices per foot. Quote a band-priced system.`);
    }
    const reason = text(raw.band_override_reason, 500, `${at} band_override_reason`);
    let out = false;
    if (cat) {
      out = priceC < cents(cat.band_low) || priceC > cents(cat.band_high);
      if (out && reason.length < 5) {
        throw new LeadsError(400, 'band_override_required', `${at}: $${price} is outside the $${cat.band_low}-$${cat.band_high} band for "${cat.name}". Add a band_override_reason.`, { line: i });
      }
    } else {
      out = true; // not priced in the pricing doc: always needs the owner-confirmed basis
      if (reason.length < 5) {
        throw new LeadsError(400, 'band_override_required', `${at}: custom lines are not in the pricing doc. Add a band_override_reason (the basis for this price).`, { line: i });
      }
    }
    if (out) outOfBand = true;
    const lineC = qty * priceC;
    subtotal += lineC;
    return {
      catalog_id: cat ? cat.id : null,
      name: cat ? cat.name : text(raw.name || 'Custom item', 120, `${at} name`),
      description,
      quantity: qty,
      unit: cat ? cat.unit : catalog.custom_line.unit,
      unit_price: dollars(priceC),
      total: dollars(lineC),
      band_low: cat ? cat.band_low : null,
      band_high: cat ? cat.band_high : null,
      out_of_band: out,
      band_override_reason: out ? reason : '',
    };
  });
  return { items, subtotal: dollars(subtotal), out_of_band: outOfBand };
}

/** subtotal/discount/total from items; discount is a dollar amount that needs a reason. */
export function computeTotals(inputItems, discountInput, discountReason) {
  const { items, subtotal, out_of_band } = priceLineItems(inputItems);
  const sc = cents(subtotal);
  let dc = 0;
  if (discountInput != null && discountInput !== '') {
    const d = Number(discountInput);
    if (!Number.isFinite(d) || d < 0) throw new LeadsError(400, 'invalid_discount', 'discount must be a dollar amount of 0 or more.');
    dc = cents(d);
  }
  if (dc > sc * MAX_DISCOUNT_RATIO) throw new LeadsError(400, 'invalid_discount', 'discount cannot exceed the subtotal.');
  if (dc > 0 && clip(discountReason, 300).length < 3) {
    throw new LeadsError(400, 'discount_reason_required', 'A discount needs a reason (the pricing doc has no discount policy; this is logged for the owner).');
  }
  return { items, subtotal, discount: dollars(dc), total: dollars(sc - dc), out_of_band };
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/** draft | sent | accepted | declined | expired | void. void and expired are derived. */
export function effectiveStatus(row, today = todayNY()) {
  if (row.voided_at) return 'void';
  if (row.status === 'sent' && row.valid_until && today > String(row.valid_until).slice(0, 10)) return 'expired';
  return row.status;
}

/** Drafts always show the catalog's current terms; sent estimates keep the snapshot taken at send. */
const liveTerms = (row) => (row.status === 'draft' ? termsText() : String(row.terms || ''));

function estimateOut(row) {
  const status = effectiveStatus(row);
  const sent = row.status !== 'draft' && !row.voided_at;
  return {
    id: row.id,
    lead_id: row.lead_id,
    number: row.number,
    status,
    stored_status: row.status,
    customer: row.customer || {},
    line_items: row.line_items || [],
    subtotal: Number(row.subtotal) || 0,
    discount: Number(row.discount) || 0,
    discount_reason: row.discount_reason || '',
    total: Number(row.total) || 0,
    out_of_band: (row.line_items || []).some((l) => l.out_of_band),
    notes_to_customer: row.scope_notes || '',
    internal_notes: row.internal_notes || '',
    terms: liveTerms(row),
    terms_placeholder: termsArePlaceholder(liveTerms(row)),
    valid_until: row.valid_until ? String(row.valid_until).slice(0, 10) : null,
    public_url: sent && row.public_token ? publicUrl(row.public_token) : null,
    sent_at: row.sent_at || null,
    sent_by: row.sent_by || null,
    viewed_at: row.viewed_at || null,
    view_count: Number(row.view_count) || 0,
    accepted_at: row.accepted_at || null,
    accepted_name: row.accepted_name || null,
    accepted_ip: row.accepted_ip || null,
    declined_at: row.declined_at || null,
    decline_reason: row.decline_reason || '',
    voided_at: row.voided_at || null,
    void_reason: row.void_reason || '',
    created_by: row.created_by || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function jobOut(row) {
  return {
    id: row.id,
    lead_id: row.lead_id,
    estimate_id: row.estimate_id || null,
    status: row.status,
    scheduled_for: row.scheduled_for || null,
    completed_at: row.completed_at || null,
    invoice_number: row.invoice_number || '',
    invoice_total: row.invoice_total == null ? null : Number(row.invoice_total),
    invoice_status: row.invoice_status || 'unbilled',
    invoice_sent_at: row.invoice_sent_at || null,
    paid_at: row.paid_at || null,
    notes: row.notes || '',
    created_by: row.created_by || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * The ONLY shape the customer-facing endpoint returns. Built from an explicit whitelist so a new
 * column can never leak by accident: no lead data, no internal notes, no scores, no claim/FSI data,
 * no band/discount reasons, no IP/UA, no ids.
 */
export function toPublicProposal(row) {
  const status = effectiveStatus(row);
  const cust = row.customer && typeof row.customer === 'object' ? row.customer : {};
  const terms = liveTerms(row);
  const discIds = new Set();
  for (const l of row.line_items || []) {
    const c = l.catalog_id ? itemById.get(l.catalog_id) : null;
    for (const id of c?.disclaimer_ids || []) discIds.add(id);
  }
  return {
    number: row.number,
    status,
    can_accept: status === 'sent',
    business: {
      name: catalog.business.name,
      tagline: catalog.business.tagline,
      address: catalog.business.address,
      phone: catalog.business.phone,
      phone_href: catalog.business.phone_href,
      email: catalog.business.email,
      website: catalog.business.website,
      hours: catalog.business.hours,
      license_line: catalog.business.license_line,
    },
    customer: { name: clip(cust.name, 160), address: clip(cust.address, 240) },
    line_items: (row.line_items || []).map((l) => ({
      description: String(l.description || ''),
      quantity: Number(l.quantity) || 1,
      unit: String(l.unit || 'each'),
      unit_price: Number(l.unit_price) || 0,
      total: Number(l.total) || 0,
    })),
    subtotal: Number(row.subtotal) || 0,
    discount: Number(row.discount) || 0,
    total: Number(row.total) || 0,
    notes: row.scope_notes || '',
    included: catalog.included.map((i) => i.text),
    disclaimers: catalog.disclaimers.filter((d) => discIds.size === 0 || discIds.has(d.id)).map((d) => d.text),
    terms: { text: terms, placeholder: termsArePlaceholder(terms) },
    consent_text: catalog.acceptance.consent_text,
    valid_until: row.valid_until ? String(row.valid_until).slice(0, 10) : null,
    sent_at: row.sent_at || null,
    accepted_at: row.accepted_at || null,
    accepted_name: row.accepted_name || null,
    declined_at: row.declined_at || null,
  };
}

// ---------------------------------------------------------------------------
// Readiness (Postgres tables + 020 columns)
// ---------------------------------------------------------------------------

let _ready = null;
let _readyAt = 0;
export function _resetEstimatesReadyCache() {
  _ready = null;
  _readyAt = 0;
}
export async function estimatesReady() {
  const t = Date.now();
  if (_ready != null && t - _readyAt < 30_000) return _ready;
  try {
    await restGet('lead_estimates', 'select=id,org_id,viewed_at,voided_at,customer&limit=1');
    await restGet('lead_jobs', 'select=id,org_id,invoice_sent_at&limit=1');
    _ready = true;
  } catch {
    _ready = false;
  }
  _readyAt = t;
  return _ready;
}
async function requireReady() {
  if (!(await estimatesReady())) {
    throw new LeadsError(503, 'estimates_not_ready', 'Estimates need fsi/sql/017_leads_pipeline.sql and fsi/sql/020_estimates_additions.sql applied.');
  }
}

async function orgIdOrNull() {
  try {
    return await resolveOrgId();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Activity + stage
// ---------------------------------------------------------------------------

async function logActivity(leadId, actor, body, meta, type = 'system') {
  try {
    await restInsert('lead_activity', { lead_id: leadId, actor: String(actor).slice(0, 80), type, body: String(body).slice(0, 5000), meta: meta || {} });
  } catch (e) {
    console.warn('[estimates] activity write failed:', e?.message);
  }
}

/** Move the lead forward (never back from won). Returns {from,to} or null. */
async function advanceStage(leadId, to, actor, meta) {
  const rows = await restGet('leads', `select=id,stage&id=eq.${ENC(leadId)}&limit=1`);
  const row = rows?.[0];
  if (!row) return null;
  const from = row.stage || 'new';
  if (from === to) return null;
  if (from === 'won') return null;
  if (to === 'estimate_sent' && from === 'estimate_sent') return null;
  await restPatch('leads', `id=eq.${ENC(leadId)}`, { stage: to, pipeline_status: pipelineFromStage(to) });
  await logActivity(leadId, actor, `Stage: ${from} -> ${to}`, { from, to, via: 'estimate', ...meta }, 'stage_change');
  return { from, to };
}

// ---------------------------------------------------------------------------
// Authenticated actions
// ---------------------------------------------------------------------------

function leadAddress(lead) {
  const tail = [lead.city, lead.zip].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  return [String(lead.address || '').trim(), tail].filter(Boolean).join(', ');
}

function customerFrom(lead, over) {
  const o = over && typeof over === 'object' ? over : {};
  return {
    name: text(o.name ?? lead.name, 160, 'customer name'),
    address: text(o.address ?? leadAddress(lead), 240, 'customer address'),
  };
}

function checkValidUntil(v) {
  if (v == null || v === '') return null;
  if (!isYmd(String(v))) throw new LeadsError(400, 'invalid_valid_until', 'valid_until must be a date like 2026-12-19.');
  if (String(v) < todayNY()) throw new LeadsError(400, 'invalid_valid_until', 'valid_until cannot be in the past.');
  if (String(v) > addDays(todayNY(), 365)) throw new LeadsError(400, 'invalid_valid_until', 'valid_until cannot be more than a year out.');
  return String(v);
}

const isDup = (e) => e?.status === 409 || /duplicate|23505|unique/i.test(String(e?.message || '') + JSON.stringify(e?.body || ''));

/** Next FG-YYYY-NNNN for the org. Sequential per org and year; retries on a unique-index collision. */
export async function nextEstimateNumber(orgId, skip = 0) {
  const year = todayNY().slice(0, 4);
  const q = `select=number&order=number.desc&limit=20${orgId ? `&org_id=eq.${ENC(orgId)}` : ''}`;
  const rows = (await restGet('lead_estimates', q)) || [];
  let max = 0;
  const re = new RegExp(`^FG-${year}-(\\d{4,})$`);
  for (const r of rows) {
    const m = String(r.number || '').match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `FG-${year}-${String(max + 1 + skip).padStart(4, '0')}`;
}

async function loadEstimate(id, { orgId } = {}) {
  const s = String(id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new LeadsError(400, 'estimate_id_required', 'estimate_id (uuid) is required.');
  const rows = await restGet('lead_estimates', `select=*&id=eq.${ENC(s)}&limit=1`);
  const row = rows?.[0];
  const org = orgId === undefined ? await orgIdOrNull() : orgId;
  if (!row || (row.org_id && org && row.org_id !== org)) throw new LeadsError(404, 'not_found', `Estimate ${s} not found.`);
  return row;
}

async function loadJob(id) {
  const s = String(id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new LeadsError(400, 'job_id_required', 'job_id (uuid) is required.');
  const rows = await restGet('lead_jobs', `select=*&id=eq.${ENC(s)}&limit=1`);
  const row = rows?.[0];
  const org = await orgIdOrNull();
  if (!row || (row.org_id && org && row.org_id !== org)) throw new LeadsError(404, 'not_found', `Job ${s} not found.`);
  return row;
}

async function createEstimate(body, { actor }) {
  const lead = await pgResolveLeadRow(body.lead_id ?? body.id ?? body.uuid);
  const orgId = lead.org_id || (await orgIdOrNull());
  const priced = computeTotals(body.line_items, body.discount, body.discount_reason);
  const validUntil = checkValidUntil(body.valid_until);
  const base = {
    lead_id: lead.id,
    org_id: orgId,
    status: 'draft',
    line_items: priced.items,
    subtotal: priced.subtotal,
    discount: priced.discount,
    total: priced.total,
    discount_reason: text(body.discount_reason, 300, 'discount_reason') || null,
    terms: termsText(),
    valid_until: validUntil,
    public_token: mintToken(),
    customer: customerFrom(lead, body.customer),
    scope_notes: text(body.notes_to_customer, 3000, 'notes_to_customer') || null,
    internal_notes: text(body.internal_notes, 3000, 'internal_notes') || null,
    created_by: String(actor).slice(0, 80),
    updated_at: nowIso(),
  };
  let row = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 6 && !row; attempt++) {
    const number = await nextEstimateNumber(orgId, attempt > 2 ? attempt : 0);
    try {
      const out = await restInsert('lead_estimates', { ...base, number });
      row = Array.isArray(out) ? out[0] : out;
    } catch (e) {
      lastErr = e;
      if (!isDup(e)) throw e;
    }
  }
  if (!row) throw new LeadsError(503, 'number_allocation_failed', `Could not allocate an estimate number: ${String(lastErr?.message || '').slice(0, 120)}`);
  await logActivity(lead.id, actor, `Estimate ${row.number} drafted`, { event: 'estimate_created', estimate_id: row.id, number: row.number });
  return { estimate: estimateOut(row), proposal: toPublicProposal(row) };
}

async function updateEstimate(body, { actor }) {
  const row = await loadEstimate(body.estimate_id ?? body.id);
  if (effectiveStatus(row) !== 'draft') {
    throw new LeadsError(409, 'not_draft', `Estimate ${row.number} is ${effectiveStatus(row)}; only drafts can be edited. Void it and create a new one.`);
  }
  const patch = {};
  const lines = body.line_items !== undefined ? body.line_items : row.line_items;
  const discount = body.discount !== undefined ? body.discount : row.discount;
  const reason = body.discount_reason !== undefined ? body.discount_reason : row.discount_reason;
  if (body.line_items !== undefined || body.discount !== undefined || body.discount_reason !== undefined) {
    const p = computeTotals(lines, discount, reason);
    patch.line_items = p.items;
    patch.subtotal = p.subtotal;
    patch.discount = p.discount;
    patch.total = p.total;
    patch.discount_reason = text(reason, 300, 'discount_reason') || null;
  }
  if (body.valid_until !== undefined) patch.valid_until = checkValidUntil(body.valid_until);
  if (body.notes_to_customer !== undefined) patch.scope_notes = text(body.notes_to_customer, 3000, 'notes_to_customer') || null;
  if (body.internal_notes !== undefined) patch.internal_notes = text(body.internal_notes, 3000, 'internal_notes') || null;
  if (body.customer !== undefined) {
    patch.customer = {
      name: text(body.customer?.name ?? row.customer?.name, 160, 'customer name'),
      address: text(body.customer?.address ?? row.customer?.address, 240, 'customer address'),
    };
  }
  patch.updated_at = nowIso();
  let filter = `id=eq.${ENC(row.id)}&status=eq.draft&voided_at=is.null`;
  if (body.updated_at) filter += `&updated_at=eq.${ENC(body.updated_at)}`;
  const out = await restPatch('lead_estimates', filter, patch);
  const saved = Array.isArray(out) ? out[0] : out;
  if (!saved) {
    const fresh = await loadEstimate(row.id);
    throw new LeadsError(409, 'conflict', 'The estimate changed since you loaded it (or is no longer a draft).', { estimate: estimateOut(fresh) });
  }
  return { estimate: estimateOut(saved), proposal: toPublicProposal(saved) };
}

async function listEstimates(body) {
  const lead = await pgResolveLeadRow(body.lead_id ?? body.id ?? body.uuid, { includeDeleted: true });
  const [est, jobs] = await Promise.all([
    restGet('lead_estimates', `select=*&lead_id=eq.${ENC(lead.id)}&order=created_at.desc&limit=100`),
    restGet('lead_jobs', `select=*&lead_id=eq.${ENC(lead.id)}&order=created_at.desc&limit=100`),
  ]);
  return { estimates: (est || []).map(estimateOut), jobs: (jobs || []).map(jobOut), count: (est || []).length };
}

async function getEstimate(body) {
  const row = await loadEstimate(body.estimate_id ?? body.id);
  const jobs = await restGet('lead_jobs', `select=*&estimate_id=eq.${ENC(row.id)}&limit=1`);
  return { estimate: estimateOut(row), proposal: toPublicProposal(row), job: jobs?.[0] ? jobOut(jobs[0]) : null };
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

/** Copy-ready customer message + mailto/sms links. Nothing is sent from the server. */
export function buildMessage({ lead, estimate, url }) {
  const first = String(estimate.customer?.name || lead?.name || '').trim().split(/\s+/)[0] || 'there';
  const biz = catalog.business;
  const valid = estimate.valid_until ? ` It is valid through ${estimate.valid_until}.` : '';
  const total = `$${estimate.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const subject = `Your FloGuard drainage estimate ${estimate.number}`;
  const bodyEmail = [
    `Hi ${first},`,
    '',
    `Your FloGuard estimate ${estimate.number} (${total}) is ready. You can review it and accept it online here:`,
    url,
    `${valid.trim()}`.trim(),
    '',
    `Questions? Call us at ${biz.phone}.`,
    '',
    `${biz.name} | ${biz.phone} | ${biz.website}`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  const sms = `Hi ${first}, your FloGuard estimate ${estimate.number} is ready to review and accept: ${url} Questions? Call ${biz.phone}.`;
  const email = String(lead?.email || '').trim();
  const phone = digitsOnly(lead?.phone);
  const dnc = lead?.phone_dnc === true;
  return {
    subject,
    body: bodyEmail,
    sms,
    links: {
      mailto: email ? `mailto:${email}?subject=${ENC(subject)}&body=${ENC(bodyEmail)}` : null,
      sms: phone && !dnc ? `sms:${phone}?&body=${ENC(sms)}` : null,
    },
    to: { email: email || null, phone: phone ? (lead.phone || null) : null, phone_dnc: dnc },
  };
}

async function sendEstimate(body, { actor }) {
  const row = await loadEstimate(body.estimate_id ?? body.id);
  const status = effectiveStatus(row);
  if (status === 'void') throw new LeadsError(409, 'voided', `Estimate ${row.number} is void.`);
  if (status === 'accepted') throw new LeadsError(409, 'already_accepted', `Estimate ${row.number} was already accepted.`);
  if (status === 'declined') throw new LeadsError(409, 'declined', `Estimate ${row.number} was declined. Create a new estimate to re-quote.`);
  const lines = row.line_items || [];
  if (!lines.length || !(Number(row.total) > 0)) throw new LeadsError(400, 'estimate_incomplete', 'Add at least one line item with a total above $0 before sending.');
  if (!String(row.customer?.name || '').trim()) throw new LeadsError(400, 'estimate_incomplete', 'The customer name is required before sending.');
  const today = todayNY();
  let validUntil = body.valid_until !== undefined && body.valid_until !== '' ? checkValidUntil(body.valid_until) : row.valid_until ? String(row.valid_until).slice(0, 10) : addDays(today, defaultValidDays());
  if (validUntil < today) {
    if (status === 'expired') throw new LeadsError(400, 'valid_until_required', 'This estimate expired. Send again with a new valid_until date.');
    validUntil = addDays(today, defaultValidDays());
  }
  const first = row.status === 'draft';
  const patch = {
    status: 'sent',
    valid_until: validUntil,
    terms: termsText(),
    sent_by: String(actor).slice(0, 80),
    updated_at: nowIso(),
  };
  if (first) {
    patch.public_token = mintToken();
    patch.token_issued_at = nowIso();
    patch.sent_at = nowIso();
  }
  const out = await restPatch('lead_estimates', `id=eq.${ENC(row.id)}&voided_at=is.null&status=in.(draft,sent)`, patch);
  const saved = Array.isArray(out) ? out[0] : out;
  if (!saved) throw new LeadsError(409, 'conflict', 'The estimate changed while sending. Reload and try again.');
  const estimate = estimateOut(saved);
  const lead = await pgResolveLeadRow(saved.lead_id, { includeDeleted: true });
  await logActivity(saved.lead_id, actor, `Estimate ${saved.number} ${first ? 'sent (link created)' : 're-sent'}: $${estimate.total}`, { event: first ? 'estimate_sent' : 'estimate_resent', estimate_id: saved.id, number: saved.number, total: estimate.total });
  const moved = await advanceStage(saved.lead_id, 'estimate_sent', actor, { estimate_id: saved.id });
  const message = buildMessage({ lead, estimate, url: estimate.public_url });
  const warnings = [];
  if (estimate.terms_placeholder) warnings.push('terms_placeholder');
  if (estimate.out_of_band) warnings.push('out_of_band');
  if (message.to.phone_dnc) warnings.push('phone_dnc');
  if (!message.links.mailto) warnings.push('no_email');
  if (!message.links.sms && !message.to.phone_dnc) warnings.push('no_phone');
  return { estimate, public_url: estimate.public_url, message, links: message.links, warnings, stage: moved };
}

async function voidEstimate(body, { actor }) {
  const row = await loadEstimate(body.estimate_id ?? body.id);
  if (row.voided_at) return { estimate: estimateOut(row), already_void: true };
  if (row.status === 'accepted') throw new LeadsError(409, 'already_accepted', `Estimate ${row.number} was accepted; it cannot be voided. Cancel the job instead.`);
  const reason = text(body.reason, 300, 'reason');
  if (reason.length < 3) throw new LeadsError(400, 'reason_required', 'A reason is required to void an estimate.');
  const out = await restPatch('lead_estimates', `id=eq.${ENC(row.id)}&voided_at=is.null&status=in.(draft,sent,declined)`, { voided_at: nowIso(), void_reason: reason, updated_at: nowIso() });
  const saved = Array.isArray(out) ? out[0] : out;
  if (!saved) throw new LeadsError(409, 'conflict', 'The estimate changed while voiding. Reload and try again.');
  await logActivity(saved.lead_id, actor, `Estimate ${saved.number} voided: ${reason}`, { event: 'estimate_voided', estimate_id: saved.id });
  return { estimate: estimateOut(saved) };
}

function isoOrNull(v, field) {
  if (v == null || v === '') return null;
  if (Number.isNaN(Date.parse(v))) throw new LeadsError(400, 'invalid_date', `${field} must be an ISO date/time.`);
  return new Date(v).toISOString();
}

async function createJob(body, { actor }) {
  const row = await loadEstimate(body.estimate_id ?? body.id);
  if (row.voided_at) throw new LeadsError(409, 'voided', `Estimate ${row.number} is void.`);
  if (row.status !== 'accepted') throw new LeadsError(409, 'not_accepted', `Estimate ${row.number} has not been accepted by the customer yet.`);
  const existing = await restGet('lead_jobs', `select=*&estimate_id=eq.${ENC(row.id)}&limit=1`);
  if (existing?.[0]) return { job: jobOut(existing[0]), already_exists: true };
  let saved;
  try {
    const out = await restInsert('lead_jobs', {
      lead_id: row.lead_id,
      estimate_id: row.id,
      org_id: row.org_id || (await orgIdOrNull()),
      status: 'scheduled',
      scheduled_for: isoOrNull(body.scheduled_for, 'scheduled_for'),
      notes: text(body.notes, 3000, 'notes') || null,
      created_by: String(actor).slice(0, 80),
      updated_at: nowIso(),
    });
    saved = Array.isArray(out) ? out[0] : out;
  } catch (e) {
    if (!isDup(e)) throw e;
    const again = await restGet('lead_jobs', `select=*&estimate_id=eq.${ENC(row.id)}&limit=1`);
    if (again?.[0]) return { job: jobOut(again[0]), already_exists: true };
    throw e;
  }
  await logActivity(row.lead_id, actor, `Job created from estimate ${row.number}`, { event: 'job_created', estimate_id: row.id, job_id: saved.id });
  return { job: jobOut(saved), suggested_invoice_total: Number(row.total) || 0 };
}

async function updateJob(body, { actor }) {
  const row = await loadJob(body.job_id ?? body.id);
  const patch = {};
  if (body.status !== undefined) {
    const s = String(body.status).toLowerCase();
    if (!JOB_STATUSES.includes(s)) throw new LeadsError(400, 'invalid_status', `status must be one of ${JOB_STATUSES.join(', ')}.`);
    patch.status = s;
    if (s === 'complete' && body.completed_at === undefined && !row.completed_at) patch.completed_at = nowIso();
  }
  if (body.scheduled_for !== undefined) patch.scheduled_for = isoOrNull(body.scheduled_for, 'scheduled_for');
  if (body.completed_at !== undefined) patch.completed_at = isoOrNull(body.completed_at, 'completed_at');
  if (body.notes !== undefined) patch.notes = text(body.notes, 3000, 'notes') || null;
  if (!Object.keys(patch).length) throw new LeadsError(400, 'nothing_to_update', 'Send status, scheduled_for, completed_at or notes.');
  patch.updated_at = nowIso();
  const out = await restPatch('lead_jobs', `id=eq.${ENC(row.id)}`, patch);
  const saved = (Array.isArray(out) ? out[0] : out) || { ...row, ...patch };
  const bits = [];
  if (patch.status && patch.status !== row.status) bits.push(`status ${row.status} -> ${patch.status}`);
  if (patch.scheduled_for !== undefined && patch.scheduled_for !== row.scheduled_for) bits.push(`scheduled ${patch.scheduled_for || 'cleared'}`);
  if (patch.completed_at && patch.completed_at !== row.completed_at) bits.push('completed');
  if (bits.length) await logActivity(row.lead_id, actor, `Job updated: ${bits.join(', ')}`, { event: 'job_updated', job_id: row.id });
  return { job: jobOut(saved) };
}

const INVOICE_NO_RE = /^[A-Za-z0-9 #./_-]{1,40}$/;

async function markInvoice(body, { actor }) {
  rejectPaymentKeys(body);
  const row = await loadJob(body.job_id ?? body.id);
  const patch = {};
  if (body.invoice_number !== undefined) {
    const n = clip(body.invoice_number, 40);
    if (n && !INVOICE_NO_RE.test(n)) throw new LeadsError(400, 'invalid_invoice_number', 'invoice_number may use letters, digits, space and # . / _ - (max 40).');
    if (n && looksLikeCardNumber(n)) throw new LeadsError(400, 'payment_data_not_accepted', 'invoice_number looks like a card number.');
    patch.invoice_number = n || null;
  }
  if (body.invoice_total !== undefined && body.invoice_total !== null && body.invoice_total !== '') {
    const t = Number(body.invoice_total);
    if (!Number.isFinite(t) || t < 0 || t > 10_000_000) throw new LeadsError(400, 'invalid_invoice_total', 'invoice_total must be a dollar amount of 0 or more.');
    patch.invoice_total = dollars(cents(t));
  }
  let status = row.invoice_status || 'unbilled';
  if (body.invoice_status !== undefined) {
    status = String(body.invoice_status).toLowerCase();
    if (!INVOICE_STATUSES.includes(status)) throw new LeadsError(400, 'invalid_invoice_status', `invoice_status must be one of ${INVOICE_STATUSES.join(', ')}.`);
    patch.invoice_status = status;
  }
  const t = nowIso();
  if (status === 'sent' && !row.invoice_sent_at) patch.invoice_sent_at = isoOrNull(body.invoice_sent_at, 'invoice_sent_at') || t;
  if (status === 'paid') {
    patch.paid_at = isoOrNull(body.paid_at, 'paid_at') || row.paid_at || t;
    if (!row.invoice_sent_at && !patch.invoice_sent_at) patch.invoice_sent_at = patch.paid_at;
  } else if (body.paid_at !== undefined) {
    patch.paid_at = isoOrNull(body.paid_at, 'paid_at');
  }
  if (status !== 'unbilled' && patch.invoice_total === undefined && row.invoice_total == null && row.estimate_id) {
    const est = await restGet('lead_estimates', `select=total&id=eq.${ENC(row.estimate_id)}&limit=1`);
    if (est?.[0]) patch.invoice_total = Number(est[0].total) || 0;
  }
  if (!Object.keys(patch).length) throw new LeadsError(400, 'nothing_to_update', 'Send invoice_number, invoice_total, invoice_status or paid_at.');
  patch.updated_at = t;
  const out = await restPatch('lead_jobs', `id=eq.${ENC(row.id)}`, patch);
  const saved = (Array.isArray(out) ? out[0] : out) || { ...row, ...patch };
  await logActivity(row.lead_id, actor, `Invoice record: ${saved.invoice_number || '(no number)'} ${status}${saved.invoice_total != null ? ` $${saved.invoice_total}` : ''}`, { event: 'invoice_marked', job_id: row.id, invoice_status: status });
  return { job: jobOut(saved), note: 'Record only. No payment is processed or stored by this system.' };
}

async function listJobs(body) {
  const orgId = await orgIdOrNull();
  let q = 'select=*&order=created_at.desc&limit=200';
  if (body.lead_id ?? body.id ?? body.uuid) {
    const lead = await pgResolveLeadRow(body.lead_id ?? body.id ?? body.uuid, { includeDeleted: true });
    q += `&lead_id=eq.${ENC(lead.id)}`;
  } else if (orgId) q += `&org_id=eq.${ENC(orgId)}`;
  if (body.status) {
    const s = String(body.status).toLowerCase();
    if (!JOB_STATUSES.includes(s)) throw new LeadsError(400, 'invalid_status', `status must be one of ${JOB_STATUSES.join(', ')}.`);
    q += `&status=eq.${ENC(s)}`;
  }
  const jobs = (await restGet('lead_jobs', q)) || [];
  const estIds = [...new Set(jobs.map((j) => j.estimate_id).filter(Boolean))];
  const leadIds = [...new Set(jobs.map((j) => j.lead_id).filter(Boolean))];
  const [ests, leads] = await Promise.all([
    estIds.length ? restGet('lead_estimates', `select=id,number,total&id=in.(${estIds.map(ENC).join(',')})`) : [],
    leadIds.length ? restGet('leads', `select=id,name,address,city&id=in.(${leadIds.map(ENC).join(',')})`) : [],
  ]);
  const eMap = new Map((ests || []).map((e) => [e.id, e]));
  const lMap = new Map((leads || []).map((l) => [l.id, l]));
  return {
    jobs: jobs.map((j) => ({
      ...jobOut(j),
      estimate_number: eMap.get(j.estimate_id)?.number || null,
      estimate_total: eMap.get(j.estimate_id)?.total == null ? null : Number(eMap.get(j.estimate_id).total),
      lead_name: lMap.get(j.lead_id)?.name || null,
      lead_address: lMap.get(j.lead_id) ? leadAddress(lMap.get(j.lead_id)) : null,
    })),
    count: jobs.length,
  };
}

/** Dispatcher used by api/academy-leads.js. Throws LeadsError; the handler maps it to JSON. */
export async function runEstimateAction(action, body, ctx) {
  if (action === 'estimate_catalog') return { catalog: catalogForClient() };
  await requireReady();
  switch (action) {
    case 'estimate_create': return createEstimate(body, ctx);
    case 'estimate_update': return updateEstimate(body, ctx);
    case 'estimate_list': return listEstimates(body);
    case 'estimate_get': return getEstimate(body);
    case 'estimate_send': return sendEstimate(body, ctx);
    case 'estimate_void': return voidEstimate(body, ctx);
    case 'job_create_from_estimate': return createJob(body, ctx);
    case 'job_update': return updateJob(body, ctx);
    case 'invoice_mark': return markInvoice(body, ctx);
    case 'jobs_list': return listJobs(body);
    default: throw new LeadsError(400, 'unknown_action', `Unknown estimate action ${action}.`);
  }
}

// ---------------------------------------------------------------------------
// Public (customer) actions. Errors are deliberately uniform: null means "404 not_found".
// ---------------------------------------------------------------------------

async function rowByToken(token) {
  if (!isTokenShape(token)) return null;
  if (!(await estimatesReady())) return null;
  const rows = await restGet('lead_estimates', `select=*&public_token=eq.${ENC(token)}&limit=1`);
  const row = rows?.[0];
  if (!row || !row.public_token || !safeEqual(row.public_token, token)) return null;
  if (row.voided_at || row.status === 'draft') return null;
  return row;
}

/** @returns {Promise<{proposal: object}|null>} null = unknown/voided/draft (caller sends the same 404). */
export async function publicProposalGet(token, { preview = false } = {}) {
  const row = await rowByToken(token);
  if (!row) return null;
  if (!preview) {
    try {
      const first = !row.viewed_at;
      const patch = { view_count: (Number(row.view_count) || 0) + 1, updated_at: nowIso() };
      if (first) patch.viewed_at = nowIso();
      await restPatch('lead_estimates', `id=eq.${ENC(row.id)}`, patch);
      if (first) {
        row.viewed_at = patch.viewed_at;
        await logActivity(row.lead_id, 'customer', `Customer opened estimate ${row.number}`, { event: 'estimate_viewed', estimate_id: row.id });
      }
    } catch (e) {
      console.warn('[estimates] view tracking failed:', e?.message);
    }
  }
  return { proposal: toPublicProposal(row) };
}

function cleanName(v) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Idempotent acceptance. Returns null for unknown/voided/draft tokens.
 * Throws LeadsError for expired (410), declined (409), bad name/consent (400).
 */
export async function publicProposalAccept(token, { name, consent }, { ip, userAgent }) {
  let row = await rowByToken(token);
  if (!row) return null;
  for (let pass = 0; pass < 2; pass++) {
    const status = effectiveStatus(row);
    if (status === 'accepted') {
      return { ok: true, already_accepted: true, accepted_at: row.accepted_at, accepted_name: row.accepted_name, number: row.number, proposal: toPublicProposal(row), stage: null };
    }
    if (status === 'declined') throw new LeadsError(409, 'already_declined', 'This estimate was declined. Please call us if you would like to revisit it.');
    if (status === 'expired') throw new LeadsError(410, 'expired', 'This estimate has expired. Please call us for an updated estimate.');
    if (status !== 'sent') return null;
    const full = cleanName(name);
    if (consent !== true) throw new LeadsError(400, 'consent_required', 'Please tick the box to confirm.');
    if (full.length < 3 || full.split(' ').filter(Boolean).length < 2) throw new LeadsError(400, 'full_name_required', 'Please type your full name (first and last).');
    const stamp = nowIso();
    const out = await restPatch('lead_estimates', `id=eq.${ENC(row.id)}&status=eq.sent&accepted_at=is.null&voided_at=is.null`, {
      status: 'accepted',
      accepted_at: stamp,
      accepted_name: full,
      accepted_ip: String(ip || '').slice(0, 64) || null,
      accepted_ua: clip(userAgent, 300) || null,
      accepted_consent_text: catalog.acceptance.consent_text,
      updated_at: stamp,
    });
    const saved = Array.isArray(out) ? out[0] : out;
    if (saved) {
      await logActivity(saved.lead_id, 'customer', `Customer accepted estimate ${saved.number} ($${Number(saved.total)}) as "${full}"`, { event: 'estimate_accepted', estimate_id: saved.id, number: saved.number });
      const stage = await advanceStage(saved.lead_id, 'won', 'customer', { estimate_id: saved.id });
      return { ok: true, already_accepted: false, accepted_at: saved.accepted_at, accepted_name: saved.accepted_name, number: saved.number, proposal: toPublicProposal(saved), stage };
    }
    // lost a race (accepted/declined/voided in between): re-read and answer from the new state
    const rows = await restGet('lead_estimates', `select=*&id=eq.${ENC(row.id)}&limit=1`);
    row = rows?.[0];
    if (!row || row.voided_at) return null;
  }
  return null;
}

export async function publicProposalDecline(token, { reason }) {
  const row = await rowByToken(token);
  if (!row) return null;
  const status = effectiveStatus(row);
  if (status === 'declined') return { ok: true, already_declined: true, declined_at: row.declined_at, proposal: toPublicProposal(row) };
  if (status === 'accepted') throw new LeadsError(409, 'already_accepted', 'This estimate was already accepted. Please call us to make changes.');
  if (status === 'expired') throw new LeadsError(410, 'expired', 'This estimate has expired.');
  if (status !== 'sent') return null;
  const stamp = nowIso();
  const why = clip(reason, 500);
  const out = await restPatch('lead_estimates', `id=eq.${ENC(row.id)}&status=eq.sent&voided_at=is.null`, {
    status: 'declined', declined_at: stamp, decline_reason: why || null, updated_at: stamp,
  });
  const saved = Array.isArray(out) ? out[0] : out;
  if (!saved) {
    const rows = await restGet('lead_estimates', `select=*&id=eq.${ENC(row.id)}&limit=1`);
    const cur = rows?.[0];
    if (cur?.status === 'declined') return { ok: true, already_declined: true, declined_at: cur.declined_at, proposal: toPublicProposal(cur) };
    throw new LeadsError(409, 'conflict', 'This estimate just changed. Please reload.');
  }
  await logActivity(saved.lead_id, 'customer', `Customer declined estimate ${saved.number}${why ? `: ${why}` : ''}`, { event: 'estimate_declined', estimate_id: saved.id });
  return { ok: true, already_declined: false, declined_at: saved.declined_at, proposal: toPublicProposal(saved) };
}
