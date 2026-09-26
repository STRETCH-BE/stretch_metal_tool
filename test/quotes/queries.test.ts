/**
 * listQuoteAudit gate: the audit excerpt is read with the service-role
 * client (audit_log is admin-only by RLS), so the function itself must
 * refuse everyone but an admin or the quote's owner — and degrade to []
 * when the service-role key is missing instead of breaking the page.
 * File path: /test/quotes/queries.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth";
import { FakeSupabase } from "./fake-supabase";
import { ADMIN_ID, QUOTE_ID, USER_ID } from "./fixtures";

const state = vi.hoisted(() => ({
  db: null as unknown as { from: unknown },
  adminThrows: false,
  createAdminClient: vi.fn(() => {
    if (state.adminThrows) throw new Error("Missing environment variable SUPABASE_SERVICE_ROLE_KEY");
    return state.db;
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => state.db) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.createAdminClient }));

import { canSeeQuoteAudit, listQuoteAudit } from "@/lib/quotes/queries";

const OTHER_QUOTE = "99999999-9999-4999-8999-999999999999";
const OTHER_USER = "77777777-7777-4777-8777-777777777777";

function session(role: "admin" | "sales" | "viewer", id: string): Session {
  return { user: { id }, profile: { id, role, full_name: null, email: `${id}@x` } } as unknown as Session;
}

const quote = { id: QUOTE_ID, created_by: USER_ID };

function seed() {
  const db = new FakeSupabase({
    audit_log: [
      { id: 1, action: "quote.create", actor: USER_ID, entity: "quotes", entity_id: QUOTE_ID, before: null, after: null, at: "2026-09-25T10:00:00Z" },
      { id: 2, action: "override.request", actor: USER_ID, entity: "overrides", entity_id: "ov-1", before: null, after: { quote_id: QUOTE_ID }, at: "2026-09-25T11:00:00Z" },
      { id: 3, action: "quote.send", actor: null, entity: "quotes", entity_id: QUOTE_ID, before: null, after: null, at: "2026-09-25T12:00:00Z" },
      { id: 4, action: "quote.update", actor: ADMIN_ID, entity: "quotes", entity_id: OTHER_QUOTE, before: null, after: null, at: "2026-09-25T13:00:00Z" },
    ],
    profiles: [{ id: USER_ID, full_name: "Jan Kowalski", email: "jan@x" }],
  });
  state.db = db;
  return db;
}

describe("listQuoteAudit", () => {
  beforeEach(() => {
    seed();
    state.adminThrows = false;
    state.createAdminClient.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the quote's entries (newest first, override rows via after.quote_id) to the owner and to an admin", async () => {
    const rows = await listQuoteAudit(session("sales", USER_ID), quote);
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(rows[1]).toMatchObject({ action: "override.request", actor: USER_ID, actorName: "Jan Kowalski" });
    expect(rows[0]).toMatchObject({ action: "quote.send", actor: null, actorName: null });
    expect(rows.some((r) => r.id === 4)).toBe(false);

    const asAdmin = await listQuoteAudit(session("admin", ADMIN_ID), quote);
    expect(asAdmin.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it("returns [] without touching the admin client for viewers, other sales users and signed-out callers", async () => {
    expect(await listQuoteAudit(session("viewer", OTHER_USER), quote)).toEqual([]);
    expect(await listQuoteAudit(session("sales", OTHER_USER), quote)).toEqual([]);
    expect(await listQuoteAudit(null, quote)).toEqual([]);
    expect(state.createAdminClient).not.toHaveBeenCalled();
  });

  it("degrades to [] when the service-role key is missing", async () => {
    state.adminThrows = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await listQuoteAudit(session("admin", ADMIN_ID), quote)).toEqual([]);
    expect(error).toHaveBeenCalled();
  });

  it("honours the limit and refuses a malformed id", async () => {
    expect(await listQuoteAudit(session("admin", ADMIN_ID), quote, 2)).toHaveLength(2);
    expect(await listQuoteAudit(session("admin", ADMIN_ID), { id: "nope", created_by: USER_ID })).toEqual([]);
  });
});

describe("canSeeQuoteAudit", () => {
  it("admin or owner only", () => {
    expect(canSeeQuoteAudit(session("admin", ADMIN_ID), quote)).toBe(true);
    expect(canSeeQuoteAudit(session("sales", USER_ID), quote)).toBe(true);
    expect(canSeeQuoteAudit(session("sales", OTHER_USER), quote)).toBe(false);
    expect(canSeeQuoteAudit(session("viewer", USER_ID), quote)).toBe(false);
    expect(canSeeQuoteAudit(null, quote)).toBe(false);
  });
});
