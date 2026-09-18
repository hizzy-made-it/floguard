# FloGuard LLC — Product Requirements & Build Log

## Original Problem Statement
Premium, Awwwards-quality marketing website for **FloGuard LLC**, a residential flood & drainage
contractor in Central Florida (Port Orange / Daytona / Sanford / Orlando corridor). Must explain the
French drain → sump pump → safe discharge system, showcase before/after results, and drive homeowners
to request free on-site drainage assessments. Brand: deep navy + slate + safety-orange, cinematic dark
hero blending into a clean, trust-focused light body. Phone (386) 259-0023, 5.0 Google rating.

## User Choices (locked)
- Stack: **React (CRA) + FastAPI + MongoDB** (not Next.js), Framer Motion, React Three Fiber.
- Visual: **Blend** — cinematic dark 3D hero → clean light trust body.
- Leads: **saved to MongoDB + email via Resend** (Resend key pending from user; email skipped until then).
- Hero: **full interactive R3F 3D scene** (protected flowing channels).
- Scope: **all 6 pages** delivered.

## Architecture
- Frontend: React Router (6 routes) with AnimatePresence page transitions, Lenis smooth scroll,
  custom cursor, scroll progress bar, reusable `lib/animations.js` variant system.
- Design system: Clash Display (display) + Outfit (body); tokens in `tailwind.config.js` (brand.ink/
  surface/navy/slate/orange/lime); light theme HSL vars in `index.css`.
- 3D: `components/three/FlowHero.jsx` (transparent canvas over a cinematic CSS backdrop so the hero is
  premium even before WebGL paints) + `MiniShield.jsx` on Contact.
- Backend: `POST/GET /api/leads` (Mongo `leads`), Resend email best-effort (`send_lead_email`), status routes.

## Pages / Components implemented (2026-07-07)
- **Home**: 3D hero + CTAs, animated StatsBar counters, Problem section, How-It-Works FlowPath + diagram,
  ServicesGrid (asymmetric bento), dark ProcessTimeline, Testimonials carousel, embedded LeadForm, FinalCTA.
- **How It Works (/process)**: PageHero, FlowPath, engineered diagram feature, 4-step timeline.
- **Services (/services)**: PageHero, ServicesGrid, accordion detail, dark FlowPath.
- **Results (/case-studies)**: PageHero, filterable animated grid, modal with draggable before/after slider.
- **About (/about)**: PageHero, story, values grid, stats strip.
- **Contact (/contact)**: animated hero + MiniShield 3D, contact methods, multi-step LeadForm, Google map embed.
- Shared: Navbar (sticky, blur, hide-on-scroll, mobile menu), Footer (JSON-LD LocalBusiness in index.html).

## Status
- Testing agent iteration_1: **backend 100%, frontend 100%**.
- Added (2026-07-07, session 2): **Blog system** — `/blog` listing (featured post + category-filtered grid) and
  `/blog/:slug` article pages with read-progress bar, content-block renderer (h2/p/ul/quote), inline CTA,
  related posts, and per-post document.title for SEO. 8 SEO-keyword posts in `data/blog.js`, dated weekly
  (2026-05-18 → 2026-07-06). Verified rendering via content crawl.
- Elite UX layer: branded **intro Loader** (once/session, reduced-motion safe), **service-area Marquee** ticker
  on Home, custom cursor, scroll progress, magnetic-style CTA hovers. Nav extended to 7 links incl. Blog.

## Backlog / Next Action Items
- **P0**: Add real `RESEND_API_KEY` (+ verified sender/recipient) to enable lead-notification emails.
- **P1**: Real customer photos & Google reviews; swap placeholder testimonials/case-study copy.
- **P1**: Optional admin dashboard to view/manage submitted leads (`GET /api/leads` already exists).
- **P2**: Blog / service-area landing pages for local SEO; sitemap.xml + robots.txt.
- **P2**: Add @react-three/postprocessing bloom for extra hero glow (perf permitting).


## Session 3 additions (2026-07-07)
- **Local SEO**: `/areas` index + dynamic `/areas/:slug` city pages for 8 Central Florida cities (`data/cities.js`); "Areas" added to nav (8 links).
- **Lead engine**: JWT (Bearer/localStorage) admin auth — `/admin/login` + protected `/admin` dashboard (stats cards, searchable leads table, source filter, per-lead status update). Backend: `/api/auth/login`, `/api/auth/me`, protected `GET /api/leads`, `/api/leads/stats`, `PATCH /api/leads/{id}`; admin seed via `ADMIN_EMAIL` / `ADMIN_PASSWORD` env (never commit credentials).
- **Lead magnet**: "Florida Drainage Guide" auto-generated PDF, email-gated (`POST /api/guide`, `GET /api/guide/download` via reportlab); `GuideDownload` on Blog; leads saved source="guide".
- **Proof**: Google-style `GoogleReviews` section on Home.
- **Hero**: cinematic **video** scroll/scrub on Home (`hero.mp4` — locked creative). 3D marketing heroes removed.

- Testing iteration_2: **backend 100% (11/11), frontend 100%**. Fixed dashboard contrast; set CORS `allow_credentials=False` (Bearer-token app). Cleared all test/seed leads for a clean production start.

## Session 2026-09-16/17 — ops recovery + flood map (FSI) upgrades

**Ops findings (all fixed or awaiting owner action)**
- Supabase `floguard` (ref `gphlrnctrtbrpspmzaxw`) had auto-paused (free tier) → CRM login 500 "fetch failed". Restored 2026-09-16 17:29 EDT.
- 2026-09-17: same project hit `402 exceed_cached_egress_quota` → all PostgREST/Storage calls blocked, CRM login down again. **Owner action: upgrade to Pro or lift spend cap.** Pro also ends auto-pause.
- Cloudflare Pages skipped 3 commits (diffs outside `frontend/`). Owner retried from dashboard; live site verified. Set Build watch paths to `*`.
- Vercel `floguard-crm` Root Directory is `.` → every git deploy has failed for 56+ days; live CRM is a 56-day-old build. **Owner action: Settings → General → Root Directory = `floguard-crm`, redeploy.** `CRON_SECRET` already added to production env.
- `crm.floguardfl.com/crm/api/academy-auth` is the login probe; `{"error":"Invalid username or PIN."}` with status 401 means storage is reachable.

**Flood map improvements shipped (repo `floguard-crm/fsi/sql/005–010`, all applied to Supabase)**
- 005 Rainfall apply in SQL + Vercel cron `api/cron-rainfall.js` (county `rainfall_state`, Supabase keepalive). Not live until Root Directory fixed.
- 006 Must-Have rescore in SQL (`must_have_rescore()`, `must_have_runs` log). Applied by a Cowork session 2026-09-16 22:51 UTC; exported to repo 09-17.
- 007 `lead_outcomes` label stream + lot features from the Volusia appraiser via pg_net (Cowork session 09-16). API: `api/lead-outcomes.js` (record/list/readiness).
- 008 Hardscape term (`impervious_ratio`, `lot_sqft`) in the score. 13,387 parcels flagged `hardscape_pooling`. JS reference scorer updated; `fsi/tests/verify-mhs-*.mjs` prove JS == SQL (400 rows, 0 mismatches).
- 009 Per-cell rainfall: 157 × 0.05° cells, one Open-Meteo call via pg_net, `rainfall_cell.d` per parcel. First day: d 0.014–0.638 vs county 0.274.
- 015 Gold-segment basin rule (2026-09-17 22:39 EDT, runs 9–10): gold = zone X and ((clay and (heat ≥ 0.35 or bowl ≥ 0.5 m)) or bowl ≥ 1 m). First pass kept the clay gate and inland basins (all HSG A sand) still got 0; second pass (migration gold_segment_deep_basin) lets ≥1 m bowls in regardless of soil. Now 8,714 parcels are gold via basin (1,915 Orange City, 1,588 Deltona, 507 DeBary) but they land in `maybe` (scores ~58), not must/should (cut 68.7): countywide percentile cuts + coastal claim heat/capacity still win. Open decision: per-market bands (top 3% within each city/zip) vs bigger basin bonus vs accept maybe. Cuts must ≥76.1 / should ≥68.7 / maybe ≥52.3; bands must 7,879 · should 31,494 · maybe 65,032 · skip 207,876.
- 014 Weight rebalance (2026-09-17 22:14 EDT, run 8): static DEPR 0.20 (TWI 0.30, HAND 0.20, HSG 0.15, zone 0.15); MHS claim heat 0.12, risk 0.38. Cuts must ≥76.0 / should ≥68.2 / maybe ≥51.3; bands must 7,943 · should 31,195 · maybe 65,708 · skip 207,435. Must band avg depr_n 0.147 → 0.239. DeLand 32720/32724 went 2 → 98 must, 0 → 1,118 should. Orange City 32763, Deltona 32725, DeBary 32713 still ~0: the `gold_segment` +14 bonus requires claim_heat ≥ 0.35 and inland heat is 0.25–0.28. Next lever if wanted: gold = zone X + clay + (heat ≥ 0.35 OR depr_n ≥ 0.5).
- 013 Closed-basin term (2026-09-17 20:44 EDT, run 7): `depr_m` = filled − raw DEM per parcel, weight 0.10 in static score (TWI 0.35, HAND 0.20, DEPR 0.10, HSG 0.20, zone 0.15). Cuts must ≥80.4 / should ≥71.9 / maybe ≥53.6; bands must 7,893 · should 31,237 · maybe 65,216 · skip 207,935. Measures the right thing (Orange City 31%, DeLand 28%, Deltona 15% bowl parcels vs coast 4–6%) but west Volusia still ~0% must/should because claim heat (0.20 in MHS, coastal NFIP data) dominates. Open decision: raise DEPR to 0.20 and/or cut claim-heat weight, or wait for outcomes.
- 012 Batched recompute (`fsi_static_batch`, `must_have_cuts`, `must_have_apply_batch`): the free-tier DB disk filled during the one-shot recompute; run batches via MCP with `vacuum` between (pg_cron wraps multi-statement commands in one transaction, so VACUUM cannot go there). Verified 2026-09-17 22:24 UTC: run 6, 257,723 rows rescored, cuts must ≥81.4 / should ≥72.6 / maybe ≥54.5, bands must 7,822 · should 31,556 · maybe 64,861 · skip 208,042. Must band turned over ~36% (2,796 out, 2,784 in). Must band now has the lowest HAND (0.06) and highest static score — terrain drives it.
- 011 Real terrain: TWI/HAND per parcel from USGS 3DEP 10 m, pipeline `fsi/pipeline/terrain_run.py`, data in `fsi/releases/terrain-2026-09-17/` (committed, public-record derived), loaded by pg_net. Requires ~4 GB free disk; C: was at 99%.
- 010 Post-storm dial list: `storm_cells()`, `storm_dial_list()`, map API action `storm`.
- Daily pg_cron chain (UTC): `rain_fetch_enqueue` 11:00 → `rain_fetch_process` 11:10 → `fsi_daily` 12:00 (`fsi_apply_dynamic_cells` + `must_have_rescore`).

**Improvement list status**
1 calibration on closed jobs — waiting on outcomes (0 rows). 2 real terrain — done 2026-09-17 at 10 m (3DEP 1/3 arc-sec, `terrain_run.py`, sql/011); old DEM-lite proxies were noise (corr 0.03/0.07). 1 m LiDAR still open. 3 per-cell rainfall — done. 4 post-storm lists — done (API; no UI button yet). 5 imagery — not started. 6 lot features — done. 7 outcome capture — table + API done, no CRM form. 8 rebanding after rainfall — done.

**Gotchas**
- Supabase free-tier DB disk: parcel_risk is ~590 MB (over the 500 MB plan limit). Any full-table UPDATE needs a second copy of the rows → 'No space left on device'. Use the 012 batch functions with VACUUM between; drop the four unused indexes (geom, fsi_live, city, impervious; ~170 MB) if owner allows.
- Supabase MCP `execute_sql` times out ~60–90 s; anything touching all 312k rows (`must_have_rescore` ~2 min, `fsi_daily` ~4 min) must run via pg_cron. `cron.unschedule` on a running one-off job **cancels it** — schedule at a fixed minute and unschedule only after `cron.job_run_details` shows success.
- Scoring lives in two places that must agree: `scripts/lib/fsi-score.mjs` and `fsi/sql/006`+`008`.
