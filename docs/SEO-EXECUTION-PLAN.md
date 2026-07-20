# FloGuard SEO Execution Plan v2

**Status:** Operational plan (replaces invalid “high volume 0–15 KD” draft)  
**Domain:** https://www.floguardfl.com  
**Business:** FloGuard, LLC — French drains, sump pumps, yard drainage (Central Florida)  
**Type:** Hybrid local (Port Orange HQ + service-area cities)  
**Updated:** 2026-07-14  

**Related docs (use these, don’t duplicate work):**
- `docs/SEO-AEO-STRATEGY.md` — code/content status + constraints  
- `docs/keyword-research-seo-aeo.md` — keyword seeds (re-validate volumes)  
- `docs/gbp-citations-checklist.md` — GBP + citations  
- `docs/measurement-seo-aeo.md` — GSC/GA4/AEO tracking  
- `docs/offpage-link-strategy.md` — links & mentions  
- `docs/content-briefs.md` — content templates  

---

## 1. What “works” for this business

Home-service drainage wins in this order:

| Priority | Channel | Why |
|----------|---------|-----|
| 1 | **Google Map Pack / GBP** | “Near me” and city+service queries convert here first |
| 2 | **Organic service + city pages** | #1 local organic factor; feed AI Overviews when you rank |
| 3 | **Reviews + citations** | Pack ranking + AI entity trust (ChatGPT often uses Bing/Yelp/directories, not GBP alone) |
| 4 | **Cost / how-to content** | Captures research stage; supports AEO answer blocks |
| 5 | **Brand mentions (YouTube, Reddit, local PR)** | Stronger AI visibility signal than raw backlink spam |

**Do not prioritize:** company Wikipedia page, mass city×service doorway pages, FAQ schema as a Google ranking hack, or treating `llms.txt` as a citation lever.

---

## 2. Current baseline (verified 2026-07-14)

| Item | State | Action needed |
|------|--------|---------------|
| Site stack | React CSR (CRA), Tailwind | Prerender/SSR money pages |
| Inventory | 4 services, 8 cities, 8 blogs (sitemap) | Expand only with unique content |
| Schema | LocalBusiness + service/blog FAQ patterns in code | Fill `sameAs`; geo ≥5 decimals |
| Repo `robots.txt` | Allows GPTBot, ClaudeBot, etc. | **OK in repo** |
| **Live Cloudflare robots** | Managed rules **Disallow** GPTBot, ClaudeBot, Google-Extended, etc. | **Week 1 critical fix** |
| `llms.txt` | Strong entity file | Keep; don’t count as ranking work |
| Noscript + JSON-LD in HTML | Present on homepage | Keep when adding prerender |
| GSC / Bing / GA4 | Ops-dependent | Must complete in Phase 0 |
| Keyword volumes | Seeds in docs; **not trusted as exact US volumes** | Re-pull before big content bets |

---

## 3. Goals & KPIs (realistic)

### North-star (12 months)
- Map Pack visibility for **Port Orange, Daytona Beach, New Smyrna Beach, Ormond Beach** on core services  
- Steady stream of **organic + AI-assisted leads** (tracked phone + form)  
- Entity presence: consistent NAP + reviews + citations + project proof  

### Leading indicators (measure weekly/monthly)

| Metric | Now (approx) | Month 3 | Month 6 | Month 12 |
|--------|--------------|---------|---------|----------|
| GSC impressions (brand + non-brand) | low / baseline | 2–5× baseline | 5–10× | 10–20× |
| Organic sessions (GA4) | baseline | 150–400/mo | 400–1,200/mo | 1,000–3,000/mo* |
| Map Pack top-3 (tracked grid cells) | unknown | 2–4 keywords × HQ area | 8–15 | 20–40 |
| Google reviews | count actual | +15–25 | +40–60 | 75–100+ |
| Referring domains (quality) | low | 8–15 | 20–35 | 40–60 |
| AI mention rate (fixed 15 queries) | 0 | 1–3 yes | 4–8 yes | 8–12 yes |
| Indexed important URLs | check GSC | 100% money pages | +new cities | stable |

\*Upper bound assumes reviews + local pack + content + some links. **5,000+/mo organic is not the planning target** for a single local contractor without large adjacencies/PR.

### Fixed AI monitor set (15 queries — log yes/no monthly)

1. french drain cost central florida  
2. french drain installation port orange  
3. french drain daytona beach  
4. sump pump installation central florida  
5. yard drainage orlando  
6. how much does a french drain cost in florida  
7. french drain vs sump pump florida  
8. best drainage contractor port orange  
9. standing water in yard florida high water table  
10. battery backup sump pump hurricane florida  
11. wet crawl space drainage florida  
12. french drain cost per foot florida  
13. drainage contractor near me (from Port Orange IP/context)  
14. sump pump maintenance florida  
15. does a french drain add home value  

---

## 4. Strategy rules (non-negotiable)

1. **Money pages first:** Home, 4 services, Port Orange + Daytona + Orlando areas, cost blog.  
2. **One URL per intent.** If SERP top-10 overlap ≥7, merge; don’t ship a second page.  
3. **City pages pass the swap test:** If swapping city name still works, rewrite with local proof.  
4. **No city×service matrix until** ≥3 city hubs get impressions/leads and each combo has unique job/photo/data. Cap: batch ≤6 combo pages, wait 4 weeks, review GSC.  
5. **Hard stop at 30+ thin location URLs** without 60%+ unique content.  
6. **Reviews ≥1 every 18 days** (velocity matters as much as total).  
7. **Exact NAP everywhere** (see citations checklist).  
8. **No fake AggregateRating.** No invented prices in chatbot/AI copy.  
9. **Canonical host:** `https://www.floguardfl.com` only.  

---

## 5. Information architecture (target)

```
/ (home)
/services/
  french-drains
  sump-pumps
  yard-drainage
  pump-maintenance
/areas/
  port-orange | daytona-beach | orlando | … (existing 8)
  edgewater | debary | lake-mary | winter-park  (Phase 2, unique only)
  [later] /areas/{city}/french-drains  ONLY when justified
/blog/  (cost, vs, how-to, seasonal — support, not replace services)
/process /about /contact /case-studies
```

**Cost intent:** Keep **one primary**:  
`/blog/french-drain-cost-central-florida-2026`  
→ Upgrade it (pricing table, local ranges, calculator later).  
**Do not** ship `/services/french-drain-cost` unless you 301 the blog or demote it.

**Yard grading:** Keep under yard-drainage unless SERP shows a distinct service-page pattern.

---

## 6. Keyword system (use this, not the invalid Tier-1 table)

### Cluster A — Money (local commercial)
Target on **service + city pages** + GBP:

| Seed | Primary page type |
|------|-------------------|
| french drain {city} | City hub + french-drains service |
| sump pump installation {city} | City + sump-pumps |
| yard drainage {city} | City + yard-drainage |
| drainage contractor {city} | City hub |
| french drain near me / drainage near me | GBP + Port Orange hub |

### Cluster B — Cost & commercial research
Target on **cost blog** (then calculator later):

| Seed | Page |
|------|------|
| french drain cost florida / central florida | cost blog |
| french drain cost per foot | cost blog section |
| sump pump cost florida | cost blog or sump service FAQ |

### Cluster C — Informational / AEO
Target on **blogs + answer blocks on services**:

| Seed | Page |
|------|------|
| french drain vs sump pump | existing vs post |
| yard flooding florida / standing water | existing + service FAQs |
| foundation drainage signs | existing post |
| sump pump battery backup hurricane | **new blog** |
| french drain mistakes | **new blog** |
| install french drain around foundation | **new blog** (how-to; E-E-A-T + CTAs) |

**Before writing each new URL:** open Google for the seed from an incognito + “Florida” context. Note: local pack? dominant page type? PAA? If SERP is 90% Map Pack + directories, invest in **GBP/reviews**, not a 2,000-word blog alone.

Re-validate volumes with DataForSEO/OpenSEO (national + Orlando DMA) before ranking “priority by volume.”

---

## 7. Phased roadmap

### Phase 0 — Unblock & measure (Week 1)

| # | Task | Owner | Done when |
|---|------|--------|-----------|
| 0.1 | **Cloudflare AI Crawl Control:** allow GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended (keep training-only blocks if desired) | Ops | Live `robots.txt` no longer Disallows those agents |
| 0.2 | Confirm Sitemap line still present after CF managed robots | Ops | `Sitemap: https://www.floguardfl.com/sitemap.xml` live |
| 0.3 | GSC property + sitemap submit + inspect top 10 money URLs | Marketing | All money URLs “Indexed” or clear fix path |
| 0.4 | Bing Webmaster import/submit sitemap | Marketing | Sitemap accepted |
| 0.5 | GA4: form submit + `tel:` click conversions | Dev | Events fire in DebugView |
| 0.6 | Spreadsheet: reviews, citations, AI monitor, ranks | Marketing | Sheet live with baselines |
| 0.7 | Snapshot GBP insights + review count/date | Marketing | Baseline row logged |

**Gate:** Do not start Phase 2 content scale until 0.1–0.5 are done.

---

### Phase 1 — Local dominance foundation (Weeks 1–4)

#### 1A. Google Business Profile (highest ROI)
Follow `docs/gbp-citations-checklist.md`. Minimum this month:

- [ ] Verified profile, correct primary category (**Drainage service** / closest accurate match)  
- [ ] Services listed with short descriptions  
- [ ] Service areas match real coverage  
- [ ] ≥20 real photos (before/after preferred)  
- [ ] 2 posts/week  
- [ ] Review request process after every job (SMS/email template)  
- [ ] Respond to every review ≤48h  

#### 1B. Multi-platform local entity
- [ ] **Bing Places** claimed + NAP match (ChatGPT/Copilot path)  
- [ ] **Apple Business Connect** claimed  
- [ ] Yelp, Angi, BBB, Facebook, Nextdoor business — exact NAP  
- [ ] Chamber (Volusia / Daytona) if eligible  

#### 1C. Crawlable money pages (technical)
Pick **one** path (do not boil the ocean):

| Option | When to use |
|--------|-------------|
| **A. Prerender.io / Cloudflare worker prerender** for bots | Fastest with current CRA |
| **B. Migrate money routes to Next.js SSR/SSG** | Best long-term; larger project |
| **C. Expand static HTML injection** for critical routes at build | Interim if A/B delayed |

**Scope for Phase 1:** `/`, 4 services, Port Orange, Daytona, cost blog.

Acceptance: `curl` (no JS) returns main H1 + ≥300 words of unique body text on those URLs (not only noscript stubs).

#### 1D. On-page GEO polish (money pages only)
On each money page:

- [ ] Definition / answer in first ~60 words  
- [ ] One **self-contained 134–167 word** answer block (cost, process, or “when you need X”)  
- [ ] Question-style H2s where natural  
- [ ] Visible FAQ (content first; schema optional)  
- [ ] CTA: free assessment + phone  
- [ ] Internal links: service ↔ 2–3 cities ↔ cost blog  

#### 1E. Schema polish
- [ ] `sameAs`: GBP, Facebook, Yelp, LinkedIn, YouTube (as they exist)  
- [ ] Geo coordinates ≥5 decimal places  
- [ ] Consistent Organization `@id` across pages  
- [ ] No fake ratings  

#### 1F. E-E-A-T light
- [ ] Author/About credentials page (real licensed/insured facts only)  
- [ ] Blog posts: byline + last updated date  

**Phase 1 exit criteria:**
- CF AI bots allowed  
- GBP posting + review engine running  
- Bing Places live  
- Money pages body-crawlable  
- GSC receiving data  

---

### Phase 2 — Expand content that can rank (Weeks 5–12)

#### 2A. City pages (4 new — only with proof)
Edgewater, DeBary, Lake Mary, Winter Park — each must include:

- Unique intro (local flooding/soil/HOA/neighborhood notes)  
- ≥1 real project story or photo if available (or honest “serving from Port Orange” + drive-time)  
- 3–4 local FAQs  
- Links to all 4 services  
- ≥500–600 words unique body  

If proof is thin: **list as service area on existing hubs** instead of thin URLs.

#### 2B. Four new blogs (SERP-checked)
1. French drain mistakes to avoid (Florida)  
2. Sump pump battery backup for Florida hurricanes  
3. How to install a french drain around a foundation (educational + hire CTA)  
4. French drain vs yard grading: what Florida homes need  

Each: answer-first, tables where useful, last-updated, link to services + cost.

#### 2C. Cost page upgrade (no second URL)
Enhance existing cost post:

- Pricing table (ranges you stand behind)  
- “What drives cost in Central Florida”  
- Per-foot ranges if accurate  
- FAQ block  
- Soft CTA every 1–2 screens  

#### 2D. YouTube (brand mentions)
- Channel: FloGuard Florida Drainage  
- 2–3 videos: job walkthrough, “why standing water,” sump test  
- Embed on matching service/blog pages  
- Description links to money URLs  

#### 2E. Community (no spam)
- Nextdoor: before/after, seasonal tips  
- Reddit: r/orlando, r/HomeImprovement — answer fully; brand only if natural  
- 1 local partnership outreach/week (inspectors, realtor, landscaper)  

**Phase 2 exit criteria:**
- 4 blogs live + cost upgraded  
- New cities only if unique  
- ≥15 new reviews vs Phase 1 start  
- Citation Tier-1 complete  
- First 3 YouTube videos  

---

### Phase 3 — Selective scale (Weeks 13–24)

#### 3A. Combo pages (selective)
Only if city hub shows GSC demand:

Start max **6**:
- `/areas/port-orange/french-drains`  
- `/areas/port-orange/sump-pumps`  
- `/areas/daytona-beach/french-drains`  
- `/areas/daytona-beach/sump-pumps`  
- `/areas/orlando/french-drains`  
- `/areas/orlando/yard-drainage`  

Each needs unique job/photo/neighborhood detail — not service text with city swapped.

#### 3B. Original data asset
“Central Florida Drainage Cost Notes 2026” (from real quotes ranges, anonymized):

- Publish as blog or `/resources/`  
- Table by job type  
- Citeable by AI and local media  

#### 3C. Links & “best of”
- Chamber, suppliers, local news tips  
- Pitch 5 “best drainage Central Florida” list owners  
- Target **quality referring domains**, not 100 directory spam links  

#### 3D. Measure & cut
- Kill or noindex any city page with 0 impressions after 90 days and no leads  
- Double down on pages with impressions but low CTR (title/meta)  

---

### Phase 4 — Authority (Months 7–12)

1. Interactive cost calculator (embed on cost page)  
2. Pillar: “Florida Home Drainage Guide” (2,500–4,000 words) linking all spokes  
3. More cities only if review density + jobs support them  
4. Quarterly full audit (technical + local + GEO)  
5. Optional: Next.js migration if still on fragile prerender  

---

## 8. Weekly operating rhythm

| Day | Habit |
|-----|--------|
| Mon | GSC: queries, pages, coverage errors (30 min) |
| Tue | GBP post + photo |
| Wed | 1 citation claim or NAP fix |
| Thu | Review requests for recent jobs; respond to all reviews |
| Fri | One content or internal-link improvement |
| Monthly | AI 15-query log; rank snapshot HQ cities; KPI row |

---

## 9. Page quality checklist (publish gate)

Before any new URL goes live:

- [ ] Primary intent and **one** primary keyword  
- [ ] SERP check: page type matches SERP  
- [ ] ≥ min words for type (service 800+, city 500–600+, blog 1,500+)  
- [ ] Unique vs other cities/services (swap test)  
- [ ] Answer-first intro + one citability block  
- [ ] Internal links in/out (≥3)  
- [ ] Schema valid JSON-LD  
- [ ] Mobile CTA phone works  
- [ ] In sitemap  
- [ ] GSC inspect after deploy  

---

## 10. Explicitly rejected tactics (from invalid draft)

| Rejected | Why | Do instead |
|----------|-----|------------|
| “AI crawlers already allowed” | CF blocks live | Fix CF first |
| Tier-1 volumes 0–15 as “high volume” | Bad data | Re-pull keywords |
| Full city×service matrix immediately | Doorway risk | Selective combos after proof |
| `/services/french-drain-cost` + cost blog | Cannibalization | One cost URL |
| Wikipedia company page | Notability fail | Local PR + directories + YouTube |
| FAQ schema as Google rich-results plan | Restricted for commercial | Visible FAQs + rankings |
| KPI 5k organic / 30 AI cites as baseline plan | Unrealistic | Leading indicators above |
| llms.txt as primary GEO lever | Not consumed by major AI search | Rank + mentions + crawl access |

---

## 11. First 14 days (print this)

**Day 1–2**
1. Cloudflare AI allowlist  
2. Verify live robots + sitemap  
3. GSC + Bing sitemap  

**Day 3–5**
4. GBP deep optimize + photo dump  
5. Bing Places + Apple Business Connect  
6. Review request template live  

**Day 6–10**
7. Choose prerender path; ship for `/` + french-drains  
8. sameAs + geo precision in schema  
9. Answer blocks on french-drains + cost blog  

**Day 11–14**
10. Prerender remaining money services + Port Orange + Daytona  
11. Yelp/Angi/BBB citations  
12. First GBP posts + first post-job review asks  
13. Baseline AI 15-query log  
14. Log KPI sheet row “Week 2”  

---

## 12. Success definition (90 days)

You are **on plan** if:

1. AI bots can crawl (no CF Disallow conflict)  
2. Money pages return real body HTML without JS  
3. GBP active (posts + review velocity)  
4. Bing Places + core citations live  
5. GSC shows rising impressions on brand + ≥1 non-brand service/city query  
6. ≥10 new reviews  
7. ≥2 new high-quality blogs or major cost upgrade shipped  
8. At least one tracked Map Pack improvement in HQ area **or** clear diagnosis (category, reviews, proximity)  

If 1–4 fail, stop expanding URLs and fix foundation.

---

## 13. Handoffs by role

| Role | Owns |
|------|------|
| Ops / Cloudflare | AI crawl, DNS, hosting headers |
| Dev | Prerender/SSR, GA4 events, schema, sitemap |
| Owner / field | Photos, reviews, accurate pricing ranges |
| Marketing | GBP, citations, content, outreach, weekly logs |

---

*This plan is intentionally conservative on page count and aggressive on local entity + crawl access. That is how local drainage businesses get phone calls—not by shipping 32 thin city×service URLs on a new domain.*
