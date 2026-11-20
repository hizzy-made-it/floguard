-- NFIP claim aggregates (OpenFEMA). Neighbourhood totals only, never a property-level claim.
-- Build PostGIS geometry, then run 023 assignment + 016 apply in buckets (see fsi/sql/023).
select public.nfip_claim_bg_build_geom() as geometries_built;
