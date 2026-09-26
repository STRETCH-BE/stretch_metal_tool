/**
 * Quote server actions against the fake client: duplicate-as-new-version
 * numbering and copying, amber confirmation (self-approved override),
 * override request (pending + status flip), won/lost transitions, and
 * the role/ownership gates.
 * File path: /test/quotes/actions.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, RATE_VERSION_ID } from "@/test/helpers/rates";
import { ADMIN_ID, ITEM_ID, PART_ID, QUOTE_ID, USER_ID, amberFlag, makeCustomer, makeItemRow, makePartRow, makeQuoteRow, redFlag } from "./fixtures";

const state = vi.hoisted(() => ({
  db: null as unknown as { from: unknown },
  session: null as unknown,
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => state.db) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.db) }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => state.session),
  hasRole: (session: { profile: { role: string } } | null, roles: string[]) => Boolean(session && roles.includes(session.profile.role)),
  WRITE_ROLES: ["admin", "sales"],
  ADMIN_ONLY: ["admin"],
}));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("@/lib/audit", () => ({ logAudit: state.logAudit }));
vi.mock("@/lib/rates/load", () => ({
  loadActiveRateVersionId: vi.fn(async () => RATE_VERSION_ID),
  loadRateSnapshot: vi.fn(async () => RATE_SNAPSHOT_V1),
  loadMachinePark: vi.fn(async () => MACHINE_PARK),
}));

import { confirmFlag, duplicateAsNewVersion, requestOverride, setQuoteStatus, updateItem } from "@/lib/quotes/actions";

function seed(options: { quote?: Partial<ReturnType<typeof makeQuoteRow>>; extraQuotes?: ReturnType<typeof makeQuoteRow>[] } = {}) {
  const db = new FakeSupabase({
    quotes: [makeQuoteRow(options.quote), ...(options.extraQuotes ?? [])],
    customers: [makeCustomer()],
    quote_items: [makeItemRow()],
    parts: [makePartRow()],
    operations: [],
    overrides: [],
    rate_versions: [{ id: RATE_VERSION_ID, label: "v1", active: true }],
    files: [],
  });
  state.db = db;
  return db;
}

const sales = () => ({ user: { id: USER_ID }, profile: { id: USER_ID, role: "sales", full_name: "Sales", email: "s@x" } });
const admin = () => ({ user: { id: ADMIN_ID }, profile: { id: ADMIN_ID, role: "admin", full_name: "Admin", email: "a@x" } });

describe("duplicateAsNewVersion", () => {
  beforeEach(() => {
    state.session = sales();
    state.logAudit.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("creates version max+1 with the same number, copies parts + items, pins the active rates and redirects", async () => {
    const db = seed({
      quote: { status: "sent", rate_version_id: "old-version" },
      extraQuotes: [makeQuoteRow({ id: "33333333-3333-4333-8333-333333333333", version: 3, status: "lost" })],
    });
    await expect(duplicateAsNewVersion(QUOTE_ID)).rejects.toThrow(/NEXT_REDIRECT:\/quotes\//);
    const created = db.tables.quotes.find((q) => q.version === 4);
    expect(created).toBeDefined();
    expect(created).toMatchObject({ number: "SM-2026-0001", status: "draft", rate_version_id: RATE_VERSION_ID, created_by: USER_ID, customer_id: makeCustomer().id });
    expect(created!.sent_at ?? null).toBeNull();
    const parts = db.tables.parts.filter((p) => p.quote_id === created!.id);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ name: "200164", material_code: "DC01" });
    expect(parts[0].id).not.toBe(PART_ID);
    const items = db.tables.quote_items.filter((i) => i.quote_id === created!.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ part_id: parts[0].id, qty: 50, position: 0 });
    // re-priced immediately
    expect(created!.pricing).toMatchObject({ rateVersionId: RATE_VERSION_ID });
    expect(db.tables.operations.filter((o) => o.quote_item_id === items[0].id).length).toBeGreaterThan(5);
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "quote.duplicate" }));
    expect(state.redirect).toHaveBeenCalledWith(`/quotes/${created!.id}`);
  });

  it("viewers may not duplicate", async () => {
    seed();
    state.session = { user: { id: "v" }, profile: { id: "v", role: "viewer" } };
    expect(await duplicateAsNewVersion(QUOTE_ID)).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("confirmFlag (amber acknowledgement)", () => {
  beforeEach(() => {
    state.session = sales();
    state.logAudit.mockClear();
  });

  it("inserts a self-approved override for an amber flag on the quote", async () => {
    const db = seed({ quote: { flags: [amberFlag()] } });
    const result = await confirmFlag({ quoteId: QUOTE_ID, flagCode: "bend.hole_near_bend", partId: PART_ID, itemId: ITEM_ID });
    expect(result).toEqual({ ok: true });
    expect(db.tables.overrides).toHaveLength(1);
    expect(db.tables.overrides[0]).toMatchObject({
      quote_id: QUOTE_ID,
      part_id: PART_ID,
      rule_code: "bend.hole_near_bend",
      status: "approved",
      requested_by: USER_ID,
      decided_by: USER_ID,
      note: "confirmed by sales",
    });
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "override.confirm" }));
    // second confirmation is a no-op
    await confirmFlag({ quoteId: QUOTE_ID, flagCode: "bend.hole_near_bend", partId: PART_ID, itemId: ITEM_ID });
    expect(db.tables.overrides).toHaveLength(1);
  });

  it("refuses red flags and flags that are not on the quote", async () => {
    const db = seed({ quote: { flags: [redFlag()] } });
    expect(await confirmFlag({ quoteId: QUOTE_ID, flagCode: "bend.force_over_limit", partId: PART_ID, itemId: ITEM_ID })).toEqual({ ok: false, error: "invalid" });
    expect(await confirmFlag({ quoteId: QUOTE_ID, flagCode: "bend.hole_near_bend", partId: PART_ID, itemId: ITEM_ID })).toEqual({ ok: false, error: "invalid" });
    expect(db.tables.overrides).toHaveLength(0);
  });

  it("rejects non-owners and locked quotes", async () => {
    seed({ quote: { flags: [amberFlag()] } });
    state.session = { user: { id: "other" }, profile: { id: "other", role: "sales" } };
    expect(await confirmFlag({ quoteId: QUOTE_ID, flagCode: "bend.hole_near_bend", partId: PART_ID, itemId: ITEM_ID })).toEqual({ ok: false, error: "forbidden" });
    seed({ quote: { flags: [amberFlag()], status: "sent" } });
    state.session = sales();
    expect(await confirmFlag({ quoteId: QUOTE_ID, flagCode: "bend.hole_near_bend", partId: PART_ID, itemId: ITEM_ID })).toEqual({ ok: false, error: "locked" });
  });
});

describe("requestOverride", () => {
  beforeEach(() => {
    state.session = sales();
    state.logAudit.mockClear();
  });

  it("creates a pending override and flips the quote to pending_override", async () => {
    const db = seed({ quote: { flags: [amberFlag()] } });
    const result = await requestOverride({ quoteId: QUOTE_ID, flagCode: "bend.hole_near_bend", partId: PART_ID, itemId: ITEM_ID, note: "Customer accepts a slight deformation." });
    expect(result).toEqual({ ok: true });
    expect(db.tables.overrides[0]).toMatchObject({ status: "pending", requested_by: USER_ID, rule_code: "bend.hole_near_bend" });
    expect(db.tables.quotes[0].status).toBe("pending_override");
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "override.request" }));
  });

  it("validates the note and the flag", async () => {
    seed({ quote: { flags: [amberFlag()] } });
    expect(await requestOverride({ quoteId: QUOTE_ID, flagCode: "bend.hole_near_bend", partId: PART_ID, itemId: ITEM_ID, note: "" })).toEqual({ ok: false, error: "required" });
    expect(await requestOverride({ quoteId: QUOTE_ID, flagCode: "bend.force_over_limit", partId: PART_ID, itemId: ITEM_ID, note: "please" })).toEqual({ ok: false, error: "invalid" });
  });
});

describe("setQuoteStatus", () => {
  beforeEach(() => {
    state.session = admin();
  });

  it("won/lost only from sent", async () => {
    const db = seed({ quote: { status: "sent" } });
    expect(await setQuoteStatus(QUOTE_ID, "won")).toEqual({ ok: true });
    expect(db.tables.quotes[0].status).toBe("won");
    expect(typeof db.tables.quotes[0].decided_at).toBe("string");
    seed({ quote: { status: "draft" } });
    expect(await setQuoteStatus(QUOTE_ID, "lost")).toEqual({ ok: false, error: "invalidStatus" });
  });
});

describe("updateItem", () => {
  beforeEach(() => {
    state.session = sales();
  });

  it("validates qty and re-prices on success", async () => {
    const db = seed();
    expect(await updateItem(ITEM_ID, { qty: 0 })).toEqual({ ok: false, error: "invalidQty" });
    expect(await updateItem(ITEM_ID, { qty: 10, extras: [{ type: "machining", minutes: 5, note: null }] })).toEqual({ ok: true });
    expect(db.tables.quote_items[0].qty).toBe(10);
    const pricing = db.tables.quotes[0].pricing as { items: { qty: number; operations: { type: string }[] }[] };
    expect(pricing.items[0].qty).toBe(10);
    expect(pricing.items[0].operations.some((o) => o.type === "machining")).toBe(true);
  });
});
