# Handoff D — map accuracy pipeline (terrain v2, confidence, calibration)

Branch `crm-next/D`. Owned files only: `fsi/pipeline/`, `fsi/sql/018_terrain_v2_and_confidence.sql`,
`fsi/tests/`, `fsi/README.md`, `fsi/requirements.txt`, `fsi/RUNBOOK-terrain-v2.md`, this note.
No SQL was applied to any live database. Nothing under `api/`, `public/`, `scripts/`, `package.json` changed.

## What changed

| Area | Before (v1, live) | Now (v2, built, off by default) |
|---|---|---|
| DEM | 3DEP 1/3 arc-second (10 m), whole county in memory | 3DEP 1 m LiDAR per HUC12 watershed (split into 5 km chunks, 300 m halo); 10 m fallback per cell, recorded per lot |
| Tile edges | n/a (one raster) | flow leaving a tile's core is routed on in the neighbour tile (exact; tested against a single-tile run) and HAND paths are finished in the tile that owns them |
| Conditioning | Wang & Liu fill | burn culverts (optional layer) + NHD flowlines (1 m), least-cost breach limited to 40 m, epsilon fill; storm inlets act as drains |
| Closed basins | filled - raw, 3x3 max at centroid | from the **un-breached** DEM (culverts/inlets applied), depth + share of lot, 10 cm floor (LiDAR noise) |
| Lot stats | 3x3 window at centroid | parcel polygon (partial-cell weights), optional yard-only (building footprints removed) |
| Relative elevation | none | lot vs neighbour lots within 30 m, lot vs adjacent street centreline |
| Soil | hydrologic group only | + seasonal high water table, drainage class, ksat (SSURGO via Soil Data Access); A/D, B/D, C/D treated as D |
| Rain | Open-Meteo 0.05° cells | + NOAA MRMS radar 0.01° (24 h / 72 h), per-cell API, behind `FSI_RAIN_SOURCE=mrms` |
| Quality | none | `fsi_confidence` 0-1 and `fsi_inputs` jsonb per parcel |
| Calibration | none | `calibrate.py` (L2 logistic, tract-blocked CV, AUC / PR-AUC / calibration / lift, refuses below EPV 10) + `proxy_labels.py` |

## New `parcel_risk` columns (sql/018) — for the map UI

All nullable. Null = not computed for that parcel (no v2 run yet, or input missing).
"Normalised" = 2-98 percentile clip across the county, then 0-1.

| Column | Type | Meaning | Range / values | Show to reps as |
|---|---|---|---|---|
| `terrain_v2_at` | timestamptz | when v2 terms were loaded; null = no v2 data | | (internal) |
| `model_version` | text | which model produced this row's `fsi_static` | `v1` \| `v2` | small badge |
| `fsi_static_v2` | real | v2 static score, computed whenever v2 terms exist (even while v1 is live) | 0-1 (pilot: 0.08-0.83) | "v2 score" in the breakdown |
| `fsi_confidence` | real | input-quality confidence. NOT a flood probability | 0-1 (pilot median 0.94) | grey out < 0.6; tooltip "data quality" |
| `fsi_inputs` | jsonb | provenance: `dem` (`3dep_1m`/`3dep_13`), `dem_res_m`, `dem_1m_frac`, `geom`, `yard_only`, `nhd_burn`, `culverts_or_inlets`, `soil`, `soil_cov`, `nbr_count`, `street_n`, `agree_10m`, `huc12`, `release`, `twi_clip`, `hand_clip` | keys may be absent | "data used" list |
| `huc12` | text | 12-digit watershed the lot was processed in | e.g. `030802010103` | (internal) |
| `dem_res_m` | real | DEM resolution under most of the lot | `1` or `10` | "1 m LiDAR" / "10 m" |
| `dem_1m_frac` | real | share of the lot covered by 1 m LiDAR | 0-1 | |
| `geom_mode` | text | how the lot was measured | `polygon`, `polygon_partial` (lot larger than tile halo), `centroid` (lot smaller than a cell) | |
| `yard_only` | boolean | building footprint excluded from the stats | | "yard only" |
| `lot_area_m2` | real | area measured (yard if yard_only) | > 0 | |
| `elev_p10_m` | real | 10th-percentile ground elevation on the lot, m NAVD88 | ~0-30 in Volusia | |
| `elev_med_m` | real | median ground elevation on the lot, m NAVD88 | ~0-30 | |
| `twi_max` | real | highest TWI on the lot (cells at least half inside) | ~5-20 | |
| `twi_awm` | real | area-weighted mean TWI | ~3-12 | |
| `twi_v2_n` | real | `twi_awm` normalised | 0-1 | "wetness" bar |
| `hand_min_m` | real | lowest height above nearest drainage on the lot, m. **Can be negative**: part of the lot is below the channel it drains to | ~-2 to 15 | "height above drain" |
| `hand_v2_n` | real | `hand_min_m` normalised (raw; inverted in scoring) | 0-1 | |
| `depr_max_m` | real | deepest closed-basin depth on the lot, m | 0-~2 | "bowl depth" |
| `depr_frac` | real | share of the lot inside a basin >= 10 cm deep | 0-1 | "x% of lot in a bowl" |
| `depr_v2_n` | real | `0.6*min(depr_max_m/1 m,1) + 0.4*depr_frac` | 0-1 | |
| `nbr_rel_m` | real | lot median minus median of neighbour lots within 30 m. **Negative = lower than the neighbours** | ~-2 to 2 | "x cm below neighbours" |
| `nbr_count` | integer | neighbour lots used (needs >= 2) | 0-~30 | |
| `street_rel_m` | real | lot median minus adjacent street centreline. Negative = below the road (a little negative is normal: crowned roads) | ~-2 to 2 | "x cm below street" |
| `hsg_eff` | text | effective hydrologic group (dual groups resolved to D) | `A`..`D` | soil letter |
| `hsg_dual` | boolean | SSURGO group was dual (A/D etc.) | | "seasonally wet soil" |
| `drain_class` | text | SSURGO drainage class, dominant by area | `Excessively drained` .. `Very poorly drained` | |
| `ksat_um_s` | real | slowest-layer saturated hydraulic conductivity in top 100 cm, µm/s | ~0.1-300 | |
| `wt_depth_m` | real | SSURGO annual minimum water-table depth, m; 2.0 = none within 200 cm | 0-2 | "water table x m" |
| `soil_cov` | real | share of the lot with SSURGO data | 0-1 | |
| `mrms_cell` | text | NOAA MRMS radar cell | `m<row>_<col>` | (internal) |

Existing columns are untouched; `fsi_static` / `fsi_live` keep meaning "the live score".

Other tables: `rainfall_cell` + `source` (`open_meteo`/`mrms`), `rain_72h`; `lead_outcomes` +
`depr_n_at`, `fsi_static_v2_at`, `fsi_confidence_at`, `model_version_at` (trigger replaced to fill them);
new `fsi_settings(key, value)` with `fsi_model_version` = `v1`, `rain_source` = `open_meteo`;
new `terrain_v2_load_queue`.

New SQL functions: `fsi_model_version()`, `fsi_set_model_version(v)`, `fsi_static_v2_expr(...)`,
`fsi_static_v2_of(row)`, `fsi_static_dispatch(version, row)`, `drain_class_score`, `ksat_score`,
`soil_score_v2`, `bowl_score`, `wt_score`, `terrain_v2_apply(jsonb)`, `terrain_v2_clear(b, n)`,
`terrain_v2_load_enqueue(urls)`, `terrain_v2_load_process()`, `mrms_cell_id(lat, lon)`,
`mrms_cells_seed()`, `rain_source_use(src, b, n)`. Replaced (same signatures, v1 behaviour
identical while the setting is `v1`; checked in `tests/test_sql_018.py`): `fsi_static_batch`,
`fsi_recompute_static`, `rain_fetch_enqueue` (now skips MRMS cells), `lead_outcomes_snapshot`.

## Changes needed outside my files (for the owners of those files)

1. **`api/fsi-parcels.js` (agent B owns it)**: add to `COLUMNS`
   `model_version,fsi_static_v2,fsi_confidence,fsi_inputs,dem_res_m,geom_mode,yard_only,elev_med_m,twi_v2_n,hand_min_m,depr_max_m,depr_frac,nbr_rel_m,street_rel_m,hsg_eff,hsg_dual,drain_class,wt_depth_m`.
   Before 018 is applied these columns do not exist and PostgREST will 400, so gate it
   (try with, fall back to the old list) or ship it together with the migration.
2. **`scripts/lib/fsi-score.mjs`** — JS mirror of v2 (exact constants; Python reference
   `fsi/pipeline/config_v2.py`, SQL `fsi_static_v2_expr`):
   ```js
   export const W2 = { twi: 0.20, hand: 0.15, depr: 0.15, bowl: 0.15, soil: 0.10, wt: 0.10, zone: 0.15 };
   const DRAIN = { 'VERY POORLY DRAINED': 1.0, 'POORLY DRAINED': 0.85, 'SOMEWHAT POORLY DRAINED': 0.65,
     'MODERATELY WELL DRAINED': 0.4, 'WELL DRAINED': 0.2, 'SOMEWHAT EXCESSIVELY DRAINED': 0.1, 'EXCESSIVELY DRAINED': 0.05 };
   ksatScore(k)   = k == null ? null : k <= 0 ? 1 : clamp01((2 - Math.log10(k)) / 2)
   soilScoreV2(h, dc, k) = mean of present [HSG_SCORE[h] (single letter), DRAIN[dc.toUpperCase().trim()], ksatScore(k)], else 0.55
   bowlScore(n, s) = both ? clamp01(-(0.6*n + 0.4*s)/0.6) : one ? clamp01(-x/0.6) : 0.2
   wtScore(wt)    = wt == null ? 0.5 : clamp01(1 - wt/2)
   staticScoreV2  = round4(0.20*c(twi??0.55) + 0.15*(1-c(hand??0.45)) + 0.15*c(depr??0) + 0.15*bowl + 0.10*soil + 0.10*wt + 0.15*zoneScore(zone))
   ```
   and use `row.model_version === 'v2' ? fsi_static_v2 : staticScore(...)` wherever the JS
   recomputes static. `mustHaveScore` reads `fsi_live`, so the must-have layer stays
   consistent without changes.
3. **Must-have gold rule** (`sql/015`, `fsi-score.mjs`) still reads v1 `depr_n`. After v2
   goes live, decide whether `closed_basin` / gold should read `depr_v2_n` (1 m, culvert-aware).
   Not changed here: it is a sales-band decision, not a terrain one.
4. **`.env.example`**: add the name `FSI_RAIN_SOURCE` (values `open_meteo` | `mrms`). The pipeline
   also uses existing `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
5. **MRMS daily runner**: GRIB2 decoding needs GDAL, so it cannot run in Postgres or a Vercel
   function. A GitHub Actions schedule (or the owner's machine) running
   `FSI_RAIN_SOURCE=mrms python -m pipeline.rainfall` after 14:30 UTC is the natural home. Not built.

## How to run tests

```bash
cd floguard-crm/fsi
pip install -r requirements.txt
python -m pytest tests -q        # 62 passed on 2026-11-19
```

`tests/test_sql_018.py` starts a throwaway PostgreSQL cluster in a temp dir (needs PostgreSQL
server binaries under `/usr/lib/postgresql/*/bin`; skipped otherwise), applies 011, 013, 014, 007
and 018 **twice**, then checks: v1 default unchanged, v2 SQL == Python on 300 random inputs,
apply / switch / rollback, MRMS cell ids SQL == Python, outcome snapshot. The existing
`fsi/tests/verify-mhs-*.mjs` need a live database and were not changed (syntax-checked only).

## Verified

- Synthetic DEMs with known answers: bowl depth, inlet drains a bowl, ridge HAND/TWI, road
  embankment with and without a burned culvert, breach length bound, closed basin kept while
  routing breaches, tile-edge flow (3 partitions) equal to a single tile, mass conservation on
  a noisy DEM, culvert crossing a tile seam, HAND paths finished across four tiles.
- Calibration recovers known weights within 0.05 on synthetic data; refuses below threshold;
  folds never share a tract.
- Access paths, live on 2026-11-19 (curl from this environment; WebFetch needed an approval
  nobody was there to give): TNM API (115 Volusia 1 m tiles, 31.9 GB, 4 projects), `prd-tnm`
  1 m COGs (range reads work), `noaa-mrms-pds` 24 h / 72 h Pass2 (downloaded one file; grid
  7000x3500, 0.01°, edge 130 W / 55 N; read 24.7 mm at the Volusia centroid cell), SDA tabular
  + spatial queries (FL127), WBD HUC12 and NHD services, TIGER roads, appraiser parcel polygons.
- **Real-data pilot** (Daytona, bbox -81.062 29.207 -81.056 29.213; 3 HUC12 tiles, 8.6 M core
  cells of 1 m LiDAR read remotely; 88 s terrain, 2 s zonal for 289 lots): every lot measured on
  its polygon at 1 m; HAND resolved for all lots; Spearman vs the 10 m release 0.72 (TWI) and
  0.93 (HAND); the top closed-basin lots are also 0.5-1.7 m below their neighbours and the
  street; release JSON loaded through `terrain_v2_apply` on the throwaway PostgreSQL. The pilot
  also caught and fixed two real bugs (window-edge false channel in HAND; 5 cm depression
  floor counting LiDAR noise).

## Not verified / could not exercise

- The county run (115 tiles, ~150 work tiles). Time/disk numbers in the runbook are
  extrapolated from the pilot (~0.1 s per 10^5 window cells) and may be off by 2x.
- No culvert, inlet or building-footprint layer exists in the repo; those paths are tested only
  on synthetic data. Real county stormwater field names are unknown.
- No accuracy number against ground truth: there are 0 outcomes. `fsi_confidence` measures input
  quality, not correctness. Pilot confidence is high (median 0.94) partly because "no culverts"
  only costs 0.0375; revisit once the culvert layer is in hand.
- The pilot HUC tiles left ~21% of window cells with unresolved HAND (paths that leave the small
  pilot area before reaching a 0.25 km2 channel). None of those were under a parcel; on the
  county run, paths leaving through the coast/county edge will stay unresolved. The stream
  threshold for urban 1 m DEMs without the storm-sewer layer is a tuning question.
- Phase 2 hit its 25-round cap in the pilot with MFD flow bouncing along seams (D8 residual 0);
  `residual_mfd_cells` is reported so it can be checked on the county run.
- MRMS end to end into `rainfall_cell` (needs `DATABASE_URL`); only grid indexing, file reading
  and the API math are tested.
- SDA polygon fetch for the whole county (`fetch_mupolygons`) was only run for a pilot bbox.
- Commit trailer: the spec asks for `Claude Fable 5.2`; this session's model is Claude Opus 5.5,
  so the commits carry that (with the same Claude-Session line).
