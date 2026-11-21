# terrain-v2-corridor-2026-11-20

1 m LiDAR terrain v2 for the lead corridor (bbox -81.11 29.01 -80.95 29.33: Ormond Beach,
Holly Hill, Daytona Beach, South Daytona, Port Orange): 110,990 parcels, 17 HUC12 watersheds.

- Run in a cloud workspace (7 GB RAM, 25 GB disk), so watersheds were processed one at a time
  (`run_corridor.sh`): terrain -> zonal -> keep results -> delete tile caches.
- HUC12 030802010700 (329 M cells at 1 m, ~35 GB of working arrays) ran at **2 m**; its 10,449
  parcels are labelled `dem_res_m = 1` in the CSV because assemble reads the corridor plan's cell.
- Several watersheds hit the 25-round cross-tile propagation cap with residual cells > 0
  (see `data/leads/parts/terrain_*.log`); accumulation terms near tile edges there are approximate.
- summary: confidence p10/50/90 = 0.856 / 0.912 / 0.948, dem_1m_share = 1.0.

Load: `select terrain_v2_load_enqueue(array[...raw URLs of parcel_terrain_v2_NN.json...]);`
then `select * from terrain_v2_load_process();` (sql/018). Scores change only after
`fsi_set_model_version('v2')` + `fsi_static_batch(0..7)` + `must_have_rescore()`.
