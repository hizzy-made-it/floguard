/* ================= STATE ================= */
let state=loadLeads(); let view='FrenchDrain';
let chats=loadChats(); // {coach:[], roleplay:[], review:[]}
let rpActive=null; // active scenario id

function mapLegacyList(list){
 return LISTS.includes(list)?list:'FrenchDrain';
}
/** Empty shells + List-A synthetic "{category} prospect — City" rows. */
function isPlaceholderLead(l){
 const name=String(l&&l.name||'').trim();
 if(!name) return true;
 if(/^\(business name\)$/i.test(name)) return true;
 if(/\bprospect\s*[—–-]\s*/i.test(name)) return true;
 const notes=String(l&&l.notes||'');
 if(/no-website service prospect/i.test(notes) && !name) return true;
 if(/Category seed:/i.test(notes) && /\bprospect\b/i.test(name) && !String(l&&l.phone||'').trim() && !String(l&&l.website||'').trim()) return true;
 return false;
}
function stripPlaceholderLeads(arr){
 return (Array.isArray(arr)?arr:[]).filter(function(l){ return !isPlaceholderLead(l); });
}
function buildSeed(){
 // Named demo rows only — never empty "(business name)" category shells
 return SEED.map(function(raw){
 const list=mapLegacyList(raw.list);
 const row={...raw,list:list,lists:[list],list_status:{}};
 const lists=[list];
 suggestListsForIndustry(row.industry, row.website).forEach(function(x){ if(!lists.includes(x)) lists.push(x); });
 row.lists=lists;
 lists.forEach(function(c){ row.list_status[c]=row.status||'New'; });
 return row;
 }).filter(function(r){ return String(r.name||'').trim(); });
}
function loadLeads(){
 try{
 const s=JSON.parse(localStorage.getItem(KEY));
 if(Array.isArray(s)&&s.length){
 const cleaned=stripPlaceholderLeads(s.map(l=>({...l,list:LISTS.includes(l.list)?l.list:mapLegacyList(l.list)})));
 if(cleaned.length!==s.length){ try{ localStorage.setItem(KEY,JSON.stringify(cleaned)); }catch(e){} }
 return cleaned;
 }
 }catch(e){}
 return buildSeed().map((l,i)=>({id:i+1,...l}));
}
let _leadSyncTimer=null;
function saveLeads(){
 localStorage.setItem(KEY,JSON.stringify(state));
 if(_leadSyncTimer) clearTimeout(_leadSyncTimer);
 _leadSyncTimer=setTimeout(pushLeadsToServer,1500);
}
async function pushLeadsToServer(){
 _leadSyncTimer=null;
 const tok=getToken(); if(!tok){ setSyncPill('signedout'); return; }
 // Never re-upload empty / synthetic seed shells
 const before=state.length;
 state=stripPlaceholderLeads(state);
 if(state.length!==before){ try{ localStorage.setItem(KEY,JSON.stringify(state)); }catch(e){} }
 try{
 const r=await fetch('/crm/api/academy-leads',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'push',leads:state})});
 setSyncPill(r.ok?'ok':(r.status===404?'off':'error'));
 // Server mode: pick up uuids / updated_at the server assigned to new or changed leads
 if(r.ok && window.FG && FG.sync && FG.server.mode==='server'){
  let data=null; try{ data=await r.json(); }catch(e){}
  if(data && (data.added||data.updated)) FG.sync.refresh();
 }
 }catch(e){ setSyncPill('offline'); }
}
function setSyncPill(s){
 const el=document.getElementById('syncPill'); if(!el) return;
 const map={ok:['Sync: ✓ shared',''],offline:['Sync: offline','warn'],error:['Sync: error','warn'],off:['Sync: local only',''],signedout:['Sync: sign in','']};
 const [txt,cls]=map[s]||['Sync: —',''];
 el.textContent=txt; el.className='tokenpill'+(cls?' '+cls:'');
 syncPillTitle();
}
/** Tooltip: what the pill does, plus a quiet hint when the server pipeline is not available. */
function syncPillTitle(){
 const el=document.getElementById('syncPill'); if(!el) return;
 const mode=(window.FG&&FG.server)?FG.server.mode:'unknown';
 const base='Click to re-pull shared leads (LeadAgent enrichments)';
 el.title=mode==='local'
  ? base+'\nLocal mode: leads sync as one shared list. Pipeline tasks, the server timeline and conflict checks are off until the leads database is enabled.'
  : mode==='server' ? base+'\nServer mode: pipeline, tasks and activity sync per lead.' : base;
 el.dataset.mode=mode;
}
/* Fields LeadAgent / server may enrich — always take non-empty server values. */
const SERVER_CONTACT_FIELDS=['phone','website','email','contact','industry','notes','source','status','package','amount','owner','next_follow_up_at','website_score','address','zip','parcel_id','city','mgmt_company_id','mgmt_company_name','maintenance_last_service','maintenance_frequency','maintenance_next_due','maintenance_plan','suggested_causes'];

function fieldEmpty(v){
 if(v==null||v==='') return true;
 if(typeof v==='object' && !Array.isArray(v)){
 if(v.total==null && !Object.keys(v).length) return true;
 }
 return false;
}
/** Apply one enriched field onto a local lead (objects like website_score included). */
function applyEnrichedField(existing, f, v){
 if(fieldEmpty(v)) return false;
 if(f==='website_score' && typeof v==='object'){
 const next={
 total:Number(v.total)||0,
 grade:String(v.grade||'').toUpperCase()||'F',
 band:String(v.band||'').toLowerCase()||'',
 gaps:Array.isArray(v.gaps)?v.gaps.slice():[]
 };
 const prev=existing.website_score;
 if(prev && Number(prev.total)===next.total && String(prev.grade||'')===next.grade && String(prev.band||'')===next.band){
 // still refresh gaps if server has more detail
 if((next.gaps||[]).length && (!prev.gaps||!prev.gaps.length)){ existing.website_score=next; return true; }
 return false;
 }
 existing.website_score=next;
 return true;
 }
 if(typeof v==='object'){
 if(sameJson(existing[f], v)) return false;
 existing[f]=Array.isArray(v)?v.slice():Object.assign({},v);
 return true;
 }
 if(String(existing[f]||'')===String(v)) return false;
 existing[f]=v;
 return true;
}

/* ---- Lead identity (client side; mirrors server/lib/leads-core.js) ----
 * Match order: uuid, then parcel_id, then name+city+address. Two same-name owners in one
 * city stay separate when both have an address (or both a parcel / uuid) and they differ. */
function normAddrKey(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function nameCityKey(l){ return String(l&&l.name||'').trim().toLowerCase()+'|'+String(l&&l.city||'').trim().toLowerCase(); }
function findLocalLeadFor(inc, pool, claimed){
 pool=pool||state; claimed=claimed||new Set();
 const free=function(l){ return !claimed.has(l); };
 const iu=String(inc&&inc.uuid||'').trim();
 const pid=String(inc&&inc.parcel_id||'').trim();
 if(iu){ const m=pool.find(function(l){ return free(l) && l.uuid===iu; }); if(m) return m; }
 const uuidClash=function(l){ return !!(iu && l.uuid && l.uuid!==iu); };
 if(pid){
  const m=pool.find(function(l){ return free(l) && !uuidClash(l) && String(l.parcel_id||'').trim()===pid; });
  if(m) return m;
 }
 const k=nameCityKey(inc);
 if(k==='|') return null;
 const cands=pool.filter(function(l){
  if(!free(l) || uuidClash(l) || nameCityKey(l)!==k) return false;
  const lp=String(l.parcel_id||'').trim();
  return !(lp && pid && lp!==pid);
 });
 if(!cands.length) return null;
 const ia=normAddrKey(inc.address);
 if(ia){
  const exact=cands.find(function(l){ return normAddrKey(l.address)===ia; });
  if(exact) return exact;
  return cands.find(function(l){ return !normAddrKey(l.address); })||null;
 }
 return cands.length===1 ? cands[0] : (cands.find(function(l){ return !normAddrKey(l.address); })||null);
}
function sameJson(a,b){ try{ return JSON.stringify(a)===JSON.stringify(b); }catch(e){ return false; } }
function phoneDigitsKey(n){ const d=String(n||'').replace(/\D/g,''); return d.length===11&&d[0]==='1'?d.slice(1):d; }
/** Union phones[] by number; dnc/litigator true are sticky (never cleared by a merge). */
function mergePhoneLists(a, b){
 const out=[]; const at={};
 [a,b].forEach(function(list){
  (Array.isArray(list)?list:[]).forEach(function(p){
   if(!p||!p.number) return;
   const k=phoneDigitsKey(p.number); if(!k) return;
   if(at[k]==null){ at[k]=out.length; out.push(Object.assign({},p)); return; }
   const cur=out[at[k]];
   const nx=Object.assign({},cur,p);
   if(cur.dnc===true||p.dnc===true) nx.dnc=true;
   if(cur.litigator===true||p.litigator===true) nx.litigator=true;
   out[at[k]]=nx;
  });
 });
 return out;
}
/** Pipeline fields the server owns once it is the source of truth. */
const PIPELINE_FIELDS=['stage','next_action','stage_changed_at'];
const SERVER_SYSTEM_FIELDS=['uuid','updated_at','created_at'];
function serverIsNewer(existing, inc){
 if(!inc.updated_at) return false;
 if(!existing.updated_at) return true;
 return String(inc.updated_at)>String(existing.updated_at);
}

/* Hydrate shared leads after login: union lists; server non-empty fields win.
   Keys on uuid, then parcel_id, then name+city+address (never collapses two owners). */
function mergeServerLeads(serverLeads){
 let matched=0, added=0, contactsFilled=0, removed=0;
 const claimed=new Set();
 serverLeads.forEach(raw=>{
 if(!raw||!raw.name) return;
 const existing=findLocalLeadFor(raw, state, claimed);
 if(raw.deleted_at){
  // Soft-deleted on the server (list+since): drop the local copy too.
  if(existing){ state=state.filter(function(x){ return x!==existing; }); removed++; }
  return;
 }
 const inc=normalizeLead({...raw});
 if(existing){
 claimed.add(existing);
 matched++;
 if(raw.id!=null) existing.server_id=raw.id;
 const newer=serverIsNewer(existing, inc);
 const localDnc=existing.phone_dnc===true;
 // Prefer explicit server lists when present; else union
 if(Array.isArray(inc.lists) && inc.lists.length){
 if(existing.lists_touched){
 // Local checkbox edits win until next full replace — union so server adds only
 const lists=leadLists(existing).slice();
 leadLists(inc).forEach(x=>{ if(!lists.includes(x)) lists.push(x); });
 setLeadLists(existing, lists);
 } else {
 setLeadLists(existing, leadLists(inc));
 }
 } else {
 const lists=leadLists(existing).slice();
 leadLists(inc).forEach(x=>{ if(!lists.includes(x)) lists.push(x); });
 setLeadLists(existing, lists);
 }
 // Contact / research fields: server non-empty always wins (LeadAgent enrich path)
 SERVER_CONTACT_FIELDS.forEach(function(f){
 if(applyEnrichedField(existing, f, inc[f])){
 if(f==='phone'||f==='website'||f==='email'||f==='notes'||f==='website_score') contactsFilled++;
 }
 });
 if(Array.isArray(inc.phones) && inc.phones.length){
  const merged=mergePhoneLists(existing.phones, inc.phones);
  if(!sameJson(merged, existing.phones)){ existing.phones=merged; contactsFilled++; }
 }
 Object.keys(inc).forEach(f=>{
 if(f==='id'||f==='lists'||f==='list_status'||f==='lists_touched'||f==='phones') return;
 if(SERVER_CONTACT_FIELDS.indexOf(f)>=0) return; // already applied
 if(PIPELINE_FIELDS.indexOf(f)>=0) return; // below, only when the server copy is newer
 if(SERVER_SYSTEM_FIELDS.indexOf(f)>=0){ if(inc[f]) existing[f]=inc[f]; return; }
 applyEnrichedField(existing, f, inc[f]);
 });
 if(newer){
  PIPELINE_FIELDS.forEach(function(f){
   if(f in inc){ if(inc[f]==null||inc[f]==='') delete existing[f]; else existing[f]=inc[f]; }
  });
 } else {
  PIPELINE_FIELDS.forEach(function(f){ if(existing[f]==null && inc[f]!=null && inc[f]!=='') existing[f]=inc[f]; });
 }
 if(localDnc) existing.phone_dnc=true; // DNC is sticky
 if(inc.list_status && typeof inc.list_status==='object'){
 existing.list_status=Object.assign({}, existing.list_status||{}, inc.list_status);
 ensureListStatus(existing);
 }
 if(inc.list && LISTS.includes(inc.list) && !existing.lists_touched) existing.list=inc.list;
 // Re-hydrate WFS from notes after notes merge
 normalizeLead(existing);
 }else{
 if(inc.id!=null) inc.server_id=inc.id;
 inc.id=nextId();
 state.push(inc);
 claimed.add(inc);
 added++;
 }
 });
 return {matched, added, contactsFilled, removed};
}
async function prunePlaceholderLeadsOnServer(){
 const tok=getToken(); if(!tok) return {removed:0};
 try{
 const r=await fetch('/crm/api/academy-leads',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'prune_placeholders'})});
 if(!r.ok) return {removed:0};
 const data=await r.json();
 return {removed:Number(data.removed)||0, remaining:Number(data.remaining)||0, leads:Array.isArray(data.leads)?data.leads:null};
 }catch(e){ return {removed:0}; }
}
async function hydrateLeadsFromServer(){
 const tok=getToken(); if(!tok){ setSyncPill('signedout'); return false; }
 try{
 setSyncPill('ok'); // interim
 const el=document.getElementById('syncPill'); if(el) el.textContent='Sync: pulling…';
 // Drop empty / synthetic seeds on the shared store first
 const pruned=await prunePlaceholderLeadsOnServer();
 const r=await fetch('/crm/api/academy-leads',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'list'})});
 if(!r.ok){ setSyncPill(r.status===404?'off':'error'); return false; }
 const data=await r.json();
 if(window.FG && FG.sync) FG.sync.noteListed(data);
 // Local purge always (covers offline copies of placeholders)
 const beforeLocal=state.length;
 state=stripPlaceholderLeads(state);
 if(Array.isArray(data.leads)){
 // Prefer server truth after prune: rebuild from real named leads
 const serverClean=stripPlaceholderLeads(data.leads);
 if(serverClean.length){
 // Replace local placeholders by merging real server leads only
 state=stripPlaceholderLeads(state);
 const stats=mergeServerLeads(serverClean);
 // Drop any local leftovers that are still placeholders (empty name never merged)
 state=stripPlaceholderLeads(state);
 // Ensure every lead has WFS/email/phone soft-fills for prospect cards
 state.forEach(normalizeLead);
 localStorage.setItem(KEY,JSON.stringify(state));
 refreshIndustryFilter(); refreshCityFilter(); render();
 // If a profile is open, repaint with enrichment
 if(profileLeadId!=null){
 const open=state.find(function(x){ return x.id===profileLeadId; });
 if(open) paintProfileForm(open);
 }
 const dropped=beforeLocal-state.length+(pruned.removed||0);
 if(el) el.textContent='Sync: ✓ '+state.length+' leads'+(stats.contactsFilled?(' · +'+stats.contactsFilled+' contacts'):'')+(dropped>0?(' · −'+dropped+' empty'):'');
 el && (el.className='tokenpill');
 return true;
 }
 }
 if(state.length!==beforeLocal){
 localStorage.setItem(KEY,JSON.stringify(state));
 refreshIndustryFilter(); refreshCityFilter(); render();
 }
 setSyncPill('ok');
 if(el && (pruned.removed||0)>0) el.textContent='Sync: ✓ '+state.length+' leads · −'+pruned.removed+' empty';
 return true;
 }catch(e){ setSyncPill('offline'); return false; }
}
function loadChats(){ try{const c=JSON.parse(localStorage.getItem(CHATKEY)); if(c&&typeof c==='object') return {coach:[],roleplay:[],review:[],...c};}catch(e){} return {coach:[],roleplay:[],review:[]}; }
function saveChats(){ localStorage.setItem(CHATKEY,JSON.stringify(chats)); }
function nextId(){ return state.reduce((m,l)=>Math.max(m,Number(l.id)||0),0)+1; }
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

