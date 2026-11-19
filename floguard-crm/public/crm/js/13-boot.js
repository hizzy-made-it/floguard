/* ================= INIT ================= */
(async function boot(){
 const ok=await bootAuth();
 if(!ok) return;
 // Pull shared store FIRST so LeadAgent enrichments (phone/web/email) appear
 await hydrateLeadsFromServer();
 refreshIndustryFilter(); refreshCityFilter(); render();
 ['coach','roleplay','review'].forEach(restore);
 updateTokenPill();
 setAdminNav(currentUser);
 if(currentUser&&currentUser.locked) showUsageLock();
 // Push only after hydrate so we do not race stale localStorage over fresh contacts
 pushLeadsToServer();
})();
// Manual pull: click the Sync pill
document.getElementById('syncPill')?.addEventListener('click', async function(){
 if(!getToken()){ setSyncPill('signedout'); return; }
 await hydrateLeadsFromServer();
 render();
});
document.getElementById('syncPill')?.setAttribute('title','Click to re-pull shared leads (LeadAgent enrichments)');
document.getElementById('syncPill')&&(document.getElementById('syncPill').style.cursor='pointer');

/* profile drawer wires */
(function(){
 const bg=document.getElementById('profileDrawer');
 if(!bg) return;
 document.getElementById('pfClose')?.addEventListener('click', closeProfile);
 bg.addEventListener('click', e=>{ if(e.target===bg) closeProfile(); });
 document.getElementById('pfSave')?.addEventListener('click', saveProfileFromForm);
 document.getElementById('pfRemoveList')?.addEventListener('click', removeLeadFromCurrentList);
 document.getElementById('pfDelete')?.addEventListener('click', deleteLeadForever);
 document.getElementById('pfLogSave')?.addEventListener('click', logActivityFromForm);
 // Live cause checkboxes in profile
 bg.addEventListener('change', function(e){
 if(!e.target.matches || !e.target.matches('input[data-profile-cause]')) return;
 const l=state.find(x=>x.id===profileLeadId); if(!l) return;
 const cause=e.target.getAttribute('data-cause');
 const ok=toggleLeadCause(l, cause, e.target.checked);
 if(!ok){ e.target.checked=!e.target.checked; return; }
 appendActivity({lead_id:l.id,lead_key:leadKeyOf(l),type:'list_change',detail:{text:(e.target.checked?'Checked':'Unchecked')+' '+cause,lists:leadLists(l)}});
 saveLeads();
 render();
 openProfile(l.id);
 });
 // Management company: + New / save / cancel
 document.getElementById('pfMgmtAddBtn')?.addEventListener('click', function(){
  document.getElementById('pfMgmtNew')?.classList.add('on');
  document.getElementById('pfMgmtNewName')?.focus();
 });
 document.getElementById('pfMgmtCancelNew')?.addEventListener('click', function(){
  document.getElementById('pfMgmtNew')?.classList.remove('on');
 });
 document.getElementById('pfMgmtSaveNew')?.addEventListener('click', function(){
  const name=(document.getElementById('pfMgmtNewName')?.value||'').trim();
  if(!name){ alert('Enter a management company name.'); return; }
  const row=addMgmtCompany({
   name:name,
   phone:(document.getElementById('pfMgmtNewPhone')?.value||'').trim(),
   contact:(document.getElementById('pfMgmtNewContact')?.value||'').trim()
  });
  if(!row) return;
  fillMgmtSelect(document.getElementById('pfMgmtCompany'), row.id);
  document.getElementById('pfMgmtNew')?.classList.remove('on');
  ['pfMgmtNewName','pfMgmtNewPhone','pfMgmtNewContact'].forEach(function(id){
   const el=document.getElementById(id); if(el) el.value='';
  });
  // Persist onto open lead immediately
  const l=state.find(function(x){ return x.id===profileLeadId; });
  if(l){
   l.mgmt_company_id=row.id;
   l.mgmt_company_name=row.name;
   if(!leadLists(l).includes('PropertyMgmt')) toggleLeadCause(l, 'PropertyMgmt', true);
   saveLeads(); render();
  }
 });
 // Maintenance: auto-fill next due when last + freq change and next empty
 function maybeFillNextDue(){
  const last=document.getElementById('pfMntLast')?.value||'';
  const freq=document.getElementById('pfMntFreq')?.value||'';
  const nextEl=document.getElementById('pfMntNext');
  if(!nextEl||nextEl.value) return;
  const n=computeNextDue(last, freq);
  if(n) nextEl.value=n;
 }
 document.getElementById('pfMntLast')?.addEventListener('change', maybeFillNextDue);
 document.getElementById('pfMntFreq')?.addEventListener('change', maybeFillNextDue);
 document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){
   closeProfile();
   closeNavMenu();
  }
 });
})();

