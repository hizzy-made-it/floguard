/**
 * Deterministic keyword scorer for FloGuard chatbot (no LLM).
 * @typedef {{ id: string, category: string, title: string, answer: string, keywords: string[], relatedChips?: string[], boostIntent?: string }} KnowledgeEntry
 */

const HANDOFF_PHRASES = [
  "assessment",
  "free assessment",
  "quote",
  "estimate",
  "how much",
  "cost",
  "price",
  "pricing",
  "schedule",
  "book",
  "call me",
  "come out",
  "get someone",
  "appointment",
  "sign me up",
  "hire",
  "free estimate",
  "on-site",
  "onsite",
  "visit my",
  "look at my",
];

const STOP = new Set([
  "a", "an", "the", "is", "are", "do", "does", "did", "you", "your", "my", "i", "we",
  "to", "of", "in", "on", "for", "and", "or", "what", "how", "can", "me", "it", "this",
  "that", "with", "from", "be", "have", "has", "will", "would", "please", "about",
]);

export const MATCH_THRESHOLD = 4;

/** @param {string} text */
export function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^\w\s+#$.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} text */
export function detectHandoffIntent(text) {
  const n = normalizeText(text);
  if (!n) return false;
  return HANDOFF_PHRASES.some((p) => n.includes(p));
}

/**
 * Infer a service-area city name from free text if present.
 * @param {string} text
 * @param {string[]} serviceAreas
 */
export function inferLocation(text, serviceAreas = []) {
  const n = normalizeText(text);
  if (!n) return "";
  let best = "";
  for (const area of serviceAreas) {
    const a = normalizeText(area);
    if (a && n.includes(a) && a.length > best.length) best = area;
  }
  return best;
}

/**
 * @param {string} query
 * @param {KnowledgeEntry} entry
 */
export function scoreEntry(query, entry) {
  const n = normalizeText(query);
  if (!n || !entry) return 0;
  let score = 0;
  const keywords = entry.keywords || [];

  for (const kw of keywords) {
    const k = normalizeText(kw);
    if (!k) continue;
    if (k.includes(" ") || k.length > 6) {
      if (n.includes(k)) score += 5;
    } else if (n.includes(k)) {
      score += 2;
    }
  }

  // Token overlap with title
  const titleTokens = normalizeText(entry.title)
    .split(" ")
    .filter((t) => t.length > 2 && !STOP.has(t));
  const qTokens = n.split(" ").filter((t) => t.length > 2 && !STOP.has(t));
  for (const t of qTokens) {
    if (titleTokens.includes(t)) score += 2;
  }

  // Category soft boosts
  if (entry.category === "cta" && detectHandoffIntent(n)) score += 3;
  if (entry.category === "area" && /area|serve|near|city|county|live in/.test(n)) score += 2;

  return score;
}

/**
 * @param {string} query
 * @param {KnowledgeEntry[]} knowledge
 * @param {{ serviceAreas?: string[] }} [opts]
 */
export function matchAnswer(query, knowledge, opts = {}) {
  const n = normalizeText(query);
  const handoff = detectHandoffIntent(query);
  const empty = !n || n.length < 2;

  if (empty) {
    return {
      type: "empty",
      handoff: false,
      entry: null,
      score: 0,
      answer:
        "Ask me about French drains, sump pumps, standing water, service areas, or our process — or tap a suggestion below.",
      relatedChips: ["How does a French drain + sump work?", "Do you serve my area?", "Book free assessment"],
      inferredLocation: "",
    };
  }

  let best = null;
  let bestScore = 0;
  for (const entry of knowledge) {
    const s = scoreEntry(query, entry);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }

  const inferredLocation = inferLocation(query, opts.serviceAreas || []);
  const low = bestScore < MATCH_THRESHOLD;

  if (low) {
    return {
      type: "fallback",
      handoff: handoff || true, // soft: always offer assessment on miss
      entry: null,
      score: bestScore,
      answer:
        "I may not have that exact detail in my site notes. A FloGuard specialist can answer on a free on-site assessment — or call us and we'll help. Primary service area is Central Florida (Port Orange, Daytona, Sanford, Orlando, and nearby).",
      relatedChips: ["Book free assessment", "Do you serve my area?", "How does the system work?"],
      inferredLocation,
    };
  }

  const forceHandoff = handoff || best.boostIntent === "handoff";
  return {
    type: "match",
    handoff: forceHandoff,
    entry: best,
    score: bestScore,
    answer: best.answer,
    relatedChips: best.relatedChips || ["Book free assessment"],
    inferredLocation,
  };
}

export { HANDOFF_PHRASES };
