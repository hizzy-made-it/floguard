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
 l.list_status[c]=status;
 // Rollup primary status for CSV/sync/LeadAgent compat
 if(!l.list || l.list===c || !leadLists(l).includes(l.list)) l.list=c;
 if(l.list===c) l.status=status;
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
 if(!confirm('"'+ (l.name||'This business') +'" is only on '+cause+'. Uncheck last cause and archive?')) return false;
 l.status='Archived';
 setListStatus(l, cause, 'Archived');
 setLeadLists(l, [], {allowEmpty:true, touched:true});
 l.list='Website';
 return true;
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
 el.innerHTML='<div class="wfs-empty">No Drainage Need Score yet. Run <code>leadagent score</code>, then sync/import — or log <code>DNS 72/B (urgent) | standing water 2+ days; crawlspace damp</code> in notes.</div>';
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
function scoreCellHtml(l){
 const ws=resolveWebsiteScore(l);
 const hasWeb=!!websiteHref(l.website||'');
 if(!hasWeb && !ws){
 return '<span class="wfs-pill hot" title="Urgent drainage need — active flooding signals in notes/score">HOT</span>';
 }
 if(!ws){
 return '<span class="wfs-pill none" title="No drainage score yet — run leadagent score or log DNS in notes">—</span>';
 }
 const gaps=(ws.gaps||[]).slice(0,3).join('; ');
 const title=esc('DNS '+ws.total+'/'+ws.grade+(ws.band?(' · '+ws.band):'')+(gaps?(' · '+gaps):''));
 return '<span class="wfs-pill g-'+esc(ws.grade)+'" title="'+title+'">'+esc(String(ws.total))+'/'+esc(ws.grade)+'</span>';
}
function render(){
 syncDueFilterUi();
 const ind=document.getElementById('industry').value;
 const city=(document.getElementById('cityFilter')&&document.getElementById('cityFilter').value)||'';
 const q=document.getElementById('search').value.trim().toLowerCase();
 const dueOnly=view==='Maintenance' && !!(document.getElementById('dueThisMonth')&&document.getElementById('dueThisMonth').checked);
 const tb=document.getElementById('tbody'); tb.innerHTML=''; let shown=0;
 let dueCount=0;
 state.forEach(l=>{
 normalizeLead(l);
 if(leadLists(l).includes('Maintenance') && (isDueThisMonth(l)||isOverdue(l))) dueCount++;
 if(!inView(l)) return;
 if(ind&&l.industry!==ind) return;
 if(city&&l.city!==city) return;
 if(dueOnly && !(isDueThisMonth(l)||isOverdue(l))) return;
 if(q){
 const hay=(l.name+' '+(l.address||'')+' '+l.city+' '+(l.zip||'')+' '+(l.parcel_id||'')+' '+l.industry+' '+l.phone+' '+(l.email||'')+' '+l.notes+' '+l.website+' '+(l.mgmt_company_name||'')).toLowerCase();
 if(!hay.includes(q)) return;
 }
 shown++;
 const tr=document.createElement('tr'); tr.dataset.id=l.id;
 const cause=activeCause(l);
 const st=getListStatus(l, cause);
 const mntBadge=(view==='Maintenance'||leadLists(l).includes('Maintenance'))?mntDueBadgeHtml(l):'';
 const mgmtBit=(view==='PropertyMgmt'&&l.mgmt_company_name)?('<div style="font-size:10px;color:var(--muted);margin-top:2px">'+esc(l.mgmt_company_name)+'</div>'):'';
 const addrBit=(l.address||'').trim()
  ? ('<div class="lead-addr" style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.3" title="'+esc(l.address)+'">'+esc(l.address)+'</div>')
  : '<div class="lead-addr" style="font-size:10.5px;color:#b42318;margin-top:2px">No site address</div>';
 const contactHint=!(l.phone||'').trim()&&!(l.email||'').trim()
  ? '<div style="font-size:10px;color:#a2540f;margin-top:2px" title="County tax roll has no phone/email">Needs phone/email enrich</div>'
  : '';
 tr.innerHTML=`
 <td class="name row-open"><input value="${esc(l.name)}" data-f="name" placeholder="(owner / business)" title="${esc((l.address||'')+(l.city?(' · '+l.city):'')+(l.industry?(' · '+l.industry):''))}">${addrBit}${mgmtBit}${contactHint}${mntBadge?'<div style="margin-top:3px">'+mntBadge+'</div>':''}</td>
 <td title="Causes: ${esc(leadLists(l).join(', '))} — check/uncheck to work each product separately">${renderCauseChecks(l,{full:false})}</td>
 <td><input value="${esc(l.phone)}" data-f="phone" placeholder="(___)___-____"></td>
 <td><input value="${esc(l.email||'')}" data-f="email" placeholder="email@" title="${esc(l.email||'')}"></td>
 <td class="row-open" style="cursor:pointer" title="Open prospect for score details">${scoreCellHtml(l)}</td>
 <td><select data-f="status" data-cause-status="1" class="status-sel" title="Status for ${esc(cause)}">${STATUSES.map(s=>`<option ${st===s?'selected':''}>${esc(s)}</option>`).join('')}</select><div style="font-size:10px;color:var(--muted);font-weight:600;margin-top:2px">${esc(cause)}</div></td>
 <td style="white-space:nowrap"><button type="button" class="coachbtn openbtn" title="Open profile">Open</button> <button type="button" class="coachbtn" title="Game-plan this call with the AI Coach">Coach</button> <button type="button" class="del" title="Delete forever">✕</button></td>`;
 tb.appendChild(tr);
 });
 let dl=document.getElementById('indList');
 if(!dl){ dl=document.createElement('datalist'); dl.id='indList'; document.body.appendChild(dl); }
 dl.innerHTML=industries().map(i=>`<option value="${esc(i)}">`).join('');
 let cdl=document.getElementById('cityList');
 if(!cdl){ cdl=document.createElement('datalist'); cdl.id='cityList'; document.body.appendChild(cdl); }
 cdl.innerHTML=cities().map(c=>`<option value="${esc(c)}">`).join('');
 document.getElementById('stats').innerHTML=
 `Showing <b>${shown}</b> of ${state.length} · `+LISTS.map(x=>`${x}: <b>${state.filter(l=>leadLists(l).includes(x)).length}</b>`).join(' · ')+
 ` · multi: <b>${state.filter(l=>leadLists(l).length>1).length}</b>`+
 (view!=='All'?' · status shown for <b>'+esc(view)+'</b>':' · status = primary cause')+
 (view==='Maintenance'?(' · due this month: <b>'+dueCount+'</b>'):'')+
 (dueOnly?' · <b>Due filter on</b>':'')+
 (ind?(' · industry: <b>'+esc(ind)+'</b>'):'')+
 (city?(' · city: <b>'+esc(city)+'</b>'):'');
}
document.getElementById('tbody').addEventListener('input',e=>{
 const f=e.target.dataset.f; if(!f) return;
 // Status is cause-scoped — handled on change via setListStatus
 if(f==='status' || e.target.getAttribute('data-cause-status')) return;
 const id=+e.target.closest('tr').dataset.id; const l=state.find(x=>x.id===id); if(!l) return;
 l[f]=e.target.value; saveLeads();
 if(f==='industry') refreshIndustryFilter();
 if(f==='city') refreshCityFilter();
});
document.getElementById('tbody').addEventListener('change',e=>{
 const tr=e.target.closest('tr'); if(!tr) return;
 const id=+tr.dataset.id; const l=state.find(x=>x.id===id); if(!l) return;
 // Cause checkbox toggle
 if(e.target.matches('input[data-cause]')){
 const cause=e.target.getAttribute('data-cause');
 const ok=toggleLeadCause(l, cause, e.target.checked);
 if(!ok){ e.target.checked=!e.target.checked; return; }
 appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:'list_change',detail:{text:(e.target.checked?'Checked':'Unchecked')+' '+cause,lists:leadLists(l)}});
 saveLeads(); render(); refreshIndustryFilter(); refreshCityFilter();
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
 const tr=e.target.closest('tr'); if(!tr) return; const id=+tr.dataset.id;
 if(e.target.classList.contains('del')){ if(confirm('Permanently delete this lead?')){ const L=state.find(x=>x.id===id); if(L) appendActivity({lead_id:id,lead_key:leadKeyOf(L),type:'note',detail:{text:'Lead deleted'}}); state=state.filter(x=>x.id!==id); saveLeads(); render(); refreshIndustryFilter(); refreshCityFilter(); } return; }
 if(e.target.classList.contains('openbtn')){ openProfile(id); return; }
 if(e.target.closest && e.target.closest('td.row-open') && !e.target.closest('input,select,button,a,label')){ openProfile(id); return; }
 if(e.target.closest && e.target.closest('td.name') && !e.target.closest('input,select,button,a,label')){ openProfile(id); return; }
 if(e.target.classList.contains('coachbtn') && !e.target.classList.contains('openbtn')){
 const l=state.find(x=>x.id===id); if(!l) return;
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
 const lead={id:nextId(),name:'',city:'',industry:document.getElementById('industry').value||'',list:primary,lists:[primary],list_status:{},phone:'',website:'',contact:'',status:'New',notes:'',lists_touched:true};
 setListStatus(lead, primary, 'New');
 state.unshift(lead);
 saveLeads(); render();
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
 if(!c){ alert('Type a category or keyword first.'); return; }
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
  lists:leadLists(l), source:l.source||'', parcel_id:l.parcel_id||''
 };
}
function applyEnrichResult(l, r){
 if(!l||!r) return false;
 let changed=false;
 if(r.phone && !String(l.phone||'').trim()){ l.phone=r.phone; changed=true; }
 if(r.email && !String(l.email||'').trim()){ l.email=r.email; changed=true; }
 if(r.website && !String(l.website||'').trim()){ l.website=r.website; changed=true; }
 if(changed){
  const tag='Enriched '+(r.sources&&r.sources.length?r.sources.join(','):r.status)+' @ '+new Date().toISOString().slice(0,16);
  if(!(l.notes||'').includes('Enriched ')) l.notes=(l.notes?l.notes+'\n':'')+tag;
  else l.notes=String(l.notes||'')+'\n'+tag;
  l.enriched_at=new Date().toISOString();
  l.enrich_sources=Array.isArray(r.sources)?r.sources:[];
 }
 return changed;
}
async function enrichApi(leads, opts){
 opts=opts||{};
 const tok=getToken();
 if(!tok) throw new Error('Sign in required');
 const r=await fetch('/crm/api/enrich-contacts',{
  method:'POST',
  headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
  body:JSON.stringify({action:'enrich', leads:leads, force:!!opts.force, allowPaid:opts.allowPaid!==false})
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
  const lead=fsiLeadFromParcel(p);
  state.unshift(lead);
  added.push(lead);
 });
 saveLeads();
 _fsiState.selected=Object.create(null);
 fsiRenderList();
 if(typeof render==='function') render();
 fsiSay('Added <b>'+added.length+'</b> leads — enriching phone/email…', true);
 goTab('leads');
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
 Match by name+city (case-insensitive); union lists; fill blank fields only. */
function mergeImportedLeads(incoming){
 let added=0, merged=0;
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
 const k=(inc.name||'').trim().toLowerCase()+'|'+(inc.city||'').trim().toLowerCase();
 const existing=state.find(l=>((l.name||'').trim().toLowerCase()+'|'+((l.city||'').trim().toLowerCase()))===k);
 if(existing){
 const lists=leadLists(existing).slice();
 leadLists(inc).forEach(x=>{ if(!lists.includes(x)) lists.push(x); });
 setLeadLists(existing, lists);
 ['phone','website','contact','email','industry','notes','status','source','lead_type','categories'].forEach(f=>{
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
document.getElementById('resetBtn').addEventListener('click',()=>{
 if(confirm('Reset local list to named demo hotels only (no empty category shells)? This erases your local edits. Shared store is not fully wiped — empty seeds are pruned on next sync.')){
 localStorage.removeItem(KEY); state=loadLeads(); render(); refreshIndustryFilter(); refreshCityFilter();
 prunePlaceholderLeadsOnServer().then(function(){ return hydrateLeadsFromServer(); });
 }
});

