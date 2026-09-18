-- 015: gold-segment terrain rule (owner decision 2026-09-17).
-- Applied 2026-09-17 as migration gold_segment_basin.
--
-- gold_segment (+14 points) was zone X + clay/dual soil + claim heat >= 0.35.
-- Claim heat is coastal NFIP data (inland 0.25-0.28), so Orange City, Deltona
-- and DeBary basins could never qualify however deep the bowl. Now:
--   gold = zone X + clay/dual soil + (claim heat >= 0.35 OR depr_n >= 0.5)
-- New reason code 'closed_basin' (depr_n >= 0.5). must_have_raw gains p_depr_n;
-- the old 11-arg overload is dropped so callers cannot resolve to it.
-- Mirrored in scripts/lib/fsi-score.mjs.

drop function if exists public.must_have_raw(real, real, text, text, real, real, real, integer, text, real, real);

create or replace function public.must_have_raw(
  p_fsi_live real, p_fsi_static real, p_fema_zone text, p_hsg text, p_claim_heat real,
  p_just_value real, p_living_area real, p_year_built integer, p_homestead text,
  p_impervious_ratio real default null, p_lot_sqft real default null,
  p_depr_n real default null)
returns table(score real, reasons text[], is_dial boolean)
language plpgsql immutable
as $function$
declare
  la double precision := coalesce(public.f8(p_living_area), 0);
  jv double precision := coalesce(public.f8(p_just_value), 0);
  yb int := coalesce(p_year_built, 0);
  imp double precision := public.f8(p_impervious_ratio);
  lot double precision := public.f8(p_lot_sqft);
  depr double precision := coalesce(public.f8(p_depr_n), 0);
  improved boolean;
  has_fsi boolean;
  risk double precision;
  heat double precision;
  zone text := upper(coalesce(p_fema_zone, ''));
  hsg  text := upper(coalesce(p_hsg, ''));
  clay double precision;
  zone_x double precision;
  story double precision;
  capacity double precision := 0.35;
  age double precision := 0.4;
  hx text := upper(trim(coalesce(p_homestead, '')));
  owner_occ double precision;
  hardscape double precision;
  raw double precision;
  gold boolean;
  r text[] := '{}';
begin
  -- Dial target = improved footprint. (JS also tests a "vacantLike" regex, but both
  -- branches return false unless improved, so improved is the whole test.)
  improved := la > 0 or jv >= 75000 or yb > 1800;
  if not improved then
    return query select 0::real, array['not_dial_target'], false;
    return;
  end if;

  has_fsi := p_fsi_live is not null or p_fsi_static is not null;
  risk := case
    when p_fsi_live is not null then least(greatest(public.f8(p_fsi_live) / 100.0, 0), 1)
    when p_fsi_static is not null then least(greatest(public.f8(p_fsi_static), 0), 1)
    else 0 end;
  heat := least(greatest(coalesce(public.f8(p_claim_heat), 0), 0), 1);

  clay := case
    when hsg = 'D' or position('D' in hsg) > 0 then 1.0
    when hsg = 'C' or position('C' in hsg) > 0 then 0.55
    else 0.15 end;
  zone_x := case
    when zone in ('X', 'X-SHADED') then 1.0
    when zone in ('AE', 'VE', 'AO', 'AH') then 0.45
    else 0.3 end;
  story := least(greatest(
    0.55 * clay + 0.45 * zone_x + case when zone_x >= 0.9 and clay >= 0.55 then 0.2 else 0 end,
    0), 1);

  if jv > 0 then
    capacity := case
      when jv >= 2000000 then 0.95
      when jv >= 900000 then 0.88
      when jv >= 180000 then 0.9
      when jv >= 120000 then 0.7
      else 0.4 end;
  end if;
  if la >= 1200 and la <= 3500 then capacity := least(1, capacity + 0.08); end if;
  if la > 3500 then capacity := least(1, capacity + 0.12); end if;

  if yb > 1800 then
    age := case
      when yb < 1980 then 1.0
      when yb < 1995 then 0.85
      when yb < 2005 then 0.65
      when yb < 2015 then 0.45
      else 0.25 end;
  end if;

  owner_occ := case
    when hx in ('Y', 'YES', '1', 'X') then 1.0
    when hx <> '' then 0.4
    else 0.55 end;

  if imp is null then
    hardscape := 0.3;
  else
    hardscape := least(greatest((imp - 0.10) / 0.40, 0), 1);
    if lot is not null and lot > 0 and lot < 8000 and imp >= 0.2 then
      hardscape := least(1, hardscape + 0.15);
    end if;
  end if;

  if has_fsi then
    -- sql/014: claim heat 0.20 -> 0.12, terrain risk 0.30 -> 0.38 (coastal NFIP bias)
    raw := 0.38 * risk + 0.12 * heat + 0.17 * story + 0.14 * capacity
         + 0.07 * hardscape + 0.07 * age + 0.05 * owner_occ;
  else
    raw := 0.33 * heat + 0.19 * capacity + 0.16 * age + 0.12 * story
         + 0.07 * hardscape + 0.08 * owner_occ + 0.05;
    if heat >= 0.55 then raw := least(1, raw + 0.1); end if;
  end if;

  -- sql/015: a closed basin (>= 0.5 m bowl at the lot) is a second way into gold.
  -- Claim heat is coastal NFIP data; inland basins never reach 0.35.
  gold := zone in ('X', 'X-SHADED') and clay >= 0.55 and (heat >= 0.35 or depr >= 0.5);
  if gold then raw := least(1, raw + 0.14); end if;
  if zone in ('AE', 'VE', 'AO', 'AH') and clay < 0.5 and heat < 0.3 then raw := raw * 0.9; end if;
  if jv >= 900000 and (heat >= 0.4 or clay >= 0.55) then raw := least(1, raw + 0.06); end if;

  if risk >= 0.45 then r := array_append(r, 'high_fsi'); end if;
  if heat >= 0.4 then r := array_append(r, 'claim_hot_tract'); end if;
  if zone in ('X', 'X-SHADED') then r := array_append(r, 'zone_x'); end if;
  if clay >= 0.55 then r := array_append(r, case when clay >= 0.9 then 'clay_soil' else 'poor_drain_soil' end); end if;
  if gold then r := array_append(r, 'gold_segment'); end if;
  if depr >= 0.5 then r := array_append(r, 'closed_basin'); end if;
  if imp is not null and hardscape >= 0.6 then r := array_append(r, 'hardscape_pooling'); end if;
  if age >= 0.85 then r := array_append(r, 'older_building'); end if;
  if capacity >= 0.75 then r := array_append(r, 'pay_capacity'); end if;
  if jv >= 900000 then r := array_append(r, 'commercial_scale'); end if;
  if owner_occ >= 0.9 then r := array_append(r, 'homestead'); end if;
  if not has_fsi then r := array_append(r, 'pre_fsi'); end if;

  return query select
    (floor(least(100, greatest(0, raw * 100)) * 10 + 0.5) / 10)::real,
    r,
    true;
end;
$function$;

-- Callers pass the new column.
create or replace function public.must_have_rescore(
  must_top double precision default 0.03,
  should_top double precision default 0.15,
  maybe_top double precision default 0.40)
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '900s'
as $function$
declare
  n_dial bigint;
  cut_must real;
  cut_should real;
  cut_maybe real;
  n integer;
begin
  drop table if exists pg_temp._mhs;
  create temp table _mhs on commit drop as
    select p.parcel_id, s.score, s.reasons, s.is_dial
      from public.parcel_risk p
      cross join lateral public.must_have_raw(
        p.fsi_live, p.fsi_static, p.fema_zone, p.hsg, p.claim_heat,
        p.just_value, p.living_area, p.year_built, p.homestead,
        p.impervious_ratio, p.lot_sqft, p.depr_n) s;

  select count(*) into n_dial from _mhs where is_dial;

  if n_dial = 0 then
    cut_must := 100; cut_should := 100; cut_maybe := 100;
  else
    with ranked as (
      select score, row_number() over (order by score) - 1 as idx
        from _mhs where is_dial
    )
    select
      max(score) filter (where idx = least(n_dial - 1, greatest(0, floor(n_dial * (1 - must_top))))),
      max(score) filter (where idx = least(n_dial - 1, greatest(0, floor(n_dial * (1 - should_top))))),
      max(score) filter (where idx = least(n_dial - 1, greatest(0, floor(n_dial * (1 - maybe_top)))))
      into cut_must, cut_should, cut_maybe
      from ranked;
  end if;

  update public.parcel_risk p
     set must_have_score   = m.score,
         must_have_reasons = m.reasons,
         must_have_band    = case
           when not m.is_dial then 'skip'
           when m.score >= cut_must then 'must'
           when m.score >= cut_should then 'should'
           when m.score >= cut_maybe then 'maybe'
           else 'skip' end,
         updated_at = now()
    from _mhs m
   where m.parcel_id = p.parcel_id
     and (p.must_have_score is distinct from m.score
       or p.must_have_reasons is distinct from m.reasons
       or p.must_have_band is distinct from case
           when not m.is_dial then 'skip'
           when m.score >= cut_must then 'must'
           when m.score >= cut_should then 'should'
           when m.score >= cut_maybe then 'maybe'
           else 'skip' end);
  get diagnostics n = row_count;

  insert into public.must_have_runs (dial_eligible, cut_must, cut_should, cut_maybe, rows_changed)
  values (n_dial, cut_must, cut_should, cut_maybe, n);

  return n;
end;
$function$;



create or replace function public.must_have_cuts(
  must_top double precision default 0.03,
  should_top double precision default 0.15,
  maybe_top double precision default 0.40)
returns bigint
language plpgsql security definer
set search_path = public
set statement_timeout = '900s'
as $$
declare n_dial bigint; cut_must real; cut_should real; cut_maybe real; rid bigint;
begin
  with sc as (
    select s.score, s.is_dial
      from public.parcel_risk p
      cross join lateral public.must_have_raw(
        p.fsi_live, p.fsi_static, p.fema_zone, p.hsg, p.claim_heat,
        p.just_value, p.living_area, p.year_built, p.homestead,
        p.impervious_ratio, p.lot_sqft, p.depr_n) s
  ), d as (select score from sc where is_dial),
  ranked as (select score, row_number() over (order by score) - 1 as idx, count(*) over () as n from d)
  select max(n),
         max(score) filter (where idx = least(n - 1, greatest(0, floor(n * (1 - must_top))))),
         max(score) filter (where idx = least(n - 1, greatest(0, floor(n * (1 - should_top))))),
         max(score) filter (where idx = least(n - 1, greatest(0, floor(n * (1 - maybe_top)))))
    into n_dial, cut_must, cut_should, cut_maybe
    from ranked;
  if n_dial is null or n_dial = 0 then
    n_dial := 0; cut_must := 100; cut_should := 100; cut_maybe := 100;
  end if;
  insert into public.must_have_runs (dial_eligible, cut_must, cut_should, cut_maybe, rows_changed)
  values (n_dial, cut_must, cut_should, cut_maybe, 0) returning id into rid;
  return rid;
end;
$$;

-- Apply score / reasons / band for one hash bucket using the cuts of run_id.
create or replace function public.must_have_apply_batch(run_id bigint, bucket integer, buckets integer default 8)
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '900s'
as $$
declare r public.must_have_runs%rowtype; n integer;
begin
  select * into r from public.must_have_runs where id = run_id;
  if not found then raise exception 'must_have_runs % not found', run_id; end if;
  update public.parcel_risk p
     set must_have_score   = m.score,
         must_have_reasons = m.reasons,
         must_have_band    = m.band,
         updated_at        = now()
    from (
      select p2.parcel_id, s.score, s.reasons,
             case when not s.is_dial then 'skip'
                  when s.score >= r.cut_must then 'must'
                  when s.score >= r.cut_should then 'should'
                  when s.score >= r.cut_maybe then 'maybe'
                  else 'skip' end as band
        from public.parcel_risk p2
        cross join lateral public.must_have_raw(
          p2.fsi_live, p2.fsi_static, p2.fema_zone, p2.hsg, p2.claim_heat,
          p2.just_value, p2.living_area, p2.year_built, p2.homestead,
          p2.impervious_ratio, p2.lot_sqft, p2.depr_n) s
       where abs(hashtext(p2.parcel_id)) % buckets = bucket
    ) m
   where m.parcel_id = p.parcel_id
     and (p.must_have_score is distinct from m.score
       or p.must_have_reasons is distinct from m.reasons
       or p.must_have_band is distinct from m.band);
  get diagnostics n = row_count;
  update public.must_have_runs set rows_changed = rows_changed + n where id = run_id;
  return n;
end;
$$;


revoke all on function public.must_have_raw(real, real, text, text, real, real, real, integer, text, real, real, real) from public, anon, authenticated;
