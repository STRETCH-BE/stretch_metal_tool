/**
 * Last-admin guard — pure rule + the updateUserAction refusing to demote
 * the last admin (and refusing a sales session). Supabase, auth, audit and
 * Next's cache are mocked.
 * File path: /test/admin/users-guard.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRoleChange } from "@/lib/admin/users-guard";
import { callsTo, fakeClient } from "./fake-supabase";

const { createClient, getCurrentUser, logAudit, revalidatePath } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentUser: vi.fn(),
  logAudit: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser,
  hasRole: (session: { profile: { role: string } } | null, roles: string[]) =>
    Boolean(session && roles.includes(session.profile.role)),
  ADMIN_ONLY: ["admin"],
}));

import { updateUserAction } from "@/lib/admin/users-actions";
import { INITIAL_USER_ROW_FORM_STATE } from "@/lib/admin/users";

const ADMIN_ID = "0b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";

function session(role: "admin" | "sales" | "viewer", id = ADMIN_ID) {
  return { user: { id }, profile: { role, id } };
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const PROFILE = {
  id: ADMIN_ID,
  email: "michael@example.com",
  full_name: "Michael",
  role: "admin",
  locale: "en",
  created_at: "2026-09-25T10:00:00Z",
  updated_at: "2026-09-25T10:00:00Z",
};

describe("checkRoleChange", () => {
  it("refuses to demote the last admin (also self-demotion)", () => {
    expect(checkRoleChange({ currentRole: "admin", newRole: "sales", adminCount: 1 })).toEqual({ ok: false, reason: "lastAdmin" });
    expect(checkRoleChange({ currentRole: "admin", newRole: "viewer", adminCount: 0 })).toEqual({ ok: false, reason: "lastAdmin" });
  });

  it("allows demotion when another admin remains, and any promotion", () => {
    expect(checkRoleChange({ currentRole: "admin", newRole: "sales", adminCount: 2 })).toEqual({ ok: true });
    expect(checkRoleChange({ currentRole: "sales", newRole: "admin", adminCount: 1 })).toEqual({ ok: true });
    expect(checkRoleChange({ currentRole: "admin", newRole: "admin", adminCount: 1 })).toEqual({ ok: true });
    expect(checkRoleChange({ currentRole: "viewer", newRole: "sales", adminCount: 1 })).toEqual({ ok: true });
  });
});

describe("updateUserAction", () => {
  beforeEach(() => {
    createClient.mockReset();
    getCurrentUser.mockReset();
    logAudit.mockClear();
    revalidatePath.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("refuses a sales session before touching the database", async () => {
    getCurrentUser.mockResolvedValue(session("sales"));
    const state = await updateUserAction(ADMIN_ID, INITIAL_USER_ROW_FORM_STATE, form({ role: "admin", locale: "pl" }));
    expect(state).toEqual({ status: "error", error: "forbidden" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses to demote the last admin and writes nothing", async () => {
    getCurrentUser.mockResolvedValue(session("admin"));
    const client = fakeClient({
      profiles: { single: { data: PROFILE }, list: { data: null, count: 1 } },
    });
    createClient.mockResolvedValue(client);
    const state = await updateUserAction(ADMIN_ID, INITIAL_USER_ROW_FORM_STATE, form({ role: "sales", locale: "en" }));
    expect(state).toEqual({ status: "error", error: "lastAdmin" });
    expect(callsTo(client.calls, "profiles", "update")).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("demotes when another admin exists and audits user.role with before/after", async () => {
    getCurrentUser.mockResolvedValue(session("admin"));
    const client = fakeClient({
      profiles: {
        single: [{ data: PROFILE }, { data: { ...PROFILE, role: "sales" } }],
        list: { data: null, count: 2 },
      },
    });
    createClient.mockResolvedValue(client);
    const state = await updateUserAction(ADMIN_ID, INITIAL_USER_ROW_FORM_STATE, form({ role: "sales", locale: "en" }));
    expect(state.status).toBe("saved");
    expect(callsTo(client.calls, "profiles", "update")[0].args[0]).toEqual({ role: "sales", locale: "en" });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.role",
        entity: "profiles",
        entityId: ADMIN_ID,
        before: { role: "admin", email: PROFILE.email },
        after: { role: "sales", email: PROFILE.email },
      })
    );
  });

  it("reports noChange without writing", async () => {
    getCurrentUser.mockResolvedValue(session("admin"));
    const client = fakeClient({ profiles: { single: { data: PROFILE } } });
    createClient.mockResolvedValue(client);
    const state = await updateUserAction(ADMIN_ID, INITIAL_USER_ROW_FORM_STATE, form({ role: "admin", locale: "en" }));
    expect(state.status).toBe("noChange");
    expect(callsTo(client.calls, "profiles", "update")).toHaveLength(0);
  });
});
