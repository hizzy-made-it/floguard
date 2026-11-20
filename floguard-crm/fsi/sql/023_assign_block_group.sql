-- 023: assign parcels to census block groups inside the database.
-- Additive + idempotent.
--
-- Why: scripts/ingest-nfip-claims.mjs assigns parcel_risk.block_group by point-in-polygon over
-- PostgREST, which needs the service-role key on the machine running it. This does the same job
-- in SQL once nfip_claim_block_group has geometry (016 nfip_claim_bg_build_geom), so the claims
-- load can be finished from the SQL editor.
--
-- Method: a parcel's census tract is already known exactly (parcel_risk.census_tract, 11 digits),
-- and a block group is a subdivision of one tract. So candidates are only the block groups of
-- the parcel's own tract; among those take the polygon containing the parcel point, else the
-- nearest one (the stored polygons are generalised for the map, so a point within ~30 m of an
-- internal boundary can fall in a sliver). Parcels with no tract fall back to plain containment.
-- Claims stay neighbourhood aggregates: this only labels which neighbourhood a parcel is in.

create or replace function public.nfip_assign_parcel_block_groups(
  p_buckets integer default 1,
  p_bucket integer default 0,
  p_reassign boolean default false)
returns integer
language plpgsql
security definer
set search_path = public, extensions
set statement_timeout = '900s'
as $function$
declare n integer; n2 integer;
begin
  if p_buckets < 1 or p_bucket < 0 or p_bucket >= p_buckets then
    raise exception 'bad bucket % of %', p_bucket, p_buckets;
  end if;

  -- 1. Same-tract candidates: containing polygon first, else nearest.
  update public.parcel_risk p
     set block_group = c.block_group, updated_at = now()
    from (
      select p2.parcel_id,
             (select b.block_group
                from public.nfip_claim_block_group b
               where b.tract = p2.census_tract and b.geom is not null
               order by st_distance(b.geom, st_setsrid(st_makepoint(p2.lon, p2.lat), 4326)), b.block_group
               limit 1) as block_group
        from public.parcel_risk p2
       where p2.census_tract is not null and p2.lat is not null and p2.lon is not null
         and (p_reassign or p2.block_group is null)
         and abs(hashtext(p2.parcel_id)::bigint) % p_buckets = p_bucket
    ) c
   where c.parcel_id = p.parcel_id
     and c.block_group is not null
     and p.block_group is distinct from c.block_group;
  get diagnostics n = row_count;

  -- 2. No tract on the parcel: plain containment across the county.
  update public.parcel_risk p
     set block_group = b.block_group, updated_at = now()
    from public.nfip_claim_block_group b
   where p.census_tract is null and p.lat is not null and p.lon is not null
     and (p_reassign or p.block_group is null)
     and abs(hashtext(p.parcel_id)::bigint) % p_buckets = p_bucket
     and b.geom is not null
     and st_contains(b.geom, st_setsrid(st_makepoint(p.lon, p.lat), 4326))
     and p.block_group is distinct from b.block_group;
  get diagnostics n2 = row_count;

  return n + n2;
end;
$function$;

revoke all on function public.nfip_assign_parcel_block_groups(integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.nfip_assign_parcel_block_groups(integer, integer, boolean) to service_role;

create index if not exists nfip_claim_block_group_tract_idx on public.nfip_claim_block_group (tract);

-- Map search (api/fsi-parcels.js action 'search') does address/owner ILIKE '%term%' on 312k rows.
-- Trigram GIN indexes were tried on 2026-11-19 and removed the same day: the nightly recompute
-- rewrites every parcel row, and maintaining two GIN indexes on each rewrite costs more than the
-- occasional full-scan search saves on this instance. Kept dropped here so a re-run stays clean.
drop index if exists public.parcel_risk_address_trgm_idx;
drop index if exists public.parcel_risk_owner_trgm_idx;

notify pgrst, 'reload schema';
