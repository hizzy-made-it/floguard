/**
 * Minimal Supabase REST (PostgREST + Storage) helpers.
 * Service-role only — never import into browser code.
 */

export function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(
    /\/$/,
    '',
  );
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  return { url, key };
}

export function restHeaders({ prefer, json = true } = {}) {
  const { key } = supabaseConfig();
  const h = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  if (prefer) h.Prefer = prefer;
  return h;
}

/**
 * @param {string} path - e.g. /rest/v1/leads?org_id=eq.xxx
 * @param {RequestInit & { prefer?: string }} opts
 */
export async function rest(path, opts = {}) {
  const { url } = supabaseConfig();
  const { prefer, headers: extra, ...init } = opts;
  const r = await fetch(`${url}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers: {
      ...restHeaders({ prefer, json: init.body != null }),
      ...(extra || {}),
    },
  });
  const text = await r.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!r.ok) {
    const msg =
      typeof data === 'object' && data?.message
        ? data.message
        : String(text || r.statusText).slice(0, 300);
    const err = new Error(`Supabase REST ${r.status}: ${msg}`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

export async function restGet(table, query = '') {
  const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return rest(`/rest/v1/${table}${q}`, { method: 'GET' });
}

export async function restInsert(table, rows, { upsert = false, onConflict } = {}) {
  // PostgREST: Prefer resolution=merge-duplicates + on_conflict for upsert
  const prefer = upsert
    ? 'resolution=merge-duplicates,return=representation'
    : 'return=representation';
  let path = `/rest/v1/${table}`;
  if (upsert && onConflict) {
    path += `?on_conflict=${encodeURIComponent(onConflict)}`;
  }
  return rest(path, {
    method: 'POST',
    prefer,
    body: JSON.stringify(rows),
  });
}

export async function restPatch(table, query, patch) {
  const q = query.startsWith('?') ? query : `?${query}`;
  return rest(`/rest/v1/${table}${q}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: JSON.stringify(patch),
  });
}

export async function restDelete(table, query) {
  const q = query.startsWith('?') ? query : `?${query}`;
  return rest(`/rest/v1/${table}${q}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
  });
}

/** storage download JSON object; 404 → null.
 * Cache-busting query param defeats the storage CDN's stale window — these
 * JSON stores are read-modify-write shared state, so a stale read loses data. */
export async function storageGetJson(bucket, objectPath) {
  const { url } = supabaseConfig();
  const r = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}?cb=${Date.now()}`, {
    headers: restHeaders({ json: false }),
    cache: 'no-store',
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Storage get ${objectPath} (${r.status}): ${t.slice(0, 200)}`);
  }
  return r.json();
}

export async function storagePutJson(bucket, objectPath, data) {
  const { url } = supabaseConfig();
  const r = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      ...restHeaders({ json: true }),
      'x-upsert': 'true',
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Storage put ${objectPath} (${r.status}): ${t.slice(0, 200)}`);
  }
}
