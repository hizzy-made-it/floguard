/* Outbound drafts desk */
let _draftsCache=[];
let _draftSelectedId=null;
async function draftsApi(payload){
 const tok=getToken();
 if(!tok) throw new Error('Sign in required');
 const r=await fetch('/crm/api/academy-drafts',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify(payload)});
 const j=await r.json().catch(function(){return {};});
 if(!r.ok) throw new Error(j.error||j.detail||('HTTP '+r.status));
 return j;
}
async function loadDrafts(){
 const status=document.getElementById('draftFilter')?.value||'';
 try{
 const j=await draftsApi({action:'list', limit:200, status:status||undefined});
 _draftsCache=j.drafts||[];
 renderDraftsTable();
 document.getElementById('draftStats').innerHTML='Showing <b>'+_draftsCache.length+'</b> · backend <b>'+(j.backend||'?')+'</b>';
 }catch(e){
 document.getElementById('draftStats').textContent='Error: '+(e.message||e);
 document.getElementById('draftTbody').innerHTML='';
 }
}
function renderDraftsTable(){
 const tb=document.getElementById('draftTbody');
 if(!tb) return;
 if(!_draftsCache.length){ tb.innerHTML='<tr><td colspan="5" class="hint">No drafts yet. Queue one from a lead profile or the form above.</td></tr>'; return; }
 tb.innerHTML=_draftsCache.map(function(d){
 const when=String(d.created_at||d.updated_at||'').replace('T',' ').slice(0,16);
 const lead=esc((d.meta&&d.meta.name)||d.lead_key||d.lead_id||'—');
 const sub=esc((d.subject||'').slice(0,60));
 const st=esc(d.status||'');
 return '<tr data-did="'+esc(String(d.id))+'"><td>'+esc(when)+'</td><td>'+lead+'</td><td>'+sub+'</td><td>'+st+'</td><td><button type="button" class="coachbtn draft-open">Open</button></td></tr>';
 }).join('');
}
function openDraftDetail(id){
 const d=_draftsCache.find(function(x){return String(x.id)===String(id);});
 if(!d) return;
 _draftSelectedId=id;
 const box=document.getElementById('draftDetail');
 box.style.display='block';
 document.getElementById('draftDetailTitle').textContent=(d.subject||'(no subject)')+' · '+(d.status||'');
 document.getElementById('draftDetailBody').textContent=
 'To: '+(d.meta&&d.meta.email?d.meta.email:'(no email)')+'\n'+
 'Lead: '+(d.lead_key||d.meta&&d.meta.name||'')+'\n'+
 'Status: '+(d.status||'')+'\n\n'+
 'Subject: '+(d.subject||'')+'\n\n'+
 (d.body||'')+
 (d.alternate_body?'\n\n--- alternate ---\n'+d.alternate_body:'')+
 (d.follow_up_body?'\n\n--- follow-up ---\n'+d.follow_up_body:'');
}
document.getElementById('draftRefresh')?.addEventListener('click', loadDrafts);
document.getElementById('draftFilter')?.addEventListener('change', loadDrafts);
document.getElementById('draftTbody')?.addEventListener('click', function(e){
 if(e.target.classList.contains('draft-open')){
 const tr=e.target.closest('tr'); if(tr) openDraftDetail(tr.dataset.did);
 }
});
document.getElementById('draftDetailClose')?.addEventListener('click', function(){ document.getElementById('draftDetail').style.display='none'; _draftSelectedId=null; });
document.getElementById('draftApprove')?.addEventListener('click', async function(){
 if(!_draftSelectedId) return;
 try{ await draftsApi({action:'approve', id:_draftSelectedId}); await loadDrafts(); openDraftDetail(_draftSelectedId); }catch(e){ alert(e.message); }
});
document.getElementById('draftReject')?.addEventListener('click', async function(){
 if(!_draftSelectedId) return;
 try{ await draftsApi({action:'reject', id:_draftSelectedId}); await loadDrafts(); openDraftDetail(_draftSelectedId); }catch(e){ alert(e.message); }
});
document.getElementById('draftMarkSent')?.addEventListener('click', async function(){
 if(!_draftSelectedId) return;
 try{ await draftsApi({action:'mark_sent', id:_draftSelectedId}); await loadDrafts(); openDraftDetail(_draftSelectedId); }catch(e){ alert(e.message); }
});
document.getElementById('draftCopy')?.addEventListener('click', async function(){
 const t=document.getElementById('draftDetailBody')?.textContent||'';
 try{ await navigator.clipboard.writeText(t); }catch(e){}
});
document.getElementById('draftCreate')?.addEventListener('click', async function(){
 const msg=document.getElementById('draftCreateMsg');
 try{
 const subject=document.getElementById('draftSubject').value.trim();
 const body=document.getElementById('draftBody').value.trim();
 const lead_key=document.getElementById('draftLeadKey').value.trim();
 if(!subject && !body){ msg.textContent='Add subject or body.'; return; }
 await draftsApi({action:'append', draft:{ subject, body, lead_key, channel:'email', meta:{name:lead_key} }});
 msg.textContent='Queued.';
 document.getElementById('draftBody').value='';
 document.getElementById('draftSubject').value='';
 await loadDrafts();
 }catch(e){ msg.textContent=e.message||String(e); }
});
// Load drafts / docs when tab opens
document.getElementById('nav')?.addEventListener('click', function(e){
 const b=e.target.closest('button');
 if(!b) return;
 if(b.dataset.p==='drafts') loadDrafts();
 if(b.dataset.p==='docs') loadDocsLibrary();
});

