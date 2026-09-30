-- ============================================================================
-- Live rate editing: the ACTIVE rate version may be edited in place (the
-- owner changes a material or service price and it applies from the next
-- calculation). rate_versions.rates_updated_at is stamped by a trigger on
-- every versioned rate table, so a draft quote priced before the change is
-- stale and re-prices when opened; sent / won / lost quotes are never
-- re-priced and keep the prices stored in their pricing snapshot.
-- File path: /supabase/migrations/20260930120000_live_rate_editing.sql
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
