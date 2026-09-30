/**
 * repriceQuote against mocked clients: reads AND writes through the user's
 * RLS client (the admin client is never created in session mode, so a
 * deployment without the service-role key still prices), the admin client
 * only in `{ admin: true }` mode, pinning of the active rate version,
 * item/operation/quote persistence, idempotence, the empty case, the access
 * checks and the lock (sent / won / lost quotes keep their stored prices in
 * both modes).
 * File path: /test/quotes/reprice.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Row } from "./fake-supabase";
import { FakeSupabase } from "./fake-supabase";
import { JOB_RATES, MACHINE_PARK, RATE_SNAPSHOT_V1, RATE_VERSION_ID } from "@/test/helpers/rates";
import { ASSEMBLY_ID, ITEM_ID, PART_ID, QUOTE_ID, USER_ID, makeAssemblyRow, makeCustomer, makeItemRow, makePartRow, makeQuoteRow, makeSeamRow } from "./fixtures";

const state = vi.hoisted(() => ({
  rls: null as unknown as { from: unknown },
  admin: null as unknown as { from: unknown },
  session: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => state.rls) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.admin) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => state.session) }));
vi.mock("@/lib/rates/load", () => ({
  loadActiveRateVersionId: vi.fn(async () => RATE_VERSION_ID),
  loadRateSnapshot: vi.fn(async (_client: unknown, versionId?: string | null) => ({ ...RATE_SNAPSHOT_V1, versionId: versionId ?? RATE_VERSION_ID })),
  loadMachinePark: vi.fn(async () => MACHINE_PARK),
  loadJobRates: vi.fn(async () => JOB_RATES),
}));

import { repriceQuote } from "@/lib/quotes/reprice";
import { QuoteAccessError } from "@/lib/quotes/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { EnvError } from "@/lib/env";

function seed(over: { quote?: Row; items?: Row[]; parts?: Row[]; assemblies?: Row[]; seams?: Row[] } = {}) {
  const db = new FakeSupabase({
    quotes: [over.quote ?? makeQuoteRow()],
    customers: [makeCustomer()],
    quote_items: over.items ?? [makeItemRow()],
    parts: over.parts ?? [makePartRow()],
    assemblies: over.assemblies ?? [],
    assembly_seams: over.seams ?? [],
    operations: [{ id: "old-op", quote_item_id: ITEM_ID, position: 0, type: "other", label: "stale", driver_qty: 1, driver_unit: "each", rate_ref: {}, unit_cost: 99, setup_share: 0, details: {}, notes: null, auto: false }],
    overrides: [],
    rate_versions: [{ id: RATE_VERSION_ID, label: "v1", active: true }],
  });
  state.rls = db;
  state.admin = db;
  return db;
}

describe("repriceQuote", () => {
  beforeEach(() => {
    state.session = { user: { id: USER_ID }, profile: { id: USER_ID, role: "sales" } };
  });

  it("prices the quote, replaces the operations and writes the pricing columns", async () => {
    const db = seed();
    const priced = await repriceQuote(QUOTE_ID);
    expect(priced).not.toBeNull();
    expect(priced!.items[0].operations.length).toBeGreaterThan(5);

    const item = db.tables.quote_items[0];
    expect(Number(item.unit_cost)).toBeCloseTo(priced!.items[0].unitCost, 9);
    expect(Number(item.unit_price)).toBeCloseTo(priced!.items[0].unitPrice ?? Number.NaN, 9);

    const ops = db.tables.operations;
    expect(ops.some((o) => o.id === "old-op")).toBe(false);
    expect(ops).toHaveLength(priced!.items[0].operations.length);
    expect(ops.map((o) => o.position)).toEqual(ops.map((_, i) => i));
    expect(ops.every((o) => o.quote_item_id === ITEM_ID)).toBe(true);

    const quote = db.tables.quotes[0];
    expect(quote.pricing).toMatchObject({ rateVersionId: RATE_VERSION_ID, marginPct: 30 });
    expect(Array.isArray(quote.flags)).toBe(true);
    expect(Number(quote.subtotal_price)).toBeCloseTo(priced!.subtotalPrice * 4.3, 6);
    expect(Number(quote.subtotal_cost)).toBeCloseTo(priced!.subtotalCost * 4.3, 6);
    expect(typeof quote.priced_at).toBe("string");
    expect(quote.rate_version_id).toBe(RATE_VERSION_ID);
  });

  it("is idempotent: a second run leaves the same operation set and numbers", async () => {
    const db = seed();
    const strip = (o: Record<string, unknown>) => ({ ...o, id: null, created_at: null, updated_at: null });
    const first = await repriceQuote(QUOTE_ID);
    const opsAfterFirst = db.tables.operations.map(strip);
    const second = await repriceQuote(QUOTE_ID);
    const opsAfterSecond = db.tables.operations.map(strip);
    expect(opsAfterSecond).toEqual(opsAfterFirst);
    expect(second!.subtotalPrice).toBe(first!.subtotalPrice);
    expect(db.tables.operations).toHaveLength(first!.items[0].operations.length);
  });

  it("pins the active rate version when the quote has none", async () => {
    const db = seed({ quote: makeQuoteRow({ rate_version_id: null }) });
    await repriceQuote(QUOTE_ID);
    expect(db.tables.quotes[0].rate_version_id).toBe(RATE_VERSION_ID);
    const pin = db.writes.find((w) => w.op === "update" && w.table === "quotes" && "rate_version_id" in w.patch);
    expect(pin).toBeDefined();
  });

  it("returns null and clears the pricing columns when there is nothing to price", async () => {
    const db = seed({ items: [], quote: makeQuoteRow({ pricing: { stale: true }, subtotal_price: 12 }) });
    const result = await repriceQuote(QUOTE_ID);
    expect(result).toBeNull();
    expect(db.tables.quotes[0]).toMatchObject({ pricing: null, flags: [], subtotal_price: 0, subtotal_cost: 0 });
  });

  it("returns null for an invisible/unknown quote and rejects non-owners", async () => {
    seed();
    expect(await repriceQuote("not-a-uuid")).toBeNull();
    expect(await repriceQuote("99999999-9999-4999-8999-999999999999")).toBeNull();
    state.session = { user: { id: "someone-else" }, profile: { id: "someone-else", role: "sales" } };
    await expect(repriceQuote(QUOTE_ID)).rejects.toBeInstanceOf(QuoteAccessError);
    state.session = null;
    await expect(repriceQuote(QUOTE_ID)).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("never re-prices a locked quote (sent / won / lost), in either mode", async () => {
    for (const status of ["sent", "won", "lost"] as const) {
      const db = seed({ quote: makeQuoteRow({ status, priced_at: "2026-01-01T00:00:00Z", subtotal_price: 1234 }) });
      await expect(repriceQuote(QUOTE_ID)).rejects.toMatchObject({ code: "locked" });
      state.session = null;
      await expect(repriceQuote(QUOTE_ID, { admin: true })).rejects.toMatchObject({ code: "locked" });
      state.session = { user: { id: USER_ID }, profile: { id: USER_ID, role: "sales" } };
      expect(db.tables.quotes[0]).toMatchObject({ status, priced_at: "2026-01-01T00:00:00Z", subtotal_price: 1234 });
      expect(db.tables.operations.some((o) => o.id === "old-op")).toBe(true);
      expect(db.writes).toHaveLength(0);
    }
  });

  it("session mode persists through the user's RLS client and never creates the admin client", async () => {
    const db = seed();
    vi.mocked(createAdminClient).mockClear();
    // No service-role key on this deployment: the admin client cannot even be built.
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new EnvError("Missing environment variable SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) — see env.example.");
    });
    try {
      const priced = await repriceQuote(QUOTE_ID);
      expect(priced).not.toBeNull();
      expect(createAdminClient).not.toHaveBeenCalled();
      expect(db.tables.operations.length).toBe(priced!.items[0].operations.length);
      expect(db.tables.quotes[0].pricing).toMatchObject({ rateVersionId: RATE_VERSION_ID, inputMarginPct: 30 });
      expect(typeof db.tables.quotes[0].priced_at).toBe("string");
    } finally {
      vi.mocked(createAdminClient).mockImplementation(() => state.admin as ReturnType<typeof createAdminClient>);
    }
  });

  it("admin mode skips the session and prices with the admin client", async () => {
    const db = seed();
    state.session = null;
    vi.mocked(createAdminClient).mockClear();
    const priced = await repriceQuote(QUOTE_ID, { admin: true });
    expect(priced).not.toBeNull();
    expect(createAdminClient).toHaveBeenCalled();
    expect(db.tables.operations.length).toBe(priced!.items[0].operations.length);
  });

  it("uses the pinned version for old quotes (never the active one)", async () => {
    const { loadRateSnapshot } = await import("@/lib/rates/load");
    seed({ quote: makeQuoteRow({ rate_version_id: "old-version" }) });
    const priced = await repriceQuote(QUOTE_ID);
    expect(vi.mocked(loadRateSnapshot).mock.calls.at(-1)?.[1]).toBe("old-version");
    expect(priced!.rateVersionId).toBe("old-version");
  });

  it("writes a member's qty back to assembly.qty × qty_per_assembly before pricing and passes the job rates", async () => {
    const { loadJobRates } = await import("@/lib/rates/load");
    vi.mocked(loadJobRates).mockClear();
    const db = seed({
      items: [makeItemRow({ qty: 50, assembly_id: ASSEMBLY_ID, qty_per_assembly: 2 })],
      assemblies: [makeAssemblyRow({ qty: 3 })],
      seams: [makeSeamRow()],
    });
    const priced = await repriceQuote(QUOTE_ID);
    expect(priced).not.toBeNull();
    expect(db.tables.quote_items[0].qty).toBe(6);
    const memberWrite = db.writes.find((w) => w.op === "update" && w.table === "quote_items" && "qty" in w.patch);
    expect(memberWrite).toMatchObject({ patch: { qty: 6 } });
    expect(loadJobRates).toHaveBeenCalledTimes(1);
    // every member row still carries a unit_cost / unit_price write (a line or a reset)
    expect(db.writes.some((w) => w.op === "update" && w.table === "quote_items" && "unit_cost" in w.patch)).toBe(true);
  });

  it("prices without the job rates when their loader fails (settings tables not migrated yet)", async () => {
    const { loadJobRates } = await import("@/lib/rates/load");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(loadJobRates).mockImplementationOnce(async () => {
      throw new Error("company_settings: relation does not exist");
    });
    const db = seed();
    const priced = await repriceQuote(QUOTE_ID);
    expect(priced).not.toBeNull();
    expect(typeof db.tables.quotes[0].priced_at).toBe("string");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("fails instead of pricing members as loose parts when the job-rates loader fails and the quote has an assembly", async () => {
    const { loadJobRates } = await import("@/lib/rates/load");
    vi.mocked(loadJobRates).mockImplementationOnce(async () => {
      throw new Error("weld_speeds: canceling statement due to statement timeout");
    });
    const db = seed({
      items: [makeItemRow({ assembly_id: ASSEMBLY_ID, qty_per_assembly: 1, qty: 1 })],
      assemblies: [makeAssemblyRow({ qty: 1 })],
      seams: [makeSeamRow()],
    });
    await expect(repriceQuote(QUOTE_ID)).rejects.toThrow(/statement timeout/);
    expect(db.tables.quotes[0].priced_at).toBeNull();
    expect(db.writes.some((w) => w.op === "update" && w.table === "quotes" && "pricing" in w.patch)).toBe(false);
  });

  it("keeps the part id on every persisted flag", async () => {
    const db = seed();
    await repriceQuote(QUOTE_ID);
    const flags = db.tables.quote_items[0].flags as { partId: string }[];
    expect(flags.every((f) => f.partId === PART_ID)).toBe(true);
  });
});
