/* Estimates (agent G): estimate editor, proposal preview/send, job + invoice record.
 * Public surface: FG.estimates = { open(lead), list(lead) }.
 * Server contract: docs/handoff/G.md (actions on POST /crm/api/academy-leads).
 * No payment processing; the invoice section is a record only. Classic script, loaded last. */
(function () {
  'use strict';
  window.FG = window.FG || {};

  var API = '/crm/api/academy-leads';
  var PROPOSAL_PAGE = 'proposal.html?preview=1';
  var catalog = null;
  var root = null;      // .est-bg
  var S = null;         // modal state
  var lastFocus = null;
  var previewWin = null, previewReady = false;

  // ---- helpers -------------------------------------------------------------
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function r2(n) { return Math.round(Number(n || 0) * 100) / 100; }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDaysYmd(n) { var d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
  function when(s) {
    if (!s) return '';
    var d = new Date(s); if (isNaN(d)) return String(s);
    return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function dayOnly(s) { return s ? String(s).slice(0, 10) : ''; }
  function token() { try { return typeof getToken === 'function' ? getToken() : ''; } catch (e) { return ''; } }
  function leadRef(lead) { return lead.uuid || lead.id; }
  function leadAddress(l) {
    var a = String(l.address || '').trim(), low = a.toLowerCase();
    // R2: imported addresses already carry city and ZIP ("…, Port Orange, FL 32127"); do not repeat them
    var tail = [l.city && low.indexOf(String(l.city).toLowerCase()) < 0 ? l.city : '', l.zip && low.indexOf(String(l.zip)) < 0 ? l.zip : ''].filter(Boolean).join(' ');
    return [a, tail].filter(Boolean).join(', ');
  }
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function fromLocalInput(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallbackCopy(t); });
    return Promise.resolve(fallbackCopy(t));
  }
  function fallbackCopy(t) {
    try { var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); document.body.removeChild(ta); return ok; } catch (e) { return false; }
  }

  async function call(action, body) {
    var tok = token();
    if (!tok) return { status: 401, body: { error: 'signed_out' } };
    try {
      var r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(Object.assign({ action: action }, body || {})) });
      var j = {}; try { j = await r.json(); } catch (e) { /* non-json */ }
      return { status: r.status, body: j || {} };
    } catch (e) {
      return { status: 0, body: { error: 'network', detail: String(e && e.message || e) } };
    }
  }
  function dbOff(r) {
    var c = r.body && r.body.error;
    return r.status === 501 || c === 'postgres_backend_required' || c === 'leads_pipeline_not_ready' || c === 'estimates_not_ready';
  }
  function errText(r) {
    var b = r.body || {};
    if (r.status === 401) return 'Your session expired. Sign in again.';
    if (r.status === 0) return 'Could not reach the server. Check your connection.';
    if (b.error === 'not_found' && /Lead/.test(b.detail || '')) return 'This lead has not synced to the server yet. Wait for the sync pill to turn green, then try again.';
    return b.detail || b.error || ('Something went wrong (' + r.status + ').');
  }

  // ---- modal shell ----------------------------------------------------------
  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'est-bg';
    root.hidden = true;
    root.innerHTML = '<div class="est-modal" role="dialog" aria-modal="true" aria-labelledby="estTitle" tabindex="-1"><div class="est-head" id="estHead"></div><div class="est-body" id="estBody"></div><div class="est-foot" id="estFoot"></div></div>';
    document.body.appendChild(root);
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });
    // Document-level so Esc works even when focus has left the editor (e.g. after Send re-renders it);
    // a confirm opened on top of the editor (FG.modal) handles its own Esc first.
    document.addEventListener('keydown', function (e) {
      if (!root || root.hidden) return;
      if (e.key === 'Escape') { if (document.querySelector('.fg-modal-bg')) return; e.stopPropagation(); close(); return; }
      if (e.key === 'Tab' && window.FG && FG.trapTab && !document.querySelector('.fg-modal-bg')) {
        var m = root.querySelector('.est-modal');
        if (!m.contains(document.activeElement)) { e.preventDefault(); (FG.focusables(m)[0] || m).focus(); return; }
        FG.trapTab(m, e);
      }
    }, true);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    window.addEventListener('message', onMessage);
    return root;
  }
  /** Sending and acceptance move the lead's stage on the server; pull it so the table, board,
   *  stage chip and drawer timeline update without a reload (R2). */
  function syncLead() {
    try { if (window.FG && FG.sync && FG.sync.refresh && FG.isServer && FG.isServer()) FG.sync.refresh(); } catch (e) { /* best effort */ }
  }
  function close() {
    if (!root || root.hidden) return;
    if (S && S.touched) syncLead();
    root.hidden = true;
    document.documentElement.style.overflow = '';
    previewWin = null; previewReady = false;
    S = null;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* gone */ } }
  }
  function show() {
    ensureRoot();
    if (root.hidden) { lastFocus = document.activeElement; root.hidden = false; document.documentElement.style.overflow = 'hidden'; }
    var m = root.querySelector('.est-modal');
    if (m && !m.contains(document.activeElement)) m.focus();
  }
  function head(title, sub, chip) {
    document.getElementById('estHead').innerHTML =
      '<div><h2 id="estTitle">' + esc(title) + (chip ? ' ' + chipHtml(chip) : '') + '</h2>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div><span class="spacer"></span>' +
      '<button type="button" class="btn btn--icon ghost" data-est="close" aria-label="Close estimate"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>';
  }
  function chipHtml(s) { return '<span class="est-chip" data-s="' + esc(s) + '">' + esc(String(s).replace(/_/g, ' ')) + '</span>'; }
  function foot(html) { document.getElementById('estFoot').innerHTML = html || ''; }
  function body(html) { document.getElementById('estBody').innerHTML = html; }

  // ---- loading + db-off states --------------------------------------------------
  function showLoading(lead) {
    show();
    head('Estimates', lead.name || '', null);
    body('<p class="est-empty">Loading&hellip;</p>');
    foot('<span class="spacer"></span><button type="button" class="btn" data-est="close">Close</button>');
  }
  function showDbOff(r) {
    var code = r.body && r.body.error;
    var extra = code === 'estimates_not_ready'
      ? 'The database is on but the estimate columns have not been added yet (fsi/sql/020_estimates_additions.sql).'
      : 'Leads are still on the shared file store. Switch ACADEMY_DATA_BACKEND to postgres (or dual) after applying fsi/sql/017 and 020.';
    head('Estimates', S && S.lead ? S.lead.name : '', null);
    body('<div class="est-dboff"><h3>Estimates need the database switched on</h3><p>' + esc(extra) + '</p><p>Nothing is lost: your leads and notes are untouched.</p></div>');
    foot('<span class="spacer"></span><button type="button" class="btn" data-est="close">Close</button>');
  }

  // ---- data ------------------------------------------------------------------------
  async function loadCatalog() {
    if (catalog) return { ok: true };
    var r = await call('estimate_catalog', {});
    if (r.status === 200 && r.body.catalog) { catalog = r.body.catalog; return { ok: true }; }
    return { ok: false, r: r };
  }
  async function loadList() {
    var r = await call('estimate_list', { lead_id: leadRef(S.lead) });
    if (r.status !== 200) return { ok: false, r: r };
    S.estimates = r.body.estimates || []; S.jobs = r.body.jobs || [];
    if (S.estimates.some(function (e) { return e.status === 'accepted' || e.status === 'declined'; })) { S.touched = true; syncLead(); }
    return { ok: true };
  }
  function itemById(id) { return ((catalog && catalog.items) || []).filter(function (i) { return i.id === id; })[0] || null; }

  // ---- public API ----------------------------------------------------------------------
  async function open(lead, opts) {
    opts = opts || {};
    if (!lead) return null;
    S = { lead: lead, view: 'loading', estimates: [], jobs: [], est: null, draft: null, job: null, notice: null, busy: false, dirty: false, sendResult: null, confirmSend: false, voiding: false };
    showLoading(lead);
    var c = await loadCatalog();
    if (!c.ok) { if (dbOff(c.r)) showDbOff(c.r); else { head('Estimates', lead.name || '', null); body('<p class="est-err">' + esc(errText(c.r)) + '</p>'); foot('<span class="spacer"></span><button type="button" class="btn" data-est="close">Close</button>'); } return null; }
    var l = await loadList();
    if (!l.ok) { if (dbOff(l.r)) showDbOff(l.r); else { head('Estimates', lead.name || '', null); body('<p class="est-err">' + esc(errText(l.r)) + '</p>'); foot('<span class="spacer"></span><button type="button" class="btn" data-est="close">Close</button>'); } return null; }
    if (opts.estimateId) { await openEstimate(opts.estimateId); return S; }
    if (!S.estimates.length) newDraft(); else renderList();
    return S;
  }
  /** Opens the list view and resolves with { estimates, jobs } (or null if unavailable). */
  async function list(lead) {
    var s = await open(lead);
    if (!s) return null;
    if (S && S.view !== 'list' && S.estimates.length) renderList();
    return S ? { estimates: S.estimates, jobs: S.jobs } : null;
  }
  async function openEstimate(id) {
    var r = await call('estimate_get', { estimate_id: id });
    if (r.status !== 200) { S.notice = { t: 'err', m: errText(r) }; renderList(); return; }
    S.est = r.body.estimate; S.proposal = r.body.proposal; S.job = r.body.job || null;
    if (S.est && /^(accepted|declined)$/.test(S.est.status || '')) S.touched = true; S.sendResult = null; S.confirmSend = false; S.voiding = false;
    S.draft = draftFrom(S.est); S.dirty = false; S.view = 'edit';
    renderEdit();
  }
  function newDraft() {
    var l = S.lead;
    S.est = null; S.proposal = null; S.job = null; S.sendResult = null; S.confirmSend = false;
    S.draft = { line_items: [], discount: '', discount_reason: '', notes_to_customer: '', internal_notes: '', valid_until: addDaysYmd((catalog && catalog.default_valid_days) || 30), customer: { name: l.name || '', address: leadAddress(l) } };
    S.dirty = false; S.view = 'edit';
    renderEdit();
  }
  function draftFrom(e) {
    return {
      line_items: (e.line_items || []).map(function (x) { return { catalog_id: x.catalog_id || '', name: x.name || '', description: x.description, quantity: x.quantity, unit_price: x.unit_price, band_override_reason: x.band_override_reason || '' }; }),
      discount: e.discount || '', discount_reason: e.discount_reason || '', notes_to_customer: e.notes_to_customer || '', internal_notes: e.internal_notes || '',
      valid_until: e.valid_until || '', customer: { name: (e.customer && e.customer.name) || '', address: (e.customer && e.customer.address) || '' }
    };
  }

  // ---- list view -----------------------------------------------------------------------------
  function renderList() {
    S.view = 'list';
    head('Estimates', (S.lead.name || '') + (leadAddress(S.lead) ? ' · ' + leadAddress(S.lead) : ''), null);
    var notice = S.notice ? '<p class="est-' + (S.notice.t === 'ok' ? 'ok' : 'err') + '" role="status">' + esc(S.notice.m) + '</p>' : '';
    S.notice = null;
    var items = S.estimates.map(function (e) {
      return '<button type="button" class="est-item" data-est="openEst" data-id="' + esc(e.id) + '"><span><span class="n">' + esc(e.number) + '</span><br><span class="m">' + esc(when(e.created_at)) + (e.valid_until ? ' · valid through ' + esc(e.valid_until) : '') + '</span></span>' + chipHtml(e.status) + '<span class="t">' + money(e.total) + '</span></button>';
    }).join('');
    var jobs = S.jobs.length ? '<div class="est-card"><h3>Jobs</h3><div class="est-list">' + S.jobs.map(function (j) {
      var est = S.estimates.filter(function (e) { return e.id === j.estimate_id; })[0];
      return '<button type="button" class="est-item" data-est="openEst" data-id="' + esc(j.estimate_id || '') + '"><span><span class="n">Job' + (est ? ' ' + esc(est.number) : '') + '</span><br><span class="m">' + (j.scheduled_for ? 'Scheduled ' + esc(when(j.scheduled_for)) : 'Not scheduled') + '</span></span>' + chipHtml(j.status) + '<span class="t">' + (j.invoice_status && j.invoice_status !== 'unbilled' ? esc(j.invoice_status) : '') + '</span></button>';
    }).join('') + '</div></div>' : '';
    body(notice + '<div class="est-card"><h3>Estimates</h3>' + (items ? '<div class="est-list">' + items + '</div>' : '<p class="est-empty">No estimates yet.</p>') + '</div>' + jobs);
    foot('<span class="spacer"></span><button type="button" class="btn" data-est="close">Close</button><button type="button" class="btn p" data-est="new"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>New estimate</button>');
  }

  // ---- editor ----------------------------------------------------------------------------------
  function isDraft() { return !S.est || S.est.status === 'draft'; }
  function calc() {
    var sub = 0;
    S.draft.line_items.forEach(function (l) { sub += Math.round(Number(l.unit_price || 0) * 100) * Math.max(1, parseInt(l.quantity, 10) || 1); });
    var disc = Math.round(Number(S.draft.discount || 0) * 100);
    return { sub: sub / 100, disc: disc / 100, total: (sub - disc) / 100 };
  }
  function bandInfo(l) {
    var it = l.catalog_id ? itemById(l.catalog_id) : null;
    if (!it) return { custom: true, out: true };
    var p = Number(l.unit_price);
    var out = !(p >= it.band_low && p <= it.band_high) && l.unit_price !== '' && l.unit_price != null;
    return { custom: false, out: out, low: it.band_low, high: it.band_high, unit: it.unit };
  }
  function lineHtml(l, i, ro) {
    var b = bandInfo(l);
    var it = l.catalog_id ? itemById(l.catalog_id) : null;
    var name = it ? it.name : (l.name || 'Custom line');
    var dis = ro ? ' disabled' : '';
    var hint = b.custom
      ? '<span class="est-band"><span class="out">Not in the pricing doc.</span> A reason for the price is required.</span>'
      : '<span class="est-band">Band <b>' + money(b.low).replace('.00', '') + '–' + money(b.high).replace('.00', '') + '</b> per ' + esc(b.unit) + ' <span data-band="' + i + '" class="' + (b.out ? 'out' : 'in') + '">' + (l.unit_price === '' || l.unit_price == null ? '' : (b.out ? 'Outside band' : 'Inside band')) + '</span></span>';
    var reasonShown = b.custom || b.out;
    return '<div class="est-line" data-line="' + i + '">' +
      '<div class="est-line-top"><span class="name">' + esc(name) + '</span>' + (ro ? '' : '<button type="button" class="btn btn--sm ghost" data-est="rmLine" data-i="' + i + '" aria-label="Remove line ' + (i + 1) + '">Remove</button>') + '</div>' +
      (b.custom && !ro ? '<div class="est-field"><label for="estLn' + i + '">Item name</label><input type="text" id="estLn' + i + '" data-f="name" data-i="' + i + '" maxlength="120" value="' + esc(l.name || '') + '"></div>' : '') +
      '<div class="est-field"><label for="estLd' + i + '">Description (customer sees this)</label><textarea id="estLd' + i + '" data-f="description" data-i="' + i + '" maxlength="800"' + dis + '>' + esc(l.description || '') + '</textarea></div>' +
      '<div class="est-line-grid">' +
        '<div class="est-field"><label for="estLq' + i + '">Qty</label><input type="number" id="estLq' + i + '" data-f="quantity" data-i="' + i + '" min="1" max="100" step="1" value="' + esc(l.quantity) + '"' + dis + '></div>' +
        '<div class="est-field"><label for="estLp' + i + '">Price each ($)</label><input type="number" id="estLp' + i + '" data-f="unit_price" data-i="' + i + '" min="0" step="0.01" value="' + esc(l.unit_price) + '"' + dis + '></div>' +
        '<div class="est-line-total" data-lt="' + i + '">' + money(Number(l.unit_price || 0) * (parseInt(l.quantity, 10) || 1)) + '</div>' +
      '</div>' + hint +
      '<div class="est-field" data-reason="' + i + '"' + (reasonShown ? '' : ' hidden') + '><label for="estLr' + i + '">' + (b.custom ? 'Basis for this price (required)' : 'Band override reason (required)') + '</label><input type="text" id="estLr' + i + '" data-f="band_override_reason" data-i="' + i + '" maxlength="500" value="' + esc(l.band_override_reason || '') + '"' + dis + '></div>' +
      '</div>';
  }
  function timelineHtml(e) {
    var ev = [{ k: 'created', t: 'Draft created', at: e.created_at }];
    if (e.sent_at) ev.push({ k: 'sent', t: 'Sent to customer (link created)', at: e.sent_at });
    if (e.viewed_at) ev.push({ k: 'viewed', t: 'Customer opened the link' + (e.view_count > 1 ? ' (' + e.view_count + ' views)' : ''), at: e.viewed_at });
    if (e.accepted_at) ev.push({ k: 'accepted', t: 'Accepted by ' + (e.accepted_name || 'customer'), at: e.accepted_at });
    if (e.declined_at) ev.push({ k: 'declined', t: 'Declined' + (e.decline_reason ? ': ' + e.decline_reason : ''), at: e.declined_at });
    if (e.voided_at) ev.push({ k: 'void', t: 'Voided' + (e.void_reason ? ': ' + e.void_reason : ''), at: e.voided_at });
    if (e.status === 'expired') ev.push({ k: 'expired', t: 'Expired', at: e.valid_until });
    return '<ol class="est-tl">' + ev.map(function (x) { return '<li data-k="' + x.k + '">' + esc(x.t) + '<span class="when">' + esc(x.k === 'expired' ? x.at : when(x.at)) + '</span></li>'; }).join('') + '</ol>';
  }

  function renderEdit() {
    S.view = 'edit';
    var ro = !isDraft();
    var e = S.est;
    var d = S.draft;
    head(e ? e.number : 'New estimate', (S.lead.name || '') + (leadAddress(S.lead) ? ' · ' + leadAddress(S.lead) : ''), e ? e.status : 'draft');
    var warns = '';
    var termsPh = (e && e.terms_placeholder) || (catalog && catalog.terms_placeholder);
    if (termsPh) warns += '<p class="est-warn" role="note"><strong>Draft terms.</strong> The customer-facing terms, deposit and warranty text are still placeholders. Ask the owner to finish them before real estimates go out.</p>';
    if (S.notice) warns += '<p class="est-' + (S.notice.t === 'ok' ? 'ok' : 'err') + '" role="status">' + esc(S.notice.m) + '</p>';
    S.notice = null;
    if (ro) warns += '<p class="est-note">This estimate is ' + esc(e.status) + ' and can no longer be edited.' + (e.status !== 'accepted' && e.status !== 'void' ? ' Void it and create a new one to change it.' : '') + '</p>';

    var cat = (catalog.items || []).map(function (i) { return '<option value="' + esc(i.id) + '">' + esc(i.name) + ' (' + money(i.band_low).replace('.00', '') + '–' + money(i.band_high).replace('.00', '') + ')</option>'; }).join('');
    var lines = d.line_items.map(function (l, i) { return lineHtml(l, i, ro); }).join('') || '<p class="est-empty">No line items yet. Add one below.</p>';
    var add = ro ? '' : '<div class="est-add"><select id="estAddSel" aria-label="Add a line item"><option value="">Add a line item…</option>' + cat + '<option value="__custom">Custom line (not in the pricing doc)</option></select><button type="button" class="btn" data-est="addLine"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>Add</button></div>';
    var t = calc();
    var left =
      '<div class="est-card"><h3>Customer</h3><div class="est-row2">' +
        '<div class="est-field"><label for="estCName">Name</label><input type="text" id="estCName" data-c="name" maxlength="160" value="' + esc(d.customer.name) + '"' + (ro ? ' disabled' : '') + '></div>' +
        '<div class="est-field"><label for="estCAddr">Site address</label><input type="text" id="estCAddr" data-c="address" maxlength="240" value="' + esc(d.customer.address) + '"' + (ro ? ' disabled' : '') + '></div></div></div>' +
      '<div class="est-card"><h3>Line items</h3><div class="est-lines">' + lines + '</div>' + add +
        '<p class="est-hint" style="margin-top:8px">Pricing is banded, never per foot. Final amounts are calculated by the server when you save.</p></div>' +
      '<div class="est-card"><h3>Adjustments and notes</h3><div class="est-row2">' +
        '<div class="est-field"><label for="estDisc">Discount ($)</label><input type="number" id="estDisc" data-k="discount" min="0" step="0.01" value="' + esc(d.discount) + '"' + (ro ? ' disabled' : '') + '></div>' +
        '<div class="est-field" id="estDiscWrap"' + (Number(d.discount) > 0 ? '' : ' hidden') + '><label for="estDiscR">Discount reason (rep only, required)</label><input type="text" id="estDiscR" data-k="discount_reason" maxlength="300" value="' + esc(d.discount_reason) + '"' + (ro ? ' disabled' : '') + '></div></div>' +
        '<div class="est-field" style="margin-top:12px"><label for="estNotes">Notes to customer (printed on the proposal)</label><textarea id="estNotes" data-k="notes_to_customer" maxlength="3000"' + (ro ? ' disabled' : '') + '>' + esc(d.notes_to_customer) + '</textarea></div>' +
        '<div class="est-field" style="margin-top:12px"><label for="estInt">Internal notes (rep only, never shown to the customer)</label><textarea id="estInt" data-k="internal_notes" maxlength="3000"' + (ro ? ' disabled' : '') + '>' + esc(d.internal_notes) + '</textarea></div>' +
        '<div class="est-field" style="margin-top:12px;max-width:220px"><label for="estValid">Valid through</label><input type="date" id="estValid" data-k="valid_until" value="' + esc(d.valid_until) + '"' + (ro ? ' disabled' : '') + '></div></div>';
    var right =
      '<div class="est-card"><h3>Totals</h3><div class="est-sum" id="estSum">' + sumHtml(t) + '</div><p class="est-priceonly">Preview totals. The saved estimate uses the server’s numbers.</p></div>' +
      (e ? '<div class="est-card"><h3>Status</h3>' + timelineHtml(e) + '</div>' : '') +
      (S.sendResult ? '' : '') + jobHtml();
    var main = '<div class="est-grid"><div class="est-col">' + (S.sendResult ? sendHtml() : '') + left + '</div><div class="est-col">' + right + '</div></div>';
    body(warns + main);
    footEdit(ro);
  }
  function sumHtml(t) {
    return '<div><span>Subtotal</span><span>' + money(t.sub) + '</span></div>' + (t.disc > 0 ? '<div><span>Discount</span><span>−' + money(t.disc) + '</span></div>' : '') + '<div class="total"><span>Total</span><span>' + money(t.total) + '</span></div>';
  }
  function footEdit(ro) {
    var e = S.est;
    var f = '<button type="button" class="btn" data-est="back">' + (S.estimates.length || e ? 'All estimates' : 'Close') + '</button><span class="spacer"></span>';
    if (S.confirmSend) {
      f = '<span class="est-hint" style="color:var(--warn)">The terms are still placeholder text. Send anyway?</span><span class="spacer"></span><button type="button" class="btn" data-est="cancelSend">Cancel</button><button type="button" class="btn p" data-est="sendNow">Send anyway</button>';
    } else if (S.voiding) {
      f = '<div class="est-field" style="flex:1;min-width:220px"><label for="estVoidR" class="sr-only">Reason</label><input type="text" id="estVoidR" placeholder="Reason for voiding (required)" maxlength="300"></div><button type="button" class="btn" data-est="cancelVoid">Cancel</button><button type="button" class="btn d" data-est="voidNow">Void estimate</button>';
    } else if (!ro) {
      f += '<button type="button" class="btn" data-est="preview"><svg class="ic" aria-hidden="true"><use href="#i-search"/></svg>Preview</button>' +
        '<button type="button" class="btn" data-est="save"' + (S.busy ? ' disabled' : '') + '>Save draft</button>' +
        '<button type="button" class="btn p" data-est="send"' + (S.busy ? ' disabled' : '') + '><svg class="ic" aria-hidden="true"><use href="#i-send"/></svg>Send…</button>';
      if (e) f = f.replace('<span class="spacer"></span>', '<button type="button" class="btn d" data-est="void">Void</button><span class="spacer"></span>');
    } else if (e) {
      f += '<button type="button" class="btn" data-est="preview">Preview</button>';
      if (e.status === 'sent' || e.status === 'expired') f += '<button type="button" class="btn" data-est="resend">Message and link</button>';
      if (e.status !== 'accepted' && e.status !== 'void') f = f.replace('<span class="spacer"></span>', '<button type="button" class="btn d" data-est="void">Void</button><span class="spacer"></span>');
    }
    foot(f);
  }

  // ---- send panel -------------------------------------------------------------------------------
  function sendHtml() {
    var r = S.sendResult, m = r.message || {}, links = r.links || {};
    var warn = [];
    // R2/R1: a litigator flag blocks texting exactly like DNC, whether the server says so in
    // warnings, in message.to, or only our local copy of the lead knows.
    var to = m.to || {};
    var lit = (r.warnings || []).indexOf('phone_litigator') >= 0 || to.phone_litigator === true;
    var dnc = (r.warnings || []).indexOf('phone_dnc') >= 0 || to.phone_dnc === true;
    var local = false;
    try { var pp = FG.phone.primary(S.lead); local = !!(FG.phone.leadBlocked(S.lead) || (pp && FG.phone.state(pp, S.lead).blocked)); } catch (e) { local = false; }
    if (lit || dnc || local) links = Object.assign({}, links, { sms: null });
    if (lit) warn.push('This lead’s number is flagged as a known TCPA litigator. No text link was made. Do not text or call; send the link by email or mail.');
    else if (local && !dnc) warn.push('This lead’s number is blocked in the CRM (DNC or litigator). No text link was made.');
    (r.warnings || []).forEach(function (w) {
      if (w === 'phone_litigator') return;
      if (w === 'phone_dnc') warn.push('This lead’s number is on the do-not-call list. No text link was made. Do not text or call.');
      else if (w === 'no_email') warn.push('No email on file for this lead; copy the message instead.');
      else if (w === 'no_phone') warn.push('No phone number on file for this lead.');
      else if (w === 'out_of_band') warn.push('One or more lines are outside the pricing band (reasons are saved on the estimate).');
      else if (w === 'terms_placeholder') warn.push('The terms on this proposal are still placeholder text.');
    });
    return '<div class="est-card" id="estSend"><h3>Send to the customer (you send it; nothing was emailed or texted)</h3>' +
      '<p class="est-ok" role="status">Link created. The customer can review and accept online. Valid through ' + esc(r.estimate.valid_until) + '.</p>' +
      (warn.length ? '<p class="est-warn" style="margin-top:8px">' + warn.map(esc).join('<br>') + '</p>' : '') +
      '<div class="est-field" style="margin-top:12px"><label for="estUrl">Customer link</label><div class="est-copy"><input type="text" id="estUrl" readonly value="' + esc(r.public_url) + '"><button type="button" class="btn" data-est="copyUrl">Copy link</button></div></div>' +
      '<div class="est-field" style="margin-top:12px"><label for="estMsg">Message (' + esc(m.subject || '') + ')</label><textarea id="estMsg" class="est-msg">' + esc(m.body || '') + '</textarea></div>' +
      '<div class="est-links" style="margin-top:12px"><button type="button" class="btn" data-est="copyMsg">Copy message</button>' +
      (links.mailto ? '<a class="btn" href="' + esc(links.mailto) + '">Open in email</a>' : '<span class="btn" aria-disabled="true">Open in email</span>') +
      (links.sms ? '<a class="btn" href="' + esc(links.sms) + '">Open in Messages</a>' : '<span class="btn" aria-disabled="true" title="' + ((lit || dnc || local) ? 'Texting is blocked for this number' : 'No mobile number on file') + '">Open in Messages</span>') +
      '<span class="est-hint" id="estCopied" role="status"></span></div></div>';
  }

  // ---- job + invoice record ----------------------------------------------------------------------
  function jobHtml() {
    var e = S.est;
    if (!e || e.status !== 'accepted') return '';
    var j = S.job;
    if (!j) {
      return '<div class="est-card"><h3>Job</h3><p class="est-hint" style="margin-bottom:8px">Accepted by ' + esc(e.accepted_name || 'the customer') + '. Create the job to schedule the work.</p>' +
        '<div class="est-field"><label for="estJobWhen">Scheduled for</label><input type="datetime-local" id="estJobWhen"></div>' +
        '<div class="est-field" style="margin-top:8px"><label for="estJobNotes">Notes</label><textarea id="estJobNotes" maxlength="3000"></textarea></div>' +
        '<button type="button" class="btn p btn--block" style="margin-top:12px" data-est="mkJob">Create job from estimate</button></div>';
    }
    var sel = function (list, cur) { return list.map(function (s) { return '<option value="' + s + '"' + (s === cur ? ' selected' : '') + '>' + s.replace(/_/g, ' ') + '</option>'; }).join(''); };
    return '<div class="est-card" id="estJob"><h3>Job ' + chipHtml(j.status) + '</h3>' +
      '<div class="est-field"><label for="estJStatus">Status</label><select id="estJStatus" data-j="status">' + sel(['scheduled', 'in_progress', 'complete', 'cancelled'], j.status) + '</select></div>' +
      '<div class="est-field" style="margin-top:8px"><label for="estJWhen">Scheduled for</label><input type="datetime-local" id="estJWhen" data-j="scheduled_for" value="' + esc(toLocalInput(j.scheduled_for)) + '"></div>' +
      '<div class="est-field" style="margin-top:8px"><label for="estJDone">Completed</label><input type="datetime-local" id="estJDone" data-j="completed_at" value="' + esc(toLocalInput(j.completed_at)) + '"></div>' +
      '<div class="est-field" style="margin-top:8px"><label for="estJNotes">Notes</label><textarea id="estJNotes" data-j="notes" maxlength="3000">' + esc(j.notes || '') + '</textarea></div>' +
      '<button type="button" class="btn btn--block" style="margin-top:12px" data-est="saveJob">Save job</button></div>' +
      '<div class="est-card" id="estInv"><h3>Invoice record</h3><p class="est-hint" style="margin-bottom:8px">A record only. No payments are taken or stored here; never enter card or bank details.</p>' +
      '<div class="est-inv"><div class="est-field"><label for="estIN">Invoice number</label><input type="text" id="estIN" data-v="invoice_number" maxlength="40" value="' + esc(j.invoice_number) + '"></div>' +
      '<div class="est-field"><label for="estIT">Total ($)</label><input type="number" id="estIT" data-v="invoice_total" min="0" step="0.01" value="' + esc(j.invoice_total == null ? (e.total || '') : j.invoice_total) + '"></div></div>' +
      '<div class="est-field" style="margin-top:8px"><label for="estIS">Status</label><select id="estIS" data-v="invoice_status">' + sel(['unbilled', 'sent', 'paid'], j.invoice_status) + '</select></div>' +
      (j.paid_at ? '<p class="est-hint" style="margin-top:6px">Paid ' + esc(when(j.paid_at)) + '</p>' : '') +
      '<button type="button" class="btn btn--block" style="margin-top:12px" data-est="saveInv">Save invoice record</button></div>';
  }

  // ---- actions --------------------------------------------------------------------------------------
  function payload() {
    var d = S.draft;
    return {
      line_items: d.line_items.map(function (l) {
        var o = { catalog_id: l.catalog_id || null, description: l.description, quantity: parseInt(l.quantity, 10) || 1, unit_price: Number(l.unit_price), band_override_reason: l.band_override_reason || '' };
        if (!l.catalog_id) o.name = l.name || 'Custom item';
        return o;
      }),
      discount: Number(d.discount) || 0, discount_reason: d.discount_reason || '',
      notes_to_customer: d.notes_to_customer, internal_notes: d.internal_notes,
      valid_until: d.valid_until || undefined, customer: { name: d.customer.name, address: d.customer.address }
    };
  }
  async function save(silent) {
    if (!isDraft()) return true;
    var p = payload();
    var bad = p.line_items.filter(function (l) { return !isFinite(l.unit_price); });
    if (bad.length) { S.notice = { t: 'err', m: 'Every line needs a price.' }; renderEdit(); return false; }
    S.busy = true;
    var r = S.est
      ? await call('estimate_update', Object.assign({ estimate_id: S.est.id, updated_at: S.est.updated_at }, p))
      : await call('estimate_create', Object.assign({ lead_id: leadRef(S.lead) }, p));
    S.busy = false;
    if (r.status !== 200) {
      if (dbOff(r)) { showDbOff(r); return false; }
      if (r.status === 409 && r.body.estimate) { S.est = r.body.estimate; }
      S.notice = { t: 'err', m: errText(r) }; renderEdit(); return false;
    }
    S.est = r.body.estimate; S.proposal = r.body.proposal; S.dirty = false;
    var keepSend = S.sendResult;
    S.draft = draftFrom(S.est);
    S.sendResult = keepSend;
    if (!silent) S.notice = { t: 'ok', m: 'Saved ' + S.est.number + '.' };
    renderEdit();
    return true;
  }
  async function doSend() {
    S.confirmSend = false;
    if (!(await save(true))) return;
    S.busy = true; renderEdit();
    var r = await call('estimate_send', { estimate_id: S.est.id, valid_until: S.draft.valid_until || undefined });
    S.busy = false;
    if (r.status !== 200) { S.notice = { t: 'err', m: errText(r) }; renderEdit(); return; }
    S.est = r.body.estimate; S.sendResult = r.body; S.draft = draftFrom(S.est); S.dirty = false; S.touched = true;
    renderEdit();
    syncLead();
    var el = document.getElementById('estSend'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    reloadList();
  }
  async function reloadList() { var l = await loadList(); return l.ok; }
  async function resend() {
    var r = await call('estimate_send', { estimate_id: S.est.id });
    if (r.status !== 200) { S.notice = { t: 'err', m: errText(r) }; renderEdit(); return; }
    S.est = r.body.estimate; S.sendResult = r.body; S.touched = true; renderEdit();
    syncLead();
  }
  async function previewNow() {
    // open synchronously (popup blockers), then save and hand the proposal over via postMessage (same origin only)
    previewReady = false;
    previewWin = window.open(PROPOSAL_PAGE, 'fg-proposal-preview');
    if (!previewWin) { S.notice = { t: 'err', m: 'The browser blocked the preview window. Allow pop-ups for this site.' }; renderEdit(); return; }
    if (isDraft() && (S.dirty || !S.est)) { if (!(await save(true))) return; }
    pushPreview();
  }
  function pushPreview() {
    if (previewWin && previewReady && S && S.proposal) { try { previewWin.postMessage({ type: 'fg-proposal-data', proposal: S.proposal }, location.origin); } catch (e) { /* closed */ } }
  }
  function onMessage(e) {
    if (e.origin !== location.origin || !previewWin || e.source !== previewWin) return;
    if (e.data && e.data.type === 'fg-proposal-ready') { previewReady = true; pushPreview(); }
  }
  async function doVoid() {
    var input = document.getElementById('estVoidR');
    var reason = input ? input.value.trim() : '';
    if (reason.length < 3) { if (input) input.focus(); return; }
    var r = await call('estimate_void', { estimate_id: S.est.id, reason: reason });
    S.voiding = false;
    if (r.status !== 200) { S.notice = { t: 'err', m: errText(r) }; renderEdit(); return; }
    S.est = r.body.estimate; S.sendResult = null; S.draft = draftFrom(S.est);
    S.notice = { t: 'ok', m: S.est.number + ' voided. The customer link no longer works.' };
    renderEdit(); reloadList();
  }
  async function makeJob() {
    var when = fromLocalInput((document.getElementById('estJobWhen') || {}).value);
    var notes = (document.getElementById('estJobNotes') || {}).value || '';
    var r = await call('job_create_from_estimate', { estimate_id: S.est.id, scheduled_for: when, notes: notes });
    if (r.status !== 200) { S.notice = { t: 'err', m: errText(r) }; renderEdit(); return; }
    S.job = r.body.job; S.notice = { t: 'ok', m: r.body.already_exists ? 'A job already existed for this estimate.' : 'Job created.' };
    renderEdit(); reloadList();
  }
  function val(id) { var n = document.getElementById(id); return n ? n.value : ''; }
  async function saveJob() {
    var p = { job_id: S.job.id, status: val('estJStatus'), scheduled_for: fromLocalInput(val('estJWhen')), completed_at: fromLocalInput(val('estJDone')), notes: val('estJNotes') };
    var r = await call('job_update', p);
    if (r.status !== 200) { S.notice = { t: 'err', m: errText(r) }; renderEdit(); return; }
    S.job = r.body.job; S.notice = { t: 'ok', m: 'Job saved.' }; renderEdit(); reloadList();
  }
  async function saveInv() {
    var tot = val('estIT');
    var p = { job_id: S.job.id, invoice_number: val('estIN'), invoice_status: val('estIS') };
    if (tot !== '') p.invoice_total = Number(tot);
    var r = await call('invoice_mark', p);
    if (r.status !== 200) { S.notice = { t: 'err', m: errText(r) }; renderEdit(); return; }
    S.job = r.body.job; S.notice = { t: 'ok', m: 'Invoice record saved. (Record only; no payment was processed.)' }; renderEdit(); reloadList();
  }

  // ---- events ---------------------------------------------------------------------------------------------
  function refreshLive() {
    var sum = document.getElementById('estSum'); if (sum) sum.innerHTML = sumHtml(calc());
    var w = document.getElementById('estDiscWrap'); if (w) w.hidden = !(Number(S.draft.discount) > 0);
    S.draft.line_items.forEach(function (l, i) {
      var b = bandInfo(l);
      var t = root.querySelector('[data-lt="' + i + '"]'); if (t) t.textContent = money(Number(l.unit_price || 0) * (parseInt(l.quantity, 10) || 1));
      var bd = root.querySelector('[data-band="' + i + '"]');
      if (bd) { bd.className = b.out ? 'out' : 'in'; bd.textContent = (l.unit_price === '' || l.unit_price == null) ? '' : (b.out ? 'Outside band' : 'Inside band'); }
      var rs = root.querySelector('[data-reason="' + i + '"]'); if (rs) rs.hidden = !(b.custom || b.out);
    });
  }
  function onInput(e) {
    var t = e.target;
    if (!S || !S.draft || !isDraft()) return;
    var changed = false;
    if (t.dataset.f != null && t.dataset.i != null) { S.draft.line_items[+t.dataset.i][t.dataset.f] = t.value; changed = true; }
    else if (t.dataset.c) { S.draft.customer[t.dataset.c] = t.value; changed = true; }
    else if (t.dataset.k) { S.draft[t.dataset.k] = t.value; changed = true; }
    if (changed) { S.dirty = true; refreshLive(); }
  }
  async function onClick(e) {
    var b = e.target.closest && e.target.closest('[data-est]');
    if (!b || !S) return;
    var a = b.dataset.est;
    if (a === 'close') return close();
    if (a === 'back') { if (S.estimates.length) { renderList(); } else close(); return; }
    if (a === 'new') return newDraft();
    if (a === 'openEst') { if (b.dataset.id) await openEstimate(b.dataset.id); return; }
    if (a === 'addLine') {
      var sel = document.getElementById('estAddSel'); var v = sel && sel.value; if (!v) { if (sel) sel.focus(); return; }
      if (v === '__custom') S.draft.line_items.push({ catalog_id: '', name: '', description: '', quantity: 1, unit_price: '', band_override_reason: '' });
      else { var it = itemById(v); S.draft.line_items.push({ catalog_id: it.id, name: it.name, description: it.default_description, quantity: 1, unit_price: '', band_override_reason: '' }); }
      S.dirty = true; renderEdit();
      var last = root.querySelector('[data-line="' + (S.draft.line_items.length - 1) + '"] [data-f="unit_price"]'); if (last) last.focus();
      return;
    }
    if (a === 'rmLine') { S.draft.line_items.splice(+b.dataset.i, 1); S.dirty = true; renderEdit(); return; }
    if (a === 'save') return void (await save(false));
    if (a === 'preview') return void (await previewNow());
    if (a === 'send') {
      if (!S.draft.line_items.length) { S.notice = { t: 'err', m: 'Add at least one line item before sending.' }; renderEdit(); return; }
      if ((S.est && S.est.terms_placeholder) || (catalog && catalog.terms_placeholder)) { S.confirmSend = true; footEdit(false); return; }
      return void (await doSend());
    }
    if (a === 'cancelSend') { S.confirmSend = false; footEdit(!isDraft()); return; }
    if (a === 'sendNow') return void (await doSend());
    if (a === 'resend') return void (await resend());
    if (a === 'void') { S.voiding = true; footEdit(!isDraft()); var vi = document.getElementById('estVoidR'); if (vi) vi.focus(); return; }
    if (a === 'cancelVoid') { S.voiding = false; footEdit(!isDraft()); return; }
    if (a === 'voidNow') return void (await doVoid());
    if (a === 'copyUrl') { var ok = await copyText(S.sendResult.public_url); flashCopied(ok ? 'Link copied.' : 'Select the link and copy it.'); return; }
    if (a === 'copyMsg') { var ok2 = await copyText(val('estMsg')); flashCopied(ok2 ? 'Message copied.' : 'Select the text and copy it.'); return; }
    if (a === 'mkJob') return void (await makeJob());
    if (a === 'saveJob') return void (await saveJob());
    if (a === 'saveInv') return void (await saveInv());
  }
  function flashCopied(t) { var n = document.getElementById('estCopied'); if (n) n.textContent = t; }

  FG.estimates = { open: open, list: list };

  // ---- entry point on the lead drawer ---------------------------------------------------------------------------
  function currentLead() {
    try { if (typeof profileLeadId !== 'undefined' && profileLeadId != null && typeof state !== 'undefined') return state.filter(function (x) { return x.id === profileLeadId; })[0] || null; } catch (e) { /* not ready */ }
    return null;
  }
  function addFallbackButton() {
    var bar = document.getElementById('pfActBar');
    if (!bar || bar.querySelector('[data-fg-estimate]')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.setAttribute('data-fg-estimate', '1'); b.title = 'Create or view estimates for this lead';
    b.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-clipboard-check"/></svg>Estimate';
    bar.appendChild(b);
  }
  function init() {
    var hooked = false;
    function tryHook() {
      var d = window.FG && window.FG.leadDrawer;
      if (hooked || !d || typeof d.addAction !== 'function') return hooked;
      var open_ = function (lead) { FG.estimates.open(lead || currentLead()); };
      d.addAction({ id: 'estimate', label: 'Estimate', icon: 'clipboard-check', title: 'Create or view estimates for this lead', onClick: open_, run: open_, handler: open_ });
      hooked = true;
      return true;
    }
    tryHook();
    var bar = document.getElementById('pfActBar');
    function arm() {
      if (tryHook()) return;
      addFallbackButton();
    }
    if (bar) {
      var mo = new MutationObserver(function () { if (hooked) { mo.disconnect(); return; } arm(); });
      mo.observe(bar, { childList: true });
      arm();
      bar.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-fg-estimate]');
        if (!b) return;
        var lead = currentLead();
        if (lead) FG.estimates.open(lead);
      });
    }
    window.addEventListener('load', tryHook);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
