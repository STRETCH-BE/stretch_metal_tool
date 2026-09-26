/**
 * The database behaviours the admin actions guard against, reproduced on a
 * fresh local Postgres (migration + seed) so the guards keep a reason to
 * exist:
 *   - materials → rate_laser is ON DELETE CASCADE: deleting a material takes
 *     every laser row of that material in the version (deleteRateRow reads
 *     them first, refuses without cascade, audits each one);
 *   - activate_rate_version() deactivates every version before it updates by
 *     id and does not check the id exists: with an unknown id nothing is
 *     active afterwards (activateRateVersionAction verifies the id first);
 *   - the profile row exists as soon as the auth user is inserted, so the
 *     invite action can write the role there with the service-role client
 *     instead of passing it through client-writable user metadata.
 * File path: /test/admin/db-guards.test.ts
 *
 * Skipped unless SMTOOL_LOCAL_PG=1 (same gate and helpers as test/db). Uses
 * its own scratch database so it never interrupts the seed tests. Run with:
 *   SMTOOL_LOCAL_PG=1 npx vitest run test/admin/db-guards
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupStaging, queryScalar, resetDatabase, runSql } from "../db/pg";

const ENABLED = process.env.SMTOOL_LOCAL_PG === "1";
const DB = "smtool_admin_test";
const BOOTSTRAP_ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const SECOND_USER = "aaaaaaaa-0000-4000-8000-000000000002";
const DRAFT = "bbbbbbbb-0000-4000-8000-000000000001";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

describe.skipIf(!ENABLED)("database behaviours behind the admin guards", () => {
  beforeAll(() => {
    resetDatabase(DB);
    // First auth user → bootstrap admin (handle_new_user); gives is_admin() a subject.
    runSql(DB, `insert into auth.users (id, email, raw_user_meta_data) values ('${BOOTSTRAP_ADMIN}', 'admin@example.test', '{}');`);
  });
  afterAll(() => cleanupStaging());

  it("deleting a material cascades to every rate_laser row of that material in the version", () => {
    runSql(
      DB,
      `insert into public.rate_versions (id, label, active) values ('${DRAFT}', 'draft', false);
       insert into public.materials (rate_version_id, code, name, family, density_kg_m3, rm_n_mm2)
         values ('${DRAFT}', 'S235', 'Steel', 'mild_steel', 7850, 360), ('${DRAFT}', 'AL', 'Aluminium', 'aluminium', 2700, 150);
       insert into public.rate_laser (rate_version_id, material_code, thickness_mm, in_house)
         values ('${DRAFT}', 'S235', 3, true), ('${DRAFT}', 'S235', 15, false), ('${DRAFT}', 'AL', 3, true);`
    );
    expect(queryScalar<number>(DB, `select count(*)::int as n from public.rate_laser where rate_version_id = '${DRAFT}'`)).toBe(3);
    runSql(DB, `delete from public.materials where rate_version_id = '${DRAFT}' and code = 'S235';`);
    expect(
      queryScalar<number>(DB, `select count(*)::int as n from public.rate_laser where rate_version_id = '${DRAFT}' and material_code = 'S235'`)
    ).toBe(0);
    // the other material's rows are untouched
    expect(queryScalar<number>(DB, `select count(*)::int as n from public.rate_laser where rate_version_id = '${DRAFT}'`)).toBe(1);
  });

  it("the profile row exists right after the auth user insert, and the service role can set its role there", () => {
    runSql(DB, `insert into auth.users (id, email, raw_user_meta_data) values ('${SECOND_USER}', 'anna@example.test', '{"full_name":"Anna","locale":"en"}');`);
    expect(queryScalar<string>(DB, `select role::text as role from public.profiles where id = '${SECOND_USER}'`)).toBe("sales");
    runSql(DB, `update public.profiles set role = 'admin', locale = 'en' where id = '${SECOND_USER}';`);
    expect(queryScalar<string>(DB, `select role::text as role from public.profiles where id = '${SECOND_USER}'`)).toBe("admin");
  });

  it("activate_rate_version() with an unknown id leaves NO active version (unless the function is hardened to raise)", () => {
    expect(queryScalar<number>(DB, `select count(*)::int as n from public.rate_versions where active`)).toBe(1);
    const { stderr } = runSql(
      DB,
      `select set_config('request.jwt.claim.sub', '${BOOTSTRAP_ADMIN}', false);
       do $$ begin
         perform public.activate_rate_version('${UNKNOWN}');
       exception when others then
         raise notice 'activate raised: %', sqlerrm;
       end $$;`
    );
    const raised = /activate raised/.test(stderr);
    const active = queryScalar<number>(DB, `select count(*)::int as n from public.rate_versions where active`);
    // Current migration: no check → 0 active. A hardened RPC raises instead
    // and the exception block rolls the deactivation back → still 1.
    expect(active).toBe(raised ? 1 : 0);
  });
});
