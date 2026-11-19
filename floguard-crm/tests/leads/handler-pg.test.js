import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ACADEMY_SYNC_SECRET = 'test-secret';
process.env.ACADEMY_DATA_BACKEND = 'postgres';

const { installFakeSupabase, callHandler } = await import('./helpers/fake-supabase.js');
const fake = installFakeSupabase();
const { default: handler } = await import('../../api/academy-leads.js');

after(() => fake.restore());

const call = (body, opts) => callHandler(handler, body, opts);
const live = () => fake.tables.leads.filter((l) => !l.deleted_at);
const byName = (n) => fake.tables.leads.find((l) => l.name === n);

before(async () => {
  const r = await call({
    action: 'push',
    leads: [
      { id: 1, name: 'Alpha Drainage', city: 'Daytona Beach', phone: '(386) 555-0001', status: 'New', lists: ['FrenchDrain'], list: 'FrenchDrain', website_score: { total: 10, grade: 'F' } },
      { id: 2, name: 'Beta Roofing', city: 'Ormond Beach', status: 'Quoted', list_status: { FrenchDrain: 'Quoted' }, lists: ['FrenchDrain'], list: 'FrenchDrain', next_follow_up_at: '2026-11-25' },
      { id: 3, name: 'Gamma Owner', city: 'Port Orange', address: '10 Elm St', parcel_id: 'P-100' },
    ],
  });
  assert.equal(r.status, 200);
});

test('auth: needs a session or the sync secret', async () => {
  const r = await callHandler(handler, { action: 'list' }, { secret: 'wrong' });
  assert.equal(r.status, 401);
});

test('push response keeps the legacy shape and rows land with derived stage', () => {
  assert.equal(live().length, 3);
  assert.equal(byName('Alpha Drainage').stage, 'new');
  assert.equal(byName('Beta Roofing').stage, 'estimate_sent');
  assert.equal(byName('Alpha Drainage').data.website_score.grade, 'F', 'unknown browser fields go to data');
});

test('legacy list shape: { leads, count, updated_at } with numeric ids and browser fields intact', async () => {
  const r = await call({ action: 'list' });
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 3);
  assert.equal(r.body.leads.length, 3);
  assert.ok(r.body.updated_at);
  const beta = r.body.leads.find((l) => l.name === 'Beta Roofing');
  assert.equal(typeof beta.id, 'number');
  assert.equal(beta.next_follow_up_at, '2026-11-25', 'original date string preserved');
  assert.equal(beta.list_status.FrenchDrain, 'Quoted');
  assert.equal(beta.stage, 'estimate_sent');
  assert.ok(beta.uuid && beta.updated_at);
  const alpha = r.body.leads.find((l) => l.name === 'Alpha Drainage');
  assert.deepEqual(alpha.website_score, { total: 10, grade: 'F' });
});

test('bulk_upsert/push: legacy response keys; merging does not duplicate; no-op push does not touch updated_at', async () => {
  const before = byName('Alpha Drainage').updated_at;
  const r = await call({ action: 'bulk_upsert', leads: [{ name: 'alpha drainage', city: 'daytona beach', phone: '' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  for (const k of ['count', 'added', 'merged', 'updated_at']) assert.ok(k in r.body, k);
  assert.equal(r.body.added, 0);
  assert.equal(r.body.merged, 1);
  assert.equal(live().length, 3);
  assert.equal(byName('Alpha Drainage').updated_at, before);
  assert.equal(byName('Alpha Drainage').phone, '(386) 555-0001', 'empty never clears');
});

test('same-name owners at different addresses are two leads; same address merges', async () => {
  let r = await call({ action: 'push', leads: [{ name: 'Gamma Owner', city: 'Port Orange', address: '77 Oak Ave' }] });
  assert.equal(r.body.added, 1);
  r = await call({ action: 'push', leads: [{ name: 'Gamma Owner', city: 'Port Orange', address: '10 elm street', notes: 'hi' }] });
  assert.equal(r.body.added, 0);
  assert.equal(fake.tables.leads.filter((l) => l.name === 'Gamma Owner').length, 2);
  assert.equal(fake.tables.leads.find((l) => l.parcel_id === 'P-100').notes, 'hi');
});

test('parcel_id match merges even with a different name', async () => {
  const r = await call({ action: 'push', leads: [{ name: 'Gamma Holdings LLC', city: 'Port Orange', parcel_id: 'P-100', phone: '3865550777' }] });
  assert.equal(r.body.added, 0);
  assert.equal(fake.tables.leads.find((l) => l.parcel_id === 'P-100').phone, '3865550777');
});

test('unique parcel index race (another writer inserts between plan and write) falls back to a merge', async () => {
  const realFetch = globalThis.fetch;
  let raced = false;
  globalThis.fetch = async (input, init) => {
    if (!raced && (init?.method || 'GET') === 'POST' && String(input).includes('/rest/v1/leads')) {
      raced = true;
      fake.seedLead({ name: 'Rival Entry', city: 'Z', parcel_id: 'P-RACE', status: 'New', stage: 'new', notes: 'from rival' });
    }
    return realFetch(input, init);
  };
  try {
    const r = await call({ action: 'push', leads: [{ name: 'Racer', city: 'Z', parcel_id: 'P-RACE', phone: '3865550888' }] });
    assert.equal(r.status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
  const rows = fake.tables.leads.filter((l) => l.parcel_id === 'P-RACE');
  assert.equal(rows.length, 1, 'no duplicate parcel row');
  assert.equal(rows[0].phone, '3865550888');
  assert.equal(rows[0].notes, 'from rival');
});

test('DNC survives a merge from a stale browser copy', async () => {
  await call({ action: 'push', leads: [{ name: 'Dnc Person', city: 'X', phone: '(386) 555-0200', phone_dnc: true }] });
  assert.equal(byName('Dnc Person').phone_dnc, true);
  for (const inc of [{}, { phone_dnc: null }, { phone_dnc: '' }, { phone_dnc: false }]) {
    await call({ action: 'push', leads: [{ name: 'Dnc Person', city: 'X', phone: '(386) 555-0200', notes: JSON.stringify(inc), ...inc }] });
    assert.equal(byName('Dnc Person').phone_dnc, true, JSON.stringify(inc));
  }
});

test('get returns lead + activity + tasks; unknown lead is 404', async () => {
  const alpha = byName('Alpha Drainage');
  const r = await call({ action: 'get', lead_id: alpha.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.lead.name, 'Alpha Drainage');
  assert.ok(Array.isArray(r.body.activity) && Array.isArray(r.body.tasks));
  const byLegacy = await call({ action: 'get', id: alpha.legacy_id });
  assert.equal(byLegacy.body.lead.uuid, alpha.id);
  assert.equal((await call({ action: 'get', lead_id: '99999' })).status, 404);
});

test('patch: partial update, stage_change activity, optimistic concurrency 409 with server copy', async () => {
  const alpha = byName('Alpha Drainage');
  const loaded = (await call({ action: 'get', lead_id: alpha.id })).body.lead;

  const ok = await call({ action: 'patch', lead_id: alpha.id, updated_at: loaded.updated_at, patch: { stage: 'assessment_booked', notes: 'booked for Tuesday' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.lead.stage, 'assessment_booked');
  assert.equal(ok.body.lead.notes, 'booked for Tuesday');
  assert.equal(ok.body.lead.phone, '(386) 555-0001', 'untouched fields stay');
  assert.notEqual(ok.body.lead.updated_at, loaded.updated_at);
  const act = fake.tables.lead_activity.filter((a) => a.lead_id === alpha.id && a.type === 'stage_change');
  assert.equal(act.length, 1);
  assert.deepEqual(act[0].meta.to, 'assessment_booked');

  // second client still holds the old updated_at
  const stale = await call({ action: 'patch', lead_id: alpha.id, updated_at: loaded.updated_at, patch: { notes: 'overwrite attempt' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'conflict');
  assert.equal(stale.body.lead.notes, 'booked for Tuesday');
  assert.equal(byName('Alpha Drainage').notes, 'booked for Tuesday');

  // retry on the server copy works
  const retry = await call({ action: 'patch', lead_id: alpha.id, updated_at: stale.body.lead.updated_at, patch: { notes: 'second thought' } });
  assert.equal(retry.status, 200);
});

test('patch: write-time race (row changes between read and conditional write) also returns 409', async () => {
  const beta = byName('Beta Roofing');
  const loaded = (await call({ action: 'get', lead_id: beta.id })).body.lead;
  const realFetch = globalThis.fetch;
  let bumped = false;
  globalThis.fetch = async (input, init) => {
    const u = String(input);
    if (!bumped && (init?.method || 'GET') === 'PATCH' && u.includes('/rest/v1/leads')) {
      bumped = true;
      await realFetch(`https://fake.supabase.co/rest/v1/leads?id=eq.${beta.id}`, { method: 'PATCH', body: JSON.stringify({ notes: 'other writer' }) });
    }
    return realFetch(input, init);
  };
  try {
    const r = await call({ action: 'patch', lead_id: beta.id, updated_at: loaded.updated_at, patch: { owner: 'rep1' } });
    assert.equal(r.status, 409);
    assert.equal(r.body.lead.notes, 'other writer');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('patch validation: bad stage, empty name, blocked system fields, DNC clear needs confirmation', async () => {
  const dnc = byName('Dnc Person');
  assert.equal((await call({ action: 'patch', lead_id: dnc.id, patch: { stage: 'bogus' } })).body.error, 'invalid_stage');
  assert.equal((await call({ action: 'patch', lead_id: dnc.id, patch: { name: '  ' } })).body.error, 'name_required');
  assert.equal((await call({ action: 'patch', lead_id: dnc.id, patch: { next_action: { type: 'call' } } })).body.error, 'invalid_next_action');
  assert.equal((await call({ action: 'patch', lead_id: dnc.id })).body.error, 'patch_required');
  const sys = await call({ action: 'patch', lead_id: dnc.id, patch: { id: 999, deleted_at: '2020-01-01', notes: 'sys' } });
  assert.equal(sys.status, 200);
  assert.equal(byName('Dnc Person').deleted_at, null);
  const refuse = await call({ action: 'patch', lead_id: dnc.id, patch: { phone_dnc: false } });
  assert.equal(refuse.status, 400);
  assert.equal(refuse.body.error, 'dnc_clear_requires_confirmation');
  assert.equal(byName('Dnc Person').phone_dnc, true);
  const clear = await call({ action: 'patch', lead_id: dnc.id, confirm_dnc_clear: true, patch: { phone_dnc: false } });
  assert.equal(clear.status, 200);
  assert.equal(clear.body.lead.phone_dnc, false);
  assert.ok(fake.tables.lead_activity.some((a) => a.lead_id === dnc.id && a.meta?.event === 'dnc_cleared'));
});

test('activity_add / activity_list', async () => {
  const alpha = byName('Alpha Drainage');
  const r = await call({ action: 'activity_add', lead_id: alpha.id, type: 'call', direction: 'outbound', outcome: 'no answer', body: 'left vm', meta: { duration: 12 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.activity.type, 'call');
  assert.equal(r.body.activity.actor, 'sync');
  assert.equal((await call({ action: 'activity_add', lead_id: alpha.id, type: 'carrier_pigeon' })).body.error, 'invalid_type');
  assert.equal((await call({ action: 'activity_add', lead_id: alpha.id, type: 'call', direction: 'sideways' })).body.error, 'invalid_direction');
  const list = await call({ action: 'activity_list', lead_id: alpha.id });
  assert.equal(list.status, 200);
  assert.ok(list.body.activity.some((a) => a.type === 'call'));
  assert.ok(list.body.activity.some((a) => a.type === 'stage_change'));
  assert.equal(list.body.count, list.body.activity.length);
});

test('tasks: add mirrors next_action, tasks_due lists overdue/today, done recomputes', async () => {
  const alpha = byName('Alpha Drainage');
  const t1 = await call({ action: 'task_add', lead_id: alpha.id, type: 'call', due_at: '2026-11-18T14:00:00Z', note: 'overdue call' });
  assert.equal(t1.status, 200);
  assert.equal(t1.body.lead.next_action.task_id, t1.body.task.id);
  const t2 = await call({ action: 'task_add', lead_id: alpha.id, type: 'text', due_at: '2026-11-19T20:00:00Z' });
  assert.equal(t2.body.lead.next_action.type, 'call', 'earliest open task is the next action');
  assert.equal((await call({ action: 'task_add', lead_id: alpha.id, due_at: 'nope' })).body.error, 'invalid_due_at');

  const due = await call({ action: 'tasks_due' });
  assert.equal(due.status, 200);
  assert.equal(due.body.counts.overdue, 1);
  assert.equal(due.body.counts.today, 1);
  assert.equal(due.body.tasks[0].lead_name, 'Alpha Drainage');

  const done = await call({ action: 'task_done', task_id: t1.body.task.id });
  assert.equal(done.status, 200);
  assert.ok(done.body.task.done_at);
  assert.equal(done.body.lead.next_action.type, 'text');
  const again = await call({ action: 'task_done', task_id: t1.body.task.id });
  assert.equal(again.status, 200, 'idempotent');
  assert.equal((await call({ action: 'task_done', task_id: 'not-a-uuid' })).body.error, 'task_id_required');
  assert.equal((await call({ action: 'tasks_due' })).body.counts.total, 1);
});

test('patch next_action creates exactly one open next-action task and replaces it', async () => {
  const beta = byName('Beta Roofing');
  await call({ action: 'patch', lead_id: beta.id, patch: { next_action: { type: 'visit', due_at: '2026-11-21T15:00:00Z', note: 'site visit' } } });
  let open = fake.tables.lead_tasks.filter((t) => t.lead_id === beta.id && !t.done_at && t.is_next_action);
  assert.equal(open.length, 1);
  await call({ action: 'patch', lead_id: beta.id, patch: { next_action: { type: 'email', due_at: '2026-11-22T15:00:00Z' } } });
  open = fake.tables.lead_tasks.filter((t) => t.lead_id === beta.id && !t.done_at && t.is_next_action);
  assert.equal(open.length, 1);
  assert.equal(open[0].type, 'email');
  await call({ action: 'patch', lead_id: beta.id, patch: { next_action: null } });
  assert.equal(fake.tables.lead_tasks.filter((t) => t.lead_id === beta.id && !t.done_at).length, 0);
});

test('funnel counts live leads by stage with zero-filled stages', async () => {
  const r = await call({ action: 'funnel' });
  assert.equal(r.status, 200);
  for (const s of ['new', 'contacted', 'assessment_booked', 'estimate_sent', 'won', 'lost', 'nurture']) assert.ok(s in r.body.funnel, s);
  assert.equal(r.body.total, live().length);
  assert.equal(r.body.funnel.assessment_booked, 1);
  assert.equal(r.body.funnel.estimate_sent, 1);
});

test('list: since cursor, pagination (ties on updated_at), deleted leads reported via since', async () => {
  // many rows sharing one updated_at (single bulk insert)
  const bulk = Array.from({ length: 7 }, (_, i) => ({ name: `Bulk ${i}`, city: 'Page' }));
  await call({ action: 'push', leads: bulk });
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const r = await call({ action: 'list', limit: 3, cursor });
    assert.equal(r.status, 200);
    assert.ok(r.body.leads.length <= 3);
    seen.push(...r.body.leads.map((l) => l.uuid));
    cursor = r.body.next_cursor;
    pages += 1;
    assert.ok(pages < 20);
    if (!r.body.has_more) break;
  } while (cursor);
  assert.equal(new Set(seen).size, seen.length, 'no duplicates across pages');
  assert.equal(seen.length, live().length, 'no row skipped across pages with identical updated_at');

  const mark = fake.tables.leads.map((l) => l.updated_at).sort().pop();
  const del = await call({ action: 'delete', lead_id: byName('Bulk 0').id });
  assert.equal(del.status, 200);
  assert.ok(del.body.deleted_at);
  const delta = await call({ action: 'list', since: mark });
  assert.equal(delta.status, 200);
  const gone = delta.body.leads.find((l) => l.name === 'Bulk 0');
  assert.ok(gone && gone.deleted_at, 'since reports soft-deleted leads');
  assert.equal((await call({ action: 'list' })).body.leads.some((l) => l.name === 'Bulk 0'), false, 'plain list hides deleted');
  assert.equal((await call({ action: 'list', since: 'garbage' })).body.error, 'bad_since');
  assert.equal((await call({ action: 'list', cursor: 'garbage' })).body.error, 'bad_cursor');
});

test('a stale push does not resurrect a deleted lead; restore does', async () => {
  const n = live().length;
  await call({ action: 'push', leads: [{ name: 'Bulk 0', city: 'Page', phone: '1' }] });
  assert.equal(live().length, n);
  const r = await call({ action: 'delete', lead_id: byName('Bulk 0').id, restore: true });
  assert.equal(r.status, 200);
  assert.equal(live().length, n + 1);
});

test('delete honours optimistic concurrency', async () => {
  const x = byName('Bulk 1');
  const r = await call({ action: 'delete', lead_id: x.id, updated_at: '2020-01-01T00:00:00Z' });
  assert.equal(r.status, 409);
  assert.equal(byName('Bulk 1').deleted_at, null);
});

test('stale browser stage does not overwrite a newer stage through push', async () => {
  const alpha = byName('Alpha Drainage');
  const r = await call({ action: 'push', leads: [{ name: 'Alpha Drainage', city: 'Daytona Beach', stage: 'new', updated_at: '2020-01-01T00:00:00Z', notes: 'from stale tab' }] });
  assert.equal(r.status, 200);
  assert.equal(byName('Alpha Drainage').stage, 'assessment_booked');
  assert.equal(byName('Alpha Drainage').notes, 'from stale tab');
  assert.ok(alpha);
});

test('legacy status change through push moves the stage and logs a stage_change', async () => {
  await call({ action: 'push', leads: [{ name: 'Alpha Drainage', city: 'Daytona Beach', status: 'Contract signed' }] });
  assert.equal(byName('Alpha Drainage').stage, 'won');
  const acts = fake.tables.lead_activity.filter((a) => a.lead_id === byName('Alpha Drainage').id && a.type === 'stage_change');
  assert.equal(acts.at(-1).meta.to, 'won');
  assert.equal(acts.at(-1).meta.via, 'sync');
});

test('replace requires the secret, overwrites matched leads, soft-deletes the rest', async () => {
  const session = await call({ action: 'replace', leads: [] }, { secret: 'wrong', token: 'x' });
  assert.equal(session.status, 401);
  const keep = live().find((l) => l.name === 'Gamma Owner' && l.address === '77 Oak Ave');
  const r = await call({ action: 'replace', leads: [{ name: 'Gamma Owner', city: 'Port Orange', address: '77 Oak Ave', notes: 'only survivor' }] });
  assert.equal(r.status, 200);
  assert.equal(live().length, 1);
  assert.equal(live()[0].id, keep.id, 'matched row kept its identity');
  assert.ok(fake.tables.leads.length > 1, 'others are soft-deleted, not destroyed');
});

test('prune_placeholders soft-deletes shells and returns the legacy shape', async () => {
  await call({ action: 'push', leads: [{ name: 'Lawn care prospect — Daytona Beach', city: 'x', notes: 'Category seed: a' }, { name: 'Real Co', city: 'y' }] });
  const r = await call({ action: 'prune_placeholders' });
  assert.equal(r.status, 200);
  assert.equal(r.body.removed, 1);
  assert.ok(r.body.leads.every((l) => l.name !== 'Lawn care prospect — Daytona Beach'));
});

test('unknown action is a 400 that lists the new actions', async () => {
  const r = await call({ action: 'nope' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /funnel/);
});
