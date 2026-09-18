# FloGuard FSI — Flood Susceptibility Index

Implementation of `../docs/FLOOD-SUSCEPTIBILITY-INDEX.md`. Read the spec first;
it holds the reasoning, this file holds the mechanics.

**Nothing here has been run against real data yet.** The scoring math is
implemented and testable; the raster pipeline is a scaffold.

---

## Shape

Three tiers, split by update cadence. The split is what makes this buildable.

| Tier | Runs | Where | Code |
|---|---|---|---|
| Static terrain | Once per data refresh | Offline, your machine | `pipeline/terrain.py` |
| Rainfall | Daily | Cron | `pipeline/rainfall.py` |
| Map read | Per request | Vercel function | `../api/fsi-parcels.js` |

Per-parcel TWI over LiDAR cannot run inside a serverless function per request.
It runs offline; the map reads indexed rows only. Do not put scoring logic in
the request path.

## Build state

Live Supabase project `floguard` (ref `gphlrnctrtbrpspmzaxw`). Updated 2026-09-17.

| Piece | State |
|---|---|
| `sql/001` `parcel_risk` + `rainfall_state` | Applied 2026-07-21. **312,281 Volusia parcels** ingested |
| `sql/004` must-have + appraiser columns | Applied 2026-07-21 |
| `sql/005` rainfall apply in SQL | Applied 2026-09-16. `fsi_apply_dynamic()`; county-level `rainfall_state.d` from the Vercel cron |
| `sql/006` must-have rescore in SQL | Applied 2026-09-16. `must_have_raw()` / `must_have_rescore()`, change-only writes, `must_have_runs` log |
| `sql/007` lead outcomes + lot features | Applied 2026-09-16. `lead_outcomes` label stream (0 rows yet); lot features loaded from the appraiser ArcGIS layer via pg_net (lot 238k, footprint 250k, impervious 190k) |
| `sql/008` hardscape term | Applied 2026-09-17. `impervious_ratio` / `lot_sqft` in the score; reason `hardscape_pooling` (13,387 parcels) |
| `sql/013` closed-basin term | Applied 2026-09-17. `depr_m`/`depr_n` (filled − raw DEM, `pipeline/depression_run.py`), weight 0.10 in `fsi_static_expr()`. 38.6% of parcels sit in a depression. Orange City / DeLand / Deltona zips are 15–31% bowl parcels vs 4–6% on the coast, but bands barely moved there: claim heat (coastal NFIP) and the 0.10 weight outweigh it. Weight question for calibration |
| `sql/012` batched recompute | Applied 2026-09-17. `fsi_static_batch(b)`, `must_have_cuts()`, `must_have_apply_batch(run,b)`; run one call at a time with `vacuum parcel_risk` between — the free-tier disk cannot hold a second copy of the table |
| `sql/011` terrain load + static recompute | Applied 2026-09-17. `terrain_apply_csv()`, pg_net loader, `fsi_recompute_static()` |
| `sql/009` per-cell rainfall | Applied 2026-09-17. 157 × 0.05° cells, one Open-Meteo request via pg_net, `rainfall_cell.d` per parcel with county fallback |
| Terrain (`twi_n` / `hand_n`) | **Real, 2026-09-17**: USGS 3DEP 1/3 arc-second (10 m), `pipeline/terrain_run.py` (UTM 17N, Wang & Liu fill, D-inf SCA, HAND). 313,487 parcels. The previous DEM-lite proxies correlated 0.03 / 0.07 with these values, i.e. noise. Loaded via `sql/011` pg_net path from `fsi/releases/terrain-2026-09-17/`. 1 m LiDAR is the next step up |
| `../api/cron-rainfall.js` | Vercel cron 10:00 UTC. County `rainfall_state` + Supabase keepalive. **Not deployed** until the Vercel project Root Directory is `floguard-crm` |
| `../api/fsi-parcels.js` | Serving the map panel; exposes lot + hardscape columns |
| Map panel in the CRM | Live at `crm.floguardfl.com/crm/` |

Daily chain, all pg_cron (UTC): `rain_fetch_enqueue` 11:00 → `rain_fetch_process` 11:10 →
`fsi_daily` 12:00 (`fsi_apply_dynamic_cells()` then `must_have_rescore()`).
`select * from cron.job_run_details order by start_time desc limit 5` shows each run.
pg_cron sessions carry a 2-minute `statement_timeout`; every job command starts with
`set statement_timeout = ...;` because a `SET` inside a function cannot re-arm a running statement.
Anything over ~60 s cannot run through the Supabase MCP `execute_sql` either — schedule it.

Scoring lives in two places that must agree: `scripts/lib/fsi-score.mjs` (reference) and
`sql/006` + `sql/008` (what runs). `tests/verify-mhs-sql.mjs` checks them against each other;
`tests/verify-mhs-json.mjs` does the same from an exported JSON when PostgREST is unreachable.

## Setup

```bash
cd fsi
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
psql "$DATABASE_URL" -f sql/001_parcel_risk.sql
psql "$DATABASE_URL" -f sql/002_seed_fixtures.sql   # optional: synthetic map data
# If PostGIS was already installed into public (Supabase linter WARNs):
psql "$DATABASE_URL" -f sql/003_postgis_security_harden.sql
```

Or from repo root: `npm run apply-fsi-sql` (runs 001 + 002 when `DATABASE_URL` is set).

`floguard-crm/.env` currently has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
but **no `DATABASE_URL`**. The read endpoint does not need one — it goes through
PostgREST via `server/lib/supabase-rest.js`. Applying these migrations and
running the rainfall cron both do. Either add `DATABASE_URL`, or paste the SQL
files into the Supabase dashboard SQL editor.

### Supabase linter (PostGIS)

`001` installs PostGIS into schema **`extensions`**, not `public`, so new projects
avoid `extension_in_public` and keep geometry RPC off the default API surface.

If you already ran an older `create extension postgis` (public schema), the
database linter will warn about `st_estimatedextent` being callable by `anon` /
`authenticated`. Paste **`sql/003_postgis_security_harden.sql`** into the SQL
Editor — it revokes those executes. Moving the extension out of `public` after
tables already use `public.geometry` is optional and destructive; revoke is enough
for the security WARNs.

**GDAL will probably fail on `pip install` on Windows** — the wheel must match a
system libgdal that is not present. Use conda and drop the pin:

```bash
conda install -c conda-forge gdal
```

Tippecanoe (vector tiles, only needed if parcel counts outgrow GeoJSON):

```bash
brew install tippecanoe
# Linux: git clone https://github.com/felt/tippecanoe && cd tippecanoe && make -j && sudo make install
```

Copy `.env.example` to `.env` and fill it. `.env` is gitignored.

## Deliberate omissions

**No `package.json`.** The map surface lives in the existing static
`public/crm/index.html` (one inline `<script>`, no bundler). MapLibre GL 5.24.0
is **vendored** into `public/crm/vendor/` and loaded by relative path, not from a
CDN — the CRM otherwise makes no third-party runtime requests, and it has no CSP
to fall back on. Cost is ~1.1 MB committed and manual version bumps. Server-side
reads use the dependency-free `server/lib/supabase-rest.js`. Nothing for npm to do.

Upstream ships a `//# sourceMappingURL` comment and we do not vendor the `.map`,
so devtools will log one 404 for `maplibre-gl.js.map`. The file is otherwise byte
-for-byte upstream, which is worth more than silencing that.

**No `mapbox-gl`.** Spec section 6 locks the map client to MapLibre GL with a
free basemap — no token, no per-load billing. Shipping mapbox-gl alongside
MapLibre only creates a path to accidentally using it.

**No Next.js.** The CRM is hand-written static HTML plus Vercel functions.
Adding a second framework would duplicate the shell and the auth for one panel.

## Where the map deviates from the spec

Spec section 6 says parcels render "colored by `fsi_live`". The panel bands them
by **`fsi_static`** instead, and shows `fsi_live` as a number in the popup.

`rainfall.py` writes `fsi_live = fsi_static * composite_fsi(1.0, D)`, and that
multiplier is county-uniform in the 50–100 range. Fixed cuts on `fsi_live` would
therefore empty the top band on any dry day and paint the whole county safe —
exactly what the `(0.5 + 0.5·D)` floor exists to prevent. Since `fsi_live` is
`fsi_static` times a constant, the two rank identically, so banding on the
rainfall-stable term costs no fidelity and stops the colors moving under the reps
day to day.

Bands are equal-count quintiles across the parcels currently shown, not fixed
thresholds. There are no calibrated score tiers to use yet, and inventing
absolute cut points would imply a precision the weights do not have.

Revisit this once rainfall is sampled per-parcel rather than at the county
centroid — at that point `D` varies across the map and `fsi_live` carries real
spatial signal of its own.

## Running the daily cron

```bash
FSI_COUNTY_FIPS=12127 DATABASE_URL=... python -m pipeline.rainfall
```

Cold start seeds `API_t` from the current day's rainfall rather than zero, so
the first run does not report the whole county as bone dry.

## Before anyone sees a number

The weights in `config.py` are literature defaults, not calibrated values.
Recalibrate `w1..w6` and `alpha` by logistic regression once roughly 100
won/lost outcomes with addresses exist.

Until then: FSI ranks the call list. It is not a measurement, it is not an
inspection result, and per spec section 8 it never implies anything about
flood insurance. Parcel and owner records are public in Florida; outreach is
still governed by DNC and CAN-SPAM. `api/fsi-parcels.js` deliberately does not
return phone numbers.
