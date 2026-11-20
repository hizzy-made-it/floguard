-- 023: assign parcels to census block groups inside the database.
-- Additive + idempotent.
--
-- Why: scripts/ingest-nfip-claims.mjs assigns parcel_risk.block_group by point-in-polygon over
-- PostgREST, which needs the service-role key on the machine running it. This does the same job
-- in SQL once nfip_claim_block_group has geometry (016 nfip_claim_bg_build_geom), so the claims
-- load can be finished from the SQL editor.
--
-- Method: point-in-polygon against every block group (GiST on geom), so the answer does not
-- depend on parcel_risk.census_tract. That column is NOT exact: scripts/join-census-tracts.mjs
-- fills it from a 0.03 degree (~3 km) grid, so a parcel near a tract edge can carry a neighbour's
-- tract. Parcels that land in no polygon (the stored outlines are generalised by ~30 m, which
-- leaves slivers along shared edges and the coast) take the nearest block group within ~300 m;
-- anything farther stays unassigned and keeps tract-level heat.
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

  -- 1. Containment across all block groups. A point on a shared edge can match two polygons:
  --    take the lower GEOID so the result is deterministic.
  update public.parcel_risk p
     set block_group = c.block_group, updated_at = now()
    from (
      select p2.parcel_id, min(b.block_group) as block_group
        from public.parcel_risk p2
        join public.nfip_claim_block_group b
          on b.geom is not null
         and st_contains(b.geom, st_setsrid(st_makepoint(p2.lon, p2.lat), 4326))
       where p2.lat is not null and p2.lon is not null
         and (p_reassign or p2.block_group is null)
         and abs(hashtext(p2.parcel_id)::bigint) % p_buckets = p_bucket
       group by p2.parcel_id
    ) c
   where c.parcel_id = p.parcel_id
     and p.block_group is distinct from c.block_group;
  get diagnostics n = row_count;

  -- 2. In no polygon: nearest block group within 0.003 degrees (~300 m). On a reassign, a parcel
  --    that is in no polygon and near none loses its old label rather than keeping a stale one.
  update public.parcel_risk p
     set block_group = c.block_group, updated_at = now()
    from (
      select p2.parcel_id,
             (select b.block_group
                from public.nfip_claim_block_group b
               where b.geom is not null
                 and st_dwithin(b.geom, st_setsrid(st_makepoint(p2.lon, p2.lat), 4326), 0.003)
               order by st_distance(b.geom, st_setsrid(st_makepoint(p2.lon, p2.lat), 4326)), b.block_group
               limit 1) as block_group
        from public.parcel_risk p2
       where p2.lat is not null and p2.lon is not null
         and abs(hashtext(p2.parcel_id)::bigint) % p_buckets = p_bucket
         and not exists (
               select 1 from public.nfip_claim_block_group b2
                where b2.geom is not null
                  and st_contains(b2.geom, st_setsrid(st_makepoint(p2.lon, p2.lat), 4326)))
         and (p_reassign or p2.block_group is null)
    ) c
   where c.parcel_id = p.parcel_id
     and p.block_group is distinct from c.block_group;
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
