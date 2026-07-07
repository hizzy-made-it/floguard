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
- **Lead engine**: JWT (Bearer/localStorage) admin auth — `/admin/login` + protected `/admin` dashboard (stats cards, searchable leads table, source filter, per-lead status update). Backend: `/api/auth/login`, `/api/auth/me`, protected `GET /api/leads`, `/api/leads/stats`, `PATCH /api/leads/{id}`; idempotent admin seed. Admin: admin@floguardfl.com / FloGuard2026!.
- **Lead magnet**: "Florida Drainage Guide" auto-generated PDF, email-gated (`POST /api/guide`, `GET /api/guide/download` via reportlab); `GuideDownload` on Blog; leads saved source="guide".
- **Proof**: Google-style `GoogleReviews` section on Home.
- **Elite polish**: cinematic Bloom postprocessing on the 3D rain/water hero.
- Testing iteration_2: **backend 100% (11/11), frontend 100%**. Fixed dashboard contrast; set CORS `allow_credentials=False` (Bearer-token app). Cleared all test/seed leads for a clean production start.
