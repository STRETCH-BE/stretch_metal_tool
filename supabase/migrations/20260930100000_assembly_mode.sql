-- ============================================================================
-- Assembly mode: welded assemblies with seams at assembly level, forming
-- operations on items, customer type (B2B/B2C) + contact + requested terms,
-- quote reference / contact / shipping / price scale, and the admin-edited
-- settings tables (company data, VAT rates, packaging, shipping, job setups,
-- assembly labour rates, weld speeds).
-- File path: /supabase/migrations/20260930100000_assembly_mode.sql
--
-- Design: docs/assembly-mode-design.md. Every seeded rate is a CALIBRATION
-- PLACEHOLDER (placeholder = true, -- [CONFIRM]) tuned so the heat-store-box
-- regression case gives ≈ 3.6 h of welding + fit-up and €270–340 net.
-- ============================================================================

-- ─── Customers: type, contact person, requested terms ──────────────────────
do $$ begin
  create type public.customer_type as enum ('b2b', 'b2c');
exception when duplicate_object then null; end $$;

alter table public.customers
  add column if not exists customer_type public.customer_type not null default 'b2b',
  add column if not exists contact_person text,
  add column if not exists requested_terms text;

-- ─── Quotes: inquiry reference, contact, shipping, price scale ─────────────
alter table public.quotes
  add column if not exists customer_reference text,
  add column if not exists contact_person text,
  add column if not exists shipping jsonb,
  add column if not exists price_scale integer[] not null default '{}';

-- ─── Assemblies ────────────────────────────────────────────────────────────
create table if not exists public.assemblies (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  position integer not null default 0,
  name text not null,
  drawing_ref text,
  qty integer not null default 1 check (qty > 0),
  material_code text,
  thickness_mm numeric(8,3) check (thickness_mm is null or thickness_mm > 0),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists assemblies_quote_idx on public.assemblies (quote_id);

alter table public.quote_items
  add column if not exists assembly_id uuid references public.assemblies (id) on delete cascade,
  add column if not exists qty_per_assembly integer not null default 1 check (qty_per_assembly > 0),
  add column if not exists material_override boolean not null default false,
  add column if not exists material_note text,
  add column if not exists forming jsonb not null default '[]'::jsonb;
create index if not exists quote_items_assembly_idx on public.quote_items (assembly_id);

create table if not exists public.assembly_seams (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references public.assemblies (id) on delete cascade,
  position integer not null default 0,
  label text,
  part_id uuid references public.parts (id) on delete set null,
  entity_ids text[] not null default '{}',
  points jsonb,
  length_mm numeric(10,2) not null check (length_mm >= 0),
  process public.weld_process not null default 'mig_mag',
  thickness_mm numeric(8,3) check (thickness_mm is null or thickness_mm > 0),
  seam_type text not null default 'continuous' check (seam_type in ('continuous', 'stitch', 'tack')),
  stitch_bead_mm numeric(8,2) check (stitch_bead_mm is null or stitch_bead_mm > 0),
  stitch_pitch_mm numeric(8,2) check (stitch_pitch_mm is null or stitch_pitch_mm > 0),
  tack_count integer check (tack_count is null or tack_count >= 0),
  sides integer not null default 1 check (sides in (1, 2)),
  paired_seam_id uuid references public.assembly_seams (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists assembly_seams_assembly_idx on public.assembly_seams (assembly_id);

alter table public.assemblies enable row level security;
alter table public.assembly_seams enable row level security;
drop policy if exists assemblies_select on public.assemblies;
create policy assemblies_select on public.assemblies for select to authenticated using (true);
drop policy if exists assemblies_write on public.assemblies;
create policy assemblies_write on public.assemblies for all to authenticated
  using (public.can_edit_quote(quote_id)) with check (public.can_edit_quote(quote_id));
drop policy if exists assembly_seams_select on public.assembly_seams;
create policy assembly_seams_select on public.assembly_seams for select to authenticated using (true);
drop policy if exists assembly_seams_write on public.assembly_seams;
create policy assembly_seams_write on public.assembly_seams for all to authenticated
  using (exists (select 1 from public.assemblies a where a.id = assembly_id and public.can_edit_quote(a.quote_id)))
  with check (exists (select 1 from public.assemblies a where a.id = assembly_id and public.can_edit_quote(a.quote_id)));

-- ─── Admin settings tables (non-versioned; admin edits, everyone reads) ────
create table if not exists public.company_settings (
  id smallint primary key default 1 check (id = 1),
  brand text not null default 'STRETCHMETAL',
  legal_name text not null default '',
  street text not null default '',
  postal_code text not null default '',
  city text not null default '',
  country char(2) not null default 'PL',
  phone text not null default '',
  email text not null default '',
  website text not null default '',
  nip text not null default '',
  regon text not null default '',
  krs text not null default '',
  bank_name text not null default '',
  iban_pln text not null default '',
  iban_eur text not null default '',
  swift text not null default '',
  oss_active boolean not null default false,
  assembly_margin_pct numeric(6,2) not null default 30 check (assembly_margin_pct >= 0 and assembly_margin_pct < 100),
  subcontract_margin_pct numeric(6,2) not null default 15 check (subcontract_margin_pct >= 0 and subcontract_margin_pct < 100),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.vat_rates (
  country char(2) primary key,
  rate_pct numeric(5,2) not null check (rate_pct >= 0 and rate_pct < 100),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.packaging_rates (
  code text primary key,
  name text not null,
  max_side_mm numeric(8,1) not null check (max_side_mm > 0),
  max_mass_kg numeric(8,2) not null check (max_mass_kg > 0),
  price_eur numeric(12,4) not null check (price_eur >= 0),
  position integer not null default 0,
  placeholder boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  country char(2) not null,
  max_kg numeric(8,2) not null check (max_kg > 0),
  price_eur numeric(12,4) not null check (price_eur >= 0),
  carrier text,
  position integer not null default 0,
  placeholder boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (country, max_kg)
);

create table if not exists public.job_setup_rates (
  code text primary key check (code in ('laser_nest', 'press_brake', 'roll', 'weld_fitup')),
  name text not null,
  cost_eur numeric(12,4) not null check (cost_eur >= 0),
  placeholder boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.assembly_rates (
  id smallint primary key default 1 check (id = 1),
  labour_rate_eur_h numeric(10,4) not null default 25 check (labour_rate_eur_h >= 0),
  gas_wire_eur_h numeric(10,4) not null default 8 check (gas_wire_eur_h >= 0),
  tack_seconds numeric(8,2) not null default 60 check (tack_seconds >= 0),
  fitup_min_per_part numeric(8,2) not null default 6 check (fitup_min_per_part >= 0),
  deburr_min_per_part numeric(8,2) not null default 1.5 check (deburr_min_per_part >= 0),
  handling_min_per_assembly numeric(8,2) not null default 10 check (handling_min_per_assembly >= 0),
  distortion_factor numeric(6,3) not null default 1.3 check (distortion_factor >= 1),
  step_bend_seconds_per_hit numeric(8,2) not null default 25 check (step_bend_seconds_per_hit >= 0),
  roll_min_per_m numeric(8,2) not null default 6 check (roll_min_per_m >= 0),
  placeholder boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.weld_speeds (
  id uuid primary key default gen_random_uuid(),
  process public.weld_process not null,
  thickness_mm numeric(8,3) not null check (thickness_mm > 0),
  speed_mm_min numeric(8,2) not null check (speed_mm_min > 0),
  placeholder boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (process, thickness_mm)
);

do $$
declare t text;
begin
  foreach t in array array['company_settings', 'vat_rates', 'packaging_rates', 'shipping_rates', 'job_setup_rates', 'assembly_rates', 'weld_speeds'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_admin_write on public.%I', t, t);
    execute format('create policy %I_admin_write on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ─── Seeds ─────────────────────────────────────────────────────────────────
-- Company data as given by the owner on 29 Sep 2026 (one bank account: printed for PLN and EUR alike).
insert into public.company_settings (id, brand, legal_name, street, postal_code, city, country, phone, email, website, nip, regon, krs, bank_name, iban_pln, iban_eur, swift)
values (1, 'STRETCHMETAL', 'Alto Design Sp. z o.o.', 'ul. Legionów 59', '42-200', 'Częstochowa', 'PL', '+32 485 48 30 35', 'info@stretchmetal.pl', 'https://stretchmetal.pl',
        'PL5732911703', '383390837', '0000786996', 'ING Bank Śląski', 'PL05 1050 1142 1000 0090 3188 9240', 'PL05 1050 1142 1000 0090 3188 9240', 'INGBPLPW')
on conflict (id) do nothing;

insert into public.vat_rates (country, rate_pct) values
  ('PL', 23), ('FI', 25.5), ('BE', 21), ('NL', 21), ('DE', 19), ('AT', 20), ('FR', 20)
on conflict (country) do nothing;

-- Packaging by packed size and gross mass -- [CONFIRM] every price
insert into public.packaging_rates (code, name, max_side_mm, max_mass_kg, price_eur, position) values
  ('carton', 'Carton', 400, 5, 2.75, 1),
  ('carton_foam', 'Carton with foam', 600, 15, 6.50, 2),
  ('crate', 'Wooden crate', 1200, 60, 24.00, 3),
  ('pallet', 'Pallet', 3000, 1000, 36.78, 4)
on conflict (code) do nothing;

-- Carrier bands per destination -- [CONFIRM] every price (placeholders)
insert into public.shipping_rates (country, max_kg, price_eur, carrier, position)
select c, kg, price, carrier, pos from (values
  ('PL', 5, 9.00, 'courier', 1), ('PL', 30, 18.00, 'courier', 2), ('PL', 100, 45.00, 'pallet', 3), ('PL', 1000, 120.00, 'pallet', 4),
  ('DE', 5, 15.00, 'courier', 1), ('DE', 30, 35.00, 'courier', 2), ('DE', 100, 90.00, 'pallet', 3), ('DE', 1000, 260.00, 'pallet', 4),
  ('AT', 5, 15.00, 'courier', 1), ('AT', 30, 35.00, 'courier', 2), ('AT', 100, 90.00, 'pallet', 3), ('AT', 1000, 260.00, 'pallet', 4),
  ('NL', 5, 15.00, 'courier', 1), ('NL', 30, 35.00, 'courier', 2), ('NL', 100, 90.00, 'pallet', 3), ('NL', 1000, 260.00, 'pallet', 4),
  ('BE', 5, 15.00, 'courier', 1), ('BE', 30, 35.00, 'courier', 2), ('BE', 100, 90.00, 'pallet', 3), ('BE', 1000, 260.00, 'pallet', 4),
  ('FR', 5, 15.00, 'courier', 1), ('FR', 30, 35.00, 'courier', 2), ('FR', 100, 90.00, 'pallet', 3), ('FR', 1000, 260.00, 'pallet', 4),
  ('FI', 5, 20.00, 'courier', 1), ('FI', 30, 45.00, 'courier', 2), ('FI', 100, 120.00, 'pallet', 3), ('FI', 1000, 320.00, 'pallet', 4)
) as v(c, kg, price, carrier, pos)
on conflict (country, max_kg) do nothing;

-- Job setups, once per operation per job -- [CONFIRM] (labour 25 €/h: 42 / 56 / 56 / 30 min)
insert into public.job_setup_rates (code, name, cost_eur) values
  ('laser_nest', 'Laser nest set-up (per material / thickness)', 17.50),
  ('press_brake', 'Press-brake tooling set-up', 23.33),
  ('roll', 'Plate roll set-up', 23.33),
  ('weld_fitup', 'Welding and fit-up set-up (per assembly type)', 12.50)
on conflict (code) do nothing;

-- Assembly labour: CALIBRATION PLACEHOLDERS -- [CONFIRM] (heat store box rev 3 ≈ 3.6 h)
insert into public.assembly_rates (id) values (1) on conflict (id) do nothing;

-- Effective weld speeds incl. stops and repositioning -- [CONFIRM] (calibration placeholders)
insert into public.weld_speeds (process, thickness_mm, speed_mm_min) values
  ('mig_mag', 1, 150), ('mig_mag', 2, 120), ('mig_mag', 3, 100), ('mig_mag', 4, 80), ('mig_mag', 6, 60),
  ('tig', 1, 60), ('tig', 2, 50), ('tig', 3, 40),
  ('laser', 1, 400), ('laser', 2, 300), ('laser', 3, 250),
  ('mma', 3, 60), ('mma', 6, 45)
on conflict (process, thickness_mm) do nothing;
