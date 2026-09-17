-- 008: item 6 — lot-level stormwater term in the Must-Have Score.
-- Applied 2026-09-17 as migration mhs_lot_features_term. Mirrors
-- scripts/lib/fsi-score.mjs mustHaveScore() (JS reference).
--
-- hardscape = impervious_ratio mapped 0.10→0, 0.50→1 (county p25≈0.10, p98≈0.63).
-- Small lot (<8k sqft) with hardscape ≥0.20 gets +0.15: roof + driveway water has
-- nowhere to go. Null impervious → neutral 0.3 so unenriched parcels are not penalized.
-- Weights rebalanced to sum 1.00; bands stay percentile-based so counts hold.
-- New reason code: 'hardscape_pooling' (hardscape ≥ 0.6).

drop function if exists public.must_have_raw(real, real, text, text, real, real, real, integer, text);

create or replace function public.must_have_raw(
  p_fsi_live real, p_fsi_static real, p_fema_zone text, p_hsg text, p_claim_heat real,
  p_just_value real, p_living_area real, p_year_built integer, p_homestead text,
  p_impervious_ratio real default null, p_lot_sqft real default null)
returns table(score real, reasons text[], is_dial boolean)
language plpgsql immutable
as $function$
declare
  la double precision := coalesce(public.f8(p_living_area), 0);
  jv double precision := coalesce(public.f8(p_just_value), 0);
  yb int := coalesce(p_year_built, 0);
  imp double precision := public.f8(p_impervious_ratio);
  lot double precision := public.f8(p_lot_sqft);
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
    raw := 0.30 * risk + 0.20 * heat + 0.17 * story + 0.14 * capacity
         + 0.07 * hardscape + 0.07 * age + 0.05 * owner_occ;
  else
    raw := 0.33 * heat + 0.19 * capacity + 0.16 * age + 0.12 * story
         + 0.07 * hardscape + 0.08 * owner_occ + 0.05;
    if heat >= 0.55 then raw := least(1, raw + 0.1); end if;
  end if;

  gold := zone in ('X', 'X-SHADED') and clay >= 0.55 and heat >= 0.35;
  if gold then raw := least(1, raw + 0.14); end if;
  if zone in ('AE', 'VE', 'AO', 'AH') and clay < 0.5 and heat < 0.3 then raw := raw * 0.9; end if;
  if jv >= 900000 and (heat >= 0.4 or clay >= 0.55) then raw := least(1, raw + 0.06); end if;

  if risk >= 0.45 then r := array_append(r, 'high_fsi'); end if;
  if heat >= 0.4 then r := array_append(r, 'claim_hot_tract'); end if;
  if zone in ('X', 'X-SHADED') then r := array_append(r, 'zone_x'); end if;
  if clay >= 0.55 then r := array_append(r, case when clay >= 0.9 then 'clay_soil' else 'poor_drain_soil' end); end if;
  if gold then r := array_append(r, 'gold_segment'); end if;
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

-- Percentile floors over dial-eligible scores: must top 3%, should top 15%, maybe top 40%.
-- Mirrors percentileCuts(): idx = floor(n * (1 - p)) into the ascending array.
-- Writes only rows whose score/reasons/band actually changed; logs each run.
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
        p.impervious_ratio, p.lot_sqft) s;

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


revoke all on function public.must_have_raw(real, real, text, text, real, real, real, integer, text, real, real) from public, anon, authenticated;
