# FloGuard SEO + AEO Strategy (Living Source of Truth)

**Domain:** https://www.floguardfl.com  
**Updated:** 2026-07-14  
**Stack:** React CRA + FastAPI + MongoDB

> **Elite ranking command center:** [`docs/ELITE-SEO-AEO-GAMEPLAN.md`](./ELITE-SEO-AEO-GAMEPLAN.md)  
> Keyword → URL map, 14-day ASAP sprint, AEO system, KPIs.  
> **Operational checklist:** [`docs/SEO-EXECUTION-PLAN.md`](./SEO-EXECUTION-PLAN.md)  
> This file remains the code/content status + constraints snapshot.

## Implementation status (complete for code)

| Area | Status |
|------|--------|
| Service URLs + FAQ schema | Done |
| All 8 cities deepDive + FAQs + schema | Done |
| All 8 blog posts FAQs + FAQPage schema | Done |
| HowTo + FAQ on /process | Done |
| Sitemap generator (28 URLs) | Done |
| robots.txt (search + AI allows; noindex paths) | Done in repo |
| llms.txt entity + URLs | Done |
| Chat knowledge aligned to services/cities | Done |
| Studio/admin noindex | Done |
| noscript crawl links in index.html | Done |
| Absolute OG images | Done |

## Cloudflare ops (required for full AEO)

Production may inject **Cloudflare Managed robots** that block GPTBot, ClaudeBot, Google-Extended, etc.

**Do this in Cloudflare dashboard:**
1. AI Crawl Control / Bot management → allow or do not block: GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended (as desired for citations).
2. Ensure custom `robots.txt` from the repo is not fully replaced without a Sitemap line.
3. Keep Googlebot allowed for classic SEO.

Until CF policy matches the repo `public/robots.txt`, AEO citations will underperform even though page content is ready.

## GSC / Bing ops (required for indexing)

1. Search Console property: `https://www.floguardfl.com`
2. Submit sitemap: `https://www.floguardfl.com/sitemap.xml`
3. URL Inspection → Request indexing for:
   - `/`
   - `/services/french-drains`, `/sump-pumps`, `/yard-drainage`, `/pump-maintenance`
   - `/areas/port-orange`, `/areas/daytona-beach`
   - `/blog/french-drain-cost-central-florida-2026`
4. Bing Webmaster → import from GSC or submit same sitemap
5. Optional: set `REACT_APP_GA_MEASUREMENT_ID` on Cloudflare Pages and rebuild

## Quality gates

| Page type | Requirement |
|-----------|-------------|
| Service | answerFirst + longContent + 4 FAQs + Service+FAQ schema |
| City | unique intro + deepDive + problems + 4 FAQs + LocalBusiness+FAQ schema |
| Blog pillar | answer-first intro + faqs[] + BlogPosting+FAQ schema |
| Process | HowTo steps + FAQ graph |

## North-star outcomes (12 months)

See **realistic KPIs and leading indicators** in `SEO-EXECUTION-PLAN.md` §3.

Summary:
- Map Pack + organic visibility for Port Orange, Daytona, NSB, Ormond on core services  
- Organic sessions growing from baseline (target range in execution plan—not 5k/mo fantasy)  
- Monthly AI mention checks on a fixed 15-query set (after CF allowlist)

## Constraints

- Do not change `hero.mp4` or Home video scrub UX  
- No LLM chatbot inventing prices  
- No fake AggregateRating markup  
