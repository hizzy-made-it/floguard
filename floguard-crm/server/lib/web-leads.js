/**
 * Public web leads store (<bucket>/web-leads.json) + optional merge into sales leads.json
 */
import { loadLeadsStore, saveLeadsStore } from './academy-db.js';
import { createHmac, randomBytes } from 'crypto';

const BUCKET = process.env.ACADEMY_STORAGE_BUCKET || 'floguard-academy';
const WEB_OBJECT = 'web-leads.json';
const MAX_WEB = 5000;

function supabaseConfig() {
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

function headers(json = true) {
  const { key } = supabaseConfig();
  const h = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export async function loadWebLeadsStore() {
  const { url } = supabaseConfig();
  // Cache-buster: shared read-modify-write store — a stale CDN read loses data.
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${WEB_OBJECT}?cb=${Date.now()}`, {
    headers: headers(false),
    cache: 'no-store',
  });
  if (r.status === 404) return { leads: [], updated_at: null };
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Failed to load web-leads (${r.status}): ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  if (!data || !Array.isArray(data.leads)) return { leads: [], updated_at: null };
  return data;
}

export async function saveWebLeadsStore(store) {
  const { url } = supabaseConfig();
  const updated_at = new Date().toISOString();
  const body = JSON.stringify({ leads: store.leads || [], updated_at });
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${WEB_OBJECT}`, {
    method: 'POST',
    headers: { ...headers(true), 'x-upsert': 'true' },
    body,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Failed to save web-leads (${r.status}): ${t.slice(0, 200)}`);
  }
  return updated_at;
}

export function newLeadId() {
  return randomBytes(12).toString('hex');
}

/**
 * Persist public form lead. Merges a sales-facing row into Academy leads.json when possible.
 */
export async function persistWebLead(input) {
  const id = newLeadId();
  const created_at = new Date().toISOString();
  const quiz = input.quiz && typeof input.quiz === 'object' && !Array.isArray(input.quiz) ? input.quiz : null;
  const lead = {
    id,
    source: input.source || 'website',
    name: String(input.name || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    phone: String(input.phone || '').trim(),
    company: String(input.company || '').trim(),
    message: String(input.message || '').trim(),
    services: Array.isArray(input.services) ? input.services : [],
    budget: String(input.budget || '').trim(),
    page: String(input.page || '').trim(),
    city: String(input.city || quiz?.location || '').trim(),
    quiz,
    created_at,
  };

  const store = await loadWebLeadsStore();
  const leads = Array.isArray(store.leads) ? store.leads : [];
  leads.push(lead);
  while (leads.length > MAX_WEB) leads.shift();
  await saveWebLeadsStore({ leads });

  // Best-effort: also surface on Academy shared list for reps
  try {
    const sales = await loadLeadsStore();
    const salesLeads = Array.isArray(sales.leads) ? sales.leads : [];
    const quizLines = quiz
      ? Object.entries(quiz)
          .filter(([, v]) => v != null && String(v).trim() !== '')
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      : [];
    salesLeads.push({
      id: `web_${id}`,
      name: lead.name || lead.email,
      city: lead.city,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      notes: [
        lead.message,
        lead.services?.length ? `Services: ${lead.services.join(', ')}` : '',
        lead.budget ? `Budget: ${lead.budget}` : '',
        quizLines.length ? `--- Drainage quiz ---\n${quizLines.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      lists: ['FrenchDrain'],
      list: 'FrenchDrain',
      source: 'web_form',
      status: 'new',
      created_at,
    });
    while (salesLeads.length > 20000) salesLeads.shift();
    await saveLeadsStore({ leads: salesLeads });
  } catch {
    // Academy merge is optional if store missing
  }

  return lead;
}

export function validateLeadPayload(body) {
  const name = String(body?.name || '').trim();
  const email = String(body?.email || '').trim();
  if (name.length < 2) return { ok: false, error: 'Name is required (min 2 characters).' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Valid email is required.' };
  }
  if (String(body?.message || '').length > 8000) {
    return { ok: false, error: 'Message too long.' };
  }
  // Honeypot
  if (body?.website || body?.hp) {
    return { ok: false, error: 'Rejected.', honeypot: true };
  }
  return { ok: true };
}
