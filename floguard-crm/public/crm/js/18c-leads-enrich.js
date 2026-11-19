/* ================= LEADS NEXT (F1): enrich modal =================
 * Scope (selected / current filter / all missing a phone) -> capabilities + estimate first ->
 * spend cap (maxPaidLookups, default 50, up to 500) -> batches of 12 with a progress bar.
 * The cap is enforced client-side across batches with budget.used_total (the API is stateless).
 * Results never overwrite an existing phone/email (applyEnrichResult in 06-leads.js). */
(function(){
'use strict';
const FG=window.FG; if(!FG) return;
const h=FG.h;
const E=FG.enrich={};
const BATCH=12;
const SOURCE_LABEL={batchdata:'BatchData', trestle:'Trestle', web:'Website', search:'Web search', directory_search:'Directory', website_scrape:'Website', manual:'Manual'};

function candidate(l){ return !!String(l.name||'').trim() && (!!String(l.address||'').trim() || !!String(l.city||'').trim()); }
function missingPhone(l){ return !FG.phone.list(l).length; }
E.scopes=function(opts){
 const sel=FG.views?FG.views.selectedLeads():[];
 const filtered=typeof visibleLeads==='function'?visibleLeads({noSort:true}):state.slice();
 const out={
  selected:sel.filter(candidate),
  filtered:filtered.filter(candidate),
  missing:state.filter(function(l){ return candidate(l) && missingPhone(l); })
 };
 if(opts&&opts.leads) out.given=opts.leads.filter(candidate);
 return out;
};
async function api(body){
 const tok=getToken();
 if(!tok) return {ok:false, status:401, data:{error:'Sign in required'}};
 try{
  const r=await fetch('/crm/api/enrich-contacts',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify(body)});
  let data=null; try{ data=await r.json(); }catch(e){}
  return {ok:r.ok, status:r.status, data:data};
 }catch(e){ return {ok:false, status:0, data:{error:'Network error'}}; }
}
E.api=api;
function chunks(list, n){ const out=[]; for(let i=0;i<list.length;i+=n) out.push(list.slice(i,i+n)); return out; }
async function estimateAll(leads, allowPaid){
 const parts=chunks(leads, BATCH);
 const tot={leads:0, batchdata:0, trestle_phone_intel:0, trestle_reverse_phone:0, expected_lookups:0, max_lookups:0, free:0};
 let caps=null, failed=false, daily=null;
 let i=0;
 async function worker(){
  while(i<parts.length){
   const part=parts[i++];
   const res=await api({action:'estimate', leads:part.map(slimForEnrich), allowPaid:allowPaid});
   if(!res.ok||!res.data||!res.data.totals){ failed=true; continue; }
   caps=caps||res.data.capabilities;
   if(res.data.daily) daily=res.data.daily;
   const t=res.data.totals;
   if(t.daily_cap!=null) tot.daily_cap=Number(t.daily_cap);
   ['leads','batchdata','trestle_phone_intel','trestle_reverse_phone','expected_lookups','max_lookups'].forEach(function(k){ tot[k]+=Number(t[k])||0; });
   (res.data.leads||[]).forEach(function(x){ if(x.free&&x.free.length) tot.free++; });
  }
 }
 await Promise.all([worker(),worker(),worker()]);
 return {totals:tot, capabilities:caps, failed:failed, daily:daily};
}

E.open=async function(opts){
 opts=opts||{};
 const scopes=E.scopes(opts);
 let scope=opts.scope&&scopes[opts.scope]?opts.scope:(scopes.selected.length?'selected':'missing');
 if(opts.leads) scope='given';
 let caps=null, est=null, running=false, cancelled=false, finished=false;
 const body=document.createElement('div');
 body.className='en-body';
 const scopeRow=function(id, label, n, sub){
  return '<label class="en-scope-opt'+(n?'':' is-empty')+'"><input type="radio" name="enScope" value="'+id+'"'+(scope===id?' checked':'')+(n?'':' disabled')+'><span><span class="en-scope-top"><b>'+h(label)+'</b><span class="num">'+n+'</span></span><small>'+h(sub)+'</small></span></label>';
 };
 body.innerHTML=
  '<fieldset class="en-scope"><legend class="fg-lbl">Which leads</legend>'+
   (scopes.given?scopeRow('given','Leads just added', scopes.given.length, 'From the flood map'):'')+
   scopeRow('selected','Selected', scopes.selected.length, scopes.selected.length?'Rows you checked':'Check rows in the table first')+
   scopeRow('filtered','Current view', scopes.filtered.length, 'Cause tab, search and filter chips')+
   scopeRow('missing','All missing a phone', scopes.missing.length, 'Across every cause')+
  '</fieldset>'+
  '<div class="en-providers" id="enProviders"><span class="hint">Checking providers…</span></div>'+
  '<div class="en-est" id="enEst" aria-live="polite"></div>'+
  '<div class="en-cap"><label class="fg-lbl" for="enCap">Spend cap: paid lookups for this run</label>'+
   '<div class="en-cap-row"><input type="range" id="enCap" min="0" max="500" step="5" value="50"><output id="enCapOut" class="num" for="enCap">50</output></div>'+
   '<p class="hint" id="enCapHint">One lookup is one paid provider call. 0 runs free web search only.</p></div>'+
  '<p class="hint en-dnc">'+FG.icon('triangle-alert')+'<span>Found numbers are <b>not scrubbed</b> unless a provider says so. Scrub against DNC before dialing. Enrichment is not consent.</span></p>'+
  '<div class="en-progress" id="enProgress" hidden><div class="en-bar"><i id="enBar"></i></div><div class="en-ptxt num" id="enPtxt"></div></div>'+
  '<div class="en-summary" id="enSummary" hidden></div>';
 const m=FG.modal({title:'Enrich contacts', body:body, size:'md', className:'fg-enrich',
  actions:[
   {label:'Cancel', kind:'ghost', id:'enCancel', onClick:function(){ if(running){ cancelled=true; FG.toast('Stopping after this batch…', {kind:'info'}); return false; } }},
   {label:'Run enrich', kind:'p', icon:'sparkles', id:'enRun', onClick:function(){ if(finished) return; run(); return false; }}
  ],
  onClose:function(){ cancelled=true; }
 });
 const $=function(id){ return body.querySelector('#'+id); };
 const runBtn=m.el.querySelector('#enRun');
 const capEl=$('enCap'), capOut=$('enCapOut');
 capEl.addEventListener('input', function(){ capOut.textContent=capEl.value; paintEst(); });
 body.querySelector('.en-scope').addEventListener('change', function(e){ if(e.target.name==='enScope'){ scope=e.target.value; refreshEstimate(); } });
 function scopeLeads(){ return (E.scopes(opts)[scope]||[]); }
 function paidOn(){ return !!(caps&&(caps.batchdata||caps.trestle)); }
 function paintProviders(){
  const box=$('enProviders');
  if(!caps){ box.innerHTML='<div class="warn">'+FG.icon('triangle-alert')+' The enrich service is not reachable. Check your connection and sign-in, then try again.</div>'; return; }
  const chip=function(on, label, sub){ return '<span class="en-prov'+(on?' on':'')+'">'+FG.icon(on?'circle-check':'ban')+'<b>'+h(label)+'</b><small>'+h(sub)+'</small></span>'; };
  box.innerHTML=chip(!!caps.batchdata,'BatchData','skip-trace + DNC')+chip(!!caps.trestle,'Trestle','line type, litigator, owner match')+chip(true,'Free web search','directory + websites')+
   (paidOn()?'':'<div class="en-note">No paid provider is configured, so this run uses free search only and finds fewer numbers. Paid lookups need <code>BATCHDATA_API_KEY</code> and/or <code>TRESTLE_API_KEY</code> set on the server.</div>');
  const hard=Number(caps.hard_max_paid_lookups)||500;
  capEl.max=String(hard);
  if(!capEl.dataset.touched){ capEl.value=String(Number(caps.default_max_paid_lookups)||50); capOut.textContent=capEl.value; }
  capEl.disabled=!paidOn();
  $('enCapHint').textContent=paidOn()?'One lookup is one paid provider call (max '+hard+'). 0 runs free web search only.':'Spend cap applies to paid providers; none is configured.';
 }
 capEl.addEventListener('change', function(){ capEl.dataset.touched='1'; });
 /** Org-wide daily paid-lookup cap from the server (R1): shown beside the per-run cap. */
 function dailyNote(d, capFromTotals){
  const cap=d&&d.cap!=null?Number(d.cap):(capFromTotals!=null?Number(capFromTotals):null);
  if(cap==null||!paidOn()) return d&&d.warning?'<div class="en-capnote">'+FG.icon('triangle-alert')+h(d.warning)+'</div>':'';
  const rem=d&&d.remaining!=null?Number(d.remaining):null;
  return '<div class="en-capnote en-daily'+(rem===0?' is-out':'')+'">'+FG.icon('calendar-clock')+'<span>Daily limit for the team: <b class="num">'+(rem!=null?rem+' of '+cap:cap)+'</b> paid lookups '+(rem!=null?'left today':'per day')+'.'+(d&&d.warning?' '+h(d.warning):'')+'</span></div>';
 }
 function paintEst(){
  const box=$('enEst');
  const n=scopeLeads().length;
  if(!n){ box.innerHTML='<span class="hint">No leads in this scope have a name and an address or city.</span>'; runBtn.disabled=true; return; }
  if(!est){ box.innerHTML='<span class="hint">Estimating '+n+' lead'+(n===1?'':'s')+'…</span>'; runBtn.disabled=true; return; }
  const t=est.totals, cap=Number(capEl.value)||0;
  const capped=paidOn()&&t.expected_lookups>cap;
  box.innerHTML='<div class="en-est-grid">'+
   '<div><span class="fn-l">Leads</span><b class="num">'+t.leads+'</b></div>'+
   '<div><span class="fn-l">Paid lookups</span><b class="num">'+(paidOn()?t.expected_lookups:0)+'</b><small class="num">max '+(paidOn()?t.max_lookups:0)+'</small></div>'+
   '<div><span class="fn-l">BatchData</span><b class="num">'+t.batchdata+'</b></div>'+
   '<div><span class="fn-l">Trestle checks</span><b class="num">'+(t.trestle_phone_intel+t.trestle_reverse_phone)+'</b></div>'+
   '</div>'+dailyNote(est.daily, t.daily_cap)+(capped?'<div class="en-capnote">'+FG.icon('info')+'The cap ('+cap+') is below the expected '+t.expected_lookups+' lookups. The run stops when the cap is used up.</div>':'')+
   (est.failed?'<div class="en-capnote">'+FG.icon('triangle-alert')+'Part of the estimate failed; numbers may be low.</div>':'');
  runBtn.disabled=running||!caps;
 }
 let estSeq=0;
 async function refreshEstimate(){
  const seq=++estSeq;
  est=null; paintEst();
  const leads=scopeLeads(); if(!leads.length) return;
  const r=await estimateAll(leads, true);
  if(seq!==estSeq) return;
  if(r.capabilities && !caps){ caps=r.capabilities; paintProviders(); }
  est=r; paintEst();
 }
 // capabilities first, then the estimate
 const capRes=await api({action:'capabilities'});
 caps=capRes.ok&&capRes.data?capRes.data.capabilities:null;
 paintProviders();
 if(caps) refreshEstimate(); else { $('enEst').innerHTML=''; runBtn.disabled=true; }

 async function run(){
  const leads=scopeLeads().slice();
  if(!leads.length||running) return;
  running=true; cancelled=false;
  runBtn.disabled=true;
  body.querySelector('.en-scope').disabled=true; capEl.disabled=true;
  const cap=paidOn()?Number(capEl.value)||0:0;
  let remaining=cap;
  const sum={found:0, partial:0, not_found:0, complete:0, blocked:0, errors:0, changed:0, spent:0, skipped:0};
  const byProv={}; const warns={}; let fundingIssue=false;
  const prog=$('enProgress'); prog.hidden=false;
  const bar=$('enBar'), ptxt=$('enPtxt');
  const parts=chunks(leads, BATCH);
  let done=0, stopReason='', lastDaily=null;
  const changedLeads=[];
  for(let i=0;i<parts.length;i++){
   if(cancelled){ stopReason='Stopped by you.'; break; }
   if(paidOn() && cap>0 && remaining<=0){ stopReason='Spend cap reached ('+cap+' paid lookups).'; break; }
   const part=parts[i];
   ptxt.textContent='Batch '+(i+1)+' of '+parts.length+' · '+done+' of '+leads.length+' leads'+(paidOn()?' · '+(cap-remaining)+' of '+cap+' paid lookups used':'');
   const res=await api({action:'enrich', leads:part.map(slimForEnrich), allowPaid:cap>0, maxPaidLookups:Math.max(0,remaining)});
   if(!res.ok||!res.data){
    sum.errors+=part.length;
    if(res.status===401){ stopReason='Session expired. Sign in again.'; break; }
    continue;
   }
   const d=res.data;
   if(d.daily){ lastDaily=d.daily; if(d.daily.warning){ const k=String(d.daily.warning).slice(0,140); warns[k]=(warns[k]||0)+1; } }
   const used=d.budget&&Number(d.budget.used_total)||0;
   remaining-=used; sum.spent+=used;
   const byId={}; (d.results||[]).forEach(function(r){ if(r&&r.id!=null) byId[String(r.id)]=r; });
   part.forEach(function(l){
    const r=byId[String(l.id)];
    if(!r){ sum.not_found++; return; }
    if(r.status in sum) sum[r.status]++; else if(r.status==='timeout_budget'||r.status==='error') sum.errors++; else sum.not_found++;
    (r.sources||[]).forEach(function(s){ byProv[s]=(byProv[s]||0)+1; });
    (r.warnings||[]).forEach(function(w){ const k=String(w).slice(0,140); warns[k]=(warns[k]||0)+1; if(/402|insufficient|credit|balance|quota|payment|fund/i.test(k)) fundingIssue=true; });
    if(applyEnrichResult(l, r)){ sum.changed++; changedLeads.push({l:l, r:r}); }
   });
   done+=part.length;
   bar.style.width=Math.round(100*done/leads.length)+'%';
   if(d.daily && Number(d.daily.granted)===0 && paidOn() && cap>0){ stopReason='The team\'s daily lookup limit is used up'+(d.daily.cap!=null?' ('+d.daily.cap+' per day)':'')+'. Try again tomorrow.'; if(i<parts.length-1){ sum.skipped=leads.length-done; } break; }
   if(d.budget && d.budget.exhausted && paidOn() && cap>0 && remaining<=0){ stopReason='Spend cap reached ('+cap+' paid lookups).'; if(i<parts.length-1){ sum.skipped=leads.length-done; } break; }
  }
  if(!sum.skipped && done<leads.length) sum.skipped=leads.length-done;
  bar.style.width=Math.round(100*done/Math.max(1,leads.length))+'%';
  ptxt.textContent=(stopReason?stopReason+' ':'Finished. ')+done+' of '+leads.length+' leads processed.';
  if(sum.changed){ saveLeads(); render(); }
  changedLeads.forEach(function(x){
   const r=x.r;
   FG.activity.log(x.l, {type:'enrich', body:'Enriched: '+(r.status||'')+(r.phones&&r.phones.length?' · '+r.phones.length+' number'+(r.phones.length===1?'':'s'):'')+(r.sources&&r.sources.length?' · '+r.sources.join(', '):''), meta:{status:r.status, sources:r.sources||[]}});
  });
  const provHtml=Object.keys(byProv).sort(function(a,b){ return byProv[b]-byProv[a]; }).map(function(k){ return '<span class="ph-chip">'+h(SOURCE_LABEL[k]||k)+' <b class="num">'+byProv[k]+'</b></span>'; }).join('')||'<span class="hint">No provider returned anything.</span>';
  const warnList=Object.keys(warns).slice(0,5);
  const s=$('enSummary'); s.hidden=false;
  s.innerHTML='<h3>Results</h3><div class="en-res">'+
   '<div class="r-ok"><b class="num">'+(sum.found+sum.partial)+'</b><span>found</span><small class="num">'+sum.found+' full · '+sum.partial+' partial</small></div>'+
   '<div class="r-bad"><b class="num">'+sum.blocked+'</b><span>blocked</span><small>DNC / litigator only</small></div>'+
   '<div><b class="num">'+sum.not_found+'</b><span>none</span><small>no number found</small></div>'+
   '<div><b class="num">'+sum.spent+'</b><span>paid lookups</span><small class="num">'+(paidOn()?'cap '+cap:'free only')+'</small></div>'+
   '</div><div class="en-byprov"><span class="fg-lbl">By provider</span>'+provHtml+'</div>'+
   (sum.complete?'<p class="hint">'+sum.complete+' already had phone and email.</p>':'')+
   (sum.errors?'<p class="hint">'+sum.errors+' lead'+(sum.errors===1?'':'s')+' errored or ran out of time; run again to retry.</p>':'')+
   (sum.skipped?'<p class="hint">'+sum.skipped+' lead'+(sum.skipped===1?'':'s')+' not processed. Raise the cap and run again to continue.</p>':'')+
   (fundingIssue?'<div class="warn">A paid provider refused requests (out of credit or not funded). Check the provider account; free search still ran.</div>':'')+
   (warnList.length?'<details class="en-warn"><summary>Warnings ('+warnList.length+')</summary><ul>'+warnList.map(function(w){ return '<li>'+h(w)+(warns[w]>1?' <span class="num">×'+warns[w]+'</span>':'')+'</li>'; }).join('')+'</ul></details>':'')+
   '<p class="hint">'+sum.changed+' lead'+(sum.changed===1?'':'s')+' updated. Numbers are not scrubbed unless marked; scrub DNC before dialing.</p>';
  running=false;
  finished=true;
  runBtn.textContent='Done';
  runBtn.disabled=false;
  runBtn.focus();
  m.el.querySelector('#enCancel').hidden=true;
  enrichStatus('Enrich: '+(sum.found+sum.partial)+' found · '+sum.blocked+' blocked · '+sum.not_found+' none · '+sum.spent+' paid lookups. Scrub DNC before dialing.');
  FG.toast('Enrich finished: '+(sum.found+sum.partial)+' found, '+sum.blocked+' blocked, '+sum.not_found+' none.', {kind:'ok'});
 }
 return m;
};
})();
