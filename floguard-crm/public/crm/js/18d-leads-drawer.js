/* ================= LEADS NEXT (F1): lead drawer =================
 * Pipeline (stage + next action), per-number phone chips with call/text (blocked on DNC /
 * litigator), suggested phone offer, extension actions (FG.leadDrawer.addAction), merged
 * activity timeline, focus trap. paintProfileForm (02-crm-core.js) calls FG.drawer.paint(l). */
(function(){
'use strict';
const FG=window.FG; if(!FG) return;
const h=FG.h;
const D=FG.drawer={};
const $=function(id){ return document.getElementById(id); };
const bg=$('profileDrawer');
if(!bg) return;
const drawer=bg.querySelector('.drawer');

const SNOOZE=[['1h','1 hour'],['tomorrow','Tomorrow 9 AM'],['3d','In 3 days'],['1w','Next week']];
D.paint=function(l){
 if(!l) return;
 paintPipeline(l);
 paintPhones(l);
 D.paintExt(l);
 paintActBar(l);
};
D.refresh=function(l){ if(typeof paintProfileForm==='function') paintProfileForm(l); };
D.refreshIfOpen=function(l){ if(l && profileLeadId!=null && String(profileLeadId)===String(l.id)) D.refresh(l); };

/* ---- pipeline: stage + next action ---- */
function paintPipeline(l){
 const sel=$('pfStage'); if(!sel) return;
 const stage=FG.stageOf(l);
 sel.innerHTML=FG.STAGES.map(function(s){ return '<option value="'+s+'"'+(s===stage?' selected':'')+'>'+h(FG.STAGE_LABEL[s])+'</option>'; }).join('');
 sel.closest('.pl-stage')?.setAttribute('data-st', FG.stageTone(stage));
 const days=FG.daysInStage(l);
 const dd=$('pfStageDays');
 if(dd) dd.innerHTML=(days==null?'':'<span class="num">'+days+'</span> day'+(days===1?'':'s')+' in stage')+(l.stage?'':' <span class="hint">· derived from status</span>');
 const box=$('pfNext'); if(!box) return;
 const t=FG.tasks.of(l);
 const b=t?FG.dueBucket(t.due_at):null;
 box.innerHTML=
  '<div class="pl-next-cur'+(b?' '+b:'')+'">'+
   (t?('<span class="pl-next-ic">'+FG.icon(FG.TASK_ICON[t.type])+'</span><div><b>'+h(FG.TASK_LABEL[t.type])+' · '+h(FG.fmtDue(t.due_at))+'</b>'+(t.note?'<span>'+h(t.note)+'</span>':'')+(t.legacy?'<span class="hint">From the follow-up date</span>':'')+'</div>'+
     '<div class="pl-next-acts"><button type="button" class="btn btn--sm" id="pfNextDone">'+FG.icon('check')+'Done</button>'+
     '<details class="menu"><summary class="btn btn--sm">'+FG.icon('alarm-clock')+'Snooze</summary><div class="menu-pop" role="menu">'+SNOOZE.map(function(s){ return '<button type="button" class="menu-item" role="menuitem" data-pf-snooze="'+s[0]+'">'+s[1]+'</button>'; }).join('')+'</div></details></div>')
   :'<span class="pl-next-ic">'+FG.icon('calendar-clock')+'</span><div><b>No next action</b><span>Every open lead should have one.</span></div>')+
  '</div>'+
  '<details class="pl-edit"'+(t?'':' open')+'><summary>'+(t?'Change next action':'Set next action')+'</summary>'+
   FG.tasks.editorHtml(t||{type:'call', due_at:FG.at(1,10), note:''}, 'pfNa')+
   '<div class="btn-row mt-2"><button type="button" class="btn o btn--sm" id="pfNextSave">'+FG.icon('calendar-clock')+'Save next action</button>'+(t&&!t.legacy?'<button type="button" class="btn ghost btn--sm" id="pfNextClear">Clear</button>':'')+'</div>'+
  '</details>';
}
function item(l){ const t=FG.tasks.of(l); return t?{key:'d', task_id:t.task_id, lead:l, lead_name:l.name, type:t.type, due_at:t.due_at, note:t.note, legacy:t.legacy}:null; }
bg.addEventListener('change', function(e){
 if(e.target.id!=='pfStage') return;
 const l=FG.leadById(profileLeadId); if(!l) return;
 const to=e.target.value;
 FG.setStage(l, to, {via:'drawer'}).then(function(moved){ D.refresh(FG.leadById(l.id)||l); if(moved) setTimeout(function(){ $('pfStage')?.focus(); }, 0); });
});
bg.addEventListener('click', function(e){
 const l=profileLeadId!=null?FG.leadById(profileLeadId):null; if(!l) return;
 if(e.target.closest('#pfNextSave')){ const na=FG.tasks.readEditor($('pfNext'), 'pfNa'); if(na){ FG.tasks.setNext(l, na).then(function(){ FG.toast('Next action saved: '+FG.TASK_LABEL[na.type]+' '+FG.fmtDue(na.due_at)+'.', {kind:'ok'}); }); } return; }
 if(e.target.closest('#pfNextClear')){ FG.tasks.setNext(l, null); return; }
 if(e.target.closest('#pfNextDone')){ const it=item(l); if(it) FG.tasks.complete(it); return; }
 const sz=e.target.closest('[data-pf-snooze]'); if(sz){ sz.closest('details')?.removeAttribute('open'); const it=item(l); if(it) FG.tasks.snooze(it, sz.dataset.pfSnooze).then(function(){ D.refresh(l); }); return; }
 const ph=e.target.closest('[data-ph-act]');
 if(ph){
  const num=ph.closest('[data-num]')?.dataset.num||'';
  const act=ph.dataset.phAct;
  if(act==='call'||act==='text'){
   if(ph.getAttribute('aria-disabled')==='true'){ FG.dial.explainBlocked(l, FG.dial.findEntry(l, num), act); return; }
   FG.dial.start(l, num, act); return;
  }
  if(act==='dnc'){ FG.confirm({title:'Mark '+num+' as Do Not Call?', message:'Calling and texting this number will be blocked in the CRM for everyone.', confirmLabel:'Mark Do Not Call', danger:true}).then(function(ok){ if(ok) FG.phone.markDnc(l, num).then(function(){ D.refresh(l); }); }); return; }
  if(act==='primary'){ setPrimary(l, num); return; }
  if(act==='copy'){ copyText(num).then(function(ok){ FG.toast(ok?'Copied '+num+'.':'Could not copy.', {kind:ok?'ok':'err'}); }); return; }
 }
 if(e.target.closest('#pfUseSuggested')){ setPrimary(l, l.suggested_phone); return; }
 const ext=e.target.closest('[data-ext-action]');
 if(ext){
  const a=FG.leadDrawer._actions.find(function(x){ return x.id===ext.dataset.extAction; });
  if(a){ try{ a.onClick(l); }catch(err){ console.error(err); FG.toast('That action failed: '+(err.message||err), {kind:'err'}); } }
 }
});
/** Make a number the primary. DNC on the old primary is kept on its phones[] entry. */
async function setPrimary(l, num){
 if(!num) return;
 const k=FG.phone.digits(num);
 const phones=FG.phone.list(l).map(function(p){ const c=Object.assign({},p); delete c.primary; return c; });
 if(!phones.some(function(p){ return FG.phone.digits(p.number)===k; })) phones.push({number:num, line_type:'unknown', dnc:null, litigator:null, source:'manual', confidence:null, found_at:new Date().toISOString()});
 const e=phones.find(function(p){ return FG.phone.digits(p.number)===k; });
 const fields={phone:num, phones:phones, phone_dnc:e.dnc==null?null:e.dnc, phone_line_type:e.line_type||null, phone_source:e.source||null, phone_confidence:e.confidence==null?null:e.confidence};
 if(FG.phone.digits(l.suggested_phone)===k) fields.suggested_phone=null;
 await FG.sync.patch(l, fields);
 FG.activity.log(l, {type:'note', body:'Primary phone set to '+num});
 render(); D.refresh(l);
 FG.toast('Primary phone: '+num+'.', {kind:'ok'});
}
FG.phone.setPrimary=setPrimary;

/* ---- phones ---- */
function paintPhones(l){
 const box=$('pfPhones'); if(!box) return;
 const list=FG.phone.list(l);
 const st=$('pfEnrichState');
 if(st){
  const bits=[];
  if(l.enrich_status==='blocked') bits.push('<span class="ph-chip bad" title="Numbers were found but every one is DNC or a litigator">Enrichment: blocked</span>');
  if(l.enriched_at) bits.push('<span class="ph-chip" title="'+h(l.enriched_at)+'">Enriched '+h(FG.fmtWhen(l.enriched_at))+'</span>');
  st.innerHTML=bits.join('');
 }
 let html='';
 if(!list.length){
  html='<div class="ph-empty">'+FG.icon('phone-off')+'<div><b>No phone on file</b><span>The tax roll has none. Run <b>Enrich contacts</b> or type a number in Contact &amp; deal.</span></div></div>';
 } else {
  html='<ul class="ph-list">'+list.map(function(p){
   const s=FG.phone.state(p, l);
   const why=h(s.reason+' Send mail or a door hanger instead.');
   const btn=function(kind, icon, label){
    return s.blocked
     ? '<button type="button" class="btn btn--sm" data-ph-act="'+kind+'" aria-disabled="true" title="'+why+'">'+FG.icon(icon)+label+'</button>'
     : '<button type="button" class="btn btn--sm'+(kind==='call'?' o':'')+'" data-ph-act="'+kind+'" title="'+h(label+' '+p.number)+'">'+FG.icon(icon)+label+'</button>';
   };
   return '<li class="ph-row'+(s.blocked?' is-blocked':'')+'" data-num="'+h(p.number)+'">'+
    '<div class="ph-num"><b class="num">'+h(p.number)+'</b>'+(p.primary?'<span class="ph-chip pri">Primary</span>':'')+'</div>'+
    '<div class="ph-chips">'+FG.phone.chips(p, l, {full:true})+'</div>'+
    (s.blocked?'<div class="ph-why">'+FG.icon('ban')+'<span>'+h(s.reason)+' <b>Next step: send mail or a door hanger.</b></span></div>':(s.scrub==='unscrubbed'?'<div class="ph-why warn">'+FG.icon('triangle-alert')+'<span>Not scrubbed against DNC. You will be asked to confirm before dialing.</span></div>':''))+
    '<div class="ph-acts">'+btn('call','phone','Call')+btn('text','message-square','Text')+
     '<button type="button" class="btn btn--sm ghost" data-ph-act="copy" aria-label="Copy '+h(p.number)+'">Copy</button>'+
     (!p.primary&&!s.blocked?'<button type="button" class="btn btn--sm ghost" data-ph-act="primary">Make primary</button>':'')+
     (p.dnc!==true?'<button type="button" class="btn btn--sm ghost danger-text" data-ph-act="dnc">Mark DNC</button>':'')+
    '</div></li>';
  }).join('')+'</ul>';
 }
 if(l.suggested_phone && FG.phone.digits(l.suggested_phone)!==FG.phone.digits(l.phone)){
  html+='<div class="ph-suggest">'+FG.icon('sparkles')+'<span>Enrichment found a better number: <b class="num">'+h(l.suggested_phone)+'</b></span><button type="button" class="btn btn--sm" id="pfUseSuggested">Use it</button></div>';
 }
 if(Array.isArray(l.enrich_warnings) && l.enrich_warnings.length){
  html+='<details class="ph-warn"><summary>'+l.enrich_warnings.length+' enrichment note'+(l.enrich_warnings.length===1?'':'s')+'</summary><ul>'+l.enrich_warnings.map(function(w){ return '<li>'+h(w)+'</li>'; }).join('')+'</ul></details>';
 }
 box.innerHTML=html;
}

/* ---- action bar: Call/Text follow the primary number's DNC state ---- */
function paintActBar(l){
 const bar=$('pfActBar'); if(!bar) return;
 const p=FG.phone.primary(l);
 ['call','sms'].forEach(function(act){
  const b=bar.querySelector('[data-act="'+act+'"]'); if(!b) return;
  if(!p) return;
  const s=FG.phone.state(p, l);
  if(s.blocked){
   b.setAttribute('aria-disabled','true');
   b.classList.add('is-blocked');
   b.title=s.reason+' Send mail or a door hanger instead.';
   if(!b.querySelector('.ic')) b.insertAdjacentHTML('afterbegin', FG.icon('ban'));
  }
 });
 if(p && FG.phone.state(p,l).blocked && !bar.querySelector('.act-blocked')){
  const msg=document.createElement('div');
  msg.className='act-blocked';
  msg.innerHTML=FG.icon('ban')+'<span>Primary number is '+(p.dnc===true?'on the DNC registry':'blocked')+'. Calls and texts are off. <b>Send mail or a door hanger instead.</b></span>';
  const am=bar.querySelector('#pfActMsg');
  bar.insertBefore(msg, am||null);
 }
}

/* ---- extension actions (other agents: FG.leadDrawer.addAction) ---- */
D.paintExt=function(l){
 const box=$('pfExtActions'); if(!box) return;
 const acts=FG.leadDrawer._actions;
 box.hidden=!acts.length;
 box.innerHTML=acts.map(function(a){
  return '<button type="button" class="btn btn--sm'+(a.kind==='p'?' p':a.kind==='o'?' o':'')+'" data-ext-action="'+h(a.id)+'"'+(a.title?' title="'+h(a.title)+'"':'')+'>'+(a.icon?FG.icon(a.icon):'')+h(a.label)+'</button>';
 }).join('');
};

/* ---- timeline ---- */
const TL_ICON={call:'phone', text:'message-square', email:'mail', note:'list-todo', stage_change:'kanban', enrich:'sparkles', visit:'house', system:'info', list_change:'list-filter'};
const TL_LABEL={call:'Call', text:'Text', email:'Email', note:'Note', stage_change:'Stage', enrich:'Enrichment', visit:'Visit', system:'System', list_change:'Causes'};
const OUT_LABEL={}; FG.OUTCOMES.forEach(function(o){ OUT_LABEL[o.id]=o.label; });
Object.assign(OUT_LABEL, {attempted:'Attempted', opened:'Opened', draft_queued:'Draft queued', no_answer:'No answer', left_vm:'Left voicemail', callback:'Callback', interested:'Interested', quoted:'Quoted', deposit:'Deposit', not_interested:'Not interested', wrong_number:'Wrong number'});
function tlRow(a){
 const ty=TL_ICON[a.type]?a.type:'note';
 let title=TL_LABEL[ty]||a.type;
 if(a.outcome && !(a.type==='stage_change')) title+=' · '+(OUT_LABEL[a.outcome]||a.outcome);
 let body=a.body||'';
 if(a.type==='stage_change' && a.meta && a.meta.from && a.meta.to){ body=(FG.STAGE_LABEL[a.meta.from]||a.meta.from)+' → '+(FG.STAGE_LABEL[a.meta.to]||a.meta.to); }
 if(a.outcome && OUT_LABEL[a.outcome] && body.indexOf(OUT_LABEL[a.outcome])===0) body=body.slice(OUT_LABEL[a.outcome].length).replace(/^\s*·\s*/,'');
 return '<li class="tl-item t-'+h(ty)+(a.outcome?' o-'+h(a.outcome):'')+'"><span class="tl-ic">'+FG.icon(TL_ICON[ty])+'</span><div class="tl-body"><div class="tl-title">'+h(title)+'</div>'+(body?'<div class="tl-text">'+h(body)+'</div>':'')+'<div class="tl-meta">'+h(FG.fmtWhen(a.at))+(a.actor?' · '+h(a.actor):'')+(a.source==='local'&&FG.isServer()?' · <span title="Saved on this device">local</span>':'')+'</div></div></li>';
}
let tlSeq=0;
D.paintTimeline=function(l){
 const el=$('pfTimeline'); if(!el||!l) return;
 const seq=++tlSeq;
 const paint=function(list, loading){
  if(seq!==tlSeq) return;
  if(!list.length){ el.innerHTML='<div class="tl-empty">'+(loading?'Loading activity…':'No activity yet. Calls, texts, notes and stage changes show up here.')+'</div>'; return; }
  el.innerHTML='<ol class="tl">'+list.slice(0,80).map(tlRow).join('')+'</ol>'+(loading?'<div class="tl-loading hint">Loading server history…</div>':'');
 };
 const local=FG.activity.local(l).sort(function(a,b){ return String(b.at).localeCompare(String(a.at)); });
 const willLoad=FG.isServer() && !!(l.uuid||l.server_id!=null);
 paint(local, willLoad);
 if(willLoad) FG.activity.list(l).then(function(list){ paint(list, false); });
};
document.addEventListener('fg:activity', function(e){ const l=e.detail&&e.detail.lead; if(l && profileLeadId!=null && String(profileLeadId)===String(l.id)) D.paintTimeline(l); });
document.addEventListener('fg:activity-synced', function(e){ const l=e.detail&&e.detail.lead; if(l && profileLeadId!=null && String(profileLeadId)===String(l.id)) D.paintTimeline(l); });

/* ---- quick note on the timeline ---- */
bg.addEventListener('submit', function(e){
 if(e.target.id!=='pfQuickNote') return;
 e.preventDefault();
 const l=FG.leadById(profileLeadId); if(!l) return;
 const inp=$('pfQuickNoteText'); const v=(inp.value||'').trim(); if(!v) return;
 inp.value='';
 FG.activity.log(l, {type:'note', body:v});
});

/* ---- focus trap (Tab stays inside the open drawer) ---- */
bg.addEventListener('keydown', function(e){
 if(!bg.classList.contains('open') || FG.modalOpen()) return;
 FG.trapTab(drawer, e);
});
})();
