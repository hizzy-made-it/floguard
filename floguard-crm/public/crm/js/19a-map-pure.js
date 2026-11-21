/* ================= FLOOD MAP NEXT — pure helpers (no DOM, no map) =================
 * Classic script, loaded before js/19-map-next.js. Also loaded by tests/map/*.test.mjs inside a
 * node:vm context, so nothing here may touch window/document at load time.
 * Exposes two globals: FSI_SCORE (weights mirror) and FSI_PURE (functions).
 */

/* ---------------------------------------------------------------------------------------
 * MIRROR of scripts/lib/fsi-score.mjs (the source of truth for FSI weights).
 * The browser cannot import that ES module (classic scripts, no build step), so the values are
 * copied here. tests/map/weights-mirror.test.mjs fails if any value drifts: change
 * fsi-score.mjs first, then this block, in the same commit.
 * --------------------------------------------------------------------------------------- */
var FSI_SCORE = {
 W_TWI: 0.3,
 W_HAND: 0.2,
 W_DEPR: 0.2,
 W_SOIL: 0.15,
 W_ZONE: 0.15,
 ALPHA: 1.0,
 HSG_SCORE: { A: 0.2, B: 0.4, C: 0.7, D: 1.0 },
 HSG_DEFAULT: 0.55,
 FEMA_ZONE_SCORE: { AE: 1.0, VE: 1.0, AO: 0.8, AH: 0.8, 'X-SHADED': 0.6, X: 0.45 },
 FEMA_ZONE_DEFAULT: 0.6,
 LITE_TWI_N: 0.55,
 LITE_HAND_N: 0.45,
 W_API: 0.6,
 W_RAIN24: 0.4
};
/* ------------------------------- end of mirror ------------------------------- */

var FSI_PURE = (function(){
 'use strict';
 var S = FSI_SCORE;

 function num(v){ if(v==null||v==='') return null; var n=Number(v); return isFinite(n)?n:null; }
 function clamp01(v){ return Math.max(0, Math.min(1, Number(v)||0)); }

 /** Same rules as fsi-score.mjs hsgScore: dual groups (A/D) take the wetter half. */
 function hsgScore(hsg){
  if(!hsg) return S.HSG_DEFAULT;
  var key=String(hsg).trim().toUpperCase();
  if(key.indexOf('/')>=0){
   return Math.max.apply(null, key.split('/').map(function(p){ return S.HSG_SCORE[p]!=null?S.HSG_SCORE[p]:S.HSG_DEFAULT; }));
  }
  return S.HSG_SCORE[key]!=null?S.HSG_SCORE[key]:S.HSG_DEFAULT;
 }
 /** Same rules as fsi-score.mjs zoneScore. */
 function zoneScore(zone){
  if(!zone) return S.FEMA_ZONE_DEFAULT;
  var z=String(zone).trim().toUpperCase();
  if(z==='AREA OF MINIMAL FLOOD HAZARD') return S.FEMA_ZONE_SCORE.X;
  if(z.indexOf('0.2')>=0||z.indexOf('SHADED')>=0||z==='X500') return S.FEMA_ZONE_SCORE['X-SHADED'];
  return S.FEMA_ZONE_SCORE[z]!=null?S.FEMA_ZONE_SCORE[z]:S.FEMA_ZONE_DEFAULT;
 }

 /**
  * "Why this score": the static terms of S = w1*TWI + w2*(1-HAND) + w3*DEPR + w4*SOIL + w5*ZONE,
  * then the rain multiplier (0.5 + 0.5*D) implied by the stored live and static scores.
  * Missing terrain inputs use the same defaults the pipeline uses (LITE_*), flagged source:'default'.
  */
 function scoreBreakdown(p){
  p=p||{};
  var twi=num(p.twi_n), hand=num(p.hand_n), depr=num(p.depr_n);
  var terms=[
   {key:'twi',  label:'Wetness (TWI)',       weight:S.W_TWI,  value:twi!=null?clamp01(twi):S.LITE_TWI_N,         source:twi!=null?'parcel':'default', hint:'Water flowing in from the ground around it'},
   {key:'hand', label:'Low freeboard (HAND)', weight:S.W_HAND, value:hand!=null?clamp01(1-hand):1-S.LITE_HAND_N, source:hand!=null?'parcel':'default', hint:'Little height above the nearest drainage'},
   {key:'depr', label:'Closed basin',         weight:S.W_DEPR, value:depr!=null?clamp01(depr):0,                 source:depr!=null?'parcel':'missing', hint:'Lot sits below its spill point'},
   {key:'soil', label:'Soil (HSG '+(p.hsg?String(p.hsg).toUpperCase():'?')+')', weight:S.W_SOIL, value:hsgScore(p.hsg), source:p.hsg?'parcel':'default', hint:'Clay (D) holds water; sand (A) drains'},
   {key:'zone', label:'FEMA zone '+(p.fema_zone?String(p.fema_zone).toUpperCase():'?'), weight:S.W_ZONE, value:zoneScore(p.fema_zone), source:p.fema_zone?'parcel':'default', hint:'A modifier, never the main term'}
  ];
  var total=0;
  terms.forEach(function(t){ t.contrib=t.weight*t.value; total+=t.contrib; });
  var stored=num(p.fsi_static), live=num(p.fsi_live);
  var base=stored!=null?stored:total;
  var mult=null, d=null;
  if(live!=null&&base>0){
   mult=live/(100*Math.pow(base,S.ALPHA));
   d=Math.max(0,Math.min(1,2*mult-1));
  }
  return {
   terms:terms,
   computed:total,
   stored:stored,
   adjusted:stored!=null&&Math.abs(stored-total)>0.02,
   rainMult:mult,
   wetness:d,
   live:live,
   alpha:S.ALPHA
  };
 }

 /* ------------------------------- claims layer ------------------------------- */

 var CLAIMS_RAMPS={
  all: ['#E9E3F5','#C7B6E6','#9F84D2','#7653B8','#4C2593'],
  x:   ['#FBEFC6','#F4D57A','#E6AE3A','#C68512','#8F5B08'],
  sfha:['#DDEAF6','#A9CBE8','#6CA4D6','#3576B9','#174B8B']
 };
 /* Dark basemap (R2): the light ramps start near-white and glare on near-black, while the low
  * classes wash out. These run dark -> bright so "more claims" still reads as "more ink". */
 var CLAIMS_RAMPS_DARK={
  all: ['#2B2347','#47377F','#6A51B6','#9479DC','#C7B3FF'],
  x:   ['#3A2E12','#6A4F15','#A6781B','#DDA63A','#FFD66B'],
  sfha:['#13263C','#1C426C','#2C69A4','#4C93D6','#8CC4F5']
 };
 var CLAIMS_NODATA='#9AA3AD';

 /**
  * Count (and rate per 100 housing units) for one block-group row under the current toggles.
  * zone: 'all'|'x'|'sfha'; win: '5y'|'10y'|'all'; event rows carry row.event (window ignored).
  * There is no zone split for 5y in the API, so 5y + a zone uses the 10y split (fallback:'10y').
  */
 function claimsMetric(row, opts){
  opts=opts||{};
  var zone=opts.zone||'all', win=opts.win||'10y';
  var hu=num(row&&row.housing_units);
  var count=0, weighted=0, fallback=null;
  if(!row) return {count:0,weighted:0,rate:null,hu:null,fallback:null};
  if(opts.event&&row.event){
   var e=row.event;
   count=zone==='x'?(e.zone_x||0):zone==='sfha'?(e.sfha||0):(e.count||0);
   weighted=zone==='all'?((e.sfha||0)+2*(e.zone_x||0)+(e.other||0)):count;
  }else{
   var w=win;
   if(win==='5y'&&zone!=='all'){ w='10y'; fallback='10y'; }
   var suf=w==='all'?'_all':'_10y';
   if(zone==='x') count=row['zone_x'+suf]||0;
   else if(zone==='sfha') count=row['sfha'+suf]||0;
   else count=w==='5y'?(row.count_5y||0):(w==='all'?(row.count_all||0):(row.count_10y||0));
   if(zone==='all'&&w!=='5y') weighted=(row['sfha'+suf]||0)+2*(row['zone_x'+suf]||0)+(row['other'+suf]||0);
   else weighted=count;
  }
  var rate=hu&&hu>0?count/hu*100:null;
  return {count:count, weighted:weighted, rate:rate, hu:hu, fallback:fallback};
 }

 /** 'rate' (per 100 homes) when most rows know their housing units, else 'count' (weighted). */
 function claimsColorMode(rows){
  if(!rows||!rows.length) return 'count';
  var withHu=rows.filter(function(r){ return num(r.housing_units)>0; }).length;
  return withHu>=rows.length/2?'rate':'count';
 }

 function niceRound(v, span){
  if(span<=2) return Math.round(v*100)/100;
  if(span<=20) return Math.round(v*10)/10;
  return Math.round(v);
 }

 /**
  * Quantile class breaks over the positive values: returns up to n-1 ascending, strictly increasing
  * thresholds. A value v is in class k when breaks[k-1] <= v < breaks[k] (class 0 below breaks[0]).
  * Zeros are left out of the quantiles so a sparse layer still spreads its colours.
  */
 function classBreaks(values, n){
  n=n||5;
  var vals=(values||[]).map(Number).filter(function(v){ return isFinite(v)&&v>0; }).sort(function(a,b){ return a-b; });
  if(!vals.length) return [];
  var span=vals[vals.length-1]-vals[0];
  var out=[];
  for(var i=1;i<n;i++){
   var q=vals[Math.min(vals.length-1, Math.floor(vals.length*i/n))];
   var r=niceRound(q, vals[vals.length-1]);
   if(r<=0) continue;
   if(!out.length||r>out[out.length-1]) out.push(r);
  }
  if(span===0) return out.slice(0,1);
  return out;
 }
 function classOf(v, breaks){
  var k=0;
  for(var i=0;i<breaks.length;i++) if(v>=breaks[i]) k=i+1;
  return k;
 }

 /**
  * Everything the map needs to paint the claims layer for the current toggles:
  * per-row value/class/colour, the mode, the breaks and the legend entries.
  */
 function claimsModel(rows, opts){
  opts=opts||{};
  var ramps=opts.dark?CLAIMS_RAMPS_DARK:CLAIMS_RAMPS;
  var ramp=ramps[opts.zone]||ramps.all;
  var mode=claimsColorMode(rows);
  var metrics=(rows||[]).map(function(r){
   var m=claimsMetric(r, opts);
   var v=mode==='rate'?m.rate:m.weighted;
   return {row:r, m:m, value:v};
  });
  var breaks=classBreaks(metrics.map(function(x){ return x.value; }), ramp.length);
  var scale=ramp.slice(ramp.length-(breaks.length+1));
  metrics.forEach(function(x){
   if(x.value==null){ x.cls=-1; x.color=CLAIMS_NODATA; }
   else if(x.value<=0){ x.cls=0; x.color=scale[0]; x.zero=true; }
   else { x.cls=classOf(x.value, breaks); x.color=scale[Math.min(x.cls, scale.length-1)]; }
  });
  var legend=[];
  for(var i=0;i<scale.length;i++){
   var from=i===0?0:breaks[i-1], to=i<breaks.length?breaks[i]:null;
   legend.push({color:scale[i], from:from, to:to});
  }
  var fallback=metrics.some(function(x){ return x.m.fallback; })?'10y':null;
  return {mode:mode, breaks:breaks, legend:legend, items:metrics, ramp:ramp, nodata:CLAIMS_NODATA, fallback:fallback};
 }

 function fmtBreak(v, mode){
  if(v==null) return '';
  if(mode==='rate') return (v<1?v.toFixed(2):v<10?v.toFixed(1):String(Math.round(v)));
  return String(Math.round(v));
 }
 /** Legend label for entry i: "0 – 0.4", "0.4 – 1.2", "3.5+" */
 function legendLabel(entry, mode){
  if(entry.to==null) return fmtBreak(entry.from, mode)+'+';
  return fmtBreak(entry.from, mode)+'–'+fmtBreak(entry.to, mode);
 }

 function fmtInt(v){ var n=num(v); return n==null?'—':Math.round(n).toLocaleString('en-US'); }
 function fmtMoney(v){
  var n=num(v); if(n==null) return '—';
  if(n>=1e6) return '$'+(n/1e6).toFixed(n>=1e7?0:1)+'M';
  if(n>=1e3) return '$'+Math.round(n/1e3)+'k';
  return '$'+Math.round(n);
 }
 function shortEvent(label){ return String(label||'').replace(/^(Hurricane|Tropical Storm|TS)\s+/i,'').replace(/\s*\((\d{4})\)\s*$/,' $1'); }

 /**
  * One-line neighbourhood claims text for a parcel, from the block-group columns (fsi/sql/016)
  * with a tract fallback. Never phrased as this owner's claim.
  */
 function claimsLine(p){
  p=p||{};
  var c=num(p.claim_bg_count_10y);
  if(c!=null){
   var parts=[fmtInt(c)+' NFIP claim'+(c===1?'':'s')+' in this block group in 10 years'];
   var x=num(p.claim_bg_zone_x_10y);
   if(x!=null&&c>0) parts.push(fmtInt(x)+' outside mapped flood zones');
   var rate=num(p.claim_bg_rate);
   if(rate!=null) parts.push((rate*100).toFixed(rate*100<1?2:1)+' per 100 homes');
   if(num(p.claim_bg_last_year)) parts.push('last '+p.claim_bg_last_year);
   if(p.claim_bg_top_event) parts.push('most in '+p.claim_bg_top_event);
   return {level:'bg', text:parts.join(' · '), short:fmtInt(c)+' nbhd claims'+(x!=null&&x>0?' · '+fmtInt(x)+' Zone X':'')};
  }
  var t=num(p.claim_count_10y), heat=num(p.claim_heat);
  if(t!=null||heat!=null){
   var txt='Block-group claims not loaded; census tract: about '+fmtInt(t||0)+' claims in recent years';
   if(heat!=null) txt+=' (heat '+heat.toFixed(2)+')';
   return {level:'tract', text:txt, short:t?('Tract ~'+fmtInt(t)+' claims'):''};
  }
  return {level:null, text:'', short:''};
 }

 /* ------------------------------- terrain v2 (agent D, fsi/sql/018) ------------------------------- */

 /** Optional fields rendered in "Why this score" when present; silently skipped when absent. */
 var V2_FIELDS=[
  {k:'fsi_static_v2', l:'Terrain S (v2)', fmt:'fixed3'},
  {k:'twi_v2_n',      l:'Wetness v2 (0–1)', fmt:'fixed2'},
  {k:'hand_v2_n',     l:'HAND v2 (0–1)', fmt:'fixed2'},
  {k:'depr_v2_n',     l:'Closed basin v2 (0–1)', fmt:'fixed2'},
  {k:'nbr_rel_m',     l:'Lot vs neighbours', fmt:'signed_m', hint:'below 0 = lower than the lots around it'},
  {k:'street_rel_m',  l:'Lot vs street', fmt:'signed_m', hint:'below 0 = lower than the road'},
  {k:'wt_depth_m',    l:'Water table depth', fmt:'m', hint:'SSURGO annual minimum; 2.0 m = none within 2 m'},
  {k:'drain_class',   l:'Soil drainage class', fmt:'text'},
  {k:'dem_res_m',     l:'Elevation data source', fmt:'dem'},
  {k:'grid_cell_m',   l:'Terrain processing grid', fmt:'grid', hint:'Cell size used for the terrain calculation; distinct from the source data'},
  {k:'rain_72h',      l:'Rain, last 72 h', fmt:'mm'},
  {k:'model_version', l:'Model', fmt:'text'}
 ];
 function fmtV2(f, v){
  if(f.fmt==='text') return String(v);
  var n=num(v); if(n==null) return null;
  if(f.fmt==='fixed3') return n.toFixed(3);
  if(f.fmt==='fixed2') return n.toFixed(2);
  if(f.fmt==='signed_m') return (n>0?'+':n<0?'−':'')+Math.abs(n).toFixed(2)+' m';
  if(f.fmt==='m') return n.toFixed(2)+' m';
  if(f.fmt==='mm') return Math.round(n)+' mm';
  if(f.fmt==='grid') return n>0?n+' m':null;
  if(f.fmt==='dem') return n<=1.5?'1 m LiDAR':Math.round(n)+' m (3DEP)';
  return String(n);
 }
 function terrainGrid(p){
  var inputs=p&&p.fsi_inputs;
  if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)) return null;
  if(Object.prototype.hasOwnProperty.call(inputs,'grid_cell_m')) return inputs.grid_cell_m;
  // Pinned historical artifact; new releases must supply the cell from zonal provenance.
  var huc=String(inputs.huc12||'');
  if(inputs.release==='terrain-v2-corridor-2026-11-20'&&/^\d{11,12}$/.test(huc)){
   return huc.padStart(12,'0')==='030802010700'?2:1;
  }
  return null;
 }
 function v2Rows(p, fields){
  var out=[];
  (fields||V2_FIELDS).forEach(function(f){
   var v=f.k==='grid_cell_m'?terrainGrid(p):(p?p[f.k]:null);
   if(v==null||v==='') return;
   var t=fmtV2(f, v);
   if(t==null) return;
   out.push({key:f.k, label:f.l, value:t, hint:f.hint||''});
  });
  return out;
 }
 /** fsi_inputs jsonb -> [{key, value}] one level deep, values shortened. */
 function inputsList(inputs){
  var o=inputs;
  if(typeof o==='string'){ try{ o=JSON.parse(o); }catch(e){ return []; } }
  if(!o||typeof o!=='object'||Array.isArray(o)) return [];
  return Object.keys(o).slice(0,16).map(function(k){
   var v=o[k];
   if(v&&typeof v==='object') v=Array.isArray(v)?v.join(', '):Object.keys(v).map(function(kk){ return kk+': '+v[kk]; }).join(', ');
   return {key:String(k).replace(/_/g,' '), value:String(v).slice(0,80)};
  });
 }

 /* ------------------------------- geometry ------------------------------- */

 function ringContains(ring, x, y){
  var inside=false;
  for(var i=0,j=ring.length-1;i<ring.length;j=i++){
   var xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
   if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi)) inside=!inside;
  }
  return inside;
 }
 function polyContains(rings, x, y){
  if(!rings||!rings.length||!ringContains(rings[0],x,y)) return false;
  for(var h=1;h<rings.length;h++) if(ringContains(rings[h],x,y)) return false;
  return true;
 }
 /** Point in GeoJSON Polygon / MultiPolygon (holes respected). */
 function pointInGeom(lon, lat, geom){
  if(!geom||!geom.coordinates) return false;
  if(geom.type==='Polygon') return polyContains(geom.coordinates, lon, lat);
  if(geom.type==='MultiPolygon') return geom.coordinates.some(function(p){ return polyContains(p, lon, lat); });
  return false;
 }
 function inBbox(lon, lat, b){ return !!b&&lon>=b[0]&&lon<=b[2]&&lat>=b[1]&&lat<=b[3]; }
 function bboxContains(outer, inner){ return !!outer&&!!inner&&inner[0]>=outer[0]&&inner[1]>=outer[1]&&inner[2]<=outer[2]&&inner[3]<=outer[3]; }
 /** Grow a bbox by frac on each side, then cap its span around the centre. */
 function padBbox(b, frac, maxSpan){
  var w=b[2]-b[0], h=b[3]-b[1];
  var cx=(b[0]+b[2])/2, cy=(b[1]+b[3])/2;
  var hw=Math.min(w*(1+2*frac), maxSpan||Infinity)/2, hh=Math.min(h*(1+2*frac), maxSpan||Infinity)/2;
  return [cx-hw, cy-hh, cx+hw, cy+hh];
 }
 /** Block-group membership: block_group column first, else polygon, else stored bbox. */
 function inBlockGroup(p, bg){
  if(!p||!bg) return false;
  if(p.block_group) return String(p.block_group)===String(bg.fips);
  var lon=Number(p.lon), lat=Number(p.lat);
  if(!isFinite(lon)||!isFinite(lat)) return false;
  if(bg.geom) return pointInGeom(lon, lat, bg.geom);
  return inBbox(lon, lat, bg.bbox);
 }
 /** Parcel ids whose point falls inside [w,s,e,n]. */
 function idsInBox(list, b){
  return (list||[]).filter(function(p){ return inBbox(Number(p.lon), Number(p.lat), b); }).map(function(p){ return String(p.parcel_id); });
 }

 /* ------------------------------- URL hash state ------------------------------- */

 var HASH_PREFIX='map';
 var PRESETS=['must','storm','top','claim_hot','zone_x','clay','fema'];
 var DEFAULTS={zone:'all', win:'10y', op:{fema:45, claims:45, parcels:90}};

 function r(v, d){ var m=Math.pow(10,d); return Math.round(v*m)/m; }

 /**
  * State -> "map?c=29.05,-81.1&z=10.9&lyr=fema,claims&..." (no leading '#').
  * Only non-default values are written, so a shared link stays short.
  */
 function encodeHash(st){
  st=st||{};
  var q=[];
  function put(k, v){ q.push(k+'='+encodeURIComponent(v)); }
  if(st.center&&isFinite(st.center[0])&&isFinite(st.center[1])) put('c', r(st.center[1],5)+','+r(st.center[0],5));
  if(isFinite(st.zoom)) put('z', r(st.zoom,2));
  if(st.layers&&st.layers.length) put('lyr', st.layers.join(','));
  else put('lyr', '-');
  var op=st.op||{};
  if(op.fema!=null&&(op.fema!==DEFAULTS.op.fema||op.claims!==DEFAULTS.op.claims||op.parcels!==DEFAULTS.op.parcels)) put('op', [op.fema,op.claims,op.parcels].map(function(x){ return Math.round(x); }).join(','));
  if(st.preset&&st.preset!=='must') put('pre', st.preset);
  if(st.zone&&st.zone!==DEFAULTS.zone) put('cz', st.zone);
  if(st.win&&st.win!==DEFAULTS.win) put('cw', st.win);
  if(st.event&&st.event.key) put('ev', st.event.key+(st.event.year?'@'+st.event.year:''));
  if(st.q) put('q', st.q);
  if(st.city) put('city', st.city);
  if(st.band!=null&&st.band!=='') put('band', st.band);
  if(st.min) put('min', st.min);
  if(st.lim) put('lim', st.lim);
  if(st.bg) put('bg', st.bg);
  if(st.sel) put('sel', st.sel);
  return HASH_PREFIX+'?'+q.join('&');
 }

 /** "#map?..." -> validated state, or null when the hash is not a map link. Unknown keys ignored. */
 function decodeHash(hash){
  var h=String(hash||'').replace(/^#/,'');
  if(h!==HASH_PREFIX&&h.indexOf(HASH_PREFIX+'?')!==0) return null;
  var qs=h.slice(HASH_PREFIX.length+1);
  var out={};
  qs.split('&').forEach(function(pair){
   if(!pair) return;
   var i=pair.indexOf('=');
   var k=i<0?pair:pair.slice(0,i);
   var v;
   try{ v=decodeURIComponent(i<0?'':pair.slice(i+1)); }catch(e){ return; }
   if(k==='c'){
    var ll=v.split(',').map(Number);
    if(ll.length===2&&isFinite(ll[0])&&isFinite(ll[1])&&Math.abs(ll[0])<=85&&Math.abs(ll[1])<=180) out.center=[ll[1], ll[0]];
   }else if(k==='z'){
    var z=Number(v); if(isFinite(z)&&z>=0&&z<=22) out.zoom=z;
   }else if(k==='lyr'){
    out.layers=v==='-'?[]:v.split(',').filter(function(x){ return ['fema','claims','heat'].indexOf(x)>=0; });
   }else if(k==='op'){
    var o=v.split(',').map(Number);
    if(o.length===3&&o.every(function(x){ return isFinite(x)&&x>=0&&x<=100; })) out.op={fema:o[0], claims:o[1], parcels:o[2]};
   }else if(k==='pre'){
    if(PRESETS.indexOf(v)>=0) out.preset=v;
   }else if(k==='cz'){
    if(['all','x','sfha'].indexOf(v)>=0) out.zone=v;
   }else if(k==='cw'){
    if(['5y','10y','all'].indexOf(v)>=0) out.win=v;
   }else if(k==='ev'){
    var at=v.lastIndexOf('@');
    var key=at>0?v.slice(0,at):v, yr=at>0?Number(v.slice(at+1)):null;
    if(key) out.event={key:key.slice(0,120), year:isFinite(yr)&&yr>1900?yr:null};
   }else if(k==='q'||k==='city'||k==='bg'||k==='sel'){
    out[k]=v.slice(0,120);
   }else if(k==='band'){
    var b=Number(v); if(isFinite(b)&&b>=0&&b<=4) out.band=b;
   }else if(k==='min'||k==='lim'){
    var n=Number(v); if(isFinite(n)&&n>=0) out[k]=n;
   }
  });
  return out;
 }

 return {
  num:num, clamp01:clamp01, hsgScore:hsgScore, zoneScore:zoneScore, scoreBreakdown:scoreBreakdown,
  CLAIMS_RAMPS:CLAIMS_RAMPS, CLAIMS_RAMPS_DARK:CLAIMS_RAMPS_DARK, CLAIMS_NODATA:CLAIMS_NODATA,
  claimsMetric:claimsMetric, claimsColorMode:claimsColorMode, classBreaks:classBreaks, classOf:classOf,
  claimsModel:claimsModel, legendLabel:legendLabel, fmtInt:fmtInt, fmtMoney:fmtMoney, shortEvent:shortEvent,
  claimsLine:claimsLine, V2_FIELDS:V2_FIELDS, v2Rows:v2Rows, inputsList:inputsList,
  pointInGeom:pointInGeom, inBbox:inBbox, bboxContains:bboxContains, padBbox:padBbox, inBlockGroup:inBlockGroup, idsInBox:idsInBox,
  encodeHash:encodeHash, decodeHash:decodeHash, HASH_DEFAULTS:DEFAULTS
 };
})();
