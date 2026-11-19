/**
 * In-memory fake of the slice of Supabase the leads code uses: PostgREST tables
 * (eq/is/gt/lt/in/or-keyset, order, limit, offset, Prefer return=representation),
 * the 017 triggers (updated_at, legacy_id), the unique live parcel_id index, two views,
 * and Storage JSON objects. Installed over globalThis.fetch.
 */
import { randomUUID } from 'node:crypto';

const BASE_MS = Date.parse('2026-11-19T12:00:00.000Z');

export function installFakeSupabase({ pipelineReady = true, uniqueParcel = true } = {}) {
  const state = {
    tables: {
      organizations: [{ id: '00000000-0000-4000-8000-000000000001', slug: 'floguard' }],
      leads: [],
      lead_activity: [],
      lead_tasks: [],
    },
    storage: new Map(),
    pipelineReady,
    uniqueParcel,
    tick: 0,
    calls: [],
  };
  const now = () => new Date(BASE_MS + ++state.tick * 1000).toISOString().replace('Z', '+00:00');
  const isoRe = /^\d{4}-\d\d-\d\dT/;
  const cmp = (a, b) => {
    if (typeof a === 'string' && typeof b === 'string' && isoRe.test(a) && isoRe.test(b)) return Date.parse(a) - Date.parse(b);
    if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  };
  const eq = (a, b) => (a == null ? false : cmp(a, b) === 0);

  function filterRows(rows, params) {
    let out = rows.slice();
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
      if (k === 'or') {
        const m = v.match(/^\(updated_at\.gt\.(.+?),and\(updated_at\.eq\.(.+?),id\.gt\.(.+?)\)\)$/);
        if (!m) throw new Error(`fake: unsupported or=${v}`);
        out = out.filter((r) => cmp(r.updated_at, m[1]) > 0 || (cmp(r.updated_at, m[2]) === 0 && cmp(r.id, m[3]) > 0));
        continue;
      }
      const dot = v.indexOf('.');
      const op = v.slice(0, dot);
      const val = v.slice(dot + 1);
      if (op === 'eq') out = out.filter((r) => eq(r[k], val) || (typeof r[k] === 'boolean' && String(r[k]) === val));
      else if (op === 'is') out = out.filter((r) => (val === 'null' ? r[k] == null : r[k] != null));
      else if (op === 'gt') out = out.filter((r) => r[k] != null && cmp(r[k], val) > 0);
      else if (op === 'lt') out = out.filter((r) => r[k] != null && cmp(r[k], val) < 0);
      else if (op === 'in') {
        const set = new Set(val.replace(/^\(|\)$/g, '').split(','));
        out = out.filter((r) => set.has(String(r[k])));
      } else throw new Error(`fake: unsupported filter ${k}=${v}`);
    }
    const order = params.get('order');
    if (order) {
      const specs = order.split(',').map((s) => s.split('.'));
      out.sort((a, b) => {
        for (const [f, dir] of specs) {
          const c = cmp(a[f], b[f]);
          if (c) return dir === 'desc' ? -c : c;
        }
        return 0;
      });
    }
    const off = Number(params.get('offset') || 0);
    const lim = params.get('limit') ? Number(params.get('limit')) : out.length;
    return out.slice(off, off + lim);
  }

  function view(name) {
    if (name === 'lead_funnel') {
      const by = {};
      for (const l of state.tables.leads.filter((x) => !x.deleted_at)) {
        by[l.stage] = by[l.stage] || { stage: l.stage, leads: 0, amount: 0 };
        by[l.stage].leads += 1;
        by[l.stage].amount += Number(l.amount) || 0;
      }
      return Object.values(by);
    }
    if (name === 'lead_tasks_due') {
      const cutoff = state.dueCutoff || '2026-11-20T05:00:00+00:00';
      const startOfDay = state.dayStart || '2026-11-19T05:00:00+00:00';
      return state.tables.lead_tasks
        .filter((t) => !t.done_at && cmp(t.due_at, cutoff) < 0)
        .map((t) => {
          const l = state.tables.leads.find((x) => x.id === t.lead_id);
          return l && !l.deleted_at
            ? { ...t, bucket: cmp(t.due_at, startOfDay) < 0 ? 'overdue' : 'today', lead_name: l.name, lead_phone: l.phone, lead_stage: l.stage, lead_phone_dnc: l.phone_dnc }
            : null;
        })
        .filter(Boolean);
    }
    return null;
  }

  function withDefaults(table, row, ts) {
    const r = { ...row };
    if (table === 'leads') {
      r.id = r.id || randomUUID();
      r.created_at = r.created_at || ts;
      r.updated_at = ts;
      r.deleted_at = r.deleted_at ?? null;
      if (r.legacy_id == null || r.legacy_id === '') {
        const nums = state.tables.leads.map((l) => l.legacy_id).filter((x) => /^[0-9]+$/.test(String(x))).map(Number);
        r.legacy_id = String(Math.max(0, ...nums) + 1);
      }
      r.phones = r.phones ?? [];
      r.data = r.data ?? {};
    } else {
      r.id = r.id || randomUUID();
      r.created_at = r.created_at || ts;
      if (table === 'lead_activity') r.at = r.at || ts;
      if (table === 'lead_tasks') {
        r.updated_at = ts;
        r.done_at = r.done_at ?? null;
        r.is_next_action = r.is_next_action ?? false;
      }
    }
    return r;
  }

  function parcelClash(candidate, exceptId) {
    if (!state.uniqueParcel || !candidate.parcel_id || candidate.deleted_at) return false;
    return state.tables.leads.some((l) => l.id !== exceptId && !l.deleted_at && l.parcel_id === candidate.parcel_id);
  }

  const pgErr = (status, message) => new Response(JSON.stringify({ message, code: '23505' }), { status, headers: { 'content-type': 'application/json' } });
  const ok = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

  async function fake(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    state.calls.push({ method, path: url.pathname, search: url.search });
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const key = decodeURIComponent(url.pathname.replace('/storage/v1/object/', ''));
      if (method === 'GET') {
        return state.storage.has(key) ? new Response(state.storage.get(key), { status: 200 }) : new Response('{}', { status: 404 });
      }
      state.storage.set(key, init.body);
      return ok({ Key: key });
    }
    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m) return new Response('{"message":"bad path"}', { status: 404 });
    const table = m[1];
    const params = url.searchParams;
    const v = view(table);
    if (v) return ok(filterRows(v, params));
    if (!state.tables[table]) return new Response(JSON.stringify({ message: `no table ${table}` }), { status: 404 });
    if (table === 'leads' && !state.pipelineReady && /stage|data|deleted_at|parcel_id/.test(params.get('select') || '')) {
      return new Response(JSON.stringify({ message: 'column leads.stage does not exist' }), { status: 400 });
    }
    if (method === 'GET') return ok(filterRows(state.tables[table], params).map((r) => ({ ...r })));
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const arr = Array.isArray(body) ? body : [body];
      const ts = now();
      const staged = [];
      for (const raw of arr) {
        const row = withDefaults(table, raw, ts);
        if (table === 'leads') {
          if (parcelClash(row)) return pgErr(409, 'duplicate key value violates unique constraint "leads_parcel_id_uidx"');
        }
        state.tables[table].push(row);
        staged.push(row);
      }
      return ok(staged.map((r) => ({ ...r })), 201);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(init.body);
      const ts = now();
      const hit = filterRows(state.tables[table], params);
      const out = [];
      for (const row of hit) {
        const next = { ...row, ...patch };
        if (table === 'leads' && parcelClash(next, row.id)) return pgErr(409, 'duplicate key (parcel)');
        Object.assign(row, patch);
        if (table === 'leads' || table === 'lead_tasks') row.updated_at = ts;
        out.push({ ...row });
      }
      return ok(out);
    }
    if (method === 'DELETE') {
      const hit = new Set(filterRows(state.tables[table], params));
      state.tables[table] = state.tables[table].filter((r) => !hit.has(r));
      return new Response(null, { status: 204 });
    }
    return new Response('{}', { status: 405 });
  }

  const realFetch = globalThis.fetch;
  globalThis.fetch = fake;
  state.restore = () => {
    globalThis.fetch = realFetch;
  };
  /** Seed a lead row the way the API would (bypasses PostgREST). */
  state.seedLead = (row) => {
    const r = withDefaults('leads', { org_id: state.tables.organizations[0].id, ...row }, now());
    state.tables.leads.push(r);
    return r;
  };
  return state;
}

/** Minimal req/res for the handler. */
let ipSeq = 0;
export function makeReqRes({ body, secret, token, method = 'POST' } = {}) {
  ipSeq += 1;
  const headers = { 'x-forwarded-for': `10.1.${Math.floor(ipSeq / 250)}.${ipSeq % 250}` };
  if (secret) headers['x-academy-sync-secret'] = secret;
  if (token) headers.authorization = `Bearer ${token}`;
  const req = { method, headers, body };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(s) {
      this.body = s ? JSON.parse(s) : null;
    },
  };
  return { req, res };
}

export async function callHandler(handler, body, opts = {}) {
  const { req, res } = makeReqRes({ body, secret: opts.secret ?? 'test-secret', token: opts.token });
  await handler(req, res);
  return { status: res.statusCode, body: res.body };
}
