/**
 * inviteUserAction — the role never travels in the invite's user metadata
 * (raw_user_meta_data is client-writable at sign-up, so a trigger reading a
 * role from it is a privilege-escalation channel); the action writes role,
 * locale and name into public.profiles with the service-role client after
 * the invite resolves, audits user.invite, and reports "roleNotSet" when
 * that profile write fails after the e-mail went out.
 * File path: /test/admin/users-invite.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callsTo, fakeClient } from "./fake-supabase";

const { createClient, createAdminClient, getCurrentUser, logAudit, revalidatePath, hasSupabaseAdmin } = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getCurrentUser: vi.fn(),
  logAudit: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
  hasSupabaseAdmin: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/env", () => ({
  env: { hasSupabaseAdmin, siteUrl: () => "https://quote.example.test" },
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser,
  hasRole: (session: { profile: { role: string } } | null, roles: string[]) =>
    Boolean(session && roles.includes(session.profile.role)),
  ADMIN_ONLY: ["admin"],
}));

import { inviteUserAction } from "@/lib/admin/users-actions";
import { INITIAL_INVITE_FORM_STATE } from "@/lib/admin/users";

const ADMIN_ID = "0b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";
const NEW_ID = "9b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";
const ADMIN = { user: { id: ADMIN_ID }, profile: { role: "admin", id: ADMIN_ID } };
const SALES = { user: { id: "sales-1" }, profile: { role: "sales", id: "sales-1" } };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const INVITE = { email: "Anna@Example.com", full_name: "Anna Nowak", role: "admin", locale: "en" };

/** Service-role client stub: auth.admin.inviteUserByEmail + a fake `from`. */
function adminClient(invite: { data?: unknown; error?: { message: string } | null }, tables: Parameters<typeof fakeClient>[0]) {
  const fake = fakeClient(tables);
  const inviteUserByEmail = vi.fn(async () => ({ data: invite.data ?? { user: null }, error: invite.error ?? null }));
  return { client: { auth: { admin: { inviteUserByEmail } }, from: fake.from }, inviteUserByEmail, calls: fake.calls };
}

describe("inviteUserAction", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
    getCurrentUser.mockReset();
    logAudit.mockClear();
    revalidatePath.mockClear();
    hasSupabaseAdmin.mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("refuses a sales session before touching the admin client", async () => {
    getCurrentUser.mockResolvedValue(SALES);
    const state = await inviteUserAction(INITIAL_INVITE_FORM_STATE, form(INVITE));
    expect(state).toMatchObject({ status: "error", error: "forbidden" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("reports notConfigured without the service-role key", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    hasSupabaseAdmin.mockReturnValue(false);
    const state = await inviteUserAction(INITIAL_INVITE_FORM_STATE, form(INVITE));
    expect(state).toMatchObject({ status: "error", error: "notConfigured" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps the role out of the invite metadata and writes it to the profile with the service-role client", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const saved = { id: NEW_ID, email: "anna@example.com", full_name: "Anna Nowak", role: "admin", locale: "en" };
    const admin = adminClient({ data: { user: { id: NEW_ID } } }, { profiles: { single: { data: saved } } });
    createAdminClient.mockReturnValue(admin.client);

    const state = await inviteUserAction(INITIAL_INVITE_FORM_STATE, form(INVITE));
    expect(state).toEqual({ status: "sent", email: "anna@example.com" });

    expect(admin.inviteUserByEmail).toHaveBeenCalledTimes(1);
    const [email, options] = admin.inviteUserByEmail.mock.calls[0] as unknown as [string, { data: Record<string, unknown>; redirectTo: string }];
    expect(email).toBe("anna@example.com");
    expect(options.data).toEqual({ full_name: "Anna Nowak", locale: "en" });
    expect("role" in options.data).toBe(false);
    expect(options.redirectTo).toBe("https://quote.example.test/auth/callback");

    const upsert = callsTo(admin.calls, "profiles", "upsert")[0];
    expect(upsert.args[0]).toEqual({ id: NEW_ID, email: "anna@example.com", full_name: "Anna Nowak", role: "admin", locale: "en" });
    expect(upsert.args[1]).toEqual({ onConflict: "id" });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.invite",
        entity: "profiles",
        entityId: NEW_ID,
        after: { email: "anna@example.com", role: "admin", locale: "en" },
      })
    );
  });

  it("reports roleNotSet (and audits the intended role) when the profile write fails after the e-mail went out", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const admin = adminClient(
      { data: { user: { id: NEW_ID } } },
      { profiles: { single: { data: null, error: { message: "permission denied" } } } }
    );
    createAdminClient.mockReturnValue(admin.client);
    const state = await inviteUserAction(INITIAL_INVITE_FORM_STATE, form(INVITE));
    expect(state).toMatchObject({ status: "error", error: "roleNotSet" });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.invite",
        entityId: NEW_ID,
        after: expect.objectContaining({ role: null, intendedRole: "admin", intendedLocale: "en" }),
      })
    );
  });

  it("maps an existing account to 'exists' and writes no profile", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const admin = adminClient({ error: { message: "A user with this email address has already been registered" } }, {});
    createAdminClient.mockReturnValue(admin.client);
    const state = await inviteUserAction(INITIAL_INVITE_FORM_STATE, form(INVITE));
    expect(state).toMatchObject({ status: "error", error: "exists" });
    expect(callsTo(admin.calls, "profiles", "upsert")).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
