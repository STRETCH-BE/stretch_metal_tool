-- ============================================================================
-- Hardening after the wave-2 admin review
-- File path: /supabase/migrations/20260926000000_harden_roles_and_activation.sql
--
-- 1. handle_new_user(): the role may no longer come from raw_user_meta_data,
--    which a self-signing-up user controls (supabase.auth.signUp({options:
--    {data: {role: 'admin'}}})). Only raw_app_meta_data (writable by the
--    service role alone) or the first-account bootstrap can set a role; the
--    admin invite writes profiles.role directly with the service role.
--    Also disable "Allow new users to sign up" in Supabase Auth settings —
--    accounts are created by an admin (README).
-- 2. activate_rate_version(): a stale / unknown id used to leave the system
--    with NO active version (the previous one was deactivated first). Now
--    the function checks the target exists before touching anything.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role := 'sales';
  v_locale public.user_locale := 'pl';
begin
  -- Role: only from app metadata (service role) — never from user metadata.
  begin
    v_role := coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'sales');
  exception when others then v_role := 'sales';
  end;
  -- Locale is harmless to take from either source.
  begin
    v_locale := coalesce(
      (new.raw_app_meta_data ->> 'locale')::public.user_locale,
      (new.raw_user_meta_data ->> 'locale')::public.user_locale,
      'pl'
    );
  exception when others then v_locale := 'pl';
  end;
  -- Bootstrap: the very first account becomes the admin.
  if not exists (select 1 from public.profiles) then
    v_role := 'admin';
  end if;
  insert into public.profiles (id, email, full_name, role, locale)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name', v_role, v_locale)
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.activate_rate_version(p_version uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if not exists (select 1 from public.rate_versions where id = p_version) then
    raise exception 'rate version % does not exist', p_version;
  end if;
  update public.rate_versions set active = false where active and id <> p_version;
  update public.rate_versions set active = true where id = p_version and not active;
end $$;
