/**
 * Shared FloGuard Sales Rev leads store.
 *
 * POST body: { action, ... }. Full request/response contract: docs/handoff/C.md.
 *
 * Legacy actions (work on every backend, shapes unchanged for the browser + LeadAgent CLI):
 *   list | push | bulk_upsert | replace | prune_placeholders
 * Pipeline actions (Postgres backend only; 501 {error:'postgres_backend_required'} otherwise):
 *   get | patch | delete | activity_add | activity_list | task_add | task_done | tasks_due | funnel
 * Estimate / job / invoice-record actions (agent G; Postgres only, need fsi/sql/020; contract in
 *   docs/handoff/G.md): estimate_catalog | estimate_create | estimate_update | estimate_list |
 *   estimate_get | estimate_send | estimate_void | job_create_from_estimate | job_update |
 *   invoice_mark | jobs_list
 *   and `list` with since / cursor / limit.
 *
 * Auth (either):
 *   - Authorization: Bearer <academy session token>   (browser reps)
 *   - X-Academy-Sync-Secret: <ACADEMY_SYNC_SECRET>    (LeadAgent CLI)
 * `replace` requires the sync secret (full overwrite — CLI ops only).
 *
 * Identity / merge rules live in server/lib/leads-core.js:
 *   match by uuid/id, then parcel_id, then name+city (+address when both have one);
 *   union `lists`; incoming non-empty fields win, empty fields never clear existing
 *   values; phone_dnc === true is never cleared by a merge.
 */
import { timingSafeEqual } from 'crypto';
import {
  BackendError,
  getLeadsPipeline,
  loadLeadsStore,
  mirrorLeadsToStorage,
  saveLeadsStore,
  verifySessionToken,
} from '../server/lib/academy-db.js';
import { LeadsError } from '../server/lib/academy-pg.js';
import { applyPlanToStoreLeads, planUpsert } from '../server/lib/leads-core.js';
import { ESTIMATE_ACTIONS, runEstimateAction } from '../server/lib/estimates.js';
import { setCors, json, parseBody, rateLimit, clientIp } from '../server/lib/http.js';

export const config = { maxDuration: 30 };

const MAX_LEADS = 20000;
const PIPELINE_ACTIONS = new Set([
  'get', 'patch', 'delete', 'activity_add', 'activity_list', 'task_add', 'task_done', 'tasks_due', 'funnel',
]);
const ESTIMATE_ACTION_SET = new Set(ESTIMATE_ACTIONS);

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

/** Category-grid shells and List-A synthetic rows — not dialable businesses. */
function isPlaceholderLead(l) {
  const name = String(l?.name || '').trim();
  if (!name) return true;
  if (/^\(business name\)$/i.test(name)) return true;
  // e.g. "Lawn care / landscaping prospect — Daytona Beach"
  if (/\bprospect\s*[—–-]\s*/i.test(name)) return true;
  const notes = String(l?.notes || '');
  if (/no-website service prospect/i.test(notes) && !name) return true;
  if (
    /Category seed:/i.test(notes) &&
    /\bprospect\b/i.test(name) &&
    !String(l?.phone || '').trim() &&
    !String(l?.website || '').trim()
  ) {
    return true;
  }
  return false;
}

function leadRef(body) {
  return body.lead_id ?? body.id ?? body.uuid ?? null;
}

function skippedOf(counts) {
  return {
    noop: counts.skip_noop,
    invalid: counts.skip_invalid,
    deleted: counts.skip_deleted,
  };
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const ip = clientIp(req);
  const rl = rateLimit(`leads-api:${ip}`, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec || 60));
    return json(res, 429, { error: 'Too many requests.' });
  }

  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON body' });

  const viaSecret = syncSecretOk(req);
  const session = viaSecret ? null : verifySessionToken(bearer(req));
  if (!viaSecret && !session) {
    return json(res, 401, { error: 'Sign in (or provide a valid sync secret) to use the leads store.' });
  }

  const action = String(body.action || '').toLowerCase();
  const actor = viaSecret ? String(body.actor || 'sync').slice(0, 80) : String(session.u || 'rep').slice(0, 80);

  try {
    const pipe = await getLeadsPipeline();
    const wantsPaging = !!(body.since || body.cursor || body.limit);

    if (PIPELINE_ACTIONS.has(action) || ESTIMATE_ACTION_SET.has(action) || (action === 'list' && wantsPaging)) {
      if (!pipe) {
        return json(res, 501, {
          error: 'postgres_backend_required',
          detail: `Action "${action}"${action === 'list' ? ' with since/cursor/limit' : ''} needs the Postgres leads pipeline (ACADEMY_DATA_BACKEND=postgres|dual|auto with fsi/sql/017 applied).`,
        });
      }
    }

    // ---- list ----------------------------------------------------------
    if (action === 'list') {
      if (pipe) {
        const r = await pipe.pgListLeads({
          since: body.since || null,
          cursor: body.cursor || null,
          limit: body.limit ? Number(body.limit) : null,
          includeDeleted: body.include_deleted === undefined ? undefined : !!body.include_deleted,
        });
        return json(res, 200, {
          leads: r.leads,
          count: r.leads.length,
          updated_at: r.updated_at || null,
          next_cursor: r.next_cursor,
          has_more: r.has_more,
        });
      }
      const store = await loadLeadsStore();
      return json(res, 200, {
        leads: store.leads,
        count: store.leads.length,
        updated_at: store.updated_at || null,
      });
    }

    // ---- push / bulk_upsert -------------------------------------------
    if (action === 'push' || action === 'bulk_upsert') {
      const incoming = body.leads;
      if (!Array.isArray(incoming)) {
        return json(res, 400, { error: 'leads must be an array.' });
      }
      if (incoming.length > MAX_LEADS) {
        return json(res, 400, { error: `Too many leads (max ${MAX_LEADS}).` });
      }
      if (pipe) {
        const r = await pipe.pgUpsertLeads(incoming, { actor, maxLive: MAX_LEADS });
        await mirrorLeadsToStorage();
        return json(res, 200, {
          ok: true,
          count: r.count,
          added: r.added,
          merged: r.merged,
          updated: r.updated,
          skipped: skippedOf(r.counts),
          conflicts: r.conflicts.slice(0, 20),
          updated_at: r.updated_at,
        });
      }
      const store = await loadLeadsStore();
      const existing = Array.isArray(store.leads) ? store.leads : [];
      const plan = planUpsert(existing, incoming);
      const leads = applyPlanToStoreLeads(existing, plan);
      if (leads.length > MAX_LEADS) {
        return json(res, 400, { error: `Store would exceed ${MAX_LEADS} leads.` });
      }
      const changed = plan.inserts.length + plan.updates.length > 0;
      const updated_at = changed ? await saveLeadsStore({ leads }) : store.updated_at || null;
      return json(res, 200, {
        ok: true,
        count: leads.length,
        added: plan.inserts.length,
        merged: plan.updates.length + plan.counts.skip_noop,
        updated: plan.updates.length,
        skipped: skippedOf(plan.counts),
        conflicts: plan.conflicts.slice(0, 20),
        updated_at,
      });
    }

    // ---- replace (CLI) -------------------------------------------------
    if (action === 'replace') {
      if (!viaSecret) {
        return json(res, 403, { error: 'replace requires the sync secret.' });
      }
      const incoming = body.leads;
      if (!Array.isArray(incoming) || incoming.length > MAX_LEADS) {
        return json(res, 400, { error: 'leads must be an array within the size limit.' });
      }
      if (pipe) {
        const r = await pipe.pgUpsertLeads(incoming, { replace: true, prune: true, actor, maxLive: MAX_LEADS });
        await mirrorLeadsToStorage();
        return json(res, 200, { ok: true, count: r.count, pruned: r.pruned, updated_at: r.updated_at });
      }
      const updated_at = await saveLeadsStore({ leads: incoming });
      return json(res, 200, { ok: true, count: incoming.length, updated_at });
    }

    // ---- prune_placeholders -------------------------------------------
    if (action === 'prune_placeholders') {
      const store = await loadLeadsStore();
      const before = Array.isArray(store.leads) ? store.leads : [];
      const kept = before.filter((l) => !isPlaceholderLead(l));
      const removed = before.length - kept.length;
      if (removed > 0) {
        let updated_at;
        if (pipe) {
          await pipe.pgSoftDeleteLeads(before.filter((l) => isPlaceholderLead(l)).map((l) => l.uuid).filter(Boolean));
          await mirrorLeadsToStorage();
          updated_at = new Date().toISOString();
        } else {
          updated_at = await saveLeadsStore({ leads: kept });
        }
        return json(res, 200, { ok: true, removed, remaining: kept.length, leads: kept, updated_at });
      }
      return json(res, 200, {
        ok: true,
        removed: 0,
        remaining: kept.length,
        leads: kept,
        updated_at: store.updated_at || null,
      });
    }

    // ---- pipeline actions ---------------------------------------------
    if (action === 'get') {
      const r = await pipe.pgGetLead(leadRef(body), { activityLimit: body.activity_limit });
      return json(res, 200, { ok: true, ...r });
    }

    if (action === 'patch') {
      const r = await pipe.pgPatchLead(leadRef(body), body.patch, {
        expectedUpdatedAt: body.updated_at || null,
        actor,
        confirmDncClear: body.confirm_dnc_clear === true,
      });
      if (r.conflict) {
        return json(res, 409, {
          error: 'conflict',
          detail: 'The lead changed since you loaded it. Re-apply your edit on top of `lead`.',
          lead: r.conflict,
        });
      }
      await mirrorLeadsToStorage();
      return json(res, 200, { ok: true, lead: r.lead });
    }

    if (action === 'delete') {
      const r = await pipe.pgDeleteLead(leadRef(body), {
        actor,
        restore: body.restore === true,
        expectedUpdatedAt: body.updated_at || null,
      });
      if (r.conflict) {
        return json(res, 409, { error: 'conflict', detail: 'The lead changed since you loaded it.', lead: r.conflict });
      }
      await mirrorLeadsToStorage();
      return json(res, 200, { ok: true, id: r.id, deleted_at: r.deleted_at, updated_at: r.updated_at });
    }

    if (action === 'activity_add') {
      const activity = await pipe.pgAddLeadActivity(leadRef(body), body, { actor });
      return json(res, 200, { ok: true, activity });
    }

    if (action === 'activity_list') {
      const activity = await pipe.pgListLeadActivity(leadRef(body), { limit: body.limit, before: body.before || null });
      return json(res, 200, { ok: true, activity, count: activity.length });
    }

    if (action === 'task_add') {
      const r = await pipe.pgAddTask(leadRef(body), body, { actor });
      return json(res, 200, { ok: true, task: r.task, lead: r.lead });
    }

    if (action === 'task_done') {
      const r = await pipe.pgCompleteTask(body.task_id, { actor, note: body.note || null });
      return json(res, 200, { ok: true, task: r.task, lead: r.lead });
    }

    if (action === 'tasks_due') {
      const r = await pipe.pgTasksDue({ leadId: leadRef(body) });
      return json(res, 200, { ok: true, tasks: r.tasks, counts: r.counts, as_of: new Date().toISOString() });
    }

    if (action === 'funnel') {
      const r = await pipe.pgFunnel();
      return json(res, 200, { ok: true, ...r, as_of: new Date().toISOString() });
    }

    if (ESTIMATE_ACTION_SET.has(action)) {
      const r = await runEstimateAction(action, body, { actor });
      if (action !== 'estimate_catalog' && action !== 'estimate_list' && action !== 'estimate_get' && action !== 'jobs_list') {
        await mirrorLeadsToStorage(); // stage moves (estimate_send) touch leads; keeps dual mode in step
      }
      return json(res, 200, { ok: true, ...r });
    }

    return json(res, 400, {
      error:
        'Unknown action. Use list, push, bulk_upsert, replace, prune_placeholders, get, patch, delete, activity_add, activity_list, task_add, task_done, tasks_due, funnel, or an estimate/job action (estimate_create, estimate_update, estimate_list, estimate_get, estimate_send, estimate_void, estimate_catalog, job_create_from_estimate, job_update, invoice_mark, jobs_list).',
    });
  } catch (e) {
    if (e instanceof LeadsError) {
      return json(res, e.status, { error: e.code, detail: e.message, ...e.extra });
    }
    if (e instanceof BackendError) {
      return json(res, e.status, { error: e.code, detail: e.message });
    }
    return json(res, 500, { error: 'Leads store error', detail: String(e?.message || e).slice(0, 300) });
  }
}
