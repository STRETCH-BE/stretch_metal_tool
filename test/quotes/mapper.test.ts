/**
 * Rows → QuoteInput assembly and PricedQuote → persistence mapping
 * (lib/quotes/mapper.ts), the light JSON guards, and the real pricing
 * engine run on 200164-like data through the mapper.
 * File path: /test/quotes/mapper.test.ts
 */
import { describe, expect, it } from "vitest";
import { priceQuote } from "@/lib/pricing/price-quote";
import {
  buildQuoteInput,
  emptyGeometry,
  emptyPersistence,
  hasPriceableContent,
  partRowToPricingPart,
  pricedToPersistence,
  toJson,
} from "@/lib/quotes/mapper";
import { parseAnnotations, parseExtras, parseFlags, parseGeometry, parsePricing, parseWeldingOnly } from "@/lib/quotes/schema";
import { EMPTY_ANNOTATIONS } from "@/lib/geometry/types";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, RATE_VERSION_ID, cloneSnapshot } from "@/test/helpers/rates";
import { ITEM_ID, PART_ID, makeCustomer, makeItemRow, makePartRow, makeQuoteRow, priceFixture } from "./fixtures";

describe("JSON guards", () => {
  it("parseGeometry accepts the engine shape and rejects junk", () => {
    const row = makePartRow();
    const geometry = parseGeometry(row.geometry);
    expect(geometry?.measures.pierces).toBe(33);
    expect(geometry?.entities.length).toBeGreaterThan(30);
    expect(parseGeometry(null)).toBeNull();
    expect(parseGeometry({ version: 2 })).toBeNull();
    expect(parseGeometry([])).toBeNull();
    expect(parseGeometry("x")).toBeNull();
  });

  it("parseAnnotations fills missing keys and keeps welds/bends", () => {
    expect(parseAnnotations({})).toEqual(EMPTY_ANNOTATIONS);
    expect(parseAnnotations(null)).toEqual(EMPTY_ANNOTATIONS);
    const parsed = parseAnnotations(makePartRow().annotations);
    expect(parsed.welds).toHaveLength(1);
    expect(parsed.welds[0].stitch).toEqual({ beadLengthMm: 30, pitchMm: 60 });
    expect(parsed.deletedEntityIds).toEqual([]);
  });

  it("parseExtras drops malformed entries and keeps valid ones", () => {
    const extras = parseExtras([
      { type: "machining", minutes: 12, note: null },
      { type: "feature", code: "countersink", count: 4 },
      { type: "feature", code: "countersink", count: -1 },
      { type: "bogus" },
      { type: "other", label: "Packing", unitCost: 3.5 },
    ]);
    expect(extras).toEqual([
      { type: "machining", minutes: 12, note: null },
      { type: "feature", code: "countersink", count: 4 },
      { type: "other", label: "Packing", unitCost: 3.5 },
    ]);
    expect(parseExtras(null)).toEqual([]);
  });

  it("parseWeldingOnly / parseFlags / parsePricing", () => {
    expect(parseWeldingOnly(null)).toBeNull();
    expect(
      parseWeldingOnly({
        seams: [{ id: "s1", label: "A", process: "tig", beadMm: 3, lengthMm: 200, pattern: "full", stitch: null, sides: 2, qty: 3 }],
        partsCount: 2,
      })
    ).toMatchObject({ partsCount: 2, seams: [{ id: "s1", sides: 2, qty: 3 }] });
    expect(parseFlags([{ code: "x", severity: "amber", partId: null, itemId: null, params: {}, overridable: true }, { nope: 1 }])).toHaveLength(1);
    const priced = priceFixture();
    expect(parsePricing(toJson(priced))?.subtotalCost).toBeCloseTo(priced.subtotalCost, 9);
    expect(parsePricing({})).toBeNull();
  });
});

describe("buildQuoteInput", () => {
  const rates = RATE_SNAPSHOT_V1;

  it("maps items in position order with parsed extras/scrap and parts with geometry + annotations", () => {
    const second = makePartRow({ id: "22222222-2222-4222-8222-222222222222", name: "B" });
    const input = buildQuoteInput({
      quote: makeQuoteRow(),
      customer: makeCustomer(),
      items: [
        makeItemRow({ id: "i2", part_id: second.id, position: 1, qty: 5, extras: [{ type: "machining", minutes: 3, note: null }], scrap_pct: 12.5 }),
        makeItemRow({ position: 0 }),
      ],
      parts: [makePartRow(), second],
      rates,
    });
    expect(input.type).toBe("fabrication");
    expect(input.marginPct).toBe(30);
    expect(input.customerClass).toBe("standard");
    expect(input.items.map((i) => i.id)).toEqual([ITEM_ID, "i2"]);
    expect(input.items[1]).toMatchObject({ qty: 5, scrapPct: 12.5, extras: [{ type: "machining", minutes: 3 }] });
    expect(input.parts.map((p) => p.id)).toEqual([PART_ID, second.id]);
    expect(input.parts[0].geometry.measures.pierces).toBe(33);
    expect(input.parts[0].annotations.welds).toHaveLength(1);
    expect(input.parts[0]).toMatchObject({ materialCode: "DC01", thicknessMm: 2, source: "dxf" });
    expect(input.weldingOnly).toBeNull();
  });

  it("resolves the margin through resolveMarginPct (explicit quote margin wins, class next, default last)", () => {
    const snap = cloneSnapshot();
    snap.general.defaultMarginPct = 25;
    snap.general.marginByClass = { key: 20 };
    const explicit = buildQuoteInput({ quote: makeQuoteRow({ margin_pct: 35 }), customer: makeCustomer({ customer_class: "key" }), items: [], parts: [], rates: snap });
    expect(explicit.marginPct).toBe(35);
    const byClass = buildQuoteInput({ quote: makeQuoteRow({ margin_pct: Number.NaN }), customer: makeCustomer({ customer_class: "key" }), items: [], parts: [], rates: snap });
    expect(byClass.marginPct).toBe(20);
    const fallback = buildQuoteInput({ quote: makeQuoteRow({ margin_pct: Number.NaN }), customer: null, items: [], parts: [], rates: snap });
    expect(fallback.marginPct).toBe(25);
  });

  it("prices a part without geometry as an empty red geometry instead of crashing", () => {
    const input = buildQuoteInput({
      quote: makeQuoteRow(),
      customer: null,
      items: [makeItemRow()],
      parts: [makePartRow({ geometry: null, source: "step" })],
      rates,
    });
    expect(input.parts[0].geometry.triage.state).toBe("red_no_closed_contour");
    expect(input.parts[0].geometry.source).toBe("step");
    const priced = priceQuote(input, rates, MACHINE_PARK);
    expect(priced.flags.some((f) => f.code === "geometry.triage_red" && f.severity === "red")).toBe(true);
  });

  it("skips items whose part is missing and reports priceable content", () => {
    const input = buildQuoteInput({ quote: makeQuoteRow(), customer: null, items: [makeItemRow({ part_id: "missing" })], parts: [], rates });
    expect(input.items).toEqual([]);
    expect(hasPriceableContent(input)).toBe(false);
    const welding = buildQuoteInput({
      quote: makeQuoteRow({ type: "welding_only", welding_only: null }),
      customer: null,
      items: [],
      parts: [],
      rates,
    });
    expect(welding.weldingOnly).toEqual({ seams: [], partsCount: 0 });
    expect(hasPriceableContent(welding)).toBe(false);
    const seams = buildQuoteInput({
      quote: makeQuoteRow({
        type: "welding_only",
        welding_only: { seams: [{ id: "s", label: "", process: "mig_mag", beadMm: 4, lengthMm: 100, pattern: "full", stitch: null, sides: 1, qty: 1 }], partsCount: 1 },
      }),
      customer: null,
      items: [],
      parts: [],
      rates,
    });
    expect(hasPriceableContent(seams)).toBe(true);
  });

  it("emptyGeometry is a valid PartGeometry", () => {
    const g = emptyGeometry("manual", 3);
    expect(g.material.thicknessMm).toBe(3);
    expect(g.measures.cutLengthMm).toBe(0);
    expect(partRowToPricingPart(makePartRow({ geometry: null, thickness_mm: null })).geometry.material.thicknessMm).toBeNull();
  });
});

describe("real priceQuote through the mapper (200164 × 50, 4 bends, stitch weld)", () => {
  const input = buildQuoteInput({ quote: makeQuoteRow(), customer: makeCustomer(), items: [makeItemRow()], parts: [makePartRow()], rates: RATE_SNAPSHOT_V1 });
  const priced = priceQuote(input, RATE_SNAPSHOT_V1, MACHINE_PARK);

  it("matches the engine's Step 14 (3) scenario", () => {
    const item = priced.items[0];
    const types = item.operations.map((o) => o.type);
    expect(types).toContain("laser_cut");
    expect(types).toContain("material");
    expect(types.filter((t) => t === "bend")).toHaveLength(4);
    expect(types).toContain("weld");
    expect(item.operations.filter((o) => o.type === "setup").map((s) => s.label)).toEqual(["bend_setup", "weld_setup"]);
    expect(item.unitCost).toBeCloseTo(0.344623 + 0.946734 + 3.6 + 0.16 + 12.47175 + 0.3, 4);
    expect(item.unitPrice).toBeCloseTo(item.unitCost / 0.7, 9);
    expect(priced.rateVersionId).toBe(RATE_VERSION_ID);
    expect(priced.flags.filter((f) => f.severity === "red")).toEqual([]);
  });

  it("pricedToPersistence maps items, operations (positions) and the quote columns in the quote currency", () => {
    const persistence = pricedToPersistence(priced, { currency: "PLN", fx_rate: 4.3 });
    expect(persistence.items).toEqual([
      { id: ITEM_ID, unit_cost: priced.items[0].unitCost, unit_price: priced.items[0].unitPrice, flags: toJson(priced.items[0].flags) },
    ]);
    expect(persistence.operations).toHaveLength(priced.items[0].operations.length);
    expect(persistence.operations.map((o) => o.position)).toEqual(priced.items[0].operations.map((_, i) => i));
    expect(persistence.operations.every((o) => o.quote_item_id === ITEM_ID)).toBe(true);
    const bend = persistence.operations.find((o) => o.type === "bend");
    expect(bend).toMatchObject({ label: "bend", driver_unit: "bend", driver_qty: 1, auto: true, notes: null });
    expect(bend?.rate_ref).toMatchObject({ table: "rate_bend" });
    expect(persistence.quote.subtotal_cost).toBeCloseTo(priced.subtotalCost * 4.3, 6);
    expect(persistence.quote.subtotal_price).toBeCloseTo(priced.subtotalPrice * 4.3, 6);
    expect(persistence.quote.flags).toEqual(toJson(priced.flags));
    expect((persistence.quote.pricing as { subtotalPrice: number }).subtotalPrice).toBeCloseTo(priced.subtotalPrice, 9);

    const eur = pricedToPersistence(priced, { currency: "EUR", fx_rate: "4.3" });
    expect(eur.quote.subtotal_price).toBeCloseTo(priced.subtotalPrice, 9);
  });

  it("emptyPersistence clears everything", () => {
    expect(emptyPersistence()).toEqual({ pricing: null, flags: [], subtotal_cost: 0, subtotal_price: 0 });
  });

  it("is deterministic", () => {
    const again = priceQuote(input, RATE_SNAPSHOT_V1, MACHINE_PARK);
    expect(toJson(again)).toEqual(toJson(priced));
  });
});
