/**
 * Server-rendered lead page, styled after the FloGuard design proposal (navy band, orange-ruled
 * sections, before/after slider). Inline CSS and one small script, both nonce'd under a strict CSP.
 * Every value from the record is escaped.
 */
import { COMPANY, esc, addressLine, problemSentence, findings, whyText, NEXT_STEPS } from './copy.js';

const CSS = `
:root{--bg:#EEF1F6;--paper:#fff;--ink:#1B2540;--ink2:#59647A;--rule:#DCE2EC;--navy:#1C2B52;--orange:#EC7A1C;--blue:#1F6FD1;--bluebg:#EAF1FB;--bluebd:#BFD5F2;--green:#2E7D32;--shadow:0 1px 2px rgba(20,30,60,.06),0 6px 20px rgba(20,30,60,.06);--f:"Lexend",system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0C1324;--paper:#131C33;--ink:#E4E9F4;--ink2:#9AA6BF;--rule:#26324F;--navy:#0A1430;--orange:#F08A33;--blue:#5B9BEB;--bluebg:#15264A;--bluebd:#2A4577;--green:#5DBB63;--shadow:none;color-scheme:dark}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--f);font-size:16.5px;line-height:1.55}
.wrap{max-width:1080px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left));padding-right:max(16px,env(safe-area-inset-right))}
a{color:var(--blue)}b{font-weight:600}h1,h2,h3{margin:0;line-height:1.15;text-wrap:balance}
.band{background:var(--navy);color:#fff;border-radius:0 0 14px 14px}
.band .wrap{display:flex;align-items:center;justify-content:space-between;gap:14px 24px;padding-block:16px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:14px}.brand img{width:54px;height:54px;border-radius:10px;background:#fff}
.brand .n{font-size:22px;font-weight:700}.brand .t{font-size:12px;font-weight:600;letter-spacing:.12em;color:var(--orange);text-transform:uppercase}.brand .c{font-size:12.5px;color:#C9D3EA}
.doc{text-align:right}.doc .k{font-size:clamp(18px,3vw,26px);font-weight:700;letter-spacing:.14em}.doc .m{font-size:13px;color:#C9D3EA}
.title{padding-block:22px 4px}.title h1{font-size:clamp(26px,4.4vw,40px)}
.pill{display:inline-block;vertical-align:middle;margin-left:8px;padding:3px 12px;border:1.5px solid var(--orange);border-radius:999px;color:var(--orange);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.title p{margin:8px 0 0;color:var(--ink2)}.title p b{color:var(--ink)}
.cmpwrap{margin-top:16px;background:var(--paper);border:1px solid var(--rule);border-radius:12px;box-shadow:var(--shadow);overflow:hidden}
.cmp{position:relative;line-height:0;touch-action:pan-y}.cmp img{display:block;width:100%;height:auto}
.cmp .after{position:absolute;inset:0;clip-path:inset(0 0 0 var(--x,50%))}.cmp .after img{height:100%;object-fit:cover}
.cmp .handle{position:absolute;top:0;bottom:0;left:var(--x,50%);width:3px;margin-left:-1.5px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);pointer-events:none}
.cmp .knob{position:absolute;top:50%;left:50%;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:grid;place-items:center;color:#1C2B52;font:700 15px/1 var(--f)}
.cmp input{position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0;cursor:ew-resize}
.cmpcap{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;font-size:13px;color:var(--ink2);line-height:1.4}
.nojs .cmp .after,.nojs .cmp .handle,.nojs .cmp input{display:none}.stack{display:none}.nojs .stack{display:block}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px}
.tile{border-radius:10px;padding:14px 16px;color:#fff;background:#1C2B52}.tile:nth-child(odd){background:#EC7A1C}
.tile b{display:block;font-size:clamp(20px,2.5vw,28px);font-weight:700;line-height:1.1}.tile span{font-size:13.5px;line-height:1.35;opacity:.95}
section.sec{padding-top:32px}
.sh{font-size:clamp(18px,2.2vw,22px);font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding-bottom:8px;border-bottom:3px solid var(--orange)}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;margin-top:16px;align-items:start}
.card{background:var(--paper);border:1px solid var(--rule);border-radius:12px;padding:18px 20px;box-shadow:var(--shadow)}
.card h3{font-size:18px}.card p{margin:8px 0 0}.card ul{margin:8px 0 0;padding-left:20px}.card li{margin:3px 0}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.chip{background:var(--bluebg);border:1px solid var(--bluebd);color:var(--ink);border-radius:999px;padding:4px 12px;font-size:14px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin-top:12px;font-size:15px}.kv dt{color:var(--ink2)}.kv dd{margin:0}
.call{background:var(--bluebg);border-left:5px solid var(--blue);border-radius:10px;padding:14px 18px}
.opt{background:var(--paper);border:1.5px solid var(--bluebd);border-radius:12px;padding:16px 18px;margin-top:14px}.opt h3{font-size:18px;color:var(--blue)}.opt.alt{border-color:var(--rule)}.opt.alt h3{color:var(--ink)}
.badge{display:inline-block;margin-top:6px;background:var(--orange);color:#fff;font-size:12px;font-weight:700;letter-spacing:.08em;padding:3px 12px;border-radius:999px;text-transform:uppercase}
.steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:16px}
.step{background:var(--paper);border:1px solid var(--rule);border-radius:12px;padding:16px;box-shadow:var(--shadow)}
.step .no{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--orange);color:#fff;font-weight:700}
.step h3{font-size:17px;margin-top:10px}.step p{margin:6px 0 0;font-size:15px;color:var(--ink2)}
.cta{margin-top:26px;background:var(--navy);color:#fff;border-radius:12px;padding:22px}
.cta h2{font-size:24px}.cta p{margin:8px 0 0;color:#D7DEEE}
.btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.btn{display:inline-block;background:var(--orange);color:#fff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:8px}.btn.ghost{background:transparent;border:1.5px solid #fff}
footer{margin-top:30px;border-top:1px solid var(--rule);padding-block:18px 36px;font-size:12.5px;color:var(--ink2)}footer p{max-width:90ch;margin:6px 0}
@media (max-width:860px){.grid2{grid-template-columns:minmax(0,1fr)}.tiles,.steps{grid-template-columns:repeat(2,minmax(0,1fr))}.doc{text-align:left}}
@media (max-width:480px){.steps{grid-template-columns:minmax(0,1fr)}}
`;

const SCRIPT = `(function(){var c=document.getElementById('cmp');if(!c)return;document.documentElement.classList.remove('nojs');var r=document.getElementById('cmpR');function s(){c.style.setProperty('--x',r.value+'%')}r.addEventListener('input',s);s();})();`;

const li = (items) => items.map((i) => `<li>${esc(i)}</li>`).join('');
const chips = (items) => `<div class="chips">${items.map((i) => `<span class="chip">${esc(i)}</span>`).join('')}</div>`;

function told(rec) {
  const rows = [
    ['Property', rec.property_type],
    ['Water sits', rec.water_duration],
    ['How often', rec.frequency],
    ['Area affected', rec.affected_size],
    ['Timeline', rec.timeline],
    ['Photos', rec.photos_count ? `${rec.photos_count} sent` : ''],
  ].filter(([, v]) => v);
  return `<div class="card"><h3>What you told us</h3><p>${esc(problemSentence(rec))}</p>
    ${rec.issues?.length ? chips(rec.issues) : ''}${rec.water_location?.length ? chips(rec.water_location) : ''}
    ${rows.length ? `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    ${rec.damages?.length ? `<p><b>Damage you've seen:</b></p><ul>${li(rec.damages)}</ul>` : ''}</div>`;
}

function fixOptions(rec) {
  const pump = !!(rec.low_ground || rec.flat_lot);
  const recommended = `<div class="opt"><h3>${pump ? 'Collector drains to a basin + automatic pump' : 'French drain to a safe outlet'}</h3><span class="badge">Most likely fit</span>
    <ul>${li(
      pump
        ? ['Perforated drains in clean stone collect water where it ponds.', 'A sump basin at the low spot; an automatic float-switch pump lifts the water, so it doesn\'t matter that the yard is low.', 'A buried solid line carries it to a pop-up emitter at the street side.', 'Runs on its own every time it rains.']
        : ['A fabric-wrapped, gravel-filled trench with perforated pipe intercepts the water.', 'Sized and sloped for your lot, with a sump if gravity can\'t finish the job.', 'Lawn and beds restored when we finish.'],
    )}</ul></div>`;
  const alt = `<div class="opt alt"><h3>Other tools we may combine</h3><ul>${li([
    'Catch basins and downspout tie-ins where roof water floods a corner.',
    'Battery backup and a high-water alarm for hurricane season.',
    'Regrading low beds so water moves away from the slab.',
  ])}</ul></div>`;
  return recommended + alt;
}

export function renderLeadPage(rec, { token, nonce, logoUrl }) {
  const full = rec.version === 'full';
  const addr = addressLine(rec);
  const date = new Date(rec.created_at || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  const before = `${encodeURIComponent(token)}/before.png`;
  const after = `${encodeURIComponent(token)}/after.png`;
  const facts = full ? findings(rec) : [];
  const tiles = (facts.length ? facts : [
    { k: '24 hr', v: 'Typical response time' },
    { k: 'Free', v: 'On-site assessment' },
    { k: '1–3 days', v: 'Most residential installs' },
    { k: '5 yr', v: 'Warranty on our systems' },
  ]).map((t) => `<div class="tile"><b>${esc(t.k)}</b><span>${esc(t.v)}</span></div>`).join('');

  const compare = full
    ? `<div class="cmpwrap"><div class="cmp" id="cmp">
        <img src="${before}" alt="Aerial of your lot today${rec.low_ground ? ' with low ground shaded blue' : ''}" width="960" height="540">
        <div class="after"><img src="${after}" alt="Concept drain layout on the same aerial" width="960" height="540"></div>
        <div class="handle"><div class="knob" aria-hidden="true">⇆</div></div>
        <input type="range" min="0" max="100" value="50" id="cmpR" aria-label="Compare your lot today with the concept layout">
      </div>
      <div class="stack"><img src="${after}" alt="Concept drain layout" width="960" height="540"></div>
      <div class="cmpcap"><span>${esc(rec.aerial?.credit || 'County aerial')}.${rec.low_ground || rec.flat_lot ? ' Ground heights from USGS 3DEP lidar.' : ''} Lot line from the Volusia County parcel map.</span><span>Drag to compare. The "after" view is a concept; we set the final route on the site walk.</span></div></div>`
    : '';

  const why = `<section class="sec"><h2 class="sh">Why water sits${full ? ' on your lot' : ''}</h2><div class="grid2">
      ${told(rec)}
      <div><div class="call"><b>The short version:</b> ${esc(whyText(rec))}</div>${fixOptions(rec)}</div></div></section>`;

  const steps = `<section class="sec"><h2 class="sh">What happens next</h2><div class="steps">${NEXT_STEPS.map(([h, b], i) => `<div class="step"><span class="no">${i + 1}</span><h3>${esc(h)}</h3><p>${esc(b)}</p></div>`).join('')}</div></section>`;

  return `<!doctype html><html lang="en" class="nojs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">
<title>${esc(full ? 'Your drainage plan' : 'Your next steps')} · FloGuard</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;600;700&display=swap">
<style nonce="${nonce}">${CSS}</style></head><body>
<div class="band"><div class="wrap"><div class="brand"><img src="${esc(logoUrl)}" alt="FloGuard logo" width="54" height="54">
<div><div class="n">FloGuard LLC</div><div class="t">Flood solutions &amp; management</div><div class="c">${COMPANY.town} · ${COMPANY.phone} · ${COMPANY.site}</div></div></div>
<div class="doc"><div class="k">${full ? 'FIRST LOOK' : 'NEXT STEPS'}</div><div class="m">Prepared for ${esc(rec.first_name)} · ${esc(date)}</div></div></div></div>
<main class="wrap">
<div class="title"><h1>${full ? 'Your Drainage Plan' : 'Thanks for reaching out'} <span class="pill">${full ? 'Concept' : 'Request received'}</span></h1>
<p><b>${esc(addr)}</b>${full ? ' · Drag the slider to see your lot today and a concept of how we\'d move the water.' : ' · Here is what happens next and how to reach us.'}</p></div>
${compare}
<div class="tiles">${tiles}</div>
${why}
${steps}
<div class="cta"><h2>Book your free on-site assessment</h2><p>Call or text ${COMPANY.phone}, or reply to the email this link came in. We'll walk the yard, confirm where the water goes, and send your full design proposal.</p>
<div class="btns"><a class="btn" href="tel:${COMPANY.tel}">Call ${COMPANY.phone}</a><a class="btn ghost" href="sms:${COMPANY.tel}">Text us</a></div></div>
<footer><p>${full ? 'This first look was made automatically from your form answers and public data: the county aerial and parcel map, and USGS 3DEP lidar. The shaded low ground, the drain layout and the lengths are estimates; your design proposal comes after the site walk.' : 'This page was made from your form answers. Your full design proposal, with your lot\'s aerial, lidar flood map and drain routing, comes after the free site walk.'}</p>
<p>This page is private to its link and isn't listed in search engines. ${COMPANY.name} · ${COMPANY.town}</p></footer>
</main>
<script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}

export function renderNotFound() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found · FloGuard</title></head>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;color:#1B2540"><h1 style="font-size:24px">This page isn't available</h1>
<p>The link may be mistyped or expired. Call or text FloGuard at <a href="tel:${COMPANY.tel}">${COMPANY.phone}</a> and we'll get you sorted.</p></body></html>`;
}
