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
 const tok=getToken(); if(!tok){ setSyncPill('signedout'); return; }
 // Never re-upload empty / synthetic seed shells
 const before=state.length;
 state=stripPlaceholderLeads(state);
 if(state.length!==before){ try{ localStorage.setItem(KEY,JSON.stringify(state)); }catch(e){} }
 try{
 const r=await fetch('/crm/api/academy-leads',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'push',leads:state})});
 setSyncPill(r.ok?'ok':(r.status===404?'off':'error'));
 }catch(e){ setSyncPill('offline'); }
}
function setSyncPill(s){
 const el=document.getElementById('syncPill'); if(!el) return;
 const map={ok:['Sync: ✓ shared',''],offline:['Sync: offline','warn'],error:['Sync: error','warn'],off:['Sync: local only',''],signedout:['Sync: sign in','']};
 const [txt,cls]=map[s]||['Sync: —',''];
 el.textContent=txt; el.className='tokenpill'+(cls?' '+cls:'');
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
 if(String(existing[f]||'')===String(v)) return false;
 existing[f]=v;
 return true;
}

/* Hydrate shared leads after login: union lists; server non-empty fields win. */
function mergeServerLeads(serverLeads){
 let matched=0, added=0, contactsFilled=0;
 serverLeads.forEach(raw=>{
 if(!raw||!raw.name) return;
 const inc=normalizeLead({...raw});
 const k=(inc.name||'').trim().toLowerCase()+'|'+(inc.city||'').trim().toLowerCase();
 const existing=state.find(l=>((l.name||'').trim().toLowerCase()+'|'+((l.city||'').trim().toLowerCase()))===k);
 if(existing){
 matched++;
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
 Object.keys(inc).forEach(f=>{
 if(f==='id'||f==='lists'||f==='list_status'||f==='lists_touched') return;
 if(SERVER_CONTACT_FIELDS.indexOf(f)>=0) return; // already applied
 applyEnrichedField(existing, f, inc[f]);
 });
 if(inc.list_status && typeof inc.list_status==='object'){
 existing.list_status=Object.assign({}, existing.list_status||{}, inc.list_status);
 ensureListStatus(existing);
 }
 if(inc.list && LISTS.includes(inc.list) && !existing.lists_touched) existing.list=inc.list;
 // Re-hydrate WFS from notes after notes merge
 normalizeLead(existing);
 }else{
 inc.id=nextId();
 state.push(inc);
 added++;
 }
 });
 return {matched, added, contactsFilled};
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
function nextId(){ return state.reduce((m,l)=>Math.max(m,l.id||0),0)+1; }
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

