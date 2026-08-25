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

// Real lastmod: last git commit touching the file that defines the URL's content.
// Falls back to today when git is unavailable (fresh CI without history).
function gitLastMod(relPath) {
  try {
    const out = execSync(`git log -1 --format=%cI -- "${relPath}"`, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out ? out.slice(0, 10) : today;
  } catch {
    return today;
  }
}

const LASTMOD = {
  cities: gitLastMod("src/data/cities.js"),
  blog: gitLastMod("src/data/blog.js"),
  site: gitLastMod("src/data/site.js"),
  pages: gitLastMod("src/pages"),
};

// Lightweight parse: extract slug strings from data files without executing ES modules
function extractSlugs(filePath, key) {
  const src = fs.readFileSync(filePath, "utf8");
  const re = new RegExp(`${key}:\\s*["']([^"']+)["']`, "g");
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return [...new Set(out)];
}

const citySlugs = extractSlugs(path.join(ROOT, "src/data/cities.js"), "slug");
const blogSlugs = extractSlugs(path.join(ROOT, "src/data/blog.js"), "slug");
const serviceSlugs = extractSlugs(path.join(ROOT, "src/data/site.js"), "slug").filter((s) =>
  ["french-drains", "sump-pumps", "yard-drainage", "pump-maintenance"].includes(s)
);

const staticUrls = [
  { loc: "/", priority: "1.0", changefreq: "weekly" },
  { loc: "/services", priority: "0.9", changefreq: "monthly" },
  { loc: "/process", priority: "0.8", changefreq: "monthly" },
  { loc: "/areas", priority: "0.9", changefreq: "monthly" },
  { loc: "/case-studies", priority: "0.7", changefreq: "monthly" },
  { loc: "/about", priority: "0.6", changefreq: "monthly" },
  { loc: "/blog", priority: "0.8", changefreq: "weekly" },
  { loc: "/contact", priority: "0.9", changefreq: "monthly" },
];

function urlXml({ loc, priority, changefreq, lastmod = today }) {
  return `  <url><loc>${SITE}${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

const lines = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  ...staticUrls.map((u) => urlXml({ ...u, lastmod: LASTMOD.pages })),
  "",
  ...serviceSlugs.map((slug) =>
    urlXml({ loc: `/services/${slug}`, priority: "0.9", changefreq: "monthly", lastmod: LASTMOD.site })
  ),
  "",
  ...citySlugs.map((slug) =>
    urlXml({ loc: `/areas/${slug}`, priority: "0.8", changefreq: "monthly", lastmod: LASTMOD.cities })
  ),
  "",
  ...blogSlugs.map((slug) =>
    urlXml({ loc: `/blog/${slug}`, priority: "0.7", changefreq: "monthly", lastmod: LASTMOD.blog })
  ),
  `</urlset>`,
  "",
];

const xml = lines.join("\n");
const outPublic = path.join(ROOT, "public", "sitemap.xml");
fs.writeFileSync(outPublic, xml, "utf8");
console.log(
  `sitemap.xml written (${staticUrls.length + serviceSlugs.length + citySlugs.length + blogSlugs.length} urls) → public/sitemap.xml`
);
