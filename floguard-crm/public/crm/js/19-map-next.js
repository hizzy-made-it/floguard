/* ================= FLOOD MAP NEXT (wave 2, agent F2) =================
 * Insurance-claims layers (block groups, zone/window/storm filters), parcel polygons at zoom >= 15,
 * address search, "Why this score", field reports, layer panel with opacity, legend for active
 * layers, URL hash state, box select, mobile bottom sheet, theme-following basemap.
 *
 * Classic script, loaded after js/16-fsi-map.js and js/19a-map-pure.js. 16 calls the mn* hooks
 * below at runtime only (guarded by typeof), so 16 keeps working if this file fails to load.
 * Pure logic (weights mirror, class breaks, claims metric, hash encode/decode, geometry) lives in
 * js/19a-map-pure.js and is unit-tested under tests/map/.
 *
 * Compliance: claim figures are OpenFEMA neighbourhood aggregates (census block group or tract),
 * never a statement that this owner filed a claim, and never insurance advice. FSI is not an
 * inspection. Keep that copy wherever claims or scores are shown.
 */
const MN={
 op:{fema:45, claims:45, parcels:90},
 claims:{on:true, zone:'all', win:'10y', event:null, available:null, demo:false, key:'', rows:new Map(), boxes:[], events:[], eventsState:'idle', ctl:null, model:null, truncated:false},
 poly:{disabled:false, note:'', cache:new Map(), boxes:[], ctl:null, demo:false},
 search:{ctl:null, timer:null, items:[], active:-1, seq:0},
 box:{on:false, drag:null, shift:false},
 hash:null, hashTimer:null, moveTimer:null, pendingSel:null, bander:null, popup:null
};
const MN_CLAIMS_MAX_SPAN=0.99;      // API refuses > 1 degree
const MN_POLY_MIN_ZOOM=15;
const MN_POLY_MAX_SPAN=0.058;       // API caps at 0.06 degrees
const MN_POLY_CACHE_MAX=6000;
const MN_REPORT_KEY='floguard_fsi_field_reports_v1';
const MN_COMPLIANCE='Neighbourhood totals (census block group) from OpenFEMA. Never this owner\'s claim. Not insurance advice.';

function mnEl(id){ return document.getElementById(id); }
function mnMap(){ return (typeof _fsiMap!=='undefined')?_fsiMap:null; }
function mnIsSheet(){ try{ return window.matchMedia('(max-width: 820px)').matches; }catch(e){ return false; } }
function mnFindParcel(id){
 if(id==null) return null;
 const k=String(id);
 return _fsiState.filtered.find(function(x){ return String(x.parcel_id)===k; })||_fsiState.raw.find(function(x){ return String(x.parcel_id)===k; })||null;
}

/* ----------------------------------------------------------------------------------------
 * Opacity + layer panel
 * ---------------------------------------------------------------------------------------- */
function mnOpacity(kind){ return Math.max(0.05, Math.min(1, (MN.op[kind]!=null?MN.op[kind]:60)/100)); }

function mnApplyOpacity(kind){
 const map=mnMap(); if(!map) return;
 const o=mnOpacity(kind);
 if(kind==='fema'&&map.getLayer('nfhl')) map.setPaintProperty('nfhl','raster-opacity',o);
 if(kind==='claims') mnClaimsPaintProps();
 if(kind==='parcels'){
  if(map.getLayer('fsi-dots')) map.setPaintProperty('fsi-dots','circle-opacity',['step',['zoom'],o, MN_POLY_MIN_ZOOM,['case',['==',['get','poly'],1],0,o]]);
  if(map.getLayer('fsi-clusters')) map.setPaintProperty('fsi-clusters','circle-opacity',Math.min(1,o*0.98));
  mnPolyPaintProps();
 }
}

function mnLayersPop(open){
 const pop=mnEl('fsiLayersPop'), btn=mnEl('fsiLayersBtn');
 if(!pop||!btn) return;
 const want=open==null?pop.hidden:open;
 pop.hidden=!want;
 btn.setAttribute('aria-expanded', want?'true':'false');
 btn.classList.toggle('on', want);
}

/* ----------------------------------------------------------------------------------------
 * Legend for the active layers (appended under the terrain band chips by fsiRenderLegend)
 * ---------------------------------------------------------------------------------------- */
function mnLegendHtml(){
 const parts=[];
 parts.push('<button type="button" class="lg-toggle" data-mn-legend aria-expanded="'+(mnEl('fsiLegend')?.classList.contains('open')?'true':'false')+'">Legend</button>');
 const map=mnMap();
 const c=MN.claims;
 if(c.on&&c.available&&c.model&&c.model.items.length){
  const m=c.model;
  const what=c.zone==='x'?'outside flood zones':c.zone==='sfha'?'in SFHA':'all zones';
  const when=c.event?FSI_PURE.shortEvent(c.event.label||c.event.key):(c.win==='all'?'all years':(c.win==='5y'&&c.zone!=='all'?'10 yr':c.win.replace('y',' yr')));
  const unit=m.mode==='rate'?'claims per 100 homes':'weighted claims';
  parts.push('<div class="lg-row lg-claims" title="'+esc(MN_COMPLIANCE)+'"><span class="lg-title">Claims · '+esc(unit)+' · '+esc(what)+' · '+esc(when)+(c.demo?' · <b>demo</b>':'')+'</span><span class="lg-ramp">'+
   m.legend.map(function(e){ return '<span class="lg-step"><i style="background:'+e.color+'"></i>'+esc(FSI_PURE.legendLabel(e, m.mode))+'</span>'; }).join('')+
   (m.items.some(function(x){ return x.cls===-1; })?'<span class="lg-step"><i style="background:'+m.nodata+'"></i>no home count</span>':'')+
   '</span></div>');
 }
 if(mnEl('fsiClaimHeat')?.checked) parts.push('<div class="lg-row"><span class="lg-title">Tract heat</span><i class="lg-grad lg-grad--heat"></i><span class="lg-meta">low → high (neighbourhood)</span></div>');
 if(mnEl('fsiNfhl')?.checked) parts.push('<div class="lg-row"><span class="lg-title">FEMA NFHL</span><i class="lg-sw lg-sw--fema"></i><span class="lg-meta">mapped flood hazard (FEMA symbology)</span></div>');
 if(map&&map.getZoom()>=MN_POLY_MIN_ZOOM&&MN.poly.cache.size&&!MN.poly.disabled) parts.push('<div class="lg-row"><span class="lg-title">Parcels</span><i class="lg-sw lg-sw--lot"></i><span class="lg-meta">outline = terrain band · faint = not in the ranked list</span></div>');
 return parts.join('');
}

/* ----------------------------------------------------------------------------------------
 * Claims: events, block-group layer, popup, filter
 * ---------------------------------------------------------------------------------------- */
function mnClaimsKey(){ return MN.claims.event?(MN.claims.event.key+'@'+(MN.claims.event.year||'')):''; }

function mnClaimsStatus(msg, cls){
 const el=mnEl('fsiClaimsStatus'); if(!el) return;
 el.className='fsi-claims-note'+(cls?' '+cls:'');
 el.innerHTML=msg;
}

function mnClaimsSyncBar(){
 const bar=mnEl('fsiClaimsBar'); if(!bar) return;
 const c=MN.claims;
 bar.hidden=!c.on;
 const ctrls=mnEl('fsiClaimsCtrls'); if(ctrls) ctrls.hidden=c.available===false;
 if(!c.on) return;
 bar.classList.toggle('is-unavailable', c.available===false);
 bar.querySelectorAll('[data-cz]').forEach(function(b){ const on=b.getAttribute('data-cz')===c.zone; b.classList.toggle('on',on); b.setAttribute('aria-pressed',on?'true':'false'); b.disabled=c.available===false; });
 bar.querySelectorAll('[data-cw]').forEach(function(b){
  const on=b.getAttribute('data-cw')===c.win; b.classList.toggle('on',on&&!c.event); b.setAttribute('aria-pressed',on&&!c.event?'true':'false');
  b.disabled=c.available===false||!!c.event;
  b.title=c.event?'A storm is selected: its own claims are shown':'';
 });
 mnRenderEventChips();
 if(c.available===false){
  mnClaimsStatus('Claims data not loaded yet. Block-group claims arrive once fsi/sql/016 is applied and the claims ingest has run. <button type="button" class="linkbtn" data-mn-use-heat>Use tract heat</button>','muted');
  return;
 }
 if(c.available==null){ mnClaimsStatus('Loading neighbourhood claims… '+esc(MN_COMPLIANCE),'muted'); return; }
 const n=c.model?c.model.items.length:0;
 let extra='';
 if(c.model&&c.model.fallback&&!c.event) extra=' The 5-yr window has no zone split, so the 10-yr split is shown.';
 if(c.truncated) extra+=' Zoom in to see every block group.';
 mnClaimsStatus((c.demo?'<b class="demo-tag">Demo data</b> ':'')+'<span title="'+esc(MN_COMPLIANCE)+'">OpenFEMA neighbourhood totals ('+n+' block group'+(n===1?'':'s')+'). Never this owner\'s claim. Not insurance advice.</span>'+esc(extra));
}

function mnRenderEventChips(){
 const box=mnEl('fsiClaimsEvents'); if(!box) return;
 const c=MN.claims;
 if(c.available===false||!c.events.length){ box.innerHTML=c.eventsState==='loading'?'<span class="hint">Loading storms…</span>':''; return; }
 const cur=c.event;
 const chips=c.events.slice(0,7).map(function(e,i){
  const on=cur&&cur.key===e.key&&(!cur.year||cur.year===e.year);
  return '<button type="button" class="ev-chip'+(on?' on':'')+'" data-ev="'+i+'" aria-pressed="'+(on?'true':'false')+'" title="'+esc(e.label+': '+FSI_PURE.fmtInt(e.total_claims)+' claims, '+FSI_PURE.fmtInt(e.zone_x_claims)+' outside flood zones, '+FSI_PURE.fmtInt(e.block_groups)+' block groups')+'">'+esc(FSI_PURE.shortEvent(e.label))+'</button>';
 });
 box.innerHTML='<span class="ev-label">Storm</span><button type="button" class="ev-chip'+(cur?'':' on')+'" data-ev="all" aria-pressed="'+(cur?'false':'true')+'">All storms</button>'+chips.join('');
}

async function mnLoadEvents(){
 const c=MN.claims;
 if(c.eventsState==='loading'||c.eventsState==='done') return;
 c.eventsState='loading';
 mnRenderEventChips();
 try{
  const data=await fsiFetch({action:'claims_events', minClaims:25, namedOnly:true});
  if(data&&data.available===false){ c.eventsState='done'; c.events=[]; mnRenderEventChips(); return; }
  c.events=(data&&Array.isArray(data.events)?data.events:[]).filter(function(e){ return e&&e.key; });
  c.eventsState='done';
  // Resolve a storm picked in a shared link to its label.
  if(c.event&&!c.event.label){ const m=c.events.find(function(e){ return e.key===c.event.key&&(!c.event.year||e.year===c.event.year); }); if(m) c.event.label=m.label; }
 }catch(err){ c.eventsState='idle'; c.events=[]; }
 mnClaimsSyncBar();
}

function mnViewBbox(){
 const map=mnMap(); if(!map) return null;
 const b=map.getBounds();
 return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

async function mnClaimsLoad(force){
 const c=MN.claims, map=mnMap();
 if(!c.on||!map||c.available===false&&!force) return;
 const view=mnViewBbox(); if(!view) return;
 if(view[2]-view[0]>MN_CLAIMS_MAX_SPAN||view[3]-view[1]>MN_CLAIMS_MAX_SPAN){
  mnClaimsStatus('Zoom in to load neighbourhood claims (the view is wider than 1°). '+esc(MN_COMPLIANCE),'muted');
  return;
 }
 const key=mnClaimsKey();
 if(key!==c.key){ c.key=key; c.rows=new Map(); c.boxes=[]; }
 if(!force&&c.boxes.some(function(b){ return FSI_PURE.bboxContains(b, view); })){ mnClaimsPaint(); return; }
 const box=FSI_PURE.padBbox(view, 0.25, MN_CLAIMS_MAX_SPAN);
 if(c.ctl) try{ c.ctl.abort(); }catch(e){}
 const ctl=(typeof AbortController!=='undefined')?new AbortController():null;
 c.ctl=ctl;
 const payload={action:'claims_layer', bbox:box, includeGeom:true, limit:600};
 if(c.event){ payload.event=c.event.key; if(c.event.year) payload.eventYear=c.event.year; }
 try{
  const data=await fsiFetch(payload, ctl&&ctl.signal);
  if(ctl&&c.ctl!==ctl) return;
  c.ctl=null;
  if(!data||data.available===false||!Array.isArray(data.rows)){
   c.available=false; c.rows=new Map(); c.model=null;
   mnClaimsPaint(); mnClaimsSyncBar(); fsiRenderLegend();
   return;
  }
  c.available=true;
  c.demo=!!data.demo||data.source==='fixtures';
  c.truncated=!!data.truncated;
  if(mnClaimsKey()!==key) return;
  data.rows.forEach(function(r){ if(r&&r.fips) c.rows.set(String(r.fips), r); });
  if(!data.truncated) c.boxes.push(box);
  if(c.boxes.length>24) c.boxes.shift();
  if(c.eventsState==='idle') mnLoadEvents();
  mnClaimsPaint();
  mnResolveBg();
 }catch(err){
  if(err&&err.name==='AbortError') return;
  c.ctl=null;
  mnClaimsStatus('Claims layer failed to load: '+esc(err.message||String(err))+'. '+esc(MN_COMPLIANCE),'err');
 }
}

/** Colour every cached block group for the current zone/window/event and push it to the map. */
function mnClaimsPaint(){
 const c=MN.claims, map=mnMap();
 const rows=[...c.rows.values()];
 c.model=c.available&&rows.length?FSI_PURE.claimsModel(rows,{zone:c.zone, win:c.win, event:!!c.event, dark:(typeof fsiEffectiveTheme==='function'&&fsiEffectiveTheme()==='dark')}):null;
 if(map){
  const polys=[], pts=[];
  if(c.model) c.model.items.forEach(function(it){
   const r=it.row;
   const props={fips:String(r.fips), color:it.color, cls:it.cls, zero:it.zero?1:0, v:it.value==null?-1:it.value};
   if(r.geom&&r.geom.coordinates) polys.push({type:'Feature', geometry:r.geom, properties:props});
   else if(isFinite(Number(r.lon))&&isFinite(Number(r.lat))) pts.push({type:'Feature', geometry:{type:'Point', coordinates:[Number(r.lon),Number(r.lat)]}, properties:props});
  });
  map.getSource('fsi-claims')?.setData({type:'FeatureCollection', features:polys});
  map.getSource('fsi-claims-pts')?.setData({type:'FeatureCollection', features:pts});
  mnClaimsVisibility();
 }
 mnClaimsSyncBar();
 fsiRenderLegend();
}

function mnClaimsPaintProps(){
 const map=mnMap(); if(!map||!map.getLayer('fsi-claims-fill')) return;
 const o=mnOpacity('claims');
 // Low classes are fainter as well as lighter, so the layer reads as a heat surface, not a checkerboard.
 const fill=function(k){ return ['case',['==',['get','zero'],1],o*0.2*k,['==',['get','cls'],-1],o*0.45*k,['*',o*k,['interpolate',['linear'],['get','cls'],0,0.45,4,1]]]; };
 // At street level the block group is the whole screen: fade it so parcels and streets read.
 map.setPaintProperty('fsi-claims-fill','fill-opacity',['interpolate',['linear'],['zoom'],13,fill(1),16,fill(0.35)]);
 map.setPaintProperty('fsi-claims-line','line-opacity',Math.min(1,o*0.9));
 map.setPaintProperty('fsi-claims-pt','circle-opacity',o);
}

function mnClaimsVisibility(){
 const map=mnMap(); if(!map) return;
 const vis=MN.claims.on&&MN.claims.available?'visible':'none';
 ['fsi-claims-fill','fsi-claims-line','fsi-claims-pt','fsi-claims-sel'].forEach(function(id){ if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',vis); });
 mnBgSelPaint();
}

function mnBgSelPaint(){
 const map=mnMap(); if(!map||!map.getLayer('fsi-claims-sel')) return;
 const f=_fsiState.bg?String(_fsiState.bg.fips):'__none__';
 map.setFilter('fsi-claims-sel',['==',['get','fips'],f]);
}

function mnAddClaimsLayers(){
 const map=mnMap(); if(!map) return;
 const dark=fsiEffectiveTheme()==='dark';
 if(!map.getSource('fsi-claims')) map.addSource('fsi-claims',{type:'geojson', data:{type:'FeatureCollection',features:[]}, attribution:'Claims: OpenFEMA NFIP (neighbourhood totals)'});
 if(!map.getSource('fsi-claims-pts')) map.addSource('fsi-claims-pts',{type:'geojson', data:{type:'FeatureCollection',features:[]}});
 const before=fsiFirstLayer(['fsi-claim-heat','fsi-poly-fill','fsi-clusters','fsi-halo','fsi-dots']);
 if(!map.getLayer('fsi-claims-fill')) map.addLayer({id:'fsi-claims-fill', type:'fill', source:'fsi-claims', paint:{'fill-color':['get','color'], 'fill-opacity':0.5}}, before);
 if(!map.getLayer('fsi-claims-line')) map.addLayer({id:'fsi-claims-line', type:'line', source:'fsi-claims', paint:{'line-color':dark?'rgba(230,226,245,.55)':'rgba(60,40,110,.45)', 'line-width':['interpolate',['linear'],['zoom'],9,0.3,14,1.1]}}, before);
 if(!map.getLayer('fsi-claims-sel')) map.addLayer({id:'fsi-claims-sel', type:'line', source:'fsi-claims', filter:['==',['get','fips'],'__none__'], paint:{'line-color':'#F57C1F','line-width':3}}, before);
 if(!map.getLayer('fsi-claims-pt')) map.addLayer({id:'fsi-claims-pt', type:'circle', source:'fsi-claims-pts', paint:{'circle-color':['get','color'],'circle-radius':['interpolate',['linear'],['get','cls'],-1,5,0,5,4,15],'circle-opacity':0.6,'circle-stroke-width':1,'circle-stroke-color':dark?'rgba(15,20,30,.8)':'#fff'}}, before);
 mnClaimsPaintProps();
 mnClaimsPaint();
}

function mnClaimsAtPoint(e){
 const map=mnMap();
 // Parcels sit on top: a click on a dot/outline belongs to them.
 const above=map.queryRenderedFeatures(e.point,{layers:['fsi-dots','fsi-clusters','fsi-poly-fill'].filter(function(id){ return map.getLayer(id); })});
 if(above.some(function(f){ return f.layer.id!=='fsi-dots'||Number(f.properties.poly)!==1||map.getZoom()<MN_POLY_MIN_ZOOM; })) return null;
 const f=e.features&&e.features[0]; if(!f) return null;
 return MN.claims.rows.get(String(f.properties.fips))||null;
}

function mnBgPopupHtml(r){
 const c=MN.claims;
 const hu=FSI_PURE.num(r.housing_units);
 const per=function(n){ return hu?(' <span class="per">· '+(n/hu*100).toFixed(n/hu*100<1?2:1)+' per 100 homes</span>'):''; };
 const fips=String(r.fips||'');
 const label=fips.length===12?(fips.slice(5,11)+' · '+fips.slice(11)):fips;
 const s=r.sfha_10y||0, x=r.zone_x_10y||0, o=r.other_10y||0, tot=Math.max(1,s+x+o);
 let ev='';
 if(r.event){
  ev='<div class="bg-ev"><b>'+esc(FSI_PURE.shortEvent(c.event&&c.event.label||r.event.key))+'</b>: '+FSI_PURE.fmtInt(r.event.count)+' claims · '+FSI_PURE.fmtInt(r.event.zone_x)+' outside flood zones · paid '+FSI_PURE.fmtMoney(r.event.paid)+'</div>';
 }
 return '<div class="fsipop bgpop">'+
  '<h4>Neighbourhood claims'+(r.demo?' <span class="fsi-chip">Demo</span>':'')+'</h4>'+
  '<p class="addr">Census block group '+esc(label)+(hu?' · '+FSI_PURE.fmtInt(hu)+' homes':'')+'</p>'+
  ev+
  '<dl class="bg-stats">'+
  '<div class="wide"><dt>Claims, 10 yr</dt><dd><b>'+FSI_PURE.fmtInt(r.count_10y)+'</b>'+per(r.count_10y||0)+'</dd></div>'+
  '<div><dt>5 yr / all</dt><dd>'+FSI_PURE.fmtInt(r.count_5y)+' / '+FSI_PURE.fmtInt(r.count_all)+'</dd></div>'+
  '<div><dt>Paid, 10 yr</dt><dd>'+FSI_PURE.fmtMoney(r.paid_10y)+'</dd></div>'+
  '<div><dt>Last claim</dt><dd>'+(r.last_year?esc(String(r.last_year)):'—')+'</dd></div>'+
  '<div class="wide"><dt>Top storm</dt><dd>'+(r.top_event?esc(r.top_event)+(r.top_event_claims?' · '+FSI_PURE.fmtInt(r.top_event_claims):''):'—')+'</dd></div>'+
  '<div><dt>Median depth</dt><dd>'+(r.median_depth_in!=null?FSI_PURE.fmtInt(r.median_depth_in)+' in':'—')+'</dd></div>'+
  '</dl>'+
  '<div class="bg-split" aria-label="10-year zone split: '+s+' in SFHA, '+x+' outside flood zones, '+o+' other">'+
  '<span class="z-sfha" style="width:'+(s/tot*100)+'%"></span><span class="z-x" style="width:'+(x/tot*100)+'%"></span><span class="z-o" style="width:'+(o/tot*100)+'%"></span></div>'+
  '<div class="bg-split-key"><span><i class="z-sfha"></i>SFHA '+s+'</span><span><i class="z-x"></i>Zone X '+x+'</span>'+(o?'<span><i class="z-o"></i>Other '+o+'</span>':'')+'</div>'+
  '<p class="bg-note">'+esc(MN_COMPLIANCE)+'</p>'+
  '<button type="button" class="btn p btn--sm" data-mn-bg-show="'+esc(fips)+'">Show parcels here</button>'+
  '</div>';
}

function mnBgClick(e){
 const r=mnClaimsAtPoint(e); if(!r) return;
 if(MN.popup) MN.popup.remove();
 if(typeof _fsiPopup!=='undefined'&&_fsiPopup) _fsiPopup.remove();
 MN.popup=new maplibregl.Popup({closeButton:true, maxWidth:'300px', className:'mn-bgpop'}).setLngLat(e.lngLat).setHTML(mnBgPopupHtml(r)).addTo(mnMap());
 mnFitPopup(MN.popup);
}
/** Pan just enough that a tall popup is fully inside the map frame. */
function mnFitPopup(pop){
 requestAnimationFrame(function(){
  const map=mnMap(); const el=pop&&pop.getElement&&pop.getElement(); if(!map||!el) return;
  const m=map.getContainer().getBoundingClientRect();
  const content=el.querySelector('.maplibregl-popup-content');
  if(content){ content.style.maxHeight=Math.max(160, m.height-28)+'px'; content.style.overflowY='auto'; }
  const r=el.getBoundingClientRect();
  let dx=0, dy=0;
  if(r.bottom>m.bottom-8) dy=r.bottom-m.bottom+12;
  if(r.top-dy<m.top+8) dy=r.top-m.top-12;
  if(r.right>m.right-8) dx=r.right-m.right+12;
  if(r.left-dx<m.left+8) dx=r.left-m.left-12;
  if(dx||dy){ _fsiFitting=true; map.panBy([dx,dy],{duration:250}); }
 });
}

/** "Show parcels here": filter the ranked list to one block group and load the parcels on screen there. */
function mnShowBg(fips){
 const r=MN.claims.rows.get(String(fips)); if(!r) return;
 _fsiState.bg={fips:String(r.fips), geom:r.geom||null, bbox:r.bbox&&r.bbox.every(isFinite)?r.bbox:null, label:String(r.fips)};
 if(MN.popup){ MN.popup.remove(); MN.popup=null; }
 mnBgSelPaint();
 const map=mnMap();
 if(map&&_fsiState.bg.bbox){
  const b=_fsiState.bg.bbox;
  _fsiFitting=true;
  map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:48, maxZoom:15.5, duration:450});
  map.once('moveend',function(){ fsiLoad('viewport'); });
 }else fsiRefreshView(false);
}

function mnClearBg(){
 _fsiState.bg=null;
 mnBgSelPaint();
 fsiRefreshView(false);
}

/** A block group from a shared link only has its fips: fill in geometry once the claims rows arrive. */
function mnResolveBg(){
 const bg=_fsiState.bg; if(!bg||bg.geom||bg.bbox) return;
 const r=MN.claims.rows.get(String(bg.fips)); if(!r) return;
 bg.geom=r.geom||null; bg.bbox=r.bbox||null;
 mnBgSelPaint();
 fsiRefreshView(false);
}

function mnFilterList(list){
 const bg=_fsiState.bg;
 if(!bg) return list;
 return list.filter(function(p){ return FSI_PURE.inBlockGroup(p, bg); });
}

/* ----------------------------------------------------------------------------------------
 * Parcel polygons (zoom >= 15)
 * ---------------------------------------------------------------------------------------- */
function mnHasPoly(id){ return MN.poly.cache.has(String(id)); }

function mnAddPolyLayers(){
 const map=mnMap(); if(!map) return;
 if(!map.getSource('fsi-poly')) map.addSource('fsi-poly',{type:'geojson', data:{type:'FeatureCollection',features:[]}});
 const before=fsiFirstLayer(['fsi-clusters','fsi-halo','fsi-dots']);
 if(!map.getLayer('fsi-poly-fill')) map.addLayer({id:'fsi-poly-fill', type:'fill', source:'fsi-poly', minzoom:MN_POLY_MIN_ZOOM-0.5, paint:{'fill-color':['get','color'],'fill-opacity':0.5}}, before);
 if(!map.getLayer('fsi-poly-line')) map.addLayer({id:'fsi-poly-line', type:'line', source:'fsi-poly', minzoom:MN_POLY_MIN_ZOOM-0.5, paint:{'line-color':['case',['==',['get','sel'],1],'#F57C1F',['get','color']],'line-width':['case',['==',['get','sel'],1],3.2,['==',['get','listed'],1],1.6,0.7]}}, before);
 mnPolyPaintProps();
 mnPolyPaint();
}

function mnPolyPaintProps(){
 const map=mnMap(); if(!map||!map.getLayer('fsi-poly-fill')) return;
 const o=mnOpacity('parcels');
 map.setPaintProperty('fsi-poly-fill','fill-opacity',['case',['==',['get','listed'],1],o*0.6,o*0.16]);
 map.setPaintProperty('fsi-poly-line','line-opacity',['case',['==',['get','listed'],1],Math.min(1,o*1.05),o*0.55]);
}

function mnPolyPaint(){
 const map=mnMap(); if(!map) return;
 const src=map.getSource('fsi-poly'); if(!src) return;
 const listed=new Map();
 _fsiState.filtered.forEach(function(p){ listed.set(String(p.parcel_id), p._band||0); });
 const bander=MN.bander||function(){ return 0; };
 const sel=String(_fsiState.selectedId||'');
 const feats=[];
 MN.poly.cache.forEach(function(f, id){
  const isListed=listed.has(id);
  const band=isListed?listed.get(id):bander(Number(f.properties.fsi_static)||0);
  feats.push({type:'Feature', geometry:f.geometry, properties:{
   parcel_id:id, listed:isListed?1:0, sel:id===sel?1:0,
   color:(FSI_BANDS[band]||FSI_BANDS[0]).c
  }});
 });
 src.setData({type:'FeatureCollection', features:feats});
}

async function mnPolyLoad(){
 const P=MN.poly, map=mnMap();
 if(!map||P.disabled||map.getZoom()<MN_POLY_MIN_ZOOM) return;
 const view=mnViewBbox();
 if(P.boxes.some(function(b){ return FSI_PURE.bboxContains(b, view); })) return;
 const box=FSI_PURE.padBbox(view, 0.15, MN_POLY_MAX_SPAN);
 if(P.ctl) try{ P.ctl.abort(); }catch(e){}
 const ctl=(typeof AbortController!=='undefined')?new AbortController():null;
 P.ctl=ctl;
 try{
  const data=await fsiFetch({action:'parcel_geom', bbox:box, limit:900}, ctl&&ctl.signal);
  if(ctl&&P.ctl!==ctl) return;
  P.ctl=null;
  if(!data||data.available===false){
   if(data&&data.reason==='no_rpc'){ P.disabled=true; P.note='Parcel outlines are not available yet (fsi/sql/019 not applied); the map keeps dots.'; }
   else P.boxes.push(box); // no geometry stored here: do not ask again
   mnLayersNote();
   return;
  }
  P.demo=!!data.demo;
  (data.features||[]).forEach(function(f){
   const id=String(f.properties&&f.properties.parcel_id||f.id||'');
   if(!id) return;
   if(P.cache.has(id)) P.cache.delete(id);
   P.cache.set(id, f);
  });
  while(P.cache.size>MN_POLY_CACHE_MAX){ P.cache.delete(P.cache.keys().next().value); }
  if(!data.truncated) P.boxes.push(box);
  if(P.boxes.length>40) P.boxes.shift();
  mnPolyPaint();
  fsiPaint(); // hides dots that now have an outline
  fsiRenderLegend();
 }catch(err){
  if(err&&err.name==='AbortError') return;
  P.ctl=null;
 }
}

function mnLayersNote(){
 const el=mnEl('fsiLayersNote'); if(!el) return;
 el.textContent='Basemap follows the app theme (OpenFreeMap; no free hillshade there). '+(MN.poly.disabled?MN.poly.note:'Parcel outlines draw from zoom 15.');
}

function mnPolyClick(e){
 const map=mnMap();
 const f=e.features&&e.features[0]; if(!f) return;
 const id=String(f.properties.parcel_id);
 // The (hidden) dot underneath already handled a loaded parcel.
 const dots=map.queryRenderedFeatures(e.point,{layers:['fsi-dots']});
 if(dots.some(function(d){ return String(d.properties.parcel_id)===id; })) return;
 const p=mnFindParcel(id);
 if(p){ fsiSelect(id,{fly:false}); return; }
 if(MN.popup) MN.popup.remove();
 MN.popup=new maplibregl.Popup({closeButton:true, maxWidth:'260px'}).setLngLat(e.lngLat)
  .setHTML('<div class="fsipop"><h4>Parcel '+esc(id)+'</h4><p class="addr">Not in the ranked list loaded now (filters or the Max parcels cap leave it out).</p><button type="button" class="btn btn--sm" data-mn-load-view>Search this area</button></div>')
  .addTo(map);
}

/* ----------------------------------------------------------------------------------------
 * Map lifecycle hooks (called from 16)
 * ---------------------------------------------------------------------------------------- */
function mnInitialView(){
 const h=MN.hash;
 if(!h||!h.center) return null;
 return {center:h.center, zoom:h.zoom};
}

let _mnWired=false;
function mnOnStyleLoad(first){
 mnAddClaimsLayers();
 if(!first&&MN.claims.rows.size) mnClaimsPaint(); // theme switch: repaint with that theme's ramp
 mnAddPolyLayers();
 mnApplyOpacity('parcels');
 if(_mnWired) return;
 _mnWired=true;
 const map=mnMap();
 map.on('click','fsi-claims-fill',mnBgClick);
 map.on('click','fsi-claims-pt',mnBgClick);
 map.on('click','fsi-poly-fill',mnPolyClick);
 ['fsi-claims-fill','fsi-claims-pt','fsi-poly-fill'].forEach(function(id){
  map.on('mouseenter',id,function(){ map.getCanvas().style.cursor='pointer'; });
  map.on('mouseleave',id,function(){ if(!MN.box.on) map.getCanvas().style.cursor=''; });
 });
 // Shift+drag is our box select, not MapLibre's box zoom.
 try{ map.boxZoom.disable(); }catch(e){}
 // Compact attribution starts expanded and covers the legend on phones: fold it until the user opens it.
 let attribTouched=false;
 const attrib=map.getContainer().querySelector('.maplibregl-ctrl-attrib');
 if(attrib){
  attrib.addEventListener('click',function(){ attribTouched=true; });
  const fold=function(){ if(!attribTouched) attrib.classList.remove('maplibregl-compact-show'); };
  map.once('idle',fold);
  map.on('sourcedata',function(ev){ if(ev&&ev.sourceId==='fsi-claims') setTimeout(fold,0); });
 }
 mnWireBoxSelect();
 if(MN.claims.on){ mnLoadEvents(); mnClaimsLoad(); }
 mnPolyLoad();
 mnLayersNote();
}

function mnOnMoveEnd(){
 clearTimeout(MN.moveTimer);
 MN.moveTimer=setTimeout(function(){
  mnClaimsLoad();
  mnPolyLoad();
  fsiRenderLegend();
  mnWriteHash();
 }, 300);
}

function mnLayersChanged(){ fsiRenderLegend(); mnWriteHash(); if(window.mnFiltersCount) window.mnFiltersCount(); }

function mnAfterRefresh(){
 MN.bander=fsiBander(_fsiState.raw);
 mnRenderActiveFilters();
 mnPolyPaint();
 if(MN.pendingSel&&_fsiState.raw.length){
  const id=MN.pendingSel; MN.pendingSel=null;
  if(mnFindParcel(id)) setTimeout(function(){ fsiSelect(id,{fly:false}); },0);
  else mnSearchById(id);
 }
 mnWriteHash();
}

function mnAfterPaint(){ mnPolyPaint(); }

function mnOnSelect(id){
 const dr=mnEl('fsiDrawer');
 if(dr) dr.classList.toggle('is-sheet', !!id&&mnIsSheet());
 document.documentElement.classList.toggle('fsi-sheet-open', !!id&&mnIsSheet());
 mnPolyPaint();
 mnWriteHash();
}

function mnRenderActiveFilters(){
 const box=mnEl('fsiActiveFilters'); if(!box) return;
 const bits=[];
 if(_fsiState.bg){
  const f=String(_fsiState.bg.fips);
  bits.push('<span class="af-chip" title="'+esc(MN_COMPLIANCE)+'">Block group '+esc(f.length===12?f.slice(5,11)+'·'+f.slice(11):f)+'<button type="button" class="af-x" data-mn-clear-bg aria-label="Remove block-group filter"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button></span>');
 }
 box.innerHTML=bits.join('');
 box.hidden=!bits.length;
}

/* ----------------------------------------------------------------------------------------
 * Ranked-row chips + parcel detail (drawer / bottom sheet)
 * ---------------------------------------------------------------------------------------- */
function mnRowChips(p){
 let h='';
 const line=FSI_PURE.claimsLine(p);
 const heat=Number(p.claim_heat)||0;
 if(line.level==='bg'&&line.short) h+='<span class="fsi-chip chip-claims" title="'+esc('Neighbourhood: '+line.text+'. '+MN_COMPLIANCE)+'">'+esc(line.short)+'</span>';
 else if(heat>=0.45) h+='<span class="fsi-chip" title="Neighbourhood aggregate (tract heat), not this owner">Claims hot</span>';
 if(isFinite(Number(p.cell_rain_24h))&&p.cell_rain_24h!=null) h+='<span class="fsi-chip chip-rain" title="Rain in this parcel\'s rainfall cell on the last completed day">Rain '+Math.round(Number(p.cell_rain_24h))+' mm</span>';
 const rep=mnReportFor(p.parcel_id);
 if(rep) h+='<span class="fsi-chip '+(rep.v==='water'?'chip-water':'chip-dry')+'" title="Field report saved on this device">'+(rep.v==='water'?'Water seen':'No problem seen')+'</span>';
 return h;
}

function mnRenderDrawer(p){
 // neighbourhood claims line
 const cl=mnEl('fsiDrClaims');
 if(cl){
  const line=FSI_PURE.claimsLine(p);
  if(line.level){
   cl.hidden=false;
   cl.innerHTML='<div class="nbhd-head"><b>Neighbourhood claims</b><span class="fsi-chip">'+(line.level==='bg'?'Block group':'Tract')+'</span></div><p>'+esc(line.text)+'.</p><p class="nbhd-note">'+(line.level==='bg'?'OpenFEMA block-group total':'OpenFEMA census-tract aggregate')+'. Never this owner\'s claim. Not insurance advice.</p>';
  }else{ cl.hidden=true; cl.innerHTML=''; }
 }
 mnRenderWhy(p);
 mnRenderReport(p);
 const dr=mnEl('fsiDrawer');
 if(dr) dr.classList.toggle('is-sheet', mnIsSheet());
}

const MN_TERM_CLASS={twi:'t-twi', hand:'t-hand', depr:'t-depr', soil:'t-soil', zone:'t-zone'};
function mnRenderWhy(p){
 const bd=mnEl('fsiDrBreakdown'); if(!bd) return;
 bd.style.display='';
 const b=FSI_PURE.scoreBreakdown(p);
 const pct=function(v){ return Math.max(0,Math.min(100,v*100)).toFixed(2)+'%'; };
 const fx=function(v,d){ return (v==null||!isFinite(v))?'—':Number(v).toFixed(d); };
 const flag=function(t){ return t.source==='default'?' <span class="why-flag" title="No parcel value yet: the pipeline default is used">default</span>':t.source==='missing'?' <span class="why-flag" title="Not computed for this parcel yet">not computed</span>':''; };
 const S=b.stored!=null?b.stored:b.computed;
 let h='';
 h+='<div class="why-bar" role="img" aria-label="'+esc('Terrain score '+fx(b.computed,2)+' of 1: '+b.terms.map(function(t){ return t.label+' '+fx(t.contrib,3); }).join(', '))+'">'+
  b.terms.map(function(t){ return '<span class="'+MN_TERM_CLASS[t.key]+'" style="width:'+pct(t.contrib)+'" title="'+esc(t.label+': +'+fx(t.contrib,3))+'"></span>'; }).join('')+
  '</div><div class="why-scale"><span>0</span><span>Terrain S, out of 1.0</span><span>1</span></div>';
 h+='<table class="why-rows"><tbody>'+b.terms.map(function(t){
  return '<tr><td><i class="why-sw '+MN_TERM_CLASS[t.key]+'"></i><span title="'+esc(t.hint)+'">'+esc(t.label)+'</span>'+flag(t)+'</td>'+
   '<td class="num why-mul">'+Math.round(t.weight*100)+'% × '+fx(t.value,2)+'</td><td class="num">+'+fx(t.contrib,3)+'</td></tr>';
 }).join('')+
 '<tr class="why-sum"><td>Terrain S'+(b.adjusted?' <span class="why-flag" title="Stored S differs from these five terms: later pipeline rules (closed-basin and gold-segment steps, terrain v2) adjust it">stored '+fx(b.stored,3)+'</span>':'')+'</td><td></td><td class="num">'+fx(b.computed,3)+'</td></tr>';
 if(b.rainMult!=null){
  h+='<tr class="why-rain"><td>× Rain multiplier <span class="why-hint">0.5 dry … 1.0 soaked</span></td><td class="num why-mul">wetness '+fx(b.wetness,2)+'</td><td class="num">×'+fx(b.rainMult,2)+'</td></tr>'+
   '<tr class="why-live"><td>= Live FSI</td><td class="num why-mul">100 × '+fx(S,3)+' × '+fx(b.rainMult,2)+'</td><td class="num"><b>'+fx(b.live,1)+'</b></td></tr>';
 }else{
  h+='<tr class="why-rain"><td colspan="3" class="why-hint">No live score yet: the daily rain step has not run for this parcel.</td></tr>';
 }
 h+='</tbody></table>';
 // confidence + terrain v2 + data used (rendered only when present)
 const conf=FSI_PURE.num(p.fsi_confidence);
 if(conf!=null){
  const c=Math.max(0,Math.min(1,conf));
  const lvl=c>=0.75?'high':c>=0.5?'medium':'low';
  h+='<div class="why-conf"><span class="why-conf-l">Input confidence</span><span class="fsi-meter why-conf-m" role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow="'+c.toFixed(2)+'" aria-label="Input confidence"><i class="c-'+lvl+'" style="width:'+(c*100).toFixed(0)+'%"></i></span><b>'+Math.round(c*100)+'%</b><span class="why-hint">'+lvl+' · data quality, not a flood probability</span></div>';
 }
 const v2=FSI_PURE.v2Rows(p);
 if(v2.length){
  h+='<h5>Terrain detail</h5><dl class="why-v2">'+v2.map(function(r){ return '<div title="'+esc(r.hint)+'"><dt>'+esc(r.label)+'</dt><dd>'+esc(r.value)+'</dd></div>'; }).join('')+'</dl>';
 }
 const used=FSI_PURE.inputsList(p.fsi_inputs);
 if(used.length){
  h+='<h5>Data used</h5><ul class="why-used">'+used.map(function(u){ return '<li><span>'+esc(u.key)+'</span>'+esc(u.value)+'</li>'; }).join('')+'</ul>';
 }
 h+='<p class="why-foot">Weights from scripts/lib/fsi-score.mjs: literature defaults, not yet calibrated against jobs. A ranking aid, not an inspection.</p>';
 bd.innerHTML=h;
}

/* field reports: kept on this device and sent to /crm/api/lead-outcomes as action 'field_report'
 * (R1 contract). Anything not acknowledged with {ok:true} (offline, 4xx/5xx, unknown action on an
 * older server) stays queued (synced:false) and is retried on the next map boot / when back online. */
function mnReports(){ try{ return JSON.parse(localStorage.getItem(MN_REPORT_KEY)||'{}')||{}; }catch(e){ return {}; } }
function mnReportFor(id){ if(id==null) return null; return mnReports()[String(id)]||null; }
function mnSaveReport(id, v){
 const all=mnReports();
 const k=String(id);
 if(!v) delete all[k];
 else all[k]={v:v, at:new Date().toISOString(), by:(typeof currentUserName==='function'?currentUserName():'')||''};
 try{ localStorage.setItem(MN_REPORT_KEY, JSON.stringify(all)); }catch(e){}
 if(v) mnSyncReports();
}
let _mnReportSyncing=false;
async function mnSyncReports(){
 if(_mnReportSyncing) return;
 const tok=(typeof getToken==='function')?getToken():''; if(!tok) return;
 if(typeof navigator!=='undefined'&&navigator.onLine===false) return;
 _mnReportSyncing=true;
 try{
  const all=mnReports();
  for(const k of Object.keys(all)){
   const r=all[k]; if(!r||r.synced) continue;
   const body={action:'field_report', parcel_id:k, report:r.v==='water'?'water_confirmed':'not_a_problem'};
   const lead=(typeof state!=='undefined'&&Array.isArray(state))?state.find(function(l){ return l&&String(l.parcel_id||'')===k&&(l.uuid||l.server_id!=null); }):null;
   if(lead) body.lead_id=lead.uuid||lead.server_id;
   if(r.by) body.note='Reported by '+r.by+' on '+String(r.at).slice(0,10);
   let ok=false;
   try{
    const res=await fetch('/crm/api/lead-outcomes',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify(body)});
    const j=res.ok?await res.json().catch(function(){ return null; }):null;
    ok=!!(j&&j.ok===true);
   }catch(e){ ok=false; }
   if(!ok) break; // keep the queue; try again later
   const now=mnReports(); if(now[k]&&now[k].at===r.at){ now[k].synced=true; try{ localStorage.setItem(MN_REPORT_KEY, JSON.stringify(now)); }catch(e){} }
  }
 }finally{ _mnReportSyncing=false; }
 const p=_fsiState.selectedId&&mnFindParcel(_fsiState.selectedId); if(p) mnRenderReport(p);
}
window.addEventListener('online', function(){ mnSyncReports(); });
setTimeout(function(){ mnSyncReports(); }, 4000);
function mnFieldReportNote(id){
 const r=mnReportFor(id); if(!r) return '';
 return 'Field report: '+(r.v==='water'?'water confirmed on site':'not a problem on site')+' ('+String(r.at).slice(0,10)+(r.by?', '+r.by:'')+').';
}
function mnRenderReport(p){
 const box=mnEl('fsiDrReport'); if(!box) return;
 const r=mnReportFor(p.parcel_id);
 box.querySelectorAll('[data-fsi-report]').forEach(function(b){
  const on=!!r&&r.v===b.getAttribute('data-fsi-report');
  b.classList.toggle('on', on); b.setAttribute('aria-pressed', on?'true':'false');
 });
 const msg=mnEl('fsiDrReportMsg');
 if(msg) msg.textContent=r?((r.synced?'Sent to the team ':'Saved on this device ')+String(r.at).slice(0,10)+(r.synced?'':', sends when the server accepts it')+'. It goes into the lead notes when you add this parcel.'):'';
}

/* ----------------------------------------------------------------------------------------
 * Address search
 * ---------------------------------------------------------------------------------------- */
function mnSearchOpen(open){
 const list=mnEl('fsiMapSearchResults'), inp=mnEl('fsiMapSearchInput');
 if(!list||!inp) return;
 list.hidden=!open;
 inp.setAttribute('aria-expanded', open?'true':'false');
 if(!open){ MN.search.active=-1; inp.removeAttribute('aria-activedescendant'); }
}
function mnSearchRender(state){
 const list=mnEl('fsiMapSearchResults'); if(!list) return;
 const items=MN.search.items;
 if(state==='loading'&&!items.length){ list.innerHTML='<div class="sr-empty">Searching…</div>'; mnSearchOpen(true); return; }
 if(state==='error'){ list.innerHTML='<div class="sr-empty">Search failed. Try again.</div>'; mnSearchOpen(true); return; }
 if(!items.length){ list.innerHTML='<div class="sr-empty">No parcel matches. Try the street number and name.</div>'; mnSearchOpen(true); return; }
 list.innerHTML=items.map(function(p,i){
  const inList=!!_fsiState.filtered.find(function(x){ return String(x.parcel_id)===String(p.parcel_id); });
  return '<div class="sr-item'+(i===MN.search.active?' on':'')+'" role="option" id="mnSr'+i+'" data-i="'+i+'" aria-selected="'+(i===MN.search.active?'true':'false')+'">'+
   '<div class="sr-addr">'+esc(p.address||('Parcel '+p.parcel_id))+'</div>'+
   '<div class="sr-meta">'+(p.owner_name?esc(p.owner_name)+' · ':'')+esc(String(p.parcel_id))+
   (p.fsi_live!=null?' · <span class="num">FSI '+esc(fsiNum(p.fsi_live))+'</span>':'')+(inList?' · <span class="sr-in">in list</span>':'')+'</div></div>';
 }).join('')+(state==='loading'?'<div class="sr-empty">Searching…</div>':'');
 mnSearchOpen(true);
}
function mnSearchLocal(q){
 const t=q.toLowerCase();
 return _fsiState.raw.filter(function(p){
  return String(p.parcel_id).toLowerCase()===t||String(p.address||'').toLowerCase().indexOf(t)>=0||String(p.owner_name||'').toLowerCase().indexOf(t)>=0;
 }).slice(0,5);
}
function mnSearchRun(q){
 q=String(q||'').trim();
 if(MN.search.ctl) try{ MN.search.ctl.abort(); }catch(e){}
 if(q.length<2){ MN.search.items=[]; mnSearchOpen(false); return; }
 MN.search.items=mnSearchLocal(q);
 MN.search.active=MN.search.items.length?0:-1;
 mnSearchRender('loading');
 const ctl=(typeof AbortController!=='undefined')?new AbortController():null;
 MN.search.ctl=ctl;
 const seq=++MN.search.seq;
 fsiFetch({action:'search', q:q}, ctl&&ctl.signal).then(function(data){
  if(seq!==MN.search.seq) return;
  const seen=new Set(MN.search.items.map(function(p){ return String(p.parcel_id); }));
  (data&&Array.isArray(data.parcels)?data.parcels:[]).forEach(function(p){
   if(!seen.has(String(p.parcel_id))){ seen.add(String(p.parcel_id)); MN.search.items.push(p); }
  });
  MN.search.items=MN.search.items.slice(0,10);
  if(MN.search.active<0&&MN.search.items.length) MN.search.active=0;
  mnSearchRender('done');
 }).catch(function(err){
  if(err&&err.name==='AbortError') return;
  if(seq!==MN.search.seq) return;
  mnSearchRender(MN.search.items.length?'done':'error');
 });
}
/** Put a found parcel into the working set (if needed), fly to it and open its detail. */
function mnPick(p){
 if(!p) return;
 const id=String(p.parcel_id);
 if(!_fsiState.raw.find(function(x){ return String(x.parcel_id)===id; })){
  _fsiState.raw.push(Object.assign({}, p, {_searched:true}));
  fsiRefreshView(false);
 }
 const inp=mnEl('fsiMapSearchInput');
 if(inp) inp.value=p.address||id;
 mnSearchOpen(false);
 fsiSelect(id,{fly:true, zoom:17});
}
function mnSearchById(id){
 fsiFetch({action:'search', q:String(id)}).then(function(data){
  const p=(data&&data.parcels||[]).find(function(x){ return String(x.parcel_id)===String(id); });
  if(p) mnPick(p);
 }).catch(function(){});
}

/* ----------------------------------------------------------------------------------------
 * Box select
 * ---------------------------------------------------------------------------------------- */
function mnBoxMode(on){
 const map=mnMap();
 MN.box.on=!!on;
 const btn=mnEl('fsiBoxSel'), hint=mnEl('fsiBoxHint');
 if(btn){ btn.setAttribute('aria-pressed', on?'true':'false'); btn.classList.toggle('on', !!on); }
 if(hint) hint.hidden=!on;
 if(map){
  if(on) map.dragPan.disable(); else map.dragPan.enable();
  map.getCanvas().style.cursor=on?'crosshair':'';
 }
 if(!on) mnBoxClear();
}
function mnBoxClear(){
 const r=document.querySelector('.fsi-boxsel-rect'); if(r) r.remove();
 MN.box.drag=null;
}
function mnWireBoxSelect(){
 const map=mnMap(); if(!map) return;
 const host=map.getCanvasContainer();
 host.addEventListener('pointerdown',function(e){
  if(e.button!==0) return;
  const shift=e.shiftKey&&e.pointerType==='mouse';
  if(!MN.box.on&&!shift) return;
  if(shift&&!MN.box.on){ MN.box.shift=true; map.dragPan.disable(); }
  const rect=host.getBoundingClientRect();
  MN.box.drag={x0:e.clientX-rect.left, y0:e.clientY-rect.top, x1:e.clientX-rect.left, y1:e.clientY-rect.top, id:e.pointerId};
  try{ host.setPointerCapture(e.pointerId); }catch(err){}
  let el=document.querySelector('.fsi-boxsel-rect');
  if(!el){ el=document.createElement('div'); el.className='fsi-boxsel-rect'; host.appendChild(el); }
  e.preventDefault(); e.stopPropagation();
 }, true);
 host.addEventListener('pointermove',function(e){
  const d=MN.box.drag; if(!d) return;
  const rect=host.getBoundingClientRect();
  d.x1=e.clientX-rect.left; d.y1=e.clientY-rect.top;
  const el=document.querySelector('.fsi-boxsel-rect');
  if(el){
   el.style.left=Math.min(d.x0,d.x1)+'px'; el.style.top=Math.min(d.y0,d.y1)+'px';
   el.style.width=Math.abs(d.x1-d.x0)+'px'; el.style.height=Math.abs(d.y1-d.y0)+'px';
  }
 }, true);
 const finish=function(e){
  const d=MN.box.drag; if(!d) return;
  mnBoxClear();
  if(MN.box.shift){ MN.box.shift=false; map.dragPan.enable(); }
  const small=Math.abs(d.x1-d.x0)<6||Math.abs(d.y1-d.y0)<6;
  if(!small){
   const a=map.unproject([Math.min(d.x0,d.x1), Math.max(d.y0,d.y1)]);
   const b=map.unproject([Math.max(d.x0,d.x1), Math.min(d.y0,d.y1)]);
   const ids=FSI_PURE.idsInBox(_fsiState.filtered,[a.lng,a.lat,b.lng,b.lat]);
   ids.forEach(function(id){ _fsiState.selected[id]=true; });
   fsiRenderList();
   fsiSay(ids.length?('<b>'+ids.length+'</b> parcel'+(ids.length===1?'':'s')+' from the box added to the selection · '+fsiSelectedCount()+' selected. Use the bulk bar to add them to leads or export.'):'No ranked parcels inside that box.', true);
  }
  if(MN.box.on) mnBoxMode(false);
  if(e) e.stopPropagation();
 };
 host.addEventListener('pointerup',finish,true);
 host.addEventListener('pointercancel',function(){ mnBoxClear(); if(MN.box.shift){ MN.box.shift=false; map.dragPan.enable(); } },true);
}

/* ----------------------------------------------------------------------------------------
 * URL hash (shareable view)
 * ---------------------------------------------------------------------------------------- */
function mnHashState(){
 const map=mnMap();
 const c=map?map.getCenter():null;
 const layers=[];
 if(mnEl('fsiNfhl')?.checked) layers.push('fema');
 if(mnEl('fsiClaims')?.checked) layers.push('claims');
 if(mnEl('fsiClaimHeat')?.checked) layers.push('heat');
 const min=Number(mnEl('fsiMinScore')?.value)||0;
 const lim=Number(mnEl('fsiLimit')?.value)||0;
 return {
  center:c?[c.lng,c.lat]:null, zoom:map?map.getZoom():null, layers:layers, op:MN.op,
  preset:_fsiState.preset, zone:MN.claims.zone, win:MN.claims.win,
  event:MN.claims.event?{key:MN.claims.event.key, year:MN.claims.event.year}:null,
  q:_fsiState.q||'', city:_fsiState.city||'', band:_fsiState.bandFilter, min:min||0,
  lim:lim&&lim!==200?lim:0, bg:_fsiState.bg?_fsiState.bg.fips:'', sel:_fsiState.selectedId||''
 };
}
function mnWriteHash(){
 clearTimeout(MN.hashTimer);
 MN.hashTimer=setTimeout(function(){
  if(document.documentElement.getAttribute('data-panel')!=='fsi'||!mnMap()) return;
  const h='#'+FSI_PURE.encodeHash(mnHashState());
  if(location.hash!==h){ try{ history.replaceState(history.state,'',h); }catch(e){} }
 }, 250);
}
function mnClearHash(){
 if(/^#map/.test(location.hash)){ try{ history.replaceState(history.state,'',location.pathname+location.search); }catch(e){} }
}

/** Apply a shared link to the controls before the map exists (the map reads the view itself). */
function mnApplyHash(h){
 if(!h) return;
 if(h.layers){
  const set=function(id,on){ const el=mnEl(id); if(el) el.checked=on; };
  set('fsiNfhl', h.layers.indexOf('fema')>=0);
  set('fsiClaims', h.layers.indexOf('claims')>=0);
  set('fsiClaimHeat', h.layers.indexOf('heat')>=0);
  MN.claims.on=h.layers.indexOf('claims')>=0;
 }
 if(h.op){ MN.op={fema:h.op.fema, claims:h.op.claims, parcels:h.op.parcels}; }
 if(h.zone) MN.claims.zone=h.zone;
 if(h.win) MN.claims.win=h.win;
 if(h.event) MN.claims.event={key:h.event.key, year:h.event.year};
 if(h.preset){
  _fsiState.preset=h.preset;
  document.querySelectorAll('#fsiPresets button[data-preset]').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-preset')===h.preset); });
 }
 if(h.q){ _fsiState.q=h.q; const si=mnEl('fsiSearchText'); if(si) si.value=h.q; }
 if(h.city) _fsiState.city=fsiCanonicalCityKey(h.city);
 if(h.band!=null) _fsiState.bandFilter=h.band;
 if(h.min){ const el=mnEl('fsiMinScore'); if(el) el.value=String(h.min); }
 if(h.lim){ const el=mnEl('fsiLimit'); if(el) el.value=String(h.lim); }
 if(h.bg) _fsiState.bg={fips:h.bg, geom:null, bbox:null};
 if(h.sel) MN.pendingSel=h.sel;
}

function mnSyncOpInputs(){
 [['fsiOpFema','fema'],['fsiOpClaims','claims'],['fsiOpParcels','parcels']].forEach(function(x){
  const el=mnEl(x[0]); if(!el) return;
  el.value=String(MN.op[x[1]]);
  const out=el.parentNode&&el.parentNode.querySelector('output'); if(out) out.textContent=MN.op[x[1]]+'%';
 });
}

/* ----------------------------------------------------------------------------------------
 * Wiring (runs once at load; nothing here calls into the map until it exists)
 * ---------------------------------------------------------------------------------------- */
(function mnBoot(){
 MN.hash=FSI_PURE.decodeHash(location.hash);
 MN.claims.on=!!mnEl('fsiClaims')?.checked;
 mnApplyHash(MN.hash);
 mnSyncOpInputs();
 mnClaimsSyncBar();
 mnLayersNote();

 // Shared link: open the map panel once the app is past the login gate.
 if(MN.hash){
  let tries=0;
  const t=setInterval(function(){
   tries++;
   const root=mnEl('appRoot');
   if(root&&!root.classList.contains('hidden')&&typeof goTab==='function'){ clearInterval(t); goTab('fsi'); }
   else if(tries>100) clearInterval(t);
  }, 100);
 }
 // Leaving the map clears the hash so a reload opens where the user is.
 new MutationObserver(function(){
  if(document.documentElement.getAttribute('data-panel')==='fsi') mnWriteHash(); else mnClearHash();
 }).observe(document.documentElement,{attributes:true, attributeFilter:['data-panel']});

 // Basemap follows the theme toggle and the OS setting.
 new MutationObserver(function(){ if(typeof fsiSyncBasemap==='function') fsiSyncBasemap(); })
  .observe(document.documentElement,{attributes:true, attributeFilter:['data-theme']});
 try{ window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(){ if(typeof fsiSyncBasemap==='function') fsiSyncBasemap(); }); }catch(e){}
 try{ window.matchMedia('(max-width: 820px)').addEventListener('change',function(){ mnOnSelect(_fsiState.selectedId); }); }catch(e){}

 // Claims controls
 mnEl('fsiClaims')?.addEventListener('change',function(){
  MN.claims.on=this.checked;
  if(MN.claims.on){ if(MN.claims.available===false) MN.claims.available=null; mnLoadEvents(); mnClaimsLoad(true); }
  mnClaimsVisibility(); mnClaimsSyncBar(); fsiRenderLegend(); mnWriteHash();
 });
 mnEl('fsiClaimsBar')?.addEventListener('click',function(e){
  const z=e.target.closest('[data-cz]');
  if(z&&!z.disabled){ MN.claims.zone=z.getAttribute('data-cz'); mnClaimsPaint(); mnWriteHash(); return; }
  const w=e.target.closest('[data-cw]');
  if(w&&!w.disabled){ MN.claims.win=w.getAttribute('data-cw'); mnClaimsPaint(); mnWriteHash(); return; }
  const ev=e.target.closest('[data-ev]');
  if(ev){
   const v=ev.getAttribute('data-ev');
   const pick=v==='all'?null:MN.claims.events[Number(v)];
   MN.claims.event=pick?{key:pick.key, year:pick.year, label:pick.label}:null;
   mnClaimsSyncBar();
   mnClaimsLoad(true);
   mnWriteHash();
   return;
  }
  if(e.target.closest('[data-mn-use-heat]')){
   const h=mnEl('fsiClaimHeat');
   if(h&&!h.checked){ h.checked=true; h.dispatchEvent(new Event('change',{bubbles:true})); }
  }
 });
 mnEl('fsiClaimHeat')?.addEventListener('change',function(){ mnLayersChanged(); });
 mnEl('fsiNfhl')?.addEventListener('change',function(){ mnLayersChanged(); });

 // Layer panel
 mnEl('fsiLayersBtn')?.addEventListener('click',function(e){ e.stopPropagation(); mnLayersPop(); });
 mnEl('fsiLayersPop')?.addEventListener('input',function(e){
  const t=e.target; if(!t||t.type!=='range') return;
  const kind=t.id==='fsiOpFema'?'fema':t.id==='fsiOpClaims'?'claims':'parcels';
  MN.op[kind]=Number(t.value);
  const out=t.parentNode.querySelector('output'); if(out) out.textContent=t.value+'%';
  mnApplyOpacity(kind);
  mnWriteHash();
 });
 document.addEventListener('click',function(e){
  const pop=mnEl('fsiLayersPop');
  if(pop&&!pop.hidden&&!e.target.closest('#fsiLayersPop')&&!e.target.closest('#fsiLayersBtn')) mnLayersPop(false);
  if(!e.target.closest('#fsiMapSearch')) mnSearchOpen(false);
  // popup buttons (rendered by MapLibre outside our containers)
  const show=e.target.closest('[data-mn-bg-show]');
  if(show){ mnShowBg(show.getAttribute('data-mn-bg-show')); return; }
  if(e.target.closest('[data-mn-load-view]')){ if(MN.popup) MN.popup.remove(); fsiLoad('viewport'); }
 });
 document.addEventListener('keydown',function(e){
  if(e.key!=='Escape') return;
  if(MN.box.on) mnBoxMode(false);
  const pop=mnEl('fsiLayersPop'); if(pop&&!pop.hidden){ mnLayersPop(false); mnEl('fsiLayersBtn')?.focus(); }
  if(mnIsSheet()&&_fsiState.selectedId&&document.documentElement.getAttribute('data-panel')==='fsi'&&!e.target.closest('#fsiMapSearch')) fsiSelect(null);
 });

 // Legend collapse (phones) + clear block-group filter
 mnEl('fsiLegend')?.addEventListener('click',function(e){
  if(e.target.closest('[data-mn-legend]')) this.classList.toggle('open');
 });
 mnEl('fsiActiveFilters')?.addEventListener('click',function(e){ if(e.target.closest('[data-mn-clear-bg]')) mnClearBg(); });

 // Box select
 mnEl('fsiBoxSel')?.addEventListener('click',function(){ mnBoxMode(!MN.box.on); });

 // Drawer: close (sheet) + field reports
 mnEl('fsiDrClose')?.addEventListener('click',function(){ fsiSelect(null); });
 mnEl('fsiDrReport')?.addEventListener('click',function(e){
  const b=e.target.closest('[data-fsi-report]'); if(!b) return;
  const id=_fsiState.selectedId; if(!id) return;
  const v=b.getAttribute('data-fsi-report');
  const cur=mnReportFor(id);
  mnSaveReport(id, cur&&cur.v===v?null:v);
  const p=mnFindParcel(id); if(p) mnRenderReport(p);
  fsiRenderList();
 });

 // Map search box
 const inp=mnEl('fsiMapSearchInput');
 if(inp){
  inp.addEventListener('input',function(){
   const v=this.value;
   clearTimeout(MN.search.timer);
   MN.search.timer=setTimeout(function(){ mnSearchRun(v); }, 250);
  });
  inp.addEventListener('focus',function(){ if(MN.search.items.length&&this.value.trim().length>=2) mnSearchRender('done'); });
  inp.addEventListener('keydown',function(e){
   const n=MN.search.items.length;
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    if(!n) return;
    e.preventDefault();
    MN.search.active=(MN.search.active+(e.key==='ArrowDown'?1:-1)+n)%n;
    mnSearchRender('done');
    inp.setAttribute('aria-activedescendant','mnSr'+MN.search.active);
    mnEl('mnSr'+MN.search.active)?.scrollIntoView({block:'nearest'});
   }else if(e.key==='Enter'){
    e.preventDefault();
    clearTimeout(MN.search.timer);
    if(n&&MN.search.active>=0) mnPick(MN.search.items[MN.search.active]);
    else mnSearchRun(inp.value);
   }else if(e.key==='Escape'){
    mnSearchOpen(false);
   }
  });
 }
 mnEl('fsiMapSearchResults')?.addEventListener('mousedown',function(e){
  const it=e.target.closest('.sr-item'); if(!it) return;
  e.preventDefault();
  mnPick(MN.search.items[Number(it.getAttribute('data-i'))]);
 });

 // Hash on list-side filter changes (16 handles the filtering itself)
 ['fsiMinScore','fsiLimit','fsiCityFilter'].forEach(function(id){ mnEl(id)?.addEventListener('change',function(){ mnWriteHash(); }); });
})();

/* ----------------------------------------------------------------------------------------
 * R2: Filters popover (score, size, overlays) + Esc closes the desktop side sheet.
 * ---------------------------------------------------------------------------------------- */
(function mnFiltersBoot(){
 const bar=document.getElementById('fsiToolbar'), btn=document.getElementById('fsiFiltersBtn'), pop=document.getElementById('fsiControls');
 if(!bar||!btn||!pop) return;
 function count(){
  let n=0;
  const v=function(id){ const el=document.getElementById(id); return el?el:null; };
  if(Number(v('fsiMinScore')?.value||0)>0) n++;
  if(String(v('fsiLimit')?.value||'200')!=='200') n++;
  if(v('fsiNfhl')?.checked) n++;
  if(v('fsiClaims')&&!v('fsiClaims').checked) n++;
  if(v('fsiClaimHeat')?.checked) n++;
  const c=document.getElementById('fsiFiltersCount');
  if(c){ c.hidden=!n; c.textContent=n?String(n):''; }
  btn.setAttribute('aria-label', 'Filters'+(n?' ('+n+' active)':''));
 }
 function open(on){
  bar.classList.toggle('filters-open', on);
  btn.setAttribute('aria-expanded', on?'true':'false');
  if(on){ const f=pop.querySelector('input'); if(f&&!window.matchMedia('(max-width: 820px)').matches) f.focus({preventScroll:true}); }
 }
 btn.addEventListener('click', function(){ open(!bar.classList.contains('filters-open')); });
 pop.addEventListener('input', count); pop.addEventListener('change', count);
 document.addEventListener('mousedown', function(e){
  if(!bar.classList.contains('filters-open')) return;
  if(window.matchMedia('(max-width: 820px)').matches) return; // inline panel on phones
  if(!e.target.closest('.fsi-filter-wrap')) open(false);
 });
 document.addEventListener('keydown', function(e){
  if(e.key!=='Escape') return;
  if(bar.classList.contains('filters-open')){ open(false); btn.focus(); return; }
  // desktop side sheet: Esc closes the parcel detail and returns to the list
  if(!mnIsSheet() && _fsiState.selectedId && document.documentElement.getAttribute('data-panel')==='fsi'
     && !e.target.closest('#fsiMapSearch') && !document.querySelector('.fg-modal-bg,.est-bg:not([hidden]),#profileDrawer.open')){
   const id=_fsiState.selectedId; fsiSelect(null);
   const row=document.querySelector('#fsiList .fsi-row[data-id="'+CSS.escape(String(id))+'"]'); if(row){ row.setAttribute('tabindex','-1'); row.focus({preventScroll:true}); }
  }
 });
 count();
 window.mnFiltersCount=count;
})();
