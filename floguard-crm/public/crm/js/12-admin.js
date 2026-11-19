/* ================= USAGE + ADMIN ================= */
function updateTokenPill(){
 const el=document.getElementById('tokenPill'); if(!el||!currentUser) return;
 const u=currentUser.tokens_used||0, lim=currentUser.tokens_limit||50000;
 el.textContent='Tokens: '+u.toLocaleString()+' / '+lim.toLocaleString();
 el.className='tokenpill'+(currentUser.locked||u>=lim?' lock':(u/lim>0.8?' warn':''));
}
function showUsageLock(){
 const box=document.getElementById('usageLock'); if(box) box.classList.add('on');
 const m=document.getElementById('lockMsg');
 if(m&&currentUser) m.textContent='Used '+(currentUser.tokens_used||0).toLocaleString()+' of '+(currentUser.tokens_limit||50000).toLocaleString()+' tokens. AI is paused until an admin approves more usage.';
}
function hideUsageLock(){ const box=document.getElementById('usageLock'); if(box) box.classList.remove('on'); }
document.getElementById('lockDismissBtn')?.addEventListener('click',hideUsageLock);
document.getElementById('requestUnlockBtn')?.addEventListener('click',async ()=>{
 const st=document.getElementById('lockStatus');
 try{
 await authApi('request_unlock',{token:getToken()});
 if(st){ st.textContent='Request sent. An admin will review your account.'; st.style.color='#0d7d6f'; }
 }catch(e){ if(st){ st.textContent=e.message||'Request failed'; st.style.color='#b23'; } }
});

function isAdminUser(user){
 if(!user) return false;
 const r=String(user.role||'').toLowerCase();
 return r==='admin'||r==='owner';
}
function setAdminNav(user){
 const b=document.getElementById('navAdmin');
 if(!b) return;
 if(isAdminUser(user)){ b.style.display=''; b.classList.remove('hidden'); }
 else { b.style.display='none'; b.classList.add('hidden'); }
}

/** Admin API — POST /api/academy-admin { action, ... } */
async function adminFetch(action, payload={}){
 const r=await fetch('/crm/api/academy-admin',{
 method:'POST',
 headers:{'Content-Type':'application/json','Authorization':'Bearer '+(getToken()||'')},
 body:JSON.stringify({action,...payload})
 });
 const raw=await r.text(); let data=null; try{data=JSON.parse(raw);}catch(e){}
 if(!r.ok){
 const err=(data&&(data.detail?.message||data.detail||data.error))||('Error '+r.status);
 throw new Error(typeof err==='string'?err:JSON.stringify(err));
 }
 return data;
}
function fmtNum(n){ const x=Number(n); return (isFinite(x)?x:0).toLocaleString(); }
async function loadAdmin(){
 const msg=document.getElementById('adminMsg');
 if(!isAdminUser(currentUser)){
 if(msg) msg.textContent='Admin role required. Your account: '+(currentUser&&currentUser.role||'rep');
 return;
 }
 try{
 try{ renderAdminCrm(); }catch(e){}
 const sum=await adminFetch('summary');
 document.getElementById('admUsers').textContent=fmtNum(sum.users);
 document.getElementById('admTokens').textContent=fmtNum(sum.total_tokens);
 document.getElementById('admLocked').textContent=fmtNum(sum.locked_users)+(sum.pending_approvals?(' · '+sum.pending_approvals+' pending'):'');
 document.getElementById('admCalls').textContent=fmtNum(sum.ai_calls_today);
 const {users}=await adminFetch('users');
 const tb=document.getElementById('adminTbody');
 tb.innerHTML=users.map(u=>{
 const pct=Math.min(100, Math.round(100*(u.tokens_used||0)/Math.max(1,u.tokens_limit||1)));
 const barCls=u.locked?'lock':(pct>80?'warn':'');
 return `<tr data-uid="${esc(u.id)}">
 <td><b>${esc(u.username)}</b>${u.unlock_requested?' · <span style="color:var(--accent)">wants unlock</span>':''}</td>
 <td>${esc(u.role||'rep')}</td>
 <td>${fmtNum(u.tokens_used)} / ${fmtNum(u.tokens_limit)}</td>
 <td><div class="bar ${barCls}"><i style="width:${pct}%"></i></div></td>
 <td>${u.locked?'Yes':'No'}</td>
 <td>${fmtNum(u.leads_count)}</td>
 <td>${esc((u.last_seen||u.last_login_at||'').toString().slice(0,19).replace('T',' '))}</td>
 <td style="white-space:nowrap">
 <button class="btn" data-act="detail">Detail</button>
 <button class="btn p" data-act="approve">Approve +50k</button>
 </td></tr>`;
 }).join('')||'<tr><td colspan="8">No users yet</td></tr>';
 if(msg) msg.textContent='Updated '+new Date().toLocaleTimeString()+(sum.admin?(' · signed in as '+sum.admin.username):'');
 }catch(e){ if(msg) msg.textContent=e.message||String(e); }
}
document.getElementById('adminRefresh')?.addEventListener('click',loadAdmin);
document.getElementById('adminTbody')?.addEventListener('click',async e=>{
 const btn=e.target.closest('button'); if(!btn) return;
 const tr=e.target.closest('tr'); const uid=tr?.dataset.uid; if(!uid) return;
 if(btn.dataset.act==='detail'){
 try{
 const d=await adminFetch('user_detail',{user_id:uid});
 const box=document.getElementById('adminDetail'); box.style.display='block';
 document.getElementById('adminDetailTitle').textContent=d.user.username+' · detail';
 const days=Object.entries(d.usage_by_day||{}).sort((a,b)=>a[0]<b[0]?1:-1).slice(0,14)
 .map(([day,tok])=>`${esc(day)}: ${fmtNum(tok)} tokens`).join('<br>')||'No usage yet';
 const modes=Object.entries(d.mode_counts||{}).map(([m,c])=>`${m}: ${c}`).join(' · ')||'—';
 const lists=Object.entries(d.leads_by_list||{}).map(([m,c])=>`${m}: ${c}`).join(' · ')||'—';
 const ev=(d.events||[]).slice(0,15).map(x=>`${esc(String(x.ts||'').slice(0,19))} · ${esc(x.mode||x.kind||'chat')} · ${fmtNum(x.tokens)} tok`).join('<br>')||'—';
 document.getElementById('adminDetailBody').innerHTML=
 `<p><b>Tokens:</b> ${fmtNum(d.user.tokens_used)} / ${fmtNum(d.user.tokens_limit)} · ${d.user.locked?'Locked':'Active'} · role ${esc(d.user.role)}</p>
 <p><b>AI modes:</b> ${esc(modes)}</p>
 <p><b>Leads owned:</b> ${fmtNum(d.leads_count)} · ${esc(lists)}</p>
 <p><b>Usage by day</b><br>${days}</p>
 <p><b>Recent AI events</b><br>${ev}</p>`;
 }catch(err){ fgNotify(err.message||err, 'err'); }
 }
 if(btn.dataset.act==='approve'){
 if(btn.disabled) return;
 const pin=await FG.prompt({title:'Approve 50,000 more tokens', label:'Admin PIN', type:'password', confirmLabel:'Approve', hint:'Raises this user\'s limit by 50,000 tokens and unlocks the account.'});
 if(!pin) return;
 btn.disabled=true;
 try{
 await adminFetch('approve',{user_id:uid,admin_pin:pin});
 await loadAdmin();
 fgNotify('Approved. Token limit raised and account unlocked.', 'ok');
 }catch(err){ fgNotify(err.message||err, 'err'); }
 finally{ btn.disabled=false; }
 }
});
// load admin when opening tab
const _nav=document.getElementById('nav');
_nav?.addEventListener('click',e=>{
 const b=e.target.closest('button');
 if(b&&b.dataset.p==='admin'){ try{ renderAdminCrm(); }catch(err){} loadAdmin(); }
});

