/**
 * Shared HTTP helpers for Vercel serverless handlers.
 * CORS: allowlist only (no * in production).
 */

const DEFAULT_ORIGINS = [
  'https://floguardfl.com',
  'https://www.floguardfl.com',
  'https://crm.floguardfl.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

export function allowedOrigins() {
  const extra = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...extra])];
}

export function setCors(req, res) {
  const origin = String(req.headers?.origin || '');
  const list = allowedOrigins();
  if (origin && list.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    // same-origin / server-to-server
    res.setHeader('Access-Control-Allow-Origin', list[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Academy-Sync-Secret',
  );
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body || {};
}

/** In-memory rate limit (per isolate; better than nothing on Vercel) */
const buckets = new Map();

const MAX_BUCKETS = 5000;
/** Test hook. */
export function _bucketCount() {
  return buckets.size;
}

export function rateLimit(key, { limit = 20, windowMs = 60_000 } = {}) {
  const now = Date.now();
  // The public proposal endpoint keys buckets by (hashed) token and IP, so the map grew without
  // bound in a warm isolate. Drop expired buckets when it gets large (review R1).
  if (buckets.size >= MAX_BUCKETS) {
    for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
    if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value);
  }
  let b = buckets.get(key);
  if (!b || now > b.reset) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.reset - now) / 1000) };
  }
  return { ok: true };
}

export function clientIp(req) {
  const xf = req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || '';
  return String(xf).split(',')[0].trim() || 'unknown';
}
