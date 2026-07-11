import {
  normalizeText,
  detectHandoffIntent,
  inferLocation,
  matchAnswer,
  MATCH_THRESHOLD,
} from "./chatMatcher";

const SAMPLE = [
  {
    id: "system-overview",
    category: "system",
    title: "French drain + sump system",
    answer: "A French drain intercepts water; a sump pump lifts it away.",
    keywords: ["french drain", "sump", "sump pump", "how does it work", "system"],
    relatedChips: ["Book free assessment"],
  },
  {
    id: "standing-water",
    category: "faq",
    title: "Standing water in the yard",
    answer: "Standing water means drainage issues.",
    keywords: ["standing water", "flooded yard", "after rain", "pooling"],
    relatedChips: ["Book free assessment"],
    boostIntent: "handoff",
  },
  {
    id: "service-areas",
    category: "area",
    title: "Service areas",
    answer: "We serve Central Florida.",
    keywords: ["area", "serve", "service area", "near me", "port orange"],
    relatedChips: ["Book free assessment"],
  },
  {
    id: "pricing",
    category: "cta",
    title: "Cost and pricing",
    answer: "Free assessment for pricing.",
    keywords: ["cost", "price", "how much", "quote"],
    boostIntent: "handoff",
    relatedChips: ["Book free assessment"],
  },
];

describe("chatMatcher", () => {
  test("normalizeText lowercases and strips punctuation", () => {
    expect(normalizeText("  Hello, World! ")).toBe("hello world");
  });

  test("detectHandoffIntent catches sales phrases", () => {
    expect(detectHandoffIntent("How much does it cost?")).toBe(true);
    expect(detectHandoffIntent("I want a free assessment")).toBe(true);
    expect(detectHandoffIntent("schedule a visit")).toBe(true);
    expect(detectHandoffIntent("what is a french drain")).toBe(false);
  });

  test("inferLocation finds known cities", () => {
    expect(inferLocation("I live in Port Orange", ["Port Orange", "Orlando"])).toBe("Port Orange");
    expect(inferLocation("somewhere far", ["Port Orange"])).toBe("");
  });

  test("matches french drain questions", () => {
    const r = matchAnswer("How does a french drain and sump pump work?", SAMPLE);
    expect(r.type).toBe("match");
    expect(r.entry.id).toBe("system-overview");
    expect(r.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  test("matches standing water", () => {
    const r = matchAnswer("standing water after rain in my yard", SAMPLE);
    expect(r.type).toBe("match");
    expect(r.entry.id).toBe("standing-water");
    expect(r.handoff).toBe(true);
  });

  test("pricing forces handoff intent", () => {
    const r = matchAnswer("how much does a system cost?", SAMPLE);
    expect(r.handoff).toBe(true);
  });

  test("low confidence returns fallback", () => {
    const r = matchAnswer("xyzzy quantum pizza recipes", SAMPLE);
    expect(r.type).toBe("fallback");
    expect(r.entry).toBeNull();
  });

  test("empty query nudges user", () => {
    const r = matchAnswer("  ", SAMPLE);
    expect(r.type).toBe("empty");
  });

  test("city mention sets inferredLocation", () => {
    const r = matchAnswer("Do you serve Port Orange?", SAMPLE, {
      serviceAreas: ["Port Orange", "Daytona Beach"],
    });
    expect(r.inferredLocation).toBe("Port Orange");
  });
});
