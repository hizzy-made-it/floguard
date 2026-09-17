# terrain-2026-09-17

Per-parcel TWI / HAND for Volusia from USGS 3DEP 1/3 arc-second (10 m), produced by
`fsi/pipeline/terrain_run.py` (UTM 17N, Wang & Liu fill, D-inf SCA, stream threshold 5000,
3x3 window at the parcel centroid, 2–98 pct county normalisation).

Data files live here (not a GitHub release) so Supabase can fetch them with pg_net while the
project is egress-capped: `select terrain_load_enqueue(array[...raw URLs...])`, then
`select * from terrain_load_process()`, then `select fsi_recompute_static()`.

Columns: parcel_id, twi, hand (m), twi_n, hand_n. 313,487 rows in 8 parts. Public-record derived.
