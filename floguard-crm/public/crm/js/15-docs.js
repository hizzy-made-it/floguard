/* ================= DOCUMENTS LIBRARY (all users) ================= */
let _docsCatalog=null;
let _docsCat='All';
function formatBytes(n){
 n=Number(n)||0;
 if(n<1024) return n+' B';
 if(n<1024*1024) return (n/1024).toFixed(1)+' KB';
 return (n/1024/1024).toFixed(1)+' MB';
}
async function loadDocsLibrary(force){
 const stats=document.getElementById('docsStats');
 const grid=document.getElementById('docsGrid');
 if(!_docsCatalog || force){
 try{
 stats.textContent='Loading…';
 const r=await fetch('/crm/docs/catalog.json?_='+Date.now(),{cache:'no-store'});
 if(!r.ok) throw new Error('Could not load catalog ('+r.status+')');
 _docsCatalog=await r.json();
 }catch(e){
 stats.textContent='Error loading documents';
 grid.innerHTML='<div class="card hint">'+(e.message||e)+'. Ask an admin to run <code>npm run academy:sync-docs</code>.</div>';
 return;
 }
 }
 renderDocsCats();
 renderDocsGrid();
}
function renderDocsCats(){
 const el=document.getElementById('docsCats');
 if(!el||!_docsCatalog) return;
 const cats=['All'].concat(_docsCatalog.categories||[]);
 el.innerHTML=cats.map(function(c){
 return '<button type="button" data-cat="'+esc(c)+'" class="'+(c===_docsCat?'on':'')+'">'+esc(c)+'</button>';
 }).join('');
}
function renderDocsGrid(){
 const grid=document.getElementById('docsGrid');
 const empty=document.getElementById('docsEmpty');
 const stats=document.getElementById('docsStats');
 if(!grid||!_docsCatalog) return;
 const q=(document.getElementById('docsSearch')?.value||'').trim().toLowerCase();
 const typeF=(document.getElementById('docsType')?.value||'').toLowerCase();
 let docs=_docsCatalog.documents||[];
 if(_docsCat && _docsCat!=='All') docs=docs.filter(function(d){ return d.category===_docsCat; });
 if(typeF){
 docs=docs.filter(function(d){
 const t=(d.type||'').toLowerCase();
 if(typeF==='mp4') return t==='mp4' || t==='video' || t==='webm';
 return t===typeF;
 });
 }
 if(q){
 docs=docs.filter(function(d){
 const hay=((d.title||'')+' '+(d.category||'')+' '+(d.description||'')+' '+(d.file||'')).toLowerCase();
 return hay.indexOf(q)>=0;
 });
 }
 const all=(_docsCatalog.documents||[]);
 const nPdf=all.filter(function(d){ return (d.type||'').toLowerCase()==='pdf'; }).length;
 const nVid=all.filter(function(d){ const t=(d.type||'').toLowerCase(); return t==='mp4'||t==='video'||t==='webm'; }).length;
 stats.innerHTML='Showing <b>'+docs.length+'</b> of <b>'+all.length+'</b> · PDFs: <b>'+nPdf+'</b> · Videos: <b>'+nVid+'</b>';
 empty.style.display=docs.length?'none':'block';
 grid.innerHTML=docs.map(function(d){
 const t=(d.type||'file').toLowerCase();
 const when=d.updated_at?String(d.updated_at).slice(0,10):'';
 const isVid=t==='mp4'||t==='video'||t==='webm';
 const media=isVid
 ? '<video controls preload="metadata" src="'+esc(d.href)+'" title="'+esc(d.title||d.file)+'"></video>'
 : '';
 return '<article class="doc-card">'+
 '<div class="cat">'+esc(d.category||'General')+'</div>'+
 '<h3>'+esc(d.title||d.file)+'</h3>'+
 (media||'')+
 '<p class="desc">'+esc(d.description||'')+'</p>'+
 '<div class="meta"><span class="doc-type '+esc(isVid?'mp4':t)+'">'+esc(isVid?'video':t)+'</span> · '+esc(formatBytes(d.bytes))+
 (when?(' · '+esc(when)):'')+'</div>'+
 '<div class="row">'+
 '<a class="btn p" href="'+esc(d.href)+'" target="_blank" rel="noopener">'+(isVid?'Watch':'Open')+'</a>'+
 '<a class="btn" href="'+esc(d.href)+'" download>Download</a>'+
 '</div></article>';
 }).join('');
}
document.getElementById('docsRefresh')?.addEventListener('click', function(){ loadDocsLibrary(true); });
document.getElementById('docsSearch')?.addEventListener('input', function(){ if(_docsCatalog) renderDocsGrid(); });
document.getElementById('docsType')?.addEventListener('change', function(){ if(_docsCatalog) renderDocsGrid(); });
document.getElementById('docsCats')?.addEventListener('click', function(e){
 const b=e.target.closest('button[data-cat]'); if(!b) return;
 _docsCat=b.getAttribute('data-cat')||'All';
 renderDocsCats();
 renderDocsGrid();
});

