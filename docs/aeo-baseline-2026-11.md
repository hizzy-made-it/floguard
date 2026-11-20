# AEO / AI-Citation Baseline — November 2026

**Date:** 2026-11-19
**Query set:** The fixed 15-query AI monitor set from [`SEO-EXECUTION-PLAN.md`](./SEO-EXECUTION-PLAN.md) §3 (unchanged, so month-over-month runs stay comparable).
**Target:** floguardfl.com (FloGuard LLC, 5114 S Ridgewood Ave, Port Orange, FL 32127)

---

## 1. Method

Each of the 15 queries was run through two web-search back ends, used as a **proxy** for the retrieval layer AI answer engines draw from:

| Engine | What it approximates | Settings |
|--------|----------------------|----------|
| **A: WebSearch** (Claude web search tool) | A non-Google index, likely close to what Bing-grounded engines (ChatGPT search, Copilot) retrieve | Default, no location |
| **B: Firecrawl search** | Google-style organic results | `location = Port Orange, Florida, United States`, top 10 |

For each query we recorded: whether floguardfl.com appears in the top 10 (and at what position), the top 5 domains, and which source type dominates (directory/aggregator vs. local contractor site vs. UGC/forum vs. publisher).

Brand checks were also run: `FloGuard LLC Port Orange`, `FloGuard drainage`, `floguardfl.com`, `"floguardfl.com" OR "FloGuard LLC"`, `FloGuard Port Orange FL drainage`.

### Honest limitations

- **This is a search-results proxy, not real AI answers.** It does not show what ChatGPT, Perplexity, Gemini or Google AI Overviews actually say or cite. Those engines rewrite queries, add their own retrieval and personalize by location. **The real check must be re-run by hand in a browser every month** (see §5 template). Treat these numbers as "eligible to be cited," not "cited."
- Neither tool renders the Google Map Pack, the Knowledge Panel or AI Overviews, so **GBP and Knowledge Panel visibility could not be checked directly**. Check those by hand (incognito, Port Orange location).
- Query 13 ("drainage contractor near me") depends on device location. The Firecrawl location setting did not localize it (it returned national results), and WebSearch was run as "drainage contractor near me Port Orange FL." Re-check it on a phone in Port Orange.
- Rankings change from day to day. One snapshot is noisy, so judge trends over at least 3 monthly runs.

---

## 2. Results

**floguardfl.com in top 10: Engine A = 0 / 15 · Engine B = 4 / 15**

| # | Query | FloGuard present? (A / B) | Top 5 domains (B: Google-style; A where different) | Dominant source type |
|---|-------|---------------------------|----------------------------------------------------|----------------------|
| 1 | french drain cost central florida | N / N | B: civilsmart.us, frenchdrainguys.com, facebook.com (group), reddit.com, citydeskorlando.com · A: homeyou.com, angi.com, citruslandscapesolutions.com, homeblue.com, contractorplus.app | Cost guides (contractor blogs + aggregators) |
| 2 | french drain installation port orange | N / **Y #3** (/areas/port-orange) | B: yelp.com, facebook.com (group), **floguardfl.com**, angi.com, exoticdesignslandscaping.com (also frenchdrainguys FB/Thumbtack, thefrenchdrainpros.us, treeoflifelandscape.com) · A: thumbtack.com, angi.com, homeblue.com, contractorplus.app, homeadvisor.com | Directories + local contractors |
| 3 | french drain daytona beach | N / N (site). FloGuard **Facebook page** at B #7 and #10 | B: frenchdrainsdaytonabeach.com, yelp.com, thefrenchdrainpros.us, instagram.com, ericlundslandscaping.com · A: angi.com, homeadvisor.com, bbb.org, zoomdrain.com, daytonabeach.gov | Local contractors (B) / directories (A) |
| 4 | sump pump installation central florida | N / N | B: bsp1plumbing.com, angi.com, delair.com, facebook.com, ptpflorida.com · A: icebergcooling.com, homeadvisor.com, wrenvironmental.com, delair.com, angi.com | Plumbers (Orlando, Tampa) + directories |
| 5 | yard drainage orlando | N / N | B: samsfrenchdrains.com, drainagesolutionsfl.com, yelp.com, gowiththeflowdrainage.com, reddit.com · A: angi.com, mynews13.com, homeadvisor.com, match.angi.com, pages.dev spam | Orlando local contractors (FloGuard is not an Orlando player, so this is expected) |
| 6 | how much does a french drain cost in florida | N / N | B: frenchdrainguys.com, civilsmart.us, reddit.com, structuresmart.us, joinbreasy.com · A: homeyou.com, homeblue.com, contractorplus.app | Cost guides + aggregators |
| 7 | french drain vs sump pump florida | N / **Y #9** (/blog/french-drain-vs-sump-pump) | B: bullfrogwaterproofing.com, foundationrestoration.com, reddit.com, quora.com, doityourself.com · A: angi.com, rainbowrestores.com, ehow.com, homeserve.com, alphafoundations.com | Explainer blogs + forums |
| 8 | best drainage contractor port orange | N / N | B: yelp.com, facebook.com (group), floridaaquasolutions.com, angi.com, rotorooter.com (+ exoticdesignslandscaping.com, treeoflifelandscape.com #10) · A: bbb.org, homeadvisor.com, angi.com, match.angi.com, thumbtack.com | **Directories** (Yelp, Angi/HomeAdvisor, BBB) + FB groups |
| 9 | standing water in yard florida high water table | N / **Y #7** (/blog/why-is-water-standing-in-my-yard) | B: structuresmart.us, mikesbackyardnursery.com, reddit.com, facebook.com, rockledgegardens.com · A: wuft.org, groundlogicfl, masseyservices.com, puroclean.com, business.google.com | Explainer blogs + forums |
| 10 | battery backup sump pump hurricane florida | N / N | B: gutterproflorida.com, donovanac.com, aspsuperhome.com, reddit.com (×2) · A: mrrooter.com, rotorooter.com, supplyhouse.com | Plumbers/vendors + Reddit |
| 11 | wet crawl space drainage florida | N / N | B: lrefoundationrepair.com, doityourself.com, reddit.com, luxcandoflorida.com, basementsystems.com · A: basementsystems.com (most of top 10), alphafoundations.com | Foundation-repair networks |
| 12 | french drain cost per foot florida | N / N | B: civilsmart.us, frenchdrainguys.com, reddit.com, facebook.com, joinbreasy.com · A: homeblue.com (most of top 20), homeyou.com | Cost guides + aggregators |
| 13 | drainage contractor near me (Port Orange) | N / N | B (not localized): yelp.com, thumbtack.com, angi.com, yellowpages.com, bbb.org (Daytona) · A: bbb.org, match.angi.com, homeadvisor.com, angi.com, thumbtack.com | **Directories** (almost all) |
| 14 | sump pump maintenance florida | N / N | B: phixser.com, thecleanplumbers.com, cgchomeservices.com, yelp.com, wrenvironmental.com · A: instaservice.com (×9), mrrooter.com, atozstatewideplumbing.com | Plumbers + programmatic service pages |
| 15 | does a french drain add home value | N / **Y #2** (/blog/does-french-drain-add-home-value) | B: reddit.com, **floguardfl.com**, usnews.com, coralandscape.com, drainageanderosion.com · A: wtop.com, keathleylandscaping.com, gardengatemagazine.com, bobvila.com, leafhome.com | Publishers + contractor blogs |

### Competitors from prior work: sightings

| Competitor | Seen? |
|------------|-------|
| treeoflifelandscape.com | Yes. B #9 (Q2, DeLand French drain page), B #10 (Q8, /drainage/port-orange/) |
| French Drain Guys (frenchdrainguys.com + FB + Thumbtack) | Yes, frequently. Cost pages #1–2 on Q1, Q6, Q12; Thumbtack/FB on Q2 and Q8 |
| keyfrenchdraininstallation, coastaldevelopmentfl, strivedrainage, 904generalcontractors | Not seen in either engine's top 10–20 for this set |
| Newly seen local rivals | frenchdrainsdaytonabeach.com (Q3 #1), exoticdesignslandscaping.com (Port Orange), ericlundslandscaping.com (Volusia), thefrenchdrainpros.us, floridaaquasolutions.com, civilsmart.us / structuresmart.us (statewide cost content) |

---

## 3. Brand visibility

| Check | Result |
|-------|--------|
| `FloGuard LLC Port Orange` (A) | **Not found.** Results are other Port Orange businesses. |
| `FloGuard drainage` (A) | **Not found.** The name collides with "Flood Guard" / "Flood-Guard" plumbing products and Basement Systems "WaterGuard." |
| `floguardfl.com` (A) | **Not found.** Results are unrelated FL insurance pages. **Engine A appears not to have indexed the domain.** If Engine A tracks Bing, ChatGPT and Copilot may not be able to retrieve the site at all. See action 1. |
| `FloGuard Port Orange FL drainage` (B) | Found: facebook.com/FloGuardLLC #1, MapQuest listing #3, floguardfl.com/areas #4, Yelp search page mentions "FloGuard – French Drain near me – Port Orange" #6 |
| GBP / Knowledge Panel | **Could not be verified with these tools** (no Map Pack or Knowledge Panel rendering). Check by hand. |

**Third-party listings that mention FloGuard (found):**

1. Facebook Page: facebook.com/FloGuardLLC (labeled "Daytona Beach FL" with ZIP 32127. **NAP mismatch**: the address is Port Orange 32127)
2. MapQuest: FloGuard, 5114 S Ridgewood Ave, Port Orange, FL 32127
3. Yelp: appears in the "French Drain near Port Orange" search results
4. The Landscape Connection: thelandscapeconnection.com/places/floguard-llc (0 reviews, phone 13862590023)
5. Florida Sunbiz: FLOGUARD LLC, L25000491117, Active
6. hdconnex.com/blog/floguard-build-story (agency case study, which links back)
7. Facebook group post (Volusia County Flood Impact Alert thread) where FloGuard LLC commented

**Not found:** Angi, HomeAdvisor, BBB, Thumbtack, Nextdoor, Houzz, YellowPages. These are the directories that dominate the "best / near me / Port Orange" queries.

---

## 4. Which sources feed the answers (citation priority order)

Domain frequency across the 15 queries (count = number of queries where the domain appeared in an engine's top 10, both engines summed, max 30):

| Rank | Domain | Count | Type | FloGuard listed? |
|------|--------|-------|------|------------------|
| 1 | angi.com (+ homeadvisor.com, same company) | 12 (+6 = 18) | Directory | No |
| 2 | facebook.com (groups + pages) | ~10 | Social/UGC | Page yes; groups no presence |
| 3 | youtube.com | ~10 | Video | No |
| 4 | reddit.com | 9 | Forum/UGC | No |
| 5 | yelp.com | 6 | Directory | Yes (listing exists) |
| 6 | rotorooter.com | 6 | National brand | n/a |
| 7 | bbb.org (Port Orange / Ormond / Daytona drainage categories) | 5 | Directory | No |
| 8 | homeyou.com / homeblue.com / contractorplus.app | 4–5 each | Cost aggregators | n/a (can't list) |
| 9 | thumbtack.com | 4 | Directory | No |
| 10 | floguardfl.com | 4 | Own site | — |

**Pattern:**
- **"Who should I hire" queries (Q2, Q3, Q8, Q13)** are answered from **directories** (Yelp, Angi/HomeAdvisor, BBB, Thumbtack) plus **Facebook neighborhood groups**. FloGuard is missing from most of them.
- **"How much / why / vs" queries (Q1, Q6, Q7, Q9, Q12, Q15)** are answered from **contractor blog guides plus Reddit**. FloGuard's blog already wins 3 of these on Google-style results, which shows the content strategy works.
- **Statewide cost queries** are held by programmatic aggregators (homeblue, homeyou) on Engine A and by statewide cost guides (civilsmart, frenchdrainguys, structuresmart) on Engine B.

### Citation priority order (do in this order)

1. **Bing Webmaster Tools + IndexNow.** Submit the sitemap and verify the domain. Engine A could not find floguardfl.com even by exact domain, and fixing a Bing index gap is the cheapest unlock for ChatGPT and Copilot. (Hypothesis: confirm with a `site:floguardfl.com` search on bing.com.)
2. **Angi / HomeAdvisor**: one Angi Pro profile feeds both. It appears on 8 of 15 queries in Engine A.
3. **Yelp**: the listing exists. Complete it (categories: Landscaping → Drainage, Waterproofing), add photos, and collect reviews.
4. **BBB** listing in "Drainage Contractors," Port Orange. Its category pages rank for Q3, Q8 and Q13.
5. **Facebook**: fix the Page city to Port Orange (NAP). Answer neighbor recommendation threads in Port Orange / Daytona groups, which ranked #2 on Q2 and Q8.
6. **Thumbtack**: free listing.
7. **Reddit / YouTube**: helpful, non-spammy answers in r/florida / r/daytonabeach and short install videos. These feed the informational queries.
8. **Google Business Profile**: still the #1 lever for Map Pack ([`gbp-checklist.md`](./gbp-checklist.md)), but it could not be measured here.
9. **Content gaps to close on-site**: a Florida-wide **cost-per-foot** answer block (Q1, Q6, Q12), **battery-backup / hurricane** (Q10), **crawl space** (Q11) and **sump maintenance** (Q14), each with answer-first copy and FAQ schema.

---

## 5. Monthly re-run log (template)

Run on the **third Thursday** of each month. Use a browser in incognito with location set to Port Orange, FL, and do not sign in. For each query, record whether FloGuard is **cited** (linked as a source), **mentioned** (named, no link) or **absent**.

Codes: `C` = cited with link · `M` = mentioned by name · `—` = absent · `#n` = position in the source list / organic rank

### Run: YYYY-MM-DD · run by: ______

| # | Query | ChatGPT (search on) | Perplexity | Gemini | Google AIO | Google organic # | Map Pack? | Sources cited instead (top 3) |
|---|-------|---------------------|-----------|--------|------------|------------------|-----------|-------------------------------|
| 1 | french drain cost central florida | | | | | | | |
| 2 | french drain installation port orange | | | | | | | |
| 3 | french drain daytona beach | | | | | | | |
| 4 | sump pump installation central florida | | | | | | | |
| 5 | yard drainage orlando | | | | | | | |
| 6 | how much does a french drain cost in florida | | | | | | | |
| 7 | french drain vs sump pump florida | | | | | | | |
| 8 | best drainage contractor port orange | | | | | | | |
| 9 | standing water in yard florida high water table | | | | | | | |
| 10 | battery backup sump pump hurricane florida | | | | | | | |
| 11 | wet crawl space drainage florida | | | | | | | |
| 12 | french drain cost per foot florida | | | | | | | |
| 13 | drainage contractor near me (Port Orange device) | | | | | | | |
| 14 | sump pump maintenance florida | | | | | | | |
| 15 | does a french drain add home value | | | | | | | |

**Brand check:** In ChatGPT and Perplexity, ask "Who is FloGuard LLC in Port Orange FL?" Is the answer correct (NAP, services)? ______

**Summary row**

| Month | AI mention rate (any engine C/M, /15) | ChatGPT | Perplexity | Gemini | AIO | Organic top-10 /15 | New listings live | Notes |
|-------|----------------------------------------|---------|-----------|--------|-----|--------------------|-------------------|-------|
| 2026-11 (proxy baseline) | n/a (proxy only) | — | — | — | — | 4 (Engine B); 0 (Engine A) | FB, Yelp, MapQuest, Landscape Connection | Baseline from search proxies; first in-browser run due Dec 2026 |
| 2026-12 | | | | | | | | |
| 2027-01 | | | | | | | | |
| 2027-02 | | | | | | | | |

KPI targets (from the execution plan): Month 3 = 1–3 yes · Month 6 = 4–8 · Month 12 = 8–12.
