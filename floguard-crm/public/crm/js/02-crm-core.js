/* ================= OUTREACH CRM ================= */
const ACTKEY='floguard_activities_v1';
const PRKEY='floguard_practice_v1';
const CLOSED_STATUSES=new Set(['Deposit collected','Contract signed']);
const LOST_STATUSES=new Set(['Not interested','Do not contact']);
const PIPELINE_STATUSES=new Set(['Interested','Quoted','Callback']);
const MNT_FREQ_MONTHS={monthly:1,quarterly:3,yearly:12,as_needed:0};
let profileLeadId=null;

/* ---- Management companies (local entity for PropertyMgmt B2B) ---- */
function loadMgmtCompanies(){
 try{ const a=JSON.parse(localStorage.getItem(MGMTKEY)); if(Array.isArray(a)) return a; }catch(e){}
 return [];
}
function saveMgmtCompanies(list){
 localStorage.setItem(MGMTKEY, JSON.stringify(list||[]));
}
function nextMgmtId(){
 const list=loadMgmtCompanies();
 let m=0; list.forEach(function(c){ const n=Number(c.id)||0; if(n>m) m=n; });
 return m+1;
}
function addMgmtCompany(rec){
 const list=loadMgmtCompanies();
 const row={
  id:nextMgmtId(),
  name:String(rec.name||'').trim(),
  phone:String(rec.phone||'').trim(),
  contact:String(rec.contact||'').trim(),
  notes:String(rec.notes||'').trim(),
  created_at:new Date().toISOString()
 };
 if(!row.name) return null;
 list.push(row);
 saveMgmtCompanies(list);
 return row;
}
function fillMgmtSelect(sel, selectedId){
 if(!sel) return;
 const list=loadMgmtCompanies().slice().sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||'')); });
 const cur=selectedId!=null?String(selectedId):'';
 sel.innerHTML='<option value="">— None —</option>'+list.map(function(c){
  return '<option value="'+esc(String(c.id))+'"'+(String(c.id)===cur?' selected':'')+'>'+esc(c.name||('Company #'+c.id))+'</option>';
 }).join('');
 if(cur && ![...sel.options].some(function(o){ return o.value===cur; })){
  // orphan id from imported lead — keep as synthetic option
  const opt=document.createElement('option');
  opt.value=cur; opt.selected=true; opt.textContent='(saved id '+cur+')';
  sel.appendChild(opt);
 }
}

/* ---- Maintenance schedule helpers ---- */
function parseYmd(s){
 if(!s) return null;
 const m=String(s).slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if(!m) return null;
 const d=new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
 return isNaN(d.getTime())?null:d;
}
function toYmd(d){
 if(!d||isNaN(d.getTime())) return '';
 const y=d.getFullYear(), mo=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0');
 return y+'-'+mo+'-'+da;
}
function addMonthsYmd(ymd, months){
 const d=parseYmd(ymd); if(!d||!months) return ymd||'';
 d.setMonth(d.getMonth()+months);
 return toYmd(d);
}
function computeNextDue(last, freq){
 const months=MNT_FREQ_MONTHS[freq];
 if(!last||!months) return '';
 return addMonthsYmd(last, months);
}
function isDueThisMonth(l){
 const next=parseYmd(l && l.maintenance_next_due);
 if(!next) return false;
 const now=new Date();
 return next.getFullYear()===now.getFullYear() && next.getMonth()===now.getMonth();
}
function isOverdue(l){
 const next=parseYmd(l && l.maintenance_next_due);
 if(!next) return false;
 const today=new Date(); today.setHours(0,0,0,0);
 return next < today;
}
function mntDueBadgeHtml(l){
 if(!l||!l.maintenance_next_due) return '';
 if(isOverdue(l)) return '<span class="mnt-due overdue" title="Overdue">Due '+esc(String(l.maintenance_next_due).slice(0,10))+'</span>';
 if(isDueThisMonth(l)) return '<span class="mnt-due" title="Due this month">Due '+esc(String(l.maintenance_next_due).slice(0,10))+'</span>';
 return '<span class="mnt-due ok" title="Scheduled">'+esc(String(l.maintenance_next_due).slice(0,10))+'</span>';
}
function syncDueFilterUi(){
 const el=document.getElementById('dueThisMonthFilter');
 if(!el) return;
 el.classList.toggle('on', view==='Maintenance');
 if(view!=='Maintenance'){
  const ck=document.getElementById('dueThisMonth');
  if(ck) ck.checked=false;
 }
}

function leadKeyOf(l){
 return `${String(l?.name||'').trim().toLowerCase()}|${String(l?.city||'').trim().toLowerCase()}`;
}
function loadActivities(){
 try{const a=JSON.parse(localStorage.getItem(ACTKEY)); if(Array.isArray(a)) return a;}catch(e){}
 return [];
}
function saveActivitiesLocal(list){
 localStorage.setItem(ACTKEY,JSON.stringify(list.slice(-5000)));
}
function loadPracticeLocal(){
 try{const a=JSON.parse(localStorage.getItem(PRKEY)); if(Array.isArray(a)) return a;}catch(e){}
 return [];
}
function savePracticeLocal(list){
 localStorage.setItem(PRKEY,JSON.stringify(list.slice(-2000)));
}
function currentUserName(){
 try{
 const a=getAuth();
 return (a&&a.user&&a.user.username)||(a&&a.username)||'';
 }catch(e){return '';}
}
async function appendActivity(entry){
 const list=loadActivities();
 const row={
 id: entry.id||(`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`),
 lead_id: entry.lead_id!=null?entry.lead_id:null,
 lead_key: entry.lead_key||'',
 user: entry.user||currentUserName()||'local',
 type: entry.type||'note',
 at: entry.at||new Date().toISOString(),
 outcome: entry.outcome||'',
 detail: entry.detail||{},
 next_follow_up_at: entry.next_follow_up_at||null
 };
 list.push(row);
 saveActivitiesLocal(list);
 // Leads workspace (18-leads-next.js): mirror to the per-lead server timeline when available
 if(window.FG&&FG.activity){ try{ FG.activity.mirror(row); }catch(e){} }
 const tok=getToken();
 if(tok){
 try{
 await fetch('/crm/api/academy-activity',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'append',activity:row})});
 }catch(e){}
 }
 return row;
}
function activitiesForLead(l){
 const key=leadKeyOf(l);
 return loadActivities().filter(a=>(a.lead_id!=null&&l.id!=null)?String(a.lead_id)===String(l.id):String(a.lead_key||'').toLowerCase()===key).slice(-100).reverse();
}
function money(n){ const x=Number(n)||0; return '$'+x.toLocaleString(undefined,{maximumFractionDigits:0}); }
function isHot(l){
 const ws=resolveWebsiteScore(l);
 if(ws && (String(ws.band).toLowerCase()==='urgent' || Number(ws.total)>=80)) return true;
 return /flood|standing water|under water|water in (the )?house|crawl ?space (is )?wet|urgent/i.test(String(l.notes||''));
}
function profileFormPhone(){
 return (document.getElementById('pfPhone')?.value||'').trim();
}
function profileFormEmail(){
 return (document.getElementById('pfEmail')?.value||'').trim();
}
function profileFormWebsite(){
 return (document.getElementById('pfWebsite')?.value||'').trim();
}
function profileFormContact(){
 return (document.getElementById('pfContact')?.value||'').trim();
}
/** Digits for tel/sms; keeps leading + for E.164 */
function normalizeDial(raw){
 const s=String(raw||'').trim();
 if(!s) return '';
 let out=s.replace(/[^\d+]/g,'');
 if(out.indexOf('+')>0) out=out.replace(/\+/g,'');
 if((out.match(/\+/g)||[]).length>1) out='+'+out.replace(/\+/g,'');
 // US 10-digit convenience
 if(/^\d{10}$/.test(out)) out='+1'+out;
 if(/^1\d{10}$/.test(out)) out='+'+out;
 return out;
}
function websiteHref(raw){
 const w=String(raw||'').trim();
 if(!w || /^none$/i.test(w) || w.toLowerCase()==='fb') return '';
 if(/^https?:\/\//i.test(w)) return w;
 return 'https://'+w.replace(/^\/+/, '');
}
function emailTemplate(l, cat, emailOverride){
 const pb=CATEGORY_PLAYBOOKS[cat]||CATEGORY_PLAYBOOKS.FrenchDrain;
 const email=(emailOverride!=null?emailOverride:(l.email||'')).trim();
 const subj=(l.name||'your business')+' - quick idea';
 const opener=((pb.opener||pb.opener_restaurant||'')+'').replace(/\[Name\]/g,'us').replace(/\[Business\]/g,l.name||'');
 const contact=profileFormContact()||l.contact||'';
 const body='Hi'+(contact?(' '+String(contact).split(' ')[0]):'')+',\n\n'+opener+'\n\nWorth a short look?\n\n- '+(currentUserName()||'FloGuard');
 // Do not encodeURIComponent the whole email address in the path (breaks some clients)
 return 'mailto:'+encodeURIComponent(email).replace(/%40/g,'@')
 +'?subject='+encodeURIComponent(subj)
 +'&body='+encodeURIComponent(body);
}
function smsTemplate(l, cat, phone){
 const pb=CATEGORY_PLAYBOOKS[cat]||CATEGORY_PLAYBOOKS.FrenchDrain;
 const who=(profileFormContact()||l.contact||'').trim();
 const body='Hi'+(who?(' '+String(who).split(' ')[0]):'')+
 ' — quick note from FloGuard: open to a short idea on '+(pb.product||'growth')+' for '+(l.name||'your business')+'? Reply STOP to opt out.';
 // iOS prefers &body= ; Android often uses ?body=
 const dig=normalizeDial(phone);
 return 'sms:'+dig+'?body='+encodeURIComponent(body);
}
function flashActMsg(text, kind){
 const el=document.getElementById('pfActMsg');
 if(!el) return;
 el.textContent=text||'';
 el.className='act-msg'+(kind?(' '+kind):'');
 if(text){
 clearTimeout(flashActMsg._t);
 flashActMsg._t=setTimeout(function(){ if(el.textContent===text){ el.textContent=''; el.className='act-msg'; } }, 4500);
 }
}
async function copyText(str){
 const t=String(str||'');
 if(!t) return false;
 try{
 if(navigator.clipboard&&navigator.clipboard.writeText){
 await navigator.clipboard.writeText(t);
 return true;
 }
 }catch(e){}
 try{
 const ta=document.createElement('textarea');
 ta.value=t; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.left='-9999px';
 document.body.appendChild(ta); ta.select();
 const ok=document.execCommand('copy');
 document.body.removeChild(ta);
 return ok;
 }catch(e){ return false; }
}
function launchUri(uri){
 if(!uri) return false;
 try{
 // Prefer same-tab protocol handlers (tel/sms/mailto). External http(s) open in new tab.
 if(/^https?:/i.test(uri)){
 window.open(uri,'_blank','noopener,noreferrer');
 return true;
 }
 const a=document.createElement('a');
 a.href=uri;
 a.rel='noopener';
 a.style.display='none';
 document.body.appendChild(a);
 a.click();
 document.body.removeChild(a);
 return true;
 }catch(e){
 try{ window.location.href=uri; return true; }catch(e2){ return false; }
 }
}
function profileLeadAndCat(){
 const l=state.find(x=>x.id===profileLeadId);
 if(!l) return {l:null, cat:'Website'};
 normalizeLead(l);
 const cat=categoryKey(activeCause(l));
 return {l, cat};
}
/** Form phone becomes the lead's primary (DNC kept per number by FG.phone.setPrimary). */
async function adoptFormPhone(l, raw){
 if(!raw || phoneDigitsKey(raw)===phoneDigitsKey(l.phone)) return;
 if(window.FG&&FG.phone&&FG.phone.setPrimary&&l.phone){ await FG.phone.setPrimary(l, raw); return; }
 l.phone=raw; saveLeads();
}
async function profileActionCall(){
 const {l}=profileLeadAndCat(); if(!l) return;
 const raw=profileFormPhone()||l.phone||'';
 if(window.FG&&FG.ready){
  if(!raw){ flashActMsg('Add a phone number first (Contact & deal → Phone), then try Call again.', 'err'); document.getElementById('pfPhone')?.focus(); return; }
  await adoptFormPhone(l, raw);
  FG.dial.start(l, raw, 'call');
  return;
 }
 const phone=normalizeDial(raw);
 if(!phone){
 flashActMsg('Add a phone number first (Contact & deal → Phone), then try Call again.', 'err');
 document.getElementById('pfPhone')?.focus();
 return;
 }
 // Persist form phone into lead so table stays in sync
 l.phone=raw; saveLeads();
 launchUri('tel:'+phone);
 flashActMsg('Opening dialer for '+phone+'…', 'ok');
 await appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:'call',outcome:'attempted',detail:{via:'tel',phone:phone,text:'Called via tel link'}});
 renderProfileTimeline(l);
}
async function profileActionSms(){
 const {l,cat}=profileLeadAndCat(); if(!l) return;
 const raw=profileFormPhone()||l.phone||'';
 if(window.FG&&FG.ready){
  if(!raw){ flashActMsg('Add a phone number first, then try Text again.', 'err'); document.getElementById('pfPhone')?.focus(); return; }
  await adoptFormPhone(l, raw);
  FG.dial.start(l, raw, 'text');
  return;
 }
 const phone=normalizeDial(raw);
 if(!phone){
 flashActMsg('Add a phone number first, then try Text again.', 'err');
 document.getElementById('pfPhone')?.focus();
 return;
 }
 l.phone=raw; saveLeads();
 const uri=smsTemplate(l, cat, phone);
 const opened=launchUri(uri);
 // Desktop often has no SMS handler — always offer copy
 const body=decodeURIComponent((uri.split('body=')[1]||''));
 await copyText(phone+(body?('\n'+body):''));
 flashActMsg(opened
 ? 'Opening texts for '+phone+'. Message also copied if your device has no SMS app.'
 : 'No SMS app detected — phone + message copied to clipboard.', opened?'ok':'err');
 await appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:'sms',outcome:'opened',detail:{via:'sms',phone:phone,text:'SMS composer opened / copied'}});
 renderProfileTimeline(l);
}
async function profileActionEmail(){
 const {l,cat}=profileLeadAndCat(); if(!l) return;
 const email=(profileFormEmail()||l.email||'').trim();
 if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
 flashActMsg('Add a valid email first (Contact & deal → Email), then try Email again.', 'err');
 document.getElementById('pfEmail')?.focus();
 return;
 }
 l.email=email; saveLeads();
 const uri=emailTemplate(l, cat, email);
 launchUri(uri);
 flashActMsg('Opening mail for '+email+'…', 'ok');
 await appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:'email',outcome:'opened',detail:{via:'mailto',category:cat,email:email,text:'Email composer opened'}});
 renderProfileTimeline(l);
}
async function profileActionCopyPhone(){
 const {l}=profileLeadAndCat(); if(!l) return;
 const raw=profileFormPhone()||l.phone||'';
 if(!raw){ flashActMsg('No phone on file.', 'err'); document.getElementById('pfPhone')?.focus(); return; }
 const ok=await copyText(raw);
 flashActMsg(ok?('Copied phone: '+raw):'Could not copy phone — select and copy manually.', ok?'ok':'err');
}
async function profileActionCopyEmail(){
 const {l}=profileLeadAndCat(); if(!l) return;
 const email=(profileFormEmail()||l.email||'').trim();
 if(!email){ flashActMsg('No email on file.', 'err'); document.getElementById('pfEmail')?.focus(); return; }
 const ok=await copyText(email);
 flashActMsg(ok?('Copied email: '+email):'Could not copy email — select and copy manually.', ok?'ok':'err');
}
function profileActionWebsite(){
 const {l}=profileLeadAndCat(); if(!l) return;
 const raw=profileFormWebsite()||l.website||'';
 const href=websiteHref(raw);
 if(!href){ flashActMsg('No website on file (hot lead if they have none).', 'err'); return; }
 launchUri(href);
 flashActMsg('Opening website…', 'ok');
}
function profileActionMaps(){
 const {l}=profileLeadAndCat(); if(!l) return;
 const addr=(document.getElementById('pfAddress')?.value||l.address||'').trim();
 const q=encodeURIComponent(addr || ((l.name||'')+' '+(l.city||'')+' FL'));
 launchUri('https://www.google.com/maps/search/?api=1&query='+q);
 flashActMsg(addr?'Opening Maps for site address…':'Opening Maps (no site address — using name/city)…', 'ok');
}
function profileActionCoach(){
 const {l}=profileLeadAndCat(); if(!l) return;
 closeProfile();
 goTab('coach');
 const box=document.getElementById('in-coach');
 const lists=leadLists(l);
 let active=categoryKey(activeCause(l));
 lastCoachCategory=active; lastCoachLeadId=l.id;
 box.value='CATEGORY: '+active+'. Game-plan this cold call for '+(l.name||'an unnamed business')+' - '+(l.industry||'unknown industry')+' in '+(l.city||'the Daytona area')+'. Multi-lists: '+lists.join(', ')+'. Active: '+active+'. Status for '+active+': '+getListStatus(l, active)+'. Website: '+(l.website||'NONE')+'. Phone: '+(l.phone||'unknown')+'. Notes: '+(l.notes||'none')+'. Use the '+active+' playbook. Give opener, two discovery questions, expected objection + counter, exact close, and what NOT to pitch.';
 box.focus();
}
function wireProfileActBar(){
 const bar=document.getElementById('pfActBar');
 if(!bar || bar.dataset.wired==='1') return;
 bar.dataset.wired='1';
 bar.addEventListener('click', function(e){
 const btn=e.target.closest('[data-act]');
 if(!btn || !bar.contains(btn)) return;
 e.preventDefault();
 e.stopPropagation();
 const act=btn.getAttribute('data-act');
 const dm=btn.closest('details.menu'); if(dm) dm.removeAttribute('open');
 if(act==='call') profileActionCall();
 else if(act==='sms') profileActionSms();
 else if(act==='email') profileActionEmail();
 else if(act==='copy-phone') profileActionCopyPhone();
 else if(act==='copy-email') profileActionCopyEmail();
 else if(act==='website') profileActionWebsite();
 else if(act==='maps') profileActionMaps();
 else if(act==='coach') profileActionCoach();
 else if(act==='queue-draft') profileActionQueueDraft();
 });
}
async function profileActionQueueDraft(){
 const {l,cat}=profileLeadAndCat(); if(!l) return;
 const email=(profileFormEmail()||l.email||'').trim();
 const pb=CATEGORY_PLAYBOOKS[cat]||CATEGORY_PLAYBOOKS.FrenchDrain;
 const subj=(l.name||'your business')+' - quick idea';
 const opener=((pb.opener||pb.opener_restaurant||'')+'').replace(/\[Name\]/g,'us').replace(/\[Business\]/g,l.name||'');
 const contact=profileFormContact()||l.contact||'';
 const body='Hi'+(contact?(' '+String(contact).split(' ')[0]):'')+',\n\n'+opener+'\n\nWorth a short look?\n\n- '+(currentUserName()||'FloGuard');
 try{
 const tok=getToken();
 if(!tok){ flashActMsg('Sign in required to queue drafts.', 'err'); return; }
 const r=await fetch('/crm/api/academy-drafts',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'append',draft:{
 lead_id:l.id, lead_key:leadKeyOf(l), channel:'email', subject:subj, body:body,
 meta:{email:email||'', category:cat, name:l.name||''}
 }})});
 const j=await r.json().catch(function(){return {};});
 if(!r.ok){ flashActMsg(j.error||'Could not queue draft', 'err'); return; }
 flashActMsg('Draft queued for approval — open Outbound tab.', 'ok');
 await appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:'email',outcome:'draft_queued',detail:{text:'Outbound draft queued',subject:subj}});
 renderProfileTimeline(l);
 }catch(e){ flashActMsg('Queue draft failed: '+(e.message||e), 'err'); }
}
function paintProfileForm(l){
 normalizeLead(l);
 const cat=categoryKey(activeCause(l));
 const causeStatus=getListStatus(l, cat);
 const lists=leadLists(l);
 document.getElementById('pfName').textContent=l.name||'(unnamed)';
 const wfs=resolveWebsiteScore(l);
 const wfsMeta=wfs?(' · DNS '+wfs.total+'/'+wfs.grade):'';
 const contactBits=[];
 if((l.phone||'').trim()) contactBits.push('phone');
 if((l.email||'').trim()) contactBits.push('email');
 if((l.website||'').trim()) contactBits.push('web');
 const site=(l.address||'').trim();
 // R2: one clean line: where, who, score. City/ZIP only when the address does not already carry them.
 const where=site?(site+(l.city&&site.toLowerCase().indexOf(String(l.city).toLowerCase())<0?', '+l.city:'')):[l.city,l.zip].filter(Boolean).join(' ');
 const fsc=(typeof leadFloodScore==='function')?leadFloodScore(l):null;
 document.getElementById('pfMeta').textContent=[where||'No address yet', l.industry||'', fsc!=null?('Flood score '+Math.round(fsc)):'', wfs?('DNS '+wfs.total+'/'+wfs.grade):''].filter(Boolean).join(' · ');
 document.getElementById('pfBadges').innerHTML=lists.map(x=>'<span class="badge'+(x===cat?' badge--on':'')+'">'+esc(causeLabel(x))+(x===cat?' · active':'')+'</span>').join('')+
 (causeStatus?'<span class="badge">'+esc(causeStatus)+'</span>':'')+
 (l.owner?'<span class="badge">Rep: '+esc(l.owner)+'</span>':'')+
 (l.parcel_id?'<span class="badge">Parcel '+esc(l.parcel_id)+'</span>':'')+
 (l.mgmt_company_name?'<span class="badge">Mgmt: '+esc(l.mgmt_company_name)+'</span>':'')+
 (wfs?'<span class="badge">DNS '+esc(String(wfs.total))+'/'+esc(wfs.grade)+'</span>':'')+
 ((l.email||'').trim()?'<span class="badge">Email on file</span>':'<span class="badge" title="Tax roll has no email — enrich separately">No email</span>')+
 ((l.phone||'').trim()?'<span class="badge">Phone on file</span>':'<span class="badge" title="Tax roll has no phone — enrich + DNC scrub">No phone</span>')+
 (l.maintenance_next_due?mntDueBadgeHtml(l):'');
 renderFitnessCard(l);
 const pfCauses=document.getElementById('pfCauses');
 if(pfCauses){
 pfCauses.innerHTML=LISTS.map(function(c){
 const on=lists.includes(c);
 const tabOn=(view!=='All'&&view===c)?' tab-active':'';
 return '<label class="cause-chip'+(on?' on':'')+' badge-'+listBadge(c)+tabOn+'" title="'+esc(causeLabel(c))+'">'+
 '<input type="checkbox" data-cause="'+esc(c)+'" data-profile-cause="1"'+(on?' checked':'')+'>'+esc(causeLabel(c))+'</label>';
 }).join('');
 }
 // PropertyMgmt → management company dropdown
 const mgmtSec=document.getElementById('pfMgmtSec');
 if(mgmtSec){
  const showPm=lists.includes('PropertyMgmt');
  mgmtSec.style.display=showPm?'block':'none';
  if(showPm) fillMgmtSelect(document.getElementById('pfMgmtCompany'), l.mgmt_company_id);
  document.getElementById('pfMgmtNew')?.classList.remove('on');
 }
 // Maintenance → schedule fields
 const mntSec=document.getElementById('pfMntSec');
 if(mntSec){
  const showM=lists.includes('Maintenance');
  mntSec.style.display=showM?'block':'none';
  if(showM){
   const last=document.getElementById('pfMntLast');
   const freq=document.getElementById('pfMntFreq');
   const next=document.getElementById('pfMntNext');
   const plan=document.getElementById('pfMntPlan');
   if(last) last.value=String(l.maintenance_last_service||'').slice(0,10);
   if(freq) freq.value=l.maintenance_frequency||'';
   if(next) next.value=String(l.maintenance_next_due||'').slice(0,10);
   if(plan) plan.value=l.maintenance_plan||'';
  }
 }
 if(document.getElementById('pfAddress')) document.getElementById('pfAddress').value=l.address||'';
 if(document.getElementById('pfCity')) document.getElementById('pfCity').value=l.city||'';
 if(document.getElementById('pfZip')) document.getElementById('pfZip').value=l.zip||'';
 if(document.getElementById('pfParcelId')) document.getElementById('pfParcelId').value=l.parcel_id||'';
 if(document.getElementById('pfIndustry')) document.getElementById('pfIndustry').value=l.industry||'';
 document.getElementById('pfPhone').value=l.phone||'';
 document.getElementById('pfEmail').value=l.email||'';
 document.getElementById('pfContact').value=l.contact||'';
 document.getElementById('pfOwner').value=l.owner||currentUserName()||'';
 document.getElementById('pfWebsite').value=l.website||'';
 document.getElementById('pfPackage').value=l.package||'';
 document.getElementById('pfAmount').value=(l.amount!=null&&l.amount!=='')?l.amount:'';
 document.getElementById('pfNotes').value=l.notes||'';
 if(document.getElementById('pfSource')) document.getElementById('pfSource').value=l.source||'';
 const stLab=document.getElementById('pfStatusLabel');
 if(stLab) stLab.textContent='Status for '+cat;
 const st=document.getElementById('pfStatus');
 st.innerHTML=STATUSES.map(s=>'<option'+( causeStatus===s?' selected':'')+'>'+esc(s)+'</option>').join('');
 const fu=l.next_follow_up_at||'';
 document.getElementById('pfFollow').value=fu?String(fu).slice(0,16):'';
 const hasPhone=!!normalizeDial(l.phone||'');
 const hasEmail=!!(l.email||'').trim();
 const hasWeb=!!websiteHref(l.website||'');
 // R2: three primary actions in one row; extension actions (Estimate) join that row; the rest in More.
 const mi=function(act, label, icon, off, title){ return '<button type="button" class="menu-item'+(off?' is-off':'')+'" role="menuitem" data-act="'+act+'"'+(title?' title="'+title+'"':'')+'><svg class="ic" aria-hidden="true"><use href="#i-'+icon+'"/></svg>'+label+'</button>'; };
 document.getElementById('pfActBar').innerHTML=
 '<button type="button" class="btn p'+(hasPhone?'':' is-off')+'" data-act="call" title="Open phone dialer"><svg class="ic" aria-hidden="true"><use href="#i-phone"/></svg>Call</button>'+
 '<button type="button" class="btn'+(hasPhone?'':' is-off')+'" data-act="sms" title="Open SMS / copy text"><svg class="ic" aria-hidden="true"><use href="#i-message-square"/></svg>Text</button>'+
 '<button type="button" class="btn'+(hasEmail?'':' is-off')+'" data-act="email" title="Open email composer"><svg class="ic" aria-hidden="true"><use href="#i-mail"/></svg>Email</button>'+
 '<details class="menu act-more"><summary class="btn" aria-label="More lead actions"><svg class="ic" aria-hidden="true"><use href="#i-ellipsis"/></svg>More</summary><div class="menu-pop" role="menu" aria-label="More lead actions">'+
 mi('coach','Coach this lead','headphones')+mi('queue-draft','Queue email draft','send',false,'Create an email draft for human approval')+
 '<div class="menu-sep" role="separator"></div>'+
 mi('copy-phone','Copy phone','phone',!hasPhone)+mi('copy-email','Copy email','mail',!hasEmail)+mi('website','Open website','search',!hasWeb)+mi('maps','Open in Maps','map')+
 '</div></details>'+
 '<div class="act-msg" id="pfActMsg" role="status" aria-live="polite"></div>';
 wireProfileActBar();
 const enrichHint=hasPhone||hasEmail||wfs
 ? ('Working on: '+causeLabel(cat)+(hasPhone||hasEmail?' · contact on file':''))
 : 'No phone or email yet. Use Enrich contacts on the Leads page, or type them in below.';
 flashActMsg(enrichHint, hasPhone||hasEmail||wfs?'ok':'err');
 const pb=CATEGORY_PLAYBOOKS[cat]||CATEGORY_PLAYBOOKS.FrenchDrain;
 document.getElementById('pfPlaybook').innerHTML='<b>'+esc(pb.label)+'</b> <span class="badge">active cause</span><br>'+esc(pb.product||'')+
 '<span style="display:block;margin-top:6px"><b>Pricing:</b> '+esc(pb.pricing||'')+'</span>'+
 '<span style="display:block;margin-top:6px"><b>Close:</b> '+esc(pb.close||'')+'</span>'+
 '<span style="display:block;margin-top:6px"><b>Focus:</b> '+esc(pb.coach_focus||'')+'</span>';
 renderProfileTimeline(l);
 // Leads workspace: pipeline, phone chips, extension actions (18d-leads-drawer.js)
 if(window.FG&&FG.drawer){ try{ FG.drawer.paint(l); }catch(e){ console.error(e); } }
}
/** Pull latest server enrichment for one lead (phone/email/notes/DNS) into state. */
async function refreshLeadEnrichmentFromServer(l){
 const tok=getToken(); if(!tok||!l||!l.name) return false;
 if(window.FG&&FG.isServer&&FG.isServer()){
  // Server mode: one `get` for this lead instead of pulling the whole list
  const got=await FG.sync.get(l);
  if(!got||!got.lead) return false;
  FG.sync.takeServerCopy(l, got.lead);
  try{ localStorage.setItem(KEY,JSON.stringify(state)); }catch(e){}
  return true;
 }
 try{
 const r=await fetch('/crm/api/academy-leads',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'list'})});
 if(!r.ok) return false;
 const data=await r.json();
 const rows=Array.isArray(data.leads)?data.leads:[];
 // Same identity rule as the merge: uuid, parcel, then name+city+address (never another owner)
 const match=rows.find(function(raw){ return findLocalLeadFor(raw, [l])===l; });
 if(!match) return false;
 mergeServerLeads([match]);
 try{ localStorage.setItem(KEY,JSON.stringify(state)); }catch(e){}
 return true;
 }catch(e){ return false; }
}
function openProfile(id){
 const l=state.find(x=>x.id===id); if(!l) return;
 normalizeLead(l);
 profileLeadId=id;
 paintProfileForm(l);
 const bg=document.getElementById('profileDrawer');
 bg.classList.add('open'); bg.setAttribute('aria-hidden','false');
 // Re-pull enrichments so card always shows latest phone/email/score/notes after LeadAgent sync
 refreshLeadEnrichmentFromServer(l).then(function(ok){
 if(profileLeadId!==id) return;
 const fresh=state.find(x=>x.id===id);
 if(fresh){
 paintProfileForm(fresh);
 if(ok) render(); // list columns stay in sync with card
 }
 });
}
function renderProfileTimeline(l){
 if(window.FG&&FG.drawer&&FG.drawer.paintTimeline){ FG.drawer.paintTimeline(l); return; }
 const acts=activitiesForLead(l);
 const el=document.getElementById('pfTimeline');
 if(!acts.length){ el.innerHTML='<span class="hint">No activity yet. Log a call or note above.</span>'; return; }
 el.innerHTML=acts.map(function(a){
 var det=typeof a.detail==='string'?a.detail:((a.detail&&a.detail.text)||'');
 return '<div class="act-item"><div class="when">'+esc(String(a.at||'').replace('T',' ').slice(0,16))+' · '+esc(a.user||'')+' · '+esc(a.type)+(a.outcome?(' · '+esc(a.outcome)):'')+'</div>'+esc(det)+'</div>';
 }).join('');
}
function closeProfile(){
 profileLeadId=null;
 const bg=document.getElementById('profileDrawer');
 if(bg){ bg.classList.remove('open'); bg.setAttribute('aria-hidden','true'); }
}
function saveProfileFromForm(){
 const l=state.find(x=>x.id===profileLeadId); if(!l) return;
 const cause=activeCause(l);
 const prevStatus=getListStatus(l, cause);
 if(document.getElementById('pfAddress')) l.address=document.getElementById('pfAddress').value.trim();
 if(document.getElementById('pfCity')) l.city=document.getElementById('pfCity').value.trim();
 if(document.getElementById('pfZip')) l.zip=document.getElementById('pfZip').value.trim();
 if(document.getElementById('pfIndustry')) l.industry=document.getElementById('pfIndustry').value.trim();
 // parcel_id is read-only (from FSI / tax roll)
 const newPhone=document.getElementById('pfPhone').value.trim();
 if(phoneDigitsKey(newPhone)!==phoneDigitsKey(l.phone)){
  // DNC is per number: park the old primary's flag on its phones[] entry, then re-evaluate
  if(l.phone_dnc===true && l.phone) l.phones=mergePhoneLists(l.phones, [{number:l.phone, dnc:true, line_type:l.phone_line_type||'unknown', source:l.phone_source||'manual'}]);
  const e=(l.phones||[]).find(function(p){ return phoneDigitsKey(p.number)===phoneDigitsKey(newPhone); });
  l.phone_dnc=e&&e.dnc!=null?e.dnc:null;
 }
 l.phone=newPhone;
 l.email=document.getElementById('pfEmail').value.trim();
 l.contact=document.getElementById('pfContact').value.trim();
 l.owner=document.getElementById('pfOwner').value.trim();
 l.website=document.getElementById('pfWebsite').value.trim();
 // Status is for the active cause only
 setListStatus(l, cause, document.getElementById('pfStatus').value);
 l.package=document.getElementById('pfPackage').value.trim();
 const amt=document.getElementById('pfAmount').value;
 l.amount=amt===''?'':Number(amt);
 l.notes=document.getElementById('pfNotes').value.trim();
 const parsed=parseWfsFromNotes(l.notes);
 if(parsed) l.website_score=parsed;
 const fu=document.getElementById('pfFollow').value;
 l.next_follow_up_at=fu?new Date(fu).toISOString():'';
 if(!l.owner) l.owner=currentUserName()||'';
 // Sync cause checkboxes from profile panel first (mgmt/mnt depend on lists)
 const pfCauses=document.getElementById('pfCauses');
 if(pfCauses){
 const checked=[];
 pfCauses.querySelectorAll('input[data-cause]').forEach(function(inp){
 if(inp.checked) checked.push(inp.getAttribute('data-cause'));
 });
 if(checked.length) setLeadLists(l, checked, {touched:true});
 }
 // Management company
 if(leadLists(l).includes('PropertyMgmt')){
  const sel=document.getElementById('pfMgmtCompany');
  const mid=sel?sel.value:'';
  l.mgmt_company_id=mid||'';
  if(mid){
   const co=loadMgmtCompanies().find(function(c){ return String(c.id)===String(mid); });
   l.mgmt_company_name=co?co.name:'';
  } else l.mgmt_company_name='';
 } else {
  // keep stored values if unchecked? Clear for cleanliness when PM not worked
 }
 // Maintenance schedule
 if(leadLists(l).includes('Maintenance')){
  const lastEl=document.getElementById('pfMntLast');
  const freqEl=document.getElementById('pfMntFreq');
  const nextEl=document.getElementById('pfMntNext');
  const planEl=document.getElementById('pfMntPlan');
  l.maintenance_last_service=lastEl?lastEl.value:'';
  l.maintenance_frequency=freqEl?freqEl.value:'';
  l.maintenance_plan=planEl?planEl.value.trim():'';
  let next=nextEl?nextEl.value:'';
  if(!next && l.maintenance_last_service && l.maintenance_frequency){
   next=computeNextDue(l.maintenance_last_service, l.maintenance_frequency);
  }
  l.maintenance_next_due=next||'';
  // Auto-reminder: if next due is set and follow-up empty (or past), seed follow-up at 9am on due date
  if(l.maintenance_next_due){
   const due=parseYmd(l.maintenance_next_due);
   if(due){
    const hasFollow=!!String(l.next_follow_up_at||'').trim();
    let followPast=false;
    if(hasFollow){
     const fd=new Date(l.next_follow_up_at);
     followPast=!isNaN(fd.getTime()) && fd < new Date();
    }
    if(!hasFollow || followPast){
     due.setHours(9,0,0,0);
     const y=due.getFullYear(), mo=String(due.getMonth()+1).padStart(2,'0'), da=String(due.getDate()).padStart(2,'0');
     l.next_follow_up_at=y+'-'+mo+'-'+da+'T09:00';
     const fEl=document.getElementById('pfFollow');
     if(fEl) fEl.value=l.next_follow_up_at;
    }
   }
  }
 }
 refreshIndustryFilter();
 refreshCityFilter();
 saveLeads();
 const nextStatus=getListStatus(l, cause);
 if(prevStatus!==nextStatus){
 appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:'status',outcome:nextStatus,detail:{text:cause+' status -> '+nextStatus,amount:l.amount,package:l.package,cause:cause}});
 } else {
 appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:'note',detail:{text:'Profile saved',cause:cause}});
 }
 render(); openProfile(l.id);
}
function removeLeadFromCurrentList(){
 const l=state.find(x=>x.id===profileLeadId); if(!l) return;
 normalizeLead(l);
 const active=activeCause(l);
 if(!active||active==='All'){ if(window.FG&&FG.ready) FG.toast('Pick a cause tab (not All) to uncheck that cause.', {kind:'err'}); else alert('Pick a list tab (not All) to uncheck that cause.'); return; }
 const ok=toggleLeadCause(l, active, false);
 if(!ok) return;
 appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:'list_change',detail:{text:'Unchecked cause '+active,lists:leadLists(l)}});
 saveLeads();
 closeProfile();
 render(); refreshIndustryFilter(); refreshCityFilter();
}
async function deleteLeadForever(){
 const l=state.find(x=>x.id===profileLeadId); if(!l) return;
 if(typeof deleteLeadWithConfirm==='function'){ if(await deleteLeadWithConfirm(l)) closeProfile(); return; }
 if(!confirm('Permanently delete "'+l.name+'"? This cannot be undone.')) return;
 appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:'note',detail:{text:'Lead deleted'}});
 state=state.filter(x=>x.id!==l.id);
 saveLeads(); closeProfile(); render(); refreshIndustryFilter(); refreshCityFilter();
}
function logActivityFromForm(){
 const l=state.find(x=>x.id===profileLeadId); if(!l) return;
 const type=document.getElementById('pfLogType').value;
 const outcome=document.getElementById('pfLogOutcome').value;
 const text=document.getElementById('pfLogDetail').value.trim();
 appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:type,outcome:outcome,detail:{text:text}}).then(function(){
 document.getElementById('pfLogDetail').value='';
 if(outcome==='callback'&&(!l.status||l.status==='New'||l.status==='Called - no answer')) l.status='Callback';
 if(outcome==='interested') l.status='Interested';
 if(outcome==='quoted') l.status='Quoted';
 if(outcome==='deposit') l.status='Deposit collected';
 if(outcome==='not_interested') l.status='Not interested';
 if(outcome==='no_answer'&&(!l.status||l.status==='New')) l.status='Called - no answer';
 saveLeads();
 openProfile(l.id);
 });
}
function recordPractice(type, score, note){
 const list=loadPracticeLocal();
 list.push({user:currentUserName()||'local',type:type,score:score,note:note||'',at:new Date().toISOString()});
 savePracticeLocal(list);
 const tok=getToken();
 if(tok){
 fetch('/crm/api/academy-practice',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'append',event:{type:type,score:score,note:note}})}).catch(function(){});
 }
}
function computeRevenueMetrics(leads){
 const byRep={};
 let rev=0, won=0, lost=0, pipe=0, touched=0;
 for(let i=0;i<leads.length;i++){
 const l=leads[i];
 const owner=String(l.owner||'unassigned').toLowerCase();
 if(!byRep[owner]) byRep[owner]={owner:owner,rev:0,won:0,lost:0,pipe:0};
 const st=l.status||'';
 const amt=Number(l.amount)||0;
 if(st&&st!=='New') touched++;
 if(CLOSED_STATUSES.has(st)){ rev+=amt; won++; byRep[owner].rev+=amt; byRep[owner].won++; }
 else if(LOST_STATUSES.has(st)){ lost++; byRep[owner].lost++; }
 else if(PIPELINE_STATUSES.has(st)){ pipe+=amt; byRep[owner].pipe+=amt; }
 }
 const closePct=(won+lost)?Math.round(100*won/(won+lost)):null;
 const arr=[]; for(const k in byRep) arr.push(byRep[k]);
 return {rev:rev,won:won,lost:lost,pipe:pipe,touched:touched,closePct:closePct,byRep:arr};
}
function renderAdminCrm(){
 const m=computeRevenueMetrics(state);
 const elR=document.getElementById('kpiRevenue'); if(!elR) return;
 elR.textContent=money(m.rev);
 document.getElementById('kpiClosePct').textContent=m.closePct==null?'-':(m.closePct+'%');
 document.getElementById('kpiPipeline').textContent=money(m.pipe);
 document.getElementById('kpiTouched').textContent=String(m.touched);
 const tb=document.getElementById('adminRevTbody');
 if(tb){
 tb.innerHTML=m.byRep.length?m.byRep.map(function(r){
 const pct=(r.won+r.lost)?Math.round(100*r.won/(r.won+r.lost))+'%':'-';
 return '<tr><td>'+esc(r.owner)+'</td><td>'+money(r.rev)+'</td><td>'+r.won+'</td><td>'+r.lost+'</td><td>'+pct+'</td><td>'+money(r.pipe)+'</td></tr>';
 }).join(''):'<tr><td colspan="6" class="hint">No owner/deal data yet. Set owner + amount on closed leads in the profile.</td></tr>';
 }
 const pev=loadPracticeLocal();
 const by={};
 for(let i=0;i<pev.length;i++){
 const e=pev[i];
 const u=String(e.user||'local').toLowerCase();
 if(!by[u]) by[u]={user:u,n:0,scores:[],role:0,rev:0,last:''};
 by[u].n++;
 if(e.score!=null&&!isNaN(Number(e.score))) by[u].scores.push(Number(e.score));
 if(e.type==='roleplay') by[u].role++;
 if(e.type==='review') by[u].rev++;
 if(!by[u].last || e.at>by[u].last) by[u].last=e.at||'';
 }
 const ptb=document.getElementById('adminPracticeTbody');
 if(ptb){
 const rows=[]; for(const k in by) rows.push(by[k]);
 ptb.innerHTML=rows.length?rows.map(function(r){
 const avg=r.scores.length?Math.round(r.scores.reduce(function(a,b){return a+b;},0)/r.scores.length):'-';
 return '<tr><td>'+esc(r.user)+'</td><td>'+r.n+'</td><td>'+avg+'</td><td>'+r.role+'</td><td>'+r.rev+'</td><td>'+esc(String(r.last||'').replace('T',' ').slice(0,16))+'</td></tr>';
 }).join(''):'<tr><td colspan="6" class="hint">No practice scores yet. Finish a roleplay grade or pitch review.</td></tr>';
 }
}

const STATUSES=['','New','Called - no answer','Callback','Interested','Quoted','Deposit collected','Contract signed','Not interested','Archived','Do not contact'];

