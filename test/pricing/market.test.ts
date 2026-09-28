/**
 * Market pricing mode (lib/pricing/market.ts) with a synthetic selling-price
 * version derived from the placeholder fixture: material by net mass on the
 * band at exactly the part's thickness, laser per metre, set-up split per
 * (material, thickness) group over its PIECES, order charge over all
 * pieces, deburring with a per-line set-up and a minimum size, engraving
 * per part, packaging, the lead-time steps, margin against the cost
 * version, refusals, and the guarantee that cost mode is untouched.
 * The v2 benchmark numbers themselves are checked in market-v2.test.ts.
 * File path: /test/pricing/market.test.ts
 */

import { describe, expect, it } from "vitest";
import { priceCostQuote, priceQuote } from "@/lib/pricing/price-quote";
import type { Flag, FlagCode, OperationLine, PricingItem, PricingPart, RateSnapshot } from "@/lib/pricing/types";
import { makeRectPartGeometry } from "@/test/helpers/geometry";
import { makeItem, makePricingPart, makeQuoteInput } from "@/test/helpers/quote";
import { FINISH_V3_DEFAULTS, MACHINE_PARK, RATE_SNAPSHOT_V1, cloneSnapshot } from "@/test/helpers/rates";

const KG_PER_MM3 = 7850e-9;

function rect(id: string, lengthMm: number, widthMm: number, thicknessMm: number, materialCode = "S235", holes: { x: number; y: number; diameterMm: number }[] = []): PricingPart {
  const geometry = makeRectPartGeometry({ lengthMm, widthMm, thicknessMm, densityKgM3: 7850, holes });
  return makePricingPart({ id, name: id, geometry, materialCode, thicknessMm });
}

function marketSnapshot(): RateSnapshot {
  const s = cloneSnapshot();
  s.versionId = "market-v1";
  s.label = "market test";
  s.general = { ...s.general, pricingMode: "market", orderChargeEur: 38, packagingBoxEur: 9, packagingPalletEur: 45, blankMarginMm: 0, defaultMarginPct: 0, handlingSurchargeEur: 0, placeholder: false };
  for (const m of s.materials) {
    // one band per benchmarked thickness — the gate wants the band at exactly t
    m.pricePerKg = [1.5, 3].map((t) => ({ maxThicknessMm: t, pricePerKg: m.code === "1.4301" ? 4 : 1 }));
    m.scrapPctDefault = 0;
    m.placeholder = false;
  }
  const perM = (materialCode: string, thicknessMm: number, pricePerM: number, pricePerPierce: number, setupEur: number) => ({
    materialCode,
    thicknessMm,
    mode: "per_m" as const,
    speedMMin: null,
    pierceS: null,
    pricePerM,
    pricePerPierce,
    gas: "N2" as const,
    minContourMm: null,
    inHouse: true,
    supplier: null,
    placeholder: false,
    setupEur,
  });
  s.laser = [perM("S235", 1.5, 2, 0.1, 10), perM("S235", 3, 3, 0.2, 12), perM("1.4301", 1.5, 4, 0.3, 15)];
  s.tubeLaser = [];
  s.bend = [];
  s.roll = [];
  s.weld = [];
  s.feature = [];
  s.thread = [];
  s.finish = [
    { code: "deburr", name: "Deburring", unit: "m", price: 0.5, minimum: 0, placeholder: false, setupPerOrderEur: 0, setupPerLineEur: 20, minPartMm: "steel 250x60 or 600x50; aluminium/stainless 50x50", ...FINISH_V3_DEFAULTS },
    { code: "engrave", name: "Engraving", unit: "part", price: 3, minimum: 0, placeholder: false, setupPerOrderEur: 0, setupPerLineEur: 0, minPartMm: null, ...FINISH_V3_DEFAULTS },
  ];
  s.leadtime = [
    { workingDays: 3, multiplier: 1.4, placeholder: false },
    { workingDays: 6, multiplier: 1.15, placeholder: false },
    { workingDays: 11, multiplier: 1, placeholder: false },
  ];
  return s;
}

const p1 = rect("p1", 100, 100, 1.5);
const p2 = rect("p2", 400, 400, 1.5);
const p3 = rect("p3", 100, 100, 3);
const deburr: PricingItem["extras"][number] = { type: "finish", code: "deburr", maskingMinutes: 0, note: null };
const engrave: PricingItem["extras"][number] = { type: "finish", code: "engrave", maskingMinutes: 0, note: null };

function threeLines(leadTimeDays: number | null = 11) {
  return makeQuoteInput({
    marginPct: 0,
    parts: [p1, p2, p3],
    items: [
      makeItem({ id: "i1", partId: "p1" }),
      makeItem({ id: "i2", partId: "p2", qty: 2, extras: [deburr] }),
      makeItem({ id: "i3", partId: "p3", extras: [engrave] }),
    ],
    leadTimeDays,
  });
}

const byLabel = (ops: OperationLine[], label: string) => ops.find((o) => o.label === label);
const codes = (flags: Flag[]): FlagCode[] => flags.map((f) => f.code);
const sum = (ops: OperationLine[]) => ops.reduce((s, o) => s + o.unitCost, 0);
const price = (item: { unitPrice: number | null }) => item.unitPrice ?? Number.NaN;

describe("market mode — per-piece rules", () => {
  const market = marketSnapshot();
  const priced = priceQuote(threeLines(), market, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1 });
  const [i1, i2, i3] = priced.items;

  it("is reported as market mode with the cost version and the lead time", () => {
    expect(priced.pricingMode).toBe("market");
    expect(priced.costRateVersionId).toBe(RATE_SNAPSHOT_V1.versionId);
    expect(priced.rateVersionId).toBe("market-v1");
    expect(priced.leadTimeDays).toBe(11);
    expect(priced.leadTimeMultiplier).toBe(1);
    expect(priced.items.every((i) => i.unitPrice !== null)).toBe(true);
  });

  it("material = net mass × €/kg of the band at exactly t (no blank, no scrap); laser = cut length × €/m + pierces × €/pierce", () => {
    const material = byLabel(i1.operations, "material")!;
    expect(material.driverQty).toBeCloseTo(100 * 100 * 1.5 * KG_PER_MM3, 12);
    expect(material.unitCost).toBeCloseTo(0.11775, 9);
    expect(material.rateRef.values.scrapPct).toBe(0);
    expect(material.rateRef.values.bandMaxThicknessMm).toBe(1.5);
    expect(byLabel(i3.operations, "material")!.rateRef.values.bandMaxThicknessMm).toBe(3);
    const laser = byLabel(i1.operations, "laser_cut")!;
    expect(laser.unitCost).toBeCloseTo(0.4 * 2 + 1 * 0.1, 12);
    expect(laser.details.slowFactorApplied).toBe(false);
  });

  it("splits the laser set-up once per (material, thickness) over the PIECES of that group", () => {
    // S235/1.5: i1 (qty 1) + i2 (qty 2) = 3 pieces → 10 € / 3 per piece on both lines.
    expect(byLabel(i1.operations, "laser_setup")!.unitCost).toBeCloseTo(10 / 3, 12);
    expect(byLabel(i2.operations, "laser_setup")!.unitCost).toBeCloseTo(10 / 3, 12);
    expect(byLabel(i2.operations, "laser_setup")!.setupShare).toBeCloseTo(10 / 3, 12);
    expect(byLabel(i2.operations, "laser_setup")!.details.piecesInGroup).toBe(3);
    // S235/3: only i3 → the full 12 €.
    expect(byLabel(i3.operations, "laser_setup")!.unitCost).toBeCloseTo(12, 12);
    expect(byLabel(i3.operations, "laser_setup")!.details.piecesInGroup).toBe(1);
  });

  it("splits the order charge equally over all pieces of the quote", () => {
    expect(byLabel(i1.operations, "order_charge")!.unitCost).toBeCloseTo(38 / 4, 12);
    expect(byLabel(i2.operations, "order_charge")!.unitCost).toBeCloseTo(38 / 4, 12);
    expect(byLabel(i3.operations, "order_charge")!.type).toBe("order");
    expect(byLabel(i3.operations, "order_charge")!.details.pieces).toBe(4);
  });

  it("deburring = its per-line set-up ÷ qty + €/m × cut length", () => {
    expect(byLabel(i2.operations, "finish_setup")!.unitCost).toBeCloseTo(20 / 2, 12);
    expect(byLabel(i2.operations, "deburr")!.unitCost).toBeCloseTo(1.6 * 0.5, 12);
    expect(byLabel(i2.operations, "deburr")!.type).toBe("finish_deburr");
    expect(byLabel(i1.operations, "deburr")).toBeUndefined();
    expect(byLabel(i1.operations, "finish_setup")).toBeUndefined();
  });

  it("engraving is priced per part when selected", () => {
    const line = byLabel(i3.operations, "engrave")!;
    expect(line.unitCost).toBe(3);
    expect(line.driverUnit).toBe("part");
    expect(byLabel(i1.operations, "engrave")).toBeUndefined();
  });

  it("unit price = Σ lines with no margin on top; one box packaging line at quote level", () => {
    expect(i1.unitPrice).toBeCloseTo(0.9 + 0.11775 + 10 / 3 + 38 / 4, 9);
    expect(i2.unitPrice).toBeCloseTo(3.3 + 1.884 + 10 / 3 + 38 / 4 + 10 + 0.8, 9);
    expect(i3.unitPrice).toBeCloseTo(1.4 + 0.2355 + 12 + 38 / 4 + 3, 9);
    expect(priced.quoteLines).toHaveLength(1);
    expect(priced.quoteLines[0]).toMatchObject({ type: "packaging", label: "packaging_box", unitCost: 9 });
    expect(priced.subtotalPrice).toBeCloseTo(price(i1) * 1 + price(i2) * 2 + price(i3) * 1 + 9, 9);
    expect(priced.items.every((i) => Math.abs(sum(i.operations) - price(i)) < 1e-9)).toBe(true);
    expect(priced.flags.filter((f) => f.severity === "red")).toEqual([]);
  });

  it("cost and margin come from the cost version priced on the same input", () => {
    const cost = priceCostQuote(threeLines(), RATE_SNAPSHOT_V1, MACHINE_PARK);
    expect(priced.subtotalCost).toBeCloseTo(cost.subtotalCost, 9);
    expect(i2.unitCost).toBeCloseTo(cost.items[1].unitCost, 9);
    expect(priced.marginPct).toBeCloseTo((1 - cost.subtotalCost / priced.subtotalPrice) * 100, 9);
    expect(priced.totalsByType.material!.cost).toBeCloseTo(cost.totalsByType.material!.cost, 9);
    expect(priced.totalsByType.order!.price).toBeCloseTo(38, 9);
    expect(priced.totalsByType.packaging!.price).toBe(9);
    expect(priced.totalsByType.setup!.price).toBeCloseTo(10 + 12 + 20, 9);
    expect(codes(priced.flags).includes("market.margin_below_default")).toBe(priced.marginPct < 0);
    expect(codes(priced.flags)).not.toContain("market.no_cost_version");
    expect(codes(priced.flags)).not.toContain("material.mass_handling");
  });
});

describe("market mode — lead time, refusals, packaging, missing cost version", () => {
  const market = marketSnapshot();

  it("the lead-time step becomes one line per part so lines still add up to the price; the box is not multiplied", () => {
    const priced = priceQuote(threeLines(6), market, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1 });
    expect(priced.leadTimeMultiplier).toBe(1.15);
    const base = priceQuote(threeLines(11), market, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1 });
    priced.items.forEach((item, index) => {
      const lead = byLabel(item.operations, "lead_time")!;
      expect(lead.type).toBe("leadtime");
      expect(lead.rateRef.values.tierDays).toBe(6);
      expect(item.unitPrice).toBeCloseTo(price(base.items[index]) * 1.15, 9);
      expect(lead.unitCost).toBeCloseTo(price(base.items[index]) * 0.15, 9);
    });
    expect(priced.quoteLines[0].unitCost).toBe(9);
    // 8 days sits on the 6-day step, not between 6 and 11
    expect(priceQuote(threeLines(8), market, MACHINE_PARK).leadTimeMultiplier).toBe(1.15);
    expect(priceQuote(threeLines(3), market, MACHINE_PARK).leadTimeMultiplier).toBe(1.4);
    expect(priceQuote(threeLines(null), market, MACHINE_PARK).leadTimeMultiplier).toBe(1);
  });

  it("a lead time shorter than the shortest tier is not offered: red quote flag, every price null, no packaging", () => {
    const priced = priceQuote(threeLines(2), market, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1 });
    const flag = priced.flags.find((f) => f.code === "market.leadtime_not_offered");
    expect(flag?.severity).toBe("red");
    expect(flag?.params).toMatchObject({ workingDays: 2, minDays: 3 });
    expect(priced.items.map((i) => i.unitPrice)).toEqual([null, null, null]);
    expect(priced.items.every((i) => i.operations.length === 0)).toBe(true);
    expect(priced.quoteLines).toEqual([]);
    expect(priced.subtotalPrice).toBe(0);
    expect(priced.leadTimeMultiplier).toBe(1);
  });

  it("deburring on a part below the minimum size: amber flag, no charge, the other line keeps its full set-up", () => {
    const small = rect("small", 200, 200, 1.5);
    const input = makeQuoteInput({
      parts: [p2, small],
      items: [makeItem({ id: "big", partId: "p2", extras: [deburr] }), makeItem({ id: "tiny", partId: "small", extras: [deburr] })],
      leadTimeDays: 11,
    });
    const priced = priceQuote(input, market, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1 });
    const tiny = priced.items[1];
    expect(tiny.unitPrice).not.toBeNull();
    expect(byLabel(tiny.operations, "deburr")).toBeUndefined();
    expect(byLabel(tiny.operations, "finish_setup")).toBeUndefined();
    const flag = tiny.flags.find((f) => f.code === "finish.part_too_small");
    expect(flag?.severity).toBe("amber");
    expect(flag?.params).toMatchObject({ widthMm: 200, heightMm: 200, minimum: "250×60 / 600×50" });
    expect(byLabel(priced.items[0].operations, "finish_setup")!.unitCost).toBeCloseTo(20, 12);
    // stainless minimum 50×50
    const inox = rect("inox", 50, 50, 1.5, "1.4301");
    const ok = priceQuote(makeQuoteInput({ parts: [inox], items: [makeItem({ id: "x", partId: "inox", extras: [deburr] })] }), market, MACHINE_PARK);
    expect(byLabel(ok.items[0].operations, "deburr")).toBeDefined();
  });

  it("no exact laser row or no band at exactly t → red market.no_benchmark_rate, unit price null, not in the splits", () => {
    const between = rect("between", 100, 100, 2); // 1.5 and 3 exist, 2 does not
    const priced = priceQuote(
      makeQuoteInput({ parts: [p1, between], items: [makeItem({ id: "ok", partId: "p1" }), makeItem({ id: "no", partId: "between", qty: 5 })], leadTimeDays: 11 }),
      market,
      MACHINE_PARK,
      { costRates: RATE_SNAPSHOT_V1 }
    );
    const refused = priced.items[1];
    expect(refused.unitPrice).toBeNull();
    expect(refused.batchPrice).toBeNull();
    expect(refused.operations).toEqual([]);
    expect(refused.unitCost).toBeGreaterThan(0); // the cost version still prices it
    const flag = refused.flags.find((f) => f.code === "market.no_benchmark_rate");
    expect(flag?.severity).toBe("red");
    expect(flag?.params).toMatchObject({ materialCode: "S235", thicknessMm: 2, what: "laser" });
    expect(codes(refused.flags)).not.toContain("laser.no_rate_row");
    expect(byLabel(priced.items[0].operations, "order_charge")!.unitCost).toBeCloseTo(38, 12);
    expect(priced.subtotalPrice).toBeCloseTo(price(priced.items[0]) + 9, 9);

    // a laser row without a material band at that thickness is refused on the material
    const noBand = marketSnapshot();
    for (const m of noBand.materials) m.pricePerKg = m.pricePerKg.filter((b) => b.maxThicknessMm !== 3);
    const p = priceQuote(makeQuoteInput({ parts: [p3], items: [makeItem({ id: "x", partId: "p3" })] }), noBand, MACHINE_PARK);
    expect(p.items[0].unitPrice).toBeNull();
    expect(p.items[0].flags.find((f) => f.code === "market.no_benchmark_rate")?.params).toMatchObject({ what: "material" });
  });

  it("bends, threads and features the version has no rows for are refused with market.not_benchmarked", () => {
    const bent = makePricingPart({
      id: "bent",
      name: "bent",
      geometry: makeRectPartGeometry({ lengthMm: 100, widthMm: 100, thicknessMm: 1.5, densityKgM3: 7850, bendLines: [{ x1: 50, y1: 0, x2: 50, y2: 100, direction: "up" }] }),
      materialCode: "S235",
      thicknessMm: 1.5,
    });
    const priced = priceQuote(makeQuoteInput({ parts: [bent], items: [makeItem({ id: "b", partId: "bent" })] }), market, MACHINE_PARK);
    expect(priced.items[0].unitPrice).toBeNull();
    expect(priced.items[0].flags.find((f) => f.code === "market.not_benchmarked")?.params).toMatchObject({ operation: "bending", count: 1 });
    expect(codes(priced.items[0].flags)).not.toContain("bend.no_rate_row");
    const feature = priceQuote(makeQuoteInput({ parts: [p1], items: [makeItem({ id: "f", partId: "p1", extras: [{ type: "feature", code: "countersink", count: 2 }] })] }), market, MACHINE_PARK);
    expect(feature.items[0].flags.find((f) => f.code === "market.not_benchmarked")?.params).toMatchObject({ operation: "feature countersink" });
  });

  it("packaging is a pallet when a part exceeds 600 mm or the mass exceeds 5 kg", () => {
    const long = rect("long", 700, 100, 1.5);
    const pallet = priceQuote(makeQuoteInput({ parts: [long], items: [makeItem({ id: "l", partId: "long" })] }), market, MACHINE_PARK);
    expect(pallet.quoteLines[0]).toMatchObject({ label: "packaging_pallet", unitCost: 45 });
    const heavy = priceQuote(makeQuoteInput({ parts: [p2], items: [makeItem({ id: "h", partId: "p2", qty: 3 })] }), market, MACHINE_PARK);
    expect(heavy.quoteLines[0].label).toBe("packaging_pallet");
    expect(heavy.quoteLines[0].details.totalMassKg).toBeCloseTo(1.884 * 3, 9);
    const light = priceQuote(makeQuoteInput({ parts: [p2], items: [makeItem({ id: "h", partId: "p2", qty: 2 })] }), market, MACHINE_PARK);
    expect(light.quoteLines[0].label).toBe("packaging_box");
  });

  it("without a cost version the cost is 0, the margin 0 and an amber flag says so", () => {
    const priced = priceQuote(threeLines(), market, MACHINE_PARK);
    expect(priced.subtotalCost).toBe(0);
    expect(priced.marginPct).toBe(0);
    expect(priced.costRateVersionId).toBeNull();
    const flag = priced.flags.find((f) => f.code === "market.no_cost_version");
    expect(flag?.severity).toBe("amber");
    expect(codes(priced.flags)).not.toContain("market.margin_below_default");
  });

  it("cost mode is untouched: the same input on the placeholder version prices exactly as before", () => {
    const input = threeLines();
    const viaSwitch = priceQuote(input, RATE_SNAPSHOT_V1, MACHINE_PARK, { costRates: market });
    const direct = priceCostQuote(input, RATE_SNAPSHOT_V1, MACHINE_PARK);
    expect(viaSwitch).toEqual(direct);
    expect(viaSwitch.pricingMode).toBe("cost");
    expect(viaSwitch.quoteLines).toEqual([]);
    expect(viaSwitch.costRateVersionId).toBeNull();
    expect(viaSwitch.items[0].unitPrice).toBeCloseTo(viaSwitch.items[0].unitCost / (1 - input.marginPct / 100), 9);
  });
});
