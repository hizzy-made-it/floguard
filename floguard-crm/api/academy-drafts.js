/**
 * FloGuard Sales Rev Outbound Desk — drafts (human approve gate).
 * Storage: <bucket>/drafts.json OR Postgres public.drafts
 * POST body:
 *   { action: 'list'|'append'|'update'|'approve'|'reject'|'mark_sent', draft?, id?, limit? }
 * Auth: Bearer session OR X-Academy-Sync-Secret
 */
import { timingSafeEqual } from 'crypto';
import {
  dataBackend,
  verifySessionToken,
} from '../server/lib/academy-db.js';
import { storageGetJson, storagePutJson } from '../server/lib/supabase-rest.js';
import * as pg from '../server/lib/academy-pg.js';
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';

export const config = { maxDuration: 30 };

const BUCKET = process.env.ACADEMY_STORAGE_BUCKET || 'floguard-academy';
const OBJECT = 'drafts.json';
const MAX = 10000;

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function syncSecretOk(req) {
  const configured = process.env.ACADEMY_SYNC_SECRET || '';
  if (!configured) return false;
  const got = String(req.headers?.['x-academy-sync-secret'] || '');
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function newId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function loadDraftsStorage() {
  const data = await storageGetJson(BUCKET, OBJECT);
  if (!data || !Array.isArray(data.drafts)) return { drafts: [], updated_at: null };
  return data;
}

async function saveDraftsStorage(store) {
  const updated_at = new Date().toISOString();
  await storagePutJson(BUCKET, OBJECT, { drafts: store.drafts || [], updated_at });
  return updated_at;
}

function draftFromPg(row) {
  return {
    id: row.id,
    lead_id: row.lead_id,
    lead_key: row.meta?.lead_key || '',
    channel: row.channel || 'email',
    status: row.status || 'pending_approval',
    subject: row.subject || '',
    body: row.body || '',
    alternate_body: row.alternate_body || '',
    follow_up_body: row.follow_up_body || '',
    subjects: Array.isArray(row.subjects) ? row.subjects : [],
    meta: row.meta || {},
    approved_by: row.approved_by || '',
    approved_at: row.approved_at || null,
    sent_at: row.sent_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function usePg() {
  const mode = dataBackend();
  if (mode === 'storage') return false;
  try {
    return await pg.pgIsReady();
  } catch {
    return false;
  }
}

async function listDrafts({ limit = 200, status } = {}) {
  if (await usePg()) {
    try {
      const orgId = await pg.resolveOrgId();
      const { restGet } = await import('../server/lib/supabase-rest.js');
      let q = `select=*&org_id=eq.${orgId}&order=created_at.desc&limit=${Math.min(limit, 1000)}`;
      if (status) q += `&status=eq.${encodeURIComponent(status)}`;
      const rows = await restGet('drafts', q);
      return { drafts: (rows || []).map(draftFromPg), backend: 'postgres' };
    } catch (e) {
      if (dataBackend() === 'postgres') throw e;
    }
  }
  const store = await loadDraftsStorage();
  let drafts = store.drafts || [];
  if (status) drafts = drafts.filter((d) => d.status === status);
  drafts = drafts.slice(-limit).reverse();
  return { drafts, backend: 'storage', updated_at: store.updated_at };
}

async function appendDraft(raw, user) {
  const entry = {
    id: raw.id || newId(),
    lead_id: raw.lead_id ?? null,
    lead_key: String(raw.lead_key || ''),
    channel: String(raw.channel || 'email'),
    status: 'pending_approval',
    subject: String(raw.subject || ''),
    body: String(raw.body || ''),
    alternate_body: String(raw.alternate_body || ''),
    follow_up_body: String(raw.follow_up_body || ''),
    subjects: Array.isArray(raw.subjects) ? raw.subjects : [],
    meta: {
      ...(raw.meta && typeof raw.meta === 'object' ? raw.meta : {}),
      lead_key: String(raw.lead_key || ''),
      created_by: user || 'system',
    },
    approved_by: '',
    approved_at: null,
    sent_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (await usePg()) {
    try {
      const orgId = await pg.resolveOrgId();
      const { restInsert } = await import('../server/lib/supabase-rest.js');
      const row = {
        org_id: orgId,
        lead_id: null,
        channel: entry.channel,
        status: entry.status,
        subject: entry.subject,
        body: entry.body,
        alternate_body: entry.alternate_body,
        follow_up_body: entry.follow_up_body,
        subjects: entry.subjects,
        meta: entry.meta,
      };
      const inserted = await restInsert('drafts', row);
      const saved = Array.isArray(inserted) ? inserted[0] : inserted;
      if (dataBackend() === 'dual' || dataBackend() === 'auto') {
        const store = await loadDraftsStorage();
        const drafts = store.drafts || [];
        drafts.push({ ...entry, id: saved?.id || entry.id });
        while (drafts.length > MAX) drafts.shift();
        await saveDraftsStorage({ drafts });
      }
      return draftFromPg(saved || row);
    } catch (e) {
      if (dataBackend() === 'postgres') throw e;
    }
  }

  const store = await loadDraftsStorage();
  const drafts = Array.isArray(store.drafts) ? store.drafts.slice() : [];
  drafts.push(entry);
  while (drafts.length > MAX) drafts.shift();
  await saveDraftsStorage({ drafts });
  return entry;
}

async function updateDraft(id, patch, user) {
  if (!id) throw new Error('id required');
  if (await usePg()) {
    try {
      const { restPatch, restGet } = await import('../server/lib/supabase-rest.js');
      const orgId = await pg.resolveOrgId();
      const body = {
        ...(patch.subject != null ? { subject: String(patch.subject) } : {}),
        ...(patch.body != null ? { body: String(patch.body) } : {}),
        ...(patch.alternate_body != null
          ? { alternate_body: String(patch.alternate_body) }
          : {}),
        ...(patch.follow_up_body != null
          ? { follow_up_body: String(patch.follow_up_body) }
          : {}),
        ...(patch.status != null ? { status: String(patch.status) } : {}),
        ...(patch.approved_by != null ? { approved_by: String(patch.approved_by) } : {}),
        ...(patch.approved_at != null ? { approved_at: patch.approved_at } : {}),
        ...(patch.sent_at != null ? { sent_at: patch.sent_at } : {}),
      };
      const rows = await restPatch(
        'drafts',
        `id=eq.${encodeURIComponent(id)}&org_id=eq.${orgId}`,
        body,
      );
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row) return draftFromPg(row);
      // fallback get
      const got = await restGet('drafts', `id=eq.${encodeURIComponent(id)}&limit=1`);
      return draftFromPg((got && got[0]) || { id, ...body });
    } catch (e) {
      if (dataBackend() === 'postgres') throw e;
    }
  }

  const store = await loadDraftsStorage();
  const drafts = store.drafts || [];
  const i = drafts.findIndex((d) => String(d.id) === String(id));
  if (i < 0) throw new Error('Draft not found');
  drafts[i] = {
    ...drafts[i],
    ...patch,
    updated_at: new Date().toISOString(),
    ...(user && patch.status === 'approved' ? { approved_by: user } : {}),
  };
  await saveDraftsStorage({ drafts });
  return drafts[i];
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const ip = clientIp(req);
  const rl = rateLimit(`drafts:${ip}`, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec || 60));
    return json(res, 429, { error: 'Too many requests.' });
  }

  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const viaSecret = syncSecretOk(req);
  const session = viaSecret ? null : verifySessionToken(bearer(req));
  if (!viaSecret && !session) {
    return json(res, 401, { error: 'Sign in or provide sync secret.' });
  }

  const user = session?.u || body.user || 'sync';
  const action = String(body.action || '').toLowerCase();

  try {
    if (action === 'list') {
      const out = await listDrafts({
        limit: Number(body.limit) || 200,
        status: body.status || undefined,
      });
      return json(res, 200, { ...out, count: out.drafts.length });
    }

    if (action === 'append') {
      const raw = body.draft;
      if (!raw || typeof raw !== 'object') {
        return json(res, 400, { error: 'draft object required' });
      }
      if (!String(raw.body || raw.subject || '').trim()) {
        return json(res, 400, { error: 'draft needs subject or body' });
      }
      const saved = await appendDraft(raw, user);
      return json(res, 201, { ok: true, draft: saved });
    }

    if (action === 'update') {
      const id = body.id || body.draft?.id;
      const patch = body.patch || body.draft || {};
      const saved = await updateDraft(id, patch, user);
      return json(res, 200, { ok: true, draft: saved });
    }

    if (action === 'approve') {
      const id = body.id;
      const saved = await updateDraft(
        id,
        {
          status: 'approved',
          approved_by: user,
          approved_at: new Date().toISOString(),
        },
        user,
      );
      return json(res, 200, { ok: true, draft: saved });
    }

    if (action === 'reject') {
      const id = body.id;
      const saved = await updateDraft(id, { status: 'rejected' }, user);
      return json(res, 200, { ok: true, draft: saved });
    }

    if (action === 'mark_sent') {
      const id = body.id;
      const saved = await updateDraft(
        id,
        { status: 'sent', sent_at: new Date().toISOString() },
        user,
      );
      return json(res, 200, { ok: true, draft: saved });
    }

    return json(res, 400, {
      error: 'Unknown action. Use list, append, update, approve, reject, mark_sent.',
    });
  } catch (e) {
    return json(res, 500, {
      error: 'Drafts error',
      detail: String(e?.message || e).slice(0, 300),
    });
  }
}
