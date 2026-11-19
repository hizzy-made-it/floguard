/* ================= APP SHELL (sidebar, tab bar, theme, menus) =================
 * Presentation-only glue for the redesigned shell. Loaded last; relies on globals from
 * earlier files (goTab, setNavOpen, closeNavMenu from 05-nav.js; _fsiMap from 16-fsi-map.js).
 * It never changes data or panel logic: the original #nav click handler still switches
 * panels; this file only mirrors that state (aria-current, top-bar title, tab bar). */
(function(){
 const root=document.documentElement;
 const nav=document.getElementById('nav');
 const tabbar=document.getElementById('tabbar');
 const TABBAR=['leads','fsi','drafts','coach'];

 /* ---- active nav mirror ---- */
 function syncNav(){
  if(!nav) return;
  const on=nav.querySelector('button[data-p].on');
  nav.querySelectorAll('button[data-p]').forEach(function(b){
   if(b===on) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  if(on){
   const t=document.getElementById('tbTitle'); if(t) t.textContent=(on.querySelector('span')||on).textContent.trim();
   const g=on.closest('.nav-group'); const lab=g&&g.querySelector('.nav-label');
   const s=document.getElementById('tbSection'); if(s) s.textContent=lab?lab.textContent.trim():'';
   root.setAttribute('data-panel', on.dataset.p);
  }
  if(tabbar){
   const p=on?on.dataset.p:'';
   tabbar.querySelectorAll('button[data-go]').forEach(function(b){
    const act=b.dataset.go===p || (b.dataset.go==='more' && p && TABBAR.indexOf(p)<0);
    b.classList.toggle('on', act);
    if(act&&b.dataset.go!=='more') b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
   });
  }
 }
 nav&&nav.addEventListener('click',function(e){
  if(!e.target.closest('button[data-p]')) return;
  syncNav();
  const main=document.getElementById('main');
  if(main&&window.matchMedia('(max-width:820px)').matches) window.scrollTo({top:0});
 });
 syncNav();

 /* ---- mobile drawer state (05-nav.js toggles #nav.open) ---- */
 if(nav&&window.MutationObserver){
  new MutationObserver(function(){
   const open=nav.classList.contains('open');
   root.classList.toggle('nav-open', open);
   if(open){ const f=nav.querySelector('button.on')||nav.querySelector('button'); f&&f.focus({preventScroll:true}); }
  }).observe(nav,{attributes:true,attributeFilter:['class']});
 }
 document.getElementById('sbClose')?.addEventListener('click',function(){ closeNavMenu(); document.getElementById('navToggle')?.focus(); });
 document.getElementById('navScrim')?.addEventListener('click',function(){ closeNavMenu(); });

 /* ---- bottom tab bar ---- */
 tabbar&&tabbar.addEventListener('click',function(e){
  const b=e.target.closest('button[data-go]'); if(!b) return;
  e.stopPropagation(); // keep 05-nav.js's outside-click closer from re-closing the drawer
  if(b.dataset.go==='more') setNavOpen(!nav.classList.contains('open'));
  else { closeNavMenu(); goTab(b.dataset.go); }
 });

 /* ---- sidebar collapse (desktop) ---- */
 const col=document.getElementById('sbCollapse');
 function paintCollapse(){
  const c=root.classList.contains('sb-collapsed');
  if(!col) return;
  col.setAttribute('aria-pressed', c?'true':'false');
  col.setAttribute('aria-label', c?'Expand sidebar':'Collapse sidebar');
  col.title=c?'Expand sidebar':'Collapse sidebar';
  const u=col.querySelector('use'); if(u) u.setAttribute('href', c?'#i-panel-left-open':'#i-panel-left-close');
  const s=col.querySelector('span'); if(s) s.textContent=c?'Expand':'Collapse';
 }
 col&&col.addEventListener('click',function(){
  const c=!root.classList.contains('sb-collapsed');
  root.classList.toggle('sb-collapsed', c);
  try{ localStorage.setItem('floguard_sidebar_collapsed', c?'1':'0'); }catch(e){}
  paintCollapse();
 });
 paintCollapse();

 /* ---- theme toggle ---- */
 const mq=window.matchMedia('(prefers-color-scheme: dark)');
 function effectiveTheme(){ return root.getAttribute('data-theme') || (mq.matches?'dark':'light'); }
 const tt=document.getElementById('themeToggle');
 function paintTheme(){
  if(!tt) return;
  const dark=effectiveTheme()==='dark';
  tt.setAttribute('aria-label', dark?'Switch to light theme':'Switch to dark theme');
  tt.title=dark?'Switch to light theme':'Switch to dark theme';
  const u=tt.querySelector('use'); if(u) u.setAttribute('href', dark?'#i-sun':'#i-moon');
 }
 tt&&tt.addEventListener('click',function(){
  const next=effectiveTheme()==='dark'?'light':'dark';
  root.setAttribute('data-theme', next);
  try{ localStorage.setItem('floguard_theme', next); }catch(e){}
  paintTheme();
 });
 mq.addEventListener&&mq.addEventListener('change', paintTheme);
 paintTheme();

 /* ---- overflow menus (<details class="menu">) ---- */
 function closeMenus(except){
  document.querySelectorAll('details.menu[open]').forEach(function(d){ if(d!==except) d.removeAttribute('open'); });
 }
 document.addEventListener('click',function(e){
  const d=e.target.closest('details.menu');
  if(e.target.closest('.menu-item')){ closeMenus(); return; }
  closeMenus(d);
 });
 document.addEventListener('keydown',function(e){
  if(e.key!=='Escape') return;
  const open=document.querySelector('details.menu[open]');
  if(open){ open.removeAttribute('open'); open.querySelector('summary')?.focus(); }
 });
 // Delegated (R2) so menus rendered later (lead drawer "More") behave the same as static ones.
 document.addEventListener('toggle',function(e){
  const d=e.target; if(!(d instanceof HTMLDetailsElement)||!d.classList.contains('menu')) return;
  const s=d.querySelector('summary'); if(s) s.setAttribute('aria-expanded', d.open?'true':'false');
  if(d.open){ const f=d.querySelector('.menu-item:not(.is-off)')||d.querySelector('.menu-item'); f&&f.focus({preventScroll:true}); }
 },true);
 document.addEventListener('keydown',function(e){
  if(e.key!=='ArrowDown'&&e.key!=='ArrowUp') return;
  const d=e.target.closest&&e.target.closest('details.menu[open]'); if(!d) return;
  const items=[...d.querySelectorAll('.menu-item')]; if(!items.length) return;
  e.preventDefault();
  const i=items.indexOf(document.activeElement);
  const n=e.key==='ArrowDown'?(i+1)%items.length:(i-1+items.length)%items.length;
  items[n].focus();
 });

 /* ---- lead drawer: focus in, scroll lock, focus back ---- */
 const pd=document.getElementById('profileDrawer');
 let lastFocus=null;
 if(pd&&window.MutationObserver){
  new MutationObserver(function(){
   const open=pd.classList.contains('open');
   if(open===root.classList.contains('drawer-open')) return;
   root.classList.toggle('drawer-open', open);
   if(open){ lastFocus=document.activeElement; setTimeout(function(){ document.getElementById('pfClose')?.focus({preventScroll:true}); },0); }
   else if(lastFocus&&lastFocus.isConnected){ try{ lastFocus.focus({preventScroll:true}); }catch(e){} }
  }).observe(pd,{attributes:true,attributeFilter:['class']});
 }

 /* ---- keep MapLibre sized to its container (sidebar collapse, split view, rotation) ---- */
 const mapEl=document.getElementById('fsiMap');
 if(mapEl&&window.ResizeObserver){
  let raf=0;
  new ResizeObserver(function(){
   cancelAnimationFrame(raf);
   raf=requestAnimationFrame(function(){ try{ if(typeof _fsiMap!=='undefined'&&_fsiMap) _fsiMap.resize(); }catch(e){} });
  }).observe(mapEl);
 }
})();
