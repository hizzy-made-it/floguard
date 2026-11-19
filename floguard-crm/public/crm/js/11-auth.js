/* ================= AUTH (username + PIN) ================= */
const AUTHKEY='floguard_desk_auth_v1';
let authMode='login';
let currentUser=null;
function getToken(){ try{return (JSON.parse(localStorage.getItem(AUTHKEY))||{}).token||'';}catch(e){return '';} }
function getAuth(){ try{return JSON.parse(localStorage.getItem(AUTHKEY))||null;}catch(e){return null;} }
function setAuth(data){ if(!data) localStorage.removeItem(AUTHKEY); else localStorage.setItem(AUTHKEY,JSON.stringify(data)); }
function showApp(user){
 currentUser=user;
 document.getElementById('loginGate').classList.add('hidden');
 document.getElementById('appRoot').classList.remove('hidden');
 const n=document.getElementById('userName'); if(n) n.textContent=user.username||'—';
 updateTokenPill();
 setAdminNav(user);
 if(user&&user.locked) showUsageLock(); else hideUsageLock();
 loadCoachKnowledge();
 // Hydrate is awaited from boot() so localStorage does not paint stale contacts
}
function showLogin(msg){
 currentUser=null;
 document.getElementById('loginGate').classList.remove('hidden');
 document.getElementById('appRoot').classList.add('hidden');
 if(msg){ const m=document.getElementById('authMsg'); m.textContent=msg; m.className='login-msg'; }
}
async function authApi(action, payload={}){
 const r=await fetch('/crm/api/academy-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
 const t=await r.text(); let data=null; try{data=JSON.parse(t);}catch(e){}
 if(!r.ok) throw new Error((data&&data.error)||('Auth error '+r.status));
 return data;
}
async function bootAuth(){
 const saved=getAuth();
 if(saved&&saved.token){
 try{
 const me=await authApi('me',{token:saved.token});
 setAuth({token:saved.token,user:me.user});
 showApp(me.user);
 return true;
 }catch(e){ setAuth(null); }
 }
 showLogin();
 return false;
}
document.getElementById('authTabs').addEventListener('click',e=>{
 const b=e.target.closest('button'); if(!b) return;
 authMode=b.dataset.mode;
 [...document.querySelectorAll('#authTabs button')].forEach(x=>x.classList.toggle('on',x===b));
 document.getElementById('authSubmit').textContent=authMode==='register'?'Create account':'Sign in';
 document.getElementById('authMsg').textContent='';
});
document.getElementById('authSubmit').addEventListener('click',async ()=>{
 const username=document.getElementById('authUser').value.trim();
 const pin=document.getElementById('authPin').value.trim();
 const msg=document.getElementById('authMsg');
 msg.className='login-msg';
 if(!username||!pin){ msg.textContent='Enter a username and PIN.'; return; }
 if(!/^\d{4,12}$/.test(pin)){ msg.textContent='PIN must be 4–12 digits (numbers only).'; return; }
 document.getElementById('authSubmit').disabled=true;
 try{
 const data=await authApi(authMode,{username,pin});
 setAuth({token:data.token,user:data.user});
 msg.className='login-msg ok';
 msg.textContent=authMode==='register'?'Account created. Welcome!':'Welcome back.';
 showApp(data.user);
 }catch(err){
 msg.textContent=err.message||'Login failed';
 }finally{
 document.getElementById('authSubmit').disabled=false;
 }
});
document.getElementById('authPin').addEventListener('keydown',e=>{ if(e.key==='Enter') document.getElementById('authSubmit').click(); });
document.getElementById('authUser').addEventListener('keydown',e=>{ if(e.key==='Enter') document.getElementById('authPin').focus(); });
document.getElementById('logoutBtn').addEventListener('click',()=>{
 setAuth(null);
 showLogin('Signed out.');
 document.getElementById('authPin').value='';
});

