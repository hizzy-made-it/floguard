# FloGuard off-site priority plan (highest leverage now)

On-site is **technically clean enough**. Ranking and AEO gains now come mostly from **entity, trust, and local authority** — not more meta tags.

Work top-down. Do not skip GBP for content rewrites.

---

## P0 — Google Business Profile + reviews (biggest / fastest)

**Owner:** business ops · **Cadence:** daily until 15+ reviews, then weekly

### Profile setup (one-time)
1. Claim/verify GBP at **5114 S Ridgewood Ave, Port Orange, FL 32127** → [business.google.com](https://business.google.com)
2. Primary category: **Drainage contractor** (or closest Google allows)
3. Secondary: landscaping / waterproofing / excavation-adjacent only if accurate
4. Services with short descriptions: French drain, sump pump, yard drainage, pump maintenance
5. Hours, phone `(386) 259-0023`, website `https://www.floguardfl.com`
6. **20+ photos**: before/after, crew, equipment, finished yards (use real job shots)
7. Service area: Port Orange, Daytona Beach, New Smyrna, Ormond, Sanford, Orlando corridor, etc.
8. Attributes: licensed/insured/warranty if true

### Reviews engine (highest ROI)
| Action | Target |
|--------|--------|
| Ask every happy customer same day (text + link) | 100% of completed jobs |
| Respond to every review within 48h | 100% |
| Goal | 15 reviews in 30 days, then 1–2/week ongoing |
| Minimum for schema credibility | Keep site `COMPANY.reviewCount` in sync with real Google count |

**SMS template (edit freely):**
> Hi [Name] — glad we got your yard dry. If you have 60 seconds, a Google review helps neighbors find us: [YOUR SHORT GBP REVIEW LINK]. Thank you — FloGuard

**Never** buy reviews or use gated “only 5-stars go to Google” flows.

### Weekly GBP hygiene
- 2–3 posts (before/after, storm tip, FAQ)
- Seed Q&A from site FAQs
- Reply to messages same day

Full checklist: `docs/gbp-citations-checklist.md`

---

## P0 — Fix “0★” on site (shipped in code)

Stats bar now shows **static real numbers** (100+, 5.0★, 24hr, 5yr) with **no count-up from zero**. Deploy with the next frontend push.

Keep `COMPANY.rating` / `COMPANY.reviewCount` accurate when Google reviews grow.

---

## P1 — Search Console for **floguardfl.com** (not hdconnex.com)

**Owner:** whoever owns Google accounts

1. Open [Google Search Console](https://search.google.com/search-console)
2. Add property: **Domain** `floguardfl.com` *or* URL-prefix `https://www.floguardfl.com`
3. Verify (DNS TXT at registrar/Cloudflare is preferred for domain property)
4. Submit sitemap: `https://www.floguardfl.com/sitemap.xml`
5. Confirm preferred host (www vs non-www) matches production redirects

### Pull real data (paste into chat or share access when ready)
| Report | What we need |
|--------|----------------|
| **Indexing → Pages** | Indexed vs not, reasons |
| **Links** | Top linking sites, top linked pages, external count |
| **Performance** | Queries, pages, CTR (28d / 3m) |
| **URL Inspection** | Sample: `/`, `/services/french-drains`, `/areas/orlando`, cost blog |

Until this is done, **backlink numbers are guesses**. Do not prioritize Ahrefs until GSC Links is open.

---

## P1 — Local citations + `sameAs` entity graph

### Exact NAP (copy-paste everywhere)
```
FloGuard, LLC
5114 S Ridgewood Ave
Port Orange, FL 32127
(386) 259-0023
https://www.floguardfl.com
```

### Citation order (first 15)
1. Google Business Profile  
2. Bing Places  
3. Apple Business Connect  
4. Yelp  
5. Angi  
6. BBB (if eligible)  
7. Facebook Business Page  
8. Nextdoor Business  
9. Thumbtack  
10. MapQuest / Apple Maps consistency  
11. Volusia County Chamber  
12. Daytona Beach Chamber  
13. HomeAdvisor / Angi network (careful of paid)  
14. Florida contractor / home-services directories (reputable only)  
15. Houzz (if category fits)

### Track
Spreadsheet columns: Directory | Status | Live URL | Date | NAP match Y/N | Notes

### Sync site schema when live
Add every **public profile URL** to `COMPANY.sameAs` in `frontend/src/data/site.js`:

```js
sameAs: [
  "https://www.google.com/maps/...",  // or GBP share URL
  "https://www.facebook.com/...",
  "https://www.yelp.com/biz/...",
  "https://www.linkedin.com/company/...",
  // etc.
],
```

Redeploy frontend after updates. Empty/fake sameAs is worse than incomplete real ones.

---

## P2 — Expand money pages (1,000+ localized words + real photos)

| Page type | Target | Content recipe |
|-----------|--------|----------------|
| Each service | 1,000–1,200 words | Process, materials, FL soil/water table, pricing signals, FAQs, CTAs |
| Each city | 1,000–1,200 words | Local problems, neighborhoods, soil/flood patterns, 1–2 mini case notes, city FAQs |
| Photos | Real jobs | Before/after per city or service; unique alt text; no stock if possible |

**Order:** french-drains → sump-pumps → Port Orange → Daytona → Orlando → other services/cities.

Do **not** Mad-Lib the same paragraph across cities. Quality > page count.

Briefs live under `docs/content-briefs.md` when written.

---

## P2 — 10–20 genuine local backlinks (90 days)

Strategy detail: `docs/offpage-link-strategy.md`

### First 20 targets (examples — personalize)
1. Volusia / Daytona / Port Orange chamber directories  
2. Local realtor partner resource pages  
3. Home inspector “preferred vendor” lists  
4. Property manager vendor lists (Orlando / Volusia)  
5. Neighborhood / HOA newsletters (sponsored or featured)  
6. Local news storm/flood feature (expert quote)  
7. Florida home / DIY blogs guest post (1–2)  
8. Sponsorship of local sports / school / charity (with link)  
9. Supplier or manufacturer “find a contractor”  
10. University / civic stormwater education links (harder, high trust)

**Rules:** relevant, local, editorial when possible; natural anchors (“French drain installation Port Orange”, brand, naked URL mix). No PBNs, no bulk link packages.

Track: Source | URL | Anchor | Target page | Date | Status

---

## 30-day scoreboard

| Week | Must ship |
|------|-----------|
| **1** | GBP live + optimized; review request system; GSC verified + sitemap; deploy counter fix |
| **2** | 5+ Google reviews; 8 citation claims; Facebook page live → sameAs update |
| **3** | 10+ reviews; 15 citations; 3 local link outreach sent; french-drains to 1k words |
| **4** | 15+ reviews; 2–3 acquired links; Port Orange + Daytona pages expanded; GSC Links export |

---

## What *not* to do next

- More on-site SEO plugins / meta churn  
- Buying links or fake reviews  
- 50 thin city pages without unique content  
- Analyzing backlinks on **hdconnex.com** GSC by mistake  

---

## Hand-off for AI / developer help

When ready, say one of:
- “GSC is open for floguardfl.com — read Links / Indexing”
- “Here are live profile URLs — update sameAs”
- “Expand french-drains / Orlando to 1000 words with this job notes: …”
- “Draft 10 chamber/realtor outreach emails”
