/**
 * FloGuard chatbot knowledge pack — compiled from site data (no LLM).
 */
import {
  COMPANY,
  SERVICES,
  PROCESS,
  FLOW_PATH,
  SYSTEM_EXPLANATION,
  CASE_STUDIES,
  STATS,
  SERVICE_AREAS,
  LANDING_FAQ,
} from "./site";
import { CITIES } from "./cities";
import { POSTS } from "./blog";

function serviceEntry(s) {
  return {
    id: `service-${s.id}`,
    category: "service",
    title: s.title,
    answer: `${s.title}: ${s.blurb} Key details: ${s.features.join("; ")}.`,
    keywords: [
      s.title.toLowerCase(),
      s.id,
      ...s.features.map((f) => f.toLowerCase()),
      "service",
      "services",
      "install",
      "installation",
    ],
    relatedChips: ["What's the process?", "Book free assessment", "Do you serve my area?"],
  };
}

function processEntry(p) {
  return {
    id: `process-${p.step}`,
    category: "process",
    title: `${p.step}. ${p.title}`,
    answer: `Step ${p.step} — ${p.title}: ${p.body}`,
    keywords: [p.title.toLowerCase(), "process", "how it works", "steps", "what happens"],
    relatedChips: ["How does the system work?", "Book free assessment"],
  };
}

/** @type {import('../lib/chatMatcher').KnowledgeEntry[]} */
export const CHAT_KNOWLEDGE = [
  {
    id: "company-contact",
    category: "company",
    title: "Contact FloGuard",
    answer: `${COMPANY.legal} — ${COMPANY.tagline} Call or text ${COMPANY.phone}, email ${COMPANY.email}. We're at ${COMPANY.address}. Hours: ${COMPANY.hours}. Website: ${COMPANY.website}. Google rating: ${COMPANY.rating}★.`,
    keywords: [
      "phone",
      "call",
      "email",
      "contact",
      "hours",
      "address",
      "location",
      "open",
      "number",
      "text",
      "sms",
      "reach",
    ],
    relatedChips: ["Book free assessment", "Do you serve my area?"],
    boostIntent: "handoff",
  },
  {
    id: "company-about",
    category: "company",
    title: "About FloGuard",
    answer: `FloGuard designs and installs smart drainage systems for Florida homes — French drains, sump pumps, yard drainage, and maintenance. We've protected ${STATS[0].value}${STATS[0].suffix} yards, respond in ${STATS[2].value}${STATS[2].suffix}, and stand behind our work with a multi-year warranty focus. Local crew serving the Port Orange / Daytona / Sanford / Orlando corridor.`,
    keywords: ["about", "who are you", "company", "floguard", "warranty", "trust", "reviews", "rating"],
    relatedChips: ["What services do you offer?", "Book free assessment"],
  },
  {
    id: "system-overview",
    category: "system",
    title: "French drain + sump system",
    answer: `${SYSTEM_EXPLANATION.intro} ${SYSTEM_EXPLANATION.benefits} ${SYSTEM_EXPLANATION.bottomLine}`,
    keywords: [
      "french drain",
      "sump",
      "sump pump",
      "how does it work",
      "system",
      "drainage system",
      "what is",
      "explain",
    ],
    relatedChips: ["Standing water after rain", "What's the process?", "Book free assessment"],
  },
  {
    id: "system-why-florida",
    category: "system",
    title: "Why Florida needs active drainage",
    answer: `${SYSTEM_EXPLANATION.whyMatters} Florida-specific factors: ${SYSTEM_EXPLANATION.floridaSpecific.join(" ")}`,
    keywords: [
      "florida",
      "water table",
      "flat",
      "sandy",
      "hurricane",
      "rainy season",
      "why",
      "high water",
    ],
    relatedChips: ["How does the system work?", "Book free assessment"],
  },
  {
    id: "system-parts",
    category: "system",
    title: "System parts",
    answer: SYSTEM_EXPLANATION.parts.map((p) => `${p.title}: ${p.desc}`).join(" "),
    keywords: ["pipe", "gravel", "filter fabric", "basin", "float", "discharge", "parts", "components"],
    relatedChips: ["How does the system work?", "Maintenance tips"],
  },
  {
    id: "system-how-steps",
    category: "system",
    title: "How water moves through the system",
    answer: `Here's the path: ${SYSTEM_EXPLANATION.howItWorks.map((s, i) => `${i + 1}. ${s}`).join(" ")} Flow path labels: ${FLOW_PATH.map((f) => f.label).join(" → ")}.`,
    keywords: ["how it works", "water path", "gravity", "float switch", "discharge", "flow"],
    relatedChips: ["What's the process?", "Book free assessment"],
  },
  {
    id: "system-protects",
    category: "system",
    title: "What it protects (and doesn't)",
    answer: `A FloGuard system helps with: ${SYSTEM_EXPLANATION.protects} It does not protect against: ${SYSTEM_EXPLANATION.doesNotProtect}`,
    keywords: ["protect", "flood", "storm surge", "limit", "doesn't", "cannot", "mold", "crawl"],
    relatedChips: ["Standing water after rain", "Book free assessment"],
  },
  {
    id: "system-maintenance",
    category: "system",
    title: "Maintenance",
    answer: `Keep your system storm-ready: ${SYSTEM_EXPLANATION.maintenance.join(" ")} We also offer pump maintenance and monitoring plans.`,
    keywords: ["maintain", "maintenance", "service plan", "test pump", "battery", "clog", "clean"],
    relatedChips: ["What services do you offer?", "Book free assessment"],
  },
  {
    id: "standing-water",
    category: "faq",
    title: "Standing water in the yard",
    answer:
      "Standing water after storms usually means poor grading, a high water table, compacted soil, downspouts dumping into low spots, or no collection system. In Central Florida those stack quickly. A French drain intercepts water; on flat lots a sump pump lifts it to a safe discharge. We map your runoff on a free on-site assessment — no guessing over the phone.",
    keywords: [
      "standing water",
      "flooded yard",
      "pond",
      "puddle",
      "wet yard",
      "after rain",
      "won't drain",
      "swamp",
      "pooling",
    ],
    relatedChips: ["How does the system work?", "Book free assessment"],
    boostIntent: "handoff",
  },
  {
    id: "pricing",
    category: "cta",
    title: "Cost and pricing",
    answer:
      "Every property is different — trench length, sump needs, discharge path, and soil all change the scope. We don't quote a firm price without seeing the site. The good news: assessments are free and no-obligation. You'll get a clear plan and honest number for your yard.",
    keywords: [
      "cost",
      "price",
      "pricing",
      "how much",
      "quote",
      "estimate",
      "expensive",
      "cheap",
      "afford",
      "$",
    ],
    relatedChips: ["Book free assessment", "What's the process?"],
    boostIntent: "handoff",
  },
  {
    id: "assessment-free",
    category: "cta",
    title: "Free assessment",
    answer:
      "Yes — the on-site drainage assessment is free and no-obligation. We walk the property, map low spots and runoff, and give you a clear plan. Use our short Contact questionnaire so the crew has the full picture before we arrive. Typical response within 24 hours; we prioritize active flooding when we can.",
    keywords: [
      "assessment",
      "free",
      "inspect",
      "evaluation",
      "come out",
      "visit",
      "schedule",
      "book",
      "appointment",
    ],
    relatedChips: ["Book free assessment", "Call FloGuard"],
    boostIntent: "handoff",
  },
  {
    id: "service-areas",
    category: "area",
    title: "Service areas",
    answer: `We serve Central Florida including: ${SERVICE_AREAS.join(", ")}. Primary corridor is Port Orange / Daytona / Sanford / Orlando and nearby communities. Not sure if you're in range? Start the free assessment on our Contact page and we'll confirm.`,
    keywords: [
      "area",
      "areas",
      "serve",
      "service area",
      "near me",
      "county",
      "volusia",
      "seminole",
      "orange",
      "where",
      "travel",
    ],
    relatedChips: ["Book free assessment", "Port Orange", "Daytona Beach"],
  },
  {
    id: "process-overview",
    category: "process",
    title: "Our process",
    answer: `How we work: ${PROCESS.map((p) => `${p.step}. ${p.title} — ${p.body}`).join(" ")}`,
    keywords: ["process", "timeline", "how long", "install time", "what to expect", "steps"],
    relatedChips: ["How does the system work?", "Book free assessment"],
  },
  ...SERVICES.map(serviceEntry),
  ...PROCESS.map(processEntry),
  ...CASE_STUDIES.map((c) => ({
    id: `case-${c.id}`,
    category: "case",
    title: c.title,
    answer: `${c.title} (${c.location}, ${c.category}): ${c.summary} Result: ${c.result}`,
    keywords: [
      c.title.toLowerCase(),
      c.location.toLowerCase(),
      c.category.toLowerCase(),
      "before",
      "after",
      "results",
      "case study",
      "example",
    ],
    relatedChips: ["What services do you offer?", "Book free assessment"],
  })),
  ...LANDING_FAQ.map((f, i) => ({
    id: `faq-${i}`,
    category: "faq",
    title: f.q,
    answer: f.a,
    keywords: f.q
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .concat(["faq", "question"]),
    relatedChips: ["Book free assessment", "Do you serve my area?"],
  })),
  ...CITIES.map((city) => ({
    id: `city-${city.slug}`,
    category: "area",
    title: `${city.name} drainage`,
    answer: `${city.name} (${city.county}): ${city.intro} Common issues: ${city.problems.join("; ")}. Neighborhoods we know well include ${city.neighborhoods.slice(0, 4).join(", ")}.`,
    keywords: [
      city.name.toLowerCase(),
      city.slug.replace(/-/g, " "),
      city.county.toLowerCase(),
      ...city.neighborhoods.map((n) => n.toLowerCase()),
      city.zip,
    ],
    relatedChips: ["Book free assessment", "How does the system work?"],
  })),
  ...POSTS.slice(0, 8).map((post) => ({
    id: `blog-${post.slug}`,
    category: "faq",
    title: post.title,
    answer: `${post.excerpt} Read more on our blog: /blog/${post.slug}. For a number specific to your property, book a free assessment.`,
    keywords: [
      post.keyword,
      ...post.title
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
      post.category.toLowerCase(),
    ],
    relatedChips: ["Book free assessment", "How does the system work?"],
    boostIntent: post.category === "Cost & Value" ? "handoff" : undefined,
  })),
];

export const DEFAULT_CHIPS = [
  "How does a French drain + sump work?",
  "Do you serve my area?",
  "Standing water after rain",
  "What's the process?",
  "Book free assessment",
];

export const GREETING =
  "Hi — I'm the FloGuard assistant. I answer from our site info about French drains, sump pumps, service areas, and how we work in Central Florida. For a free on-site assessment we use a short questionnaire on Contact so the crew gets the full picture. What can I help with?";
