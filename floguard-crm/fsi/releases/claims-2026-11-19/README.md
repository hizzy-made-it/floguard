# claims-2026-11-19

NFIP claim aggregates for Volusia County (FIPS 12127) from OpenFEMA `v3/NfipClaims`, produced by
`node scripts/ingest-nfip-claims.mjs --emit-sql`. 12,581 claims: 11,565 placed in one of the 343
Census 2020 block groups, 789 in old 2010-vintage block groups (tract level only), 226 with no
location code. Neighbourhood totals only; nothing here identifies a property or an owner.

Apply in name order in the Supabase SQL editor (after `fsi/sql/016` and `023`), then:

```sql
select public.nfip_assign_parcel_block_groups(8, 0);  -- ... (8, 7)
select public.nfip_apply_block_group_claims(8, 0);    -- ... (8, 7)
```

Refresh: rerun the ingest with `--emit-sql` into a new dated folder. OpenFEMA refreshes monthly.
