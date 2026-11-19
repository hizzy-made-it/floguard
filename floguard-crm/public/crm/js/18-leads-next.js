/* ================= LEADS NEXT (F1): core =================
 * Namespace window.FG. Loaded after 17-shell.js. Holds the pieces the leads workspace shares:
 * backend capability detection, per-lead patch with conflict handling, incremental refresh,
 * stage derivation, phone/DNC state, dial guard + outcome logger, activity, next actions,
 * close-out (lead_outcomes) modal, toasts, modals with focus trap.
 * Everything works offline / without the Postgres backend ("local mode"): edits stay in
 * localStorage and ride the existing blob push in 04-state.js. */
(function(){
'use strict';
const FG=window.FG=window.FG||{};
const LS_SINCE='floguard_leads_since_v1';
const LS_OUTQ='floguard_outcome_queue_v1';

/* ---------------- small helpers ---------------- */
const h=function(s){ return esc(s); };
FG.h=h;
FG.icon=function(name, cls){ return '<svg class="ic'+(cls?' '+cls:'')+'" aria-hidden="true"><use href="#i-'+name+'"/></svg>'; };
FG.leadById=function(id){ return state.find(function(x){ return String(x.id)===String(id); })||null; };
FG.leadByUuid=function(u){ return u?state.find(function(x){ return x.uuid===u; })||null:null; };
FG.leadByRef=function(ref){ return FG.leadByUuid(ref)||state.find(function(x){ return String(x.server_id)===String(ref); })||FG.leadById(ref); };
/** Reference the server understands: uuid first, then the server's legacy id, then ours. */
FG.ref=function(l){ return l.uuid||(l.server_id!=null?l.server_id:l.id); };
FG.uid=function(){ return Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8); };
FG.now=function(){ return new Date(); };
function startOfDay(d){ const x=new Date(d||Date.now()); x.setHours(0,0,0,0); return x; }
function endOfDay(d){ const x=new Date(d||Date.now()); x.setHours(23,59,59,999); return x; }
FG.startOfDay=startOfDay; FG.endOfDay=endOfDay;
FG.toLocalInput=function(iso){
 const d=iso?new Date(iso):null; if(!d||isNaN(d)) return '';
 const p=function(n){ return String(n).padStart(2,'0'); };
 return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
};
FG.fromLocalInput=function(v){ if(!v) return ''; const d=new Date(v); return isNaN(d)?'':d.toISOString(); };
FG.at=function(dayOffset, hour, min){ const d=startOfDay(); d.setDate(d.getDate()+(dayOffset||0)); d.setHours(hour==null?9:hour, min||0, 0, 0); return d.toISOString(); };
FG.fmtTime=function(d){ return d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); };
/** "Today 2:00 PM", "Tomorrow 9:00 AM", "Mon 11/24", "2d overdue". */
FG.fmtDue=function(iso){
 const d=new Date(iso); if(!iso||isNaN(d)) return '';
 const today=startOfDay(); const day=startOfDay(d);
 const diff=Math.round((day-today)/86400000);
 if(d<new Date() && diff<0) return (-diff)+'d overdue';
 if(diff===0) return (d<new Date()?'Overdue · ':'Today ')+FG.fmtTime(d);
 if(diff===1) return 'Tomorrow '+FG.fmtTime(d);
 if(diff>1 && diff<7) return d.toLocaleDateString([], {weekday:'short'})+' '+FG.fmtTime(d);
 return d.toLocaleDateString([], {month:'numeric', day:'numeric'});
};
FG.dueBucket=function(iso){
 const d=new Date(iso); if(!iso||isNaN(d)) return null;
 if(d<new Date()) return 'overdue';
 if(d<=endOfDay()) return 'today';
 return 'later';
};
FG.fmtWhen=function(iso){
 const d=new Date(iso); if(!iso||isNaN(d)) return '';
 const diff=Math.round((startOfDay()-startOfDay(d))/86400000);
 const t=FG.fmtTime(d);
 if(diff===0) return 'Today '+t;
 if(diff===1) return 'Yesterday '+t;
 if(diff<7) return d.toLocaleDateString([], {weekday:'short'})+' '+t;
 return d.toLocaleDateString([], {month:'short', day:'numeric', year:(d.getFullYear()!==new Date().getFullYear()?'numeric':undefined)})+' '+t;
};
FG.money=function(n){ const x=Number(n)||0; return '$'+x.toLocaleString(undefined,{maximumFractionDigits:0}); };
FG.moneyShort=function(n){ const x=Number(n)||0; if(x>=1e6) return '$'+(x/1e6).toFixed(1).replace(/\.0$/,'')+'M'; if(x>=1e4) return '$'+Math.round(x/1e3)+'k'; return FG.money(x); };
FG.emit=function(name, detail){ try{ document.dispatchEvent(new CustomEvent(name, {detail:detail})); }catch(e){} };

/* ---------------- toasts ---------------- */
FG.toast=function(msg, opts){
 opts=opts||{};
 let box=document.getElementById('fgToasts');
 if(!box){ box=document.createElement('div'); box.id='fgToasts'; box.className='fg-toasts'; box.setAttribute('role','status'); box.setAttribute('aria-live','polite'); document.body.appendChild(box); }
 const t=document.createElement('div');
 t.className='fg-toast'+(opts.kind?' '+opts.kind:'');
 t.innerHTML='<span class="fg-toast-msg"></span>'+(opts.action?'<button type="button" class="fg-toast-act"></button>':'')+'<button type="button" class="fg-toast-x" aria-label="Dismiss">'+FG.icon('x')+'</button>';
 t.querySelector('.fg-toast-msg').textContent=msg;
 const close=function(){ t.classList.add('out'); setTimeout(function(){ t.remove(); }, 180); };
 if(opts.action){ const b=t.querySelector('.fg-toast-act'); b.textContent=opts.action.label; b.addEventListener('click', function(){ close(); try{ opts.action.fn(); }catch(e){ console.error(e); } }); }
 t.querySelector('.fg-toast-x').addEventListener('click', close);
 box.appendChild(t);
 while(box.children.length>4) box.firstChild.remove();
 setTimeout(close, opts.timeout||(opts.action?7000:4200));
 return t;
};

/* ---------------- focus trap + modals ---------------- */
const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
FG.focusables=function(root){
 return [...root.querySelectorAll(FOCUSABLE)].filter(function(el){ return el.offsetParent!==null || el.getClientRects().length; });
};
/** Keep Tab / Shift+Tab inside root. Call from a keydown listener. */
FG.trapTab=function(root, e){
 if(e.key!=='Tab') return;
 const f=FG.focusables(root); if(!f.length) return;
 const first=f[0], last=f[f.length-1];
 if(e.shiftKey && (document.activeElement===first || !root.contains(document.activeElement))){ e.preventDefault(); last.focus(); }
 else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
};
const _modals=[];
FG.modalOpen=function(){ return _modals.length>0; };
/**
 * FG.modal({title, body: html|Node, actions:[{label, kind:'p'|'ghost'|'danger', id, onClick(close)->false keeps open}],
 *           size:'sm'|'md'|'lg', onClose(reason), dismissable:true, className})
 * Returns {el, body, close(reason)}.
 */
FG.modal=function(o){
 o=o||{};
 const prev=document.activeElement;
 const bg=document.createElement('div');
 bg.className='fg-modal-bg'+(o.className?' '+o.className:'');
 const tid='fgm_'+FG.uid();
 bg.innerHTML='<div class="fg-modal fg-modal--'+(o.size||'md')+'" role="dialog" aria-modal="true" aria-labelledby="'+tid+'">'+
  '<div class="fg-modal-head"><h2 id="'+tid+'"></h2>'+(o.dismissable===false?'':'<button type="button" class="btn btn--icon btn--ghost fg-modal-x" aria-label="Close">'+FG.icon('x')+'</button>')+'</div>'+
  '<div class="fg-modal-body"></div><div class="fg-modal-foot"></div></div>';
 bg.querySelector('h2').textContent=o.title||'';
 const body=bg.querySelector('.fg-modal-body');
 if(o.body instanceof Node) body.appendChild(o.body); else body.innerHTML=o.body||'';
 const foot=bg.querySelector('.fg-modal-foot');
 let closed=false;
 const api={el:bg, body:body, foot:foot};
 api.close=function(reason){
  if(closed) return; closed=true;
  bg.classList.add('out');
  document.removeEventListener('keydown', onKey, true);
  const i=_modals.indexOf(api); if(i>=0) _modals.splice(i,1);
  setTimeout(function(){ bg.remove(); if(!_modals.length) document.documentElement.classList.remove('fg-modal-open'); }, 140);
  if(prev && prev.isConnected){ try{ prev.focus({preventScroll:true}); }catch(e){} }
  if(o.onClose) try{ o.onClose(reason||'close'); }catch(e){ console.error(e); }
 };
 (o.actions||[]).forEach(function(a){
  const b=document.createElement('button');
  b.type='button';
  b.className='btn'+(a.kind==='p'?' p':a.kind==='ghost'?' ghost':a.kind==='danger'?' danger':a.kind==='o'?' o':'');
  if(a.id) b.id=a.id;
  b.innerHTML=(a.icon?FG.icon(a.icon):'')+h(a.label);
  b.addEventListener('click', function(){
   const r=a.onClick?a.onClick(api, b):undefined;
   if(r===false) return;
   if(r && typeof r.then==='function'){ b.disabled=true; r.then(function(v){ b.disabled=false; if(v!==false) api.close(a.reason||'action'); }, function(){ b.disabled=false; }); return; }
   api.close(a.reason||'action');
  });
  if(a.spacer) { const s=document.createElement('span'); s.className='spacer'; foot.appendChild(s); }
  foot.appendChild(b);
 });
 if(!foot.children.length) foot.remove();
 function onKey(e){
  if(_modals[_modals.length-1]!==api) return;
  if(e.key==='Escape' && o.dismissable!==false){ e.preventDefault(); e.stopPropagation(); api.close('escape'); return; }
  FG.trapTab(bg.querySelector('.fg-modal'), e);
 }
 document.addEventListener('keydown', onKey, true);
 bg.addEventListener('mousedown', function(e){ if(e.target===bg && o.dismissable!==false) api.close('backdrop'); });
 bg.querySelector('.fg-modal-x')?.addEventListener('click', function(){ api.close('x'); });
 document.body.appendChild(bg);
 document.documentElement.classList.add('fg-modal-open');
 _modals.push(api);
 setTimeout(function(){
  const want=o.focus?bg.querySelector(o.focus):null;
  const f=want||bg.querySelector('[autofocus]')||FG.focusables(body)[0]||bg.querySelector('.fg-modal-foot .btn.p')||bg.querySelector('.fg-modal-x');
  f&&f.focus({preventScroll:true});
 }, 0);
 return api;
};
/** Promise<boolean>. Replaces window.confirm in the code F1 touches. */
FG.confirm=function(o){
 return new Promise(function(res){
  let answered=false;
  FG.modal({
   title:o.title||'Are you sure?', size:'sm', className:o.className,
   body:'<p class="fg-confirm-msg">'+(o.html||h(o.message||''))+'</p>',
   actions:[
    {label:o.cancelLabel||'Cancel', kind:'ghost', reason:'cancel', onClick:function(){ answered=true; res(false); }},
    {label:o.confirmLabel||'Confirm', kind:o.danger?'danger':'p', id:o.confirmId, onClick:function(){ answered=true; res(true); }}
   ],
   onClose:function(){ if(!answered) res(false); }
  });
 });
};

/* ---------------- backend capability ---------------- */
FG.server={mode:'unknown', detail:''};
function setMode(m, detail){
 if(FG.server.mode===m) return;
 FG.server.mode=m; FG.server.detail=detail||'';
 document.documentElement.setAttribute('data-leads-mode', m);
 if(typeof syncPillTitle==='function') syncPillTitle();
 FG.emit('fg:mode', {mode:m});
}
FG.setMode=setMode;
/** POST /crm/api/academy-leads. Resolves {ok,status,data}; never throws. 501/503 flip to local mode. */
FG.leadsApi=async function(action, body){
 const tok=getToken();
 if(!tok) return {ok:false, status:0, data:null, offline:true};
 let r;
 try{
  r=await fetch('/crm/api/academy-leads',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify(Object.assign({action:action}, body||{}))});
 }catch(e){ return {ok:false, status:0, data:null, offline:true}; }
 let data=null; try{ data=await r.json(); }catch(e){}
 if((r.status===501 && data && data.error==='postgres_backend_required') || (r.status===503 && data && data.error==='leads_pipeline_not_ready')){
  setMode('local', data.error);
  return {ok:false, status:r.status, data:data, local:true};
 }
 return {ok:r.ok, status:r.status, data:data};
};
let _detecting=null;
/** Probe once per session with tasks_due (cheap, read-only). */
FG.server.detect=function(force){
 if(_detecting && !force) return _detecting;
 if(!getToken()) return Promise.resolve(FG.server.mode);
 _detecting=FG.leadsApi('tasks_due',{}).then(function(res){
  if(res.ok && res.data && Array.isArray(res.data.tasks)){
   setMode('server');
   FG.tasks._server=res.data;
   FG.emit('fg:tasks', res.data);
   if(localStorage.getItem(LS_SINCE)) FG.sync.refresh();
  } else if(!res.local && FG.server.mode==='unknown'){
   // Auth problem, network, or an older API: behave as local, probe again next session.
   setMode('local', res.offline?'offline':('status '+res.status));
  }
  return FG.server.mode;
 });
 return _detecting;
};
FG.isServer=function(){ return FG.server.mode==='server'; };

/* ---------------- sync: incremental refresh, per-lead patch, soft delete ---------------- */
FG.sync={};
function maxUpdated(list){ let m=''; (list||[]).forEach(function(l){ if(l&&l.updated_at&&String(l.updated_at)>m) m=String(l.updated_at); }); return m; }
FG.sync.noteListed=function(data){
 const m=maxUpdated(data&&data.leads);
 if(m){ const cur=localStorage.getItem(LS_SINCE)||''; if(m>cur) localStorage.setItem(LS_SINCE, m); }
};
function persistLocal(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }
FG.sync.persistLocal=persistLocal;
function repaint(){
 try{ render(); }catch(e){ console.error(e); }
 FG.emit('fg:leads-changed');
}
FG.repaint=repaint;
let _refreshing=null;
/** list with since (server mode only). Pages with next_cursor until has_more is false. */
FG.sync.refresh=function(){
 if(!FG.isServer()) return Promise.resolve(false);
 if(_refreshing) return _refreshing;
 _refreshing=(async function(){
  const since=localStorage.getItem(LS_SINCE)||'';
  let cursor=null, pages=0, all=[];
  do{
   const body={limit:500}; if(since) body.since=since; if(cursor) body.cursor=cursor;
   const res=await FG.leadsApi('list', body);
   if(!res.ok||!res.data) return false;
   all=all.concat(res.data.leads||[]);
   cursor=res.data.has_more?res.data.next_cursor:null;
   pages++;
  }while(cursor && pages<40);
  if(!all.length) return true;
  const stats=mergeServerLeads(all);
  state=stripPlaceholderLeads(state);
  FG.sync.noteListed({leads:all});
  persistLocal();
  refreshIndustryFilter(); refreshCityFilter();
  repaint();
  if(profileLeadId!=null){ const o=FG.leadById(profileLeadId); if(o && FG.drawer) FG.drawer.refresh(o); else if(!o) closeProfile(); }
  return stats;
 })().finally(function(){ _refreshing=null; });
 return _refreshing;
};
const VISIBLE_FIELDS=['name','address','city','phone','email','notes','owner','amount','package','status','list_status','stage','next_action','phone_dnc','contact','website'];
/** Copy the server's answer back onto the local lead (keeps our local id). */
function takeServerCopy(l, srv){
 if(!srv) return;
 mergeServerLeads([Object.assign({}, srv)]);
 // mergeServerLeads only takes pipeline fields from a strictly newer copy; force them here
 ['stage','next_action','updated_at','uuid','phone_dnc','phones','stage_changed_at'].forEach(function(f){
  if(f in srv){ if(srv[f]==null) delete l[f]; else l[f]=srv[f]; }
 });
 if(srv.updated_at && String(srv.updated_at)>(localStorage.getItem(LS_SINCE)||'')) localStorage.setItem(LS_SINCE, String(srv.updated_at));
}
FG.sync.takeServerCopy=takeServerCopy;
/**
 * Apply `fields` to the lead now (local first, always), then in server mode send one `patch`
 * with the updated_at we hold. 409: take the server copy, re-apply this edit, resend once.
 * Resolves {ok, local, lead}.
 */
FG.sync.patch=async function(l, fields, opts){
 opts=opts||{};
 const serverPath=FG.isServer() && !!(l.uuid||l.server_id!=null);
 // Send any edit still waiting in the debounced blob push first, so a 409 server copy includes it
 if(serverPath && typeof _leadSyncTimer!=='undefined' && _leadSyncTimer){ clearTimeout(_leadSyncTimer); _leadSyncTimer=null; await pushLeadsToServer(); }
 Object.keys(fields).forEach(function(k){ if(fields[k]===undefined) return; if(fields[k]===null) delete l[k]; else l[k]=fields[k]; });
 persistLocal();
 if(!serverPath){ if(typeof saveLeads==='function' && !opts.noPush) saveLeads(); return {ok:true, local:true, lead:l}; }
 const send=async function(token, confirmClear){
  const body={lead_id:FG.ref(l), patch:fields};
  if(token) body.updated_at=token;
  if(confirmClear) body.confirm_dnc_clear=true;
  return FG.leadsApi('patch', body);
 };
 let res=await send(l.updated_at, opts.confirmDncClear);
 if(res.status===409 && res.data && res.data.lead){
  // Did someone else change something the user can see? (Our own blob push also moves the token.)
  const srv=res.data.lead;
  const changedElsewhere=VISIBLE_FIELDS.some(function(k){ return !(k in fields) && !sameJson(srv[k]==null?null:srv[k], l[k]==null?null:l[k]) && !(srv[k]==null && (l[k]===''||l[k]==null)); });
  takeServerCopy(l, srv);
  Object.keys(fields).forEach(function(k){ if(fields[k]===null) delete l[k]; else l[k]=fields[k]; });
  res=await send(srv.updated_at, opts.confirmDncClear);
  if(!res.ok) FG.toast('This lead changed on another device and your edit could not be saved. Reload the lead and try again.', {kind:'err'});
  else if(changedElsewhere) FG.toast('This lead changed on another device. Loaded the latest copy and re-applied your edit.', {kind:'info'});
  repaint();
 }
 if(res.status===400 && res.data && res.data.error==='dnc_clear_requires_confirmation'){
  const ok=await FG.confirm({title:'Clear the Do Not Call flag?', message:'This number was flagged DNC. Only clear it if a scrub shows it is no longer on the registry.', confirmLabel:'Clear DNC flag', danger:true});
  if(!ok){ l.phone_dnc=true; persistLocal(); repaint(); return {ok:false, lead:l}; }
  return FG.sync.patch(l, fields, Object.assign({}, opts, {confirmDncClear:true}));
 }
 if(res.ok && res.data && res.data.lead){
  takeServerCopy(l, res.data.lead);
  persistLocal();
  return {ok:true, lead:l};
 }
 // Fall back to the blob push so the edit is not stranded in localStorage
 if(typeof saveLeads==='function') saveLeads();
 if(res.local || res.offline) return {ok:true, local:true, lead:l};
 FG.toast('Saved on this device. The server refused the change ('+((res.data&&res.data.error)||res.status)+').', {kind:'err'});
 return {ok:false, lead:l};
};
/** Soft delete on the server (history kept). Local removal is the caller's job. */
FG.sync.remove=async function(l){
 if(!FG.isServer() || !(l&&(l.uuid||l.server_id!=null))) return {ok:true, local:true};
 const res=await FG.leadsApi('delete', {lead_id:FG.ref(l)});
 if(!res.ok && !res.local && !res.offline) FG.toast('Removed here, but the server delete failed. It may come back on the next sync.', {kind:'err'});
 return res;
};
FG.sync.get=async function(l){
 if(!FG.isServer() || !l || !(l.uuid||l.server_id!=null)) return null;
 const res=await FG.leadsApi('get', {lead_id:FG.ref(l), activity_limit:100});
 return res.ok?res.data:null;
};

/* ---------------- stage ---------------- */
const STAGES=['new','contacted','assessment_booked','estimate_sent','won','lost','nurture'];
const STAGE_LABEL={new:'New',contacted:'Contacted',assessment_booked:'Assessment booked',estimate_sent:'Estimate sent',won:'Won',lost:'Lost',nurture:'Nurture'};
const STAGE_TONE={new:'new',contacted:'touched',assessment_booked:'active',estimate_sent:'quoted',won:'won',lost:'lost',nurture:'muted'};
const STATUS_TO_STAGE={'':'new','new':'new','called - no answer':'contacted','callback':'contacted','interested':'contacted','contacted':'contacted','follow_up':'contacted','quoted':'estimate_sent','deposit collected':'won','contract signed':'won','closed':'won','won':'won','not interested':'lost','do not contact':'lost','lost':'lost','archived':'nurture','nurture':'nurture'};
const PROGRESS={new:0,contacted:1,estimate_sent:2,won:3};
FG.STAGES=STAGES; FG.STAGE_LABEL=STAGE_LABEL;
FG.stageFromStatus=function(status){
 const s=String(status==null?'':status).trim().toLowerCase();
 if(Object.prototype.hasOwnProperty.call(STATUS_TO_STAGE, s)) return STATUS_TO_STAGE[s];
 if(/^called\b/.test(s)) return 'contacted';
 return 'new';
};
FG.normStage=function(v){ const s=String(v==null?'':v).trim().toLowerCase().replace(/[\s-]+/g,'_'); return STAGES.indexOf(s)>=0?s:null; };
/** Same rule as server/lib/leads-core.js deriveStage. */
FG.deriveStage=function(l){
 const per=l&&l.list_status&&typeof l.list_status==='object'&&!Array.isArray(l.list_status)?Object.values(l.list_status).filter(function(x){ return x!=null&&x!==''; }):[];
 const stages=[FG.stageFromStatus(l&&l.status)].concat(per.map(FG.stageFromStatus));
 let best=null;
 stages.forEach(function(s){ if(s in PROGRESS && PROGRESS[s]>0 && (best==null||PROGRESS[s]>PROGRESS[best])) best=s; });
 if(best) return best;
 const primary=FG.stageFromStatus(l&&l.status);
 if(primary==='lost'||primary==='nurture') return primary;
 const cs=per.map(FG.stageFromStatus);
 if(cs.length && cs.every(function(s){ return s==='lost'||s==='nurture'; })) return cs.indexOf('lost')>=0?'lost':'nurture';
 return 'new';
};
FG.stageOf=function(l){ return FG.normStage(l&&l.stage)||FG.deriveStage(l||{}); };
FG.stageChip=function(stage, extra){ return '<span class="stage-chip" data-st="'+STAGE_TONE[stage]+'"'+(extra||'')+'>'+h(STAGE_LABEL[stage]||stage)+'</span>'; };
FG.stageTone=function(stage){ return STAGE_TONE[stage]||'new'; };
/** Called by setListStatus (06-leads.js) after a per-cause status moved: mirror the server's re-derive. */
FG.onStatusChange=function(l, prevDerived, prevStage){
 const next=FG.deriveStage(l);
 if(l.stage && next!==prevDerived) l.stage=next; // explicit stage follows a moved legacy status (server does the same)
 if(prevStage && FG.stageOf(l)!==prevStage) l.stage_changed_at=new Date().toISOString();
};
/** Status written to the active cause when a stage is set explicitly (only unambiguous ones). */
const STAGE_TO_STATUS={new:'New',estimate_sent:'Quoted',won:'Contract signed',lost:'Not interested',nurture:'Archived'};
FG.daysInStage=function(l){
 const t=l.stage_changed_at;
 if(!t) return null;
 const d=new Date(t); if(isNaN(d)) return null;
 return Math.max(0, Math.floor((Date.now()-d.getTime())/86400000));
};
/**
 * Move a lead to a stage. Won/Lost open the close-out modal first (label stream for
 * lead_outcomes); cancelling it leaves the lead where it was. Resolves true when moved.
 */
FG.setStage=async function(l, stage, opts){
 opts=opts||{};
 stage=FG.normStage(stage); if(!l||!stage) return false;
 const from=FG.stageOf(l);
 if(from===stage) return false;
 let closeout=null;
 if((stage==='won'||stage==='lost') && !opts.skipCloseout){
  closeout=await FG.closeout.open(l, stage);
  if(!closeout) return false;
 }
 const fields={stage:stage, stage_changed_at:new Date().toISOString()};
 const cause=activeCause(l);
 const st=(closeout&&closeout.status)||STAGE_TO_STATUS[stage];
 if(st && getListStatus(l, cause)!==st && !(stage==='lost' && getListStatus(l, cause)==='Do not contact')){
  setListStatus(l, cause, st);
  fields.list_status=Object.assign({}, l.list_status);
  fields.status=l.status;
 }
 if(closeout){
  if(closeout.amount!=null && closeout.amount!==''){ fields.amount=closeout.amount; }
  if(closeout.package){ fields.package=closeout.package; }
 }
 if(!FG.isServer()){
  appendActivity({lead_id:l.id, lead_key:leadKeyOf(l), type:'stage_change', outcome:stage, detail:{text:'Stage: '+STAGE_LABEL[from]+' → '+STAGE_LABEL[stage], from:from, to:stage, via:opts.via||'ui'}});
 }
 await FG.sync.patch(l, fields);
 repaint();
 if(!opts.quiet) FG.toast(l.name+' moved to '+STAGE_LABEL[stage]+'.', {kind:'ok', action:opts.undo===false?null:{label:'Undo', fn:function(){ FG.setStage(l, from, {skipCloseout:true, undo:false, via:'undo'}); }}});
 return true;
};

/* ---------------- phones / DNC ---------------- */
FG.phone={};
const LINE_LABEL={mobile:'Mobile', landline:'Landline', voip:'VoIP', unknown:'Line unknown'};
const SOURCE_LABEL={batchdata:'BatchData', trestle:'Trestle', web:'Website', search:'Web search', manual:'Manual', google_voice:'Google Voice'};
FG.phone.digits=function(n){ return phoneDigitsKey(n); };
/** All numbers on a lead, primary first. Folds the scalar phone_* fields into the primary entry. */
FG.phone.list=function(l){
 if(!l) return [];
 const out=[]; const seen={};
 const primaryKey=FG.phone.digits(l.phone);
 (Array.isArray(l.phones)?l.phones:[]).forEach(function(p){
  if(!p||!p.number) return; const k=FG.phone.digits(p.number); if(!k||seen[k]) return; seen[k]=1;
  out.push(Object.assign({}, p, {primary:k===primaryKey}));
 });
 if(primaryKey){
  let e=out.find(function(p){ return FG.phone.digits(p.number)===primaryKey; });
  if(!e){ e={number:l.phone, line_type:l.phone_line_type||'unknown', dnc:null, litigator:null, source:l.phone_source||'', confidence:l.phone_confidence==null?null:l.phone_confidence, primary:true}; out.unshift(e); }
  else { out.splice(out.indexOf(e),1); out.unshift(e); }
  if(l.phone_dnc===true) e.dnc=true; else if(e.dnc==null && l.phone_dnc===false) e.dnc=false;
  if(!e.line_type||e.line_type==='unknown') e.line_type=l.phone_line_type||e.line_type||'unknown';
  if(!e.source && l.phone_source) e.source=l.phone_source;
  if(e.confidence==null && l.phone_confidence!=null) e.confidence=l.phone_confidence;
  e.number=l.phone;
 }
 return out;
};
FG.phone.leadBlocked=function(l){
 const lists=leadLists(l);
 const dnc=lists.some(function(c){ return getListStatus(l,c)==='Do not contact'; }) || l.status==='Do not contact';
 return dnc?'This lead is marked "Do not contact".':'';
};
/** {blocked, reason, scrub:'dnc'|'scrubbed'|'unscrubbed', litigator, wrong} */
FG.phone.state=function(p, l){
 const s={blocked:false, reason:'', scrub:p.dnc===true?'dnc':p.dnc===false?'scrubbed':'unscrubbed', litigator:p.litigator===true, wrong:p.wrong===true};
 if(p.dnc===true){ s.blocked=true; s.reason='On the Do Not Call registry. Calling or texting it is blocked.'; }
 else if(p.litigator===true){ s.blocked=true; s.reason='Flagged as a known TCPA litigator. Calling or texting it is blocked.'; }
 else if(p.wrong){ s.blocked=true; s.reason='Marked as a wrong number.'; }
 const lb=l?FG.phone.leadBlocked(l):'';
 if(lb && !s.blocked){ s.blocked=true; s.reason=lb; }
 return s;
};
FG.phone.primary=function(l){ const list=FG.phone.list(l); return list[0]||null; };
/** Best number to dial: primary unless blocked, else the first unblocked one. */
FG.phone.best=function(l){
 const list=FG.phone.list(l);
 return list.find(function(p){ return !FG.phone.state(p,l).blocked; })||null;
};
FG.phone.hasDialable=function(l){ return !!FG.phone.best(l); };
FG.phone.anyDnc=function(l){ return l.phone_dnc===true || FG.phone.list(l).some(function(p){ return p.dnc===true||p.litigator===true; }); };
FG.phone.chips=function(p, l, opts){
 opts=opts||{};
 const st=FG.phone.state(p, l);
 const out=[];
 const lt=String(p.line_type||'unknown').toLowerCase();
 out.push('<span class="ph-chip lt-'+h(lt)+'" title="Line type">'+h(LINE_LABEL[lt]||lt)+'</span>');
 if(st.scrub==='dnc') out.push('<span class="ph-chip bad" title="On the Do Not Call registry">'+FG.icon('ban')+'DNC</span>');
 else if(st.scrub==='scrubbed') out.push('<span class="ph-chip ok" title="Checked against the DNC registry: not listed">Scrubbed</span>');
 else out.push('<span class="ph-chip warn" title="Not checked against the DNC registry. Scrub before dialing.">Not scrubbed</span>');
 if(st.litigator) out.push('<span class="ph-chip bad" title="Known TCPA litigator">Litigator</span>');
 if(st.wrong) out.push('<span class="ph-chip bad">Wrong #</span>');
 if(opts.full){
  if(p.source) out.push('<span class="ph-chip" title="Where this number came from">'+h(SOURCE_LABEL[p.source]||p.source)+'</span>');
  if(p.confidence!=null && p.confidence!=='') out.push('<span class="ph-chip num" title="Confidence the number reaches this owner">'+Math.round(Number(p.confidence)*100)+'%</span>');
  if(p.name_match==='match') out.push('<span class="ph-chip ok" title="Carrier name matches the owner">Name match</span>');
  else if(p.name_match==='partial') out.push('<span class="ph-chip" title="Carrier name partly matches the owner">Partial match</span>');
  else if(p.name_match==='mismatch') out.push('<span class="ph-chip bad" title="Carrier name does not match the owner">Name mismatch</span>');
 }
 return out.join('');
};

/* ---------------- dial guard + outcome logger ---------------- */
FG.dial={};
FG.dial.findEntry=function(l, number){
 const k=FG.phone.digits(number);
 return FG.phone.list(l).find(function(p){ return FG.phone.digits(p.number)===k; })||{number:number, line_type:'unknown', dnc:null, litigator:null, source:'manual'};
};
/** Modal for a blocked number. Suggests mail / door hanger as the next step. */
FG.dial.explainBlocked=function(l, p, kind){
 const st=FG.phone.state(p, l);
 FG.modal({
  title:(kind==='text'?'Texting':'Calling')+' this number is blocked', size:'sm', className:'fg-blocked',
  body:'<div class="fg-blocked-num">'+FG.icon('phone-off')+'<b>'+h(p.number)+'</b></div><p>'+h(st.reason)+'</p>'+
   '<p class="hint">Suggested next step: <b>send mail or leave a door hanger</b> at '+h(l.address||'the site address')+'.</p>',
  actions:[
   {label:'Close', kind:'ghost'},
   {label:'Plan mail / door hanger', kind:'p', icon:'house', onClick:function(){
    FG.tasks.setNext(l, {type:'visit', due_at:FG.at(1,10), note:'Send mailer / door hanger (phone is '+(st.scrub==='dnc'?'DNC':'blocked')+')'});
    FG.toast('Next action set: mail / door hanger tomorrow.', {kind:'ok'});
   }}
  ]
 });
};
/**
 * The only path from the UI to tel:/sms:. Never dials by itself: always the user's click.
 * Blocked (DNC/litigator/do-not-contact) numbers stop here; not-scrubbed numbers ask first.
 */
FG.dial.start=async function(l, number, kind){
 kind=kind==='text'||kind==='sms'?'text':'call';
 number=String(number||'').trim();
 if(!l) return false;
 if(!number){ FG.toast('Add a phone number first.', {kind:'err'}); return false; }
 const p=FG.dial.findEntry(l, number);
 const st=FG.phone.state(p, l);
 if(st.blocked){ FG.dial.explainBlocked(l, p, kind); return false; }
 if(st.scrub==='unscrubbed'){
  const ok=await FG.confirm({title:'Not scrubbed against DNC', className:'fg-dnc-warn', html:'<b>'+h(number)+'</b> has not been checked against the Do Not Call registry. Scrub it before you '+(kind==='text'?'text':'dial')+'.<br><span class="hint">Continue only if you have scrubbed it yourself or have the owner\'s consent.</span>', confirmLabel:kind==='text'?'Text anyway':'Call anyway', confirmId:'fgDialAnyway'});
  if(!ok) return false;
 }
 const dig=normalizeDial(number);
 if(!dig){ FG.toast('That number does not look dialable.', {kind:'err'}); return false; }
 if(kind==='call') launchUri('tel:'+dig);
 else {
  const cat=categoryKey(activeCause(l));
  launchUri(typeof smsTemplate==='function'?smsTemplate(l, cat, number):'sms:'+dig);
 }
 FG.emit('fg:dialed', {lead:l, number:number, kind:kind});
 setTimeout(function(){ FG.outcome.open(l, number, kind); }, 250);
 return true;
};
FG.outcome={};
const OUTCOMES=[
 {id:'no_answer', label:'No answer', icon:'phone-off'},
 {id:'left_vm', label:'Left voicemail', icon:'message-square'},
 {id:'talked', label:'Talked', icon:'phone'},
 {id:'booked', label:'Booked assessment', icon:'calendar-clock'},
 {id:'wrong_number', label:'Wrong number', icon:'ban'},
 {id:'dnc_request', label:'Asked not to call', icon:'ban'}
];
FG.OUTCOMES=OUTCOMES;
function suggestFor(outcome, kind){
 if(outcome==='no_answer') return {type:kind==='text'?'call':'text', due_at:FG.at(1,10), note:kind==='text'?'Call: no reply to text':'Text follow-up: no answer'};
 if(outcome==='left_vm') return {type:'call', due_at:FG.at(2,16), note:'Call back after voicemail'};
 if(outcome==='talked') return {type:'call', due_at:FG.at(3,10), note:'Follow up on conversation'};
 if(outcome==='booked') return {type:'visit', due_at:FG.at(1,10), note:'Site assessment'};
 if(outcome==='wrong_number') return {type:'other', due_at:FG.at(0,17), note:'Find a better number (enrich again)'};
 if(outcome==='dnc_request') return {type:'visit', due_at:FG.at(1,10), note:'Mailer / door hanger only (asked not to call)'};
 return null;
}
FG.outcome.suggest=suggestFor;
/** Quick outcome logger after a click-to-call/text; then suggests the next action. */
FG.outcome.open=function(l, number, kind){
 let logged=false;
 const body=document.createElement('div');
 body.innerHTML='<p class="hint">'+(kind==='text'?'Texted ':'Called ')+'<b>'+h(number)+'</b>. How did it go?</p>'+
  '<div class="fg-outcomes" role="group" aria-label="Outcome">'+OUTCOMES.map(function(o){
   return '<button type="button" class="fg-outcome'+(o.id==='dnc_request'?' danger':'')+'" data-outcome="'+o.id+'">'+FG.icon(o.icon)+'<span>'+h(o.label)+'</span></button>';
  }).join('')+'</div>'+
  '<label class="fg-lbl" for="fgOutNote">Note (optional)</label><input id="fgOutNote" type="text" placeholder="What happened?">'+
  '<div class="fg-next" hidden></div>';
 const m=FG.modal({title:'Log '+(kind==='text'?'text':'call')+' · '+(l.name||'lead'), body:body, size:'md', className:'fg-outcome-modal',
  actions:[{label:'Skip', kind:'ghost', reason:'skip'}],
  onClose:function(){ if(!logged) FG.activity.log(l, {type:kind==='text'?'text':'call', direction:'outbound', outcome:'attempted', body:(kind==='text'?'Texted ':'Called ')+number, meta:{number:number}}); }
 });
 body.querySelector('.fg-outcomes').addEventListener('click', async function(e){
  const b=e.target.closest('[data-outcome]'); if(!b) return;
  const out=b.getAttribute('data-outcome');
  const note=(body.querySelector('#fgOutNote').value||'').trim();
  if(out==='dnc_request'){
   const ok=await FG.confirm({title:'Mark '+number+' as Do Not Call?', message:'Calling and texting this number will be blocked in the CRM for everyone. This cannot be undone without a confirmed DNC scrub.', confirmLabel:'Mark Do Not Call', danger:true, confirmId:'fgConfirmDnc'});
   if(!ok) return;
   await FG.phone.markDnc(l, number);
  }
  logged=true;
  body.querySelectorAll('.fg-outcome').forEach(function(x){ x.classList.toggle('on', x===b); x.disabled=true; });
  const label=OUTCOMES.find(function(o){ return o.id===out; }).label;
  FG.activity.log(l, {type:kind==='text'?'text':'call', direction:'outbound', outcome:out, body:label+(note?' · '+note:''), meta:{number:number}});
  await FG.outcome.applyEffects(l, out, number);
  const sug=suggestFor(out, kind);
  const nx=body.querySelector('.fg-next');
  nx.hidden=false;
  nx.innerHTML='<h3>Next action</h3>'+FG.tasks.editorHtml(sug||{type:'call', due_at:FG.at(1,10), note:''}, 'fgOut')+
   '<div class="btn-row mt-2"><button type="button" class="btn p" id="fgOutSaveNext">'+FG.icon('calendar-clock')+'Save next action</button><button type="button" class="btn ghost" id="fgOutNoNext">No next action</button></div>';
  nx.querySelector('#fgOutSaveNext').addEventListener('click', async function(){
   const na=FG.tasks.readEditor(nx, 'fgOut'); if(!na) return;
   await FG.tasks.setNext(l, na);
   FG.toast('Logged '+label.toLowerCase()+' · next: '+na.type+' '+FG.fmtDue(na.due_at)+'.', {kind:'ok'});
   m.close('done');
  });
  nx.querySelector('#fgOutNoNext').addEventListener('click', function(){ FG.toast('Logged: '+label+'.', {kind:'ok'}); m.close('done'); });
  setTimeout(function(){ nx.querySelector('#fgOutSaveNext').focus(); }, 0);
 });
};
/** Status/stage side effects of an outcome (kept conservative; per-cause status stays the record). */
FG.outcome.applyEffects=async function(l, out, number){
 const cause=activeCause(l);
 const cur=getListStatus(l, cause)||'New';
 if((out==='no_answer'||out==='left_vm') && (cur==='New'||cur==='')){ setListStatus(l, cause, 'Called - no answer'); }
 else if(out==='talked' && (cur==='New'||cur==='Called - no answer'||cur==='')){ setListStatus(l, cause, 'Callback'); }
 if(out==='booked'){ await FG.setStage(l, 'assessment_booked', {quiet:true, via:'outcome'}); return; }
 if(out==='wrong_number' && number){
  const k=FG.phone.digits(number);
  const phones=FG.phone.list(l).map(function(p){ const c=Object.assign({},p); delete c.primary; if(FG.phone.digits(p.number)===k) c.wrong=true; return c; });
  await FG.sync.patch(l, {phones:phones});
  repaint(); return;
 }
 if(cur!==getListStatus(l, cause)){
  await FG.sync.patch(l, {list_status:Object.assign({}, l.list_status), status:l.status});
 }
 repaint();
};
/** Sticky DNC on one number (and on the lead when it is the primary). */
FG.phone.markDnc=async function(l, number){
 const k=FG.phone.digits(number);
 const phones=FG.phone.list(l).map(function(p){ const c=Object.assign({},p); delete c.primary; if(FG.phone.digits(p.number)===k) c.dnc=true; return c; });
 if(!phones.some(function(p){ return FG.phone.digits(p.number)===k; })) phones.push({number:number, line_type:'unknown', dnc:true, litigator:null, source:'manual', confidence:null, found_at:new Date().toISOString()});
 const fields={phones:phones};
 if(FG.phone.digits(l.phone)===k) fields.phone_dnc=true;
 await FG.sync.patch(l, fields);
 FG.activity.log(l, {type:'note', body:'Marked '+number+' Do Not Call', meta:{number:number, dnc:true}});
 repaint();
 if(FG.drawer) FG.drawer.refreshIfOpen(l);
};

/* ---------------- activity ---------------- */
FG.activity={};
const TO_SERVER_TYPE={call:'call', sms:'text', text:'text', email:'email', note:'note', status:'note', list_change:'note', enrich:'enrich', visit:'visit', system:'system'};
/** Log one activity: local log always (02-crm-core appendActivity), server via the mirror below. */
FG.activity.log=function(l, a){
 const type=a.type==='text'?'sms':a.type;
 return appendActivity({lead_id:l.id, lead_key:leadKeyOf(l), type:type, outcome:a.outcome||'', detail:Object.assign({text:a.body||''}, a.meta||{}, a.direction?{direction:a.direction}:{})}).then(function(row){
  FG.emit('fg:activity', {lead:l, row:row});
  return row;
 });
};
/** Called by appendActivity (02-crm-core.js) for every local row: mirror to activity_add in server mode. */
FG.activity.mirror=function(row){
 if(!FG.isServer() || !row) return;
 if(row.type==='stage_change') return; // the server writes stage changes itself (patch / push)
 const l=row.lead_id!=null?FG.leadById(row.lead_id):null;
 if(!l || !(l.uuid||l.server_id!=null)) return;
 const type=TO_SERVER_TYPE[row.type]||'note';
 const det=row.detail&&typeof row.detail==='object'?row.detail:{text:String(row.detail||'')};
 const body={lead_id:FG.ref(l), type:type, body:String(det.text||''), meta:Object.assign({client_id:row.id, local_type:row.type}, det), at:row.at};
 if(row.outcome) body.outcome=String(row.outcome);
 if(det.direction==='inbound'||det.direction==='outbound') body.direction=det.direction;
 else if(type==='call'||type==='text'||type==='email') body.direction='outbound';
 delete body.meta.text; delete body.meta.direction;
 FG.leadsApi('activity_add', body).then(function(res){ if(res.ok) FG.emit('fg:activity-synced', {lead:l}); });
};
function normLocal(a){
 const det=typeof a.detail==='string'?{text:a.detail}:(a.detail||{});
 return {id:a.id, at:a.at, type:a.type==='sms'?'text':a.type==='status'?'stage_change':a.type, outcome:a.outcome||'', body:det.text||'', actor:a.user||'', direction:det.direction||'', meta:det, source:'local'};
}
function normServer(a){
 const meta=a.meta||{};
 return {id:a.id, client_id:meta.client_id, at:a.at, type:meta.local_type==='status'?'stage_change':a.type, outcome:a.outcome||'', body:a.body||'', actor:a.actor||'', direction:a.direction||'', meta:meta, source:'server'};
}
FG.activity.local=function(l){
 const key=leadKeyOf(l);
 return loadActivities().filter(function(a){
  if(a.lead_id!=null && l.id!=null) return String(a.lead_id)===String(l.id);
  return String(a.lead_key||'').toLowerCase()===key;
 }).map(normLocal);
};
/** Merged timeline, newest first: server rows (server mode) + local rows not yet mirrored. */
FG.activity.list=async function(l, opts){
 const loc=FG.activity.local(l);
 let srv=[];
 if(FG.isServer() && (l.uuid||l.server_id!=null) && !(opts&&opts.localOnly)){
  const res=await FG.leadsApi('activity_list', {lead_id:FG.ref(l), limit:100});
  if(res.ok && res.data && Array.isArray(res.data.activity)) srv=res.data.activity.map(normServer);
 }
 const seen={}; srv.forEach(function(a){ if(a.client_id) seen[a.client_id]=1; });
 return srv.concat(loc.filter(function(a){ return !seen[a.id]; })).sort(function(a,b){ return String(b.at).localeCompare(String(a.at)); });
};

/* ---------------- next actions / tasks ---------------- */
FG.tasks={_server:null};
const TASK_TYPES=['call','text','email','visit','other'];
const TASK_LABEL={call:'Call', text:'Text', email:'Email', visit:'Visit', other:'To-do'};
const TASK_ICON={call:'phone', text:'message-square', email:'mail', visit:'house', other:'list-todo'};
FG.TASK_TYPES=TASK_TYPES; FG.TASK_LABEL=TASK_LABEL; FG.TASK_ICON=TASK_ICON;
FG.tasks.of=function(l){
 const na=l&&l.next_action;
 if(na && na.due_at) return {type:TASK_TYPES.indexOf(na.type)>=0?na.type:'other', due_at:na.due_at, note:na.note||'', task_id:na.task_id||null};
 if(l && l.next_follow_up_at){
  const d=new Date(l.next_follow_up_at);
  if(!isNaN(d)) return {type:'call', due_at:d.toISOString(), note:'Follow-up', legacy:true};
 }
 return null;
};
FG.tasks.chip=function(l){
 const t=FG.tasks.of(l); if(!t) return '';
 const b=FG.dueBucket(t.due_at);
 return '<span class="na-chip'+(b?' '+b:'')+'" title="'+h(TASK_LABEL[t.type]+(t.note?' · '+t.note:''))+'">'+FG.icon(TASK_ICON[t.type])+h(TASK_LABEL[t.type])+' · '+h(FG.fmtDue(t.due_at))+'</span>';
};
/** Overdue + due-today items: tasks_due on the server, computed from state otherwise. */
FG.tasks.due=function(){
 const end=endOfDay();
 const items=[];
 const seen={};
 if(FG.isServer() && FG.tasks._server && Array.isArray(FG.tasks._server.tasks)){
  FG.tasks._server.tasks.forEach(function(t){
   const l=FG.leadByRef(t.lead_id);
   if(l) seen[l.id]=1;
   items.push({key:'s:'+t.id, task_id:t.id, lead:l, lead_name:(l&&l.name)||t.lead_name||'Lead', type:t.type, due_at:t.due_at, note:t.note||'', bucket:t.bucket||FG.dueBucket(t.due_at), phone_dnc:t.lead_phone_dnc===true, is_next_action:!!t.is_next_action});
  });
 }
 state.forEach(function(l){
  if(seen[l.id]) return;
  const t=FG.tasks.of(l); if(!t) return;
  const d=new Date(t.due_at); if(isNaN(d)||d>end) return;
  if(FG.isServer() && FG.tasks._server && t.task_id) return; // server already answered for this task
  items.push({key:'l:'+l.id, task_id:t.task_id||null, lead:l, lead_name:l.name||'(unnamed)', type:t.type, due_at:t.due_at, note:t.note, bucket:FG.dueBucket(t.due_at), legacy:!!t.legacy, phone_dnc:l.phone_dnc===true});
 });
 items.sort(function(a,b){ return String(a.due_at).localeCompare(String(b.due_at)); });
 return items;
};
FG.tasks.reload=async function(){
 if(!FG.isServer()) { FG.emit('fg:tasks', null); return; }
 const res=await FG.leadsApi('tasks_due', {});
 if(res.ok && res.data){ FG.tasks._server=res.data; FG.emit('fg:tasks', res.data); }
};
/** Set (or clear with null) the lead's next action. Server keeps one open task in sync. */
FG.tasks.setNext=async function(l, na){
 const val=na?{type:na.type, due_at:na.due_at, note:na.note||''}:null;
 const fields={next_action:val};
 const r=await FG.sync.patch(l, fields);
 repaint();
 FG.tasks.reload();
 if(FG.drawer) FG.drawer.refreshIfOpen(l);
 return r;
};
FG.tasks.complete=async function(item){
 const l=item.lead;
 if(FG.isServer() && item.task_id){
  const res=await FG.leadsApi('task_done', {task_id:item.task_id});
  if(res.ok && res.data && res.data.lead && l){ takeServerCopy(l, res.data.lead); persistLocal(); }
  else if(l){ await FG.sync.patch(l, {next_action:null}); }
 } else if(l){
  if(item.legacy){ l.next_follow_up_at=''; saveLeads(); }
  else await FG.sync.patch(l, {next_action:null});
  FG.activity.log(l, {type:'note', body:'Done: '+(TASK_LABEL[item.type]||'Task')+(item.note?' · '+item.note:'')});
 }
 repaint();
 await FG.tasks.reload();
 if(l && FG.drawer) FG.drawer.refreshIfOpen(l);
 FG.toast('Done: '+(TASK_LABEL[item.type]||'Task')+' · '+(item.lead_name||''), {kind:'ok'});
};
FG.tasks.snooze=async function(item, preset){
 const l=item.lead; if(!l) return;
 let due;
 if(preset==='1h') due=new Date(Date.now()+3600000).toISOString();
 else if(preset==='3d') due=FG.at(3,9);
 else if(preset==='1w') due=FG.at(7,9);
 else due=FG.at(1,9);
 if(item.legacy){ l.next_follow_up_at=due; saveLeads(); repaint(); FG.toast('Snoozed to '+FG.fmtDue(due)+'.', {kind:'ok'}); return; }
 await FG.tasks.setNext(l, {type:item.type, due_at:due, note:item.note});
 FG.toast('Snoozed to '+FG.fmtDue(due)+'.', {kind:'ok'});
};
/** Inline editor markup (type, due, note). prefix keeps ids unique per host. */
FG.tasks.editorHtml=function(na, prefix){
 na=na||{};
 return '<div class="na-editor">'+
  '<div><label class="fg-lbl" for="'+prefix+'Type">Type</label><select id="'+prefix+'Type">'+TASK_TYPES.map(function(t){ return '<option value="'+t+'"'+(na.type===t?' selected':'')+'>'+TASK_LABEL[t]+'</option>'; }).join('')+'</select></div>'+
  '<div><label class="fg-lbl" for="'+prefix+'Due">Due</label><input id="'+prefix+'Due" type="datetime-local" value="'+h(FG.toLocalInput(na.due_at))+'"></div>'+
  '<div class="na-note"><label class="fg-lbl" for="'+prefix+'Note">Note</label><input id="'+prefix+'Note" type="text" value="'+h(na.note||'')+'" placeholder="e.g. ask about the side yard"></div>'+
  '</div>';
};
FG.tasks.readEditor=function(root, prefix){
 const type=root.querySelector('#'+prefix+'Type').value;
 const due=FG.fromLocalInput(root.querySelector('#'+prefix+'Due').value);
 if(!due){ FG.toast('Pick a due date and time.', {kind:'err'}); root.querySelector('#'+prefix+'Due').focus(); return null; }
 return {type:type, due_at:due, note:(root.querySelector('#'+prefix+'Note').value||'').trim()};
};

/* ---------------- close-out (Won / Lost) -> lead_outcomes ---------------- */
FG.closeout={};
const WATER_WHERE=[['yard','Yard'],['crawlspace','Crawlspace'],['slab_edge','Slab edge'],['driveway','Driveway'],['patio','Patio'],['garage','Garage'],['pool_deck','Pool deck'],['street_side','Street side'],['other','Other']];
FG.closeout.leadKey=function(l){ return l.uuid || (leadKeyOf(l)+'|'+normAddrKey(l.address)); };
/** Resolves {status, amount, package, ...} or null when cancelled. */
FG.closeout.open=function(l, stage){
 return new Promise(function(res){
  const won=stage==='won';
  let done=false;
  const body=document.createElement('div');
  body.innerHTML='<p class="hint">'+(won?'Close this lead as <b>won</b>.':'Close this lead as <b>lost</b>.')+' The result feeds the flood-score calibration (lead outcomes), so record what you actually saw on site.</p>'+
   '<div class="grid-2 mt-2">'+
   (won
    ? '<div><label class="fg-lbl" for="coStatus">Result</label><select id="coStatus"><option>Contract signed</option><option>Deposit collected</option></select></div>'+
      '<div><label class="fg-lbl" for="coAmount">Amount ($)</label><input id="coAmount" type="number" min="0" step="1" class="num" value="'+h(l.amount||'')+'"></div>'+
      '<div><label class="fg-lbl" for="coPackage">Package</label><input id="coPackage" type="text" value="'+h(l.package||'')+'" placeholder="e.g. French drain 60 ft"></div>'
    : '<div><label class="fg-lbl" for="coStatus">Result</label><select id="coStatus"><option>Not interested</option><option>Do not contact</option></select></div>'+
      '<div><label class="fg-lbl" for="coReason">Reason</label><select id="coReason"><option value="">Pick one…</option><option>Price</option><option>No water problem</option><option>Went with another company</option><option>DIY</option><option>Not the owner / renter</option><option>No response</option><option>Other</option></select></div>')+
   '<div><label class="fg-lbl" for="coAssessed">Assessed on</label><input id="coAssessed" type="date"></div>'+
   '<div><label class="fg-lbl" for="coWater">Standing water confirmed?</label><select id="coWater"><option value="">Not checked</option><option value="true">Yes</option><option value="false">No</option></select></div>'+
   '</div>'+
   '<fieldset class="co-where"><legend class="fg-lbl">Where was the water?</legend><div class="co-where-grid">'+WATER_WHERE.map(function(w){ return '<label class="co-chk"><input type="checkbox" value="'+w[0]+'">'+w[1]+'</label>'; }).join('')+'</div></fieldset>'+
   '<label class="fg-lbl" for="coNotes">Notes</label><textarea id="coNotes" rows="2" placeholder="Anything the model should know"></textarea>';
  FG.modal({
   title:(won?'Mark won · ':'Mark lost · ')+(l.name||'lead'), body:body, size:'md', className:'fg-closeout',
   actions:[
    {label:'Cancel', kind:'ghost', reason:'cancel'},
    {label:won?'Mark won':'Mark lost', kind:won?'p':'danger', id:'coSave', onClick:function(){
     const v=function(id){ const el=body.querySelector('#'+id); return el?el.value:''; };
     const water=v('coWater');
     const out={
      status:v('coStatus'),
      amount:won&&v('coAmount')!==''?Number(v('coAmount')):(won?null:undefined),
      package:won?v('coPackage').trim():'',
      lost_reason:won?'':v('coReason'),
      water_confirmed:water===''?null:water==='true',
      water_where:[...body.querySelectorAll('.co-where input:checked')].map(function(x){ return x.value; }),
      assessed_at:v('coAssessed')||null,
      notes:v('coNotes').trim()
     };
     done=true;
     FG.closeout.record(l, won?'won':'lost', out);
     res(out);
    }}
   ],
   onClose:function(){ if(!done) res(null); }
  });
 });
};
FG.closeout.record=async function(l, outcome, o){
 const payload={action:'record', lead_key:FG.closeout.leadKey(l), lead_id:String(l.uuid||l.id), outcome:outcome,
  parcel_id:l.parcel_id||undefined, address:l.address||undefined, city:l.city||undefined, zip:l.zip||undefined,
  amount:o.amount==null?undefined:o.amount, package:o.package||undefined, lost_reason:o.lost_reason||undefined,
  water_confirmed:o.water_confirmed, water_where:o.water_where, assessed_at:o.assessed_at||undefined, notes:o.notes||undefined};
 const ok=await sendOutcome(payload);
 if(!ok){ queueOutcome(payload); FG.toast('Outcome saved on this device; it will be sent when the server is reachable.', {kind:'info'}); }
 return ok;
};
async function sendOutcome(payload){
 const tok=getToken(); if(!tok) return false;
 try{
  const r=await fetch('/crm/api/lead-outcomes',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify(payload)});
  return r.ok;
 }catch(e){ return false; }
}
function queueOutcome(p){ try{ const q=JSON.parse(localStorage.getItem(LS_OUTQ)||'[]'); q.push(p); localStorage.setItem(LS_OUTQ, JSON.stringify(q.slice(-200))); }catch(e){} }
FG.closeout.flush=async function(){
 let q=[]; try{ q=JSON.parse(localStorage.getItem(LS_OUTQ)||'[]'); }catch(e){}
 if(!q.length) return 0;
 const left=[];
 for(const p of q){ if(!(await sendOutcome(p))) left.push(p); }
 localStorage.setItem(LS_OUTQ, JSON.stringify(left));
 return q.length-left.length;
};

/* ---------------- lead drawer extension hook (for other agents) ----------------
 * FG.leadDrawer.addAction({id, label, icon, onClick(lead), title?, kind?: 'p'|'o'|''})
 * Adds a button to the lead drawer's action bar (re-rendered on every open). Idempotent by id. */
FG.leadDrawer={_actions:[]};
FG.leadDrawer.addAction=function(a){
 if(!a||!a.id||typeof a.onClick!=='function') throw new Error('addAction needs {id, label, onClick}');
 FG.leadDrawer._actions=FG.leadDrawer._actions.filter(function(x){ return x.id!==a.id; }).concat([a]);
 if(FG.drawer && profileLeadId!=null) FG.drawer.paintExt(FG.leadById(profileLeadId));
};
FG.leadDrawer.removeAction=function(id){ FG.leadDrawer._actions=FG.leadDrawer._actions.filter(function(x){ return x.id!==id; }); };
FG.leadDrawer.current=function(){ return profileLeadId!=null?FG.leadById(profileLeadId):null; };

FG.ready=true;
FG.emit('fg:ready');
})();
