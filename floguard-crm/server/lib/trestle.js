/**
 * Trestle (trestleiq.com) client — phone validation, litigator add-on, reverse phone,
 * reverse address.
 *
 * Endpoint facts below were read from the published OpenAPI specs on 2026-11-19
 * (https://docs.trestleiq.com/openapi/*.openapi.yaml). Nothing here has been run
 * against the live API (no key available to the build agent).
 *
 *   Auth        header `x-api-key: <TRESTLE_API_KEY>` (all products)
 *   Base URL    https://api.trestleiq.com  (override with TRESTLE_API_URL, tests only)
 *   Phone Validation   GET /3.0/phone_intel?phone=..&add_ons=litigator_checks
 *   Reverse Phone      GET /3.2/phone?phone=..&phone.name_hint=..&phone.postal_code_hint=..
 *   Reverse Address    GET /3.1/location?street_line_1=..&city=..&state_code=..&postal_code=..
 *
 * IMPORTANT: Reverse Address returns resident NAMES only (current_residents[]).
 * It does not return phone numbers. Trestle therefore acts as a validation / verification
 * layer for numbers found elsewhere, not as a phone-discovery source.
 *
 * Trestle does not return a Do-Not-Call flag. `dnc` stays null for Trestle-only data;
 * DNC comes from BatchData or a separate scrub.
 *
 * Contract: no function here throws. Failures come back as `{ error, status? }`.
 * Retry: one retry on HTTP 429 / 5xx / network failure.
 */

const DEFAULT_BASE = 'https://api.trestleiq.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 500;

export function trestleConfigured() {
  return !!process.env.TRESTLE_API_KEY;
}

function baseUrl() {
  return (process.env.TRESTLE_API_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

function sleep(ms) {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/** 10-digit US number from any input, or ''. */
export function usDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : '';
}

/**
 * GET helper. Resolves `{ ok: true, status, data, headers }` or `{ error, status }`.
 * `fetchImpl` is only for tests; production uses global fetch resolved at call time.
 */
async function trestleGet(path, params, opts = {}) {
  const key = process.env.TRESTLE_API_KEY || '';
  if (!key) return { error: 'TRESTLE_API_KEY not set', status: 0 };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const u = new URL(baseUrl() + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }

  let last = { error: 'unknown', status: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const doFetch = opts.fetchImpl || globalThis.fetch;
      const r = await doFetch(u.toString(), {
        method: 'GET',
        signal: ctrl.signal,
        headers: { 'x-api-key': key, Accept: 'application/json' },
      });
      const text = await r.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (r.ok) return { ok: true, status: r.status, data, headers: r.headers };

      const msg =
        (data && (data.message || data.error || data.errorCode)) || `HTTP ${r.status}`;
      last = { error: `trestle: ${String(msg)}`, status: r.status };
      const retryable = r.status === 429 || r.status >= 500;
      // QUOTA_EXCEEDED will not clear in a second; do not burn the retry on it
      const quota = data && /QUOTA_EXCEEDED/.test(String(data.errorCode || ''));
      if (!retryable || quota || attempt === 1) return last;
    } catch (e) {
      last = { error: `trestle: ${e?.name === 'AbortError' ? 'timeout' : e?.message || e}`, status: 0 };
      if (attempt === 1) return last;
    } finally {
      clearTimeout(t);
    }
    await sleep(retryDelayMs);
  }
  return last;
}

/* ------------------------------------------------------------------ */
/* Response mapping — the ONLY place Trestle field names appear.      */
/* ------------------------------------------------------------------ */

/** Trestle line_type enum -> CRM enum. */
export function trestleLineType(v) {
  switch (String(v || '')) {
    case 'Mobile':
      return 'mobile';
    case 'Landline':
      return 'landline';
    case 'FixedVOIP':
    case 'NonFixedVOIP':
      return 'voip';
    default:
      return 'unknown'; // Premium, TollFree, Voicemail, Other, null
  }
}

/** Phone Validation response -> normalised object. */
export function mapPhoneIntel(d) {
  if (!d || typeof d !== 'object') return null;
  const lit = d.add_ons?.litigator_checks?.phone?.is_litigator_risk;
  return {
    is_valid: typeof d.is_valid === 'boolean' ? d.is_valid : null,
    activity_score: Number.isFinite(d.activity_score) ? d.activity_score : null,
    line_type: trestleLineType(d.line_type),
    carrier: d.carrier || '',
    is_prepaid: typeof d.is_prepaid === 'boolean' ? d.is_prepaid : null,
    // null = check not run / not enabled on this key / could not complete
    litigator: typeof lit === 'boolean' ? lit : null,
    warnings: Array.isArray(d.warnings) ? d.warnings : [],
    partial_error: d.error?.message || '',
  };
}

/** Reverse Phone response -> owner names. */
export function mapReversePhone(d) {
  if (!d || typeof d !== 'object') return null;
  const owners = Array.isArray(d.owners) ? d.owners : [];
  return {
    is_valid: typeof d.is_valid === 'boolean' ? d.is_valid : null,
    line_type: trestleLineType(d.line_type),
    owners: owners
      .map((o) => ({
        name: String(o?.name || [o?.firstname, o?.lastname].filter(Boolean).join(' ')).trim(),
        firstname: o?.firstname || '',
        lastname: o?.lastname || '',
        type: o?.type || '',
      }))
      .filter((o) => o.name),
  };
}

/** Reverse Address response -> resident names (no phones exist in this response). */
export function mapReverseAddress(d) {
  if (!d || typeof d !== 'object') return null;
  const res = Array.isArray(d.current_residents) ? d.current_residents : [];
  return {
    is_valid: typeof d.is_valid === 'boolean' ? d.is_valid : null,
    is_commercial: typeof d.is_commercial === 'boolean' ? d.is_commercial : null,
    residents: res
      .map((o) => ({
        name: String(o?.name || [o?.firstname, o?.lastname].filter(Boolean).join(' ')).trim(),
        firstname: o?.firstname || '',
        lastname: o?.lastname || '',
        type: o?.type || '',
      }))
      .filter((o) => o.name),
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

/** Line type, activity score, optional TCPA litigator add-on (extra charge at Trestle). */
export async function phoneIntel(phone, { litigator = true, ...opts } = {}) {
  try {
    const d10 = usDigits(phone);
    if (!d10) return { error: 'invalid_phone' };
    const r = await trestleGet(
      '/3.0/phone_intel',
      {
        phone: d10,
        'phone.country_hint': 'US',
        add_ons: litigator ? 'litigator_checks' : '',
      },
      opts
    );
    if (!r.ok) return { error: r.error, status: r.status };
    const m = mapPhoneIntel(r.data);
    if (!m) return { error: 'trestle: empty response', status: r.status };
    return { ok: true, provider: 'trestle', litigator_requested: !!litigator, ...m };
  } catch (e) {
    return { error: `trestle: ${e?.message || e}` };
  }
}

/** Who owns this number (names) — used for owner-name matching. */
export async function reversePhone(phone, { nameHint, postalHint, ...opts } = {}) {
  try {
    const d10 = usDigits(phone);
    if (!d10) return { error: 'invalid_phone' };
    const r = await trestleGet(
      '/3.2/phone',
      {
        phone: d10,
        'phone.country_hint': 'US',
        'phone.name_hint': nameHint,
        'phone.postal_code_hint': postalHint,
      },
      opts
    );
    if (!r.ok) return { error: r.error, status: r.status };
    const m = mapReversePhone(r.data);
    if (!m) return { error: 'trestle: empty response', status: r.status };
    return { ok: true, provider: 'trestle', ...m };
  } catch (e) {
    return { error: `trestle: ${e?.message || e}` };
  }
}

/** Residents currently linked to an address (names only; no phones). */
export async function reverseAddress({ street, city, state = 'FL', zip, ...opts } = {}) {
  try {
    if (!street) return { error: 'no_street' };
    const r = await trestleGet(
      '/3.1/location',
      {
        street_line_1: street,
        city,
        state_code: state,
        postal_code: zip,
        country_code: 'US',
      },
      opts
    );
    if (!r.ok) return { error: r.error, status: r.status };
    const m = mapReverseAddress(r.data);
    if (!m) return { error: 'trestle: empty response', status: r.status };
    return { ok: true, provider: 'trestle', ...m };
  } catch (e) {
    return { error: `trestle: ${e?.message || e}` };
  }
}
