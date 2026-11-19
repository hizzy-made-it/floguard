/* ================= SETTINGS / MODELS ================= */
(function initModels(){
 // Drop any previously stored personal API keys — platform key is shared server-side
 const prev=getCfg();
 if(prev.apiKey){ const {apiKey,...rest}=prev; setCfg({...rest,apiKey:undefined}); try{ const c=JSON.parse(localStorage.getItem(CFGKEY)||'{}'); delete c.apiKey; localStorage.setItem(CFGKEY,JSON.stringify(c)); }catch(e){} }
 const cfg=getCfg();
 document.querySelectorAll('.modelSel').forEach(sel=>{
 sel.innerHTML=MODELS.map(m=>`<option value="${m.id}" ${((cfg.model||'auto')===m.id)?'selected':''}>${esc(m.label)}</option>`).join('');
 sel.addEventListener('change',()=>{ setCfg({model:sel.value}); document.querySelectorAll('.modelSel').forEach(o=>{o.value=sel.value;}); hint(); });
 });
 document.getElementById('customModel').value=cfg.customModel||'';
 function hint(){
 const v=getCfg().model||'auto';
 const t= v==='auto' ? 'Auto skill on: drills → gpt-4o-mini · roleplay → gpt-4o · reviews → gpt-4.1. Each reply shows the model used.' : 'Fixed model: '+v;
 const h=document.getElementById('modelHint-coach'); if(h) h.textContent=t;
 }
 hint();
 document.getElementById('saveModels').addEventListener('click',()=>{
 setCfg({customModel:document.getElementById('customModel').value.trim()});
 document.getElementById('keyMsg').textContent='Model prefs saved. Open the AI Coach and say hello — no API key needed.';
 });
})();


