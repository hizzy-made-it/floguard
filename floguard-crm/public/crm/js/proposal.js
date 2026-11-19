/* FloGuard customer proposal page. Standalone: no CRM bundle, no auth, no storage.
 * Talks to one endpoint: POST /crm/api/leads { action: proposal_get | proposal_accept | proposal_decline, token }.
   * Every server string is inserted as text nodes only. */
(function () {
  'use strict';
  var API = '/crm/api/leads';
  var main = document.getElementById('main');
  var params = new URLSearchParams(location.search);
  var preview = params.get('preview') === '1';
  var token = '';

  (function findToken() {
    var m = location.pathname.match(/\/proposal\/([A-Za-z0-9_-]{20,128})\/?$/);
    token = m ? m[1] : (params.get('t') || '').trim();
  })();

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function money(n) {
    return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function dateLong(s) {
    if (!s) return '';
    var d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(s) ? undefined : 'America/New_York' });
  }
  function dateShort(s) {
    var long = dateLong(s);
    return long ? long.replace(/^(\w{3})\w*/, '$1') : '';
  }
  function clear() { while (main.firstChild) main.removeChild(main.firstChild); }

  function showError(title, msg, phone) {
    clear();
    var box = el('section', 'pp-card pp-error-card');
    box.appendChild(el('h1', 'pp-h1', title));
    box.appendChild(el('p', 'pp-lead', msg));
    var a = el('a', 'pp-btn pp-btn--primary', 'Call FloGuard ' + (phone || '(386) 259-0023'));
    a.href = 'tel:+13862590023';
    box.appendChild(a);
    main.appendChild(box);
  }

  async function post(body) {
    var r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store'
    });
    var j = null;
    try { j = await r.json(); } catch (e) { j = {}; }
    return { status: r.status, body: j || {} };
  }

  function row(label, value, cls) {
    var r = el('div', 'pp-sum-row' + (cls ? ' ' + cls : ''));
    r.appendChild(el('span', null, label));
    r.appendChild(el('span', 'pp-num', value));
    return r;
  }

  function render(p, opts) {
    opts = opts || {};
    clear();
    document.title = 'FloGuard estimate ' + p.number;
    var biz = p.business || {};
    var page = el('article', 'pp-doc');

    if (opts.preview) {
      page.appendChild(el('div', 'pp-banner pp-banner--preview no-print', 'PREVIEW. This estimate has not been sent. Your customer sees this page without this banner and can accept it only after you send it.'));
    }

    // Header
    var head = el('header', 'pp-head');
    var brand = el('div', 'pp-brand');
    var logo = el('img', 'pp-logo'); logo.src = 'logo.png'; logo.alt = ''; logo.width = 44; logo.height = 44;
    var bt = el('div');
    bt.appendChild(el('div', 'pp-bizname', biz.name || 'FloGuard'));
    bt.appendChild(el('div', 'pp-tag', biz.tagline || ''));
    brand.appendChild(logo); brand.appendChild(bt);
    var meta = el('dl', 'pp-meta');
    function m(k, v) { if (!v) return; var d = el('div'); d.appendChild(el('dt', null, k)); d.appendChild(el('dd', 'pp-num', v)); meta.appendChild(d); }
    m('Estimate', p.number);
    m('Date', dateShort(p.sent_at));
    m('Valid through', dateShort(p.valid_until));
    head.appendChild(brand); head.appendChild(meta);
    page.appendChild(head);

    // Status banner
    if (p.status === 'accepted') {
      page.appendChild(el('div', 'pp-banner pp-banner--ok', 'Accepted' + (p.accepted_name ? ' by ' + p.accepted_name : '') + (p.accepted_at ? ' on ' + dateLong(p.accepted_at) : '') + '. Thank you. FloGuard will contact you to schedule the work.'));
    } else if (p.status === 'declined') {
      page.appendChild(el('div', 'pp-banner pp-banner--muted', 'This estimate was declined' + (p.declined_at ? ' on ' + dateLong(p.declined_at) : '') + '. Call us any time if you would like to revisit it.'));
    } else if (p.status === 'expired') {
      page.appendChild(el('div', 'pp-banner pp-banner--warn', 'This estimate expired on ' + dateLong(p.valid_until) + '. Please call us for an updated estimate.'));
    }

    // Prepared for
    var pf = el('section', 'pp-sec pp-for');
    pf.appendChild(el('h2', 'pp-h2', 'Prepared for'));
    pf.appendChild(el('p', 'pp-for-name', (p.customer && p.customer.name) || ''));
    if (p.customer && p.customer.address) pf.appendChild(el('p', 'pp-for-addr', 'Site: ' + p.customer.address));
    page.appendChild(pf);

    // Scope + line items
    var sc = el('section', 'pp-sec');
    sc.appendChild(el('h2', 'pp-h2', 'Scope of work'));
    var list = el('div', 'pp-lines', null);
    var hd = el('div', 'pp-line pp-line--head');
    ['Description', 'Qty', 'Price', 'Amount'].forEach(function (h, i) { hd.appendChild(el('span', i ? 'pp-num' : null, h)); });
    list.appendChild(hd);
    (p.line_items || []).forEach(function (li) {
      var r = el('div', 'pp-line');
      r.appendChild(el('span', 'pp-desc', li.description));
      var q = el('span', 'pp-num pp-q'); q.appendChild(el('b', 'pp-lbl', 'Qty ')); q.appendChild(document.createTextNode(String(li.quantity) + (li.unit && li.unit !== 'each' ? ' ' + li.unit : '')));
      var up = el('span', 'pp-num pp-up'); up.appendChild(el('b', 'pp-lbl', 'Price ')); up.appendChild(document.createTextNode(money(li.unit_price)));
      var t = el('span', 'pp-num pp-amt', money(li.total));
      r.appendChild(q); r.appendChild(up); r.appendChild(t);
      list.appendChild(r);
    });
    sc.appendChild(list);
    var sum = el('div', 'pp-sum');
    if (p.discount > 0) { sum.appendChild(row('Subtotal', money(p.subtotal))); sum.appendChild(row('Discount', '−' + money(p.discount))); }
    sum.appendChild(row('Total', money(p.total), 'pp-sum-total'));
    sc.appendChild(sum);
    if (p.notes) { var nn = el('p', 'pp-notes', p.notes); sc.appendChild(nn); }
    page.appendChild(sc);

    // Included
    if (p.included && p.included.length) {
      var inc = el('section', 'pp-sec pp-keep');
      inc.appendChild(el('h2', 'pp-h2', 'What is included'));
      var ul = el('ul', 'pp-list');
      p.included.forEach(function (t) { ul.appendChild(el('li', null, t)); });
      inc.appendChild(ul);
      page.appendChild(inc);
    }

    // Important notes
    if (p.disclaimers && p.disclaimers.length) {
      var dsc = el('section', 'pp-sec pp-keep');
      dsc.appendChild(el('h2', 'pp-h2', 'Good to know'));
      p.disclaimers.forEach(function (t) { dsc.appendChild(el('p', 'pp-fine', t)); });
      page.appendChild(dsc);
    }

    // Terms
    var tm = el('section', 'pp-sec pp-keep pp-terms');
    tm.appendChild(el('h2', 'pp-h2', 'Terms'));
    var paras = String((p.terms && p.terms.text) || '').split(/\n{2,}/).filter(Boolean);
    paras.forEach(function (t) {
      var isPh = /\[\[/.test(t);
      tm.appendChild(el('p', isPh ? 'pp-fine pp-placeholder' : 'pp-fine', t));
    });
    if (p.terms && p.terms.placeholder) tm.appendChild(el('p', 'pp-draft-flag', 'Draft terms: FloGuard has not yet finalised the terms text shown above.'));
    page.appendChild(tm);

    // Accept block
    if (p.can_accept || (opts.preview && p.status === 'draft')) page.appendChild(acceptBlock(p, opts));
    else if (p.status === 'accepted') {
      var sig = el('section', 'pp-sec pp-sign');
      sig.appendChild(el('h2', 'pp-h2', 'Acceptance'));
      sig.appendChild(el('p', 'pp-fine', (p.accepted_name || '') + (p.accepted_at ? ' · ' + dateLong(p.accepted_at) : '')));
      sig.appendChild(el('p', 'pp-fine', p.consent_text || ''));
      page.appendChild(sig);
    }

    // Question + footer
    var q = el('section', 'pp-sec pp-help no-print');
    q.appendChild(el('h2', 'pp-h2', 'Have a question?'));
    var a = el('a', 'pp-btn', 'Call ' + (biz.phone || '(386) 259-0023'));
    a.href = biz.phone_href || 'tel:+13862590023';
    q.appendChild(a);
    if (biz.hours) q.appendChild(el('span', 'pp-fine pp-hours', biz.hours));
    page.appendChild(q);

    var ft = el('footer', 'pp-foot');
    ft.appendChild(el('div', null, [biz.name, biz.address].filter(Boolean).join(' · ')));
    ft.appendChild(el('div', null, [biz.phone, biz.email, biz.website].filter(Boolean).join(' · ')));
    if (biz.license_line) ft.appendChild(el('div', /\[\[/.test(biz.license_line) ? 'pp-placeholder' : null, biz.license_line));
    var pr = el('button', 'pp-link no-print', 'Print or save as PDF'); pr.type = 'button';
    pr.addEventListener('click', function () { window.print(); });
    ft.appendChild(pr);
    page.appendChild(ft);

    main.appendChild(page);
  }

  function acceptBlock(p, opts) {
    var s = el('section', 'pp-sec pp-accept no-print');
    s.appendChild(el('h2', 'pp-h2', 'Accept this estimate'));
    var f = el('form', 'pp-form'); f.noValidate = true;
    var l1 = el('label', 'pp-field');
    l1.appendChild(el('span', null, 'Type your full name'));
    var name = el('input'); name.type = 'text'; name.autocomplete = 'name'; name.maxLength = 120; name.required = true; name.id = 'ppName';
    l1.appendChild(name);
    var l2 = el('label', 'pp-check');
    var cb = el('input'); cb.type = 'checkbox'; cb.id = 'ppConsent';
    l2.appendChild(cb); l2.appendChild(el('span', null, p.consent_text || 'I have reviewed this estimate and I accept it.'));
    var msg = el('p', 'pp-msg'); msg.setAttribute('role', 'alert');
    var go = el('button', 'pp-btn pp-btn--primary pp-btn--lg', 'Accept estimate'); go.type = 'submit';
    f.appendChild(l1); f.appendChild(l2); f.appendChild(go); f.appendChild(msg);
    s.appendChild(f);
    s.appendChild(el('p', 'pp-fine', 'No payment is taken on this page.'));

    var dec = el('details', 'pp-decline');
    dec.appendChild(el('summary', null, 'Not now? Decline this estimate'));
    var why = el('textarea'); why.rows = 2; why.maxLength = 500; why.placeholder = 'Optional: tell us why'; why.setAttribute('aria-label', 'Reason (optional)');
    var dgo = el('button', 'pp-btn', 'Decline estimate'); dgo.type = 'button';
    dec.appendChild(why); dec.appendChild(dgo);
    s.appendChild(dec);

    if (opts.preview) { go.disabled = true; dgo.disabled = true; msg.textContent = 'Disabled in preview.'; }

    f.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (opts.preview) return;
      msg.className = 'pp-msg';
      var full = name.value.replace(/\s+/g, ' ').trim();
      if (full.split(' ').length < 2 || full.length < 3) { msg.textContent = 'Please type your first and last name.'; msg.className = 'pp-msg pp-msg--err'; name.focus(); return; }
      if (!cb.checked) { msg.textContent = 'Please tick the box to confirm.'; msg.className = 'pp-msg pp-msg--err'; cb.focus(); return; }
      go.disabled = true; go.textContent = 'Submitting…';
      try {
        var r = await post({ action: 'proposal_accept', token: token, name: full, consent: true });
        if (r.status === 200 && r.body.proposal) { render(r.body.proposal); window.scrollTo(0, 0); return; }
        msg.textContent = r.body.detail || r.body.error || 'Something went wrong. Please call us.';
        msg.className = 'pp-msg pp-msg--err';
        if (r.status === 410 || r.status === 409) { await load(); return; }
      } catch (e) {
        msg.textContent = 'We could not reach the server. Please check your connection and try again.';
        msg.className = 'pp-msg pp-msg--err';
      }
      go.disabled = false; go.textContent = 'Accept estimate';
    });
    dgo.addEventListener('click', async function () {
      if (opts.preview) return;
      dgo.disabled = true;
      try {
        var r = await post({ action: 'proposal_decline', token: token, reason: why.value.trim() });
        if (r.status === 200 && r.body.proposal) { render(r.body.proposal); window.scrollTo(0, 0); return; }
        msg.textContent = r.body.detail || r.body.error || 'Something went wrong. Please call us.';
        msg.className = 'pp-msg pp-msg--err';
      } catch (e) { msg.textContent = 'We could not reach the server. Please try again.'; msg.className = 'pp-msg pp-msg--err'; }
      dgo.disabled = false;
    });
    return s;
  }

  async function load() {
    if (!token) { showError('Estimate not found', 'This link is incomplete. Please use the link FloGuard sent you, or call us.'); return; }
    try {
      var r = await post({ action: 'proposal_get', token: token });
      if (r.status === 200 && r.body.proposal) { render(r.body.proposal); return; }
      if (r.status === 429) { showError('Please try again in a minute', 'Too many requests from your connection.'); return; }
      showError('Estimate not found', 'We could not find this estimate. It may have been replaced. Please call us and we will send a new link.');
    } catch (e) {
      showError('We could not load your estimate', 'Please check your connection and reload, or call us.');
    }
  }

  if (preview) {
    // Rep-side preview: the CRM window that opened this tab hands over the draft (same origin only).
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || e.source !== window.opener) return;
      if (e.data && e.data.type === 'fg-proposal-data' && e.data.proposal) render(e.data.proposal, { preview: true });
    });
    if (window.opener) { try { window.opener.postMessage({ type: 'fg-proposal-ready' }, location.origin); } catch (e) { /* ignore */ } }
    else showError('Preview unavailable', 'Open the preview from the estimate editor in the CRM.');
  } else {
    load();
  }
})();
