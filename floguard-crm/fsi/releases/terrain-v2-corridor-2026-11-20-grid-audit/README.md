# November 20 corridor: provenance correction (not an activation release)

The original 12-part release was pinned to commit
[349a9da5](https://github.com/hizzy-made-it/floguard/tree/349a9da571bb9b03c0bc9022f6fc4dd1526c2720/floguard-crm/fsi/releases/terrain-v2-corridor-2026-11-20).
It covers 110,990 unique parcels in 14 represented HUC12s. The 17 watershed
plans referenced in the original run are not a count of represented parcels.

| Measure | Verified |
| --- | ---: |
| Majority 1 m native LiDAR source | 110,990 (100%) |
| Effective 1 m grid with 1 m source | 100,541 (90.59%) |
| Effective 2 m grid with 1 m source, HUC12 030802010700 | 10,449 (9.41%) |
| 2 m rows carrying the legacy 1 m small-lot confidence penalty | 44 |

The historical release also serialized HUC12 as numbers without leading zeros.
The repair pads the archived watershed IDs, adds the actual processing grid,
and leaves native DEM, terrain measurements, and confidence values intact.
Do not use the repaired archival copy as an input to a production score switch.

## Reproduce and verify

1. Extract the 12 JSON parts and summary from the pinned commit into one local
   folder. Keep these files byte-for-byte.
2. From fsi/, run: python -m pipeline.repair_corridor_grid SOURCE FRESH_DEST
3. Compare the generated summary.json against the manifest in this directory,
   including both sets of SHA-256 fields. The command fails if parts, release tag,
   unique parcel count, or the 2 m watershed count do not match.
4. Reprocess original raster tile groups to obtain per-run seam diagnostics, and
   reassemble the 44 flagged confidence values from the original unrounded zonal
   and rank inputs. Do not approximate them from rounded archive values.
5. Before any model switch, investigate nonzero seam residuals and any candidate
   parcel IDs that did not match a staged parcel. Verify score deltas in staging
   and review the rollback plan.

This correction does not enqueue the artifact, rescore parcels, or enable v2.
