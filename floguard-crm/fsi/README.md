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

| Piece | State |
|---|---|
| `sql/001_parcel_risk.sql` | Complete, **never applied** — `parcel_risk` + `rainfall_state`, GiST + `fsi_live` indexes |
| `sql/002_seed_fixtures.sql` | Complete, **never applied** — 21 synthetic parcels so the map is verifiable before ingest exists |
| `pipeline/config.py` | Complete — all six weights, HSG/zone lookups, `advance_api`, `composite_fsi` |
| `pipeline/rainfall.py` | Complete, **never run** — Open-Meteo fetch, API_t advance, bulk `fsi_live` update |
| `pipeline/terrain.py` | **Scaffold** — WhiteboxTools sequence documented, `NotImplementedError` throughout |
| `../api/fsi-parcels.js` | Complete — 401/400/405/503 paths exercised against the dev server; the success path is unverified because no rows exist |
| Parcel ingest | Not started |
| Map panel in the CRM | Complete, **unverified against data** — panel renders, but has never drawn a parcel |

## Setup

```bash
cd fsi
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
psql "$DATABASE_URL" -f sql/001_parcel_risk.sql
psql "$DATABASE_URL" -f sql/002_seed_fixtures.sql   # optional: synthetic map data
```

`floguard-crm/.env` currently has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
but **no `DATABASE_URL`**. The read endpoint does not need one — it goes through
PostgREST via `server/lib/supabase-rest.js`. Applying these migrations and
running the rainfall cron both do. Either add `DATABASE_URL`, or paste the two
files into the Supabase dashboard SQL editor.

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
