/**
 * Build-time prerender — the P0 SEO/AEO fix.
 *
 * Why: this is a client-rendered SPA. GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot,
 * PerplexityBot, Amazonbot, meta-externalagent and CCBot do not execute JavaScript,
 * and Bingbot effectively doesn't. Pre-fix, every route shipped an identical ~90-word
 * shell with the homepage <title> and a canonical pointing at "/". This script renders
 * every route in headless Chromium after `craco build` and writes real HTML per route,
 * so the delivered document carries each page's own title, meta description, canonical,
 * JSON-LD and full body copy.
 *
 * Wiring: package.json "postbuild": "node scripts/prerender.mjs"
 * Local/CI override: PUPPETEER_EXECUTABLE_PATH=<chrome binary>
 * Escape hatch: SKIP_PRERENDER=1 yarn build
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const PORT = 4173;
const CONCURRENCY = 2;

if (process.env.SKIP_PRERENDER === "1") {
  console.log("[prerender] SKIP_PRERENDER=1 — skipping");
  process.exit(0);
}
if (!fs.existsSync(path.join(BUILD, "index.html"))) {
  console.error("[prerender] build/index.html not found — run craco build first");
  process.exit(1);
}

/* ---------- routes from the same data files the app uses ---------- */
function extractSlugs(file, key) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const re = new RegExp(`${key}:\\s*["']([^"']+)["']`, "g");
  const out = new Set();
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}
const citySlugs = extractSlugs("src/data/cities.js", "slug");
const blogSlugs = extractSlugs("src/data/blog.js", "slug");
const serviceSlugs = extractSlugs("src/data/site.js", "slug").filter((s) =>
  ["french-drains", "sump-pumps", "yard-drainage", "pump-maintenance"].includes(s)
);

const ROUTES = [
  "/",
  "/services",
  "/process",
  "/areas",
  "/case-studies",
  "/about",
  "/blog",
  "/contact",
  ...serviceSlugs.map((s) => `/services/${s}`),
  ...citySlugs.map((s) => `/areas/${s}`),
  ...blogSlugs.map((s) => `/blog/${s}`),
];
// Never prerender: /admin* (auth), /studio (noindex), /crm (external redirect)

/* ---------- tiny static server with SPA fallback ---------- */
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".txt": "text/plain", ".xml": "application/xml", ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4", ".woff2": "font/woff2",
};
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let fp = path.join(BUILD, urlPath);
  if (fp.endsWith("/")) fp = path.join(fp, "index.html");
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    const idx = path.join(fp, "index.html");
    fp = fs.existsSync(idx) ? idx : path.join(BUILD, "index.html");
  }
  res.setHeader("Content-Type", MIME[path.extname(fp)] || "application/octet-stream");
  fs.createReadStream(fp).pipe(res);
});

/* ---------- render ---------- */
const BLOCK = [/\.mp4(\?|$)/, /googletagmanager|google-analytics|plausible|clarity/i];

async function renderRoute(page, route) {
  await page.goto(`http://localhost:${PORT}${route}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  // Real page content = an h1 from the routed page (shell has none outside <noscript>)
  await page.waitForFunction(
    () => !!document.querySelector("#root h1, main h1"),
    { timeout: 60000 }
  );
  // Let title/canonical settle (Seo.jsx useLayoutEffect) + lazy sections mount
  await page.waitForFunction(
    (r) => {
      const c = document.querySelector('link[rel="canonical"]');
      return c && new URL(c.href).pathname === (r === "/" ? "/" : r);
    },
    { timeout: 15000 },
    route
  );
  await new Promise((r) => setTimeout(r, 700));

  const html = await page.evaluate(() => {
    // The body <noscript> fallback (with its generic H1) is obsolete once real HTML is
    // prerendered — non-JS crawlers parse noscript content, which would put a duplicate,
    // generic H1 above the page's real one. Head noscripts (font fallbacks) stay.
    document.querySelectorAll("body > noscript").forEach((n) => n.remove());
    return "<!doctype html>\n" + document.documentElement.outerHTML;
  });

  const outDir = route === "/" ? BUILD : path.join(BUILD, route.slice(1));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");

  const title = await page.title();
  const words = await page.evaluate(() =>
    document.body.innerText.trim().split(/\s+/).length
  );
  return { route, title: title.slice(0, 60), words };
}

const browser = await puppeteer.launch({
  headless: "shell",
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--force-prefers-reduced-motion"],
});

await new Promise((res) => server.listen(PORT, res));
console.log(`[prerender] ${ROUTES.length} routes @ :${PORT}`);

const results = [];
let failures = [];

async function runPass(routes, label) {
  const queue = [...routes];
  const failed = [];
  await Promise.all(
  Array.from({ length: label ? 1 : CONCURRENCY }, async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (BLOCK.some((re) => re.test(req.url()))) return req.abort();
      req.continue();
    });
    while (queue.length) {
      const route = queue.shift();
      try {
        const r = await renderRoute(page, route);
        console.log(`  ok  ${r.route}  ${r.words}w  "${r.title}"`);
        results.push(r);
      } catch (e) {
        console.error(`  FAIL${label} ${route}: ${e.message.split("\n")[0]}`);
        failed.push(route);
      }
    }
    await page.close();
  })
  );
  return failed;
}

failures = await runPass(ROUTES, "");
if (failures.length) {
  console.log(`[prerender] retrying ${failures.length} route(s) serially…`);
  failures = await runPass(failures, " (retry)");
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`[prerender] ${failures.length} route(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`[prerender] done — ${results.length}/${ROUTES.length} routes written`);
