-- FloGuard FSI: parcel_risk + rainfall_state + fixtures + PostGIS security harden
-- Source: fsi/sql/001, 002, 003

-- ---------------------------------------------------------------------------
-- PostGIS (prefer extensions schema; keep existing install if already present)
-- ---------------------------------------------------------------------------
create schema if not exists extensions;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'postgis') then
    create extension postgis with schema extensions;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- parcel_risk + rainfall_state
-- geom uses unqualified geometry so it resolves whether PostGIS lives in
-- public (legacy) or extensions (preferred new installs).
-- ---------------------------------------------------------------------------
create table if not exists public.parcel_risk (
  parcel_id   text primary key,
  address     text,
  owner_name  text,
  lat         double precision,
  lon         double precision,
  geom        geometry(MultiPolygon, 4326),

  twi         real,
  hand        real,
  twi_n       real,
  hand_n      real,
  hsg         text,
  fema_zone   text,

  fsi_static  real,
  fsi_live    real,
  updated_at  timestamptz not null default now()
);

create index if not exists parcel_risk_geom_idx on public.parcel_risk using gist (geom);
create index if not exists parcel_risk_fsi_live_idx on public.parcel_risk (fsi_live desc);

create table if not exists public.rainfall_state (
  county_fips text primary key,
  api_value   real not null,
  rain_24h    real not null,
  observed_at timestamptz not null
);

alter table public.parcel_risk enable row level security;
alter table public.rainfall_state enable row level security;

revoke all on table public.parcel_risk from anon, authenticated;
revoke all on table public.rainfall_state from anon, authenticated;

grant select, insert, update, delete on table public.parcel_risk to service_role;
grant select, insert, update, delete on table public.rainfall_state to service_role;

-- ---------------------------------------------------------------------------
-- Seed synthetic FIXTURE rows (safe upsert; removable: parcel_id like 'FIXTURE-%')
-- ---------------------------------------------------------------------------
insert into public.parcel_risk
  (parcel_id, address, owner_name, lat, lon, twi_n, hand_n, hsg, fema_zone, fsi_static, fsi_live)
values
  ('FIXTURE-001', 'FIXTURE - 100 Sample St',  'Fixture Owner 01', 29.0283, -81.3031, 0.95, 0.05, 'D',   'X',        0.885,  66.37),
  ('FIXTURE-002', 'FIXTURE - 200 Sample St',  'Fixture Owner 02', 29.2858, -81.0559, 0.10, 0.90, 'A',   'X',        0.1725, 12.94),
  ('FIXTURE-003', 'FIXTURE - 300 Sample St',  'Fixture Owner 03', 29.2108, -81.0228, 0.95, 0.05, 'D',   'AE',       0.9675, 72.56),
  ('FIXTURE-004', 'FIXTURE - 400 Sample St',  'Fixture Owner 04', 28.9005, -81.2637, 0.88, 0.12, 'C',   'X',        0.7795, 58.46),
  ('FIXTURE-005', 'FIXTURE - 500 Sample St',  'Fixture Owner 05', 28.9489, -81.2984, 0.82, 0.20, 'D',   'X-SHADED', 0.818,  61.35),
  ('FIXTURE-006', 'FIXTURE - 600 Sample St',  'Fixture Owner 06', 29.1383, -81.0059, 0.75, 0.25, 'C',   'X',        0.695,  52.13),
  ('FIXTURE-007', 'FIXTURE - 700 Sample St',  'Fixture Owner 07', 29.0258, -80.9270, 0.70, 0.30, 'D',   'AO',       0.775,  58.12),
  ('FIXTURE-008', 'FIXTURE - 800 Sample St',  'Fixture Owner 08', 28.9889, -80.9023, 0.65, 0.35, 'B',   'X',        0.57,   42.75),
  ('FIXTURE-009', 'FIXTURE - 900 Sample St',  'Fixture Owner 09', 28.8831, -81.3087, 0.60, 0.40, 'C',   'AH',       0.65,   48.75),
  ('FIXTURE-010', 'FIXTURE - 1000 Sample St', 'Fixture Owner 10', 29.0611, -81.2094, 0.55, 0.45, 'A/D', 'X',        0.625,  46.88),
  ('FIXTURE-011', 'FIXTURE - 1100 Sample St', 'Fixture Owner 11', 29.1702, -81.0784, 0.50, 0.50, 'B',   'X-SHADED', 0.495,  37.12),
  ('FIXTURE-012', 'FIXTURE - 1200 Sample St', 'Fixture Owner 12', 29.2295, -81.1122, 0.45, 0.55, 'C',   'X',        0.5,    37.50),
  ('FIXTURE-013', 'FIXTURE - 1300 Sample St', 'Fixture Owner 13', 29.0447, -80.9138, 0.40, 0.60, 'B',   'VE',       0.49,   36.75),
  ('FIXTURE-014', 'FIXTURE - 1400 Sample St', 'Fixture Owner 14', 28.9312, -81.1855, 0.35, 0.65, 'A',   'X',        0.335,  25.12),
  ('FIXTURE-015', 'FIXTURE - 1500 Sample St', 'Fixture Owner 15', 29.1055, -81.2508, 0.30, 0.70, 'B',   'X',        0.3425, 25.69),
  ('FIXTURE-016', 'FIXTURE - 1600 Sample St', 'Fixture Owner 16', 29.2571, -81.1390, 0.25, 0.75, 'C',   'X',        0.37,   27.75),
  ('FIXTURE-017', 'FIXTURE - 1700 Sample St', 'Fixture Owner 17', 28.9720, -81.0466, 0.20, 0.80, 'A',   'X-SHADED', 0.26,   19.50),
  ('FIXTURE-018', 'FIXTURE - 1800 Sample St', 'Fixture Owner 18', 29.1930, -81.2233, 0.15, 0.85, 'B',   'X',        0.245,  18.38),
  ('FIXTURE-019', 'FIXTURE - 1900 Sample St', 'Fixture Owner 19', 28.9166, -81.0912, 0.92, 0.08, 'D',   'X',        0.8655, 64.91),
  ('FIXTURE-020', 'FIXTURE - 2000 Sample St', 'Fixture Owner 20', 29.2740, -80.9581, 0.05, 0.95, 'A',   'X',        0.14,   10.50),
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

-- ---------------------------------------------------------------------------
-- Harden: revoke client EXECUTE on st_estimatedextent (linter 0028/0029)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'extensions')
      and p.proname = 'st_estimatedextent'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    execute format('grant execute on function %s to postgres', r.sig);
  end loop;
end $$;
