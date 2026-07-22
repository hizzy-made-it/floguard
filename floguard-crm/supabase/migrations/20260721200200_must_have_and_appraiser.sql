-- Must-have targeting + appraiser attributes + NFIP claim heat (tract-level)
-- Apply: supabase db push  OR  SQL editor on floguard project

-- Appraiser / building pressure (from Volusia ParcelOwners layer)
alter table public.parcel_risk add column if not exists alt_key text;
alter table public.parcel_risk add column if not exists dor_use text;
alter table public.parcel_risk add column if not exists use_desc text;
alter table public.parcel_risk add column if not exists year_built int;
alter table public.parcel_risk add column if not exists living_area real;
alter table public.parcel_risk add column if not exists just_value real;
alter table public.parcel_risk add column if not exists homestead text;
alter table public.parcel_risk add column if not exists last_sale_price real;
alter table public.parcel_risk add column if not exists last_sale_date date;
alter table public.parcel_risk add column if not exists census_block text;
alter table public.parcel_risk add column if not exists census_tract text;
alter table public.parcel_risk add column if not exists city text;
alter table public.parcel_risk add column if not exists zip text;

-- Claim heat join key + must-have score (computed offline)
alter table public.parcel_risk add column if not exists claim_heat real;          -- 0-1 normalized tract heat
alter table public.parcel_risk add column if not exists claim_count_10y int;
alter table public.parcel_risk add column if not exists claim_paid_sum real;
alter table public.parcel_risk add column if not exists claim_last_year int;
alter table public.parcel_risk add column if not exists must_have_score real;     -- 0-100
alter table public.parcel_risk add column if not exists must_have_band text;      -- must|should|maybe|skip
alter table public.parcel_risk add column if not exists must_have_reasons text[]; -- short codes for UI

create index if not exists parcel_risk_must_have_idx
  on public.parcel_risk (must_have_score desc nulls last);
create index if not exists parcel_risk_tract_idx
  on public.parcel_risk (census_tract);
create index if not exists parcel_risk_city_idx
  on public.parcel_risk (city);

-- Neighborhood claim aggregates (OpenFEMA redacted — tract grain only)
create table if not exists public.nfip_claim_tract (
  census_tract   text primary key,
  claim_count_10y int not null default 0,
  claim_count_all int not null default 0,
  paid_sum       real not null default 0,
  last_loss_year int,
  multi_loss_flag boolean not null default false,
  heat           real not null default 0,  -- 0-1 for map choropleth
  updated_at     timestamptz not null default now()
);

alter table public.nfip_claim_tract enable row level security;
revoke all on table public.nfip_claim_tract from anon, authenticated;
grant select, insert, update, delete on table public.nfip_claim_tract to service_role;

comment on table public.nfip_claim_tract is
  'OpenFEMA NFIP claims aggregated to census tract. Never implies a named owner filed a claim.';
