-- ============================================================================
-- Live rate editing: the ACTIVE rate version may be edited in place (the
-- owner changes a material or service price and it applies from the next
-- calculation). rate_versions.rates_updated_at is stamped by a trigger on
-- every versioned rate table, so a draft quote priced before the change is
-- stale and re-prices when opened; sent / won / lost quotes are never
-- re-priced and keep the prices stored in their pricing snapshot.
-- File path: /supabase/migrations/20260930120000_live_rate_editing.sql
--
-- Three parts: (1) rates_updated_at + the stamping triggers, also fired by
-- the admin settings tables (they price too); (2) the immutability rule
-- learns about live editing: the ACTIVE version and the current cost basis
-- may change while a retired version used by quotes stays locked;
-- (3) clone_rate_version copies every column of every rate table (the old
-- explicit lists predate the market columns and silently dropped them).
-- ============================================================================

alter table public.rate_versions
  add column if not exists rates_updated_at timestamptz;

create or replace function public.bump_rate_version_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rate_versions
     set rates_updated_at = now()
   where id = coalesce(new.rate_version_id, old.rate_version_id);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['materials', 'rate_general', 'rate_laser', 'rate_tube_laser', 'rate_bend', 'rate_roll', 'rate_weld', 'rate_thread', 'rate_feature', 'rate_finish', 'rate_leadtime'] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'rate_version_id'
    ) then
      execute format('drop trigger if exists %I_bump_version on public.%I', t, t);
      execute format('create trigger %I_bump_version after insert or update or delete on public.%I for each row execute function public.bump_rate_version_updated_at()', t, t);
    end if;
  end loop;
end $$;

-- ─── Settings tables price too: a change there stamps the active version ──
create or replace function public.bump_active_rate_version_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rate_versions set rates_updated_at = now() where active;
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['company_settings', 'vat_rates', 'packaging_rates', 'shipping_rates', 'job_setup_rates', 'assembly_rates', 'weld_speeds', 'machines'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I_bump_active_version on public.%I', t, t);
      execute format('create trigger %I_bump_active_version after insert or update or delete on public.%I for each row execute function public.bump_active_rate_version_updated_at()', t, t);
    end if;
  end loop;
end $$;

-- ─── Immutability learns about live editing ────────────────────────────────
-- Editable: the ACTIVE version (live prices) and the current cost basis
-- (the newest cost-mode version, what loadCostRateVersionId picks). A
-- retired version referenced by quotes stays immutable: it is the record of
-- what was quoted. Sent / won / lost quotes are never re-priced, drafts
-- re-price on open (rates_updated_at).
create or replace function public.forbid_rate_edit_if_used()
returns trigger language plpgsql as $$
declare
  v_version uuid := coalesce(new.rate_version_id, old.rate_version_id);
  v_cost_basis uuid;
begin
  if exists (select 1 from public.rate_versions where id = v_version and active) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select v.id into v_cost_basis
    from public.rate_versions v
    join public.rate_general g on g.rate_version_id = v.id
   where g.pricing_mode = 'cost'
   order by v.active desc, v.created_at desc
   limit 1;
  if v_cost_basis = v_version then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if exists (
    select 1 from public.quotes
    where rate_version_id = v_version or cost_rate_version_id = v_version
  ) then
    raise exception 'rate version % is referenced by quotes and is immutable — create a new version', v_version;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- ─── clone_rate_version copies every column ────────────────────────────────
-- The column lists of the previous definition predate the market columns
-- (setup_per_bend_line_eur, family_multipliers, price_by_thickness, …), so a
-- clone came out with defaults in them. Columns are read from the catalogue
-- at call time; materials go before rate_laser (foreign key).
create or replace function public.clone_rate_version(p_source uuid, p_label text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_new uuid;
  t text;
  v_cols text;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if not exists (select 1 from public.rate_versions where id = p_source) then
    raise exception 'rate version % not found', p_source;
  end if;
  insert into public.rate_versions (label, created_by, active)
  values (p_label, auth.uid(), false) returning id into v_new;

  foreach t in array array['rate_general', 'materials', 'rate_laser', 'rate_tube_laser', 'rate_bend', 'rate_roll', 'rate_weld', 'rate_thread', 'rate_feature', 'rate_finish', 'rate_leadtime'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into v_cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and column_name not in ('id', 'rate_version_id', 'created_at', 'updated_at');
    if v_cols is null then continue; end if;
    execute format(
      'insert into public.%I (rate_version_id, %s) select $1, %s from public.%I where rate_version_id = $2',
      t, v_cols, v_cols, t
    ) using v_new, p_source;
  end loop;
  return v_new;
end $$;
