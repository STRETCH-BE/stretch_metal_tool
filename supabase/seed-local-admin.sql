-- ============================================================================
-- StretchMetal quoting tool — local-dev admin user (NOT run automatically)
-- File path: /supabase/seed-local-admin.sql
--
-- *** LOCAL STACKS ONLY (`supabase start`). NEVER RUN THIS IN THE CLOUD. ***
-- It writes straight into auth.users + auth.identities the way the Supabase
-- docs show for local development. In the hosted project GoTrue owns those
-- tables, the password below is public in this repo, and the dashboard invite
-- flow is the supported path — see "Production alternative" at the bottom.
--
-- Creates   admin@stretchmetal.local / password "stretchmetal"
-- and sets  public.profiles.role = 'admin' (locale 'en').
--
-- Run once after `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seed-local-admin.sql
-- or paste it into Studio → SQL editor (http://127.0.0.1:54323).
-- Deliberately NOT listed in config.toml [db.seed].sql_paths, so a
-- `supabase db reset` on a machine linked to the cloud can never seed it.
--
-- Idempotent: skips the auth rows when the e-mail already exists, then
-- (re)applies the admin role on the profile.
--
-- Notes on the auth.users insert (the usual local-dev pitfalls):
--   * crypt() / gen_salt() come from pgcrypto, which Supabase installs in the
--     `extensions` schema — hence the schema-qualified calls.
--   * confirmation_token / recovery_token / email_change /
--     email_change_token_new must be '' rather than NULL, otherwise GoTrue
--     fails with "converting NULL to string is unsupported" on sign-in.
--   * auth.identities.provider_id is NOT NULL and equals the user id for the
--     e-mail provider; identity_data needs "sub" and "email".
--   * public.handle_new_user() (migration) turns raw_user_meta_data.role /
--     locale / full_name into the profile row, so the profile is born as
--     admin; the final UPDATE only covers a pre-existing profile.
--   * The local stub schema used by `test/db` has no token columns and no
--     auth.identities, so this file is not exercised by the vitest suite.
-- ============================================================================

do $$
declare
  v_email    constant text := 'admin@stretchmetal.local';
  v_password constant text := 'stretchmetal';
  v_user_id  uuid;
begin
  select id into v_user_id from auth.users where email = v_email;

  if v_user_id is not null then
    raise notice 'seed-local-admin: % already exists (%), auth rows left untouched', v_email, v_user_id;
  else
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change,
      email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"full_name": "Local admin", "role": "admin", "locale": "en"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      'email',
      now(),
      now(),
      now()
    );

    raise notice 'seed-local-admin: created % (%)', v_email, v_user_id;
  end if;

  -- Profile row exists by now (trigger on auth.users insert). Make sure it is
  -- an admin even when the user pre-existed with another role.
  update public.profiles
     set role = 'admin', locale = 'en', full_name = coalesce(full_name, 'Local admin')
   where id = v_user_id;
end $$;

-- ----------------------------------------------------------------------------
-- Production alternative (hosted Supabase project) — do NOT use the block above
-- ----------------------------------------------------------------------------
-- 1. Dashboard → Authentication → Users → "Invite user" (or "Add user" with a
--    password). The user accepts the invite and sets a password; the
--    on_auth_user_created trigger creates public.profiles with role 'sales'.
--    To create the user as admin straight away, invite via the Admin API with
--    user metadata {"role": "admin", "locale": "en", "full_name": "…"} —
--    handle_new_user() reads raw_user_meta_data.
-- 2. Otherwise promote the profile afterwards in the SQL editor:
--
--    update public.profiles set role = 'admin' where email = 'michael@stretchmetal.pl';  -- [CONFIRM] admin e-mail
--
--    Later admins are created from inside the app (Admin → Users → invite),
--    which sets the role and locale on the invite.
