-- ============================================================================
-- StretchMetal quoting tool — initial schema
-- File path: /supabase/migrations/20260925000000_init.sql
--
-- Every table has row-level security. Roles come from public.profiles.role
-- (admin | sales | viewer). Rate tables are immutable per rate_version:
-- editing creates a new version (copy rows → edit → activate). Quotes pin
-- the rate_version_id they were priced with and also store the priced
-- result (quotes.pricing) so reopening an old quote shows the old price.
--
-- Money in rate tables is EUR. Quotes store currency + fx_rate used.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ─── Enums ──────────────────────────────────────────────────────────────────
create type public.user_role as enum ('admin', 'sales', 'viewer');
create type public.user_locale as enum ('pl', 'en');
create type public.quote_type as enum ('fabrication', 'welding_only');
create type public.quote_status as enum ('draft', 'pending_override', 'sent', 'won', 'lost');
create type public.currency_code as enum ('PLN', 'EUR');
create type public.part_source as enum ('dxf', 'pdf', 'step', 'manual', 'welding_drawing');
create type public.laser_mode as enum ('time', 'per_m');
create type public.weld_process as enum ('mig_mag', 'tig', 'laser', 'mma');
create type public.finish_unit as enum ('m2', 'kg', 'm', 'each');
create type public.machine_kind as enum ('flat_laser', 'tube_laser', 'press_brake', 'roll', 'weld');
create type public.override_status as enum ('pending', 'approved', 'rejected');
create type public.material_family as enum ('mild_steel', 'stainless', 'aluminium', 'brass', 'copper');
create type public.tube_profile_family as enum ('round', 'square', 'rectangular', 'open');
create type public.file_kind as enum ('dxf', 'pdf', 'step', 'export_dxf', 'thumbnail', 'quote_pdf', 'other');

-- ─── Helpers ────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ─── Profiles ───────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'sales',
  locale public.user_locale not null default 'pl',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Role lookup for RLS — SECURITY DEFINER so policies on profiles do not recurse.
create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'sales') from public.profiles where id = auth.uid()), false)
$$;

-- New auth user → profile row. Role/locale can be passed in raw_user_meta_data
-- by the admin invite ({"role":"sales","locale":"pl","full_name":"…"}).
-- The first profile ever created is promoted to admin (bootstrap).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role := 'sales';
  v_locale public.user_locale := 'pl';
begin
  begin
    v_role := coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'sales');
  exception when others then v_role := 'sales';
  end;
  begin
    v_locale := coalesce((new.raw_user_meta_data ->> 'locale')::public.user_locale, 'pl');
  exception when others then v_locale := 'pl';
  end;
  -- Bootstrap: the very first account becomes the admin (there is no other
  -- way to promote a user before an admin exists).
  if not exists (select 1 from public.profiles) then
    v_role := 'admin';
  end if;
  insert into public.profiles (id, email, full_name, role, locale)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name', v_role, v_locale)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Customers ──────────────────────────────────────────────────────────────
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vat_id text,
  country char(2) not null default 'PL',
  address text,
  email text,
  phone text,
  customer_class text not null default 'standard',
  preferred_locale public.user_locale,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_name_idx on public.customers (lower(name));
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- ─── Rate versions + rate tables (immutable per version) ───────────────────
create table public.rate_versions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  active boolean not null default false
);
create unique index rate_versions_one_active on public.rate_versions (active) where active;

create table public.rate_general (
  rate_version_id uuid primary key references public.rate_versions (id) on delete cascade,
  machine_rate_eur_h numeric(12,4) not null,
  labour_rate_eur_h numeric(12,4) not null,
  machining_rate_eur_h numeric(12,4) not null,
  default_margin_pct numeric(6,2) not null,
  margin_by_class jsonb not null default '{}'::jsonb,
  blank_margin_mm numeric(8,2) not null default 10,
  slow_contour_factor numeric(6,3) not null default 1.5,
  default_stitch_bead_mm numeric(8,2) not null default 30,
  default_stitch_pitch_mm numeric(8,2) not null default 60,
  handling_mass_limit_kg numeric(8,2) not null default 25,
  handling_surcharge_eur numeric(12,4) not null default 0,
  -- Welding-only quotes: handling per customer-supplied part (EUR).
  weld_handling_per_part numeric(12,4) not null default 0,
  placeholder boolean not null default true
);

create table public.materials (
  rate_version_id uuid not null references public.rate_versions (id) on delete cascade,
  code text not null,
  name text not null,
  family public.material_family not null,
  density_kg_m3 numeric(10,2) not null,
  rm_n_mm2 numeric(10,2) not null,
  -- [{"maxThicknessMm": 3, "pricePerKg": 1.2}, …] ascending bands
  price_per_kg jsonb not null default '[]'::jsonb,
  -- [{"lengthMm": 3000, "widthMm": 1500}, …]
  sheet_formats jsonb not null default '[]'::jsonb,
  scrap_pct_default numeric(6,2) not null default 25,
  placeholder boolean not null default true,
  primary key (rate_version_id, code)
);

create table public.rate_laser (
  id uuid primary key default gen_random_uuid(),
  rate_version_id uuid not null references public.rate_versions (id) on delete cascade,
  material_code text not null,
  thickness_mm numeric(8,3) not null,
  mode public.laser_mode not null default 'time',
  speed_m_min numeric(10,4),
  pierce_s numeric(10,4),
  price_per_m numeric(12,4),
  price_per_pierce numeric(12,4) not null default 0,
  gas text,
  min_contour_mm numeric(8,2),
  in_house boolean not null default true,
  supplier text,
  placeholder boolean not null default true,
  unique (rate_version_id, material_code, thickness_mm, in_house),
  foreign key (rate_version_id, material_code) references public.materials (rate_version_id, code) on delete cascade
);

create table public.rate_tube_laser (
  id uuid primary key default gen_random_uuid(),
  rate_version_id uuid not null references public.rate_versions (id) on delete cascade,
  profile_family public.tube_profile_family not null,
  wall_mm numeric(8,3) not null,
  price_per_m_cut numeric(12,4) not null,
  handling_per_part numeric(12,4) not null default 0,
  setup numeric(12,4) not null default 0,
  placeholder boolean not null default true,
  unique (rate_version_id, profile_family, wall_mm)
);

create table public.rate_bend (
  id uuid primary key default gen_random_uuid(),
  rate_version_id uuid not null references public.rate_versions (id) on delete cascade,
  thickness_mm numeric(8,3) not null,
  length_class_mm numeric(10,2) not null,
  price_per_bend numeric(12,4) not null,
  setup_per_part_type numeric(12,4) not null default 0,
  placeholder boolean not null default true,
  unique (rate_version_id, thickness_mm, length_class_mm)
);

create table public.rate_roll (
  id uuid primary key default gen_random_uuid(),
  rate_version_id uuid not null references public.rate_versions (id) on delete cascade,
  thickness_mm numeric(8,3) not null,
  radius_class_mm numeric(10,2) not null,
  price_per_m numeric(12,4) not null,
  setup numeric(12,4) not null default 0,
  placeholder boolean not null default true,
  unique (rate_version_id, thickness_mm, radius_class_mm)
);

create table public.rate_weld (
  id uuid primary key default gen_random_uuid(),
  rate_version_id uuid not null references public.rate_versions (id) on delete cascade,
  process public.weld_process not null,
  bead_mm numeric(8,2) not null,
  price_per_mm numeric(12,6) not null,
  setup numeric(12,4) not null default 0,
  min_order numeric(12,4) not null default 0,
  placeholder boolean not null default true,
  unique (rate_version_id, process, bead_mm)
);

create table public.rate_thread (
  id uuid primary key default gen_random_uuid(),
  rate_version_id uuid not null references public.rate_versions (id) on delete cascade,
  size text not null,
  price_each numeric(12,4) not null,
  placeholder boolean not null default true,
  unique (rate_version_id, size)
);

create table public.rate_feature (
  id uuid primary key default gen_random_uuid(),
  rate_version_id uuid not null references public.rate_versions (id) on delete cascade,
  code text not null,
  name text not null,
  price_each numeric(12,4) not null,
  placeholder boolean not null default true,
  unique (rate_version_id, code)
);

create table public.rate_finish (
  id uuid primary key default gen_random_uuid(),
  rate_version_id uuid not null references public.rate_versions (id) on delete cascade,
  code text not null,
  name text not null,
  unit public.finish_unit not null,
  price numeric(12,4) not null,
  minimum numeric(12,4) not null default 0,
  placeholder boolean not null default true,
  unique (rate_version_id, code)
);

-- ─── Machines (limits as data) ──────────────────────────────────────────────
create table public.machines (
  code text primary key,
  name text not null,
  kind public.machine_kind not null,
  limits jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger machines_updated_at before update on public.machines
  for each row execute function public.set_updated_at();

-- ─── Files (originals + exports in the private bucket quote-files) ─────────
create table public.files (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  original_name text not null,
  mime text not null,
  size bigint not null,
  sha256 text not null,
  kind public.file_kind not null default 'other',
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index files_sha256_idx on public.files (sha256);

-- ─── Quotes ─────────────────────────────────────────────────────────────────
create table public.quote_counters (
  year integer primary key,
  last_number integer not null default 0
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  version integer not null default 1,
  type public.quote_type not null default 'fabrication',
  status public.quote_status not null default 'draft',
  customer_id uuid references public.customers (id) on delete set null,
  currency public.currency_code not null default 'PLN',
  fx_rate numeric(12,6) not null default 1,
  margin_pct numeric(6,2) not null default 30,
  validity_days integer not null default 30,
  lead_time_text text,
  payment_terms_text text,
  rate_version_id uuid references public.rate_versions (id) on delete restrict,
  geometry_locked boolean not null default false,
  subtotal_cost numeric(14,4) not null default 0,
  subtotal_price numeric(14,4) not null default 0,
  -- Full PricedQuote snapshot from the last server-side pricing run.
  pricing jsonb,
  -- Flags from the last pricing run (Flag[]), denormalised for list views.
  flags jsonb not null default '[]'::jsonb,
  show_operations_on_pdf boolean not null default false,
  welding_separate boolean not null default false,
  -- Welding-only quotes: {"seams": WeldingOnlySeam[], "partsCount": n}
  welding_only jsonb,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  priced_at timestamptz,
  sent_at timestamptz,
  decided_at timestamptz,
  unique (number, version)
);
create index quotes_customer_idx on public.quotes (customer_id);
create index quotes_status_idx on public.quotes (status);
create trigger quotes_updated_at before update on public.quotes
  for each row execute function public.set_updated_at();

-- SM-YYYY-NNNN — one counter per year, atomic.
create or replace function public.next_quote_number()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_year integer := extract(year from now())::integer;
  v_next integer;
begin
  insert into public.quote_counters (year, last_number) values (v_year, 1)
  on conflict (year) do update set last_number = public.quote_counters.last_number + 1
  returning last_number into v_next;
  return 'SM-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
end $$;

create table public.parts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  name text not null,
  source public.part_source not null,
  file_id uuid references public.files (id) on delete set null,
  pdf_file_id uuid references public.files (id) on delete set null,
  file_hash text,
  material_code text,
  thickness_mm numeric(8,3),
  geometry jsonb,
  annotations jsonb not null default '{}'::jsonb,
  triage jsonb,
  -- Compact SVG rendered server-side at analysis time (lists, PDF).
  thumbnail_svg text,
  -- Extracted companion PDF text and the AI suggestion object (never auto-applied).
  pdf_text text,
  ai_suggestions jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index parts_quote_idx on public.parts (quote_id);
create index parts_hash_idx on public.parts (file_hash);
create trigger parts_updated_at before update on public.parts
  for each row execute function public.set_updated_at();

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  part_id uuid not null references public.parts (id) on delete cascade,
  position integer not null default 0,
  qty integer not null default 1 check (qty > 0),
  unit_cost numeric(14,4) not null default 0,
  unit_price numeric(14,4) not null default 0,
  -- ExtraOperation[] added by the user (machining minutes, finish, features…)
  extras jsonb not null default '[]'::jsonb,
  scrap_pct numeric(6,2),
  flags jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  unique (quote_id, part_id)
);
create index quote_items_quote_idx on public.quote_items (quote_id);

create table public.operations (
  id uuid primary key default gen_random_uuid(),
  quote_item_id uuid not null references public.quote_items (id) on delete cascade,
  position integer not null default 0,
  type text not null,
  label text not null,
  driver_qty numeric(14,4) not null,
  driver_unit text not null,
  rate_ref jsonb not null default '{}'::jsonb,
  unit_cost numeric(14,4) not null,
  setup_share numeric(14,4) not null default 0,
  details jsonb not null default '{}'::jsonb,
  notes text,
  auto boolean not null default true
);
create index operations_item_idx on public.operations (quote_item_id);

-- ─── Overrides + audit ──────────────────────────────────────────────────────
create table public.overrides (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  part_id uuid references public.parts (id) on delete cascade,
  quote_item_id uuid references public.quote_items (id) on delete cascade,
  rule_code text not null,
  requested_by uuid references public.profiles (id) on delete set null,
  note text not null,
  status public.override_status not null default 'pending',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index overrides_quote_idx on public.overrides (quote_id);
create index overrides_status_idx on public.overrides (status);

create table public.audit_log (
  id bigserial primary key,
  actor uuid references public.profiles (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_at_idx on public.audit_log (at desc);

-- ─── Rate-version helpers (admin only, enforced inside) ────────────────────
-- Activate a version: exactly one active at a time.
create or replace function public.activate_rate_version(p_version uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  update public.rate_versions set active = false where active;
  update public.rate_versions set active = true where id = p_version;
end $$;

-- Copy every rate row of p_source into a new version and return its id.
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

  insert into public.rate_general select v_new, machine_rate_eur_h, labour_rate_eur_h, machining_rate_eur_h,
    default_margin_pct, margin_by_class, blank_margin_mm, slow_contour_factor, default_stitch_bead_mm,
    default_stitch_pitch_mm, handling_mass_limit_kg, handling_surcharge_eur, weld_handling_per_part, placeholder
    from public.rate_general where rate_version_id = p_source;
  insert into public.materials (rate_version_id, code, name, family, density_kg_m3, rm_n_mm2, price_per_kg, sheet_formats, scrap_pct_default, placeholder)
    select v_new, code, name, family, density_kg_m3, rm_n_mm2, price_per_kg, sheet_formats, scrap_pct_default, placeholder
    from public.materials where rate_version_id = p_source;
  insert into public.rate_laser (rate_version_id, material_code, thickness_mm, mode, speed_m_min, pierce_s, price_per_m, price_per_pierce, gas, min_contour_mm, in_house, supplier, placeholder)
    select v_new, material_code, thickness_mm, mode, speed_m_min, pierce_s, price_per_m, price_per_pierce, gas, min_contour_mm, in_house, supplier, placeholder
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
  insert into public.rate_finish (rate_version_id, code, name, unit, price, minimum, placeholder)
    select v_new, code, name, unit, price, minimum, placeholder from public.rate_finish where rate_version_id = p_source;

  return v_new;
end $$;

-- Rate rows of a version are immutable once the version has been used by a quote.
create or replace function public.forbid_rate_edit_if_used()
returns trigger language plpgsql as $$
declare
  v_version uuid := coalesce(new.rate_version_id, old.rate_version_id);
begin
  if exists (select 1 from public.quotes where rate_version_id = v_version) then
    raise exception 'rate version % is referenced by quotes and is immutable — create a new version', v_version;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['rate_general','materials','rate_laser','rate_tube_laser','rate_bend','rate_roll','rate_weld','rate_thread','rate_feature','rate_finish'] loop
    execute format('create trigger %I_immutable before update or delete on public.%I for each row execute function public.forbid_rate_edit_if_used()', t, t);
  end loop;
end $$;

-- ─── Row-level security ─────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.rate_versions enable row level security;
alter table public.rate_general enable row level security;
alter table public.materials enable row level security;
alter table public.rate_laser enable row level security;
alter table public.rate_tube_laser enable row level security;
alter table public.rate_bend enable row level security;
alter table public.rate_roll enable row level security;
alter table public.rate_weld enable row level security;
alter table public.rate_thread enable row level security;
alter table public.rate_feature enable row level security;
alter table public.rate_finish enable row level security;
alter table public.machines enable row level security;
alter table public.files enable row level security;
alter table public.quote_counters enable row level security;
alter table public.quotes enable row level security;
alter table public.parts enable row level security;
alter table public.quote_items enable row level security;
alter table public.operations enable row level security;
alter table public.overrides enable row level security;
alter table public.audit_log enable row level security;

-- profiles: everyone signed in reads names; users edit their own locale/name; admin everything.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles p where p.id = auth.uid()));
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- customers: all read; sales + admin write; admin delete.
create policy customers_select on public.customers for select to authenticated using (true);
create policy customers_insert on public.customers for insert to authenticated with check (public.can_write());
create policy customers_update on public.customers for update to authenticated using (public.can_write()) with check (public.can_write());
create policy customers_delete on public.customers for delete to authenticated using (public.is_admin());

-- rate tables + machines: all read; admin write.
do $$
declare t text;
begin
  foreach t in array array['rate_versions','rate_general','materials','rate_laser','rate_tube_laser','rate_bend','rate_roll','rate_weld','rate_thread','rate_feature','rate_finish','machines'] loop
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('create policy %I_admin_write on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;

-- files: all read (signed URLs are minted server-side); sales + admin insert; admin delete.
create policy files_select on public.files for select to authenticated using (true);
create policy files_insert on public.files for insert to authenticated with check (public.can_write() and uploaded_by = auth.uid());
create policy files_delete on public.files for delete to authenticated using (public.is_admin());

-- quotes: all read; sales create; sales edit own drafts; admin everything.
create policy quotes_select on public.quotes for select to authenticated using (true);
create policy quotes_insert on public.quotes for insert to authenticated with check (public.can_write() and created_by = auth.uid());
create policy quotes_update on public.quotes for update to authenticated
  using (public.is_admin() or (public.can_write() and created_by = auth.uid()))
  with check (public.is_admin() or (public.can_write() and created_by = auth.uid()));
create policy quotes_delete on public.quotes for delete to authenticated using (public.is_admin());

-- parts / items / operations follow their quote.
create or replace function public.can_edit_quote(p_quote uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.quotes q where q.id = p_quote and q.created_by = auth.uid() and public.can_write()
  )
$$;

create policy parts_select on public.parts for select to authenticated using (true);
create policy parts_write on public.parts for all to authenticated
  using (public.can_edit_quote(quote_id)) with check (public.can_edit_quote(quote_id));

create policy quote_items_select on public.quote_items for select to authenticated using (true);
create policy quote_items_write on public.quote_items for all to authenticated
  using (public.can_edit_quote(quote_id)) with check (public.can_edit_quote(quote_id));

create policy operations_select on public.operations for select to authenticated using (true);
create policy operations_write on public.operations for all to authenticated
  using (public.can_edit_quote((select quote_id from public.quote_items qi where qi.id = quote_item_id)))
  with check (public.can_edit_quote((select quote_id from public.quote_items qi where qi.id = quote_item_id)));

-- quote counters: only the SECURITY DEFINER function touches them.
create policy quote_counters_select on public.quote_counters for select to authenticated using (public.is_admin());

-- overrides: all read; sales request on their quotes; admin decides.
create policy overrides_select on public.overrides for select to authenticated using (true);
create policy overrides_insert on public.overrides for insert to authenticated
  with check (public.can_edit_quote(quote_id) and requested_by = auth.uid());
create policy overrides_update on public.overrides for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- audit log: admin reads; rows are written server-side with the service role.
create policy audit_select on public.audit_log for select to authenticated using (public.is_admin());

-- ─── Storage: private bucket, signed URLs only ─────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quote-files', 'quote-files', false, 26214400,
  array['application/dxf', 'image/vnd.dxf', 'application/octet-stream', 'application/pdf', 'model/step', 'application/step', 'application/x-step', 'text/plain', 'image/svg+xml']
)
on conflict (id) do nothing;

create policy quote_files_select on storage.objects for select to authenticated
  using (bucket_id = 'quote-files');
create policy quote_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'quote-files' and public.can_write());
create policy quote_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'quote-files' and public.is_admin());
