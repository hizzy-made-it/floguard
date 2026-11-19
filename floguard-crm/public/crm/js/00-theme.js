/* Theme bootstrap — runs in <head> before first paint.
 * Stored choice: localStorage 'floguard_theme' = 'light' | 'dark'. Absent = follow the OS
 * (prefers-color-scheme, handled purely in css/tokens.css). The toggle lives in js/17-shell.js. */
(function(){
 try{
  var t=localStorage.getItem('floguard_theme');
  if(t==='light'||t==='dark') document.documentElement.setAttribute('data-theme',t);
  if(localStorage.getItem('floguard_sidebar_collapsed')==='1') document.documentElement.classList.add('sb-collapsed');
 }catch(e){}
})();
