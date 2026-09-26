-- ============================================================================
-- Market pricing mode — selling-price rate versions (247TailorSteel × 1.10)
-- File path: /supabase/migrations/20260927000000_market_pricing.sql
--
-- 1. rate_general: pricing_mode ('cost' = the machine-hour cost model with
--    a margin on top, unchanged; 'market' = the tables ARE selling prices),
--    order_charge_eur (one per order, split over the part lines) and the
--    two packaging prices (box / pallet, one per quote).
-- 2. rate_laser: setup_eur — charged once per distinct (material, thickness)
--    in a quote and split over the part lines with that combination.
-- 3. rate_finish: setup_per_order_eur (deburring setup, split over the lines
--    that have deburring) and min_part_mm (free-text minimum part size rule,
--    e.g. "steel 250x60 or 600x50; aluminium/stainless 50x50").
-- 4. finish_unit gains 'part' (a price per part, used by market engraving).
-- 5. rate_leadtime: working days → price multiplier rows per version, with
--    the same RLS, immutability trigger and clone behaviour as every other
--    rate table. It carries `placeholder` like the others so the admin
--    editor, the placeholder counter and the CSV import treat it uniformly.
-- 6. quotes: cost_rate_version_id (the cost version a market-priced quote
--    was compared against for its margin) and lead_time_days (promised lead
--    time in working days; default 11 [CONFIRM]).
-- 7. clone_rate_version() copies the new columns and the lead-time rows;
--    forbid_rate_edit_if_used() also protects a version that quotes use as
--    their cost version.
--
-- Existing versions get pricing_mode 'cost' and zero charges, so nothing
-- changes for them or for the quotes pinned to them.
-- ============================================================================

-- ─── 1–3. New columns ───────────────────────────────────────────────────────
alter table public.rate_general
  add column if not exists order_charge_eur numeric(12,4) not null default 0,
  add column if not exists packaging_box_eur numeric(12,4) not null default 0,
  add column if not exists packaging_pallet_eur numeric(12,4) not null default 0,
  add column if not exists pricing_mode text not null default 'cost';
alter table public.rate_general drop constraint if exists rate_general_pricing_mode_check;
alter table public.rate_general
  add constraint rate_general_pricing_mode_check check (pricing_mode in ('cost', 'market'));

alter table public.rate_laser
  add column if not exists setup_eur numeric(12,4) not null default 0;

alter table public.rate_finish
  add column if not exists setup_per_order_eur numeric(12,4) not null default 0,
  add column if not exists min_part_mm text;

-- ─── 4. finish_unit 'part' ──────────────────────────────────────────────────
alter type public.finish_unit add value if not exists 'part';

-- ─── 5. rate_leadtime ───────────────────────────────────────────────────────
create table if not exists public.rate_leadtime (
  id uuid primary key default gen_random_uuid(),
  rate_version_id uuid not null references public.rate_versions (id) on delete cascade,
  working_days integer not null check (working_days > 0),
  multiplier numeric(8,4) not null check (multiplier > 0),
  placeholder boolean not null default true,
  unique (rate_version_id, working_days)
);
create index if not exists rate_leadtime_version_idx on public.rate_leadtime (rate_version_id);

alter table public.rate_leadtime enable row level security;
drop policy if exists rate_leadtime_select on public.rate_leadtime;
drop policy if exists rate_leadtime_admin_write on public.rate_leadtime;
create policy rate_leadtime_select on public.rate_leadtime for select to authenticated using (true);
create policy rate_leadtime_admin_write on public.rate_leadtime for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop trigger if exists rate_leadtime_immutable on public.rate_leadtime;
create trigger rate_leadtime_immutable before update or delete on public.rate_leadtime
  for each row execute function public.forbid_rate_edit_if_used();

-- ─── 6. quotes ──────────────────────────────────────────────────────────────
alter table public.quotes
  add column if not exists cost_rate_version_id uuid references public.rate_versions (id) on delete restrict,
  add column if not exists lead_time_days integer not null default 11;  -- [CONFIRM] default promised lead time (working days)
alter table public.quotes drop constraint if exists quotes_lead_time_days_check;
alter table public.quotes add constraint quotes_lead_time_days_check check (lead_time_days > 0);
create index if not exists quotes_cost_rate_version_idx on public.quotes (cost_rate_version_id);

-- ─── 7. Functions ───────────────────────────────────────────────────────────
-- A version is immutable once any quote prices with it OR compares against it.
create or replace function public.forbid_rate_edit_if_used()
returns trigger language plpgsql as $$
declare
  v_version uuid := coalesce(new.rate_version_id, old.rate_version_id);
begin
  if exists (
    select 1 from public.quotes
    where rate_version_id = v_version or cost_rate_version_id = v_version
  ) then
    raise exception 'rate version % is referenced by quotes and is immutable — create a new version', v_version;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.clone_rate_version(p_source uuid, p_label text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_new uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  insert into public.rate_versions (label, created_by, active)
  values (p_label, auth.uid(), false) returning id into v_new;

  insert into public.rate_general (
    rate_version_id, machine_rate_eur_h, labour_rate_eur_h, machining_rate_eur_h, default_margin_pct,
    margin_by_class, blank_margin_mm, slow_contour_factor, default_stitch_bead_mm, default_stitch_pitch_mm,
    handling_mass_limit_kg, handling_surcharge_eur, weld_handling_per_part, placeholder,
    order_charge_eur, packaging_box_eur, packaging_pallet_eur, pricing_mode
  )
    select v_new, machine_rate_eur_h, labour_rate_eur_h, machining_rate_eur_h, default_margin_pct,
      margin_by_class, blank_margin_mm, slow_contour_factor, default_stitch_bead_mm, default_stitch_pitch_mm,
      handling_mass_limit_kg, handling_surcharge_eur, weld_handling_per_part, placeholder,
      order_charge_eur, packaging_box_eur, packaging_pallet_eur, pricing_mode
    from public.rate_general where rate_version_id = p_source;
  insert into public.materials (rate_version_id, code, name, family, density_kg_m3, rm_n_mm2, price_per_kg, sheet_formats, scrap_pct_default, placeholder)
    select v_new, code, name, family, density_kg_m3, rm_n_mm2, price_per_kg, sheet_formats, scrap_pct_default, placeholder
    from public.materials where rate_version_id = p_source;
  insert into public.rate_laser (rate_version_id, material_code, thickness_mm, mode, speed_m_min, pierce_s, price_per_m, price_per_pierce, gas, min_contour_mm, in_house, supplier, placeholder, setup_eur)
    select v_new, material_code, thickness_mm, mode, speed_m_min, pierce_s, price_per_m, price_per_pierce, gas, min_contour_mm, in_house, supplier, placeholder, setup_eur
    from public.rate_laser where rate_version_id = p_source;
  insert into public.rate_tube_laser (rate_version_id, profile_family, wall_mm, price_per_m_cut, handling_per_part, setup, placeholder)
    select v_new, profile_family, wall_mm, price_per_m_cut, handling_per_part, setup, placeholder
    from public.rate_tube_laser where rate_version_id = p_source;
  insert into public.rate_bend (rate_version_id, thickness_mm, length_class_mm, price_per_bend, setup_per_part_type, placeholder)
    select v_new, thickness_mm, length_class_mm, price_per_bend, setup_per_part_type, placeholder
    from public.rate_bend where rate_version_id = p_source;
  insert into public.rate_roll (rate_version_id, thickness_mm, radius_class_mm, price_per_m, setup, placeholder)
    select v_new, thickness_mm, radius_class_mm, price_per_m, setup, placeholder
    from public.rate_roll where rate_version_id = p_source;
  insert into public.rate_weld (rate_version_id, process, bead_mm, price_per_mm, setup, min_order, placeholder)
    select v_new, process, bead_mm, price_per_mm, setup, min_order, placeholder
    from public.rate_weld where rate_version_id = p_source;
  insert into public.rate_thread (rate_version_id, size, price_each, placeholder)
    select v_new, size, price_each, placeholder from public.rate_thread where rate_version_id = p_source;
  insert into public.rate_feature (rate_version_id, code, name, price_each, placeholder)
    select v_new, code, name, price_each, placeholder from public.rate_feature where rate_version_id = p_source;
  insert into public.rate_finish (rate_version_id, code, name, unit, price, minimum, placeholder, setup_per_order_eur, min_part_mm)
    select v_new, code, name, unit, price, minimum, placeholder, setup_per_order_eur, min_part_mm
    from public.rate_finish where rate_version_id = p_source;
  insert into public.rate_leadtime (rate_version_id, working_days, multiplier, placeholder)
    select v_new, working_days, multiplier, placeholder from public.rate_leadtime where rate_version_id = p_source;

  return v_new;
end $$;
