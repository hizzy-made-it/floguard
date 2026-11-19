/**
 * Contact enrichment for CRM leads (phone / email / website).
 *
 * Paths (in order when fields are still missing):
 *  1. Optional BatchData property skip-trace — best for residential tax-roll leads
 *     (BATCHDATA_API_KEY). Designed for owner name + site address.
 *  2. Free commercial path — DuckDuckGo website discovery + homepage/contact scrape.
 *  3. Free residential/directory path — DuckDuckGo HTML search snippets for phones.
 *  4. Optional Trestle verification (TRESTLE_API_KEY) of every candidate number:
 *     line type, activity score, TCPA litigator add-on, reverse-phone owner name.
 *     Trestle cannot discover phones (its Reverse Address returns names only), so it
 *     runs after the discovery paths, not instead of them.
 *
 * Output follows the shared lead contact contract (phones[], phone_dnc, ...).
 * Never invents contacts. Never overwrites non-empty lead fields (caller merges).
 * DNC / CAN-SPAM still apply after enrichment — scrub before dial/email.
 */

import { phoneIntel, reversePhone, trestleConfigured } from './trestle.js';

const USER_AGENT =
  'Mozilla/5.0 (compatible; FloGuardCRM-Enrich/1.0; +https://floguardfl.com)';

const EMAIL_RE = /\b([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})\b/gi;
const PHONE_RE =
  /(?<!\d)(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})(?!\d)/g;

const EMAIL_BLOCK_DOMAINS = new Set([
  'example.com',
  'example.org',
  'sentry.io',
  'wixpress.com',
  'schema.org',
  'w3.org',
  'googleapis.com',
  'gstatic.com',
  'cloudflare.com',
  'github.com',
  'gravatar.com',
  'placeholder.com',
  'email.com',
  'domain.com',
  'yourdomain.com',
  'duckduckgo.com',
  'google.com',
  'facebook.com',
  'yelp.com',
]);

const EMAIL_BLOCK_LOCAL = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'webmaster',
  'hostmaster',
  'abuse',
  'privacy',
]);

const FL_AREA = new Set([
  '239',
  '305',
  '321',
  '352',
  '386',
  '407',
  '443', // rare
  '561',
  '689',
  '727',
  '754',
  '772',
  '786',
  '813',
  '850',
  '863',
  '904',
  '941',
  '954',
]);

const DDG_BLOCK_HOSTS = [
  'duckduckgo.com',
  'google.com',
  'bing.com',
  'yelp.com',
  'facebook.com',
  'instagram.com',
  'tripadvisor.com',
  'yellowpages.com',
  'bbb.org',
  'wikipedia.org',
  'mapquest.com',
  'apple.com',
  'play.google',
  'linkedin.com',
  'zillow.com',
  'realtor.com',
  'redfin.com',
  'trulia.com',
];

export function normalizePhone(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('1') && digits.length === 11) digits = digits.slice(1);
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length >= 7 && digits.length <= 15) return raw;
  return '';
}

export function isPlausibleEmail(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e || !e.includes('@')) return false;
  if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i.test(e)) return false;
  const [local, domain] = e.split('@');
  if (!local || !domain || !domain.includes('.')) return false;
  if (EMAIL_BLOCK_DOMAINS.has(domain)) return false;
  if (EMAIL_BLOCK_LOCAL.has(local)) return false;
  if (local.startsWith('noreply') || local.startsWith('no-reply')) return false;
  if (/^[0-9a-f]{16,}$/i.test(local)) return false;
  return true;
}

export function extractEmails(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  const re = new RegExp(EMAIL_RE.source, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const e = m[1].trim().toLowerCase().replace(/[.,;:)>"']+$/, '');
    if (!isPlausibleEmail(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

export function extractPhones(text, { preferFl = true } = {}) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  const re = new RegExp(PHONE_RE.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    const n = normalizePhone(m[0]);
    if (!n) continue;
    const key = n.replace(/\D/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  if (!preferFl || out.length <= 1) return out;
  const fl = out.filter((p) => FL_AREA.has(p.replace(/\D/g, '').slice(0, 3)));
  return fl.length ? [...fl, ...out.filter((p) => !fl.includes(p))] : out;
}

export function normalizeWebsite(url) {
  let raw = String(url || '').trim();
  if (!raw) return '';
  const low = raw.toLowerCase();
  if (['none', 'n/a', 'na', '-', 'null'].includes(low)) return '';
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw.replace(/^\/+/, '');
  try {
    const u = new URL(raw);
    if (!u.hostname) return '';
    return `${u.protocol}//${u.hostname}${u.pathname.replace(/\/$/, '') || ''}`;
  } catch {
    return '';
  }
}

export function isUsableWebsite(url) {
  const n = normalizeWebsite(url);
  if (!n) return false;
  const low = n.toLowerCase();
  return !DDG_BLOCK_HOSTS.some((b) => low.includes(b));
}

function looksCommercial(lead) {
  const ind = String(lead.industry || '').toLowerCase();
  const name = String(lead.name || '').toLowerCase();
  const lists = Array.isArray(lead.lists) ? lead.lists : [];
  if (lists.includes('PropertyMgmt')) return true;
  if (/commercial|property management|hoa|llc|inc\.|corp|company|hotel|motel|retail|office/.test(ind)) {
    return true;
  }
  if (/\b(llc|l\.l\.c|inc\.?|corp\.?|company|trust|assoc|hoa|management)\b/i.test(name)) {
    return true;
  }
  return false;
}

function streetLine(address) {
  const a = String(address || '').trim();
  if (!a) return '';
  // "123 Palm Ave, Port Orange, FL 32127" → "123 Palm Ave"
  return a.split(',')[0].trim();
}

function parseOwnerName(name) {
  const raw = String(name || '').trim();
  if (!raw) return { first: '', last: '' };
  // Tax roll often "SMITH JOHN A" or "SMITH, JOHN"
  if (raw.includes(',')) {
    const [last, rest] = raw.split(',').map((s) => s.trim());
    const parts = (rest || '').split(/\s+/).filter(Boolean);
    return { first: parts[0] || '', last: last || '' };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first: '', last: parts[0] };
  // LAST FIRST MIDDLE (common appraiser)
  if (parts.length >= 2 && parts[0] === parts[0].toUpperCase() && parts[0].length > 1) {
    return { first: parts[1] || '', last: parts[0] || '' };
  }
  return { first: parts[0], last: parts[parts.length - 1] };
}

async function fetchText(url, { timeoutMs = 12000, params } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const u = new URL(url);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== '') u.searchParams.set(k, String(v));
      }
    }
    const r = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/json',
      },
      redirect: 'follow',
    });
    if (!r.ok) return { ok: false, status: r.status, text: '', json: null };
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    if (ctype.includes('json')) {
      const json = await r.json().catch(() => null);
      return { ok: true, status: r.status, text: '', json };
    }
    const text = await r.text();
    return { ok: true, status: r.status, text: text || '', json: null };
  } catch {
    return { ok: false, status: 0, text: '', json: null };
  } finally {
    clearTimeout(t);
  }
}

async function ddgHtml(query) {
  const res = await fetchText('https://html.duckduckgo.com/html/', {
    timeoutMs: 14000,
    params: { q: query },
  });
  return res.ok ? res.text : '';
}

function ddgResultUrls(html) {
  if (!html) return [];
  const candidates = [];
  for (const m of html.matchAll(/(?:uddg=|class="result__url"[^>]*>)([^"&\s<]+)/gi)) {
    let raw = m[1];
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* keep */
    }
    if (!raw.startsWith('http')) {
      if (raw.includes('.') && !/\s/.test(raw)) raw = 'https://' + raw;
      else continue;
    }
    candidates.push(raw);
  }
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
    candidates.push(m[1]);
  }
  const out = [];
  const seen = new Set();
  for (const c of candidates) {
    const n = normalizeWebsite(c);
    if (!n || !isUsableWebsite(n)) continue;
    let host = '';
    try {
      host = new URL(n).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      continue;
    }
    if (seen.has(host)) continue;
    if (DDG_BLOCK_HOSTS.some((b) => host.includes(b))) continue;
    seen.add(host);
    out.push(n);
  }
  return out;
}

function scoreWebsiteForName(url, name) {
  const tokens = String(name || '')
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g) || [];
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 0;
  }
  let score = 0;
  for (const t of tokens.slice(0, 4)) {
    if (host.includes(t)) score += 3;
  }
  return score;
}

async function discoverWebsite(name, city) {
  const q = `${name} ${city || ''} Florida official website`.trim();
  const html = await ddgHtml(q);
  const urls = ddgResultUrls(html);
  if (!urls.length) return '';
  const ranked = urls
    .map((u) => ({ u, s: scoreWebsiteForName(u, name) }))
    .sort((a, b) => b.s - a.s || a.u.localeCompare(b.u));
  return ranked[0].u;
}

async function scrapeWebsiteContacts(website, maxPages = 3) {
  const base = normalizeWebsite(website);
  if (!base) return { emails: [], phones: [], pages: 0, source: '' };
  const paths = ['', '/contact', '/contact-us', '/about'];
  const emails = [];
  const phones = [];
  const seenE = new Set();
  const seenP = new Set();
  let pages = 0;
  let source = '';
  for (const p of paths.slice(0, maxPages)) {
    const url = p ? base.replace(/\/$/, '') + p : base;
    const res = await fetchText(url, { timeoutMs: 10000 });
    if (!res.ok || !res.text) continue;
    pages += 1;
    for (const e of extractEmails(res.text)) {
      if (!seenE.has(e)) {
        seenE.add(e);
        emails.push(e);
        if (!source) source = url;
      }
    }
    for (const ph of extractPhones(res.text)) {
      const k = ph.replace(/\D/g, '');
      if (!seenP.has(k)) {
        seenP.add(k);
        phones.push(ph);
        if (!source) source = url;
      }
    }
    if (emails.length && phones.length) break;
  }
  return { emails, phones, pages, source };
}

async function freeDirectorySearch(lead) {
  const name = String(lead.name || '').trim();
  const addr = streetLine(lead.address);
  const city = String(lead.city || '').trim();
  const zip = String(lead.zip || '').trim();
  if (!name && !addr) return { emails: [], phones: [], queries: [] };

  const queries = [];
  if (name && addr) queries.push(`"${name}" "${addr}" ${city || 'Florida'} phone`);
  if (addr && city) queries.push(`"${addr}" ${city} FL phone number`);
  if (name && city) queries.push(`"${name}" ${city} FL phone`);
  if (name && zip) queries.push(`"${name}" ${zip} phone`);

  const emails = [];
  const phones = [];
  const seenE = new Set();
  const seenP = new Set();
  const used = [];

  for (const q of queries.slice(0, 3)) {
    used.push(q);
    const html = await ddgHtml(q);
    if (!html) continue;
    // Snippets only — avoid following people-search ToS scrapes
    for (const e of extractEmails(html)) {
      if (!seenE.has(e)) {
        seenE.add(e);
        emails.push(e);
      }
    }
    for (const ph of extractPhones(html)) {
      const k = ph.replace(/\D/g, '');
      if (!seenP.has(k)) {
        seenP.add(k);
        phones.push(ph);
      }
    }
    if (phones.length || emails.length) break;
  }
  return { emails, phones, queries: used };
}

/* ------------------------------------------------------------------ */
/* Owner-name matching                                                */
/* ------------------------------------------------------------------ */

const NAME_NOISE = new Set([
  'JR', 'SR', 'II', 'III', 'IV', 'ET', 'AL', 'ETAL', 'ETUX', 'ETVIR', 'AND', 'THE', 'OF',
  'TR', 'TRUSTEE', 'TRUSTEES', 'TRS', 'LE', 'LIFE', 'ESTATE', 'REV', 'REVOCABLE', 'IRREVOCABLE',
  'LIVING', 'FAMILY', 'TRUST', 'TRUSTS', 'H/W', 'HW', 'JT', 'TEN', 'TENANTS', 'ENTIRETY', 'DECEASED',
  'EST', 'MR', 'MRS', 'MS', 'DR',
]);
const ENTITY_RE = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|PLLC|HOA|ASSOC|ASSOCIATION|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|INVESTMENTS|ENTERPRISES|MANAGEMENT|CHURCH|CONDO|CONDOMINIUM|BANK|CITY OF|COUNTY)\b/i;

function nameTokens(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9'/\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ''))
    .filter((t) => t && !NAME_NOISE.has(t));
}

export function isEntityName(name) {
  return ENTITY_RE.test(String(name || ''));
}

/**
 * Compare a lead's owner name to candidate resident/owner names.
 * Order-agnostic, so "SMITH JOHN A" (tax roll LAST FIRST), "SMITH, JOHN" and "John Smith"
 * all compare equal. Trusts reduce to their personal-name tokens; LLCs/corps are never
 * matched against people (result "unknown", not "mismatch").
 *
 * result: 'match' (surname + full first name) | 'partial' (surname only) |
 *         'mismatch' (candidates exist, none share a surname) | 'unknown'
 */
export function matchOwnerName(leadName, candidates) {
  const cands = (Array.isArray(candidates) ? candidates : [])
    .map((c) => (typeof c === 'string' ? { name: c } : c || {}))
    .filter((c) => String(c.name || '').trim());
  if (!String(leadName || '').trim() || !cands.length) return { result: 'unknown', matched: '' };

  const lead = nameTokens(leadName);
  const entity = isEntityName(leadName);
  if (entity) {
    // Business owner: only a shared distinctive word counts, and only as "partial".
    const sig = lead.filter((t) => t.length >= 4 && !ENTITY_RE.test(t));
    for (const c of cands) {
      const ct = new Set(nameTokens(c.name));
      if (sig.some((t) => ct.has(t))) return { result: 'partial', matched: c.name };
    }
    return { result: 'unknown', matched: '' };
  }
  if (!lead.length) return { result: 'unknown', matched: '' };
  const leadSet = new Set(lead);

  let best = { result: 'mismatch', matched: '' };
  for (const c of cands) {
    const ct = nameTokens(c.name);
    const last = nameTokens(c.lastname || '')[0] || ct[ct.length - 1] || '';
    const first = nameTokens(c.firstname || '')[0] || ct[0] || '';
    if (!last || !leadSet.has(last)) continue;
    if (first && first !== last && first.length > 1 && leadSet.has(first)) {
      return { result: 'match', matched: c.name };
    }
    best = { result: 'partial', matched: c.name };
  }
  return best;
}

const NAME_MATCH_DELTA = { match: 0.15, partial: 0.05, mismatch: -0.2, unknown: 0 };

/* ------------------------------------------------------------------ */
/* Phone entries and primary selection                                */
/* ------------------------------------------------------------------ */

const LINE_TYPES = new Set(['mobile', 'landline', 'voip', 'unknown']);
const BASE_CONFIDENCE = {
  batchdata: 0.7,
  trestle: 0.7,
  web: 0.4, // number scraped from the business's own site
  search: 0.2, // snippet from a web search; may belong to anyone
  manual: 0.5,
  google_voice: 0.5,
};

function clamp01(n) {
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function triBool(v) {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 'y', 'yes', '1'].includes(s)) return true;
    if (['false', 'n', 'no', '0'].includes(s)) return false;
  }
  if (v === 1) return true;
  if (v === 0) return false;
  return null;
}

export function normalizeLineType(v) {
  const s = String(v || '').toLowerCase();
  if (!s) return 'unknown';
  if (LINE_TYPES.has(s) && s !== 'unknown') return s;
  if (/mobile|cell|wireless/.test(s)) return 'mobile';
  if (/land|fixed line|wireline/.test(s)) return 'landline';
  if (/voip/.test(s)) return 'voip';
  return 'unknown';
}

function phoneKey(n) {
  let d = String(n || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d;
}

export function makePhoneEntry(p) {
  const source = p.source || 'search';
  return {
    number: normalizePhone(p.number) || String(p.number || ''),
    line_type: normalizeLineType(p.line_type),
    dnc: triBool(p.dnc),
    litigator: triBool(p.litigator),
    source,
    confidence: clamp01(p.confidence ?? BASE_CONFIDENCE[source] ?? 0.2),
    found_at: p.found_at || new Date().toISOString(),
    // extras beyond the shared contract (additive; consumers may ignore)
    ...(p.name_match ? { name_match: p.name_match } : {}),
    ...(p.activity_score != null ? { activity_score: p.activity_score } : {}),
    ...(p.checks && p.checks.length ? { checks: p.checks } : {}),
  };
}

/** A number is dialable unless it is known DNC or a known TCPA litigator. null = unknown, allowed. */
export function isBlockedPhone(p) {
  return p.dnc === true || p.litigator === true;
}

function selectionScore(p) {
  let s = p.confidence;
  if (p.line_type === 'mobile') s += 0.15;
  else if (p.line_type === 'voip') s -= 0.05;
  if (p.dnc === false) s += 0.1; // actually scrubbed beats "not scrubbed"
  if (p.name_match === 'mismatch') s -= 0.05;
  return s;
}

/**
 * Primary = best non-DNC, non-litigator number: highest confidence with a mobile bonus
 * (+0.15) and a scrubbed bonus (+0.1). Returns null when every number is blocked / none exist.
 */
export function pickPrimaryPhone(phones) {
  const ok = (Array.isArray(phones) ? phones : []).filter((p) => p && p.number && !isBlockedPhone(p));
  if (!ok.length) return null;
  return [...ok].sort(
    (a, b) => selectionScore(b) - selectionScore(a) || a.number.localeCompare(b.number)
  )[0];
}

/* ------------------------------------------------------------------ */
/* BatchData response mapping (ISOLATED — field names UNVERIFIED)     */
/* ------------------------------------------------------------------ */

/**
 * Map a BatchData property skip-trace response to { phones[], emails[] }.
 *
 * UNVERIFIED: the build agent could not open developer.batchdata.com. The shape assumed is
 * results.persons[].phoneNumbers[] with { number, type, dnc, tcpa, reachable, score } and
 * persons[].emails[] { email }, plus person-level dnc/tcpa flags. Every alias is tolerated;
 * anything missing maps to null (= unknown), never to false. If real responses use other
 * names, fix ONLY this function and the fixture in tests/enrich/fixtures/.
 */
const BD_PHONE_NUMBER_KEYS = ['number', 'phoneNumber', 'phone', 'value'];
const BD_DNC_KEYS = ['dnc', 'isDnc', 'doNotCall', 'onDnc', 'dncStatus'];
const BD_LIT_KEYS = ['litigator', 'isLitigator', 'tcpa', 'tcpaLitigator', 'isTcpaLitigator'];
const BD_TYPE_KEYS = ['type', 'phoneType', 'lineType'];

function firstDefined(obj, keys) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

export function mapBatchDataResponse(data, lead = {}) {
  const found = [];
  const emails = [];
  const nowIso = new Date().toISOString();

  const personName = (p) => {
    const n = p?.name;
    if (typeof n === 'string') return n;
    const full = n?.full || [n?.first, n?.last].filter(Boolean).join(' ');
    return String(full || p?.fullName || '').trim();
  };

  const takePhone = (raw, person) => {
    const isObj = raw && typeof raw === 'object';
    const num = normalizePhone(String(isObj ? firstDefined(raw, BD_PHONE_NUMBER_KEYS) ?? '' : raw ?? ''));
    if (!num) return;
    const dnc = triBool(isObj ? firstDefined(raw, BD_DNC_KEYS) : undefined) ?? triBool(firstDefined(person, BD_DNC_KEYS));
    const lit = triBool(isObj ? firstDefined(raw, BD_LIT_KEYS) : undefined) ?? triBool(firstDefined(person, BD_LIT_KEYS));
    const reachable = triBool(isObj ? raw.reachable : undefined);
    let conf = BASE_CONFIDENCE.batchdata;
    if (reachable === false) conf -= 0.3;
    else if (reachable === true) conf += 0.1;
    const nm = matchOwnerName(lead.name, personName(person) ? [personName(person)] : []);
    conf += NAME_MATCH_DELTA[nm.result] || 0;
    found.push(
      makePhoneEntry({
        number: num,
        line_type: isObj ? firstDefined(raw, BD_TYPE_KEYS) : undefined,
        dnc,
        litigator: lit,
        source: 'batchdata',
        confidence: conf,
        found_at: nowIso,
        name_match: nm.result === 'unknown' ? undefined : nm.result,
      })
    );
  };

  const walk = (node, depth = 0, person = null) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach((x) => walk(x, depth + 1, person));
      return;
    }
    if (typeof node !== 'object') return;
    const isPerson = Array.isArray(node.phoneNumbers) || Array.isArray(node.phones) || Array.isArray(node.emails);
    const ctx = isPerson ? node : person;
    for (const [k, v] of Object.entries(node)) {
      const kl = k.toLowerCase();
      if ((kl === 'phonenumbers' || kl === 'phones') && Array.isArray(v)) {
        v.forEach((x) => takePhone(x, ctx));
      } else if (kl === 'emails' && Array.isArray(v)) {
        for (const e of v) {
          const addr = typeof e === 'string' ? e : e?.email || e?.address || '';
          if (isPlausibleEmail(addr)) emails.push(String(addr).trim().toLowerCase());
        }
      } else if (
        (kl.includes('phone') || kl === 'mobile' || kl === 'telephone') &&
        (typeof v === 'string' || typeof v === 'number')
      ) {
        takePhone(String(v), ctx);
      } else if (kl.includes('email') && typeof v === 'string') {
        if (isPlausibleEmail(v)) emails.push(v.trim().toLowerCase());
      } else if (v && typeof v === 'object') {
        walk(v, depth + 1, ctx);
      }
    }
  };
  walk(data);

  // de-dupe by digits, keep first (richest listed first by BatchData ordering)
  const seen = new Set();
  const phones = [];
  for (const p of found) {
    const k = phoneKey(p.number);
    if (seen.has(k)) continue;
    seen.add(k);
    phones.push(p);
  }
  return { phones, emails: [...new Set(emails)] };
}

/**
 * BatchData Property Skip Trace (optional paid).
 * Docs: https://developer.batchdata.com — set BATCHDATA_API_KEY.
 * Accepts property address + optional person name.
 */
async function batchDataSkipTrace(lead) {
  const key = process.env.BATCHDATA_API_KEY || process.env.BATCH_DATA_API_KEY || '';
  if (!key) return null;

  const address = String(lead.address || '').trim();
  if (!address) return { ok: false, error: 'no_address', provider: 'batchdata' };

  const street = streetLine(address);
  const city = String(lead.city || '').trim();
  let zip = String(lead.zip || '').trim();
  if (!zip) {
    const m = address.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (m) zip = m[1];
  }
  const { first, last } = parseOwnerName(lead.name);

  const body = {
    requests: [
      {
        propertyAddress: {
          street,
          city: city || undefined,
          state: 'FL',
          zip: zip || undefined,
        },
        ...(first || last
          ? {
              persons: [
                {
                  ...(first ? { firstName: first } : {}),
                  ...(last ? { lastName: last } : {}),
                },
              ],
            }
          : {}),
      },
    ],
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch('https://api.batchdata.com/api/v1/property/skip-trace', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(body),
    });
    const raw = await r.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    if (!r.ok) {
      const msg =
        (data &&
          (data.message ||
            data.error ||
            data?.status?.message ||
            data?.status?.text)) ||
        `HTTP ${r.status}`;
      // 403 covers both missing Skip Trace API access and an empty account balance
      const hint =
        r.status === 403
          ? /balance/i.test(String(msg))
            ? ' (add funds in the BatchData dashboard)'
            : ' (token OK but no Property Skip Trace API permission — enable Skip Trace API in BatchData dashboard or request a different key)'
          : '';
      return {
        ok: false,
        provider: 'batchdata',
        error: String(msg) + hint,
        status: r.status,
      };
    }

    const mapped = mapBatchDataResponse(data, lead);
    return {
      ok: true,
      provider: 'batchdata',
      phone: mapped.phones[0]?.number || '',
      email: mapped.emails[0] || '',
      phones: mapped.phones,
      emails: mapped.emails,
      raw_keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 12) : [],
    };
  } catch (e) {
    return {
      ok: false,
      provider: 'batchdata',
      error: e?.message || String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------------ */
/* Spend guard                                                        */
/* ------------------------------------------------------------------ */

export const MAX_VALIDATE_PER_LEAD = 3;
export const DEFAULT_MAX_PAID_LOOKUPS = 50;
export const HARD_MAX_PAID_LOOKUPS = 500;

/** Clamp a client-supplied cap: default 50, hard cap 500, junk -> default. */
export function clampMaxPaidLookups(v) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n) || n < 0) return DEFAULT_MAX_PAID_LOOKUPS;
  return Math.min(HARD_MAX_PAID_LOOKUPS, Math.floor(n));
}

/** Mutable budget shared across the leads in one request. One paid HTTP call = one lookup. */
export function createBudget(max = DEFAULT_MAX_PAID_LOOKUPS) {
  const cap = clampMaxPaidLookups(max);
  return {
    max: cap,
    remaining: cap,
    used: { batchdata: 0, trestle_phone_intel: 0, trestle_reverse_phone: 0, trestle_litigator_addons: 0 },
    exhausted: false,
  };
}

function emptyCost() {
  return { batchdata: 0, trestle_phone_intel: 0, trestle_reverse_phone: 0, trestle_litigator_addons: 0, lookups: 0 };
}

/** Reserve one paid lookup. Returns false (and flags the budget) when the cap is reached. */
function spend(budget, cost, kind) {
  if (budget) {
    if (budget.remaining <= 0) {
      budget.exhausted = true;
      return false;
    }
    budget.remaining -= 1;
    budget.used[kind] = (budget.used[kind] || 0) + 1;
  }
  cost[kind] = (cost[kind] || 0) + 1;
  cost.lookups += 1;
  return true;
}

function bdKey() {
  return process.env.BATCHDATA_API_KEY || process.env.BATCH_DATA_API_KEY || '';
}

/* ------------------------------------------------------------------ */
/* Existing contact state on the lead                                 */
/* ------------------------------------------------------------------ */

const PHONE_SOURCES = new Set(['batchdata', 'trestle', 'web', 'search', 'manual', 'google_voice']);

function existingPhoneEntries(lead) {
  const out = [];
  const seen = new Set();
  const push = (e) => {
    const k = phoneKey(e.number);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(e);
  };
  for (const p of Array.isArray(lead.phones) ? lead.phones : []) {
    if (!p || !p.number) continue;
    push({
      ...p,
      number: normalizePhone(p.number) || String(p.number),
      line_type: normalizeLineType(p.line_type),
      dnc: triBool(p.dnc),
      litigator: triBool(p.litigator),
      source: PHONE_SOURCES.has(p.source) ? p.source : 'manual',
      confidence: clamp01(Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : 0.5),
      found_at: p.found_at || '',
    });
  }
  const single = normalizePhone(lead.phone);
  if (single && !seen.has(phoneKey(single))) {
    const src = PHONE_SOURCES.has(lead.phone_source) ? lead.phone_source : 'manual';
    push({
      number: single,
      line_type: normalizeLineType(lead.phone_line_type),
      dnc: triBool(lead.phone_dnc),
      litigator: null,
      source: src,
      confidence: clamp01(Number.isFinite(Number(lead.phone_confidence)) ? Number(lead.phone_confidence) : BASE_CONFIDENCE[src]),
      found_at: '',
    });
  }
  return out;
}

function needsVerification(e) {
  const checked = Array.isArray(e.checks) && e.checks.includes('trestle:phone_intel');
  return !checked && (e.line_type === 'unknown' || e.litigator === null);
}

/* ------------------------------------------------------------------ */
/* Estimate (no network)                                              */
/* ------------------------------------------------------------------ */

/**
 * What enrichOneLead would spend on this lead, without calling anyone.
 * max_lookups is a ceiling; expected_lookups assumes one candidate per path.
 */
export function estimateLead(lead, opts = {}) {
  const force = !!opts.force;
  const allowPaid = opts.allowPaid !== false;
  const hasPhone = !!(lead.phone || '').trim() && !force;
  const hasEmail = !!(lead.email || '').trim() && !force;
  const needPhone = !hasPhone;
  const needEmail = !hasEmail;
  const existing = existingPhoneEntries(lead);
  const unverified = existing.filter(needsVerification).length;
  const hasTrestle = trestleConfigured();
  const bd = allowPaid && !!bdKey() && (needPhone || needEmail) && !!String(lead.address || '').trim() ? 1 : 0;
  const residential = !looksCommercial(lead);

  const out = {
    id: lead.id,
    providers: [],
    batchdata: bd,
    trestle_phone_intel: 0,
    trestle_reverse_phone: 0,
    free: [],
    max_lookups: 0,
    expected_lookups: 0,
    note: '',
  };
  if (bd) out.providers.push('batchdata');
  if (needPhone || needEmail) {
    out.free.push(looksCommercial(lead) ? 'website_scrape' : 'directory_search');
  }
  if (allowPaid && hasTrestle) {
    const maxIntel = Math.min(MAX_VALIDATE_PER_LEAD, needPhone ? MAX_VALIDATE_PER_LEAD : unverified);
    out.trestle_phone_intel = Math.max(0, maxIntel);
    out.trestle_reverse_phone = residential && String(lead.name || '').trim() && (needPhone || unverified) ? 1 : 0;
    if (out.trestle_phone_intel || out.trestle_reverse_phone) out.providers.push('trestle');
  }
  out.max_lookups = out.batchdata + out.trestle_phone_intel + out.trestle_reverse_phone;
  out.expected_lookups =
    out.batchdata +
    (hasTrestle && allowPaid ? Math.min(out.trestle_phone_intel, needPhone ? 1 : unverified) : 0) +
    out.trestle_reverse_phone;
  if (hasPhone && hasEmail && !unverified) {
    out.note = 'already has phone + email';
    out.max_lookups = out.expected_lookups = 0;
    out.batchdata = out.trestle_phone_intel = out.trestle_reverse_phone = 0;
    out.providers = [];
    out.free = [];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Trestle verification step                                          */
/* ------------------------------------------------------------------ */

async function verifyWithTrestle(lead, entries, { budget, cost, notes, pastDeadline, commercial }) {
  const targets = entries
    .filter((e) => needsVerification(e) || e._force)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_VALIDATE_PER_LEAD);

  let authFailed = false;
  for (const e of targets) {
    if (authFailed || pastDeadline()) break;
    const wantLit = e.litigator === null;
    if (!spend(budget, cost, 'trestle_phone_intel')) {
      notes.push('spend guard: paid lookup cap reached');
      return;
    }
    if (wantLit) cost.trestle_litigator_addons += 1;
    const r = await phoneIntel(e.number, { litigator: wantLit });
    if (!r.ok) {
      notes.push(`trestle: ${r.error}`);
      if (r.status === 403) authFailed = true;
      continue;
    }
    e.checks = [...(e.checks || []), 'trestle:phone_intel'];
    if (e.line_type === 'unknown') e.line_type = r.line_type;
    if (wantLit) {
      if (r.litigator === null) {
        notes.push('litigator check returned no result (add-on may not be enabled on the Trestle key)');
      } else {
        e.litigator = r.litigator;
        e.checks.push('trestle:litigator');
      }
    }
    if (r.activity_score != null) e.activity_score = r.activity_score;
    if (r.is_valid === false) {
      e.confidence = Math.min(e.confidence, 0.05);
      notes.push(`${e.number}: Trestle says not a valid number`);
    } else if (r.activity_score != null) {
      if (r.activity_score >= 70) e.confidence = clamp01(e.confidence + 0.1);
      else if (r.activity_score <= 30) e.confidence = clamp01(e.confidence - 0.3);
    }
  }
  if (authFailed || commercial || !String(lead.name || '').trim() || isEntityName(lead.name)) return;

  // Owner-name check on the single best remaining candidate that BatchData has not already named.
  const best = entries
    .filter((e) => !isBlockedPhone(e) && !e.name_match && e.confidence > 0.05)
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (!best || pastDeadline()) return;
  if (!spend(budget, cost, 'trestle_reverse_phone')) {
    notes.push('spend guard: paid lookup cap reached');
    return;
  }
  const rp = await reversePhone(best.number, { postalHint: String(lead.zip || '').trim() });
  if (!rp.ok) {
    notes.push(`trestle reverse phone: ${rp.error}`);
    return;
  }
  best.checks = [...(best.checks || []), 'trestle:reverse_phone'];
  const m = matchOwnerName(lead.name, rp.owners);
  if (m.result === 'unknown') {
    best.name_match = 'unknown';
    return;
  }
  best.name_match = m.result;
  best.confidence = clamp01(best.confidence + (NAME_MATCH_DELTA[m.result] || 0));
  if (m.result === 'mismatch') {
    notes.push(`${best.number}: owner on record (${rp.owners[0]?.name || '?'}) does not match lead name`);
  }
}

/* ------------------------------------------------------------------ */
/* Enrich one lead                                                    */
/* ------------------------------------------------------------------ */

/**
 * Enrich one lead. Does not mutate the input lead.
 *
 * Returns { id, phone, email, website, sources, status, detail } (original shape) plus the
 * contact contract: phones[], phone_dnc, phone_line_type, phone_source, phone_confidence,
 * email_source, enriched_at, and cost{}.
 *
 *   phone / email / website   only filled when the lead's field is empty (or force)
 *   phones[]                  full merged list (existing entries preserved)
 *   phone_*                   describe the number that is/will be the lead's primary
 *   suggested_phone           a better number than the lead's kept primary, if any
 *
 * opts: { force, allowPaid, budget (createBudget()), deadline (epoch ms) }
 */
export async function enrichOneLead(lead, opts = {}) {
  const force = !!opts.force;
  const allowPaid = opts.allowPaid !== false;
  const budget = opts.budget || null;
  const deadline = Number(opts.deadline) || 0;
  const pastDeadline = () => !!deadline && Date.now() > deadline;
  const id = lead?.id;
  const cost = emptyCost();
  const notes = [];
  const out = {
    id,
    phone: '',
    email: '',
    website: '',
    sources: [],
    status: 'skipped',
    detail: '',
    phones: [],
    phone_dnc: null,
    phone_line_type: '',
    phone_source: '',
    phone_confidence: null,
    email_source: '',
    enriched_at: new Date().toISOString(),
    suggested_phone: '',
    warnings: notes,
    cost,
  };

  const hasPhone = !!(lead.phone || '').trim() && !force;
  const hasEmail = !!(lead.email || '').trim() && !force;
  const hasWeb = isUsableWebsite(lead.website || '') && !force;
  const needPhone = !hasPhone;
  const needEmail = !hasEmail;
  const commercial = looksCommercial(lead);
  const trestleOn = allowPaid && trestleConfigured();

  const entries = existingPhoneEntries(lead);
  if (force) entries.forEach((e) => (e._force = true));

  const finish = () => {
    for (const e of entries) delete e._force;
    out.phones = entries;
    const kept = hasPhone ? entries.find((e) => phoneKey(e.number) === phoneKey(lead.phone)) : null;
    const best = pickPrimaryPhone(entries);
    const effective = kept || best;
    if (needPhone && best) out.phone = best.number;
    if (effective) {
      out.phone_dnc = effective.dnc;
      out.phone_line_type = effective.line_type;
      out.phone_source = effective.source;
      out.phone_confidence = effective.confidence;
    }
    if (kept && best && phoneKey(best.number) !== phoneKey(kept.number)) {
      out.suggested_phone = best.number;
    }
    return out;
  };

  if (hasPhone && hasEmail && !(trestleOn && entries.some(needsVerification))) {
    out.status = 'complete';
    out.detail = 'already has phone + email';
    out.email = String(lead.email || '').trim().toLowerCase();
    finish();
    out.phone = normalizePhone(lead.phone) || lead.phone;
    return out;
  }

  const found = []; // phone entries discovered this run

  // 1) Paid skip-trace for residential (and commercial if still missing)
  if (
    allowPaid &&
    (needPhone || needEmail) &&
    (lead.address || '').trim() &&
    bdKey() &&
    !pastDeadline()
  ) {
    if (spend(budget, cost, 'batchdata')) {
      const bd = await batchDataSkipTrace(lead);
      if (bd && bd.ok) {
        // phones already paid for are kept even if the lead has one (extra numbers + DNC data)
        found.push(...bd.phones);
        if (needEmail && bd.email) {
          out.email = bd.email;
          out.email_source = 'batchdata';
          out.sources.push('batchdata:email');
        }
        if (needPhone && bd.phones.length) out.sources.push('batchdata:phone');
        if (bd.phones.length || bd.email) out.detail = 'batchdata skip-trace';
      } else if (bd && bd.error && bd.error !== 'no_address') {
        out.detail = `batchdata: ${bd.error}`;
      }
    } else {
      notes.push('spend guard: paid lookup cap reached');
    }
  }

  // 2) Free commercial website scrape
  if (
    commercial &&
    (needPhone || needEmail) &&
    ((!found.length && needPhone) || (!out.email && needEmail) || !hasWeb)
  ) {
    let website = hasWeb ? normalizeWebsite(lead.website) : '';
    if (!website) {
      website = await discoverWebsite(lead.name, lead.city);
      if (website) {
        out.website = website;
        out.sources.push('ddg:website');
      }
    }
    if (website) {
      const scraped = await scrapeWebsiteContacts(website);
      if (!found.length && needPhone) {
        for (const ph of scraped.phones.slice(0, 2)) found.push(makePhoneEntry({ number: ph, source: 'web' }));
        if (scraped.phones[0]) out.sources.push('web:phone');
      }
      if (!out.email && needEmail && scraped.emails[0]) {
        out.email = scraped.emails[0];
        out.email_source = 'web';
        out.sources.push('web:email');
      }
      if (!out.website && website) out.website = website;
    }
  }

  // 3) Free directory-style search (residential + residual gaps)
  if ((!found.length && needPhone) || (!out.email && needEmail)) {
    const dir = await freeDirectorySearch(lead);
    if (!found.length && needPhone && dir.phones[0]) {
      found.push(makePhoneEntry({ number: dir.phones[0], source: 'search' }));
      out.sources.push('search:phone');
    }
    if (!out.email && needEmail && dir.emails[0]) {
      out.email = dir.emails[0];
      out.email_source = 'search';
      out.sources.push('search:email');
    }
  }

  // merge discoveries into the existing list (existing entries win; only nulls are filled)
  for (const f of found) {
    const k = phoneKey(f.number);
    const prior = entries.find((e) => phoneKey(e.number) === k);
    if (!prior) entries.push(f);
    else {
      if (prior.line_type === 'unknown' && f.line_type !== 'unknown') prior.line_type = f.line_type;
      if (prior.dnc === null) prior.dnc = f.dnc;
      if (prior.litigator === null) prior.litigator = f.litigator;
    }
  }

  // 4) Trestle verification of every candidate (paid)
  if (trestleOn && entries.length && !pastDeadline()) {
    await verifyWithTrestle(lead, entries, { budget, cost, notes, pastDeadline, commercial });
  }

  finish();

  if (!needPhone && !needEmail) {
    // nothing to discover; this run only verified the numbers already on the lead
    out.status = 'complete';
    out.detail = 'already has phone + email (numbers verified)';
    out.phone = normalizePhone(lead.phone) || lead.phone;
    out.email = String(lead.email || '').trim().toLowerCase();
    return out;
  }

  const blockedOnly = entries.length > 0 && !pickPrimaryPhone(entries);
  const gotPhone = needPhone ? !!out.phone : true;
  if (out.phone || out.email || out.website) {
    out.status = gotPhone && (needEmail ? !!out.email : true) ? 'found' : 'partial';
    if (!out.detail) out.detail = out.sources.join(', ') || 'free discovery';
  } else if (blockedOnly && needPhone) {
    out.status = 'blocked';
    out.detail = 'numbers found but all are DNC / TCPA litigator — do not dial';
  } else {
    out.status = 'not_found';
    if (!out.detail) {
      out.detail =
        allowPaid && !bdKey() && needPhone && !entries.length
          ? 'no hit on free search — set BATCHDATA_API_KEY for residential skip-trace'
          : needPhone && !entries.length
            ? 'no phone/email found'
            : 'no new phone/email found';
    }
  }
  if (blockedOnly && out.status !== 'blocked') {
    notes.push('every phone found is DNC / litigator — none selected as primary');
  }
  return out;
}

export function enrichCapabilities() {
  const batch = !!bdKey();
  const trestle = trestleConfigured();
  return {
    free_directory: true,
    free_website_scrape: true,
    batchdata: batch,
    trestle,
    // Trestle validates/verifies numbers; it does not discover them (Reverse Address = names only)
    trestle_role: 'verification',
    dnc_scrub: batch ? 'batchdata' : 'none',
    litigator_check: batch || trestle ? [batch && 'batchdata', trestle && 'trestle'].filter(Boolean) : [],
    max_validate_per_lead: MAX_VALIDATE_PER_LEAD,
    default_max_paid_lookups: DEFAULT_MAX_PAID_LOOKUPS,
    hard_max_paid_lookups: HARD_MAX_PAID_LOOKUPS,
    note: batch
      ? 'BatchData skip-trace enabled for property address + owner name.' +
        (trestle ? ' Trestle verification (line type, litigator, owner match) enabled.' : '')
      : 'Free discovery only. Add BATCHDATA_API_KEY on Vercel for residential phone/email skip-trace.' +
        (trestle ? ' Trestle verification enabled for any numbers found.' : ''),
  };
}
