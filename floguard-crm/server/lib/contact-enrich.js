/**
 * Contact enrichment for CRM leads (phone / email / website).
 *
 * Paths (in order when fields are still missing):
 *  1. Optional BatchData property skip-trace — best for residential tax-roll leads
 *     (BATCHDATA_API_KEY). Designed for owner name + site address.
 *  2. Free commercial path — DuckDuckGo website discovery + homepage/contact scrape.
 *  3. Free residential/directory path — DuckDuckGo HTML search snippets for phones.
 *
 * Never invents contacts. Never overwrites non-empty lead fields (caller merges).
 * DNC / CAN-SPAM still apply after enrichment — scrub before dial/email.
 */

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
      // 403 with a valid-looking token usually means the key product lacks Skip Trace API access
      const hint =
        r.status === 403
          ? ' (token OK but no Property Skip Trace API permission — enable Skip Trace API in BatchData dashboard or request a different key)'
          : '';
      return {
        ok: false,
        provider: 'batchdata',
        error: String(msg) + hint,
        status: r.status,
      };
    }

    // Response shapes vary by plan — walk common paths
    const phones = [];
    const emails = [];
    const walk = (node, depth = 0) => {
      if (!node || depth > 8) return;
      if (Array.isArray(node)) {
        node.forEach((x) => walk(x, depth + 1));
        return;
      }
      if (typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        const kl = k.toLowerCase();
        if (
          (kl.includes('phone') || kl === 'mobile' || kl === 'telephone') &&
          (typeof v === 'string' || typeof v === 'number')
        ) {
          const n = normalizePhone(String(v));
          if (n) phones.push(n);
        } else if (kl.includes('email') && typeof v === 'string') {
          if (isPlausibleEmail(v)) emails.push(v.trim().toLowerCase());
        } else if (v && typeof v === 'object') {
          walk(v, depth + 1);
        }
      }
    };
    walk(data);

    const uniqP = [];
    const seenP = new Set();
    for (const p of phones) {
      const d = p.replace(/\D/g, '');
      if (seenP.has(d)) continue;
      seenP.add(d);
      uniqP.push(p);
    }
    const uniqE = [...new Set(emails)];

    return {
      ok: true,
      provider: 'batchdata',
      phone: uniqP[0] || '',
      email: uniqE[0] || '',
      phones: uniqP,
      emails: uniqE,
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

/**
 * Enrich one lead. Returns { id, phone, email, website, sources, status, detail }.
 * Does not mutate the input lead.
 */
export async function enrichOneLead(lead, opts = {}) {
  const force = !!opts.force;
  const allowPaid = opts.allowPaid !== false;
  const id = lead?.id;
  const out = {
    id,
    phone: '',
    email: '',
    website: '',
    sources: [],
    status: 'skipped',
    detail: '',
  };

  const hasPhone = !!(lead.phone || '').trim() && !force;
  const hasEmail = !!(lead.email || '').trim() && !force;
  const hasWeb = isUsableWebsite(lead.website || '') && !force;
  if (hasPhone && hasEmail) {
    out.status = 'complete';
    out.detail = 'already has phone + email';
    out.phone = normalizePhone(lead.phone) || lead.phone;
    out.email = String(lead.email || '').trim().toLowerCase();
    return out;
  }

  const needPhone = !hasPhone;
  const needEmail = !hasEmail;
  const commercial = looksCommercial(lead);

  // 1) Paid skip-trace for residential (and commercial if still missing)
  if (allowPaid && (needPhone || needEmail) && (lead.address || '').trim()) {
    const bd = await batchDataSkipTrace(lead);
    if (bd && bd.ok) {
      if (needPhone && bd.phone) {
        out.phone = bd.phone;
        out.sources.push('batchdata:phone');
      }
      if (needEmail && bd.email) {
        out.email = bd.email;
        out.sources.push('batchdata:email');
      }
      if (out.phone || out.email) {
        out.status = out.phone && out.email ? 'found' : 'partial';
        out.detail = 'batchdata skip-trace';
      }
    } else if (bd && bd.error && bd.error !== 'no_address') {
      out.detail = `batchdata: ${bd.error}`;
    }
  }

  // 2) Free commercial website scrape
  if (commercial && ((!out.phone && needPhone) || (!out.email && needEmail) || !hasWeb)) {
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
      if (!out.phone && needPhone && scraped.phones[0]) {
        out.phone = scraped.phones[0];
        out.sources.push('web:phone');
      }
      if (!out.email && needEmail && scraped.emails[0]) {
        out.email = scraped.emails[0];
        out.sources.push('web:email');
      }
      if (!out.website && website) out.website = website;
    }
  }

  // 3) Free directory-style search (residential + residual gaps)
  if ((!out.phone && needPhone) || (!out.email && needEmail)) {
    const dir = await freeDirectorySearch(lead);
    if (!out.phone && needPhone && dir.phones[0]) {
      out.phone = dir.phones[0];
      out.sources.push('search:phone');
    }
    if (!out.email && needEmail && dir.emails[0]) {
      out.email = dir.emails[0];
      out.sources.push('search:email');
    }
  }

  if (out.phone || out.email || out.website) {
    out.status =
      (needPhone ? !!out.phone : true) && (needEmail ? !!out.email : true)
        ? 'found'
        : 'partial';
    if (!out.detail) out.detail = out.sources.join(', ') || 'free discovery';
  } else {
    out.status = 'not_found';
    if (!out.detail) {
      out.detail = allowPaid && !(process.env.BATCHDATA_API_KEY || process.env.BATCH_DATA_API_KEY)
        ? 'no hit on free search — set BATCHDATA_API_KEY for residential skip-trace'
        : 'no phone/email found';
    }
  }
  return out;
}

export function enrichCapabilities() {
  const batch =
    !!(process.env.BATCHDATA_API_KEY || process.env.BATCH_DATA_API_KEY);
  return {
    free_directory: true,
    free_website_scrape: true,
    batchdata: batch,
    note: batch
      ? 'BatchData skip-trace enabled for property address + owner name.'
      : 'Free discovery only. Add BATCHDATA_API_KEY on Vercel for residential phone/email skip-trace.',
  };
}
