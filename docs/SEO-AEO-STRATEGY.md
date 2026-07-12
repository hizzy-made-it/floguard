# FloGuard SEO + AEO Strategy (Living Source of Truth)

**Domain:** https://www.floguardfl.com  
**Updated:** 2026-07-11  
**Stack:** React CRA + FastAPI + MongoDB (no full rewrite until GSC proves need)

## Goals (12 months)

- Map Pack + organic top 5 for Port Orange, Daytona Beach, New Smyrna, Ormond  
- 3–5× organic sessions; ≥40% qualified leads from organic / AI referral  
- Weekly AI citation presence on 10 tracked AEO queries  

## Architecture (hub and spoke)

- `/` brand + LocalBusiness + FAQ  
- `/services` hub + `/services/{slug}` (french-drains, sump-pumps, yard-drainage, pump-maintenance)  
- `/areas` + `/areas/{city}` (unique deep content; quality gates)  
- `/blog` pillars (cost, diagnosis, seasonal, comparison)  
- `/contact` assessment quiz = sole lead form  

## Quality gates

| Page type | Min unique depth | Notes |
|-----------|------------------|-------|
| Service | 800+ words equivalent | answer-first + FAQs + schema |
| Primary city | 600–800+ unique | deepDive + local FAQs; no Mad-Libs spam |
| Blog pillar | answer-first + tables | FAQ schema preferred |

Hard stop: do not mass-generate thin city pages.

## AEO rules

1. Answer in first ~100 words  
2. Tables, lists, bold facts  
3. FAQ schema where FAQs exist  
4. Keep `public/llms.txt` entity-accurate  
5. Chatbot knowledge aligns with page FAQs  

## Technical checklist

- [x] Service detail routes  
- [x] Sitemap generator (`yarn sitemap` / prebuild)  
- [x] Home LocalBusiness + FAQ graph  
- [x] Thin AggregateRating removed from shell schema  
- [x] 3D marketing heroes removed; hero **video** retained  
- [ ] GA4 + GSC events live in production  
- [ ] GBP + reviews + citations (ops, not code)  

## Keyword priorities

See `docs/keyword-research-seo-aeo.md`. Content briefs: `docs/content-briefs.md`. Measurement: `docs/measurement-seo-aeo.md`. Off-page: `docs/offpage-link-strategy.md`.

## Constraints

- **Do not change** `hero.mp4` or Home video scrub UX  
- No LLM chatbot inventing prices  
- No fake review markup  
