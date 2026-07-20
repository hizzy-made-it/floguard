-- FloGuard FSI — parcel risk table
-- Source of truth: docs/FLOOD-SUSCEPTIBILITY-INDEX.md §6
-- Timestamps are ISO-8601 UTC (timestamptz).

create extension if not exists postgis;

create table if not exists parcel_risk (
  parcel_id   text primary key,
  address     text,
  owner_name  text,
  lat         double precision,
  lon         double precision,
  geom        geometry(MultiPolygon, 4326),

  twi         real,        -- raw Topographic Wetness Index
  hand        real,        -- raw Height Above Nearest Drainage, metres
  twi_n       real,        -- normalized 0-1 across the county
  hand_n      real,        -- normalized 0-1 (raw; inversion happens in scoring)
  hsg         text,        -- USDA hydrologic soil group: A|B|C|D (or dual, e.g. 'A/D')
  fema_zone   text,        -- NFHL zone: AE|VE|AO|AH|X-SHADED|X

  fsi_static  real,        -- S. Recomputed only when source rasters change.
  fsi_live    real,        -- full FSI. Rewritten by the daily rainfall cron.
  updated_at  timestamptz not null default now()
);

-- Map reads are viewport + threshold queries; these two carry them.
create index if not exists parcel_risk_geom_idx on parcel_risk using gist (geom);
create index if not exists parcel_risk_fsi_live_idx on parcel_risk (fsi_live desc);

-- Daily rainfall state, one row per county. Keeps API_t out of the parcel table
-- so the cron rewrites one row of state plus one bulk fsi_live update,
-- rather than per-parcel rainfall history.
create table if not exists rainfall_state (
  county_fips text primary key,
  api_value   real not null,        -- API_t, carried forward with k = 0.87
  rain_24h    real not null,        -- last 24h precipitation, mm
  observed_at timestamptz not null
);
