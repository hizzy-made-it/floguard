/* ================= FSI FLOOD MAP COMMAND CENTER ================= */
/* Spec: docs/FLOOD-SUSCEPTIBILITY-INDEX.md +
   docs/superpowers/specs/2026-07-21-flood-map-command-center-design.md
   Color bands on fsi_static; list rank on fsi_live.
   Wave 2 (F2): claims layers, parcel polygons, search, score breakdown, layer panel, hash state,
   box select and the mobile sheet live in js/19-map-next.js (pure helpers in js/19a-map-pure.js).
   This file calls into them only at runtime, through the mn* hooks guarded by typeof. */
const FSI_CENTER=[-81.10,29.05];
const FSI_ZOOM=10.9;
const FSI_STYLE='https://tiles.openfreemap.org/styles/liberty';
/* Same provider (OpenFreeMap, no key). Used when the app theme is dark. */
const FSI_STYLE_DARK='https://tiles.openfreemap.org/styles/dark';
function fsiEffectiveTheme(){
 const t=document.documentElement.getAttribute('data-theme');
 if(t==='dark'||t==='light') return t;
 try{ return window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'; }catch(e){ return 'light'; }
}
function fsiStyleUrl(){ return fsiEffectiveTheme()==='dark'?FSI_STYLE_DARK:FSI_STYLE; }
const FSI_NFHL='https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image';
const FSI_BANDS=[
 {c:'#027a48',l:'Lowest'},
 {c:'#0d7d6f',l:'Low'},
 {c:'#b54708',l:'Moderate'},
 {c:'#c2410c',l:'High'},
 {c:'#b42318',l:'Highest'}
];
const FSI_HSG={A:0.2,B:0.4,C:0.7,D:1.0};
const FSI_ZONE={AE:1,VE:1,AO:0.8,AH:0.8,'X-SHADED':0.6,X:0.45};
let _fsiMap=null, _fsiInited=false, _fsiMoved=false, _fsiFitting=false, _fsiPopup=null;
let _fsiState={raw:[], filtered:[], selectedId:null, source:'', preset:'must', bandFilter:null, q:'', city:'', selected:Object.create(null), bg:null, storm:null};
let _fsiLoadCtl=null, _fsiStyleUrl='', _fsiStyleLoads=0;
let _fsiSearchTimer=null;
const FSI_FOCUS_CITIES=['Port Orange','Daytona Beach','Ormond Beach','New Smyrna Beach','Debary','Deland','Edgewater','South Daytona','Holly Hill','Daytona Beach Shores'];
/** Collapse whitespace + uppercase for city matching keys. */
function fsiNormCityKey(s){
 return String(s||'').replace(/\s+/g,' ').trim().toUpperCase();
}
/** Title Case: first letter of each word capital (UI display). */
function fsiTitleCase(s){
 return fsiNormCityKey(s).toLowerCase().replace(/\b([a-z])/g,function(m,c){ return c.toUpperCase(); });
}
/** Known Volusia spellings that should collapse to one city. */
const FSI_CITY_ALIASES={
 'DE BARY':'DEBARY',
 'DE-BARY':'DEBARY',
 'DE LAND':'DELAND',
 'DE-LAND':'DELAND',
 'DAYTONA':'DAYTONA BEACH',
 'DAYTONA BCH':'DAYTONA BEACH',
 'DAYTONA BCH SHORES':'DAYTONA BEACH SHORES',
 'DB SHORES':'DAYTONA BEACH SHORES',
 'NEW SMYRNA':'NEW SMYRNA BEACH',
 'NSB':'NEW SMYRNA BEACH',
 'ORMOND':'ORMOND BEACH',
 'P O':'PORT ORANGE',
 'PO':'PORT ORANGE'
};
function fsiCanonicalCityKey(raw){
 let k=fsiNormCityKey(raw);
 if(!k) return '';
 if(FSI_CITY_ALIASES[k]) k=FSI_CITY_ALIASES[k];
 return k;
}

function fsiSay(msg,isHtml){
 const el=document.getElementById('fsiStats'); if(!el) return;
 if(isHtml) el.innerHTML=msg; else el.textContent=msg;
 el.title=el.textContent; // the toolbar truncates it to one line
}
function fsiDrMsg(msg,cls){
 const el=document.getElementById('fsiDrMsg'); if(!el) return;
 el.textContent=msg||''; el.className='fsi-msg'+(cls?' '+cls:'');
}
function fsiNum(v,d){ const n=Number(v); return isFinite(n)?n.toFixed(d==null?1:d):'—'; }
function fsiHsgScore(hsg){
 if(!hsg) return 0.55;
 const u=String(hsg).toUpperCase();
 if(u.includes('/')){ const parts=u.split('/'); return Math.max(FSI_HSG[parts[0]]||0.55, FSI_HSG[parts[1]]||0.55); }
 return FSI_HSG[u]||0.55;
}
function fsiZoneScore(z){
 if(!z) return 0.6;
 return FSI_ZONE[String(z).toUpperCase()]!=null?FSI_ZONE[String(z).toUpperCase()]:0.6;
}
function fsiBander(list){
 const vals=list.map(function(p){ return Number(p.fsi_static)||0; }).sort(function(a,b){ return a-b; });
 if(!vals.length) return function(){ return 0; };
 const cuts=[];
 for(let i=1;i<FSI_BANDS.length;i++) cuts.push(vals[Math.floor(vals.length*i/FSI_BANDS.length)]);
 return function(v){
  let b=0;
  for(let i=0;i<cuts.length;i++) if(v>=cuts[i]) b=i+1;
  return b;
 };
}
function fsiZoneClass(z){
 const u=String(z||'').toUpperCase();
 if(u==='X'||u==='X-SHADED') return 'zone-x';
 if(['AE','VE','AO','AH'].includes(u)) return 'zone-f';
 return '';
}
function fsiSoilClass(h){
 const u=String(h||'').toUpperCase();
 if(u==='D'||u.endsWith('/D')||u.startsWith('D/')) return 'soil-d';
 if(u==='A') return 'soil-a';
 return '';
}
function fsiStory(p){
 const zone=String(p.fema_zone||'').toUpperCase();
 const hsg=String(p.hsg||'').toUpperCase();
 const band=p._band!=null?p._band:0;
 const twi=Number(p.twi_n), hand=Number(p.hand_n);
 const heat=Number(p.claim_heat)||0;
 const c10=Number(p.claim_count_10y)||0;
 const mhs=Number(p.must_have_score);
 const jv=Number(p.just_value)||0;
 const reasons=Array.isArray(p.must_have_reasons)?p.must_have_reasons:[];
 const commercial=reasons.indexOf('commercial_scale')>=0||jv>=900000;
 // Claim-hot is neighborhood aggregate only — never a personal claim statement.
 if(reasons.indexOf('gold_segment')>=0||((zone==='X'||zone==='X-SHADED')&&(hsg.includes('D')||hsg.includes('C'))&&heat>=0.35))
  return (commercial?'Commercial/condo gold: ':'')+'Zone '+zone+' + poor-drain soil + claim-hot neighborhood — FloGuard\'s best unserved segment. Free assessment, not insurance advice.';
 if(heat>=0.55||c10>=8)
  return 'Claim-hot neighborhood (OpenFEMA neighbourhood total, not this owner): ~'+(Number(p.claim_bg_count_10y)>0?Number(p.claim_bg_count_10y):c10)+' NFIP claims nearby in recent years. Standing water still needs a free assessment — not an insurance quote.';
 if(commercial&&(heat>=0.35||hsg.includes('D')||hsg.includes('C')))
  return 'Higher-value improved parcel (commercial/condo scale) in a wet-soil or claim-hot area — larger drainage job potential. Walk the free assessment before quoting.';
 if((zone==='X'||zone==='X-SHADED')&&(band>=3||hsg.includes('D')||hsg==='C'))
  return 'Zone '+zone+' clay-friendly bowl — high drainage need, often ignored by FEMA maps. Strong FloGuard segment.';
 if(hsg==='D'||hsg.includes('D'))
  return 'Poor-draining soil (HSG '+hsg+'). Water sits after storms even without a FEMA flood map flag.';
 if(reasons.indexOf('closed_basin')>=0)
  return 'Closed basin — the lot sits '+(Number(p.depr_m)>0?Number(p.depr_m).toFixed(1)+' m ':'')+'below its spill point with no channel out. Water that lands here stays until it soaks or is pumped. Sump + discharge is the pitch, not a French drain to nowhere.';
 if(reasons.indexOf('hardscape_pooling')>=0)
  return 'Heavy hardscape for the lot ('+Math.round((Number(p.impervious_ratio)||0)*100)+'% roof/driveway cover'+(Number(p.lot_sqft)>0&&Number(p.lot_sqft)<8000?', small lot':'')+') — roof and driveway runoff has nowhere to soak in. Pooling at the edges is the pitch.';
 if(isFinite(twi)&&twi>=0.75)
  return 'High wetness index — water collects here from surrounding ground. Terrain is the story.';
 if(isFinite(hand)&&hand<=0.25)
  return 'Low height above drainage — little freeboard once water arrives.';
 if(['AE','VE'].includes(zone))
  return 'FEMA '+zone+' on file — riverine/coastal risk; still sell standing-water drainage, not insurance.';
 if(isFinite(mhs)&&String(p.must_have_band||'').toLowerCase()==='must')
  return 'Must dial (top county percentile) — score '+fsiNum(mhs)+' from risk, soil/zone fit, capacity, and neighborhood claim heat.';
 const live=fsiNum(p.fsi_live), s=fsiNum(p.fsi_static,2);
 return 'Live FSI '+live+' · terrain '+s+'. Rank and walk the free assessment before quoting.';
}
function fsiOneLiner(p){ return fsiStory(p).split(/[.—]/)[0]; }

/**
 * Soft product-cause suggestions from public parcel signals.
 * Assessment decides the real product — never treat these as quotes.
 * Returns [{cause, why, strength:'high'|'med'|'low'}] ordered by strength.
 */
function fsiSuggestCauses(p){
 if(!p) return [];
 const zone=String(p.fema_zone||'').toUpperCase();
 const hsg=String(p.hsg||'').toUpperCase();
 const live=Number(p.fsi_live)||0;
 const s=Number(p.fsi_static)||0;
 const heat=Number(p.claim_heat)||0;
 const jv=Number(p.just_value)||0;
 const twi=Number(p.twi_n), hand=Number(p.hand_n);
 const mhs=Number(p.must_have_score);
 const band=String(p.must_have_band||'').toLowerCase();
 const use=String(p.use_desc||p.dor_use||'').toLowerCase();
 const year=Number(p.year_built)||0;
 const poorSoil=/D|C\/D|D\//.test(hsg)||hsg==='C';
 const zoneX=zone==='X'||zone==='X-SHADED';
 const femaFlood=['AE','VE','AO','AH'].indexOf(zone)>=0;
 const commercial=jv>=900000||/commercial|condo|multi|apt|apartment|office|retail|hotel|motel|warehouse/.test(use);
 const scored={};
 function bump(cause, why, strength){
  const rank={high:3,med:2,low:1};
  const prev=scored[cause];
  if(!prev||rank[strength]>rank[prev.strength]) scored[cause]={cause:cause,why:why,strength:strength};
 }
 // French drain — terrain bowls, poor soil, high FSI / must
 if(zoneX&&poorSoil) bump('FrenchDrain','Zone '+zone+' + poor-drain soil', 'high');
 else if(poorSoil&&(live>=55||s>=0.55||band==='must')) bump('FrenchDrain','Poor soil + elevated risk', 'high');
 else if(isFinite(twi)&&twi>=0.7) bump('FrenchDrain','High wetness index (TWI)', 'med');
 else if(live>=50||s>=0.5||band==='must') bump('FrenchDrain','Elevated FSI / must band', 'med');
 else if(heat>=0.45) bump('FrenchDrain','Claim-hot neighborhood', 'low');
 // Sump — high water / low freeboard / FEMA flood / coastal signals
 if(isFinite(hand)&&hand<=0.25) bump('SumpPump','Low freeboard (HAND)', 'high');
 else if(femaFlood) bump('SumpPump','FEMA '+zone+' — groundwater / flood fringe', 'med');
 else if(isFinite(twi)&&twi>=0.8&&poorSoil) bump('SumpPump','Very wet terrain + clay', 'med');
 else if(band==='must'&&(femaFlood||poorSoil)) bump('SumpPump','Must dial + water-table risk', 'low');
 // Yard — surface drainage / grading on better soil or yard-scale parcels
 if(zoneX&&!poorSoil&&(live>=40||heat>=0.35)) bump('YardDrainage','Zone X surface drainage / grading', 'med');
 else if(/residential|single|duplex|town/.test(use)&&live>=45&&!femaFlood) bump('YardDrainage','Residential surface water risk', 'low');
 else if(hsg==='A'||hsg==='B'){ if(live>=55||heat>=0.5) bump('YardDrainage','Better soil but wet site — catch basins / grading', 'low'); }
 // Maintenance — older stock or already a dial priority (service plan lane)
 if(year>0&&year<=1995) bump('Maintenance','Older stock (built '+year+') — storm-ready plan', 'med');
 else if(band==='must'||live>=60) bump('Maintenance','High-risk site — seasonal pump/drain checks', 'low');
 else if(heat>=0.55) bump('Maintenance','Claim-hot area — readiness visits', 'low');
 // Property mgmt — commercial / condo / multi scale
 if(commercial) bump('PropertyMgmt', jv>=900000?('Commercial scale · $'+Math.round(jv/1000)+'k JV'):'Multi/condo use class', 'high');
 else if(/hoa|condo|association/.test(use)) bump('PropertyMgmt','HOA / condo use', 'med');

 const order={high:0,med:1,low:2};
 return Object.keys(scored).map(function(k){ return scored[k]; })
  .sort(function(a,b){ return (order[a.strength]-order[b.strength])||a.cause.localeCompare(b.cause); });
}
function fsiSuggestChipHtml(sugs){
 if(!sugs||!sugs.length) return '';
 return sugs.map(function(s){
  return '<span class="suggest-chip str-'+esc(s.strength)+'" title="'+esc(s.why)+'"><b>'+esc(LIST_SHORT[s.cause]||s.cause)+'</b> <span class="why">'+esc(s.why)+'</span></span>';
 }).join('');
}

async function fsiFetch(payload, signal){
 const tok=getToken();
 if(!tok) throw new Error('Session expired — log in again.');
 const r=await fetch('/crm/api/fsi-parcels',{
  method:'POST',
  headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
  body:JSON.stringify(payload),
  signal:signal
 });
 const raw=await r.text(); let data=null; try{data=JSON.parse(raw);}catch(e){}
 if(!r.ok){
  const err=(data&&(data.hint?(data.error+' — '+data.hint):(data.detail||data.error)))||('Error '+r.status);
  throw new Error(typeof err==='string'?err:JSON.stringify(err));
 }
 return data;
}

function fsiSetSourceBadge(src){
 const el=document.getElementById('fsiSource'); if(!el) return;
 if(src==='postgres'){ el.textContent='Live data'; el.className='fsi-source live'; }
 else if(src==='fixtures'){ el.textContent='Demo data'; el.className='fsi-source demo'; }
 else { el.textContent='Loading'; el.className='fsi-source'; }
}
function fsiSyncSearchBtn(){
 const b=document.getElementById('fsiSearchArea'); if(!b) return;
 b.textContent=_fsiMoved?'Search this area':'Refresh this area';
}
function fsiRenderLegend(){
 const el=document.getElementById('fsiLegend'); if(!el) return;
 el.innerHTML='<span>Terrain (S) · click to filter:</span>'+FSI_BANDS.map(function(b,i){
  const on=_fsiState.bandFilter===i?' on':'';
  return '<span class="k'+on+'" data-band="'+i+'" role="button" tabindex="0"><i class="sw" style="background:'+b.c+'"></i>'+esc(b.l)+'</span>';
 }).join('')+(_fsiState.bandFilter!=null?'<span class="k" data-band="all" role="button">Show all</span>':'');
 if(typeof mnLegendHtml==='function'){
  el.innerHTML='<div class="lg-row lg-terrain">'+el.innerHTML+'</div>'+mnLegendHtml();
 }
}

function fsiParcelCity(p){
 // Always returns canonical KEY (uppercase). Display with fsiTitleCase(key).
 let raw='';
 if(p.city&&String(p.city).trim()) raw=String(p.city).trim();
 else{
  const a=String(p.address||'');
  const m=a.match(/,\s*([^,]+),\s*FL/i);
  if(m) raw=m[1].trim();
 }
 return fsiCanonicalCityKey(raw);
}
function fsiSelectedCount(){
 return Object.keys(_fsiState.selected).filter(function(id){ return _fsiState.selected[id]; }).length;
}
function fsiSyncBulkBar(){
 const bar=document.getElementById('fsiBulk');
 const n=fsiSelectedCount();
 const el=document.getElementById('fsiSelCount');
 if(el) el.textContent=String(n);
 if(bar) bar.classList.toggle('on', n>0||_fsiState.filtered.length>0);
 const sa=document.getElementById('fsiSelectAll');
 if(sa){
  const all=_fsiState.filtered.length&&_fsiState.filtered.every(function(p){ return _fsiState.selected[p.parcel_id]; });
  sa.checked=!!all;
  sa.indeterminate=n>0&&!all;
 }
}
function fsiRebuildCityUi(){
 // Deduplicate by canonical key; label is Title Case
 const cities={};
 _fsiState.raw.forEach(function(p){
  const c=fsiParcelCity(p);
  if(c) cities[c]=(cities[c]||0)+1;
 });
 const sorted=Object.keys(cities).sort(function(a,b){
  return cities[b]-cities[a]||fsiTitleCase(a).localeCompare(fsiTitleCase(b));
 });
 const cur=fsiCanonicalCityKey(_fsiState.city||'');
 if(cur&&_fsiState.city!==cur) _fsiState.city=cur;
 const sel=document.getElementById('fsiCityFilter');
 if(sel){
  sel.innerHTML='<option value="">All cities</option>'+sorted.slice(0,80).map(function(c){
   const label=fsiTitleCase(c);
   return '<option value="'+esc(c)+'"'+(c===cur?' selected':'')+'>'+esc(label)+' ('+cities[c]+')</option>';
  }).join('');
 }
 const chips=document.getElementById('fsiCityChips');
 if(chips){
  const focusKeys=FSI_FOCUS_CITIES.map(fsiCanonicalCityKey);
  const seen={};
  const quick=[];
  focusKeys.forEach(function(k){
   if(!k||seen[k]||!cities[k]) return;
   seen[k]=true;
   quick.push(k);
  });
  // fill remaining top cities if focus list short
  sorted.forEach(function(k){
   if(quick.length>=8||seen[k]) return;
   seen[k]=true;
   quick.push(k);
  });
  chips.innerHTML=quick.map(function(c){
   const on=cur===c?' on':'';
   const label=fsiTitleCase(c);
   return '<button type="button" data-city="'+esc(c)+'" class="'+on.trim()+'">'+esc(label)+' · '+cities[c]+'</button>';
  }).join('')+(cur?'<button type="button" data-city="">All</button>':'');
 }
}
function fsiApplyFilters(){
 const minLive=Number(document.getElementById('fsiMinScore')?.value);
 const min=isFinite(minLive)?minLive:0;
 const q=(_fsiState.q||'').trim().toLowerCase();
 const city=fsiCanonicalCityKey(_fsiState.city||'');
 const bandOf=fsiBander(_fsiState.raw);
 let list=_fsiState.raw.map(function(p){
  return Object.assign({},p,{_band:bandOf(Number(p.fsi_static)||0)});
 });
 list=list.filter(function(p){ return (Number(p.fsi_live)||0)>=min; });
 const preset=_fsiState.preset;
 if(preset==='must'){
  // Strict: only percentile "must" band (server already returns top N by score).
  // Residential + commercial + condos all eligible — vacant land is scored skip.
  list=list.filter(function(p){ return String(p.must_have_band||'').toLowerCase()==='must'; });
 }else if(preset==='claim_hot'){
  list=list.filter(function(p){ return (Number(p.claim_heat)||0)>=0.45||(Number(p.claim_count_10y)||0)>=5; });
 }else if(preset==='zone_x'){
  list=list.filter(function(p){
   const z=String(p.fema_zone||'').toUpperCase();
   return (z==='X'||z==='X-SHADED')&&(p._band>=3||String(p.hsg||'').toUpperCase().includes('D'));
  });
 }else if(preset==='clay'){
  list=list.filter(function(p){ const h=String(p.hsg||'').toUpperCase(); return h==='D'||h.includes('D'); });
 }else if(preset==='fema'){
  list=list.filter(function(p){ return ['AE','VE','AO','AH'].includes(String(p.fema_zone||'').toUpperCase()); });
 }
 if(typeof mnFilterList==='function') list=mnFilterList(list);
 if(_fsiState.bandFilter!=null){
  list=list.filter(function(p){ return p._band===_fsiState.bandFilter; });
 }
 if(city){
  list=list.filter(function(p){ return fsiParcelCity(p)===city; });
 }
 if(q){
  list=list.filter(function(p){
   return [p.address,p.owner_name,p.parcel_id,p.fema_zone,p.hsg,p.city,p.must_have_band,p.use_desc].join(' ').toLowerCase().includes(q);
  });
 }
 if(preset==='must'){
  list.sort(function(a,b){ return (Number(b.must_have_score)||0)-(Number(a.must_have_score)||0)||(Number(b.fsi_live)||0)-(Number(a.fsi_live)||0); });
 }else if(preset==='claim_hot'){
  list.sort(function(a,b){ return (Number(b.claim_heat)||0)-(Number(a.claim_heat)||0)||(Number(b.fsi_live)||0)-(Number(a.fsi_live)||0); });
 }else if(preset==='storm'){
  list.sort(function(a,b){ return (Number(b.cell_rain_24h)||0)-(Number(a.cell_rain_24h)||0)||(Number(b.must_have_score)||0)-(Number(a.must_have_score)||0); });
 }else{
  list.sort(function(a,b){ return (Number(b.fsi_live)||0)-(Number(a.fsi_live)||0); });
 }
 _fsiState.filtered=list;
}

function fsiPaint(){
 const list=_fsiState.filtered;
 const src=_fsiMap&&_fsiMap.getSource('fsi');
 if(typeof mnAfterPaint==='function') setTimeout(mnAfterPaint,0);
 if(!src) return list.filter(function(p){ return isFinite(Number(p.lon))&&isFinite(Number(p.lat)); }).map(function(p){ return {geometry:{coordinates:[Number(p.lon),Number(p.lat)]}}; });
 const features=list.filter(function(p){
  return isFinite(Number(p.lon))&&isFinite(Number(p.lat));
 }).map(function(p){
  const live=Number(p.fsi_live)||0;
  const heat=Number(p.claim_heat)||0;
  return {
   type:'Feature',
   geometry:{type:'Point',coordinates:[Number(p.lon),Number(p.lat)]},
   properties:{
    parcel_id:String(p.parcel_id||''),
    address:p.address||'', owner_name:p.owner_name||'',
    fsi_live:live, fsi_static:Number(p.fsi_static)||0,
    claim_heat:heat, claim_count_10y:Number(p.claim_count_10y)||0,
    fema_zone:p.fema_zone||'', hsg:p.hsg||'',
    band:p._band||0, selected:p.parcel_id===_fsiState.selectedId?1:0,
    poly:(typeof mnHasPoly==='function'&&mnHasPoly(p.parcel_id))?1:0,
    r:4+Math.min(10, live/10)
   }
  };
 });
 src.setData({type:'FeatureCollection',features:features});
 return features;
}

function fsiRenderList(){
 const box=document.getElementById('fsiList');
 const stats=document.getElementById('fsiListStats');
 if(!box) return;
 const list=_fsiState.filtered;
 if(stats) stats.textContent=list.length? (list.length+' shown'+(_fsiState.preset==='must'?' · Must':'')) : 'No matches';
 if(!list.length){
  box.innerHTML='<div class="empty-state">'+(_fsiState.bg
   ? 'No loaded parcels in this block group. Press <b>Search this area</b> to load the parcels on screen, or remove the block-group filter.'
   : _fsiState.preset==='storm'
   ? (_fsiState.storm&&_fsiState.storm.error?esc(_fsiState.storm.error):'No parcels where it rained hard yesterday. Either it was a dry day or yesterday\'s rainfall has not been loaded yet.')
   : _fsiState.preset==='must'
   ? 'No Must-dial parcels in this load. Raise Max parcels under Filters, or switch to Top risk.'
   : 'No parcels match filters. Clear presets or load Top countywide.')+'</div>';
  fsiSyncBulkBar();
  return;
 }
 box.innerHTML=list.map(function(p,i){
  const live=Number(p.fsi_live)||0;
  const mhs=Number(p.must_have_score);
  const showMust=_fsiState.preset==='must'&&isFinite(mhs);
  const pct=Math.max(0,Math.min(100, showMust?mhs:live));
  const on=p.parcel_id===_fsiState.selectedId?' on':'';
  const zc=fsiZoneClass(p.fema_zone), sc=fsiSoilClass(p.hsg);
  const heat=Number(p.claim_heat)||0;
  const checked=_fsiState.selected[p.parcel_id]?' checked':'';
  return '<div class="fsi-row'+on+'" role="option" data-id="'+esc(String(p.parcel_id))+'" aria-selected="'+(on?'true':'false')+'">'+
   '<input type="checkbox" class="ck fsi-row-ck" data-id="'+esc(String(p.parcel_id))+'"'+checked+' aria-label="Select parcel" title="Select for bulk">'+
   '<div class="rk">'+(i+1)+'</div>'+
   '<div class="main">'+
   '<div class="addr">'+esc(p.address||p.parcel_id||'Parcel')+'</div>'+
   '<div class="story">'+esc(fsiOneLiner(p))+'</div>'+
   '<div class="meta">'+
   '<span class="fsi-meter-wrap" title="'+(showMust?'Must-Have Score':'Live FSI')+'"><span class="fsi-meter"><i style="width:'+pct+'%"></i></span>'+esc(fsiNum(showMust?mhs:live))+'</span>'+
   (p.must_have_band?'<span class="fsi-chip">'+esc(String(p.must_have_band).toUpperCase())+'</span>':'')+
   (p.fema_zone?'<span class="fsi-chip '+zc+'">'+esc(p.fema_zone)+'</span>':'')+
   (p.hsg?'<span class="fsi-chip '+sc+'">Soil '+esc(p.hsg)+'</span>':'')+
   (typeof mnRowChips==='function'?mnRowChips(p):(heat>=0.45?'<span class="fsi-chip">Claims hot</span>':''))+
   (Number(p.just_value)>=900000?'<span class="fsi-chip">Commercial scale</span>':'')+
   '<span class="fsi-chip">S '+esc(fsiNum(p.fsi_static,2))+'</span>'+
   '</div></div></div>';
 }).join('');
 fsiSyncBulkBar();
}

function fsiRenderDrawer(){
 const drawer=document.getElementById('fsiDrawer');
 if(!drawer) return;
 const p=_fsiState.filtered.find(function(x){ return x.parcel_id===_fsiState.selectedId; })
  || _fsiState.raw.find(function(x){ return x.parcel_id===_fsiState.selectedId; });
 if(!p){ drawer.classList.remove('on'); return; }
 drawer.classList.add('on');
 const rank=_fsiState.filtered.findIndex(function(x){ return x.parcel_id===p.parcel_id; })+1;
 const n=_fsiState.filtered.length;
 document.getElementById('fsiDrName').textContent=p.owner_name||'Owner unknown';
 document.getElementById('fsiDrAddr').textContent=p.address||'(no address on record)';
 document.getElementById('fsiDrHeadline').textContent=fsiStory(p);
 const live=Number(p.fsi_live)||0, s=Number(p.fsi_static)||0;
 const livePct=Math.max(0,Math.min(100,live));
 const sPct=Math.max(0,Math.min(100,s*100));
 const mhs=Number(p.must_have_score);
 const mhsPct=isFinite(mhs)?Math.max(0,Math.min(100,mhs)):0;
 const heat=Number(p.claim_heat)||0;
 const heatPct=Math.max(0,Math.min(100,heat*100));
 document.getElementById('fsiDrMeters').innerHTML=
  '<div class="meter-row"><label>Must-Have</label><span class="fsi-meter"><i class="m-must" style="width:'+mhsPct+'%"></i></span><b>'+(isFinite(mhs)?esc(fsiNum(mhs)):'—')+'</b></div>'+
  '<div class="meter-row"><label>Live FSI</label><span class="fsi-meter"><i style="width:'+livePct+'%"></i></span><b>'+esc(fsiNum(live))+'</b></div>'+
  '<div class="meter-row"><label>Terrain S</label><span class="fsi-meter"><i class="m-terrain" style="width:'+sPct+'%"></i></span><b>'+esc(fsiNum(s,3))+'</b></div>'+
  '<div class="meter-row"><label>Claim heat</label><span class="fsi-meter"><i class="m-heat" style="width:'+heatPct+'%"></i></span><b>'+esc(fsiNum(heat,2))+'</b></div>'+
  '<div class="meter-row"><label>Rank</label><span></span><b>'+(rank>0?('#'+rank+'/'+n):'—')+'</b></div>';
 const chips=document.getElementById('fsiDrChips');
 chips.innerHTML=
  (p.must_have_band?'<span class="fsi-chip">'+esc(String(p.must_have_band).toUpperCase())+'</span>':'')+
  (p.fema_zone?'<span class="fsi-chip '+fsiZoneClass(p.fema_zone)+'">Zone '+esc(p.fema_zone)+'</span>':'')+
  (p.hsg?'<span class="fsi-chip '+fsiSoilClass(p.hsg)+'">Soil '+esc(p.hsg)+'</span>':'')+
  (heat>=0.45?'<span class="fsi-chip">Neighborhood claims ~'+(Number(p.claim_count_10y)||0)+'</span>':'')+
  (p.year_built?'<span class="fsi-chip">Built '+esc(String(p.year_built))+'</span>':'')+
  '<span class="fsi-chip">Band '+(FSI_BANDS[p._band||0]?FSI_BANDS[p._band||0].l:'—')+'</span>'+
  (String(p.parcel_id||'').indexOf('FIXTURE-')===0?'<span class="fsi-chip">Demo parcel</span>':'')+
  '<span class="fsi-chip" title="Neighbourhood aggregate from OpenFEMA, never this owner\'s claim">Claims = neighbourhood total, not personal</span>';
 if(typeof mnRenderDrawer==='function'){ mnRenderDrawer(p); }
 else fsiRenderBreakdownLegacy(p);
 // Soft suggested causes from FSI / soil / zone / value
 const sugs=fsiSuggestCauses(p);
 const sugBox=document.getElementById('fsiDrSuggest');
 const sugChips=document.getElementById('fsiDrSuggestChips');
 if(sugBox&&sugChips){
  if(sugs.length){
   sugBox.style.display='block';
   sugChips.innerHTML=fsiSuggestChipHtml(sugs);
  }else{
   sugBox.style.display='none';
   sugChips.innerHTML='';
  }
 }
 fsiDrMsg('');
}
/** Pre-F2 terrain bars; only used if js/19-map-next.js failed to load. */
function fsiRenderBreakdownLegacy(p){
 const bd=document.getElementById('fsiDrBreakdown'); if(!bd) return;
 const twi=Number(p.twi_n), hand=Number(p.hand_n);
 if(isFinite(twi)&&isFinite(hand)){
  const factors=[
   {l:'TWI', w:0.40, v:twi},
   {l:'HAND', w:0.25, v:Math.max(0,1-hand)},
   {l:'Soil', w:0.20, v:fsiHsgScore(p.hsg)},
   {l:'FEMA', w:0.15, v:fsiZoneScore(p.fema_zone)}
  ];
  bd.style.display='block';
  bd.innerHTML='<h4>Terrain factors (literature weights · display only)</h4>'+factors.map(function(f){
   const pct=Math.round(Math.max(0,Math.min(1,f.v))*100);
   return '<div class="fsi-bd-row"><span>'+esc(f.l)+' · '+(f.w*100).toFixed(0)+'%</span><span class="bar"><i style="width:'+pct+'%"></i></span><span>'+pct+'%</span></div>';
  }).join('');
 }else if(isFinite(twi)||isFinite(hand)){
  const factors=[
   {l:'TWI', w:0.40, v:isFinite(twi)?twi:0.55},
   {l:'HAND', w:0.25, v:isFinite(hand)?Math.max(0,1-hand):0.55},
   {l:'Soil', w:0.20, v:fsiHsgScore(p.hsg)},
   {l:'FEMA', w:0.15, v:fsiZoneScore(p.fema_zone)}
  ];
  bd.style.display='block';
  bd.innerHTML='<h4>Terrain factors (DEM-lite · display only)</h4>'+factors.map(function(f){
   const pct=Math.round(Math.max(0,Math.min(1,f.v))*100);
   return '<div class="fsi-bd-row"><span>'+esc(f.l)+' · '+(f.w*100).toFixed(0)+'%</span><span class="bar"><i style="width:'+pct+'%"></i></span><span>'+pct+'%</span></div>';
  }).join('');
 }else{
  bd.style.display='block';
  bd.innerHTML='<h4>Terrain factors</h4><p class="hint" style="margin:0">Terrain detail has not been computed for this parcel yet.</p>';
 }
}

function fsiSelect(id, opts){
 opts=opts||{};
 _fsiState.selectedId=id||null;
 fsiPaint();
 fsiRenderList();
 fsiRenderDrawer();
 if(typeof mnOnSelect==='function') mnOnSelect(id, opts);
 if(opts.fly&&_fsiMap&&id){
  const p=_fsiState.filtered.find(function(x){ return x.parcel_id===id; })
   || _fsiState.raw.find(function(x){ return x.parcel_id===id; });
  if(p&&isFinite(Number(p.lon))&&isFinite(Number(p.lat))){
   _fsiFitting=true;
   _fsiMap.flyTo({center:[Number(p.lon),Number(p.lat)], zoom:Math.max(_fsiMap.getZoom(),opts.zoom||13), essential:true});
  }
 }
}

function fsiRefreshView(fit){
 fsiApplyFilters();
 const feats=fsiPaint();
 fsiRenderList();
 fsiRenderLegend();
 fsiRebuildCityUi();
 fsiRenderDrawer();
 if(fit) fsiFit(feats);
 const ban=document.getElementById('fsiBanner');
 const hasFix=_fsiState.raw.some(function(p){ return String(p.parcel_id||'').indexOf('FIXTURE-')===0; });
 if(ban){
  if(_fsiState.source==='fixtures'||hasFix){
   ban.classList.add('on');
   ban.textContent=_fsiState.source==='fixtures'
    ? 'Demo data: these are sample parcels, not real owners. Real county parcels appear once the county import has run.'
    : 'Demo data: some parcels in this set are samples, not real owners.';
  }else ban.classList.remove('on');
 }
 const ls=document.getElementById('fsiListStats');
 if(ls) ls.textContent=_fsiState.filtered.length+' of '+_fsiState.raw.length+(fsiSelectedCount()?' · '+fsiSelectedCount()+' selected':'');
 if(typeof mnAfterRefresh==='function') mnAfterRefresh();
}

function fsiFit(features){
 if(_fsiState.noFitOnce){ _fsiState.noFitOnce=false; return; }
 if(!_fsiMap||!features||!features.length) return;
 const b=new maplibregl.LngLatBounds();
 features.forEach(function(f){ b.extend(f.geometry.coordinates); });
 _fsiFitting=true;
 _fsiMap.fitBounds(b,{padding:60,maxZoom:12,duration:400});
}

function fsiPopup(e){
 const f=e.features&&e.features[0]; if(!f) return;
 const p=f.properties||{};
 fsiSelect(p.parcel_id,{fly:false});
 const addr=p.address||'(no address)';
 if(_fsiPopup) _fsiPopup.remove();
 _fsiPopup=new maplibregl.Popup({closeButton:true,maxWidth:'280px'})
  .setLngLat(e.lngLat)
  .setHTML('<div class="fsipop"><h4>'+esc(p.owner_name||'Owner unknown')+'</h4>'+
   '<p class="addr">'+esc(addr)+'</p>'+
   '<div class="fsi-meter-wrap">Live <span class="fsi-meter fsi-meter--pop"><i style="width:'+Math.min(100,Number(p.fsi_live)||0)+'%"></i></span> '+esc(fsiNum(p.fsi_live))+'</div>'+
   '<button type="button" class="btn p btn--sm" id="fsiPopDetail">Open details</button></div>')
  .addTo(_fsiMap);
 if(typeof mnFitPopup==='function') mnFitPopup(_fsiPopup);
 setTimeout(function(){
  document.getElementById('fsiPopDetail')?.addEventListener('click',function(){
   fsiSelect(p.parcel_id,{fly:true});
   if(_fsiPopup) _fsiPopup.remove();
   if(!(typeof mnIsSheet==='function'&&mnIsSheet())) document.getElementById('fsiDrawer')?.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
 },0);
}

async function fsiLoad(action){
 if(!_fsiMap) return;
 const minRaw=Number(document.getElementById('fsiMinScore').value);
 const limRaw=Number(document.getElementById('fsiLimit').value);
 const preset=_fsiState.preset;
 // Storm list is a county-wide RPC: every load in that mode re-reads it.
 if(preset==='storm') action='storm';
 const defaultLim=preset==='must'?200:500;
 const payload={
  action:action,
  minFsi:isFinite(minRaw)?minRaw:0,
  limit:isFinite(limRaw)&&limRaw>0?limRaw:defaultLim,
  sort: preset==='must'?'must':(preset==='claim_hot'?'heat':'fsi')
 };
 if(preset==='must'){ payload.mustBand='must'; payload.minMust=0; }
 if(action==='storm'){ payload.minRainMm=_fsiState.stormMinMm||25; payload.minBand='should'; }
 if(action==='viewport'){
  const b=_fsiMap.getBounds();
  if(b.getEast()-b.getWest()>1 || b.getNorth()-b.getSouth()>1){
   fsiSay('Zoom in a little: this view is too wide to search.');
   return;
  }
  payload.bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
 }
 // Cancel a slower, older load so its answer cannot overwrite this one.
 if(_fsiLoadCtl) try{ _fsiLoadCtl.abort(); }catch(e){}
 const ctl=(typeof AbortController!=='undefined')?new AbortController():null;
 _fsiLoadCtl=ctl;
 fsiSay('Loading…');
 try{
  const data=await fsiFetch(payload, ctl&&ctl.signal);
  if(ctl&&_fsiLoadCtl!==ctl) return;
  _fsiState.raw=Array.isArray(data.parcels)?data.parcels:[];
  _fsiState.source=data.source||'';
  fsiSetSourceBadge(_fsiState.source);
  if(action==='storm'){
   const cells=Array.isArray(data.cells)?data.cells:[];
   const maxRain=cells.reduce(function(m,c){ return Math.max(m, Number(c.rain_24h)||0); }, 0);
   const day=(cells[0]&&cells[0].rain_day)||(_fsiState.raw[0]&&_fsiState.raw[0].rain_day)||'';
   _fsiState.storm={cells:cells, maxRain:maxRain, day:day, minMm:payload.minRainMm, demo:!!data.demo};
  }
  fsiRefreshView(action==='top'||action==='storm');
  if(action==='storm'){
   const st=_fsiState.storm;
   fsiSay(_fsiState.raw.length
    ? ('<b>Yesterday'+(st.day?' ('+esc(st.day)+')':'')+'</b>: up to <b>'+Math.round(st.maxRain)+' mm</b> of rain · <b>'+st.cells.length+'</b> rain cells ≥ '+st.minMm+' mm · <b>'+_fsiState.raw.length+'</b> Must/Should parcels under them'+(st.demo?' · demo rain':''))
    : ('No rain cell had ≥ '+st.minMm+' mm yesterday — nothing to storm-dial today.'), true);
  }else if(!_fsiState.raw.length){
   fsiSay(preset==='must'
    ? 'No Must-dial parcels yet. Scores have not been computed for this county; try Top risk.'
    : (action==='top'
     ? 'No parcels scored yet. Scores appear once the county data has been processed.'
     : 'No parcels in this view above the score filter.'));
  }else{
   const mustNote=preset==='must'?' · Must dial top '+_fsiState.raw.length+(data.truncated?' (raise Max parcels for more)':''):'';
   fsiSay('<b>'+_fsiState.raw.length+'</b> loaded · <b>'+_fsiState.filtered.length+'</b> after filters'+mustNote+(data.truncated&&preset!=='must'?' · truncated at limit':''),true);
  }
 }catch(err){
  if(err&&err.name==='AbortError') return;
  if(action==='storm'){
   _fsiState.raw=[]; _fsiState.storm={error:'Storm list is not available yet: yesterday\'s rainfall has not been loaded. Use Must dial for now.'};
   fsiRefreshView(false);
   fsiSay(_fsiState.storm.error);
  }else fsiSay('Could not load parcels'+(err&&err.message&&!/fetch|network/i.test(err.message)?' ('+String(err.message).slice(0,80)+')':'')+'. Check your connection and try again.');
 }
 if(ctl&&_fsiLoadCtl===ctl) _fsiLoadCtl=null;
 _fsiMoved=false; fsiSyncSearchBtn();
}

/** First existing layer id from the list (to insert a layer below it), else undefined (top). */
function fsiFirstLayer(ids){
 for(let i=0;i<ids.length;i++) if(_fsiMap&&_fsiMap.getLayer(ids[i])) return ids[i];
 return undefined;
}
function fsiNfhlToggle(on){
 if(!_fsiMap) return;
 const has=!!_fsiMap.getSource('nfhl');
 const before=fsiFirstLayer(['fsi-claims-fill','fsi-claims-line','fsi-claims-pt','fsi-claim-heat','fsi-poly-fill','fsi-clusters','fsi-dots']);
 if(on&&!has){
  const op=(typeof mnOpacity==='function')?mnOpacity('fema'):0.45;
  _fsiMap.addSource('nfhl',{type:'raster',tiles:[FSI_NFHL],tileSize:256,attribution:'FEMA NFHL'});
  _fsiMap.addLayer({id:'nfhl',type:'raster',source:'nfhl',paint:{'raster-opacity':op}}, before);
 }else if(!on&&has){
  if(_fsiMap.getLayer('nfhl')) _fsiMap.removeLayer('nfhl');
  _fsiMap.removeSource('nfhl');
 }
 if(typeof mnLayersChanged==='function') mnLayersChanged();
}
/** Claim heat = neighborhood aggregate from OpenFEMA (not personal claims). */
function fsiClaimHeatToggle(on){
 if(!_fsiMap) return;
 const has=!!_fsiMap.getLayer('fsi-claim-heat');
 if(on&&!has&&_fsiMap.getSource('fsi')){
  const before=fsiFirstLayer(['fsi-poly-fill','fsi-clusters','fsi-dots']);
  _fsiMap.addLayer({
   id:'fsi-claim-heat', type:'heatmap', source:'fsi',
   maxzoom:16,
   paint:{
    'heatmap-weight':[
     'interpolate',['linear'],['coalesce',['get','claim_heat'],0],
     0,0, 0.25,0.35, 0.5,0.7, 0.75,0.9, 1,1
    ],
    'heatmap-intensity':['interpolate',['linear'],['zoom'], 8,0.6, 12,1.2, 15,1.6],
    'heatmap-color':[
     'interpolate',['linear'],['heatmap-density'],
     0,'rgba(0,0,0,0)',
     0.15,'rgba(255,235,180,0.35)',
     0.35,'rgba(255,170,80,0.55)',
     0.55,'rgba(230,90,40,0.7)',
     0.75,'rgba(180,30,40,0.8)',
     1,'rgba(100,0,30,0.9)'
    ],
    'heatmap-radius':['interpolate',['linear'],['zoom'], 8,18, 11,28, 14,40],
    'heatmap-opacity':0.72
   }
  }, before);
 }else if(!on&&has){
  _fsiMap.removeLayer('fsi-claim-heat');
 }
 if(typeof mnLayersChanged==='function') mnLayersChanged();
}

/** Parcel sources + layers. Runs on every style load (first load and theme switches). */
function fsiBuildLayers(){
 if(!_fsiMap.getSource('fsi')){
  _fsiMap.addSource('fsi',{
   type:'geojson',
   data:{type:'FeatureCollection',features:[]},
   cluster:true, clusterMaxZoom:14, clusterRadius:52,
   clusterProperties:{ sum_live:['+',['get','fsi_live']], max_band:['max',['get','band']] }
  });
 }
 const dark=fsiEffectiveTheme()==='dark';
 const ring=dark?'rgba(15,20,30,.9)':'rgba(255,255,255,.95)';
 const op=(typeof mnOpacity==='function')?mnOpacity('parcels'):0.9;
 if(!_fsiMap.getLayer('fsi-clusters')) _fsiMap.addLayer({
  id:'fsi-clusters', type:'circle', source:'fsi', filter:['has','point_count'],
  paint:{
   'circle-color':['step',['get','max_band'], FSI_BANDS[0].c, 1,FSI_BANDS[1].c, 2,FSI_BANDS[2].c, 3,FSI_BANDS[3].c, 4,FSI_BANDS[4].c],
   'circle-radius':['step',['get','point_count'], 16, 8,20, 25,26, 60,32],
   'circle-opacity':Math.min(1,op*0.98),
   'circle-stroke-width':2,
   'circle-stroke-color':dark?'rgba(15,20,30,.85)':'#fff'
  }
 });
 if(!_fsiMap.getLayer('fsi-cluster-count')) _fsiMap.addLayer({
  id:'fsi-cluster-count', type:'symbol', source:'fsi', filter:['has','point_count'],
  layout:{'text-field':['get','point_count_abbreviated'],'text-size':12},
  paint:{'text-color':'#fff'}
 });
 if(!_fsiMap.getLayer('fsi-halo')) _fsiMap.addLayer({
  id:'fsi-halo', type:'circle', source:'fsi',
  filter:['all',['!',['has','point_count']],['>=',['get','band'],3]],
  paint:{
   'circle-radius':['+',['get','r'],6],
   'circle-color':FSI_BANDS[4].c,
   // Parcels with an outline drawn (zoom >= 15) lose their dot; the outline carries the colour.
   'circle-opacity':['step',['zoom'],0.18, 15,['case',['==',['get','poly'],1],0,0.18]],
   'circle-blur':0.6
  }
 });
 if(!_fsiMap.getLayer('fsi-dots')) _fsiMap.addLayer({
  id:'fsi-dots', type:'circle', source:'fsi',
  filter:['!',['has','point_count']],
  paint:{
   'circle-radius':['case',['==',['get','selected'],1],['+',['get','r'],3],['get','r']],
   'circle-color':['match',['get','band'],
    0,FSI_BANDS[0].c, 1,FSI_BANDS[1].c, 2,FSI_BANDS[2].c, 3,FSI_BANDS[3].c, 4,FSI_BANDS[4].c,
    FSI_BANDS[0].c],
   'circle-opacity':['step',['zoom'],op, 15,['case',['==',['get','poly'],1],0,op]],
   'circle-stroke-opacity':['step',['zoom'],1, 15,['case',['==',['get','poly'],1],0,1]],
   'circle-stroke-width':['case',['==',['get','selected'],1],3,1],
   'circle-stroke-color':['case',['==',['get','selected'],1],'#F57C1F',ring]
  }
 });
}

/** One-time map event wiring. Layer-scoped handlers survive setStyle (they are keyed by layer id). */
function fsiWireMapEvents(){
 _fsiMap.on('click','fsi-clusters',function(e){
  const feats=_fsiMap.queryRenderedFeatures(e.point,{layers:['fsi-clusters']});
  const c=feats[0]; if(!c) return;
  const clusterId=c.properties.cluster_id;
  const src=_fsiMap.getSource('fsi');
  const go=function(zoom){ _fsiFitting=true; _fsiMap.easeTo({center:c.geometry.coordinates, zoom:zoom}); };
  // MapLibre 5 returns a Promise; older builds take a callback.
  const r=src.getClusterExpansionZoom(clusterId,function(err,zoom){ if(!err&&zoom!=null) go(zoom); });
  if(r&&typeof r.then==='function') r.then(go).catch(function(){});
 });
 _fsiMap.on('click','fsi-dots',fsiPopup);
 ['fsi-clusters','fsi-dots'].forEach(function(layer){
  _fsiMap.on('mouseenter',layer,function(){ _fsiMap.getCanvas().style.cursor='pointer'; });
  _fsiMap.on('mouseleave',layer,function(){ _fsiMap.getCanvas().style.cursor=''; });
 });
 _fsiMap.on('moveend',function(){
  if(typeof mnOnMoveEnd==='function') mnOnMoveEnd();
  if(_fsiFitting){ _fsiFitting=false; return; }
  _fsiMoved=true; fsiSyncSearchBtn();
 });
}

function fsiInit(){
 if(_fsiMap) return _fsiMap;
 const el=document.getElementById('fsiMap');
 if(!el) return null;
 if(typeof maplibregl==='undefined'){
  // R2: MapLibre (~1 MB) loads on first map open instead of blocking every page load.
  if(fsiInit._state==='failed'){ fsiSay('The map could not start. Reload the page; if it keeps happening, tell the admin.'); return null; }
  if(!fsiInit._state){
   fsiInit._state='loading';
   fsiSay('Loading the map…');
   const ver=(document.querySelector('meta[name="fg-maplibre"]')||{}).content||'';
   const css=document.createElement('link'); css.rel='stylesheet'; css.href='vendor/maplibre-gl.css'+(ver?'?v='+ver:'');
   document.head.appendChild(css);
   const js=document.createElement('script'); js.src='vendor/maplibre-gl.js'+(ver?'?v='+ver:''); js.async=true;
   js.onload=function(){ fsiInit._state='ready'; fsiInit(); };
   js.onerror=function(){ fsiInit._state='failed'; fsiSay('The map could not start (no connection?). Reload the page to try again.'); };
   document.head.appendChild(js);
  }
  return null;
 }
 const view=(typeof mnInitialView==='function'&&mnInitialView())||null;
 _fsiStyleUrl=fsiStyleUrl();
 _fsiMap=new maplibregl.Map({container:el,style:_fsiStyleUrl,center:view&&view.center||FSI_CENTER,zoom:view&&isFinite(view.zoom)?view.zoom:FSI_ZOOM,attributionControl:{compact:true}});
 _fsiMap.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
 if(view&&view.center) _fsiState.noFitOnce=true;
 fsiWireMapEvents();
 _fsiMap.on('style.load',function(){
  _fsiStyleLoads++;
  fsiBuildLayers();
  if(document.getElementById('fsiNfhl')?.checked) fsiNfhlToggle(true);
  if(document.getElementById('fsiClaimHeat')?.checked) fsiClaimHeatToggle(true);
  if(typeof mnOnStyleLoad==='function') mnOnStyleLoad(_fsiStyleLoads===1);
  fsiRenderLegend();
  if(_fsiStyleLoads===1) fsiLoad('top');
  else fsiPaint();
 });
 _fsiMap.on('error',function(ev){
  const msg=String((ev&&ev.error&&ev.error.message)||'');
  if(!/style/i.test(msg)) return;
  // R2: no basemap (weak signal in the truck, tile host down) must not mean no parcels. Fall back
  // to a plain background style once, so our layers, the ranked list and the detail still work.
  if(!_fsiStyleLoads&&!_fsiState.blankStyle){
   _fsiState.blankStyle=true;
   const dark=fsiEffectiveTheme()==='dark';
   _fsiStyleUrl='blank';
   _fsiMap.setStyle({version:8,glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':dark?'#121826':'#EEF1F5'}}]},{diff:false});
  }
  fsiSay('Street map could not load (check your connection). Parcels still show.');
 });
 return _fsiMap;
}
/** Swap the basemap when the app theme changes; style.load rebuilds our layers from state. */
function fsiSyncBasemap(){
 if(!_fsiMap||_fsiState.blankStyle) return;
 const want=fsiStyleUrl();
 if(want===_fsiStyleUrl) return;
 _fsiStyleUrl=want;
 // Our sources die with the old style; the NFHL source must be re-added by its toggle.
 _fsiMap.setStyle(want,{diff:false});
}

function fsiLeadFromParcel(p){
 const story=fsiStory(p);
 const sugs=fsiSuggestCauses(p);
 // Soft: primary = top high/med suggestion, else FrenchDrain; multi-check only high-strength soft tags
 const high=sugs.filter(function(s){ return s.strength==='high'; }).map(function(s){ return s.cause; });
 const med=sugs.filter(function(s){ return s.strength==='med'; }).map(function(s){ return s.cause; });
 let lists=high.length?high.slice():(med.length?[med[0]]:['FrenchDrain']);
 // Cap soft multi-assign at 2 causes so list tabs stay focused; rest stay in suggested_causes
 if(lists.length>2) lists=lists.slice(0,2);
 if(!lists.includes('FrenchDrain')&&!lists.includes('SumpPump')&&!lists.includes('YardDrainage')&&!lists.includes('PropertyMgmt')){
  if(!lists.includes('FrenchDrain')) lists.unshift('FrenchDrain');
 }
 const primary=lists[0]||'FrenchDrain';
 const cityKey=fsiParcelCity(p);
 const city=cityKey?fsiTitleCase(cityKey):(function(){
  const a=String(p.address||'');
  const m=a.match(/,\s*([^,]+),\s*FL/i); return m?fsiTitleCase(m[1].trim()):'Volusia';
 })();
 const jv=Number(p.just_value)||0;
 const industry=jv>=900000?'Commercial':'Residential';
 const sugLine=sugs.length
  ? ('Suggested causes (soft): '+sugs.map(function(s){ return s.cause+' ['+s.strength+'] — '+s.why; }).join('; '))
  : 'Suggested causes (soft): none — default FrenchDrain';
 const siteAddr=String(p.address||'').trim();
 const zip=p.zip?String(p.zip).trim():(function(){
  const m=siteAddr.match(/\bFL\s*(\d{5})(?:-\d{4})?\b/i); return m?m[1]:'';
 })();
 const notes=['FSI map import',
  'Site address: '+(siteAddr||'—'),
  'Must-Have: '+(isFinite(Number(p.must_have_score))?fsiNum(p.must_have_score):'—')+' ('+(p.must_have_band||'—')+')',
  'Live FSI: '+fsiNum(p.fsi_live),
  'Terrain S: '+fsiNum(p.fsi_static,3),
  'FEMA: '+(p.fema_zone||'—'),
  'Soil: '+(p.hsg||'—'),
  'Just value: '+(jv?('$'+Math.round(jv).toLocaleString()):'—'),
  'Use: '+(p.use_desc||p.dor_use||'—'),
  'Claim heat (neighborhood): '+(isFinite(Number(p.claim_heat))?fsiNum(p.claim_heat,2):'—')+' / n~'+(p.claim_count_10y||0),
  (typeof FSI_PURE!=='undefined'&&FSI_PURE.claimsLine(p).text?'Neighbourhood claims (OpenFEMA, not this owner): '+FSI_PURE.claimsLine(p).text:''),
  (typeof mnFieldReportNote==='function'?mnFieldReportNote(p.parcel_id):''),
  'Parcel: '+(p.parcel_id||''),
  story,
  sugLine,
  'Contact: owner name + site address from Volusia property appraiser (public). Phone/email not on tax roll — enrich separately; DNC before dial.',
  'Note: claim figures are OpenFEMA neighbourhood aggregates (block group / tract) — not a personal claim and not insurance advice. Assessment decides product.'
 ].filter(Boolean).join('\n');
 const lead={
  id:nextId(),
  // Owner name from tax roll (real public record) — not a generated alias
  name:(p.owner_name&&String(p.owner_name).trim())||siteAddr||('Parcel '+p.parcel_id),
  address:siteAddr,
  city:city,
  zip:zip,
  parcel_id:p.parcel_id?String(p.parcel_id):'',
  industry:industry, list:primary, lists:lists, list_status:{},
  // Phone/email intentionally empty: county GIS does not publish them
  phone:'', website:'', contact:'', email:'', status:'New', notes:notes, source:'FSI map',
  lists_touched:true,
  suggested_causes:sugs
 };
 // R2: carry the map's numbers as fields too (not only in the notes), so the leads table can rank
 // by flood score and the server row keeps the claims/terrain context. Neighbourhood aggregates only.
 const keep=['fsi_live','fsi_static','must_have_score','must_have_band','fema_zone','hsg','claim_heat','claim_count_10y',
  'block_group','claim_bg_count_10y','claim_bg_zone_x_10y','claim_bg_rate','claim_bg_last_year','claim_bg_top_event',
  'fsi_confidence','model_version','nbr_rel_m','street_rel_m','wt_depth_m','drain_class','lat','lon'];
 keep.forEach(function(k){ if(p[k]!=null&&p[k]!=='') lead[k]=p[k]; });
 const rep=(typeof mnReportFor==='function')?mnReportFor(p.parcel_id):null;
 if(rep) lead.field_report={v:rep.v, at:rep.at, by:rep.by||''};
 lists.forEach(function(c){ setListStatus(lead, c, 'New'); });
 return lead;
}
/** Existing lead for a parcel (R2: adding the same parcel twice made duplicate leads). */
function fsiLeadForParcel(pid){
 if(!pid) return null;
 const k=String(pid);
 return state.find(function(l){ return l&&String(l.parcel_id||'')===k; })||null;
}
async function fsiAddLead(){
 const p=_fsiState.filtered.find(function(x){ return x.parcel_id===_fsiState.selectedId; })
  || _fsiState.raw.find(function(x){ return x.parcel_id===_fsiState.selectedId; });
 if(!p){ fsiDrMsg('Select a parcel first.','err'); return; }
 const had=fsiLeadForParcel(p.parcel_id);
 if(had){ fsiDrMsg('Already in leads as '+(had.name||'this parcel')+'.','ok'); return; }
 const lead=fsiLeadFromParcel(p);
 state.unshift(lead);
 saveLeads();
 if(typeof render==='function') render();
 const addrNote=lead.address?(' · '+lead.address):' · (no address on parcel)';
 fsiDrMsg('Added to leads'+addrNote+'. The county record has no phone or email: enrich, then scrub DNC before dialing.','ok');
}
function fsiBulkAddLeads(){
 const ids=Object.keys(_fsiState.selected).filter(function(id){ return _fsiState.selected[id]; });
 if(!ids.length){ fsiSay('Select one or more parcels first.'); return; }
 let n=0, withAddr=0;
 ids.forEach(function(id){
  const p=_fsiState.filtered.find(function(x){ return String(x.parcel_id)===String(id); })
   || _fsiState.raw.find(function(x){ return String(x.parcel_id)===String(id); });
  if(!p||fsiLeadForParcel(p.parcel_id)) return;
  const lead=fsiLeadFromParcel(p);
  if(lead.address) withAddr++;
  state.unshift(lead);
  n++;
 });
 saveLeads();
 if(typeof render==='function') render();
 _fsiState.selected=Object.create(null);
 fsiRenderList();
 fsiSay('<b>'+n+'</b> leads added'+(ids.length>n?' ('+(ids.length-n)+' already in leads)':'')+' · <b>'+withAddr+'</b> with a site address · enrich for phones, then scrub DNC before dialing.',true);
}
function fsiBulkExportCsv(){
 const ids=Object.keys(_fsiState.selected).filter(function(id){ return _fsiState.selected[id]; });
 const rows=ids.length
  ? ids.map(function(id){
     return _fsiState.filtered.find(function(x){ return String(x.parcel_id)===String(id); })
      || _fsiState.raw.find(function(x){ return String(x.parcel_id)===String(id); });
    }).filter(Boolean)
  : _fsiState.filtered.slice();
 if(!rows.length){ fsiSay('Nothing to export.'); return; }
 const cols=['parcel_id','owner_name','address','city','fema_zone','hsg','fsi_live','must_have_score','must_have_band','claim_heat','claim_count_10y','block_group','nbhd_claims_10y','nbhd_zone_x_claims_10y','just_value','year_built','use_desc','story'];
 const escCsv=function(v){
  const s=String(v==null?'':v);
  return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
 };
 const lines=[cols.join(',')];
 rows.forEach(function(p){
  const city=fsiTitleCase(fsiParcelCity(p)||'');
  const rec={
   parcel_id:p.parcel_id, owner_name:p.owner_name, address:p.address, city:city,
   fema_zone:p.fema_zone, hsg:p.hsg, fsi_live:p.fsi_live, must_have_score:p.must_have_score,
   must_have_band:p.must_have_band, claim_heat:p.claim_heat, claim_count_10y:p.claim_count_10y,
   block_group:p.block_group||'', nbhd_claims_10y:p.claim_bg_count_10y==null?'':p.claim_bg_count_10y, nbhd_zone_x_claims_10y:p.claim_bg_zone_x_10y==null?'':p.claim_bg_zone_x_10y,
   just_value:p.just_value, year_built:p.year_built, use_desc:p.use_desc||'',
   story:fsiOneLiner(p)
  };
  lines.push(cols.map(function(c){ return escCsv(rec[c]); }).join(','));
 });
 const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'});
 const a=document.createElement('a');
 a.href=URL.createObjectURL(blob);
 a.download='floguard-fsi-targets-'+new Date().toISOString().slice(0,10)+'.csv';
 a.click();
 URL.revokeObjectURL(a.href);
 fsiSay('Exported <b>'+rows.length+'</b> rows. Scrub DNC / CAN-SPAM before outreach.',true);
}
async function fsiQueueDraft(){
 const p=_fsiState.filtered.find(function(x){ return x.parcel_id===_fsiState.selectedId; })
  || _fsiState.raw.find(function(x){ return x.parcel_id===_fsiState.selectedId; });
 if(!p){ fsiDrMsg('Select a parcel first.','err'); return; }
 const story=fsiStory(p);
 const name=p.owner_name||'there';
 const subj='Standing water after storms — free look at '+(p.address||'your property');
 const body='Hi,\n\n'+story+'\n\nWe install drainage systems for Central Florida properties and always start with a free on-site assessment (no pressure, no price over the phone).\n\nWorth a quick walk-through this week?\n\n- '+(currentUserName()||'FloGuard');
 try{
  const tok=getToken();
  if(!tok){ fsiDrMsg('Sign in required.','err'); return; }
  const r=await fetch('/crm/api/academy-drafts',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'append',draft:{
   lead_key:p.parcel_id||p.address||name, channel:'email', subject:subj, body:body,
   meta:{name:name, address:p.address||'', fsi_live:p.fsi_live, source:'fsi_map'}
  }})});
  const j=await r.json().catch(function(){return {};});
  if(!r.ok){ fsiDrMsg(j.error||'Could not queue draft','err'); return; }
  fsiDrMsg('Draft queued — open Outbound tab to approve.','ok');
 }catch(e){ fsiDrMsg('Queue failed: '+(e.message||e),'err'); }
}

document.getElementById('fsiSearchArea')?.addEventListener('click',function(){ fsiLoad('viewport'); });
document.getElementById('fsiTop')?.addEventListener('click',function(){ fsiLoad('top'); });
document.getElementById('fsiNfhl')?.addEventListener('change',function(){ fsiNfhlToggle(this.checked); });
document.getElementById('fsiClaimHeat')?.addEventListener('change',function(){
 fsiClaimHeatToggle(this.checked);
 if(this.checked) fsiSay('Claim heat = neighborhood NFIP aggregate (OpenFEMA). Not a personal claim flag.');
});
document.getElementById('fsiMinScore')?.addEventListener('change',function(){ fsiRefreshView(false); });
document.getElementById('fsiSearchText')?.addEventListener('input',function(){
 const v=this.value;
 clearTimeout(_fsiSearchTimer);
 _fsiSearchTimer=setTimeout(function(){ _fsiState.q=v; fsiRefreshView(false); },150);
});
document.getElementById('fsiCityFilter')?.addEventListener('change',function(){
 _fsiState.city=fsiCanonicalCityKey(this.value||'');
 fsiRefreshView(false);
});
document.getElementById('fsiCityChips')?.addEventListener('click',function(e){
 const b=e.target.closest('button[data-city]'); if(!b) return;
 _fsiState.city=fsiCanonicalCityKey(b.getAttribute('data-city')||'');
 const sel=document.getElementById('fsiCityFilter'); if(sel) sel.value=_fsiState.city;
 fsiRefreshView(false);
});
document.getElementById('fsiSelectAll')?.addEventListener('change',function(){
 const on=this.checked;
 _fsiState.filtered.forEach(function(p){ if(on) _fsiState.selected[p.parcel_id]=true; else delete _fsiState.selected[p.parcel_id]; });
 fsiRenderList();
});
document.getElementById('fsiBulkEnrich')?.addEventListener('click',function(){ fsiBulkAddAndEnrich(); });
document.getElementById('fsiBulkLeads')?.addEventListener('click',function(){ fsiBulkAddLeads(); });
document.getElementById('fsiBulkCsv')?.addEventListener('click',function(){ fsiBulkExportCsv(); });
document.getElementById('fsiBulkClear')?.addEventListener('click',function(){
 _fsiState.selected=Object.create(null);
 fsiRenderList();
});
document.getElementById('fsiPresets')?.addEventListener('click',function(e){
 const b=e.target.closest('button[data-preset]'); if(!b) return;
 const pre=b.getAttribute('data-preset');
 const wasStorm=_fsiState.preset==='storm';
 _fsiState.preset=pre==='clear'?'must':pre;
 if(pre==='clear'){
  _fsiState.bandFilter=null; _fsiState.q=''; _fsiState.city=''; _fsiState.bg=null;
  const si=document.getElementById('fsiSearchText'); if(si) si.value='';
  const cf=document.getElementById('fsiCityFilter'); if(cf) cf.value='';
 }
 if(pre==='claim_hot'){
  const ch=document.getElementById('fsiClaimHeat');
  if(ch&&!ch.checked){ ch.checked=true; fsiClaimHeatToggle(true); }
 }
 [...document.querySelectorAll('#fsiPresets button')].forEach(function(x){
  x.classList.toggle('on', pre==='clear'?x.getAttribute('data-preset')==='must':x===b);
  x.setAttribute('aria-pressed', x.classList.contains('on')?'true':'false');
 });
 // Reload from API with sort that matches dial mode
 if(pre==='storm') fsiLoad('storm');
 else if(pre==='must'||pre==='claim_hot'||pre==='top'||pre==='clear'||wasStorm) fsiLoad('top');
 else fsiRefreshView(false);
});
document.getElementById('fsiLegend')?.addEventListener('click',function(e){
 const k=e.target.closest('[data-band]'); if(!k) return;
 const v=k.getAttribute('data-band');
 _fsiState.bandFilter=v==='all'?null:Number(v);
 fsiRefreshView(false);
});
document.getElementById('fsiList')?.addEventListener('click',function(e){
 const ck=e.target.closest('.fsi-row-ck');
 if(ck){
  e.stopPropagation();
  const id=ck.getAttribute('data-id');
  if(ck.checked) _fsiState.selected[id]=true; else delete _fsiState.selected[id];
  fsiSyncBulkBar();
  return;
 }
 const row=e.target.closest('.fsi-row'); if(!row) return;
 fsiSelect(row.getAttribute('data-id'),{fly:true});
});
document.getElementById('fsiDrActs')?.addEventListener('click',function(e){
 const b=e.target.closest('[data-fsi-act]'); if(!b) return;
 const act=b.getAttribute('data-fsi-act');
 const p=_fsiState.filtered.find(function(x){ return x.parcel_id===_fsiState.selectedId; })
  || _fsiState.raw.find(function(x){ return x.parcel_id===_fsiState.selectedId; });
 if(act==='maps'){
  const addr=(p&&p.address)||'';
  window.open('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(addr),'_blank','noopener');
  fsiDrMsg('Opening Maps…','ok');
 }else if(act==='copy'){
  const t=(p&&(p.address||p.owner_name))||'';
  navigator.clipboard.writeText(t).then(function(){ fsiDrMsg('Copied.','ok'); }).catch(function(){ fsiDrMsg('Copy failed.','err'); });
 }else if(act==='lead'){ fsiAddLead(); }
 else if(act==='draft'){ fsiQueueDraft(); }
});
/* Init on first open — MapLibre needs a non-zero container. */
document.getElementById('nav')?.addEventListener('click',function(e){
 const b=e.target.closest('button');
 if(!b||b.dataset.p!=='fsi') return;
 if(!_fsiInited){ _fsiInited=true; fsiInit(); }
 else if(_fsiMap){ _fsiMap.resize(); }
});

/** R2: the Leads storm banner ("Open storm list") lands on the Storm list preset (contract in F1.md). */
window.fsiShowStorm=function(){
 const b=document.querySelector('#fsiPresets button[data-preset="storm"]');
 if(!b) return;
 if(_fsiState.preset==='storm'&&_fsiMap){ fsiLoad('storm'); return; }
 b.click();
};
