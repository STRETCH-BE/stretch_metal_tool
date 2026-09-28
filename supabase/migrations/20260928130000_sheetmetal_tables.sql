-- ============================================================================
-- Sheet-metal import: bend table (versioned), press-brake tooling, hardware
-- names, the production DXF link on parts and the bend-table pin on quotes
-- File path: /supabase/migrations/20260928130000_sheetmetal_tables.sql
--
-- bend_table_versions / bend_table: the bend allowance per (material
-- family, thickness, inner radius, V die, angle) that unfolds a STEP sheet
-- part. Versioned like the rate tables (one active version, clone to edit,
-- immutable once a quote pins it) so a quote keeps the flat sizes it was
-- priced with. Rows marked source = 'din6935' come from the DIN formula
-- (k = 0.65 + 0.5·log10(r/t), capped at 1 for r/t > 5; BA = angle_rad ×
-- (r + k·t/2)) and keep the amber BEND_DEDUCTION_UNVERIFIED flag; a
-- 'test_bend' row (measured on the press brake) clears it.
--
-- press_brake_tools: punches (height, straight | gooseneck, tip radius,
-- throat depth) and dies (V, minimum flange) for the DFM rules
-- FLANGE_TOO_SHORT and BEND_COLLISION. Not versioned (like machines).
-- Seeded with PLACEHOLDERS marked placeholder = true — replace with the
-- real tooling.
--
-- hardware_names: PRODUCT-name substrings of hardware bodies in customer
-- STEP files → hardware type, size and the rate_feature code that prices
-- them (null = not benchmarked → red flag with the quantity).
--
-- parts.flat_file_id: the production DXF written from the unfolded model
-- (files row, kind export_dxf). quotes.bend_table_version_id: the bend
-- table version the flat patterns of the quote were computed with.
-- ============================================================================

-- ─── Bend table versions ───────────────────────────────────────────────────
create table if not exists public.bend_table_versions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  active boolean not null default false
);
create unique index if not exists bend_table_versions_one_active on public.bend_table_versions (active) where active;

create table if not exists public.bend_table (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.bend_table_versions (id) on delete cascade,
  material_family public.material_family not null,
  thickness_mm numeric(6,2) not null check (thickness_mm > 0),
  inner_radius_mm numeric(6,2) not null check (inner_radius_mm >= 0),
  v_die_mm numeric(6,2) check (v_die_mm is null or v_die_mm > 0),
  angle_deg numeric(6,2) not null check (angle_deg > 0 and angle_deg < 180),
  bend_allowance_mm numeric(8,4) not null check (bend_allowance_mm >= 0),
  source text not null default 'din6935' check (source in ('din6935', 'test_bend')),
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (version_id, material_family, thickness_mm, inner_radius_mm, angle_deg)
);
create index if not exists bend_table_version_idx on public.bend_table (version_id);

alter table public.bend_table_versions enable row level security;
alter table public.bend_table enable row level security;
drop policy if exists bend_table_versions_select on public.bend_table_versions;
create policy bend_table_versions_select on public.bend_table_versions for select to authenticated using (true);
drop policy if exists bend_table_versions_admin_write on public.bend_table_versions;
create policy bend_table_versions_admin_write on public.bend_table_versions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists bend_table_select on public.bend_table;
create policy bend_table_select on public.bend_table for select to authenticated using (true);
drop policy if exists bend_table_admin_write on public.bend_table;
create policy bend_table_admin_write on public.bend_table for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.quotes
  add column if not exists bend_table_version_id uuid references public.bend_table_versions (id) on delete set null;

-- A version pinned by a quote is immutable (same rule as the rate tables).
create or replace function public.forbid_bend_table_edit_if_used()
returns trigger language plpgsql as $$
declare
  v_version uuid;
begin
  v_version := coalesce(old.version_id, new.version_id);
  if exists (select 1 from public.quotes q where q.bend_table_version_id = v_version) then
    raise exception 'bend table version % is immutable: a quote is priced with it', v_version;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists bend_table_immutable on public.bend_table;
create trigger bend_table_immutable before update or delete on public.bend_table
  for each row execute function public.forbid_bend_table_edit_if_used();

create or replace function public.activate_bend_table_version(p_version uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from public.bend_table_versions where id = p_version) then
    raise exception 'bend table version % does not exist', p_version;
  end if;
  update public.bend_table_versions set active = false where active;
  update public.bend_table_versions set active = true where id = p_version;
end $$;

create or replace function public.clone_bend_table_version(p_source uuid, p_label text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_new uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  insert into public.bend_table_versions (label, note, created_by, active)
  values (p_label, 'cloned from ' || p_source::text, auth.uid(), false)
  returning id into v_new;
  insert into public.bend_table (version_id, material_family, thickness_mm, inner_radius_mm, v_die_mm, angle_deg, bend_allowance_mm, source, note, created_by)
  select v_new, material_family, thickness_mm, inner_radius_mm, v_die_mm, angle_deg, bend_allowance_mm, source, note, auth.uid()
  from public.bend_table where version_id = p_source;
  return v_new;
end $$;

-- ─── Press-brake tooling ───────────────────────────────────────────────────
create table if not exists public.press_brake_tools (
  code text primary key,
  kind text not null check (kind in ('punch', 'die')),
  name text not null,
  height_mm numeric(7,2) check (height_mm is null or height_mm > 0),
  type text check (type is null or type in ('straight', 'gooseneck')),
  tip_radius_mm numeric(6,2) check (tip_radius_mm is null or tip_radius_mm >= 0),
  throat_depth_mm numeric(7,2) check (throat_depth_mm is null or throat_depth_mm >= 0),
  v_mm numeric(6,2) check (v_mm is null or v_mm > 0),
  min_flange_mm numeric(6,2) check (min_flange_mm is null or min_flange_mm >= 0),
  placeholder boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint press_brake_tools_shape check (
    (kind = 'punch' and height_mm is not null and type is not null and v_mm is null)
    or (kind = 'die' and v_mm is not null and min_flange_mm is not null and height_mm is null)
  )
);
alter table public.press_brake_tools enable row level security;
drop policy if exists press_brake_tools_select on public.press_brake_tools;
create policy press_brake_tools_select on public.press_brake_tools for select to authenticated using (true);
drop policy if exists press_brake_tools_admin_write on public.press_brake_tools;
create policy press_brake_tools_admin_write on public.press_brake_tools for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ─── Hardware names ────────────────────────────────────────────────────────
create table if not exists public.hardware_names (
  id uuid primary key default gen_random_uuid(),
  pattern text not null unique,
  kind text not null check (kind in ('weld_stud', 'insert', 'unknown')),
  size text not null,
  feature_code text,
  note text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.hardware_names enable row level security;
drop policy if exists hardware_names_select on public.hardware_names;
create policy hardware_names_select on public.hardware_names for select to authenticated using (true);
drop policy if exists hardware_names_admin_write on public.hardware_names;
create policy hardware_names_admin_write on public.hardware_names for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ─── Parts: production DXF ─────────────────────────────────────────────────
alter table public.parts
  add column if not exists flat_file_id uuid references public.files (id) on delete set null;

-- ─── Seed ──────────────────────────────────────────────────────────────────
-- DIN 6935 allowances for mild steel, 90°, inner radius = our standard
-- punch radii, V = 8 × t. Every row is a formula value (source din6935),
-- so the flat sizes stay amber until a test bend replaces the row.
-- Punch radii per thickness are PLACEHOLDERS: -- [CONFIRM]
insert into public.bend_table_versions (id, label, note, active)
values ('5b1e0000-0000-4000-8000-000000000001', 'DIN 6935 seed', 'Formula values; replace with test bends', true)
on conflict (id) do nothing;

insert into public.bend_table (version_id, material_family, thickness_mm, inner_radius_mm, v_die_mm, angle_deg, bend_allowance_mm, source, note)
select '5b1e0000-0000-4000-8000-000000000001', 'mild_steel', t, r, 8 * t, 90,
  round((pi() / 2 * (r + least(1, 0.65 + 0.5 * log(r / t)) * t / 2))::numeric, 4),
  'din6935', 'DIN 6935 formula, r = standard punch radius -- [CONFIRM]'
from (values (1.0, 0.8), (1.5, 1.0), (2.0, 1.0), (3.0, 1.5), (4.0, 2.0), (5.0, 2.5), (6.0, 3.0)) as v(t, r)
on conflict (version_id, material_family, thickness_mm, inner_radius_mm, angle_deg) do nothing;

-- Press-brake tooling PLACEHOLDERS: -- [CONFIRM] every row against the real tool cabinet.
insert into public.press_brake_tools (code, kind, name, height_mm, type, tip_radius_mm, throat_depth_mm, v_mm, min_flange_mm, placeholder) values
  ('punch-straight-120', 'punch', 'Straight punch 120 mm (placeholder)', 120, 'straight', 1.0, null, null, null, true),
  ('punch-straight-200', 'punch', 'Straight punch 200 mm (placeholder)', 200, 'straight', 1.0, null, null, null, true),
  ('punch-gooseneck-120', 'punch', 'Gooseneck punch 120 mm, throat 60 mm (placeholder)', 120, 'gooseneck', 1.0, 60, null, null, true),
  ('die-v6', 'die', 'Die V6 (placeholder)', null, null, null, null, 6, 4.5, true),
  ('die-v8', 'die', 'Die V8 (placeholder)', null, null, null, null, 8, 6, true),
  ('die-v12', 'die', 'Die V12 (placeholder)', null, null, null, null, 12, 9, true),
  ('die-v16', 'die', 'Die V16 (placeholder)', null, null, null, null, 16, 12, true),
  ('die-v24', 'die', 'Die V24 (placeholder)', null, null, null, null, 24, 18, true),
  ('die-v32', 'die', 'Die V32 (placeholder)', null, null, null, null, 32, 24, true),
  ('die-v40', 'die', 'Die V40 (placeholder)', null, null, null, null, 40, 30, true),
  ('die-v48', 'die', 'Die V48 (placeholder)', null, null, null, null, 48, 36, true)
on conflict (code) do nothing;

-- Hardware names seen in SST files (C2G press-in inserts).
insert into public.hardware_names (pattern, kind, size, feature_code, note) values
  ('ACAO470ZP', 'insert', 'M4', 'insert_m4', 'C2G blind press-in insert M4'),
  ('ACAO610ZP', 'insert', 'M6', 'insert_m6', 'C2G blind press-in insert M6')
on conflict (pattern) do nothing;
