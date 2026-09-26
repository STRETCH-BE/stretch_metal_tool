/**
 * decideOverride unit of work (mocked Supabase) + the server action's
 * role refusal for a sales session.
 * File path: /test/admin/overrides.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callsTo, fakeClient } from "./fake-supabase";

const { createClient, getCurrentUser, logAudit, revalidatePath } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentUser: vi.fn(),
  logAudit: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser,
  hasRole: (session: { profile: { role: string } } | null, roles: string[]) =>
    Boolean(session && roles.includes(session.profile.role)),
  ADMIN_ONLY: ["admin"],
}));

import { decideOverride } from "@/lib/admin/overrides";
import { decideOverrideAction } from "@/lib/admin/overrides-actions";
import { INITIAL_OVERRIDE_DECISION_STATE } from "@/lib/admin/overrides-types";
import type { AdminClient } from "@/lib/admin/rates";

const OVERRIDE_ID = "1b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";
const QUOTE_ID = "2b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";
const ACTOR = "3b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";

const PENDING = {
  id: OVERRIDE_ID,
  quote_id: QUOTE_ID,
  part_id: null,
  quote_item_id: null,
  rule_code: "bend.hole_near_bend",
  requested_by: "sales-1",
  note: "Customer accepts the risk",
  status: "pending",
  decided_by: null,
  decided_at: null,
  decision_note: null,
  created_at: "2026-09-25T10:00:00Z",
};

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("decideOverride", () => {
  beforeEach(() => {
    logAudit.mockClear();
  });

  it("approves, then puts the quote back to draft when nothing is pending", async () => {
    const approved = { ...PENDING, status: "approved", decided_by: ACTOR, decision_note: "ok" };
    const client = fakeClient({
      overrides: { single: [{ data: PENDING }, { data: approved }], list: { data: null, count: 0 } },
      quotes: { single: { data: { id: QUOTE_ID, status: "pending_override" } }, list: { data: null, error: null } },
    });
    const result = await decideOverride(
      { overrideId: OVERRIDE_ID, decision: "approve", note: " ok ", actorId: ACTOR },
      client as unknown as AdminClient
    );
    expect(result).toEqual({ ok: true, override: approved, quoteReverted: true });

    const update = callsTo(client.calls, "overrides", "update")[0].args[0] as Record<string, unknown>;
    expect(update).toMatchObject({ status: "approved", decided_by: ACTOR, decision_note: "ok" });
    expect(typeof update.decided_at).toBe("string");
    expect(callsTo(client.calls, "quotes", "update")[0].args[0]).toEqual({ status: "draft" });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "override.approve", entity: "overrides", entityId: OVERRIDE_ID, actor: ACTOR })
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quote.status", entity: "quotes", entityId: QUOTE_ID, after: expect.objectContaining({ status: "draft" }) })
    );
  });

  it("rejects with a note and leaves the quote alone while other overrides are pending", async () => {
    const rejected = { ...PENDING, status: "rejected", decided_by: ACTOR, decision_note: "no" };
    const client = fakeClient({
      overrides: { single: [{ data: PENDING }, { data: rejected }], list: { data: null, count: 1 } },
      quotes: { single: { data: { id: QUOTE_ID, status: "pending_override" } } },
    });
    const result = await decideOverride(
      { overrideId: OVERRIDE_ID, decision: "reject", note: "no", actorId: ACTOR },
      client as unknown as AdminClient
    );
    expect(result).toEqual({ ok: true, override: rejected, quoteReverted: false });
    expect(callsTo(client.calls, "quotes", "update")).toHaveLength(0);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "override.reject" }));
  });

  it("requires a note to reject, refuses an already decided request, reports a missing one", async () => {
    const noNote = await decideOverride(
      { overrideId: OVERRIDE_ID, decision: "reject", note: "  ", actorId: ACTOR },
      fakeClient({}) as unknown as AdminClient
    );
    expect(noNote).toEqual({ ok: false, error: "noteRequired" });

    const decided = await decideOverride(
      { overrideId: OVERRIDE_ID, decision: "approve", note: "", actorId: ACTOR },
      fakeClient({ overrides: { single: { data: { ...PENDING, status: "approved" } } } }) as unknown as AdminClient
    );
    expect(decided).toEqual({ ok: false, error: "alreadyDecided" });

    const missing = await decideOverride(
      { overrideId: OVERRIDE_ID, decision: "approve", note: "", actorId: ACTOR },
      fakeClient({ overrides: { single: { data: null } } }) as unknown as AdminClient
    );
    expect(missing).toEqual({ ok: false, error: "notFound" });
  });
});

describe("decideOverrideAction", () => {
  beforeEach(() => {
    createClient.mockReset();
    getCurrentUser.mockReset();
    logAudit.mockClear();
    revalidatePath.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("refuses a sales session without touching the database", async () => {
    getCurrentUser.mockResolvedValue({ user: { id: "sales-1" }, profile: { role: "sales" } });
    const state = await decideOverrideAction(
      INITIAL_OVERRIDE_DECISION_STATE,
      form({ overrideId: OVERRIDE_ID, decision: "approve", note: "x" })
    );
    expect(state).toEqual({ status: "error", error: "forbidden", overrideId: OVERRIDE_ID, note: "x" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("lets an admin decide and revalidates the queue and the quote", async () => {
    getCurrentUser.mockResolvedValue({ user: { id: ACTOR }, profile: { role: "admin" } });
    const approved = { ...PENDING, status: "approved" };
    createClient.mockResolvedValue(
      fakeClient({
        overrides: { single: [{ data: PENDING }, { data: approved }], list: { data: null, count: 0 } },
        quotes: { single: { data: { id: QUOTE_ID, status: "draft" } } },
      })
    );
    const state = await decideOverrideAction(
      INITIAL_OVERRIDE_DECISION_STATE,
      form({ overrideId: OVERRIDE_ID, decision: "approve", note: "" })
    );
    expect(state).toEqual({ status: "decided", decision: "approve", overrideId: OVERRIDE_ID, quoteReverted: false });
    expect(revalidatePath).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`);
  });
});
