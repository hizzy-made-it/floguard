const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "../src/data/blog.js");
let s = fs.readFileSync(file, "utf8");

const faqs = {
  "why-is-water-standing-in-my-yard": [
    { q: "Why is water standing in my Florida yard?", a: "Common causes include poor grading, high water table, compacted soil, downspouts dumping into low spots, and no collection system. Florida rain and flat lots make this very common." },
    { q: "How do I fix standing water after rain?", a: "Professional fixes usually combine French drains, catch basins or re-grading, and often a sump pump to discharge water safely away from the foundation." },
    { q: "Is standing water bad for my foundation?", a: "Yes. Prolonged moisture raises hydrostatic pressure, encourages crawlspace mold, and can lead to structural moisture issues." },
    { q: "Should I DIY a French drain?", a: "DIY kits often fail in Florida sand without proper fabric and slope. Engineered installs last longer and protect the foundation correctly." },
  ],
  "french-drain-vs-sump-pump": [
    { q: "Do I need a French drain or a sump pump?", a: "In Central Florida you often need both: the French drain collects water; the sump lifts it when the lot is too flat or the water table is high." },
    { q: "Can a French drain work without a sump pump?", a: "Only if there is enough natural slope and a legal gravity discharge. Many Florida lots do not have that." },
    { q: "Can a sump pump work without a French drain?", a: "A sump alone helps a pit area but will not intercept perimeter groundwater as effectively as a combined system." },
    { q: "What does FloGuard recommend for high water table homes?", a: "A fabric-lined French drain routed to a sealed sump with check valve and battery backup options for storm outages." },
  ],
  "signs-foundation-drainage-problem": [
    { q: "What are signs of a foundation drainage problem?", a: "Standing water near the foundation, damp crawlspaces, musty smells, soil erosion, cracks or moisture at the slab edge, and water after every storm." },
    { q: "Can drainage problems cause mold?", a: "Persistent moisture under or around the home supports mold growth in crawlspaces and wall cavities." },
    { q: "When should I call a pro?", a: "If water lingers for hours after rain, the crawlspace is wet, or you see foundation moisture — request a free assessment." },
    { q: "Will a French drain protect the foundation?", a: "A properly designed French drain lowers hydrostatic pressure around the foundation and is one of the most effective protections in Florida." },
  ],
  "prepare-yard-florida-rainy-season": [
    { q: "When is Florida rainy season?", a: "Typically late spring through early fall (roughly May–October), with intense afternoon storms and tropical systems." },
    { q: "How should I prepare my yard for rainy season?", a: "Clear gutters, test sump pumps monthly, clear discharge lines, and schedule professional drainage service before peak storms." },
    { q: "Should I test my sump pump before hurricane season?", a: "Yes. Pour water into the basin monthly and service batteries every few years. Professional checks before wet season are ideal." },
    { q: "What if my yard already floods every summer?", a: "You likely need engineered drainage — French drains, grading, and/or a sump. Book a free FloGuard assessment." },
  ],
  "wet-crawl-space-interior-drainage-guide": [
    { q: "How do you fix a wet crawlspace in Florida?", a: "Interior French drains to a sealed sump pump are common. We also address vapor and discharge so water leaves the home safely." },
    { q: "Is a wet crawlspace dangerous?", a: "It can promote mold, wood rot, pest issues, and poor indoor air quality. Address moisture promptly." },
    { q: "Do I need a dehumidifier only?", a: "Dehumidifiers help symptoms but do not remove the groundwater source. Drainage fixes the cause." },
    { q: "Can FloGuard install interior drains?", a: "Yes. Interior drains + sump pumps are a core service for crawlspace and flat-lot homes." },
  ],
  "catch-basins-grading-swales-standing-water": [
    { q: "What is a catch basin used for?", a: "Catch basins collect surface water from low spots, driveways, and patios and route it into a drain pipe system." },
    { q: "Do catch basins replace French drains?", a: "No. Catch basins handle surface water; French drains intercept subsurface/groundwater. Many yards need both." },
    { q: "Will re-grading fix standing water alone?", a: "Sometimes for mild surface pooling. High water tables usually need subsurface collection and discharge." },
    { q: "Can you fix flooded patios and lanais?", a: "Yes — channel drains, catch basins, and French drain/sump systems are common patio fixes." },
  ],
  "does-french-drain-add-home-value": [
    { q: "Does a French drain add home value?", a: "It protects the foundation and improves usability of the yard — key factors buyers and inspectors care about, even if ROI is not a fixed percentage." },
    { q: "Do buyers notice drainage problems?", a: "Yes. Standing water, crawlspace moisture, and inspection flags can delay sales or lower offers." },
    { q: "Is drainage a good investment before listing?", a: "Fixing active water issues before listing reduces inspection risk and improves curb appeal after storms." },
    { q: "Will the system be visible after install?", a: "Proper installs are underground; landscaping is restored so the yard looks continuous." },
  ],
};

for (const [slug, list] of Object.entries(faqs)) {
  const start = s.indexOf(`slug: "${slug}"`);
  if (start < 0) {
    console.warn("slug missing", slug);
    continue;
  }
  const contentIdx = s.indexOf("content:", start);
  if (contentIdx < 0) {
    console.warn("content missing", slug);
    continue;
  }
  const between = s.slice(start, contentIdx);
  if (between.includes("faqs:")) {
    console.log("skip existing", slug);
    continue;
  }
  const pretty = list
    .map((f) => `      { q: ${JSON.stringify(f.q)}, a: ${JSON.stringify(f.a)} }`)
    .join(",\n");
  const insert = `    faqs: [\n${pretty}\n    ],\n    `;
  // insert right before "content:" at contentIdx
  s = s.slice(0, contentIdx) + insert + s.slice(contentIdx);
  console.log("injected", slug);
}

fs.writeFileSync(file, s);
const count = (s.match(/faqs: \[/g) || []).length;
console.log("faq_blocks", count);
