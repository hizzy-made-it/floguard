# Runbook — terrain v2 (1 m LiDAR, polygon zonal, confidence)

Owner-run, on a workstation. Nothing here touches the live database until step 6, and
no score changes until step 7. Every step is resumable: rerunning skips finished work.

Code: `fsi/pipeline/terrain_v2_run.py` (CLI), `terrain_v2.py` (tiles), `hydro.py`
(conditioning, routing), `zonal.py`, `neighbors.py`, `soils.py`, `confidence.py`.
SQL: `fsi/sql/018_terrain_v2_and_confidence.sql`.

## 0. Machine

| | Minimum | Comfortable |
|---|---|---|
| RAM | 16 GB (use `--chunk-m 3000`) | 32 GB+ (default 5 km chunks) |
| Disk | 120 GB free | 200 GB SSD |
| CPU | any x86-64 / Apple silicon | 8+ cores (one tile at a time; cores help numba little) |
| OS | Linux, macOS, or Windows + conda | Linux |

Peak RAM per tile is ~130 bytes per window cell. A 5 km chunk plus 300 m halo at 1 m
is 31 M cells, about 4 GB; `plan` prints the largest tile and its estimate.

Disk: 1 m DEM tiles 32 GB (115 files, 4 overlapping LiDAR projects; the selection keeps
the newest per 10 km tile, ~70 files / ~24 GB), 1/3 arc-second 2 GB, per-tile working
arrays ~60 GB (`data/v2/tiles/`, delete after the release is uploaded).

Time (estimates, not measured on the county; see "Unverified" below): downloads 1-3 h on
100 Mbit/s; terrain ~1-3 min per 5 km tile at 1 m with numba (~150 tiles: 3-6 h);
zonal ~1 h for 313k parcels; soils 10-30 min; assemble 5 min.

## 1. Environment

```bash
cd floguard-crm/fsi
python -m venv .venv && source .venv/bin/activate      # Windows: conda create -n fsi python=3.12 gdal rasterio geopandas
pip install -r requirements.txt
python -m pytest tests -q                               # expect all passed (the SQL test is skipped without a local PostgreSQL server)
```

## 2. Data download

```bash
python -m pipeline.terrain_v2_run fetch                 # writes data/v2/...
```

Fetches, all public, no keys:

| What | Source | Size |
|---|---|---|
| 1 m DEM tile list + files | TNM Access API `datasets=Digital Elevation Model (DEM) 1 meter` -> `prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/...` | ~24-32 GB |
| 10 m fallback | TNM `National Elevation Dataset (NED) 1/3 arc-second` -> `.../Elevation/13/TIFF/historical/n30w082/...` (+n29w081 etc.) | ~2 GB |
| HUC12 watersheds | `hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6` | < 10 MB |
| NHD flowlines (high-res) | `hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6` | ~50 MB |
| Street centrelines | Census TIGER/Line 2024 roads, Volusia `tl_2024_12127_roads.zip` | ~10 MB |

Then the parcel polygons (full precision, not the generalised centroids):

```bash
python -m pipeline.parcel_polygons                      # data/v2/parcels.gpkg, ~315 pages, ~20 min
```

Optional inputs that raise accuracy and confidence (put anywhere, pass the path):

| Flag | What | Where to get it |
|---|---|---|
| `--culverts F` | stormwater pipes / culverts as lines | Volusia County Public Works stormwater GIS; city GIS (Daytona, Deltona, Port Orange). Public-records request if not published |
| `--inlets F` | storm inlets / catch basins as points | same |
| `--footprints F` | building footprints (yard-only stats) | Microsoft US Building Footprints (Florida GeoJSON), or the county layer |
| `--drained-ids F` | parcel_ids with known artificial drainage (keeps A/D as A) | drainage-district records; leave out if unknown |

Without culverts the 1 m DEM treats road embankments as dams; bounded breaching (40 m)
cuts most of them for routing, but the closed-basin term will still flag ponds behind
fill that a real pipe drains. Those parcels get a lower `fsi_confidence`.

### Pilot first (recommended)

Run one small area end to end before the county, reading the LiDAR over HTTPS
(no 32 GB download):

```bash
python -m pipeline.terrain_v2_run fetch --data-dir data/pilot --bbox -81.062 29.207 -81.056 29.213 --lists-only
python -m pipeline.terrain_v2_run plan --data-dir data/pilot --halo 200
python -m pipeline.terrain_v2_run terrain --data-dir data/pilot --remote-dem
python -m pipeline.terrain_v2_run zonal --data-dir data/pilot
python -m pipeline.terrain_v2_run soils --data-dir data/pilot --bbox -81.062 29.207 -81.056 29.213
python -m pipeline.terrain_v2_run assemble --data-dir data/pilot --tag pilot
```

Look at `data/pilot/release/pilot/summary.json` and spot-check five lots you know.

## 3. Plan

```bash
python -m pipeline.terrain_v2_run plan                  # data/v2/plan.json
```

Tiles = HUC12 watershed ∩ 5 km chunk, plus a 300 m halo. Options: `--cell 2` halves
memory 4x (accuracy loss on small lots), `--max-breach-m 40`, `--stream-area-m2 250000`
(contributing area that makes a channel for HAND; 0.25 km2).

## 4. Terrain

```bash
python -m pipeline.terrain_v2_run terrain               # phases 1-3, all tiles
python -m pipeline.terrain_v2_run terrain --only 030802010101   # one HUC12 (pilot / rerun)
```

Phase 1 conditions each tile (burn culverts, burn NHD 1 m, breach <= 40 m, epsilon
fill), computes the closed-basin depth from the un-breached DEM and accumulates the
tile's own area. Phase 2 routes flow that crossed tile edges into the neighbouring
tile (exact; `terrain_diag.json` reports rounds, lost and residual cells — residual
should be 0). Phase 3 computes streams, HAND, slope, TWI. Phase 1 is cached per tile
in `data/v2/tiles/<key>/`; delete a tile's folder to redo it.

## 5. Zonal, soils, assemble

```bash
python -m pipeline.terrain_v2_run zonal [--footprints F]
python -m pipeline.terrain_v2_run soils                 # SDA tabular + map-unit polygons (or --soil-polygons soilmu_a_fl127.shp)
python -m pipeline.terrain_v2_run assemble --tag terrain-v2-YYYY-MM-DD
```

`assemble` compares every parcel against the 10 m release in
`fsi/releases/terrain-2026-09-17/` (percentile-rank agreement feeds `fsi_confidence`).
Output: `data/v2/release/<tag>/parcel_terrain_v2.csv` (human), `parcel_terrain_v2_NN.json`
(10k rows each, for SQL), `summary.json`.

Sanity checks before uploading:
- `summary.json`: report `dem_source_1m_share` separately from `effective_1m_share`.
  A 2 m processing grid can use 1 m source LiDAR, and a 1 m grid can use 10 m source data.
  `dem_1m_share` remains a compatibility alias for source coverage only. For a mixed-grid run,
  run zonal separately for each processing plan and preserve `grid_cell_m` when combining CSVs.
- `flow_seam_status_counts`: review residual and unknown counts before any model activation.
  A nonzero D8 or MFD residual means that flow accumulation did not finish across the
  processed tile group. It does not identify exactly which individual parcels are affected.
  Reprocess the affected groups and review residuals and parcel-level deltas before switching.
- `confidence_p10_50_90` — expect a median around 0.8; a median under 0.6 means an input is missing.
- Open the CSV, sort by `depr_v2_n` and `nbr_rel_m`; the top rows should be lots you would expect to hold water (Deltona / Orange City basins, older Daytona grid streets). If the top is all lots next to highway fill, culverts are missing.

## 6. Apply SQL and upload

Apply the migration once (dashboard SQL editor or `psql "$DATABASE_URL" -f sql/018_terrain_v2_and_confidence.sql`).
It is additive and idempotent; v1 stays live.

Upload, either way:

```bash
# a) PostgREST (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in floguard-crm/.env)
python -m pipeline.upload_v2 data/v2/release/terrain-v2-YYYY-MM-DD
```

```sql
-- b) pg_net, works while PostgREST egress is capped (same pattern as sql/011):
--    commit the JSON parts under fsi/releases/<tag>/ (or any public URL), then
select terrain_v2_load_enqueue(array[
  'https://raw.githubusercontent.com/<org>/<repo>/<branch>/floguard-crm/fsi/releases/<tag>/parcel_terrain_v2_00.json',
  '...']);
select * from terrain_v2_load_process();   -- repeat until pending = 0
```

Check: `select count(*) filter (where terrain_v2_at is not null), avg(fsi_confidence) from parcel_risk;`

## 7. Switch the model version

```sql
select fsi_set_model_version('v2');
-- then, one statement at a time with VACUUM between (free-tier disk; see sql/012):
select fsi_static_batch(0);  vacuum parcel_risk;
select fsi_static_batch(1);  vacuum parcel_risk;
-- ... through 7
select must_have_rescore();
```

Rows without v2 terms keep the v1 score (`model_version = 'v1'` on the row).
Compare before announcing: `select model_version, count(*), avg(fsi_static) from parcel_risk group by 1;`

The JS mirror (`scripts/lib/fsi-score.mjs`) does not yet have the v2 formula; until it
does, `fsi/tests/verify-mhs-*.mjs` only checks the must-have layer (which reads the
stored `fsi_live`, so it stays consistent).

## 8. Roll back

Score only (keeps the v2 data for comparison):

```sql
select fsi_set_model_version('v1');
select fsi_static_batch(0); vacuum parcel_risk;   -- ... through 7
select must_have_rescore();
```

Data too: `select terrain_v2_clear(b)` for b in 0..7 (clears `terrain_v2_at` and
`fsi_static_v2`; the other v2 columns stay until the next upload overwrites them).
The 018 columns themselves are never dropped (additive-only rule).

## 9. Radar rain (MRMS), optional

```sql
select mrms_cells_seed();                                   -- parcel_risk.mrms_cell + rainfall_cell rows (source 'mrms')
```
```bash
FSI_RAIN_SOURCE=mrms DATABASE_URL=... python -m pipeline.rainfall   # daily, after 14:30 UTC, before fsi_daily
```
```sql
select rain_source_use('mrms', b) from generate_series(0, 7) b;    -- point parcels at radar cells
-- back: select rain_source_use('open_meteo', b) from generate_series(0, 7) b;
```

MRMS needs GRIB2 decoding (GDAL), so it cannot run inside Postgres or a Vercel
function; it needs a daily runner with Python (workstation cron or a GitHub Actions
schedule). Until that exists, keep Open-Meteo.

## 10. Calibrate (when labels exist)

```bash
psql "$DATABASE_URL" -c "\copy (select parcel_id, address, zip, city, census_tract, lat, lon, twi_n, hand_n, depr_n, hsg, fema_zone, twi_v2_n, hand_v2_n, depr_v2_n, nbr_rel_m, street_rel_m, hsg_eff, drain_class, ksat_um_s, wt_depth_m from parcel_risk) to 'parcels.csv' csv header"
psql "$DATABASE_URL" -c "\copy (select * from lead_outcomes) to 'lead_outcomes.csv' csv header"
python -m pipeline.proxy_labels --in permits.csv --parcels parcels.csv --out proxy_matched.csv      # optional
python -m pipeline.calibrate --parcels parcels.csv --outcomes lead_outcomes.csv --proxy proxy_matched.csv \
    --background-ratio 5 --target water --model v2 --out calibration_report.json
```

It refuses to print weights until the minority class has
max(30, 10 x features) effective labels and the total is >= 100. Ship fitted weights
only if `cv.auc` beats `baseline_production.auc` and `sign_conflicts` is empty, and then
change `config_v2.py`, `sql/018` (new migration) and `fsi-score.mjs` together.

## Unverified (honest list)

- No step has run on the full county. The pilot path above ran on 2026-11-19 with real
  LiDAR (read remotely), HUC12, NHD, TIGER roads, SSURGO and 289 appraiser parcels:
  3 tiles / 20 M window cells in 88 s, zonal 2 s (see docs/handoff/D.md).
- Time and disk figures for the county are extrapolated from that pilot (~4.4 us per
  window cell including remote reads -> ~4-5 h for ~3.7 G window cells).
- Culvert / inlet / footprint layers have only been tested on synthetic data; the
  county's real field names and geometry quality are unknown.
- WBD/NHD services occasionally time out on large pages; `arcgis_features` retries 3x.
