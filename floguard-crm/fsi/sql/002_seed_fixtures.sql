-- FloGuard FSI — synthetic fixtures for the CRM map panel
-- Source of truth: docs/FLOOD-SUSCEPTIBILITY-INDEX.md §3
--
-- WHY THIS FILE EXISTS
-- Parcel ingest (spec build order step 1) and the terrain precompute (step 2)
-- are not built — pipeline/terrain.py raises NotImplementedError throughout, so
-- nothing populates fsi_static. Without rows the map panel renders a blank
-- basemap and api/fsi-parcels.js returns { ok: true, count: 0 }, which is
-- indistinguishable from a working map over a quiet county.
--
-- These rows exist to make the panel verifiable end to end — auth, bbox
-- validation, PostgREST, banding, popups — before real terrain data lands.
--
-- EVERY ROW IS FAKE. Addresses and owners are invented, not public record.
-- The FIXTURE- prefix is what makes them removable in one statement; keep it.
--
-- Drop them all:
--   delete from parcel_risk where parcel_id like 'FIXTURE-%';

-- fsi_static comes from pipeline/config.py static_score():
--   S = 0.40*twi_n + 0.25*(1 - hand_n) + 0.20*HSG + 0.15*Z
-- fsi_live is S * 75.0, i.e. composite_fsi(1.0, D) at D = 0.5 — mid-range
-- antecedent wetness, so this file stands alone without a cron run. The daily
-- rainfall job will overwrite fsi_live on its first pass; that is expected.
--
-- twi, hand, and geom stay null on purpose. Raw raster values and parcel
-- polygons would be fabrications with no source, and nothing reads them:
-- api/fsi-parcels.js projects only the nine columns below.

insert into parcel_risk
  (parcel_id, address, owner_name, lat, lon, twi_n, hand_n, hsg, fema_zone, fsi_static, fsi_live)
values
  -- The two canonical cases from spec §2 and §3. These carry the whole thesis:
  -- identical rain, opposite outcomes, and the Zone X bowl outranks three of the
  -- four FEMA-mapped parcels in this set.
  ('FIXTURE-001', 'FIXTURE - 100 Sample St',  'Fixture Owner 01', 29.0283, -81.3031, 0.95, 0.05, 'D',   'X',        0.885,  66.37),  -- clay bowl in Zone X — the highest-value segment
  ('FIXTURE-002', 'FIXTURE - 200 Sample St',  'Fixture Owner 02', 29.2858, -81.0559, 0.10, 0.90, 'A',   'X',        0.1725, 12.94),  -- sandy ridge — stays cold in any storm
  ('FIXTURE-003', 'FIXTURE - 300 Sample St',  'Fixture Owner 03', 29.2108, -81.0228, 0.95, 0.05, 'D',   'AE',       0.9675, 72.56),  -- same terrain, Zone AE: modifier, not driver

  ('FIXTURE-004', 'FIXTURE - 400 Sample St',  'Fixture Owner 04', 28.9005, -81.2637, 0.88, 0.12, 'C',   'X',        0.7795, 58.46),
  ('FIXTURE-005', 'FIXTURE - 500 Sample St',  'Fixture Owner 05', 28.9489, -81.2984, 0.82, 0.20, 'D',   'X-SHADED', 0.818,  61.35),
  ('FIXTURE-006', 'FIXTURE - 600 Sample St',  'Fixture Owner 06', 29.1383, -81.0059, 0.75, 0.25, 'C',   'X',        0.695,  52.13),
  ('FIXTURE-007', 'FIXTURE - 700 Sample St',  'Fixture Owner 07', 29.0258, -80.9270, 0.70, 0.30, 'D',   'AO',       0.775,  58.12),
  ('FIXTURE-008', 'FIXTURE - 800 Sample St',  'Fixture Owner 08', 28.9889, -80.9023, 0.65, 0.35, 'B',   'X',        0.57,   42.75),
  ('FIXTURE-009', 'FIXTURE - 900 Sample St',  'Fixture Owner 09', 28.8831, -81.3087, 0.60, 0.40, 'C',   'AH',       0.65,   48.75),
  ('FIXTURE-010', 'FIXTURE - 1000 Sample St', 'Fixture Owner 10', 29.0611, -81.2094, 0.55, 0.45, 'A/D', 'X',        0.625,  46.88),  -- dual soil resolves to the undrained half
  ('FIXTURE-011', 'FIXTURE - 1100 Sample St', 'Fixture Owner 11', 29.1702, -81.0784, 0.50, 0.50, 'B',   'X-SHADED', 0.495,  37.12),
  ('FIXTURE-012', 'FIXTURE - 1200 Sample St', 'Fixture Owner 12', 29.2295, -81.1122, 0.45, 0.55, 'C',   'X',        0.5,    37.50),
  ('FIXTURE-013', 'FIXTURE - 1300 Sample St', 'Fixture Owner 13', 29.0447, -80.9138, 0.40, 0.60, 'B',   'VE',       0.49,   36.75),
  ('FIXTURE-014', 'FIXTURE - 1400 Sample St', 'Fixture Owner 14', 28.9312, -81.1855, 0.35, 0.65, 'A',   'X',        0.335,  25.12),
  ('FIXTURE-015', 'FIXTURE - 1500 Sample St', 'Fixture Owner 15', 29.1055, -81.2508, 0.30, 0.70, 'B',   'X',        0.3425, 25.69),
  ('FIXTURE-016', 'FIXTURE - 1600 Sample St', 'Fixture Owner 16', 29.2571, -81.1390, 0.25, 0.75, 'C',   'X',        0.37,   27.75),
  ('FIXTURE-017', 'FIXTURE - 1700 Sample St', 'Fixture Owner 17', 28.9720, -81.0466, 0.20, 0.80, 'A',   'X-SHADED', 0.26,   19.50),
  ('FIXTURE-018', 'FIXTURE - 1800 Sample St', 'Fixture Owner 18', 29.1930, -81.2233, 0.15, 0.85, 'B',   'X',        0.245,  18.38),
  ('FIXTURE-019', 'FIXTURE - 1900 Sample St', 'Fixture Owner 19', 28.9166, -81.0912, 0.92, 0.08, 'D',   'X',        0.8655, 64.91),  -- second Zone X bowl
  ('FIXTURE-020', 'FIXTURE - 2000 Sample St', 'Fixture Owner 20', 29.2740, -80.9581, 0.05, 0.95, 'A',   'X',        0.14,   10.50),  -- driest parcel in the set

  -- Unmatched parcel: no SSURGO soil, no NFHL zone. config.py falls back to
  -- HSG_DEFAULT 0.55 and FEMA_ZONE_DEFAULT 0.6 — mid-range on purpose, so an
  -- unknown parcel is neither promoted nor buried. Exercises the null path in
  -- the popup rendering.
  ('FIXTURE-021', 'FIXTURE - 2100 Sample St', 'Fixture Owner 21', 29.0938, -81.1647, 0.72, 0.28, null,  null,       0.668,  50.10)

on conflict (parcel_id) do update set
  address    = excluded.address,
  owner_name = excluded.owner_name,
  lat        = excluded.lat,
  lon        = excluded.lon,
  twi_n      = excluded.twi_n,
  hand_n     = excluded.hand_n,
  hsg        = excluded.hsg,
  fema_zone  = excluded.fema_zone,
  fsi_static = excluded.fsi_static,
  fsi_live   = excluded.fsi_live,
  updated_at = now();
