/**
 * Market pricing mode (lib/pricing/market.ts) with a synthetic selling-price
 * version derived from the placeholder fixture: material by net mass, laser
 * per metre, setup split per (material, thickness) line, order charge per
 * line, deburring with setup + minimum size, engraving per part, packaging,
 * lead-time multiplier, margin against the cost version, and the guarantee
 * that cost mode is untouched.
 * File path: /test/pricing/market.test.ts
 */

import { describe, expect, it } from "vitest";
import { priceCostQuote, priceQuote } from "@/lib/pricing/price-quote";
import type { Flag, FlagCode, OperationLine, PricingItem, PricingPart, RateSnapshot } from "@/lib/pricing/types";
import { makeRectPartGeometry } from "@/test/helpers/geometry";
import { makeItem, makePricingPart, makeQuoteInput } from "@/test/helpers/quote";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, cloneSnapshot } from "@/test/helpers/rates";

const KG_PER_MM3 = 7850e-9;

function rect(id: string, lengthMm: number, widthMm: number, thicknessMm: number, materialCode = "S235", holes: { x: number; y: number; diameterMm: number }[] = []): PricingPart {
  const geometry = makeRectPartGeometry({ lengthMm, widthMm, thicknessMm, densityKgM3: 7850, holes });
  return makePricingPart({ id, name: id, geometry, materialCode, thicknessMm });
}

function marketSnapshot(): RateSnapshot {
  const s = cloneSnapshot();
  s.versionId = "market-v1";
  s.label = "market test";
  s.general = { ...s.general, pricingMode: "market", orderChargeEur: 38, packagingBoxEur: 9, packagingPalletEur: 45, blankMarginMm: 0, defaultMarginPct: 30, placeholder: false };
  for (const m of s.materials) {
    m.pricePerKg = [{ maxThicknessMm: 999, pricePerKg: m.code === "1.4301" ? 4 : 1 }];
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
  s.finish = [
    { code: "deburr", name: "Deburring", unit: "m", price: 0.5, minimum: 0, placeholder: false, setupPerOrderEur: 20, minPartMm: "steel 250x60 or 600x50; aluminium/stainless 50x50" },
    { code: "engrave", name: "Engraving", unit: "part", price: 3, minimum: 0, placeholder: false, setupPerOrderEur: 0, minPartMm: null },
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
    marginPct: 30,
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

describe("market mode — per-line rules", () => {
  const market = marketSnapshot();
  const priced = priceQuote(threeLines(), market, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1 });
  const [i1, i2, i3] = priced.items;

  it("is reported as market mode with the cost version and the lead time", () => {
    expect(priced.pricingMode).toBe("market");
    expect(priced.costRateVersionId).toBe(RATE_SNAPSHOT_V1.versionId);
    expect(priced.rateVersionId).toBe("market-v1");
    expect(priced.leadTimeDays).toBe(11);
    expect(priced.leadTimeMultiplier).toBe(1);
  });

  it("material = net mass × €/kg (no blank, no scrap) and laser = cut length × €/m + pierces × €/pierce", () => {
    const material = byLabel(i1.operations, "material")!;
    expect(material.driverQty).toBeCloseTo(100 * 100 * 1.5 * KG_PER_MM3, 12);
    expect(material.unitCost).toBeCloseTo(0.11775, 9);
    expect(material.rateRef.values.scrapPct).toBe(0);
    const laser = byLabel(i1.operations, "laser_cut")!;
    expect(laser.unitCost).toBeCloseTo(0.4 * 2 + 1 * 0.1, 12);
    expect(laser.details.slowFactorApplied).toBe(false);
  });

  it("splits the laser setup once per (material, thickness) over the LINES of that group, per line not per piece", () => {
    // S235/1.5: lines i1 (qty 1) and i2 (qty 2) → 10 € / 2 lines = 5 € per line.
    expect(byLabel(i1.operations, "laser_setup")!.unitCost).toBeCloseTo(5, 12);
    expect(byLabel(i2.operations, "laser_setup")!.unitCost).toBeCloseTo(5 / 2, 12);
    expect(byLabel(i2.operations, "laser_setup")!.setupShare).toBeCloseTo(2.5, 12);
    // S235/3: only i3 → the full 12 €.
    expect(byLabel(i3.operations, "laser_setup")!.unitCost).toBeCloseTo(12, 12);
    expect(byLabel(i3.operations, "laser_setup")!.details.linesInGroup).toBe(1);
  });

  it("splits the order charge equally over all part lines", () => {
    expect(byLabel(i1.operations, "order_charge")!.unitCost).toBeCloseTo(38 / 3, 12);
    expect(byLabel(i2.operations, "order_charge")!.unitCost).toBeCloseTo(38 / 3 / 2, 12);
    expect(byLabel(i3.operations, "order_charge")!.type).toBe("order");
  });

  it("deburring = its own setup split over the deburred lines + €/m × total cut length", () => {
    expect(byLabel(i2.operations, "deburr_setup")!.unitCost).toBeCloseTo(20 / 1 / 2, 12);
    expect(byLabel(i2.operations, "deburr")!.unitCost).toBeCloseTo(1.6 * 0.5, 12);
    expect(byLabel(i2.operations, "deburr")!.type).toBe("finish_deburr");
    expect(byLabel(i1.operations, "deburr")).toBeUndefined();
  });

  it("engraving is priced per part when selected", () => {
    const line = byLabel(i3.operations, "engrave")!;
    expect(line.unitCost).toBe(3);
    expect(line.driverUnit).toBe("part");
    expect(byLabel(i1.operations, "engrave")).toBeUndefined();
  });

  it("unit price = Σ lines with no margin on top; a box packaging line at quote level", () => {
    expect(i1.unitPrice).toBeCloseTo(0.9 + 0.11775 + 5 + 38 / 3, 9);
    expect(i2.unitPrice).toBeCloseTo(3.3 + 1.884 + 2.5 + 38 / 6 + 10 + 0.8, 9);
    expect(i3.unitPrice).toBeCloseTo(1.4 + 0.2355 + 12 + 38 / 3 + 3, 9);
    expect(priced.quoteLines).toHaveLength(1);
    expect(priced.quoteLines[0]).toMatchObject({ type: "packaging", label: "packaging_box", unitCost: 9 });
    expect(priced.subtotalPrice).toBeCloseTo(i1.batchPrice + i2.batchPrice + i3.batchPrice + 9, 9);
    expect(priced.items.every((i) => Math.abs(sum(i.operations) - i.unitPrice) < 1e-9)).toBe(true);
  });

  it("cost and margin come from the cost version priced on the same input", () => {
    const cost = priceCostQuote(threeLines(), RATE_SNAPSHOT_V1, MACHINE_PARK);
    expect(priced.subtotalCost).toBeCloseTo(cost.subtotalCost, 9);
    expect(i2.unitCost).toBeCloseTo(cost.items[1].unitCost, 9);
    expect(priced.marginPct).toBeCloseTo((1 - cost.subtotalCost / priced.subtotalPrice) * 100, 9);
    expect(priced.totalsByType.material!.cost).toBeCloseTo(cost.totalsByType.material!.cost, 9);
    expect(priced.totalsByType.order!.price).toBeCloseTo(38, 9);
    expect(priced.totalsByType.packaging!.price).toBe(9);
    const setupPrice = priced.totalsByType.setup!.price;
    expect(setupPrice).toBeCloseTo(10 + 12 + 20, 9);
    const below = priced.marginPct < 30;
    expect(codes(priced.flags).includes("market.margin_below_default")).toBe(below);
    expect(codes(priced.flags)).not.toContain("market.no_cost_version");
  });
});

describe("market mode — lead time, refusals, packaging, missing cost version", () => {
  const market = marketSnapshot();

  it("interpolated lead-time multiplier becomes one line per part so lines still add up to the price", () => {
    const priced = priceQuote(threeLines(6), market, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1 });
    expect(priced.leadTimeMultiplier).toBeCloseTo(1.15, 12);
    const base = priceQuote(threeLines(11), market, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1 });
    priced.items.forEach((item, index) => {
      const lead = byLabel(item.operations, "lead_time")!;
      expect(lead.type).toBe("leadtime");
      expect(item.unitPrice).toBeCloseTo(base.items[index].unitPrice * 1.15, 9);
      expect(lead.unitCost).toBeCloseTo(base.items[index].unitPrice * 0.15, 9);
    });
    const fast = priceQuote(threeLines(1), market, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1 });
    expect(fast.leadTimeMultiplier).toBe(1.4);
    expect(priceQuote(threeLines(null), market, MACHINE_PARK).leadTimeMultiplier).toBe(1);
  });

  it("refuses deburring on a part below the minimum size (red flag, no lines, not counted in the setup split)", () => {
    const small = rect("small", 200, 200, 1.5);
    const input = makeQuoteInput({
      parts: [p2, small],
      items: [makeItem({ id: "big", partId: "p2", extras: [deburr] }), makeItem({ id: "tiny", partId: "small", extras: [deburr] })],
      leadTimeDays: 11,
    });
    const priced = priceQuote(input, market, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1 });
    const tiny = priced.items[1];
    expect(byLabel(tiny.operations, "deburr")).toBeUndefined();
    expect(byLabel(tiny.operations, "deburr_setup")).toBeUndefined();
    const flag = tiny.flags.find((f) => f.code === "finish.part_too_small");
    expect(flag?.severity).toBe("red");
    expect(flag?.params).toMatchObject({ widthMm: 200, heightMm: 200, minimum: "250×60 / 600×50" });
    expect(byLabel(priced.items[0].operations, "deburr_setup")!.unitCost).toBeCloseTo(20, 12);
    // stainless minimum 50×50
    const inox = rect("inox", 50, 50, 1.5, "1.4301");
    const ok = priceQuote(makeQuoteInput({ parts: [inox], items: [makeItem({ id: "x", partId: "inox", extras: [deburr] })] }), market, MACHINE_PARK);
    expect(byLabel(ok.items[0].operations, "deburr")).toBeDefined();
  });

  it("packaging is a pallet when a part exceeds 600 mm or the mass exceeds 25 kg", () => {
    const long = rect("long", 700, 100, 1.5);
    const pallet = priceQuote(makeQuoteInput({ parts: [long], items: [makeItem({ id: "l", partId: "long" })] }), market, MACHINE_PARK);
    expect(pallet.quoteLines[0]).toMatchObject({ label: "packaging_pallet", unitCost: 45 });
    const heavy = priceQuote(makeQuoteInput({ parts: [p2], items: [makeItem({ id: "h", partId: "p2", qty: 20 })] }), market, MACHINE_PARK);
    expect(heavy.quoteLines[0].label).toBe("packaging_pallet");
    expect(heavy.quoteLines[0].details.totalMassKg).toBeCloseTo(1.884 * 20, 9);
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
    expect(viaSwitch.items[0].unitPrice).toBeCloseTo(viaSwitch.items[0].unitCost / 0.7, 9);
  });
});
