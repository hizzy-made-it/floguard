/* Theme bootstrap — runs in <head> before first paint.
 * Stored choice: localStorage 'floguard_theme' = 'light' | 'dark'. Absent = follow the OS
 * (prefers-color-scheme, handled purely in css/tokens.css). The toggle lives in js/17-shell.js. */
(function(){
 try{
  var t=localStorage.getItem('floguard_theme');
  if(t==='light'||t==='dark') document.documentElement.setAttribute('data-theme',t);
  var sb=localStorage.getItem('floguard_sidebar_collapsed');
  // No stored choice: small laptops (<=1100px) start on the icon rail so the work area gets the width.
  if(sb==='1'||(sb===null&&window.innerWidth>820&&window.innerWidth<=1100)) document.documentElement.classList.add('sb-collapsed');
 }catch(e){}
})();
