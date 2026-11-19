/* ================= LEADS (tracker) ================= */
function industries(){ const s=new Set(); state.forEach(l=>{ if(l.industry) s.add(l.industry); }); return [...s].sort(); }
function listBadge(list){ return list==='FrenchDrain'?'web':list==='SumpPump'?'dnd':list==='YardDrainage'?'med':list==='Maintenance'?'acad':list==='PropertyMgmt'?'pm':'web'; }

function leadLists(l){
 if(Array.isArray(l.lists) && l.lists.length){
 return l.lists.filter(function(x){ return LISTS.includes(x); });
 }
 const one=l && l.list;
 return one && LISTS.includes(one) ? [one] : ['FrenchDrain'];
}

function activeCause(l){
 const lists=leadLists(l);
 if(view!=='All' && lists.includes(view)) return view;
 if(l && l.list && lists.includes(l.list)) return l.list;
 return lists[0]||'Website';
}

function ensureListStatus(l){
 if(!l.list_status || typeof l.list_status!=='object') l.list_status={};
 const lists=leadLists(l);
 const roll=l.status||'New';
 lists.forEach(function(c){
 if(l.list_status[c]==null || l.list_status[c]==='') l.list_status[c]=roll||'New';
 });
 // Drop statuses for unchecked causes
 Object.keys(l.list_status).forEach(function(k){
 if(!lists.includes(k)) delete l.list_status[k];
 });
 return l.list_status;
}

function getListStatus(l, cause){
 const c=cause||activeCause(l);
 ensureListStatus(l);
 if(l.list_status && l.list_status[c]!=null && l.list_status[c]!=='') return l.list_status[c];
 return l.status||'New';
}

function setListStatus(l, cause, status){
 const c=cause||activeCause(l);
 if(!l.list_status || typeof l.list_status!=='object') l.list_status={};
 const fg=window.FG&&FG.ready;
 const prevDerived=fg?FG.deriveStage(l):null, prevStage=fg?FG.stageOf(l):null;
 l.list_status[c]=status;
 // Rollup primary status for CSV/sync/LeadAgent compat
 if(!l.list || l.list===c || !leadLists(l).includes(l.list)) l.list=c;
 if(l.list===c) l.status=status;
 // Pipeline stage follows a moved legacy status (same rule as the server)
 if(fg) FG.onStatusChange(l, prevDerived, prevStage);
 return l;
}

function setLeadLists(l, lists, opts){
 opts=opts||{};
 let next=(lists||[]).filter(function(x){ return LISTS.includes(x); });
 // unique preserve order
 const seen={}; next=next.filter(function(x){ if(seen[x]) return false; seen[x]=1; return true; });
 if(!next.length){
 if(opts.allowEmpty){ l.lists=[]; l.list='Website'; return l; }
 next=[LISTS.includes(view)?view:'Website'];
 }
 l.lists=next;
 if(!next.includes(l.list)) l.list=next[0];
 if(opts.touched) l.lists_touched=true;
 ensureListStatus(l);
 // Keep rollup status in sync with primary list
 l.status=getListStatus(l, l.list);
 return l;
}

function toggleLeadCause(l, cause, checked){
 const cur=leadLists(l).slice();
 const i=cur.indexOf(cause);
 if(checked && i<0) cur.push(cause);
 if(!checked && i>=0){
 if(cur.length===1){
 const archive=function(){
  l.status='Archived';
  setListStatus(l, cause, 'Archived');
  setLeadLists(l, [], {allowEmpty:true, touched:true});
  l.list='Website';
  return true;
 };
 // R2: app modal instead of window.confirm. Returns a Promise<boolean>; callers keep the box as
 // it was and finish their work when it resolves true.
 if(window.FG&&FG.confirm){
  return FG.confirm({title:'Archive this lead?', message:'"'+(l.name||'This business')+'" is only on '+causeLabel(cause)+'. Unchecking it archives the lead.', confirmLabel:'Uncheck and archive', danger:true}).then(function(y){ return y?archive():false; });
 }
 if(!confirm('"'+ (l.name||'This business') +'" is only on '+cause+'. Uncheck last cause and archive?')) return false;
 return archive();
 }
 cur.splice(i,1);
 }
 setLeadLists(l, cur, {touched:true});
 if(checked) setListStatus(l, cause, getListStatus(l, cause)||'New');
 return true;
}

function renderCauseChecks(l, opts){
 opts=opts||{};
 const lists=leadLists(l);
 const full=!!opts.full;
 const id=l.id!=null?l.id:'';
 return '<div class="cause-checks'+(full?' full':'')+'" data-lead-id="'+esc(String(id))+'">'+
 LISTS.map(function(c){
 const on=lists.includes(c);
 const tabOn=(view!=='All' && view===c)?' tab-active':'';
 const label=full?c:(LIST_SHORT[c]||c);
 return '<label class="cause-chip'+(on?' on':'')+' badge-'+listBadge(c)+tabOn+'" title="'+esc(c)+'">'+
 '<input type="checkbox" data-cause="'+esc(c)+'"'+(on?' checked':'')+'>'+esc(label)+'</label>';
 }).join('')+
 '</div>';
}

function parseWfsFromNotes(notes){
 const text=String(notes||'');
 const m=text.match(/(?:WFS|DNS)\s+(\d{1,3})\/([A-F])\s*\((rebuild|modernize|hold|disqualify|urgent|priority|monitor)\)\s*(?:\|\s*([^\n]+))?/i);
 if(!m) return null;
 const gaps=(m[4]||'').split(';').map(function(s){return s.trim();}).filter(Boolean);
 return {total:Number(m[1]), grade:m[2].toUpperCase(), band:m[3].toLowerCase(), gaps:gaps};
}
function resolveWebsiteScore(l){
 if(l && l.website_score && l.website_score.total!=null){
 return {
 total:Number(l.website_score.total)||0,
 grade:String(l.website_score.grade||'').toUpperCase()||'F',
 band:String(l.website_score.band||'').toLowerCase()||'',
 gaps:Array.isArray(l.website_score.gaps)?l.website_score.gaps:[]
 };
 }
 return parseWfsFromNotes(l && l.notes);
}
function renderFitnessCard(l){
 const el=document.getElementById('pfFitness');
 if(!el) return;
 const ws=resolveWebsiteScore(l);
 if(!ws){
 el.hidden=true;
 el.innerHTML='<div class="wfs-empty">No Drainage Need Score yet.'+(leadFloodScore(l)!=null?' Flood score from the map: <b>'+esc(String(Math.round(leadFloodScore(l))))+'</b> (a call-list rank, not an inspection).':'')+' After talking to the owner, note it in the lead notes as <i>DNS 72/B</i> with what they described (for example, standing water 2+ days).</div>';
 el.hidden=false;
 return;
 }
 const gaps=(ws.gaps||[]).slice(0,5);
 const bandLabel={rebuild:'Rebuild recommended',modernize:'Modernize',hold:'Hold / light touch',disqualify:'Do not pitch rebuild'}[ws.band]||ws.band;
 el.innerHTML=
 '<div class="wfs-head">'+
 '<div class="wfs-score g-'+esc(ws.grade)+'">'+esc(String(ws.total))+'<span style="font-size:12px;font-weight:700;color:var(--muted)">/100</span></div>'+
 '<div><b>Grade '+esc(ws.grade)+'</b> · '+esc(bandLabel)+
 '<div class="hint" style="margin-top:2px">Drainage Need Score — sales urgency, not an engineering assessment</div></div>'+
 '</div>'+
 (gaps.length?'<ul>'+gaps.map(function(g){return '<li>'+esc(g)+'</li>';}).join('')+'</ul>':
 '<div class="hint" style="margin-top:6px">No gap list stored.</div>');
 el.hidden=false;
}
/** Pull site address out of older notes (FSI import used to bury it). */
function extractAddressFromNotes(notes){
 const text=String(notes||'');
 let m=text.match(/^\s*Site address:\s*(.+)$/im);
 if(m){
  const v=m[1].trim();
  // Ignore placeholder from older imports
  if(v && v!=='—' && v!=='-' && !/^n\/?a$/i.test(v)) return v;
 }
 m=text.match(/^\s*Addr(?:ess)?:\s*(.+)$/im);
 if(m){
  const v=m[1].trim();
  if(v && v!=='—') return v;
 }
 // Street-like line with FL zip
 m=text.match(/\b(\d{1,6}\s+[A-Za-z0-9.'\-\s]+(?:Ave|Av|St|Street|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Ct|Court|Way|Cir|Pl|Place|Ter|Pkwy|Hwy)[^\n]*,\s*[^,\n]+,\s*FL\s*\d{5}(?:-\d{4})?)/i);
 if(m) return m[1].replace(/\s+/g,' ').trim();
 return '';
}
function extractParcelIdFromNotes(notes){
 const m=String(notes||'').match(/^\s*Parcel:\s*(\S+)/im);
 return m?m[1].trim():'';
}
function normalizeLead(l){
 if(l.amount==null) l.amount='';
 if(l.owner==null) l.owner='';
 if(l.package==null) l.package='';
 if(l.email==null) l.email='';
 if(l.next_follow_up_at==null) l.next_follow_up_at='';
 if(l.address==null) l.address='';
 if(l.zip==null) l.zip='';
 if(l.parcel_id==null) l.parcel_id='';
 if(l.mgmt_company_id==null) l.mgmt_company_id='';
 if(l.mgmt_company_name==null) l.mgmt_company_name='';
 if(l.maintenance_last_service==null) l.maintenance_last_service='';
 if(l.maintenance_frequency==null) l.maintenance_frequency='';
 if(l.maintenance_next_due==null) l.maintenance_next_due='';
 if(l.maintenance_plan==null) l.maintenance_plan='';
 if(l.suggested_causes==null) l.suggested_causes=[];

 // Migrate legacy list labels only — do NOT re-add multi-cause by industry
 if(!l.lists || !Array.isArray(l.lists) || !l.lists.length){
 l.lists = l.list && LISTS.includes(l.list) ? [l.list] : ['FrenchDrain'];
 } else {
 l.lists = l.lists.filter(function(x){ return LISTS.includes(x); });
 if(!l.lists.length) l.lists=['FrenchDrain'];
 }
 if(!l.list || !LISTS.includes(l.list) || !l.lists.includes(l.list)) l.list=l.lists[0];
 // Always re-hydrate website_score from WFS notes (enrichment path writes compact notes)
 const parsed=parseWfsFromNotes(l.notes);
 if(parsed) l.website_score=parsed;
 // Soft-fill email/phone from notes when dedicated fields empty (legacy enrich dumps)
 if(!(l.email||'').trim() && l.notes){
 const em=String(l.notes).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
 if(em && !/example\.com|domain\.com|email\.com/i.test(em[0])) l.email=em[0];
 }
 if(!(l.phone||'').trim() && l.notes){
 const ph=String(l.notes).match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/);
 if(ph) l.phone=ph[0];
 }
 // Backfill address / parcel_id from FSI notes (older map imports buried site address)
 if(!(l.address||'').trim() && l.notes){
 const a=extractAddressFromNotes(l.notes);
 if(a) l.address=a;
 }
 if(!(l.parcel_id||'').trim() && l.notes){
 const pid=extractParcelIdFromNotes(l.notes);
 if(pid) l.parcel_id=pid;
 }
 if(!(l.zip||'').trim() && (l.address||'')){
 const zm=String(l.address).match(/\bFL\s*(\d{5})(?:-\d{4})?\b/i);
 if(zm) l.zip=zm[1];
 }
 ensureListStatus(l);
 if(!l.status) l.status=getListStatus(l, l.list);
 return l;
}
function addCategoryToLead(l, cat){
 const lists=leadLists(l).slice();
 if(!lists.includes(cat)) lists.push(cat);
 setLeadLists(l, lists, {touched:true});
 return l;
}

function inView(l){
 if(view==='All') return true;
 return leadLists(l).includes(view);
}
function cities(){
 const s=new Set();
 state.forEach(function(l){ if(l.city) s.add(l.city); });
 CITIES.forEach(function(c){ s.add(c); });
 return [...s].sort();
}
function refreshIndustryFilter(){
 const sel=document.getElementById('industry'); if(!sel) return;
 const cur=sel.value;
 sel.innerHTML='<option value="">All industries</option>'+industries().map(i=>`<option value="${esc(i)}">${esc(i)}</option>`).join('');
 if([...sel.options].some(o=>o.value===cur)) sel.value=cur;
}
function refreshCityFilter(){
 const sel=document.getElementById('cityFilter'); if(!sel) return;
 const cur=sel.value;
 sel.innerHTML='<option value="">All cities</option>'+cities().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
 if([...sel.options].some(o=>o.value===cur)) sel.value=cur;
}
/** Flood score carried from the map (must-have score, else live FSI), or null. R2. */
function leadFloodScore(l){
 const m=Number(l&&l.must_have_score), f=Number(l&&l.fsi_live);
 if(l&&l.must_have_score!=null&&isFinite(m)) return m;
 if(l&&l.fsi_live!=null&&isFinite(f)) return f;
 return null;
}
function scoreCellHtml(l){
 const ws=resolveWebsiteScore(l);
 if(!ws){
 const fs=leadFloodScore(l);
 if(fs!=null){
  const tone=fs>=70?'hot':fs>=45?'g-C':'g-E';
  return '<span class="wfs-pill '+tone+'" title="Flood score from the map (terrain, soil, zone, rain). A call-list rank, not an inspection.">'+esc(String(Math.round(fs)))+'</span>';
 }
 return '<span class="wfs-pill none" title="No score yet. Leads added from the flood map carry their flood score; others get a Drainage Need Score after an assessment.">—</span>';
 }
 const gaps=(ws.gaps||[]).slice(0,3).join('; ');
 const title=esc('DNS '+ws.total+'/'+ws.grade+(ws.band?(' · '+ws.band):'')+(gaps?(' · '+gaps):''));
 return '<span class="wfs-pill g-'+esc(ws.grade)+'" title="'+title+'">'+esc(String(ws.total))+'/'+esc(ws.grade)+'</span>';
}
/** Visual tone for a status pill (presentation only). */
function statusTone(st){
 if(CLOSED_STATUSES.has(st)) return 'won';
 if(LOST_STATUSES.has(st)) return 'lost';
 if(st==='Quoted') return 'quoted';
 if(PIPELINE_STATUSES.has(st)) return 'active';
 if(!st||st==='New') return 'new';
 if(st==='Archived') return 'muted';
 return 'touched';
}
/** Leads that pass the cause tab, industry/city/due filters, search and the saved filter chips. */
function visibleLeads(opts){
 opts=opts||{};
 const ind=(document.getElementById('industry')||{}).value||'';
 const city=(document.getElementById('cityFilter')&&document.getElementById('cityFilter').value)||'';
 const q=((document.getElementById('search')||{}).value||'').trim().toLowerCase();
 const dueOnly=view==='Maintenance' && !!(document.getElementById('dueThisMonth')&&document.getElementById('dueThisMonth').checked);
 const fg=window.FG&&FG.ready;
 const out=[];
 state.forEach(function(l){
  normalizeLead(l);
  if(!inView(l)) return;
  if(ind&&l.industry!==ind) return;
  if(city&&l.city!==city) return;
  if(dueOnly && !(isDueThisMonth(l)||isOverdue(l))) return;
  if(q){
   const phones=Array.isArray(l.phones)?l.phones.map(function(p){ return p&&p.number||''; }).join(' '):'';
   const hay=(l.name+' '+(l.address||'')+' '+l.city+' '+(l.zip||'')+' '+(l.parcel_id||'')+' '+l.industry+' '+l.phone+' '+phones+' '+(l.email||'')+' '+l.notes+' '+l.website+' '+(l.mgmt_company_name||'')+' '+(l.owner||'')).toLowerCase();
   if(!hay.includes(q)) return;
  }
  if(fg && !opts.noChips && FG.views && !FG.views.passesChips(l)) return;
  out.push(l);
 });
 return (fg && FG.views && !opts.noSort) ? FG.views.sortLeads(out) : out;
}
function phoneCellExtras(l){
 if(!(window.FG&&FG.ready)) return '';
 const list=FG.phone.list(l);
 if(!list.length){
  return l.enrich_status==='blocked'?'<div class="ph-line"><span class="ph-chip bad">All numbers blocked</span></div>':'';
 }
 const p=list[0];
 const st=FG.phone.state(p, l);
 const nm=esc(l.name||'lead');
 const btn=function(kind, icon, label){
  return st.blocked
   ? '<button type="button" class="ph-btn" data-dial="'+kind+'" aria-disabled="true" aria-label="'+label+' '+nm+' (blocked)" title="'+esc(st.reason+' Send mail or a door hanger instead.')+'">'+FG.icon(icon)+'</button>'
   : '<button type="button" class="ph-btn" data-dial="'+kind+'" aria-label="'+label+' '+nm+'" title="'+label+' '+esc(p.number)+(st.scrub==='unscrubbed'?' (not scrubbed: you will be asked first)':'')+'">'+FG.icon(icon)+'</button>';
 };
 return '<div class="ph-line">'+FG.phone.chips(p, l)+(list.length>1?'<span class="ph-chip more" title="'+esc(list.slice(1).map(function(x){ return x.number; }).join(', '))+'">+'+(list.length-1)+'</span>':'')+
  '<span class="ph-btns">'+btn('call','phone','Call')+btn('text','message-square','Text')+'</span></div>';
}
const LEADS_PAGE=150;
let _leadsLimit=LEADS_PAGE;
/** Back to the first page when the list itself changes (tab, search, filters, sort). */
function resetLeadsPage(){ _leadsLimit=LEADS_PAGE; }
document.addEventListener('click', function(e){
 const b=e.target.closest&&e.target.closest('#tbody .more-row [data-more]'); if(!b) return;
 _leadsLimit=b.getAttribute('data-more')==='all'?Infinity:_leadsLimit+LEADS_PAGE;
 render();
});
['search','industry','cityFilter','dueThisMonth','sortSelect','chipStage'].forEach(function(id){
 const el=document.getElementById(id); if(el){ el.addEventListener('input', resetLeadsPage, true); el.addEventListener('change', resetLeadsPage, true); }
});
['tabs','filterChips'].forEach(function(id){ const el=document.getElementById(id); if(el) el.addEventListener('click', resetLeadsPage, true); });
function paintCauseTabCounts(){
 const tabs=document.getElementById('tabs'); if(!tabs) return;
 tabs.querySelectorAll('button[data-list]').forEach(function(b){
  const c=b.getAttribute('data-list');
  const n=c==='All'?state.length:state.filter(function(l){ return leadLists(l).includes(c); }).length;
  let sp=b.querySelector('.tab-n'); if(!sp){ sp=document.createElement('span'); sp.className='tab-n num'; b.appendChild(sp); }
  sp.textContent=String(n);
 });
}
function render(){
 syncDueFilterUi();
 const fg=window.FG&&FG.ready;
 const ind=document.getElementById('industry').value;
 const city=(document.getElementById('cityFilter')&&document.getElementById('cityFilter').value)||'';
 const dueOnly=view==='Maintenance' && !!(document.getElementById('dueThisMonth')&&document.getElementById('dueThisMonth').checked);
 const tb=document.getElementById('tbody'); tb.innerHTML='';
 let dueCount=0;
 state.forEach(function(l){ normalizeLead(l); if(leadLists(l).includes('Maintenance') && (isDueThisMonth(l)||isOverdue(l))) dueCount++; });
 const list=visibleLeads();
 const shown=list.length;
 const sel=fg&&FG.views?FG.views.selection:null;
 // R2: draw one page of rows (2,000 leads took ~400 ms and 100k DOM nodes per render); "Show more" adds pages.
 const frag=document.createDocumentFragment();
 const limit=Math.max(LEADS_PAGE, _leadsLimit);
 list.slice(0, limit).forEach(l=>{
 const tr=document.createElement('tr'); tr.dataset.id=l.id;
 const cause=activeCause(l);
 const st=getListStatus(l, cause);
 const stage=fg?FG.stageOf(l):'';
 const mntBadge=(view==='Maintenance'||leadLists(l).includes('Maintenance'))?mntDueBadgeHtml(l):'';
 const mgmtBit=(view==='PropertyMgmt'&&l.mgmt_company_name)?('<div class="lead-sub">'+esc(l.mgmt_company_name)+'</div>'):'';
 const addrBit=(l.address||'').trim()
  ? ('<div class="lead-addr" title="'+esc(l.address)+'">'+esc(l.address)+'</div>')
  : '<div class="lead-addr missing">No site address</div>';
 const contactHint=!(l.phone||'').trim()&&!(l.email||'').trim()&&!(Array.isArray(l.phones)&&l.phones.length)
  ? '<div class="lead-flag" title="County tax roll has no phone/email">Needs phone/email</div>'
  : '';
 const naChip=fg?FG.tasks.chip(l):'';
 const isSel=!!(sel&&sel.has(String(l.id)));
 if(isSel) tr.classList.add('is-sel');
 tr.innerHTML=`
 <td class="cell-sel"><input type="checkbox" class="row-sel" aria-label="Select ${esc(l.name||'lead')}"${isSel?' checked':''}></td>
 <td class="name row-open"><input value="${esc(l.name)}" data-f="name" aria-label="Owner or business name" placeholder="(owner / business)" title="${esc((l.address||'')+(l.city?(' · '+l.city):'')+(l.industry?(' · '+l.industry):''))}">${addrBit}${mgmtBit}${contactHint}${naChip?'<div class="lead-na">'+naChip+'</div>':''}${mntBadge?'<div class="lead-due">'+mntBadge+'</div>':''}</td>
 <td class="cell-causes" title="Causes: ${esc(leadLists(l).join(', '))} — check/uncheck to work each product separately">${renderCauseChecks(l,{full:false})}</td>
 <td class="cell-phone"><input value="${esc(l.phone)}" data-f="phone" aria-label="Phone" placeholder="Add phone">${phoneCellExtras(l)}</td>
 <td class="cell-email"><input value="${esc(l.email||'')}" data-f="email" aria-label="Email" placeholder="Add email" title="${esc(l.email||'')}"></td>
 <td class="row-open cell-score" title="Open prospect for score details">${scoreCellHtml(l)}</td>
 <td class="cell-status" data-st="${esc(statusTone(st))}"><select data-f="status" data-cause-status="1" class="status-sel" aria-label="Status for ${esc(causeLabel(cause))}" title="Status for ${esc(causeLabel(cause))}">${STATUSES.map(s=>`<option ${st===s?'selected':''}>${esc(s)}</option>`).join('')}</select><div class="lead-cause">${fg?FG.stageChip(stage,' title="Pipeline stage"'):''}<span>${esc(causeLabel(cause))}</span></div></td>
 <td class="cell-acts"><button type="button" class="coachbtn openbtn" title="Open profile">Open</button> <button type="button" class="coachbtn" title="Game-plan this call with the AI Coach">Coach</button> <button type="button" class="del" title="Delete lead" aria-label="Delete lead">✕</button></td>`;
 frag.appendChild(tr);
 });
 if(list.length>limit){
  const more=document.createElement('tr'); more.className='more-row';
  const left=list.length-limit;
  more.innerHTML='<td colspan="8"><div class="more-in"><span class="more-n">Showing <b class="num">'+limit+'</b> of <b class="num">'+list.length+'</b></span><button type="button" class="btn btn--sm" data-more="page">Show '+Math.min(LEADS_PAGE,left)+' more</button>'+(left>LEADS_PAGE?'<button type="button" class="btn btn--sm ghost" data-more="all">Show all '+list.length+'</button>':'')+'</div></td>';
  frag.appendChild(more);
 }
 tb.appendChild(frag);
 if(!shown){
  const tr=document.createElement('tr'); tr.className='empty-row';
  tr.innerHTML='<td colspan="8"><div class="empty-state"><b>'+(state.length?'No leads match these filters':'No leads yet')+'</b><span>'+(state.length?'Clear the search or filter chips, pick another cause tab, or reset the industry and city filters.':'Add a lead, paste one from Google Maps, or send parcels over from the flood map.')+'</span></div></td>';
  tb.appendChild(tr);
 }
 let dl=document.getElementById('indList');
 if(!dl){ dl=document.createElement('datalist'); dl.id='indList'; document.body.appendChild(dl); }
 dl.innerHTML=industries().map(i=>`<option value="${esc(i)}">`).join('');
 let cdl=document.getElementById('cityList');
 if(!cdl){ cdl=document.createElement('datalist'); cdl.id='cityList'; document.body.appendChild(cdl); }
 cdl.innerHTML=cities().map(c=>`<option value="${esc(c)}">`).join('');
 paintCauseTabCounts();
 document.getElementById('stats').innerHTML=
 `Showing <b class="num">${shown}</b> of <span class="num">${state.length}</span> leads`+
 (view!=='All'?' · status shown for <b>'+esc(causeLabel(view))+'</b>':' · status shown for each lead\'s primary cause')+
 (view==='Maintenance'?(' · due this month: <b>'+dueCount+'</b>'):'')+
 (dueOnly?' · <b>Due filter on</b>':'')+
 (ind?(' · industry: <b>'+esc(ind)+'</b>'):'')+
 (city?(' · city: <b>'+esc(city)+'</b>'):'');
 if(fg && FG.views) FG.views.afterRender(list);
}
document.getElementById('tbody').addEventListener('input',e=>{
 const f=e.target.dataset.f; if(!f) return;
 // Status is cause-scoped — handled on change via setListStatus
 if(f==='status' || e.target.getAttribute('data-cause-status')) return;
 if(f==='sel') return;
 const tr0=e.target.closest('tr'); if(!tr0) return;
 const l=state.find(x=>String(x.id)===tr0.dataset.id); if(!l) return;
 l[f]=e.target.value; saveLeads();
 if(f==='industry') refreshIndustryFilter();
 if(f==='city') refreshCityFilter();
});
document.getElementById('tbody').addEventListener('change',e=>{
 const tr=e.target.closest('tr'); if(!tr) return;
 const l=state.find(x=>String(x.id)===tr.dataset.id); if(!l) return;
 if(e.target.matches('input.row-sel')){ if(window.FG&&FG.views) FG.views.toggleSelect(l.id, e.target.checked, e); return; }
 // Cause checkbox toggle
 if(e.target.matches('input[data-cause]')){
 const cause=e.target.getAttribute('data-cause');
 const want=e.target.checked;
 const finish=function(){
  appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:'list_change',detail:{text:(want?'Checked':'Unchecked')+' '+cause,lists:leadLists(l)}});
  saveLeads(); render(); refreshIndustryFilter(); refreshCityFilter();
 };
 const ok=toggleLeadCause(l, cause, want);
 if(ok&&typeof ok.then==='function'){ e.target.checked=!want; ok.then(function(y){ if(y) finish(); }); return; }
 if(!ok){ e.target.checked=!e.target.checked; return; }
 finish();
 return;
 }
 // Per-cause status
 if(e.target.dataset.f==='status' || e.target.getAttribute('data-cause-status')){
 const cause=activeCause(l);
 setListStatus(l, cause, e.target.value);
 saveLeads();
 // Update tiny cause label without full re-render if still visible
 render();
 }
});
document.getElementById('tbody').addEventListener('click',e=>{
 const tr=e.target.closest('tr'); if(!tr||!tr.dataset.id) return;
 const L=state.find(x=>String(x.id)===tr.dataset.id); if(!L) return;
 const id=L.id;
 if(window.FG&&FG.views) FG.views.setActiveRow(id, {noScroll:true});
 const dialBtn=e.target.closest('[data-dial]');
 if(dialBtn){
  e.preventDefault();
  const p=FG.phone.primary(L);
  if(!p) return;
  if(dialBtn.getAttribute('aria-disabled')==='true'){ FG.dial.explainBlocked(L, p, dialBtn.dataset.dial); return; }
  FG.dial.start(L, p.number, dialBtn.dataset.dial);
  return;
 }
 if(e.target.classList.contains('del')){ deleteLeadWithConfirm(L); return; }
 if(e.target.classList.contains('openbtn')){ openProfile(id); return; }
 if(e.target.closest('td.cell-sel')) return;
 if(e.target.closest && e.target.closest('td.row-open') && !e.target.closest('input,select,button,a,label')){ openProfile(id); return; }
 if(e.target.closest && e.target.closest('td.name') && !e.target.closest('input,select,button,a,label')){ openProfile(id); return; }
 if(e.target.classList.contains('coachbtn') && !e.target.classList.contains('openbtn')){
 const l=L;
 goTab('coach');
 const lists = leadLists(l);
 let active = categoryKey(activeCause(l));
 lastCoachCategory = active;
 lastCoachLeadId = l.id;
 const pb = CATEGORY_PLAYBOOKS[active] || CATEGORY_PLAYBOOKS.FrenchDrain;
 const box=document.getElementById('in-coach');
 box.value=`CATEGORY: ${active}. Game-plan this cold call for ${l.name||'an unnamed business'} — ${l.industry||'unknown industry'} in ${l.city||'the Daytona area'}. Multi-lists: ${lists.join(', ')}. Active category only: ${active}. Status for ${active}: ${getListStatus(l, active)}. Website on file: ${l.website||'NONE'}. Phone: ${l.phone||'unknown'}. Notes: ${l.notes||'none'}. Use the ${active} playbook (${pb.product}). Give me: category-correct opener, two discovery questions, expected objection + counter, exact close for ${active}, and what I should NOT pitch from other categories.`;
 box.focus();
 }
});
/** Delete one lead after a confirm. Soft delete on the server (history kept); local copy removed. */
async function deleteLeadWithConfirm(L){
 const ok=(window.FG&&FG.ready)
  ? await FG.confirm({title:'Delete this lead?', message:'"'+(L.name||'This lead')+'" will be removed from the list'+((window.FG&&FG.isServer())?' (the server keeps its history).':'.'), confirmLabel:'Delete lead', danger:true})
  : confirm('Permanently delete this lead?');
 if(!ok) return false;
 appendActivity({lead_id:L.id,lead_key:leadKeyOf(L),type:'note',detail:{text:'Lead deleted'}});
 state=state.filter(x=>x!==L);
 if(window.FG&&FG.views) FG.views.selection.delete(String(L.id));
 saveLeads(); render(); refreshIndustryFilter(); refreshCityFilter();
 if(window.FG&&FG.sync) FG.sync.remove(L);
 if(window.FG&&FG.ready) FG.toast('Deleted '+(L.name||'lead')+'.', {kind:'ok'});
 return true;
}
document.getElementById('tabs').addEventListener('click',e=>{
 const b=e.target.closest('button'); if(!b) return;
 view=b.dataset.list;
 [...document.querySelectorAll('#tabs button')].forEach(x=>x.classList.toggle('on',x===b));
 render();
});
document.getElementById('industry').addEventListener('change',render);
document.getElementById('cityFilter')?.addEventListener('change',render);
document.getElementById('search').addEventListener('input',render);
document.getElementById('dueThisMonth')?.addEventListener('change',render);
document.getElementById('addBtn').addEventListener('click',()=>{
 const primary=LISTS.includes(view)?view:'Website';
 const lead={id:nextId(),name:'',city:'',industry:document.getElementById('industry').value||'',list:primary,lists:[primary],list_status:{},phone:'',website:'',contact:'',status:'New',notes:'',lists_touched:true,stage:'new',created_at:new Date().toISOString()};
 setListStatus(lead, primary, 'New');
 state.unshift(lead);
 saveLeads(); render();
 if(window.FG&&FG.views) FG.views.focusNewLead(lead);
});
function parseBlock(text){
 const lines=text.split(/\n|\t/).map(s=>s.trim()).filter(Boolean);
 const phoneRe=/(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/;
 const urlRe=/\b((https?:\/\/)?(www\.)?[a-z0-9][a-z0-9\-]*\.(com|net|org|co|us|biz|menu|shop|io|info)(\/[^\s]*)?)\b/i;
 let name='',phone='',website='',addr='';
 for(const l of lines){
 if(!phone){const m=l.match(phoneRe); if(m){phone=m[1]; continue;}}
 if(!website){const m=l.match(urlRe); if(m&&!/google\.|maps\.|goo\.gl/.test(l)){website=m[1]; continue;}}
 if(!name){name=l; continue;}
 if(!addr&&/\d/.test(l)) addr=l;
 }
 let city=''; if(addr){ const p=addr.split(','); if(p.length>=2) city=p[p.length-2].trim(); }
 return {name,phone,website,city,addr};
}
document.getElementById('parseBtn').addEventListener('click',()=>{
 const txt=document.getElementById('pasteBox').value;
 if(!txt.trim()){ pmsg('Paste a business first.'); return; }
 const p=parseBlock(txt);
 if(!p.name){ pmsg('Could not find a business name.'); return; }
 const list=document.getElementById('pList').value;
 const industry=document.getElementById('pIndustry').value||document.getElementById('industry').value||'';
 const primary=LISTS.includes(list)?list:'Website';
 const lists=[primary];
 suggestListsForIndustry(industry, p.website).forEach(function(x){ if(!lists.includes(x)) lists.push(x); });
 const lead={id:nextId(),name:p.name,city:p.city,industry,list:primary,lists:lists,list_status:{},phone:p.phone,website:p.website,contact:'',status:'New',notes:p.addr?('Addr: '+p.addr):''};
 lists.forEach(function(c){ setListStatus(lead, c, 'New'); });
 state.unshift(lead);
 saveLeads(); refreshIndustryFilter(); refreshCityFilter();
 if(LISTS.includes(list)){ view=list; [...document.querySelectorAll('#tabs button')].forEach(x=>x.classList.toggle('on',x.dataset.list===list)); }
 render(); document.getElementById('pasteBox').value='';
 pmsg(`Added "${p.name}" · causes: ${lists.join(', ')}${p.website?' · website found':' · no website (hot site lead?)'}${p.phone?' · phone '+p.phone:''}. Uncheck any cause you are not working.`);
});
function pmsg(t){ document.getElementById('parseMsg').textContent=t; }
function mapsUrl(cat,city){ return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent((cat||'')+' in '+(city||'')+' FL'); }
document.getElementById('mGo').addEventListener('click',()=>{
 const c=document.getElementById('mCat').value, city=document.getElementById('mCity').value;
 if(!c){ if(window.FG&&FG.ready) FG.toast('Type a category or keyword first.', {kind:'err'}); else fgNotify('Type a category or keyword first.'); document.getElementById('mCat').focus(); return; }
 window.open(mapsUrl(c,city),'_blank');
});
(function initMaps(){
 document.getElementById('mCity').innerHTML=CITIES.map(c=>`<option>${esc(c)}</option>`).join('');
 const chips=document.getElementById('quickChips');
 SERVICE.forEach(([cat])=>{ const a=document.createElement('a'); a.href=mapsUrl(cat,'Volusia County'); a.target='_blank'; a.rel='noopener'; a.textContent=cat; chips.appendChild(a); });
})();

/* ---- Bulk contact enrich (phone/email) ---- */
const ENRICH_BATCH=8;
const ENRICH_MAX=40;
function enrichStatus(msg, isHtml){
 const el=document.getElementById('enrichStatus'); if(!el) return;
 if(isHtml) el.innerHTML=msg; else el.textContent=msg||'';
}
function leadsNeedingEnrich(list){
 return (list||[]).filter(function(l){
  normalizeLead(l);
  const noPhone=!String(l.phone||'').trim();
  const noEmail=!String(l.email||'').trim();
  const hasAddr=!!String(l.address||'').trim() || !!String(l.city||'').trim();
  return (noPhone||noEmail) && hasAddr && String(l.name||'').trim();
 });
}
function slimForEnrich(l){
 return {
  id:l.id, name:l.name||'', address:l.address||'', city:l.city||'', zip:l.zip||'',
  phone:l.phone||'', email:l.email||'', website:l.website||'', industry:l.industry||'',
  lists:leadLists(l), source:l.source||'', parcel_id:l.parcel_id||'',
  // Numbers already verified are not paid for again (A.md)
  phones:Array.isArray(l.phones)?l.phones:[], phone_source:l.phone_source||'', phone_line_type:l.phone_line_type||'',
  phone_confidence:l.phone_confidence==null?null:l.phone_confidence, phone_dnc:l.phone_dnc==null?null:l.phone_dnc
 };
}
/** Fold one enrich result into the lead. Never overwrites a phone/email the lead already has;
 *  suggested_phone is stored as an offer only. Returns true when anything changed. */
function applyEnrichResult(l, r){
 if(!l||!r) return false;
 let changed=false;
 if(r.phone && !String(l.phone||'').trim()){ l.phone=r.phone; changed=true; }
 if(r.email && !String(l.email||'').trim()){ l.email=r.email; if(r.email_source) l.email_source=r.email_source; changed=true; }
 if(r.website && !String(l.website||'').trim()){ l.website=r.website; changed=true; }
 if(Array.isArray(r.phones) && r.phones.length){
  const merged=mergePhoneLists(l.phones, r.phones);
  if(!sameJson(merged, l.phones)){ l.phones=merged; changed=true; }
 }
 // Scalar phone_* describe the lead's effective primary (A.md); DNC true is sticky.
 ['phone_line_type','phone_source','phone_confidence'].forEach(function(f){
  if(r[f]!=null && r[f]!=='' && l[f]!==r[f]){ l[f]=r[f]; changed=true; }
 });
 if(r.phone_dnc===true && l.phone_dnc!==true){ l.phone_dnc=true; changed=true; }
 else if(r.phone_dnc===false && l.phone_dnc==null){ l.phone_dnc=false; changed=true; }
 if(r.suggested_phone && FGdigits(r.suggested_phone)!==FGdigits(l.phone)){ l.suggested_phone=r.suggested_phone; changed=true; }
 if(Array.isArray(r.warnings) && r.warnings.length){ l.enrich_warnings=r.warnings.slice(0,6); }
 if(r.status){ l.enrich_status=r.status; }
 if(changed){
  const tag='Enriched '+(r.sources&&r.sources.length?r.sources.join(','):r.status)+' @ '+new Date().toISOString().slice(0,16);
  if(!(l.notes||'').includes('Enriched ')) l.notes=(l.notes?l.notes+'\n':'')+tag;
  else l.notes=String(l.notes||'')+'\n'+tag;
  l.enrich_sources=Array.isArray(r.sources)?r.sources:[];
 }
 if(r.status && r.status!=='error' && r.status!=='timeout_budget') l.enriched_at=r.enriched_at||new Date().toISOString();
 return changed;
}
function FGdigits(n){ return phoneDigitsKey(n); }
async function enrichApi(leads, opts){
 opts=opts||{};
 const tok=getToken();
 if(!tok) throw new Error('Sign in required');
 const r=await fetch('/crm/api/enrich-contacts',{
  method:'POST',
  headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
  body:JSON.stringify(Object.assign({action:opts.action||'enrich', leads:leads, force:!!opts.force, allowPaid:opts.allowPaid!==false}, opts.maxPaidLookups!=null?{maxPaidLookups:opts.maxPaidLookups}:{}))
 });
 const raw=await r.text(); let data=null; try{data=JSON.parse(raw);}catch(e){}
 if(!r.ok) throw new Error((data&&data.error)||('Enrich failed '+r.status));
 return data;
}
async function bulkEnrichLeads(candidates, opts){
 opts=opts||{};
 const list=(candidates||[]).slice(0, ENRICH_MAX);
 if(!list.length){
  enrichStatus('Nothing to enrich — every visible lead already has phone+email, or is missing name/address.');
  return {found:0, partial:0, not_found:0, changed:0};
 }
 const btn=document.getElementById('enrichBtn');
 if(btn) btn.disabled=true;
 let found=0, partial=0, notFound=0, changed=0, errors=0;
 const capsNote={v:''};
 try{
  for(let i=0;i<list.length;i+=ENRICH_BATCH){
   const chunk=list.slice(i, i+ENRICH_BATCH);
   enrichStatus('Enriching '+(i+1)+'–'+Math.min(i+chunk.length,list.length)+' of '+list.length+'… (free search'+(capsNote.v?' · '+capsNote.v:'')+')');
   const payload=chunk.map(slimForEnrich);
   let data;
   try{ data=await enrichApi(payload, opts); }
   catch(e){
    errors+=chunk.length;
    enrichStatus('Batch error: '+(e.message||e)+' — continuing…');
    continue;
   }
   if(data.capabilities){
    capsNote.v=data.capabilities.batchdata?'BatchData on':'free only';
   }
   const byId={};
   (data.results||[]).forEach(function(r){ if(r && r.id!=null) byId[String(r.id)]=r; });
   chunk.forEach(function(l){
    const r=byId[String(l.id)];
    if(!r){ notFound++; return; }
    if(r.status==='found') found++;
    else if(r.status==='partial') partial++;
    else if(r.status==='complete'){ /* already had */ }
    else if(r.status==='error'||r.status==='timeout_budget') errors++;
    else notFound++;
    if(applyEnrichResult(l, r)) changed++;
   });
  }
  if(changed) saveLeads();
  render();
  const dnc=' Scrub DNC before dialing.';
  enrichStatus('<b>'+changed+'</b> updated · found <b>'+found+'</b> · partial <b>'+partial+'</b> · no hit <b>'+notFound+'</b>'+(errors?(' · errors '+errors):'')+' · '+(capsNote.v||'free')+'.'+dnc, true);
  return {found:found, partial:partial, not_found:notFound, changed:changed, errors:errors};
 } finally {
  if(btn) btn.disabled=false;
 }
}
async function enrichVisibleLeads(){
 if(window.FG&&FG.enrich){ FG.enrich.open(); return; }
 enrichStatus('Preparing enrich…');
 if(!getToken()){
  enrichStatus('Sign in required to enrich contacts.');
  return;
 }
 const ind=document.getElementById('industry')?.value||'';
 const city=(document.getElementById('cityFilter')&&document.getElementById('cityFilter').value)||'';
 const q=(document.getElementById('search')?.value||'').trim().toLowerCase();
 const dueOnly=view==='Maintenance' && !!(document.getElementById('dueThisMonth')&&document.getElementById('dueThisMonth').checked);
 const visible=[];
 state.forEach(function(l){
  normalizeLead(l);
  if(!inView(l)) return;
  if(ind&&l.industry!==ind) return;
  if(city&&l.city!==city) return;
  if(dueOnly && !(isDueThisMonth(l)||isOverdue(l))) return;
  if(q){
   const hay=(l.name+' '+(l.address||'')+' '+l.city+' '+(l.phone||'')+' '+(l.email||'')+' '+(l.notes||'')).toLowerCase();
   if(!hay.includes(q)) return;
  }
  visible.push(l);
 });
 const need=leadsNeedingEnrich(visible);
 if(!need.length){
  const noAddr=visible.filter(function(l){ return !String(l.address||'').trim() && !String(l.city||'').trim(); }).length;
  enrichStatus(
   visible.length
    ? ('Nothing to enrich in this view ('+visible.length+' shown).'+(noAddr?(' '+noAddr+' lack address/city.'):' All already have phone+email, or missing name.'))
    : 'No leads in the current list/filter. Switch tab or clear filters, then try again.'
  );
  return;
 }
 const n=Math.min(need.length, ENRICH_MAX);
 const msg=need.length>ENRICH_MAX
  ? ('Enrich first '+n+' of '+need.length+' leads missing phone/email?\n\nUses free web search (+ BatchData if configured).\nScrub DNC before dialing.')
  : ('Enrich '+n+' lead(s) missing phone and/or email?\n\nUses free web search (+ BatchData if configured).\nScrub DNC before dialing.');
 if(!window.confirm(msg)){ enrichStatus('Enrich cancelled.'); return; }
 enrichStatus('Starting enrich for '+n+' lead(s)…');
 try{
  await bulkEnrichLeads(need.slice(0, ENRICH_MAX));
 }catch(err){
  enrichStatus('Enrich failed: '+(err&&err.message?err.message:err));
  console.error(err);
 }
}
async function fsiBulkAddAndEnrich(){
 const ids=Object.keys(_fsiState.selected).filter(function(id){ return _fsiState.selected[id]; });
 if(!ids.length){ fsiSay('Select one or more parcels first.'); return; }
 const added=[];
 ids.forEach(function(id){
  const p=_fsiState.filtered.find(function(x){ return String(x.parcel_id)===String(id); })
   || _fsiState.raw.find(function(x){ return String(x.parcel_id)===String(id); });
  if(!p) return;
  const had=(typeof fsiLeadForParcel==='function')?fsiLeadForParcel(p.parcel_id):null;
  if(had){ added.push(had); return; } // already a lead: enrich it rather than duplicate it (R2)
  const lead=fsiLeadFromParcel(p);
  state.unshift(lead);
  added.push(lead);
 });
 saveLeads();
 _fsiState.selected=Object.create(null);
 fsiRenderList();
 if(typeof render==='function') render();
 goTab('leads');
 if(window.FG&&FG.enrich){
  fsiSay('Added <b>'+added.length+'</b> leads. Review the enrich estimate on the Leads tab.', true);
  FG.enrich.open({leads:added, scope:'given'});
  return;
 }
 fsiSay('Added <b>'+added.length+'</b> leads — enriching phone/email…', true);
 await bulkEnrichLeads(added.slice(0, ENRICH_MAX));
}

// Wire Enrich contacts (must stay after enrichVisibleLeads is defined)
document.getElementById('enrichBtn')?.addEventListener('click', function(e){
 e.preventDefault();
 e.stopPropagation();
 try{
  enrichVisibleLeads();
 }catch(err){
  enrichStatus('Enrich failed: '+(err&&err.message?err.message:err));
  console.error('enrichVisibleLeads', err);
 }
});

document.getElementById('csvBtn').addEventListener('click',()=>{
 const dueOnly=view==='Maintenance' && !!(document.getElementById('dueThisMonth')&&document.getElementById('dueThisMonth').checked);
 const cols=['name','address','city','zip','parcel_id','industry','list','phone','email','website','contact','status','mgmt_company_name','maintenance_next_due','maintenance_frequency','maintenance_plan','next_follow_up_at','notes'];
 const head=['Name','Address','City','ZIP','Parcel','Industry','List','Phone','Email','Website','Contact','Status','Mgmt co','Next due','Frequency','Plan','Follow-up','Notes','DNS'];
 let list=state.filter(inView);
 if(dueOnly){
  list=list.filter(function(l){ return isDueThisMonth(l)||isOverdue(l); });
 }
 // Sort dial list: overdue first, then due this month by date, then name
 if(view==='Maintenance'){
  list=list.slice().sort(function(a,b){
   const ao=isOverdue(a)?0:1, bo=isOverdue(b)?0:1;
   if(ao!==bo) return ao-bo;
   const ad=String(a.maintenance_next_due||''), bd=String(b.maintenance_next_due||'');
   if(ad!==bd) return ad.localeCompare(bd);
   return String(a.name||'').localeCompare(String(b.name||''));
  });
 }
 const rows=list.map(function(l){
  normalizeLead(l);
  const base=cols.map(function(c){
   let v=l[c];
   if(c==='list') v=leadLists(l).join('|');
   return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  });
  const ws=resolveWebsiteScore(l);
  base.push('"'+String(ws? (ws.total+'/'+ws.grade) : '')+'"');
  return base.join(',');
 });
 const blob=new Blob([[head.join(',')].concat(rows).join('\n')],{type:'text/csv'});
 const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
 const suffix=dueOnly?'_due_dials':('_'+view.toLowerCase());
 a.download='floguard_leads'+suffix+'.csv'; a.click();
});
document.getElementById('jsonBtn').addEventListener('click',()=>{
 const doc={version:1,exported_at:new Date().toISOString(),leads:state};
 const blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'});
 const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='floguard_leads_backup.json'; a.click();
});
/* Merge imported leads (LeadAgent export or JSON backup) into state.
 Match by uuid, parcel_id, then name+city+address; union lists; fill blank fields only. */
function mergeImportedLeads(incoming){
 let added=0, merged=0;
 const claimed=new Set();
 incoming.forEach(raw=>{
 if(!raw || !raw.name) return;
 const inc=normalizeLead({...raw});
 // First-time import without lists: seed suggestions from industry once
 if(!Array.isArray(raw.lists) || !raw.lists.length){
 const suggested=suggestListsForIndustry(inc.industry, inc.website);
 const lists=leadLists(inc).slice();
 suggested.forEach(function(x){ if(!lists.includes(x)) lists.push(x); });
 setLeadLists(inc, lists);
 }
 const existing=findLocalLeadFor(inc, state, claimed);
 if(existing){
 claimed.add(existing);
 const lists=leadLists(existing).slice();
 leadLists(inc).forEach(x=>{ if(!lists.includes(x)) lists.push(x); });
 setLeadLists(existing, lists);
 ['phone','website','contact','email','industry','notes','status','source','lead_type','categories','address','zip','parcel_id','uuid'].forEach(f=>{
 if((existing[f]==null||existing[f]==='')&&inc[f]!=null&&inc[f]!=='') existing[f]=inc[f];
 });
 if(inc.list_status && typeof inc.list_status==='object'){
 existing.list_status=Object.assign({}, existing.list_status||{}, inc.list_status);
 ensureListStatus(existing);
 }
 merged++;
 } else {
 inc.id=nextId();
 state.unshift(inc);
 claimed.add(inc);
 added++;
 }
 });
 return {added,merged};
}
document.getElementById('jsonImportBtn').addEventListener('click',()=>document.getElementById('jsonFile').click());
document.getElementById('jsonFile').addEventListener('change',async e=>{
 const f=e.target.files&&e.target.files[0]; if(!f) return;
 try{
 const data=JSON.parse(await f.text());
 const leads=Array.isArray(data)?data:(Array.isArray(data?.leads)?data.leads:null);
 if(!leads){ pmsg('Import failed: file has no leads array.'); return; }
 const {added,merged}=mergeImportedLeads(leads);
 saveLeads(); refreshIndustryFilter(); refreshCityFilter(); render();
 pmsg(`Imported ${added} new lead${added===1?'':'s'}, merged ${merged} existing.`);
 }catch(err){ pmsg('Import failed: '+(err.message||err)); }
 finally{ e.target.value=''; }
});
document.getElementById('printBtn').addEventListener('click',()=>window.print());
document.getElementById('resetBtn').addEventListener('click',async()=>{
 const msg='Reset the local list to the named demo leads? This erases your local edits on this device. The shared store is not wiped; empty seeds are pruned on the next sync.';
 const ok=(window.FG&&FG.ready)?await FG.confirm({title:'Reset local leads?', message:msg, confirmLabel:'Reset local leads', danger:true}):confirm(msg);
 if(ok){
 localStorage.removeItem(KEY); state=loadLeads(); render(); refreshIndustryFilter(); refreshCityFilter();
 prunePlaceholderLeadsOnServer().then(function(){ return hydrateLeadsFromServer(); });
 }
});

