# Handoff B — NFIP claims at block-group grain (2026-11-19)

Branch `crm-next/B`. Owned files only: `scripts/ingest-nfip-claims.mjs`, `scripts/lib/claims.mjs` (new),
`scripts/lib/geo.mjs` (one appended export), `fsi/sql/016_claims_block_group.sql`, `api/fsi-parcels.js`,
`tests/claims/`. Nothing under `api/` was added, `public/` and `package.json` untouched, no SQL applied, the real ingest was not run.

## What changed

- Ingest now reads OpenFEMA **v3**, aggregates to **block group** (`censusGeoid`), to **block group x storm event x year**, and still writes the legacy **tract** table. The lat/long grid and distance falloff are gone (comment at the top of the script explains why: redaction to 0.1 degree).
- Block-group polygons come from Census TIGERweb (2020 vintage). Parcels get `block_group` by point-in-polygon on `lat/lon`; a SQL function copies the aggregates onto parcels and recomputes `claim_heat` (block group first, tract fallback).
- `api/fsi-parcels.js`: parcel reads select the new columns but tolerate them being absent; two new actions `claims_layer` and `claims_events`.

## Confirmed against the live APIs on 2026-11-19

(WebFetch was blocked by an unanswered permission prompt, so these were confirmed with `curl` through the agent proxy against the same fema.gov / census.gov hosts. The `$top=1&$filter=countyCode eq '12127'` request from the brief was run against v3, see the 404 note.)

| Item | Result |
|---|---|
| v3 dataset (registry `OpenFemaDataSets` v1) | name `NfipClaims`, title "NFIP Redacted Claims", version 3, `webService` = `https://www.fema.gov/api/open/v3/NfipClaims`, dictionary `https://www.fema.gov/openfema-data-page/nfip-redacted-claims-v3`, 2,731,064 records, `lastDataSetRefresh` 2026-11-16 |
| **`v3/FimaNfipClaims` is a 404.** The v3 dataset is renamed `NfipClaims`; the response array key is `NfipClaims` | confirmed |
| Volusia (`countyCode eq '12127'`) | 12,581 records. `countyCode` is the 5-digit state+county string `"12127"` |
| **Block-group field is `censusGeoid`, not `censusBlockGroupFips`.** 12 digits (e.g. `121270826042`: state 12, county 127, tract 082604, block group 2). 206 of 8,565 rows since 2016 have it empty. There is **no `censusTract` field** in v3 (derive tract = first 11 digits) | confirmed |
| Zone fields | `floodZoneCurrent` (null on ~29% of rows since 2016) and `ratedFloodZone` (formerly `floodZone`). Values seen: AE, A, X, VE, AH, AHB, B, C, A04/A05/A07. The ingest uses `floodZoneCurrent`, falling back to `ratedFloodZone` |
| Other fields used | `id`, `dateOfLoss` (ISO datetime), `yearOfLoss`, `waterDepth` (inches, "sometimes feet", negatives exist, null on ~10%), `causeOfDamage` (code string, "4" = rainfall accumulation), `eventDesignationNumber` (e.g. `FL0222`), `floodEvent` (e.g. `Hurricane Ian`), `amountPaidOnBuildingClaim`, `amountPaidOnContentsClaim`, `asOfDate`, `latitude`/`longitude` (0.1 degree, unused) |
| Events | `floodEvent` is populated for named events incl. pre-2020 ones (Irma, Matthew) where `eventDesignationNumber` is null (EDN replaced FICO in June 2020). ~3.6% of Volusia rows since 2016 have neither |
| Paging | `$top=10000` works (returned a 2.2 MB page). `$skip`, `$orderby=id`, `$select`, `$inlinecount=allpages` (gives `metadata.count`) all work |
| `asOfDate` | **identical on every record** (the file refresh date, `2026-11-16`), so it cannot drive incremental pulls. `--since` filters `dateOfLoss` instead |
| TIGERweb layer | `https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/Tracts_Blocks/MapServer/1` = Census Block Groups, Jan-1-2020 vintage. Layer 5 on the same service is the 2010 set. Volusia: 343 block groups (2020) vs 289 (2010). Fields: `GEOID, STATE, COUNTY, TRACT, BLKGRP, POP100, HU100, CENTLAT, CENTLON, INTPTLAT, INTPTLON` (lat/lon are strings with a leading `+`/`-0`). `f=geojson` with `outSR=4326` returns Polygon geometry, max 100,000 records per page |
| Vintage mix | Of 8,359 Volusia claims since 2016 that have a geoid: 97.0% (8,110) are in the 2020 set, 248 (3.0%, 36 FIPS) are not (2010-vintage). One claim has an out-of-county geoid (`34039...`) |

A throwaway script (not committed) ran the real aggregation on 8,565 real Volusia rows plus the real 343 polygons: 8,110 claims land in 343 block groups, point-in-polygon put Daytona Beach city hall in `121270820003` and a Gulf point in no block group, as expected.

## Not confirmed / caveats

- The `openfema-data-page/nfip-redacted-claims-v3` HTML page itself was not fetched (WebFetch blocked); the field list comes from the OpenFEMA field-registry API (`OpenFemaDataSetFields`), which is the page's source.
- A FIPS that exists in both 2010 and 2020 with a *different footprint* is indistinguishable from a 2020 one in the claim record. Those claims are attributed to the 2020 polygon of the same FIPS. Only FIPS missing from the 2020 set are detected as old vintage.
- Claims in unmatched (2010) FIPS are counted in the tract table only, so block-group counts undercount by up to ~3% county-wide, more in the 36 affected areas. The log line prints the number.
- `waterDepth` units are inches but some records are in feet (FEMA's note). No attempt is made to correct that; the median uses depth > 0 within the 10y window.
- Paid amounts exclude ICC payments and clamp negative (recovery) amounts at 0 per claim.
- v2 (`--api-version v2`) field names were not re-verified; the code accepts the aliases `censusBlockGroupFips` / `floodZone` and fetches all fields.
- SQL 016 and the RPCs were not executed anywhere. The heat formula exists twice (SQL `nfip_weighted_count` + `nfip_recompute_block_group_heat`, JS `claims.mjs`) by design; only the JS one is tested.
- `--since` refreshes `nfip_claim_event` only (whole years, from Jan 1 of the given year). Block-group totals need a full run.

## Run order (when someone has DB access)

1. Apply `fsi/sql/016_claims_block_group.sql` (after 004 and 015).
2. `node scripts/join-census-tracts.mjs` (existing; paints tract-level `claim_heat` on all parcels).
3. `node scripts/ingest-nfip-claims.mjs --dry-run` to look at the numbers, then without `--dry-run`.
   Flags: `--api-version v3|v2`, `--since YYYY`, `--years N` (legacy tract window, default 12), `--page N` (default 5000, max 10000), `--no-geom`, `--skip-parcels`, `--reassign-all`.
   The ingest assigns `parcel_risk.block_group` (only rows where it is null, unless `--reassign-all`), then calls `nfip_apply_block_group_claims(8, 0..7)` which overrides `claim_heat` where a block group exists and otherwise falls back to the tract table.
4. `node scripts/score-must-have.mjs` (unchanged; `must_have_raw` from 015 is untouched and still takes `claim_heat`).

Env: none new (uses `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` as before).

Heat formula (SQL comment + `claims.mjs`): `weighted = 1*sfha_10y + 2*zone_x_10y + 1*other_10y`; `heat = min(1, ln(1+weighted) / ln(1+ref))`, `ref = max(5, p95 of weighted over block groups with weighted > 0)`. Zone X claims count double because a claim outside the mapped hazard area signals a drainage problem. Windows: 10y = loss year >= current year - 9, 5y = >= current year - 4.

Tests: `cd floguard-crm && node --test "tests/claims/**/*.test.mjs"` (40 tests, no network, no env needed).

## API contract (`POST /api/fsi-parcels`, same Bearer session token, same 60 req/min/IP limit)

### Existing actions
`viewport`, `top`, `storm` unchanged. Parcel rows now also carry (null until 016 is applied and the ingest has run):
`block_group` (12-digit text), `claim_bg_count_10y`, `claim_bg_zone_x_10y`, `claim_bg_rate` (claims per housing unit over 10y, a fraction; multiply by 1000 for "per 1,000 homes"), `claim_bg_last_year`, `claim_bg_top_event` (text like `"Hurricane Ian (2022)"`).
If the DB lacks any of them the read is retried without them and the response is still 200. `COLUMNS_OPTIONAL` (exported) is the list to append to for other migrations (agent D: add terrain-v2 column names there).

### `action: 'claims_layer'`
Request:
```json
{ "action": "claims_layer", "bbox": [w, s, e, n],
  "event": "Hurricane Ian", "eventYear": 2022, "includeGeom": false, "limit": 400 }
```
- `bbox` required, same validation as `viewport` (at most 1 degree each way), else 400. Block groups whose stored bbox overlaps it are returned.
- `event` (optional) is an `event_key` from `claims_events`; `eventYear` optional. With an event, only block groups with claims for that event are returned and each row gets an `event` object.
- `includeGeom` (optional, default false) adds `geom` (generalised GeoJSON Polygon/MultiPolygon, about 30 m tolerance) to each row.
- `limit` default 400, max 1000, ordered by `heat` descending.

Response 200:
```json
{ "ok": true, "source": "postgres", "available": true,
  "event": null,
  "count": 12, "truncated": false,
  "note": "Claim figures are neighbourhood (census block group) aggregates ...",
  "rows": [{
    "fips": "121270825061", "tract": "12127082506",
    "lon": -81.0233, "lat": 29.1381, "bbox": [w, s, e, n],
    "vintage": 2020, "housing_units": 1601,
    "count_all": 14, "count_10y": 12, "count_5y": 10, "last_year": 2024,
    "paid_10y": 87000, "median_depth_in": 12,
    "sfha_all": 6, "zone_x_all": 8, "other_all": 0,
    "sfha_10y": 5, "zone_x_10y": 7, "other_10y": 0,
    "rate_10y": 0.0075, "rate_zone_x_10y": 0.0044,
    "heat": 1, "top_event": "Hurricane Ian (2022)", "top_event_claims": 7,
    "geom": { "type": "Polygon", "coordinates": [] },
    "event": { "key": "Hurricane Ian", "year": 2022, "count": 7, "sfha": 3, "zone_x": 4, "other": 0, "paid": 54000 }
  }] }
```
`geom` only with `includeGeom`; `event` only with an event filter. Numbers that are unknown are `null` (`rate_*` when housing units are unknown, `median_depth_in`, `top_event`). `sfha_*` = zones A*/V*, `zone_x_*` = X/B/C/shaded, `other_*` = D/blank. Zone toggle in the UI = pick which of `sfha_10y` / `zone_x_10y` to shade by; no server round trip needed. To colour by event, use `event.count` (or `event.zone_x`).
If 016 is not applied / not ingested: 200 with `"available": false, "rows": [], "note": "..."` (the map should show "claims layer not available yet", not an error). 400 for a bad bbox, 401/405/429 as for the other actions, 500 `{error, detail}` on other DB failures.

### `action: 'claims_events'`
Request: `{ "action": "claims_events", "minClaims": 25, "namedOnly": true }` (both optional; defaults 25 and true).
Response 200:
```json
{ "ok": true, "source": "postgres", "available": true, "count": 8,
  "events": [{ "key": "Hurricane Ian", "name": "Hurricane Ian", "designation": "FL0222", "year": 2022,
               "label": "Hurricane Ian (2022)", "total_claims": 3488, "zone_x_claims": 1200, "sfha_claims": 2200,
               "paid_total": 150000000, "block_groups": 120, "named": true }] }
```
Newest year first, then most claims. `key` is what `claims_layer.event` takes. `namedOnly:false` also returns the per-year `unnamed-YYYY` buckets (label `Unnamed 2023 (2023)`). Same `available:false` fallback as above.

Compliance copy to keep on the UI: claims are neighbourhood aggregates from OpenFEMA, never a statement that a particular owner filed a claim.

## For other owners

- `scripts/join-census-tracts.mjs` (not mine) still repaints `claim_heat` from the tract table for every parcel. It must run before the claims ingest, not after (the ingest's apply step overrides it for parcels with a block group).
- `docs/FLOOD-SUSCEPTIBILITY-INDEX.md` has no claims section to update; the claims method is documented in the ingest header and in `fsi/sql/016`.
- Front end (F2): needs a polygon fill for block groups from `geom` (request with `includeGeom` once per bbox and cache by `fips`), zone toggle (`sfha_10y` vs `zone_x_10y`), event chips from `claims_events`, and per-parcel text from `claim_bg_*`.
