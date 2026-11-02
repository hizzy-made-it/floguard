/**
 * Build-time sitemap from cities + blog + services data.
 * Run: node scripts/generate-sitemap.js
 * Wired into package.json "prebuild" / "build".
 */
const fs = require("fs");
const path = require("path");

const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SITE = "https://floguardfl.com";
const today = new Date().toISOString().slice(0, 10);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- lastmod sources -------------------------------------------------------------------
// 1. Content URLs (services, cities, blog posts): the `updated` field on each entry in
//    src/data/{site,cities,blog}.js — the real last content edit, committed with the change.
// 2. Static pages: last git commit touching the page's own source file(s) — but ONLY when the
//    clone has full history. CI/host clones are usually shallow (depth 1), where every path
//    reports the same tip commit; that is what stamped all 31 URLs with one date before.
//    In a shallow clone we fall back to STATIC_PAGES[].updated (real dates, kept in this file).
// 3. Index pages (/blog, /areas, /services) also roll up the newest child entry.

let isShallow = true;
try {
  isShallow =
    execSync("git rev-parse --is-shallow-repository", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() !== "false";
} catch {
  isShallow = true;
}

function gitLastMod(relPaths) {
  if (isShallow) return null;
  try {
    const out = execSync(`git log -1 --format=%cs -- ${relPaths.map((p) => `"${p}"`).join(" ")}`, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return ISO_DATE.test(out) ? out : null;
  } catch {
    return null;
  }
}

const maxDate = (...ds) => ds.filter((d) => d && ISO_DATE.test(d)).sort().pop() || null;

/**
 * Lightweight parse of a data file without executing ES modules: split on each top-level
 * entry's `slug:` and read `updated` / `date` inside that entry.
 */
function extractEntries(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const parts = src.split(/\n {4}slug:\s*["']/).slice(1);
  return parts.map((chunk) => {
    const slug = chunk.match(/^([^"']+)/)[1];
    // stop at the next entry boundary so we never read a neighbour's fields
    const body = chunk.split(/\n {2}\},?\n/)[0];
    const updated = (body.match(/\n {4}updated:\s*["'](\d{4}-\d{2}-\d{2})["']/) || [])[1] || null;
    const date = (body.match(/\n {4}date:\s*["'](\d{4}-\d{2}-\d{2})["']/) || [])[1] || null;
    return { slug, updated, date };
  });
}

const SERVICE_SLUGS = ["french-drains", "sump-pumps", "yard-drainage", "pump-maintenance"];
const services = extractEntries(path.join(ROOT, "src/data/site.js")).filter((e) => SERVICE_SLUGS.includes(e.slug));
const cities = extractEntries(path.join(ROOT, "src/data/cities.js"));
const posts = extractEntries(path.join(ROOT, "src/data/blog.js"));

const missing = [...services, ...cities, ...posts].filter((e) => !e.updated && !e.date).map((e) => e.slug);
if (missing.length) {
  console.warn(`[sitemap] no updated/date field for: ${missing.join(", ")} — using today`);
}
const entryDate = (e) => e.updated || e.date || today;

// Footer links every SERVICE_AREAS name to /areas/<slug>; fail loudly if one has no page.
{
  const siteSrc = fs.readFileSync(path.join(ROOT, "src/data/site.js"), "utf8");
  const block = (siteSrc.match(/export const SERVICE_AREAS = \[([\s\S]*?)\];/) || [])[1] || "";
  const names = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const citySlugs = new Set(cities.map((c) => c.slug));
  const orphan = names.filter((n) => !citySlugs.has(n.toLowerCase().replace(/\s+/g, "-")));
  if (orphan.length) {
    console.error(`[sitemap] SERVICE_AREAS without an /areas page (footer would 404): ${orphan.join(", ")}`);
    process.exit(1);
  }
}

// Real last-edit dates for static pages (git, 2026-10-30). Used when git history is shallow.
const STATIC_PAGES = [
  { loc: "/", files: ["src/pages/Home.jsx", "src/pages/HomeBelowFold.jsx"], updated: "2026-10-30", priority: "1.0", changefreq: "weekly" },
  { loc: "/services", files: ["src/pages/Services.jsx"], updated: "2026-08-25", priority: "0.9", changefreq: "monthly", children: services },
  { loc: "/process", files: ["src/pages/Process.jsx"], updated: "2026-07-22", priority: "0.8", changefreq: "monthly" },
  { loc: "/areas", files: ["src/pages/Areas.jsx"], updated: "2026-08-25", priority: "0.9", changefreq: "monthly", children: cities },
  { loc: "/case-studies", files: ["src/pages/CaseStudies.jsx"], updated: "2026-07-22", priority: "0.7", changefreq: "monthly" },
  { loc: "/about", files: ["src/pages/About.jsx"], updated: "2026-07-22", priority: "0.6", changefreq: "monthly" },
  { loc: "/blog", files: ["src/pages/Blog.jsx"], updated: "2026-07-22", priority: "0.8", changefreq: "weekly", children: posts },
  { loc: "/contact", files: ["src/pages/Contact.jsx"], updated: "2026-07-22", priority: "0.9", changefreq: "monthly" },
];

const staticUrls = STATIC_PAGES.map((p) => ({
  ...p,
  lastmod: maxDate(gitLastMod(p.files) || p.updated, ...(p.children || []).map(entryDate)) || today,
}));

function urlXml({ loc, priority, changefreq, lastmod = today }) {
  return `  <url><loc>${SITE}${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

const lines = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  ...staticUrls.map((u) => urlXml(u)),
  "",
  ...services.map((e) =>
    urlXml({ loc: `/services/${e.slug}`, priority: "0.9", changefreq: "monthly", lastmod: entryDate(e) })
  ),
  "",
  ...cities.map((e) =>
    urlXml({ loc: `/areas/${e.slug}`, priority: "0.8", changefreq: "monthly", lastmod: entryDate(e) })
  ),
  "",
  ...posts.map((e) =>
    urlXml({ loc: `/blog/${e.slug}`, priority: "0.7", changefreq: "monthly", lastmod: entryDate(e) })
  ),
  `</urlset>`,
  "",
];

const xml = lines.join("\n");
const outPublic = path.join(ROOT, "public", "sitemap.xml");
fs.writeFileSync(outPublic, xml, "utf8");
console.log(
  `sitemap.xml written (${staticUrls.length + services.length + cities.length + posts.length} urls, ${
    isShallow ? "shallow clone: static pages use STATIC_PAGES dates" : "static pages from git"
  }) → public/sitemap.xml`
);
