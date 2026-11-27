/**
 * Before / after images for a lead page, drawn on the lot's aerial photo and rasterised to PNG
 * (email clients do not show SVG). Labels use the bundled Inter font.
 *
 * "Before": the lot outlined, lidar low ground shaded blue, the lowest spot marked.
 * "After":  a concept layout. Collector drains feed a basin + pump at the low spot, a solid line
 *           runs to a pop-up emitter at the street side. Final routing is set on the site walk;
 *           the image says so.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMerc, fromMerc } from './geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(here, '../../assets/fonts');
const FONT_FILES = ['Inter-Regular.otf', 'Inter-Bold.otf'].map((f) => path.join(FONT_DIR, f));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function projector(aerial) {
  const { extent: e, width: W, height: H } = aerial;
  return ([lon, lat]) => {
    const [x, y] = toMerc([lon, lat]);
    return [((x - e.xmin) / (e.xmax - e.xmin)) * W, ((e.ymax - y) / (e.ymax - e.ymin)) * H];
  };
}

const pathOf = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
const metresBetween = (a, b) => {
  const [ax, ay] = toMerc(a);
  const [bx, by] = toMerc(b);
  return Math.hypot(bx - ax, by - ay) * Math.cos((a[1] * Math.PI) / 180);
};

function centroid(ring) {
  const ms = ring.slice(0, -1).map(toMerc);
  const c = ms.reduce((s, p) => [s[0] + p[0] / ms.length, s[1] + p[1] / ms.length], [0, 0]);
  return fromMerc(c);
}

/** Move point p a fraction f of the way toward q (lon/lat). */
const toward = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];

/**
 * Layout shared by both images and by the page text. Pure: (stored record) -> geometry in lon/lat.
 */
export function planLayout(rec) {
  const ring = rec.parcel.ring;
  const c = centroid(ring);
  const front = rec.front;
  const low = rec.low_ground && !rec.low_ground.flat ? rec.low_ground : null;
  let basin;
  if (low?.low) basin = [low.low.lon, low.low.lat];
  else {
    // No lidar: the corner area farthest from the street, pulled in toward the middle of the lot.
    const far = ring.reduce((a, b) => (metresBetween(b, front?.mid || c) > metresBetween(a, front?.mid || c) ? b : a));
    basin = toward(far, c, 0.35);
  }
  basin = toward(basin, c, 0.08); // keep it off the lot line
  let discharge = [];
  let emitter = null;
  if (front) {
    const corner = metresBetween(front.a, basin) < metresBetween(front.b, basin) ? front.a : front.b;
    const sideIn = toward(corner, c, 0.18);
    emitter = toward(corner, front.mid, 0.35);
    discharge = [basin, sideIn, emitter];
  }
  // Collectors: from up to three low cells spread across the low ground into the basin.
  const collectors = [];
  if (low?.cells?.length) {
    const cells = [...low.cells].sort((a, b) => metresBetween([b.lon, b.lat], basin) - metresBetween([a.lon, a.lat], basin));
    const picked = [];
    for (const cell of cells) {
      const p = [cell.lon, cell.lat];
      if (metresBetween(p, basin) < 6) continue;
      if (picked.every((q) => metresBetween(q, p) > 9)) picked.push(p);
      if (picked.length === 3) break;
    }
    for (const p of picked) collectors.push([p, basin]);
  } else {
    // No lidar: one collector across the back of the lot through the basin.
    const back = ring.slice(0, -1).sort((a, b) => metresBetween(b, front?.mid || c) - metresBetween(a, front?.mid || c));
    if (back.length >= 2) collectors.push([toward(back[0], c, 0.15), basin, toward(back[1], c, 0.15)]);
  }
  const len = (pts) => pts.slice(1).reduce((s, p, i) => s + metresBetween(pts[i], p), 0);
  return {
    basin,
    emitter,
    discharge,
    collectors,
    discharge_ft: discharge.length ? Math.round((len(discharge) * 3.28084) / 5) * 5 : null,
    collector_ft: collectors.length ? Math.round((collectors.reduce((s, c2) => s + len(c2), 0) * 3.28084) / 5) * 5 : null,
  };
}

function boxFor(x, y, text, size, anchor) {
  const w = Math.round(text.length * size * 0.56 + 22);
  const h = Math.round(size * 1.65);
  const rx = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  return { x: rx, y: y - h + 6, w, h };
}

function drawLabel(b, text, { fill = '#1C2B52', size = 22 } = {}) {
  return (
    `<g><rect x="${b.x.toFixed(0)}" y="${b.y.toFixed(0)}" width="${b.w}" height="${b.h}" rx="7" fill="${fill}"/>` +
    `<text x="${(b.x + 11).toFixed(0)}" y="${(b.y + b.h * 0.72).toFixed(0)}" font-family="Inter" font-weight="700" font-size="${size}" fill="#fff">${esc(text)}</text></g>`
  );
}

/** Places labels near an anchor point without overlapping each other or leaving the image. */
function labeller(W, H) {
  const placed = [];
  const hit = (b) => placed.some((p) => b.x < p.x + p.w + 6 && p.x < b.x + b.w + 6 && b.y < p.y + p.h + 6 && p.y < b.y + b.h + 6);
  const inside = (b) => b.x >= 10 && b.y >= 10 && b.x + b.w <= W - 10 && b.y + b.h <= H - 10;
  return {
    fixed(x, y, text, opts = {}) {
      const b = boxFor(x, y, text, opts.size || 22, opts.anchor);
      placed.push(b);
      return drawLabel(b, text, opts);
    },
    near(px, py, text, opts = {}) {
      const size = opts.size || 22;
      const probe = boxFor(0, 0, text, size, 'start');
      const cands = [
        [18, 8], [18, probe.h + 10], [-probe.w - 18, 8], [-probe.w - 18, probe.h + 10],
        [-probe.w / 2, -18], [-probe.w / 2, probe.h + 30], [18, -probe.h], [-probe.w - 18, -probe.h],
        [18, probe.h * 2 + 14], [-probe.w / 2, probe.h * 2 + 40],
      ];
      for (const [dx, dy] of cands) {
        const b = boxFor(px + dx, py + dy, text, size, 'start');
        if (inside(b) && !hit(b)) {
          placed.push(b);
          return drawLabel(b, text, opts);
        }
      }
      const b = boxFor(Math.max(10, Math.min(W - probe.w - 10, px + 18)), Math.max(probe.h + 10, Math.min(H - 10, py + 8)), text, size, 'start');
      placed.push(b);
      return drawLabel(b, text, opts);
    },
  };
}

export function buildSvg(rec, which) {
  const a = rec.aerial;
  const W = a.width;
  const H = a.height;
  const P = projector(a);
  const ring = rec.parcel.ring.map(P);
  const img = `data:image/jpeg;base64,${rec.aerial_b64}`;
  const layout = planLayout(rec);
  const low = rec.low_ground && !rec.low_ground.flat ? rec.low_ground : null;
  const parts = [];
  const L = labeller(W, H);
  parts.push(`<image href="${img}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`);
  // Dim everything outside the lot.
  parts.push(`<path d="M0,0 H${W} V${H} H0 Z ${pathOf(ring)} Z" fill="#0B1730" fill-opacity="0.42" fill-rule="evenodd"/>`);

  if (which === 'before') {
    if (low && rec.elev?.cell) {
      const [x0, y0] = P([rec.parcel.ring[0][0], rec.parcel.ring[0][1]]);
      const [x1, y1] = P([rec.parcel.ring[0][0] + rec.elev.cell.dlon, rec.parcel.ring[0][1] + rec.elev.cell.dlat]);
      const cw = Math.abs(x1 - x0) * 1.15;
      const ch = Math.abs(y1 - y0) * 1.15;
      parts.push('<g clip-path="url(#lot)"><g filter="url(#soft)">');
      for (const cell of low.cells) {
        const [cx, cy] = P([cell.lon, cell.lat]);
        const depth = Math.min(1, (low.cut - cell.z + 0.15) / Math.max(0.3, low.cut - low.min + 0.15));
        parts.push(`<rect x="${(cx - cw / 2).toFixed(1)}" y="${(cy - ch / 2).toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="${(cw / 3).toFixed(1)}" fill="#1F6FD1" fill-opacity="${(0.38 + 0.3 * depth).toFixed(2)}"/>`);
      }
      parts.push('</g></g>');
      const [lx, ly] = P([low.low.lon, low.low.lat]);
      parts.push(`<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="9" fill="#fff" stroke="#1F6FD1" stroke-width="5"/>`);
      parts.push(L.near(lx, ly, 'Lowest spot', { fill: '#1F6FD1' }));
    }
    parts.push(`<path d="${pathOf(ring)} Z" fill="none" stroke="#fff" stroke-width="3.5" stroke-dasharray="12 8"/>`);
    parts.push(L.fixed(18, 48, 'TODAY', { fill: '#1F6FD1', size: 24 }));
    const sub = low ? `Lidar low ground: ${(low.cut - low.min).toFixed(1)} ft bowl in the lot` : rec.flat_lot ? 'Lidar: the lot is nearly flat, so water has nowhere to run' : 'Your lot on the county aerial';
    parts.push(L.fixed(18, H - 18, sub, { fill: '#1C2B52', size: 19 }));
  } else {
    let emitterAt = null;
    parts.push(`<path d="${pathOf(ring)} Z" fill="none" stroke="#fff" stroke-width="3" stroke-opacity="0.8"/>`);
    for (const c of layout.collectors) {
      const d = pathOf(c.map(P));
      parts.push(`<path d="${d}" fill="none" stroke="#0B1730" stroke-opacity="0.45" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="#36C564" stroke-width="6" stroke-dasharray="4 5" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    if (layout.discharge.length) {
      const d = pathOf(layout.discharge.map(P));
      parts.push(`<path d="${d}" fill="none" stroke="#0B1730" stroke-opacity="0.45" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="#36C564" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`);
      const [ex, ey] = P(layout.emitter);
      parts.push(`<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="11" fill="#F4F4F4" stroke="#36C564" stroke-width="4"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4.5" fill="#2E7D32"/>`);
      emitterAt = [ex, ey];
    }
    parts.push(L.fixed(18, 48, 'AFTER · CONCEPT', { fill: '#2E7D32', size: 24 }));
    const ft = layout.discharge_ft ? `~${layout.discharge_ft} ft line to the street side` : 'Water piped off the lot';
    parts.push(L.fixed(18, H - 18, `${ft} · final route set on the site walk`, { fill: '#1C2B52', size: 19 }));
    const [bx, by] = P(layout.basin);
    parts.push(`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="16" fill="#1E3D2A" stroke="#36C564" stroke-width="4"/><circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="9" fill="#2A302C" stroke="#B9C4C4" stroke-width="1.5"/>`);
    parts.push(L.near(bx, by, 'Basin + pump', { fill: '#1C2B52' }));
    if (emitterAt) parts.push(L.near(emitterAt[0], emitterAt[1], 'Pop-up emitter', { fill: '#1C2B52' }));
  }
  // North arrow
  parts.push(`<g transform="translate(${W - 44},${H - 48})"><circle r="26" fill="#fff" fill-opacity="0.92"/><path d="M0,-17 L8,9 L0,4 L-8,9 Z" fill="#1C2B52"/><text y="22" text-anchor="middle" font-family="Inter" font-weight="700" font-size="11" fill="#1C2B52">N</text></g>`);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><clipPath id="lot"><path d="${pathOf(ring)} Z"/></clipPath><filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter></defs>` +
    parts.join('') +
    '</svg>'
  );
}

let ResvgCtor = null;
async function resvg() {
  if (!ResvgCtor) ({ Resvg: ResvgCtor } = await import('@resvg/resvg-js'));
  return ResvgCtor;
}

/** PNG bytes, scaled to `width` px wide (email images are sent at 960). */
export async function renderPng(rec, which, { width = 960 } = {}) {
  const Resvg = await resvg();
  const svg = buildSvg(rec, which);
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return Buffer.from(r.render().asPng());
}
