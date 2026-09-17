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
- 010 Post-storm dial list: `storm_cells()`, `storm_dial_list()`, map API action `storm`.
- Daily pg_cron chain (UTC): `rain_fetch_enqueue` 11:00 → `rain_fetch_process` 11:10 → `fsi_daily` 12:00 (`fsi_apply_dynamic_cells` + `must_have_rescore`).

**Improvement list status**
1 calibration on closed jobs — waiting on outcomes (0 rows). 2 LiDAR TWI/HAND — not started (`pipeline/terrain.py` scaffold). 3 per-cell rainfall — done. 4 post-storm lists — done (API; no UI button yet). 5 imagery — not started. 6 lot features — done. 7 outcome capture — table + API done, no CRM form. 8 rebanding after rainfall — done.

**Gotchas**
- Supabase MCP `execute_sql` times out ~60–90 s; anything touching all 312k rows (`must_have_rescore` ~2 min, `fsi_daily` ~4 min) must run via pg_cron. `cron.unschedule` on a running one-off job **cancels it** — schedule at a fixed minute and unschedule only after `cron.job_run_details` shows success.
- Scoring lives in two places that must agree: `scripts/lib/fsi-score.mjs` and `fsi/sql/006`+`008`.
