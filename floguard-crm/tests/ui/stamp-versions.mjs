/**
 * Cache-busting stamps for the CRM pages (R2).
 *
 * Every local .css/.js referenced by public/crm/index.html and public/crm/proposal.html gets
 * `?v=<first 10 hex of sha256(file)>`, so a deploy can never serve a new page with an old script.
 * MapLibre is loaded lazily by js/16-fsi-map.js; its stamp lives in <meta name="fg-maplibre">.
 *
 *   node tests/ui/stamp-versions.mjs          rewrite the stamps in place
 *   node tests/ui/stamp-versions.mjs --check  exit 1 and list stale stamps (tests/ui/versions.test.mjs)
 *
 * Lives under tests/ui because scripts/ is owned elsewhere; it has no dependencies.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const crmDir = path.resolve(here, '../../public/crm');
export const PAGES = ['index.html', 'proposal.html'];
const REF = /(<(?:script|link)\b[^>]*?\b(?:src|href)=")((?:css|js|vendor)\/[^"?#]+\.(?:css|js))(?:\?v=[^"]*)?(")/g;

export function hashOf(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(crmDir, rel))).digest('hex').slice(0, 10);
}

/** Returns { html, stale: [{page, file, had, want}] } for one page. */
export function stampPage(page) {
  const file = path.join(crmDir, page);
  const src = fs.readFileSync(file, 'utf8');
  const stale = [];
  let html = src.replace(REF, (m, pre, rel, post) => {
    const want = hashOf(rel);
    const had = (m.match(/\?v=([^"]*)/) || [])[1] || '';
    if (had !== want) stale.push({ page, file: rel, had, want });
    return `${pre}${rel}?v=${want}${post}`;
  });
  html = html.replace(/(<meta name="fg-maplibre" content=")([^"]*)(")/, (m, a, had, c) => {
    const want = hashOf('vendor/maplibre-gl.js');
    if (had !== want) stale.push({ page, file: 'vendor/maplibre-gl.js (meta fg-maplibre)', had, want });
    return a + want + c;
  });
  return { html, changed: html !== src, stale };
}

/** Local css/js referenced without going through the stamp pattern (e.g. a bare relative src). */
export function unstampable(page) {
  const src = fs.readFileSync(path.join(crmDir, page), 'utf8');
  const out = [];
  for (const m of src.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+\.(?:css|js)(?:\?[^"]*)?)"/g)) {
    const u = m[1];
    if (/^(https?:)?\/\//.test(u)) continue;
    if (!/^(css|js|vendor)\/[^?]+\.(css|js)\?v=[0-9a-f]{10}$/.test(u)) out.push(u);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let bad = 0;
  for (const page of PAGES) {
    const r = stampPage(page);
    if (check) {
      for (const s of r.stale) { bad++; console.error(`${page}: ${s.file} has v=${s.had || '(none)'}, content hash is ${s.want}`); }
    } else if (r.changed) {
      fs.writeFileSync(path.join(crmDir, page), r.html);
      console.log(`${page}: ${r.stale.length} stamp(s) updated`);
    } else console.log(`${page}: up to date`);
  }
  if (check && bad) { console.error('Run: node tests/ui/stamp-versions.mjs'); process.exit(1); }
}
