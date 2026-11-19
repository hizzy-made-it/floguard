/* ================= LEADS NEXT (F1): views =================
 * Filter chips, column sort, row selection + bulk bar, table/board toggle, pipeline board with
 * drag and drop (pointer events; stage select on each card is the keyboard path), funnel strip,
 * Today strip (next actions), storm banner, keyboard shortcuts. Depends on 18-leads-next.js. */
(function(){
'use strict';
const FG=window.FG; if(!FG) return;
const h=FG.h;
const LS_CHIPS='floguard_leads_chips_v1', LS_SORT='floguard_leads_sort_v1', LS_VIEW='floguard_leads_view_v1', LS_STORM='floguard_storm_dismissed_v1', LS_TODAY='floguard_today_collapsed_v1';
const V=FG.views={selection:new Set(), active:null};
function readJson(k, d){ try{ const v=JSON.parse(localStorage.getItem(k)); return v==null?d:v; }catch(e){ return d; } }
V.chips=Object.assign({has_phone:false, no_phone:false, dnc:false, due_today:false, stage:''}, readJson(LS_CHIPS, {}));
V.sort=Object.assign({key:'', dir:1}, readJson(LS_SORT, {}));
V.mode=localStorage.getItem(LS_VIEW)==='board'?'board':'table';
const $=function(id){ return document.getElementById(id); };
const panel=$('p-leads');
if(!panel) return;

/* ---------------- filter chips ---------------- */
V.passesChips=function(l){
 const c=V.chips;
 if(c.has_phone && !FG.phone.list(l).length) return false;
 if(c.no_phone && FG.phone.list(l).length) return false;
 if(c.dnc && !FG.phone.anyDnc(l)) return false;
 if(c.due_today){ const t=FG.tasks.of(l); const b=t&&FG.dueBucket(t.due_at); if(b!=='overdue'&&b!=='today') return false; }
 if(c.stage && FG.stageOf(l)!==c.stage) return false;
 return true;
};
function saveChips(){ localStorage.setItem(LS_CHIPS, JSON.stringify(V.chips)); }
const chipBox=$('filterChips');
function paintChips(base){
 if(!chipBox) return;
 const count=function(fn){ return base.filter(fn).length; };
 const n={
  has_phone:count(function(l){ return FG.phone.list(l).length>0; }),
  no_phone:count(function(l){ return !FG.phone.list(l).length; }),
  dnc:count(FG.phone.anyDnc),
  due_today:count(function(l){ const t=FG.tasks.of(l); const b=t&&FG.dueBucket(t.due_at); return b==='overdue'||b==='today'; })
 };
 chipBox.querySelectorAll('button[data-chip]').forEach(function(b){
  const k=b.dataset.chip; const on=!!V.chips[k];
  b.setAttribute('aria-pressed', on?'true':'false');
  const c=b.querySelector('.fc-n'); if(c) c.textContent=n[k];
 });
 const sel=$('chipStage');
 if(sel){
  if(!sel.options.length || sel.options.length<FG.STAGES.length+1){
   sel.innerHTML='<option value="">Any stage</option>'+FG.STAGES.map(function(s){ return '<option value="'+s+'">'+h(FG.STAGE_LABEL[s])+'</option>'; }).join('');
  }
  sel.value=V.chips.stage||'';
  sel.closest('.fc-stage').classList.toggle('on', !!V.chips.stage);
 }
 const any=V.chips.has_phone||V.chips.no_phone||V.chips.dnc||V.chips.due_today||!!V.chips.stage;
 const clr=$('chipClear'); if(clr) clr.hidden=!any;
}
chipBox&&chipBox.addEventListener('click', function(e){
 const b=e.target.closest('button[data-chip]');
 if(b){
  const k=b.dataset.chip; V.chips[k]=!V.chips[k];
  if(k==='has_phone'&&V.chips[k]) V.chips.no_phone=false;
  if(k==='no_phone'&&V.chips[k]) V.chips.has_phone=false;
  saveChips(); render(); return;
 }
 if(e.target.closest('#chipClear')){ V.chips={has_phone:false,no_phone:false,dnc:false,due_today:false,stage:''}; saveChips(); render(); }
});
$('chipStage')&&$('chipStage').addEventListener('change', function(e){ V.chips.stage=e.target.value; saveChips(); render(); });

/* ---------------- sorting ---------------- */
const STAGE_ORDER={new:0,contacted:1,assessment_booked:2,estimate_sent:3,won:4,nurture:5,lost:6};
function scoreVal(l){ const ws=resolveWebsiteScore(l); if(ws) return Number(ws.total)||0; return (!websiteHref(l.website||''))?101:-1; }
function phoneRank(l){ const p=FG.phone.best(l); if(p){ const s=FG.phone.state(p,l); return s.scrub==='scrubbed'?0:1; } return FG.phone.list(l).length?2:3; }
function dueVal(l){ const t=FG.tasks.of(l); return t?String(t.due_at):'9999'; }
V.sortLeads=function(list){
 const k=V.sort.key; if(!k) return list;
 const d=V.sort.dir===-1?-1:1;
 const key={
  name:function(l){ return String(l.name||'').toLowerCase(); },
  score:function(l){ return -scoreVal(l); },
  phone:phoneRank,
  stage:function(l){ return STAGE_ORDER[FG.stageOf(l)]; },
  next:dueVal
 }[k];
 if(!key) return list;
 return list.map(function(l,i){ return {l:l, k:key(l), i:i}; }).sort(function(a,b){
  if(a.k<b.k) return -d; if(a.k>b.k) return d; return a.i-b.i;
 }).map(function(x){ return x.l; });
};
const thead=document.querySelector('#p-leads .leads-table thead');
thead&&thead.addEventListener('click', function(e){
 const b=e.target.closest('button[data-sort]'); if(!b) return;
 const k=b.dataset.sort;
 if(V.sort.key===k){ if(V.sort.dir===1) V.sort.dir=-1; else { V.sort.key=''; V.sort.dir=1; } }
 else { V.sort.key=k; V.sort.dir=1; }
 localStorage.setItem(LS_SORT, JSON.stringify(V.sort));
 render();
});
function paintSortHeads(){
 if(!thead) return;
 thead.querySelectorAll('button[data-sort]').forEach(function(b){
  const on=V.sort.key===b.dataset.sort;
  const th=b.closest('th');
  th.setAttribute('aria-sort', on?(V.sort.dir===1?'ascending':'descending'):'none');
  b.classList.toggle('on', on);
  const u=b.querySelector('use'); if(u) u.setAttribute('href', on?(V.sort.dir===1?'#i-arrow-up':'#i-arrow-down'):'#i-arrow-up-down');
 });
 const ss=$('sortSelect'); if(ss) ss.value=V.sort.key?V.sort.key+':'+V.sort.dir:'';
}
$('sortSelect')&&$('sortSelect').addEventListener('change', function(e){
 const v=e.target.value; if(!v){ V.sort={key:'',dir:1}; } else { const p=v.split(':'); V.sort={key:p[0], dir:Number(p[1])||1}; }
 localStorage.setItem(LS_SORT, JSON.stringify(V.sort)); render();
});

/* ---------------- selection + bulk bar ---------------- */
let lastSelIndex=null;
V.toggleSelect=function(id, on, ev){
 id=String(id);
 const rows=[...document.querySelectorAll('#tbody tr[data-id]')];
 const idx=rows.findIndex(function(r){ return r.dataset.id===id; });
 if(ev && ev.shiftKey && lastSelIndex!=null && idx>=0){
  const a=Math.min(lastSelIndex, idx), b=Math.max(lastSelIndex, idx);
  rows.slice(a,b+1).forEach(function(r){ if(on) V.selection.add(r.dataset.id); else V.selection.delete(r.dataset.id); });
 } else { if(on) V.selection.add(id); else V.selection.delete(id); }
 lastSelIndex=idx;
 paintSelection();
};
function paintSelection(){
 document.querySelectorAll('#tbody tr[data-id]').forEach(function(r){
  const on=V.selection.has(r.dataset.id);
  r.classList.toggle('is-sel', on);
  const cb=r.querySelector('input.row-sel'); if(cb) cb.checked=on;
 });
 const all=$('selAll');
 if(all){
  const ids=[...document.querySelectorAll('#tbody tr[data-id]')].map(function(r){ return r.dataset.id; });
  const n=ids.filter(function(i){ return V.selection.has(i); }).length;
  all.checked=ids.length>0 && n===ids.length;
  all.indeterminate=n>0 && n<ids.length;
 }
 const bar=$('bulkBar');
 if(bar){
  // drop ids that no longer exist
  [...V.selection].forEach(function(id){ if(!FG.leadById(id)) V.selection.delete(id); });
  const n=V.selection.size;
  if(n && bar.hidden){
   let dl=document.getElementById('bulkOwnerList');
   if(!dl){ dl=document.createElement('datalist'); dl.id='bulkOwnerList'; document.body.appendChild(dl); }
   const owners=new Set(); state.forEach(function(l){ if(l.owner) owners.add(String(l.owner)); }); const me=currentUserName(); if(me) owners.add(me);
   dl.innerHTML=[...owners].sort().map(function(o){ return '<option value="'+h(o)+'">'; }).join('');
  }
  bar.hidden=n===0;
  const c=$('bulkCount'); if(c) c.textContent=n+' selected';
 }
}
V.selectedLeads=function(){ return [...V.selection].map(FG.leadById).filter(Boolean); };
$('selAll')&&$('selAll').addEventListener('change', function(e){
 document.querySelectorAll('#tbody tr[data-id]').forEach(function(r){ if(e.target.checked) V.selection.add(r.dataset.id); else V.selection.delete(r.dataset.id); });
 paintSelection();
});
const bulkBar=$('bulkBar');
if(bulkBar){
 const st=$('bulkStage');
 if(st) st.innerHTML='<option value="">Move to stage…</option>'+FG.STAGES.map(function(s){ return '<option value="'+s+'">'+h(FG.STAGE_LABEL[s])+'</option>'; }).join('');
 st&&st.addEventListener('change', async function(){
  const stage=st.value; if(!stage) return;
  st.value='';
  const leads=V.selectedLeads();
  if(!leads.length) return;
  if(stage==='won'||stage==='lost'){
   FG.toast('Won and Lost need a close-out per lead. Move them one at a time from the board or the lead.', {kind:'info'});
   return;
  }
  const ok=await FG.confirm({title:'Move '+leads.length+' lead'+(leads.length===1?'':'s')+'?', message:'Set the pipeline stage to '+FG.STAGE_LABEL[stage]+'.', confirmLabel:'Move '+leads.length});
  if(!ok) return;
  for(const l of leads){ await FG.setStage(l, stage, {quiet:true, via:'bulk'}); }
  FG.toast('Moved '+leads.length+' to '+FG.STAGE_LABEL[stage]+'.', {kind:'ok'});
 });
 $('bulkOwnerApply')&&$('bulkOwnerApply').addEventListener('click', async function(){
  const v=($('bulkOwner').value||'').trim();
  const leads=V.selectedLeads(); if(!leads.length) return;
  if(!v){ FG.toast('Type a rep username first.', {kind:'err'}); $('bulkOwner').focus(); return; }
  for(const l of leads){ await FG.sync.patch(l, {owner:v}, {noPush:true}); }
  saveLeads(); render();
  FG.toast('Owner set to '+v+' on '+leads.length+' lead'+(leads.length===1?'':'s')+'.', {kind:'ok'});
 });
 $('bulkEnrich')&&$('bulkEnrich').addEventListener('click', function(){ FG.enrich&&FG.enrich.open({scope:'selected'}); });
 $('bulkExport')&&$('bulkExport').addEventListener('click', function(){ exportCsv(V.selectedLeads(), 'floguard_leads_selected.csv'); });
 $('bulkClear')&&$('bulkClear').addEventListener('click', function(){ V.selection.clear(); paintSelection(); });
}
function exportCsv(list, filename){
 const cols=['name','address','city','zip','parcel_id','industry','list','phone','email','website','contact','status','stage','next_action','owner','amount','notes'];
 const rows=list.map(function(l){
  return cols.map(function(c){
   let v=l[c];
   if(c==='list') v=leadLists(l).join('|');
   if(c==='stage') v=FG.STAGE_LABEL[FG.stageOf(l)];
   if(c==='next_action'){ const t=FG.tasks.of(l); v=t?(FG.TASK_LABEL[t.type]+' '+String(t.due_at).slice(0,16)+(t.note?' '+t.note:'')):''; }
   return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  }).join(',');
 });
 const blob=new Blob([[cols.join(',')].concat(rows).join('\n')],{type:'text/csv'});
 const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
 FG.toast('Exported '+list.length+' lead'+(list.length===1?'':'s')+'.', {kind:'ok'});
}
V.exportCsv=exportCsv;

/* ---------------- active row (keyboard) ---------------- */
V.setActiveRow=function(id, opts){
 V.active=id==null?null:String(id);
 document.querySelectorAll('#tbody tr.kb-active, #leadsBoard .bd-card.kb-active').forEach(function(r){ r.classList.remove('kb-active'); });
 if(V.active==null) return;
 const el=V.mode==='board'?document.querySelector('#leadsBoard .bd-card[data-id="'+CSS.escape(V.active)+'"]'):document.querySelector('#tbody tr[data-id="'+CSS.escape(V.active)+'"]');
 if(el){ el.classList.add('kb-active'); if(!(opts&&opts.noScroll)) el.scrollIntoView({block:'nearest'}); if(V.mode==='board'&&!(opts&&opts.noFocus)) el.focus({preventScroll:true}); }
};
function moveActive(delta){
 const els=V.mode==='board'?[...document.querySelectorAll('#leadsBoard .bd-card')]:[...document.querySelectorAll('#tbody tr[data-id]')];
 if(!els.length) return;
 let i=els.findIndex(function(r){ return r.dataset.id===V.active; });
 i=i<0?(delta>0?0:els.length-1):Math.max(0, Math.min(els.length-1, i+delta));
 V.setActiveRow(els[i].dataset.id);
}
V.focusNewLead=function(lead){
 setTimeout(function(){
  if(V.mode==='board'){ openProfile(lead.id); return; }
  const inp=document.querySelector('#tbody tr[data-id="'+CSS.escape(String(lead.id))+'"] input[data-f="name"]');
  if(inp){ inp.focus(); V.setActiveRow(lead.id, {noScroll:false}); }
 }, 0);
};

/* ---------------- table / board toggle ---------------- */
const vt=$('viewToggle');
function paintViewToggle(){
 if(!vt) return;
 vt.querySelectorAll('button[data-view]').forEach(function(b){ const on=b.dataset.view===V.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on?'true':'false'); });
 panel.classList.toggle('is-board', V.mode==='board');
}
V.setMode=function(m){ V.mode=m==='board'?'board':'table'; localStorage.setItem(LS_VIEW, V.mode); paintViewToggle(); render(); };
vt&&vt.addEventListener('click', function(e){ const b=e.target.closest('button[data-view]'); if(b) V.setMode(b.dataset.view); });

/* ---------------- board ---------------- */
const board=$('leadsBoard');
const COL_LIMIT=60;
const showAll={};
function phoneStateChip(l){
 const list=FG.phone.list(l);
 if(!list.length) return '<span class="ph-chip muted">No phone</span>';
 const best=FG.phone.best(l);
 if(!best){ const st=FG.phone.state(list[0], l); return '<span class="ph-chip bad" title="'+h(st.reason)+'">'+FG.icon('ban')+(st.scrub==='dnc'?'DNC':'Blocked')+'</span>'; }
 const st=FG.phone.state(best, l);
 const lt={mobile:'Mobile', landline:'Landline', voip:'VoIP'}[best.line_type]||'Phone';
 return '<span class="ph-chip '+(st.scrub==='scrubbed'?'ok':'warn')+'" title="'+h(best.number+' · '+(st.scrub==='scrubbed'?'DNC scrubbed':'not scrubbed'))+'">'+FG.icon('phone')+lt+(st.scrub==='scrubbed'?'':' · not scrubbed')+'</span>';
}
function cardHtml(l){
 const stage=FG.stageOf(l);
 const days=FG.daysInStage(l);
 const na=FG.tasks.chip(l);
 return '<article class="bd-card" data-id="'+h(String(l.id))+'" tabindex="0" aria-label="'+h((l.name||'(unnamed)')+', '+FG.STAGE_LABEL[stage])+'">'+
  '<div class="bd-top"><span class="bd-grip" title="Drag to move" aria-hidden="true">'+FG.icon('grip-vertical')+'</span><b class="bd-name">'+h(l.name||'(unnamed)')+'</b>'+scoreCellHtml(l)+'</div>'+
  '<div class="bd-addr">'+h(l.address||((l.city||'')+' · no site address'))+'</div>'+
  '<div class="bd-meta">'+phoneStateChip(l)+(na||'')+'</div>'+
  '<div class="bd-foot"><span class="bd-days num" title="Days in this stage">'+(days==null?'':days+'d in stage')+'</span>'+(Number(l.amount)?'<span class="bd-amt num">'+FG.moneyShort(l.amount)+'</span>':'')+
  '<label class="sr-only" for="bds_'+h(String(l.id))+'">Move '+h(l.name||'lead')+' to stage</label><select class="bd-stage" id="bds_'+h(String(l.id))+'">'+FG.STAGES.map(function(s){ return '<option value="'+s+'"'+(s===stage?' selected':'')+'>'+h(FG.STAGE_LABEL[s])+'</option>'; }).join('')+'</select></div>'+
 '</article>';
}
const LINEAR=['new','contacted','assessment_booked','estimate_sent','won'];
function reachedCounts(list){
 const idx={new:0,contacted:1,assessment_booked:2,estimate_sent:3,won:4};
 const r={new:0,contacted:0,assessment_booked:0,estimate_sent:0,won:0};
 list.forEach(function(l){ const s=FG.stageOf(l); if(!(s in idx)) return; LINEAR.forEach(function(x){ if(idx[s]>=idx[x]) r[x]++; }); });
 return r;
}
V.renderBoard=function(list){
 if(!board) return;
 const by={}; FG.STAGES.forEach(function(s){ by[s]=[]; });
 list.forEach(function(l){ by[FG.stageOf(l)].push(l); });
 const reached=reachedCounts(list);
 board.innerHTML=FG.STAGES.map(function(s,i){
  const items=by[s];
  const amt=items.reduce(function(n,l){ return n+(Number(l.amount)||0); },0);
  let conv='';
  const li=LINEAR.indexOf(s);
  if(li>0 && reached[LINEAR[li-1]]) conv='<span class="bd-conv" title="Share of leads that got at least as far as '+h(FG.STAGE_LABEL[LINEAR[li-1]])+' and reached '+h(FG.STAGE_LABEL[s])+'">'+Math.round(100*reached[s]/reached[LINEAR[li-1]])+'%</span>';
  const lim=showAll[s]?items.length:COL_LIMIT;
  return '<section class="bd-col" data-stage="'+s+'" aria-label="'+h(FG.STAGE_LABEL[s])+', '+items.length+' leads">'+
   '<header class="bd-head">'+FG.stageChip(s)+'<span class="bd-count num">'+items.length+'</span>'+conv+(amt?'<span class="bd-sum num" title="Sum of lead amounts">'+FG.moneyShort(amt)+'</span>':'')+'</header>'+
   '<div class="bd-list">'+items.slice(0,lim).map(cardHtml).join('')+
   (items.length>lim?'<button type="button" class="btn btn--sm ghost bd-more" data-more="'+s+'">Show '+(items.length-lim)+' more</button>':'')+
   (!items.length?'<div class="bd-empty">Drop a lead here</div>':'')+
   '</div></section>';
 }).join('');
 if(V.active) V.setActiveRow(V.active, {noScroll:true, noFocus:true});
};
board&&board.addEventListener('click', function(e){
 const more=e.target.closest('[data-more]'); if(more){ showAll[more.dataset.more]=1; render(); return; }
 if(drag.suppressClick){ drag.suppressClick=false; return; }
 const card=e.target.closest('.bd-card'); if(!card || e.target.closest('select,button,label,a')) return;
 V.setActiveRow(card.dataset.id, {noScroll:true, noFocus:true});
 openProfile(FG.leadById(card.dataset.id).id);
});
board&&board.addEventListener('change', function(e){
 const sel=e.target.closest('select.bd-stage'); if(!sel) return;
 const card=sel.closest('.bd-card'); const l=FG.leadById(card.dataset.id); if(!l) return;
 const to=sel.value;
 V.active=String(l.id);
 FG.setStage(l, to, {via:'board'}).then(function(moved){
  if(!moved) render();
  setTimeout(function(){ const c=document.querySelector('#leadsBoard .bd-card[data-id="'+CSS.escape(String(l.id))+'"] select.bd-stage'); c&&c.focus({preventScroll:true}); }, 0);
 });
});
board&&board.addEventListener('keydown', function(e){
 const card=e.target.closest('.bd-card'); if(!card || e.target!==card) return;
 if(e.key==='Enter'){ e.preventDefault(); openProfile(FG.leadById(card.dataset.id).id); }
 // Alt+Arrow moves a card one column (keyboard alternative to dragging)
 if(e.altKey && (e.key==='ArrowRight'||e.key==='ArrowLeft')){
  e.preventDefault();
  const l=FG.leadById(card.dataset.id); const i=FG.STAGES.indexOf(FG.stageOf(l));
  const to=FG.STAGES[Math.max(0, Math.min(FG.STAGES.length-1, i+(e.key==='ArrowRight'?1:-1)))];
  V.active=String(l.id);
  FG.setStage(l, to, {via:'board'}).then(function(){ V.setActiveRow(l.id); });
 }
});
/* drag and drop (pointer events). Mouse/pen: drag the card. Touch: drag by the grip. */
const drag={el:null, id:null, startX:0, startY:0, ghost:null, over:null, active:false, suppressClick:false, pid:null};
board&&board.addEventListener('pointerdown', function(e){
 const card=e.target.closest('.bd-card'); if(!card || e.button>0) return;
 if(e.target.closest('select,button,a,label')) return;
 if(e.pointerType==='touch' && !e.target.closest('.bd-grip')) return;
 drag.el=card; drag.id=card.dataset.id; drag.startX=e.clientX; drag.startY=e.clientY; drag.active=false; drag.pid=e.pointerId;
});
function endDrag(){
 if(drag.ghost) drag.ghost.remove();
 if(drag.el) drag.el.classList.remove('is-dragging');
 board.querySelectorAll('.bd-col.drop-on').forEach(function(c){ c.classList.remove('drop-on'); });
 document.documentElement.classList.remove('fg-dragging');
 drag.el=null; drag.ghost=null; drag.over=null; drag.active=false;
}
window.addEventListener('pointermove', function(e){
 if(!drag.el || e.pointerId!==drag.pid) return;
 const dx=e.clientX-drag.startX, dy=e.clientY-drag.startY;
 if(!drag.active){
  if(Math.abs(dx)+Math.abs(dy)<6) return;
  drag.active=true;
  const r=drag.el.getBoundingClientRect();
  drag.ghost=drag.el.cloneNode(true); drag.ghost.classList.add('bd-ghost'); drag.ghost.removeAttribute('id');
  drag.ghost.style.width=r.width+'px'; drag.ghost.style.left=r.left+'px'; drag.ghost.style.top=r.top+'px';
  drag.offX=drag.startX-r.left; drag.offY=drag.startY-r.top;
  document.body.appendChild(drag.ghost);
  drag.el.classList.add('is-dragging');
  document.documentElement.classList.add('fg-dragging');
 }
 e.preventDefault();
 drag.ghost.style.left=(e.clientX-drag.offX)+'px'; drag.ghost.style.top=(e.clientY-drag.offY)+'px';
 const under=document.elementFromPoint(e.clientX, e.clientY);
 const col=under&&under.closest?under.closest('.bd-col'):null;
 if(col!==drag.over){ if(drag.over) drag.over.classList.remove('drop-on'); drag.over=col; if(col) col.classList.add('drop-on'); }
 // auto-scroll the board near its edges
 const br=board.getBoundingClientRect();
 if(e.clientX>br.right-40) board.scrollLeft+=14; else if(e.clientX<br.left+40) board.scrollLeft-=14;
}, {passive:false});
window.addEventListener('pointerup', function(e){
 if(!drag.el || e.pointerId!==drag.pid) return;
 const wasActive=drag.active, col=drag.over, id=drag.id;
 endDrag();
 if(!wasActive) return;
 drag.suppressClick=true; setTimeout(function(){ drag.suppressClick=false; }, 50);
 if(!col) return;
 const l=FG.leadById(id); if(!l) return;
 const to=col.dataset.stage;
 if(to===FG.stageOf(l)) return;
 V.active=String(l.id);
 FG.setStage(l, to, {via:'board'});
});
window.addEventListener('pointercancel', endDrag);
document.addEventListener('keydown', function(e){ if(e.key==='Escape' && drag.active){ endDrag(); } });

/* ---------------- funnel strip ---------------- */
V.funnel=null; // server funnel response when in server mode
function monthStart(){ const d=new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); }
V.funnelData=function(){
 const counts={}; FG.STAGES.forEach(function(s){ counts[s]=0; });
 let openVal=0, wonMonth=0, wonMonthVal=0, withPhone=0, dialable=0, dnc=0;
 const ms=monthStart();
 state.forEach(function(l){
  const s=FG.stageOf(l); counts[s]++;
  const amt=Number(l.amount)||0;
  if(s==='contacted'||s==='assessment_booked'||s==='estimate_sent'||s==='new') openVal+=amt;
  if(s==='won'){ const t=new Date(l.stage_changed_at||l.updated_at||0); if(!isNaN(t) && t>=ms){ wonMonth++; wonMonthVal+=amt; } }
  const list=FG.phone.list(l);
  if(list.length) withPhone++;
  if(FG.phone.best(l)) dialable++;
  if(FG.phone.anyDnc(l)) dnc++;
 });
 if(FG.isServer() && V.funnel && V.funnel.funnel){ FG.STAGES.forEach(function(s){ if(s in V.funnel.funnel) counts[s]=Number(V.funnel.funnel[s])||0; }); }
 const since=Date.now()-7*86400000;
 const acts={call:0, text:0, email:0};
 loadActivities().forEach(function(a){
  const t=Date.parse(a.at); if(!(t>=since)) return;
  const ty=a.type==='sms'?'text':a.type;
  if(ty in acts) acts[ty]++;
 });
 const total=FG.STAGES.reduce(function(n,s){ return n+counts[s]; },0);
 return {counts:counts, total:total, openVal:openVal, wonMonth:wonMonth, wonMonthVal:wonMonthVal, withPhone:withPhone, dialable:dialable, dnc:dnc, leads:state.length, acts:acts};
};
function paintFunnel(){
 const box=$('funnelStrip'); if(!box) return;
 const d=V.funnelData();
 const open=d.counts.new+d.counts.contacted+d.counts.assessment_booked+d.counts.estimate_sent;
 const seg=FG.STAGES.filter(function(s){ return d.counts[s]>0; }).map(function(s){
  return '<i data-st="'+FG.stageTone(s)+'" style="flex:'+d.counts[s]+'" title="'+h(FG.STAGE_LABEL[s]+': '+d.counts[s])+'"></i>';
 }).join('');
 const legend=FG.STAGES.filter(function(s){ return d.counts[s]>0; }).map(function(s){ return '<span><i data-st="'+FG.stageTone(s)+'"></i>'+h(FG.STAGE_LABEL[s])+' <b class="num">'+d.counts[s]+'</b></span>'; }).join('');
 const pct=d.leads?Math.round(100*d.dialable/d.leads):0;
 box.innerHTML=
  '<button type="button" class="fn-tile fn-pipe" data-go-board title="Open the pipeline board"><span class="fn-l">Pipeline</span><span class="fn-n num">'+open+'<small> open</small></span><span class="fn-bar">'+seg+'</span><span class="fn-legend">'+legend+'</span></button>'+
  '<div class="fn-tile"><span class="fn-l">Open pipeline value</span><span class="fn-n num">'+FG.moneyShort(d.openVal)+'</span><span class="fn-s">'+d.counts.estimate_sent+' estimate'+(d.counts.estimate_sent===1?'':'s')+' out</span></div>'+
  '<div class="fn-tile"><span class="fn-l">Won this month</span><span class="fn-n num">'+d.wonMonth+'</span><span class="fn-s num">'+FG.money(d.wonMonthVal)+'</span></div>'+
  '<button type="button" class="fn-tile" data-chip-go="has_phone" title="Show leads with a phone"><span class="fn-l">Dialable phone</span><span class="fn-n num">'+d.dialable+'<small> / '+d.leads+'</small></span><span class="fn-meter"><i style="width:'+pct+'%"></i></span><span class="fn-s">'+(d.leads-d.withPhone)+' without a phone'+(d.dnc?' · '+d.dnc+' DNC':'')+'</span></button>'+
  '<div class="fn-tile"><span class="fn-l" title="Calls, texts and emails logged on this device in the last 7 days">Last 7 days · this device</span><span class="fn-n num">'+(d.acts.call+d.acts.text+d.acts.email)+'<small> touches</small></span><span class="fn-s num">'+d.acts.call+' calls · '+d.acts.text+' texts · '+d.acts.email+' emails</span></div>';
}
$('funnelStrip')&&$('funnelStrip').addEventListener('click', function(e){
 if(e.target.closest('[data-go-board]')){ V.setMode('board'); $('leadsBoard')&&$('leadsBoard').scrollIntoView({behavior:'smooth', block:'start'}); return; }
 const c=e.target.closest('[data-chip-go]');
 if(c){ V.chips.has_phone=true; V.chips.no_phone=false; saveChips(); render(); }
});
V.reloadFunnel=async function(){
 if(!FG.isServer()){ V.funnel=null; paintFunnel(); return; }
 const res=await FG.leadsApi('funnel', {});
 if(res.ok && res.data) V.funnel=res.data;
 paintFunnel();
};

/* ---------------- Today strip ---------------- */
const SNOOZE=[['1h','1 hour'],['tomorrow','Tomorrow 9 AM'],['3d','In 3 days'],['1w','Next week']];
let todayItems=[], todayAll=false;
function paintToday(){
 const box=$('todayStrip'); if(!box) return;
 todayItems=FG.tasks.due();
 const over=todayItems.filter(function(t){ return t.bucket==='overdue'; }).length;
 const today=todayItems.length-over;
 const collapsed=localStorage.getItem(LS_TODAY)==='1';
 const max=todayAll?todayItems.length:5;
 const head='<div class="td-head"><h2 id="todayTitle">'+FG.icon('calendar-clock')+'Today</h2>'+
  (over?'<span class="td-badge over num">'+over+' overdue</span>':'')+
  (today?'<span class="td-badge num">'+today+' due today</span>':'')+
  (!todayItems.length?'<span class="td-empty">Nothing due. Set a next action on a lead and it shows up here.</span>':'')+
  '<span class="spacer"></span>'+
  (todayItems.length?'<button type="button" class="btn btn--sm ghost" id="todayToggle" aria-expanded="'+(!collapsed)+'" aria-controls="todayList">'+(collapsed?'Show':'Hide')+'</button>':'')+
  '</div>';
 const rows=todayItems.slice(0,max).map(function(t){
  const l=t.lead;
  const p=l?FG.phone.best(l):null;
  const canDial=(t.type==='call'||t.type==='text') && l;
  const blocked=canDial && (!p);
  const dialBtn=canDial?(blocked
   ? '<button type="button" class="btn btn--sm" data-td="dial" aria-disabled="true" title="'+(FG.phone.list(l).length?'Number is blocked (DNC / litigator). Send mail or a door hanger instead.':'No phone on file')+'">'+FG.icon(t.type==='text'?'message-square':'phone')+(t.type==='text'?'Text':'Call')+'</button>'
   : '<button type="button" class="btn btn--sm o" data-td="dial" title="'+h(p.number)+'">'+FG.icon(t.type==='text'?'message-square':'phone')+(t.type==='text'?'Text':'Call')+'</button>'):'';
  return '<li class="td-item '+h(t.bucket||'')+'" data-key="'+h(t.key)+'">'+
   '<span class="td-ic">'+FG.icon(FG.TASK_ICON[t.type]||'list-todo')+'</span>'+
   '<div class="td-main"><button type="button" class="td-lead" data-td="open">'+h(t.lead_name)+'</button><span class="td-note">'+h(FG.TASK_LABEL[t.type]+(t.note?' · '+t.note:''))+'</span></div>'+
   '<span class="td-due num">'+h(FG.fmtDue(t.due_at))+'</span>'+
   '<div class="td-acts">'+dialBtn+
    '<button type="button" class="btn btn--sm" data-td="done" title="Mark done">'+FG.icon('check')+'Done</button>'+
    '<details class="menu td-snooze"><summary class="btn btn--sm" aria-label="Snooze">'+FG.icon('alarm-clock')+'Snooze</summary><div class="menu-pop" role="menu">'+
     SNOOZE.map(function(s){ return '<button type="button" class="menu-item" role="menuitem" data-snooze="'+s[0]+'">'+s[1]+'</button>'; }).join('')+
    '</div></details>'+
   '</div></li>';
 }).join('');
 box.classList.toggle('is-empty', !todayItems.length);
 box.innerHTML=head+(todayItems.length?'<ul class="td-list" id="todayList"'+(collapsed?' hidden':'')+'>'+rows+'</ul>'+(todayItems.length>5&&!collapsed?'<button type="button" class="btn btn--sm ghost td-all" id="todayAll">'+(todayAll?'Show fewer':'Show all '+todayItems.length)+'</button>':''):'');
}
$('todayStrip')&&$('todayStrip').addEventListener('click', function(e){
 if(e.target.closest('#todayToggle')){ localStorage.setItem(LS_TODAY, localStorage.getItem(LS_TODAY)==='1'?'0':'1'); paintToday(); return; }
 if(e.target.closest('#todayAll')){ todayAll=!todayAll; paintToday(); return; }
 const li=e.target.closest('.td-item'); if(!li) return;
 const item=todayItems.find(function(t){ return t.key===li.dataset.key; }); if(!item) return;
 const sz=e.target.closest('[data-snooze]');
 if(sz){ e.target.closest('details')?.removeAttribute('open'); FG.tasks.snooze(item, sz.dataset.snooze); return; }
 const b=e.target.closest('[data-td]'); if(!b) return;
 const act=b.dataset.td;
 if(act==='open' && item.lead) openProfile(item.lead.id);
 if(act==='done') FG.tasks.complete(item);
 if(act==='dial' && item.lead){
  const p=FG.phone.best(item.lead);
  if(!p){ const any=FG.phone.list(item.lead)[0]; if(any) FG.dial.explainBlocked(item.lead, any, item.type); else FG.toast('No phone on file for '+item.lead_name+'.', {kind:'err'}); return; }
  FG.dial.start(item.lead, p.number, item.type);
 }
});

/* ---------------- storm banner ---------------- */
V.storm=null;
V.loadStorm=async function(){
 const tok=getToken(); if(!tok) return;
 let data=null;
 try{
  const r=await fetch('/crm/api/fsi-parcels',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'storm', minRainMm:25, minBand:'must', limit:300})});
  if(!r.ok) return;
  data=await r.json();
 }catch(e){ return; }
 if(!data || !Array.isArray(data.cells) || !data.cells.length || !Array.isArray(data.parcels) || !data.parcels.length) return;
 V.storm=data;
 FG.storm=data;
 paintStorm();
};
function stormKey(d){ const c=(d.cells||[])[0]||{}; return String(c.rain_day||'')+'|'+(d.parcels||[]).length; }
function paintStorm(){
 const el=$('stormBanner'); const d=V.storm; if(!el) return;
 if(!d || localStorage.getItem(LS_STORM)===stormKey(d)){ el.hidden=true; return; }
 const byCity={};
 d.parcels.forEach(function(p){ const c=String(p.city||'').trim(); if(c) byCity[c]=(byCity[c]||0)+1; });
 const cities=Object.keys(byCity).sort(function(a,b){ return byCity[b]-byCity[a]; });
 const areas=cities.slice(0,3).join(', ')+(cities.length>3?' and '+(cities.length-3)+' more':'');
 const maxRain=Math.max.apply(null, d.cells.map(function(c){ return Number(c.rain_24h)||0; }));
 const inches=(maxRain/25.4).toFixed(1);
 el.innerHTML='<span class="sb-ic">'+FG.icon('cloud-rain')+'</span><div class="sb-txt"><b>Rain yesterday in '+h(areas||'the service area')+'</b> — <span class="num">'+d.parcels.length+'</span> high-score parcel'+(d.parcels.length===1?'':'s')+' to dial while yards are still wet <span class="sb-sub num">(up to '+inches+'″ in a cell)</span></div>'+
  '<button type="button" class="btn btn--sm p" id="stormOpen">'+FG.icon('map')+'Open storm list</button>'+
  '<button type="button" class="btn btn--icon btn--sm ghost" id="stormDismiss" aria-label="Dismiss storm banner">'+FG.icon('x')+'</button>';
 el.hidden=false;
}
$('stormBanner')&&$('stormBanner').addEventListener('click', function(e){
 if(e.target.closest('#stormDismiss')){ localStorage.setItem(LS_STORM, stormKey(V.storm)); $('stormBanner').hidden=true; return; }
 if(e.target.closest('#stormOpen')){
  goTab('fsi');
  // The Flood Map owns the storm list (F2). It can listen for this event or expose fsiShowStorm(data).
  FG.emit('fg:storm-open', V.storm);
  if(typeof window.fsiShowStorm==='function'){ try{ window.fsiShowStorm(V.storm); }catch(err){ console.error(err); } }
 }
});

/* ---------------- after every render ---------------- */
let stripTimer=null;
V.paintStrips=function(){ clearTimeout(stripTimer); stripTimer=setTimeout(function(){ paintFunnel(); paintToday(); }, 60); };
V.afterRender=function(list){
 paintChips(visibleLeads({noChips:true, noSort:true}));
 paintSortHeads();
 paintViewToggle();
 const tw=document.querySelector('#p-leads .leads-table');
 if(V.mode==='board'){ if(tw) tw.hidden=true; if(board){ board.hidden=false; V.renderBoard(list); } }
 else { if(tw) tw.hidden=false; if(board){ board.hidden=true; board.innerHTML=''; } }
 paintSelection();
 if(V.active && V.mode==='table') V.setActiveRow(V.active, {noScroll:true});
 V.paintStrips();
};
document.addEventListener('fg:tasks', function(){ paintToday(); });
document.addEventListener('fg:leads-changed', function(){ V.paintStrips(); });
document.addEventListener('fg:activity', function(){ V.paintStrips(); });
document.addEventListener('fg:mode', function(e){ if(e.detail&&e.detail.mode==='server'){ V.reloadFunnel(); } V.paintStrips(); });

/* ---------------- keyboard shortcuts ---------------- */
const SHORTCUTS=[['/','Search leads'],['n','New lead'],['j / k','Next / previous lead'],['Enter','Open the highlighted lead'],['x','Select the highlighted lead'],['b','Switch table / board'],['Alt + ← / →','Move a focused board card one stage'],['Esc','Close the lead or dialog'],['?','Show this help']];
V.showHelp=function(){
 FG.modal({title:'Keyboard shortcuts', size:'sm', className:'fg-help',
  body:'<dl class="kbd-list">'+SHORTCUTS.map(function(s){ return '<div><dt>'+s[0].split(' / ').map(function(k){ return '<kbd>'+h(k)+'</kbd>'; }).join(' / ')+'</dt><dd>'+h(s[1])+'</dd></div>'; }).join('')+'</dl><p class="hint mt-2">Shortcuts work on the Leads page when you are not typing in a field.</p>',
  actions:[{label:'Close', kind:'p'}]});
};
$('kbdHelp')&&$('kbdHelp').addEventListener('click', V.showHelp);
function typing(el){ return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); }
document.addEventListener('keydown', function(e){
 if(!panel.classList.contains('on')) return;
 if(FG.modalOpen()) return;
 if(document.getElementById('profileDrawer')?.classList.contains('open')) return;
 if(e.metaKey||e.ctrlKey) return;
 if(e.key==='Escape' && document.activeElement && document.activeElement.id==='search'){ document.activeElement.blur(); return; }
 if(typing(document.activeElement)) return;
 if(e.altKey) return;
 const k=e.key;
 if(k==='/'){ e.preventDefault(); $('search')?.focus(); return; }
 if(k==='?'){ e.preventDefault(); V.showHelp(); return; }
 if(k==='n'){ e.preventDefault(); $('addBtn')?.click(); return; }
 if(k==='j'){ e.preventDefault(); moveActive(1); return; }
 if(k==='k'){ e.preventDefault(); moveActive(-1); return; }
 if(k==='b'){ e.preventDefault(); V.setMode(V.mode==='board'?'table':'board'); return; }
 if(k==='x' && V.active){ e.preventDefault(); V.toggleSelect(V.active, !V.selection.has(V.active)); return; }
 if(k==='Enter' && V.active && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('button,a,summary'))){
  const l=FG.leadById(V.active); if(l){ e.preventDefault(); openProfile(l.id); }
 }
});

/* ---------------- boot ---------------- */
paintViewToggle();
function kick(){
 if(!getToken()) return;
 FG.server.detect().then(function(){ V.reloadFunnel(); paintToday(); });
 V.loadStorm();
 FG.closeout.flush();
}
// 13-boot.js awaits auth before hydrating; poll briefly for the session, then probe once.
let tries=0;
(function wait(){ if(getToken()){ kick(); return; } if(++tries<40) setTimeout(wait, 250); })();
// Incremental refresh: every 2 minutes while visible (server mode only)
setInterval(function(){ if(document.visibilityState==='visible' && FG.isServer()){ FG.sync.refresh(); FG.tasks.reload(); } }, 120000);
document.addEventListener('visibilitychange', function(){ if(document.visibilityState==='visible' && FG.isServer()){ FG.sync.refresh(); FG.tasks.reload(); } });
})();
