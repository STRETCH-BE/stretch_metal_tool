/**
 * POST /api/quotes/[id]/price: re-prices editable quotes for their editor
 * and audits the rewrite; a sent / won / lost quote answers 409 `locked`
 * and keeps its stored prices (the route used to re-price them).
 * File path: /test/quotes/price-route.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, RATE_VERSION_ID } from "@/test/helpers/rates";
import { ITEM_ID, QUOTE_ID, USER_ID, makeCustomer, makeItemRow, makePartRow, makeQuoteRow } from "./fixtures";

type FakeSession = { user: { id: string }; profile: { id: string; role: string } } | null;

const state = vi.hoisted(() => ({
  db: null as unknown as FakeSupabase,
  session: null as FakeSession,
  logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => state.db) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.db) }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => state.session),
  assertRole: vi.fn(async (roles: string[]) => {
    if (!state.session) return { session: null, error: Response.json({ error: "unauthenticated" }, { status: 401 }) };
    if (!roles.includes(state.session.profile.role)) return { session: null, error: Response.json({ error: "forbidden" }, { status: 403 }) };
    return { session: state.session, error: null };
  }),
  WRITE_ROLES: ["admin", "sales"],
}));
vi.mock("@/lib/audit", () => ({ logAudit: state.logAudit }));
vi.mock("@/lib/rates/load", () => ({
  loadActiveRateVersionId: vi.fn(async () => RATE_VERSION_ID),
  loadRateSnapshot: vi.fn(async () => RATE_SNAPSHOT_V1),
  loadMachinePark: vi.fn(async () => MACHINE_PARK),
}));

import { POST } from "@/app/api/quotes/[id]/price/route";

function seed(quote: Partial<ReturnType<typeof makeQuoteRow>> = {}) {
  const db = new FakeSupabase({
    quotes: [makeQuoteRow(quote)],
    customers: [makeCustomer()],
    quote_items: [makeItemRow()],
    parts: [makePartRow()],
    operations: [{ id: "old-op", quote_item_id: ITEM_ID, position: 0, type: "other", label: "stale", driver_qty: 1, driver_unit: "each", rate_ref: {}, unit_cost: 99, setup_share: 0, details: {}, notes: null, auto: false }],
    overrides: [],
    rate_versions: [{ id: RATE_VERSION_ID, label: "v1", active: true }],
  });
  state.db = db;
  return db;
}

function post(id = QUOTE_ID) {
  return POST(new Request(`http://localhost/api/quotes/${id}/price`, { method: "POST" }), { params: Promise.resolve({ id }) });
}

describe("POST /api/quotes/[id]/price", () => {
  beforeEach(() => {
    state.session = { user: { id: USER_ID }, profile: { id: USER_ID, role: "sales" } };
    state.logAudit.mockClear();
  });

  it("re-prices a draft for its owner, answers the PricedQuote and audits quote.reprice", async () => {
    const db = seed();
    const response = await post();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { priced: { rateVersionId: string; subtotalPrice: number } };
    expect(body.priced).toMatchObject({ rateVersionId: RATE_VERSION_ID });
    expect(body.priced.subtotalPrice).toBeGreaterThan(0);
    expect(typeof db.tables.quotes[0].priced_at).toBe("string");
    expect(db.tables.operations.some((o) => o.id === "old-op")).toBe(false);
    expect(state.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quote.reprice", entity: "quotes", entityId: QUOTE_ID, actor: USER_ID, after: expect.objectContaining({ source: "api", priced: true }) })
    );
  });

  it("answers 409 locked for sent / won / lost quotes and leaves their prices alone", async () => {
    for (const status of ["sent", "won", "lost"] as const) {
      const db = seed({ status, priced_at: "2026-01-01T00:00:00Z", subtotal_price: 1234 });
      const response = await post();
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "locked" });
      expect(db.tables.quotes[0]).toMatchObject({ status, priced_at: "2026-01-01T00:00:00Z", subtotal_price: 1234 });
      expect(db.tables.operations.some((o) => o.id === "old-op")).toBe(true);
      expect(db.writes).toHaveLength(0);
    }
    expect(state.logAudit).not.toHaveBeenCalled();
  });

  it("403 for viewers and for a sales user who does not own the quote; an invisible quote prices as null", async () => {
    seed();
    state.session = { user: { id: "v" }, profile: { id: "v", role: "viewer" } };
    expect((await post()).status).toBe(403);
    state.session = { user: { id: "other" }, profile: { id: "other", role: "sales" } };
    const forbidden = await post();
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
    expect(state.logAudit).not.toHaveBeenCalled();
    // repriceQuote answers null for a quote the RLS client cannot see (documented contract): nothing is written
    state.session = { user: { id: USER_ID }, profile: { id: USER_ID, role: "sales" } };
    const invisible = await post("99999999-9999-4999-8999-999999999999");
    expect(invisible.status).toBe(200);
    expect(await invisible.json()).toEqual({ priced: null });
    expect(state.db.writes).toHaveLength(0);
  });
});
