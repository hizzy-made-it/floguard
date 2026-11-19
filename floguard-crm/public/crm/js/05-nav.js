/* ================= NAV ================= */
function setNavOpen(open){
 const nav=document.getElementById('nav');
 const btn=document.getElementById('navToggle');
 if(nav) nav.classList.toggle('open', !!open);
 if(btn){
  btn.setAttribute('aria-expanded', open?'true':'false');
  btn.setAttribute('aria-label', open?'Close menu':'Open menu');
  btn.textContent=open?'✕':'☰';
 }
}
function closeNavMenu(){ setNavOpen(false); }
document.getElementById('navToggle')?.addEventListener('click',function(e){
 e.stopPropagation();
 const nav=document.getElementById('nav');
 setNavOpen(!(nav&&nav.classList.contains('open')));
});
document.getElementById('nav').addEventListener('click',e=>{
 const b=e.target.closest('button'); if(!b) return;
 [...document.querySelectorAll('#nav button')].forEach(x=>x.classList.toggle('on',x===b));
 [...document.querySelectorAll('.panel')].forEach(p=>p.classList.toggle('on',p.id==='p-'+b.dataset.p));
 closeNavMenu();
 // Resize map after tab show (mobile layout)
 if(b.dataset.p==='fsi' && typeof _fsiMap!=='undefined' && _fsiMap){
  setTimeout(function(){ try{ _fsiMap.resize(); }catch(err){} }, 80);
 }
});
document.addEventListener('click',function(e){
 const nav=document.getElementById('nav');
 const btn=document.getElementById('navToggle');
 if(!nav||!nav.classList.contains('open')) return;
 if(nav.contains(e.target)||(btn&&btn.contains(e.target))) return;
 closeNavMenu();
});
window.addEventListener('resize',function(){
 // Desktop width: force nav visible state clean (CSS handles display)
 if(window.matchMedia('(min-width:901px) and (min-height:561px)').matches){
  // keep open class off so portrait re-entry starts closed
  closeNavMenu();
 }
 if(typeof _fsiMap!=='undefined' && _fsiMap){
  try{ _fsiMap.resize(); }catch(err){}
 }
});
function goTab(name){ if(name==='admin'){ try{ renderAdminCrm(); }catch(e){} } const b=document.querySelector(`#nav button[data-p="${name}"]`); if(b) b.click(); }

