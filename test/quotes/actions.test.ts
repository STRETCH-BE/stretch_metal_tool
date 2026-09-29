/**
 * Quote server actions against the fake client: duplicate-as-new-version
 * numbering and copying, amber confirmation (self-approved override),
 * override request (pending + status flip), won/lost transitions, the
 * role/ownership gates, the header currency ↔ fx rule and the audited
 * explicit re-price; assembly mode: create / update / remove assembly
 * (members detached, not deleted), members in and out (qty rule), material
 * override, forming set / resolve / confirm-none, seams incl. the
 * addSeamFromPart double-click and neighbour-edge paths, header additions.
 * File path: /test/quotes/actions.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { JOB_RATES, MACHINE_PARK, RATE_SNAPSHOT_V1, RATE_VERSION_ID } from "@/test/helpers/rates";
import { ADMIN_ID, ASSEMBLY_ID, CUSTOMER_ID, ITEM_ID, ITEM_ID_2, PART_ID, PART_ID_2, QUOTE_ID, SEAM_ID, USER_ID, amberFlag, makeAssemblyRow, makeCustomer, makeItemRow, makePartRow, makeQuoteRow, makeSeamRow, redFlag } from "./fixtures";
import type { Row } from "./fake-supabase";

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
  loadJobRates: vi.fn(async () => JOB_RATES),
}));

import {
  addSeam,
  addSeamFromPart,
  confirmFlag,
  confirmNoForming,
  createAssembly,
  duplicateAsNewVersion,
  removeAssembly,
  removeSeam,
  repriceQuoteAction,
  requestOverride,
  resolveForming,
  setItemAssembly,
  setItemForming,
  setItemMaterialOverride,
  setQuoteStatus,
  unpairSeam,
  updateAssembly,
  updateItem,
  updateQuoteHeader,
  updateSeam,
} from "@/lib/quotes/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { EnvError } from "@/lib/env";
import type { QuoteHeaderInput } from "@/lib/quotes/schema";

function seed(
  options: {
    quote?: Partial<ReturnType<typeof makeQuoteRow>>;
    extraQuotes?: ReturnType<typeof makeQuoteRow>[];
    items?: Row[];
    parts?: Row[];
    assemblies?: Row[];
    seams?: Row[];
  } = {}
) {
  const db = new FakeSupabase({
    quotes: [makeQuoteRow(options.quote), ...(options.extraQuotes ?? [])],
    customers: [makeCustomer()],
    quote_items: options.items ?? [makeItemRow()],
    parts: options.parts ?? [makePartRow()],
    assemblies: options.assemblies ?? [],
    assembly_seams: options.seams ?? [],
    operations: [],
    overrides: [],
    rate_versions: [{ id: RATE_VERSION_ID, label: "v1", active: true }],
    files: [],
  });
  state.db = db;
  return db;
}

/** Two parts of the fixture quote, both members of the fixture assembly. */
function seedAssembly(over: { assembly?: Partial<ReturnType<typeof makeAssemblyRow>>; seams?: Row[]; items?: Row[] } = {}) {
  return seed({
    items: over.items ?? [
      makeItemRow({ assembly_id: ASSEMBLY_ID, qty_per_assembly: 1, qty: 1 }),
      makeItemRow({ id: ITEM_ID_2, part_id: PART_ID_2, position: 1, assembly_id: ASSEMBLY_ID, qty_per_assembly: 2, qty: 2 }),
    ],
    parts: [makePartRow(), makePartRow({ id: PART_ID_2, name: "P2" })],
    assemblies: [makeAssemblyRow(over.assembly)],
    seams: over.seams ?? [],
  });
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

describe("updateQuoteHeader (currency ↔ fx)", () => {
  beforeEach(() => {
    state.session = sales();
    state.logAudit.mockClear();
  });

  const header = (over: Partial<QuoteHeaderInput>): QuoteHeaderInput => ({
    customerId: CUSTOMER_ID,
    currency: "PLN",
    fxRate: 4.35,
    marginPct: 30,
    validityDays: 30,
    leadTimeDays: 11,
    leadTimeText: "",
    paymentTermsText: "",
    notes: "",
    showOperationsOnPdf: false,
    weldingSeparate: false,
    ...over,
  });

  it("rejects a PLN quote saved with the EUR sentinel rate (1) and writes nothing", async () => {
    const db = seed({ quote: { currency: "EUR", fx_rate: 1 } });
    expect(await updateQuoteHeader(QUOTE_ID, header({ currency: "PLN", fxRate: 1 }))).toEqual({ ok: false, error: "invalidFx" });
    expect(await updateQuoteHeader(QUOTE_ID, header({ currency: "PLN", fxRate: 0.23 }))).toEqual({ ok: false, error: "invalidFx" });
    expect(db.tables.quotes[0]).toMatchObject({ currency: "EUR", fx_rate: 1 });
    expect(db.writes).toHaveLength(0);
    expect(state.logAudit).not.toHaveBeenCalled();
  });

  it("EUR → PLN with a real rate stores the rate and prices the PLN subtotals with it", async () => {
    const db = seed({ quote: { currency: "EUR", fx_rate: 1 } });
    expect(await updateQuoteHeader(QUOTE_ID, header({ currency: "PLN", fxRate: 4.35 }))).toEqual({ ok: true });
    const quote = db.tables.quotes[0];
    expect(quote).toMatchObject({ currency: "PLN", fx_rate: 4.35 });
    const pricing = quote.pricing as { subtotalPrice: number };
    expect(pricing.subtotalPrice).toBeGreaterThan(0);
    expect(Number(quote.subtotal_price)).toBeCloseTo(pricing.subtotalPrice * 4.35, 6);
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "quote.update", after: expect.objectContaining({ currency: "PLN", fx_rate: 4.35 }) }));
  });

  it("PLN → EUR stores fx 1 whatever the field held and the subtotals equal the engine numbers", async () => {
    const db = seed();
    expect(await updateQuoteHeader(QUOTE_ID, header({ currency: "EUR", fxRate: 4.3 }))).toEqual({ ok: true });
    const quote = db.tables.quotes[0];
    expect(quote).toMatchObject({ currency: "EUR", fx_rate: 1 });
    const pricing = quote.pricing as { subtotalPrice: number };
    expect(Number(quote.subtotal_price)).toBeCloseTo(pricing.subtotalPrice, 6);
  });
});

describe("repriceQuoteAction", () => {
  beforeEach(() => {
    state.session = sales();
    state.logAudit.mockClear();
  });

  it("re-prices an editable quote and audits it as quote.reprice", async () => {
    const db = seed();
    expect(await repriceQuoteAction(QUOTE_ID)).toEqual({ ok: true });
    expect(typeof db.tables.quotes[0].priced_at).toBe("string");
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "quote.reprice", entity: "quotes", entityId: QUOTE_ID, actor: USER_ID }));
  });

  it("prices without the service-role key: the re-price runs as the user, so a deployment lacking the key still computes and stores prices", async () => {
    const db = seed();
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new EnvError("Missing environment variable SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) — see env.example.");
    });
    try {
      expect(await repriceQuoteAction(QUOTE_ID)).toEqual({ ok: true });
      expect(typeof db.tables.quotes[0].priced_at).toBe("string");
      expect(db.tables.quotes[0].pricing).toMatchObject({ rateVersionId: RATE_VERSION_ID, inputMarginPct: 30 });
      expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "quote.reprice" }));
    } finally {
      vi.mocked(createAdminClient).mockImplementation(() => state.db as ReturnType<typeof createAdminClient>);
    }
  });

  it("still names a missing server variable surfacing from the re-price as a configuration error, not a generic failure", async () => {
    const db = seed();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadRateSnapshot } = await import("@/lib/rates/load");
    vi.mocked(loadRateSnapshot).mockImplementationOnce(async () => {
      throw new EnvError("Missing environment variable NEXT_PUBLIC_SUPABASE_URL — see env.example.");
    });
    const result = await repriceQuoteAction(QUOTE_ID);
    expect(result).toEqual({ ok: false, error: "config", message: expect.stringContaining("NEXT_PUBLIC_SUPABASE_URL") });
    expect(db.tables.quotes[0].priced_at ?? null).toBeNull();
    expect(state.logAudit).not.toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("refuses locked quotes without touching them or logging", async () => {
    const db = seed({ quote: { status: "sent", priced_at: "2026-01-01T00:00:00Z" } });
    expect(await repriceQuoteAction(QUOTE_ID)).toEqual({ ok: false, error: "locked" });
    expect(db.tables.quotes[0].priced_at).toBe("2026-01-01T00:00:00Z");
    expect(db.writes).toHaveLength(0);
    expect(state.logAudit).not.toHaveBeenCalled();
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

describe("updateQuoteHeader (assembly-mode fields)", () => {
  beforeEach(() => {
    state.session = sales();
    state.logAudit.mockClear();
  });

  const header = (over: Partial<QuoteHeaderInput>): QuoteHeaderInput => ({
    customerId: CUSTOMER_ID,
    currency: "PLN",
    fxRate: 4.35,
    marginPct: 30,
    validityDays: 30,
    leadTimeDays: 11,
    leadTimeText: "",
    paymentTermsText: "",
    notes: "",
    showOperationsOnPdf: false,
    weldingSeparate: false,
    ...over,
  });

  it("stores reference, contact, shipping and price scale; an old-shaped header leaves them alone", async () => {
    const db = seed();
    expect(
      await updateQuoteHeader(QUOTE_ID, header({ customerReference: "N260580", contactPerson: "Anna", shipping: { countryCode: "fi", grossKg: 12, costEur: null, source: "table", carrier: null, extraLeadDays: 0 }, priceScale: [100, 20] }))
    ).toEqual({ ok: true });
    expect(db.tables.quotes[0]).toMatchObject({ customer_reference: "N260580", contact_person: "Anna", shipping: { countryCode: "FI", grossKg: 12 }, price_scale: [20, 100] });
    expect(await updateQuoteHeader(QUOTE_ID, header({}))).toEqual({ ok: true });
    expect(db.tables.quotes[0]).toMatchObject({ customer_reference: "N260580", contact_person: "Anna", price_scale: [20, 100] });
    expect(await updateQuoteHeader(QUOTE_ID, header({ customerReference: "", shipping: null, priceScale: [] }))).toEqual({ ok: true });
    expect(db.tables.quotes[0]).toMatchObject({ customer_reference: null, shipping: null, price_scale: [] });
    expect(await updateQuoteHeader(QUOTE_ID, header({ priceScale: [0] }))).toEqual({ ok: false, error: "invalidQty" });
  });
});

describe("assemblies", () => {
  beforeEach(() => {
    state.session = sales();
    state.logAudit.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("createAssembly validates, inserts at the next position, audits and re-prices", async () => {
    const db = seed({ assemblies: [makeAssemblyRow({ position: 4 })] });
    expect(await createAssembly(QUOTE_ID, { name: "", qty: 1 })).toEqual({ ok: false, error: "required" });
    expect(await createAssembly(QUOTE_ID, { name: "Box", qty: 0 })).toEqual({ ok: false, error: "invalidQty" });
    const result = await createAssembly(QUOTE_ID, { name: " Second box ", qty: 2, materialCode: "S235", thicknessMm: 3, drawingRef: "D-2" });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok || !("assemblyId" in result)) throw new Error("expected an assembly id");
    const row = db.tables.assemblies.find((a) => a.id === result.assemblyId);
    expect(row).toMatchObject({ quote_id: QUOTE_ID, name: "Second box", qty: 2, material_code: "S235", thickness_mm: 3, drawing_ref: "D-2", position: 5, notes: null });
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "assembly.create", entityId: result.assemblyId }));
    expect(typeof db.tables.quotes[0].priced_at).toBe("string");
  });

  it("viewers, strangers and locked quotes are refused", async () => {
    seed();
    state.session = { user: { id: "other" }, profile: { id: "other", role: "sales" } };
    expect(await createAssembly(QUOTE_ID, { name: "Box", qty: 1 })).toEqual({ ok: false, error: "forbidden" });
    seed({ quote: { status: "sent" } });
    state.session = sales();
    expect(await createAssembly(QUOTE_ID, { name: "Box", qty: 1 })).toEqual({ ok: false, error: "locked" });
    expect(await updateAssembly("not-a-uuid", { qty: 2 })).toEqual({ ok: false, error: "notFound" });
  });

  it("updateAssembly patches only the given fields; the members' qty follows the assembly qty on re-price", async () => {
    const db = seedAssembly();
    expect(await updateAssembly(ASSEMBLY_ID, { qty: 5, drawingRef: null })).toEqual({ ok: true });
    expect(db.tables.assemblies[0]).toMatchObject({ qty: 5, drawing_ref: null, name: "Heat store box rev 3", material_code: "S235" });
    expect(db.tables.quote_items.find((i) => i.id === ITEM_ID)?.qty).toBe(5);
    expect(db.tables.quote_items.find((i) => i.id === ITEM_ID_2)?.qty).toBe(10);
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "assembly.update" }));
    expect(await updateAssembly(ASSEMBLY_ID, {})).toEqual({ ok: true });
  });

  it("removeAssembly detaches the members (they stay as loose parts) and drops the seams", async () => {
    const db = seedAssembly({ seams: [makeSeamRow()] });
    expect(await removeAssembly(ASSEMBLY_ID)).toEqual({ ok: true });
    expect(db.tables.assemblies).toHaveLength(0);
    expect(db.tables.assembly_seams).toHaveLength(0);
    expect(db.tables.quote_items).toHaveLength(2);
    expect(db.tables.quote_items.every((i) => i.assembly_id === null && i.qty_per_assembly === 1)).toBe(true);
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "assembly.remove", entityId: ASSEMBLY_ID }));
    expect(await removeAssembly(ASSEMBLY_ID)).toEqual({ ok: false, error: "notFound" });
  });

  it("setItemAssembly moves a part in (qty = assembly.qty × per assembly) and out (loose, qty kept)", async () => {
    const db = seed({ assemblies: [makeAssemblyRow({ qty: 3 })] });
    expect(await setItemAssembly(ITEM_ID, { assemblyId: ASSEMBLY_ID, qtyPerAssembly: 4 })).toEqual({ ok: true });
    expect(db.tables.quote_items[0]).toMatchObject({ assembly_id: ASSEMBLY_ID, qty_per_assembly: 4, qty: 12 });
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "quote.item.assembly" }));
    // only the per-assembly quantity changes
    expect(await setItemAssembly(ITEM_ID, { assemblyId: ASSEMBLY_ID, qtyPerAssembly: 2 })).toEqual({ ok: true });
    expect(db.tables.quote_items[0]).toMatchObject({ qty_per_assembly: 2, qty: 6 });
    expect(await setItemAssembly(ITEM_ID, { assemblyId: null })).toEqual({ ok: true });
    expect(db.tables.quote_items[0]).toMatchObject({ assembly_id: null, qty_per_assembly: 1, qty: 6 });
    // an assembly of another quote
    db.tables.assemblies.push(makeAssemblyRow({ id: "a55e3b1e-0000-4000-8000-00000000beef", quote_id: "99999999-9999-4999-8999-999999999999" }));
    expect(await setItemAssembly(ITEM_ID, { assemblyId: "a55e3b1e-0000-4000-8000-00000000beef" })).toEqual({ ok: false, error: "notFound" });
    expect(await setItemAssembly(ITEM_ID, { assemblyId: ASSEMBLY_ID, qtyPerAssembly: 0 })).toEqual({ ok: false, error: "invalidQty" });
  });

  it("setItemMaterialOverride stores the flag and the note", async () => {
    const db = seedAssembly();
    expect(await setItemMaterialOverride(ITEM_ID_2, { materialOverride: true, materialNote: " DC01 zamiast S235 " })).toEqual({ ok: true });
    expect(db.tables.quote_items.find((i) => i.id === ITEM_ID_2)).toMatchObject({ material_override: true, material_note: "DC01 zamiast S235" });
    expect(await setItemMaterialOverride(ITEM_ID_2, { materialOverride: false, materialNote: null })).toEqual({ ok: true });
    expect(db.tables.quote_items.find((i) => i.id === ITEM_ID_2)).toMatchObject({ material_override: false, material_note: null });
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "quote.item.material_override" }));
  });
});

describe("forming", () => {
  beforeEach(() => {
    state.session = sales();
    state.logAudit.mockClear();
  });

  it("setItemForming replaces the list, keeps given ids and generates missing ones", async () => {
    const db = seedAssembly();
    expect(await setItemForming(ITEM_ID_2, [{ kind: "roll", insideRadiusMm: -1, angleDeg: 180, widthMm: 247 }])).toEqual({ ok: false, error: "invalidNumber" });
    expect(await setItemForming(ITEM_ID_2, [{ id: "r1", kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247 }, { kind: "bend", bends: 2, angleDeg: 90, lengthMm: 300 }])).toEqual({ ok: true });
    const forming = db.tables.quote_items.find((i) => i.id === ITEM_ID_2)!.forming as { id: string; kind: string; resolution: unknown }[];
    expect(forming).toHaveLength(2);
    expect(forming[0]).toMatchObject({ id: "r1", kind: "roll", resolution: null });
    expect(forming[1].kind).toBe("bend");
    expect(typeof forming[1].id).toBe("string");
    expect(forming[1].id).not.toBe("r1");
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "quote.item.forming" }));
  });

  it("resolveForming sets one operation's resolution", async () => {
    const db = seedAssembly({
      items: [makeItemRow({ assembly_id: ASSEMBLY_ID, forming: [{ id: "r1", kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: null }] })],
    });
    expect(await resolveForming(ITEM_ID, "r1", { kind: "step_bend", hits: 19 })).toEqual({ ok: true });
    expect(db.tables.quote_items[0].forming).toEqual([{ id: "r1", kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: { kind: "step_bend", hits: 19 } }]);
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "forming.resolve" }));
    expect(await resolveForming(ITEM_ID, "missing", { kind: "in_house" })).toEqual({ ok: false, error: "notFound" });
    expect(await resolveForming(ITEM_ID, "r1", { kind: "step_bend", hits: 0 })).toEqual({ ok: false, error: "invalidQty" });
    expect(await resolveForming(ITEM_ID, "r1", { kind: "subcontract", supplier: "Walcownia", costEur: 40, extraLeadDays: 5 })).toEqual({ ok: true });
  });

  it("confirmNoForming stores one none_needed operation with the drawing's suspected geometry", async () => {
    const rolled = makePartRow({
      id: PART_ID_2,
      annotations: { ...(makePartRow().annotations as Record<string, unknown>), roll: { radiusMm: 90, axis: "x", arcAngleDeg: 180, axisLengthMm: 247, developedWidthMm: 285.9, cone: null }, forming: "rolled" },
    });
    const db = seedAssembly({ items: [makeItemRow({ assembly_id: ASSEMBLY_ID }), makeItemRow({ id: ITEM_ID_2, part_id: PART_ID_2, position: 1, assembly_id: ASSEMBLY_ID, forming: [{ id: "old", kind: "roll", insideRadiusMm: 1, angleDeg: 1, widthMm: 1, resolution: null }] })] });
    db.tables.parts = [makePartRow(), rolled];
    expect(await confirmNoForming(ITEM_ID_2)).toEqual({ ok: true });
    const forming = db.tables.quote_items.find((i) => i.id === ITEM_ID_2)!.forming as { kind: string; resolution: { kind: string } }[];
    expect(forming).toHaveLength(1);
    expect(forming[0]).toMatchObject({ kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: { kind: "none_needed" } });
    // the fixture part's DXF has four bend lines → a bend operation
    expect(await confirmNoForming(ITEM_ID)).toEqual({ ok: true });
    const bent = db.tables.quote_items.find((i) => i.id === ITEM_ID)!.forming as { kind: string; bends?: number; resolution: { kind: string } }[];
    expect(bent).toHaveLength(1);
    expect(bent[0]).toMatchObject({ kind: "bend", bends: 4, resolution: { kind: "none_needed" } });
    // a drawing without roll or bend lines → a roll with zeros
    db.tables.parts[0].geometry = null;
    expect(await confirmNoForming(ITEM_ID)).toEqual({ ok: true });
    const flat = db.tables.quote_items.find((i) => i.id === ITEM_ID)!.forming as { kind: string; insideRadiusMm?: number; resolution: { kind: string } }[];
    expect(flat[0]).toMatchObject({ kind: "roll", insideRadiusMm: 0, angleDeg: 0, widthMm: 0, resolution: { kind: "none_needed" } });
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "forming.confirm_none" }));
  });
});

describe("seams", () => {
  beforeEach(() => {
    state.session = sales();
    state.logAudit.mockClear();
  });

  const seam = { lengthMm: 1250, process: "mig_mag" as const, seamType: "continuous" as const, entityIds: ["e1", "e2"] };

  it("addSeam inserts at the next position (never matched), validates the pattern rules", async () => {
    const db = seedAssembly({ seams: [makeSeamRow({ position: 2 })] });
    expect(await addSeam(ASSEMBLY_ID, { ...seam, seamType: "stitch" })).toEqual({ ok: false, error: "required" });
    const result = await addSeam(ASSEMBLY_ID, { ...seam, label: "Top", partId: PART_ID });
    expect(result).toMatchObject({ ok: true, pairedSeamId: null });
    if (!result.ok) return;
    expect(db.tables.assembly_seams.find((s) => s.id === result.seamId)).toMatchObject({ assembly_id: ASSEMBLY_ID, position: 3, label: "Top", part_id: PART_ID, length_mm: 1250, process: "mig_mag", seam_type: "continuous", sides: 1, paired_seam_id: null, entity_ids: ["e1", "e2"] });
    expect(db.tables.assembly_seams).toHaveLength(2);
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "seam.add", entityId: result.seamId }));
    expect(await addSeam("a55e3b1e-0000-4000-8000-00000000dead", seam)).toEqual({ ok: false, error: "notFound" });
  });

  it("addSeamFromPart: the same edge twice → the existing seam (one row); the neighbour's edge → paired and not counted; another process → new", async () => {
    const db = seedAssembly();
    const first = await addSeamFromPart(PART_ID, seam);
    expect(first).toMatchObject({ ok: true, pairedSeamId: null });
    if (!first.ok) return;
    expect(db.tables.assembly_seams).toHaveLength(1);
    // double click
    const again = await addSeamFromPart(PART_ID, { ...seam, entityIds: ["e2", "e1"], lengthMm: 1249.5 });
    expect(again).toEqual({ ok: true, seamId: first.seamId, pairedSeamId: null });
    expect(db.tables.assembly_seams).toHaveLength(1);
    expect(state.logAudit).toHaveBeenCalledTimes(1);
    // the neighbour's edge
    const neighbour = await addSeamFromPart(PART_ID_2, { ...seam, entityIds: ["n1"], lengthMm: 1251 });
    expect(neighbour).toMatchObject({ ok: true, pairedSeamId: first.seamId });
    if (!neighbour.ok) return;
    expect(db.tables.assembly_seams.find((s) => s.id === neighbour.seamId)).toMatchObject({ part_id: PART_ID_2, paired_seam_id: first.seamId });
    // a TIG seam of the same length on the neighbour is a different joint
    const tig = await addSeamFromPart(PART_ID_2, { ...seam, entityIds: ["n2"], process: "tig" });
    expect(tig).toMatchObject({ ok: true, pairedSeamId: null });
    expect(db.tables.assembly_seams).toHaveLength(3);
    // the pricing input counts the joint once
    const pricing = db.tables.quotes[0].pricing as { assemblies: unknown[] } | null;
    expect(pricing).not.toBeNull();
  });

  it("addSeamFromPart refuses a part that is not an assembly member", async () => {
    seed({ assemblies: [makeAssemblyRow()] });
    expect(await addSeamFromPart(PART_ID, seam)).toEqual({ ok: false, error: "notFound" });
    expect(await addSeamFromPart("nope", seam)).toEqual({ ok: false, error: "notFound" });
  });

  it("updateSeam merges the patch over the stored row and re-validates; removeSeam unpairs its partner; unpairSeam counts a seam again", async () => {
    const db = seedAssembly({ seams: [makeSeamRow(), makeSeamRow({ id: "5ea30000-0000-4000-8000-000000000002", part_id: PART_ID_2, position: 1, paired_seam_id: SEAM_ID })] });
    expect(await updateSeam(SEAM_ID, { seamType: "stitch" })).toEqual({ ok: false, error: "required" });
    expect(await updateSeam(SEAM_ID, { seamType: "stitch", stitchBeadMm: 30, stitchPitchMm: 60, sides: 2 })).toEqual({ ok: true });
    expect(db.tables.assembly_seams[0]).toMatchObject({ seam_type: "stitch", stitch_bead_mm: 30, stitch_pitch_mm: 60, sides: 2, length_mm: 1250, part_id: PART_ID });
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "seam.update" }));

    expect(await unpairSeam("5ea30000-0000-4000-8000-000000000002")).toEqual({ ok: true });
    expect(db.tables.assembly_seams[1].paired_seam_id).toBeNull();
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "seam.unpair" }));
    // pair it back by hand for the removal check
    db.tables.assembly_seams[1].paired_seam_id = SEAM_ID;

    expect(await removeSeam(SEAM_ID)).toEqual({ ok: true });
    expect(db.tables.assembly_seams).toHaveLength(1);
    expect(db.tables.assembly_seams[0]).toMatchObject({ id: "5ea30000-0000-4000-8000-000000000002", paired_seam_id: null });
    expect(state.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "seam.remove", entityId: SEAM_ID }));
    expect(await removeSeam(SEAM_ID)).toEqual({ ok: false, error: "notFound" });
  });
});
