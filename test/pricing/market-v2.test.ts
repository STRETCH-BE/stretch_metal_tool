/**
 * Acceptance tests for the 27 Sep 2026 market rates (v2, "market-247+10% v2")
 * on the market pricing engine (lib/pricing/market.ts): the owner's cases
 * E1–E8 with their expected euro figures (±1 %) and one test per rule of
 * the market model — net-area material, exact-match gate, per-piece set-up
 * and order charge, subcontract rows, lead-time steps, packaging, finish
 * set-ups and eligibility, M12 threads, refusals, manual lines.
 * The rates come only from test/fixtures/rates/market-247-v2.json, the
 * DB rows of the migration 20260927120000_rates_v2_market_247.sql.
 * File path: /test/pricing/market-v2.test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { priceQuote } from "@/lib/pricing/price-quote";
import { rowsToMachinePark, rowsToRateSnapshot, type RateRows } from "@/lib/pricing/snapshot";
import type { Flag, FlagCode, OperationLine, PricedQuote, PricingItem, PricingPart, QuoteInput } from "@/lib/pricing/types";
import { makeAnnotations, makeRectPartGeometry, type RectHole } from "@/test/helpers/geometry";
import { makeItem, makePricingPart, makeQuoteInput } from "@/test/helpers/quote";
import { RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";

type RatesJson = RateRows & { machines: Parameters<typeof rowsToMachinePark>[0] };

const json = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/rates/market-247-v2.json"), "utf8")) as RatesJson;
const { machines: machineRows, ...rows } = json;
const V2 = rowsToRateSnapshot(rows);
const MACHINES = rowsToMachinePark(machineRows);
const COST = RATE_SNAPSHOT_V1;

const DENSITY: Record<string, number> = { DC01: 7850, S235: 7850, S355: 7850, "1.4301": 7900, AlMg3: 2660 };

type RectOptions = {
  id: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  materialCode: string;
  holes?: RectHole[];
  bend?: boolean;
  threads?: Record<string, string>;
  engraveLengthMm?: number;
};

function rect(o: RectOptions): PricingPart {
  const geometry = makeRectPartGeometry({
    lengthMm: o.lengthMm,
    widthMm: o.widthMm,
    thicknessMm: o.thicknessMm,
    densityKgM3: DENSITY[o.materialCode] ?? 7850,
    holes: o.holes ?? [],
    bendLines: o.bend ? [{ x1: o.lengthMm / 2, y1: 0, x2: o.lengthMm / 2, y2: o.widthMm, direction: "up" }] : [],
    blankMarginMm: 0,
    engraveLengthMm: o.engraveLengthMm ?? 0,
  });
  return makePricingPart({
    id: o.id,
    name: o.id,
    geometry,
    materialCode: o.materialCode,
    thicknessMm: o.thicknessMm,
    annotations: makeAnnotations({ threads: o.threads ?? {} }),
  });
}

function grid(n: number, diameterMm: number, sizeMm: number): RectHole[] {
  const side = Math.ceil(Math.sqrt(n));
  const step = sizeMm / (side + 1);
  const holes: RectHole[] = [];
  for (let i = 0; i < n; i += 1) holes.push({ x: step * (1 + (i % side)), y: step * (1 + Math.floor(i / side)), diameterMm });
  return holes;
}

function quote(parts: PricingPart[], items: PricingItem[], leadTimeDays: number | null = 11, extra: Partial<QuoteInput> = {}): PricedQuote {
  return priceQuote(makeQuoteInput({ parts, items, leadTimeDays, marginPct: 0, ...extra }), V2, MACHINES, { costRates: COST });
}

const byLabel = (ops: readonly OperationLine[], label: string) => ops.find((o) => o.label === label);
const codes = (flags: readonly Flag[]): FlagCode[] => flags.map((f) => f.code);
const reds = (flags: readonly Flag[]) => flags.filter((f) => f.severity === "red");
/** ±1 % as the owner's acceptance tolerance. */
const within1pct = (actual: number | null, expected: number) => {
  expect(actual, `expected ${expected}`).not.toBeNull();
  expect(Math.abs((actual ?? Number.NaN) - expected) / expected, `expected ${expected}, got ${actual}`).toBeLessThanOrEqual(0.01);
};

const E1_PART = rect({ id: "e1", lengthMm: 100, widthMm: 100, thicknessMm: 1.5, materialCode: "DC01" });
const P400_DC01 = rect({ id: "p400", lengthMm: 400, widthMm: 400, thicknessMm: 1.5, materialCode: "DC01" });
const deburr: PricingItem["extras"][number] = { type: "finish", code: "deburr", maskingMinutes: 0, note: null };

describe("v2 fixture is the migration", () => {
  it("is the market version with the benchmark's general row and table sizes", () => {
    expect(V2.versionId).toBe("2a7c0927-0000-4000-8000-000000000002");
    expect(V2.general.pricingMode).toBe("market");
    expect(V2.general.defaultMarginPct).toBe(0);
    expect(V2.general.orderChargeEur).toBeCloseTo(17.886, 9);
    expect(V2.general.packagingBoxEur).toBeCloseTo(2.75, 9);
    expect(V2.general.packagingPalletEur).toBeCloseTo(36.78, 9);
    expect(V2.general.handlingSurchargeEur).toBe(0);
    expect(V2.materials).toHaveLength(10);
    expect(V2.laser).toHaveLength(53);
    expect(V2.laser.every((r) => r.mode === "per_m" && !r.placeholder)).toBe(true);
    expect(V2.finish.map((f) => f.code).sort()).toEqual(["deburr", "deburr_one_side", "edge_round", "engrave"]);
    expect(V2.thread).toEqual([{ size: "M12", priceEach: 0.76, setupPerLineEur: 2.59, placeholder: false }]);
    expect(V2.leadtime.map((l) => [l.workingDays, l.multiplier])).toEqual([
      [4, 1.75],
      [7, 1.12],
      [11, 1],
    ]);
    expect(V2.bend).toEqual([]);
    expect(V2.roll).toEqual([]);
    expect(V2.weld).toEqual([]);
    expect(V2.tubeLaser).toEqual([]);
    expect(V2.feature).toEqual([]);
  });
});

describe("E1 — 100×100 DC01 1.5, qty 1", () => {
  const priced = quote([E1_PART], [makeItem({ id: "i1", partId: "e1" })]);
  const item = priced.items[0];

  it("unit price €54.61 = material 0.35 + cut 0.10 + pierce 0.02 + set-up 36.25 + order 17.89", () => {
    within1pct(item.unitPrice, 54.61);
    const material = byLabel(item.operations, "material")!;
    expect(material.driverQty).toBeCloseTo(0.11775, 9); // net 1.000 dm² × 1.5 mm × 7850
    expect(material.unitCost).toBeCloseTo(0.11775 * 2.9931, 9);
    expect(material.rateRef.values.scrapPct).toBe(0);
    expect(material.rateRef.values.bandMaxThicknessMm).toBe(1.5);
    const laser = byLabel(item.operations, "laser_cut")!;
    expect(laser.unitCost).toBeCloseTo(0.4 * 0.2385 + 1 * 0.0228, 9);
    expect(byLabel(item.operations, "laser_setup")!.unitCost).toBeCloseTo(36.253, 9);
    expect(byLabel(item.operations, "order_charge")!.unitCost).toBeCloseTo(17.886, 9);
    expect(item.operations.reduce((s, o) => s + o.unitCost, 0)).toBeCloseTo(item.unitPrice ?? Number.NaN, 9);
  });

  it("adds one box (€2.75) at quote level and nothing else; no red flags", () => {
    expect(priced.quoteLines).toHaveLength(1);
    expect(priced.quoteLines[0]).toMatchObject({ label: "packaging_box", unitCost: 2.75 });
    expect(priced.subtotalPrice).toBeCloseTo((item.unitPrice ?? 0) + 2.75, 6);
    expect(reds(priced.flags)).toEqual([]);
    expect(priced.pricingMode).toBe("market");
    expect(priced.usesPlaceholderRates).toBe(false);
  });
});

describe("E2 / E3 — quantity and lead time", () => {
  it("E2: qty 10 → line €58.85 (set-up and order charge once, per piece split)", () => {
    const priced = quote([E1_PART], [makeItem({ id: "i1", partId: "e1", qty: 10 })]);
    const item = priced.items[0];
    within1pct(item.batchPrice, 58.85);
    expect(byLabel(item.operations, "laser_setup")!.unitCost).toBeCloseTo(36.253 / 10, 9);
    expect(byLabel(item.operations, "laser_setup")!.details.piecesInGroup).toBe(10);
    expect(byLabel(item.operations, "order_charge")!.unitCost).toBeCloseTo(17.886 / 10, 9);
  });

  it("E3: the qty-10 line at 7 working days → €65.91 (× 1.12 on the lines, not on the box)", () => {
    const priced = quote([E1_PART], [makeItem({ id: "i1", partId: "e1", qty: 10 })], 7);
    within1pct(priced.items[0].batchPrice, 65.91);
    expect(priced.leadTimeMultiplier).toBe(1.12);
    expect(byLabel(priced.items[0].operations, "lead_time")!.rateRef.values.tierDays).toBe(7);
    expect(priced.quoteLines[0].unitCost).toBe(2.75);
    // 8 and 10 days sit on the same 7-day step; 4–6 on the 1.75 step.
    expect(quote([E1_PART], [makeItem({ id: "i1", partId: "e1" })], 10).leadTimeMultiplier).toBe(1.12);
    expect(quote([E1_PART], [makeItem({ id: "i1", partId: "e1" })], 6).leadTimeMultiplier).toBe(1.75);
    expect(quote([E1_PART], [makeItem({ id: "i1", partId: "e1" })], 4).leadTimeMultiplier).toBe(1.75);
    expect(quote([E1_PART], [makeItem({ id: "i1", partId: "e1" })], 20).leadTimeMultiplier).toBe(1);
  });

  it("E3: 3 working days → red market.leadtime_not_offered, no prices", () => {
    const priced = quote([E1_PART], [makeItem({ id: "i1", partId: "e1", qty: 10 })], 3);
    const flag = priced.flags.find((f) => f.code === "market.leadtime_not_offered");
    expect(flag?.severity).toBe("red");
    expect(flag?.params).toMatchObject({ workingDays: 3, minDays: 4 });
    expect(priced.items[0].unitPrice).toBeNull();
    expect(priced.items[0].batchPrice).toBeNull();
    expect(priced.items[0].operations).toEqual([]);
    expect(priced.quoteLines).toEqual([]);
    expect(priced.subtotalPrice).toBe(0);
  });
});

describe("E4 — 200×200 with 16×Ø10, S235 15 mm (subcontract row)", () => {
  const part = rect({ id: "e4", lengthMm: 200, widthMm: 200, thicknessMm: 15, materialCode: "S235", holes: grid(16, 10, 200) });
  const priced = quote([part], [makeItem({ id: "i4", partId: "e4" })]);
  const item = priced.items[0];

  it("unit price €77.32 from net 3.8743 dm², 1.3027 m cut, 17 pierces at the O2 rates", () => {
    within1pct(item.unitPrice, 77.32);
    const material = byLabel(item.operations, "material")!;
    expect(material.details.netAreaMm2).toBeCloseTo(38743.4, 0);
    expect(material.unitCost).toBeCloseTo(38743.4 * 15 * 7850e-9 * 2.469, 2);
    // in_house = false → the line is labelled as subcontract cutting, priced from the same row
    const laser = byLabel(item.operations, "subcontract_cutting")!;
    expect(byLabel(item.operations, "laser_cut")).toBeUndefined();
    expect(laser.driverQty).toBeCloseTo(1.3027, 3);
    expect(laser.details.pierces).toBe(17);
    expect(laser.unitCost).toBeCloseTo(1.30265 * 3.3 + 17 * 1.4413, 2);
    expect(laser.details.slowFactorApplied).toBe(false);
  });

  it("is amber market.subcontract with the supplier text, not red", () => {
    const flag = item.flags.find((f) => f.code === "market.subcontract");
    expect(flag?.severity).toBe("amber");
    expect(flag?.params).toMatchObject({ materialCode: "S235", thicknessMm: 15 });
    expect(String(flag?.params.supplier)).toContain("247TailorSteel");
    expect(reds(priced.flags)).toEqual([]);
    expect(codes(item.flags)).not.toContain("laser.subcontract");
    expect(codes(item.flags)).not.toContain("laser.slow_contours");
  });
});

describe("E5 — two groups: 400×400 DC01 1.5 ×2 and 400×400 1.4301 3 mm ×1", () => {
  const inox = rect({ id: "inox", lengthMm: 400, widthMm: 400, thicknessMm: 3, materialCode: "1.4301" });
  const priced = quote([P400_DC01, inox], [makeItem({ id: "a", partId: "p400", qty: 2 }), makeItem({ id: "b", partId: "inox" })]);
  const [dc01, ss] = priced.items;

  it("DC01 unit €30.13 and stainless €54.85; parts total €115.12", () => {
    within1pct(dc01.unitPrice, 30.13);
    within1pct(ss.unitPrice, 54.85);
    within1pct((dc01.batchPrice ?? 0) + (ss.batchPrice ?? 0), 115.12);
  });

  it("set-up ÷ pieces of the (material, thickness) group, order charge ÷ all pieces", () => {
    expect(byLabel(dc01.operations, "laser_setup")!.unitCost).toBeCloseTo(36.253 / 2, 9);
    expect(byLabel(ss.operations, "laser_setup")!.unitCost).toBeCloseTo(20.9768 / 1, 9);
    expect(byLabel(dc01.operations, "order_charge")!.unitCost).toBeCloseTo(17.886 / 3, 9);
    expect(byLabel(ss.operations, "order_charge")!.unitCost).toBeCloseTo(17.886 / 3, 9);
    expect(byLabel(ss.operations, "material")!.driverQty).toBeCloseTo(160000 * 3 * 7900e-9, 9);
    // two 1.884 kg + one 3.792 kg = 7.56 kg > 5 kg → pallet
    expect(priced.quoteLines[0].label).toBe("packaging_pallet");
    expect(priced.quoteLines[0].unitCost).toBe(36.78);
  });
});

describe("E6 — deburring", () => {
  it("on the 100×100 steel part: too small → amber flag, no charge, price unchanged", () => {
    const plain = quote([E1_PART], [makeItem({ id: "i1", partId: "e1" })]);
    const priced = quote([E1_PART], [makeItem({ id: "i1", partId: "e1", extras: [deburr] })]);
    const item = priced.items[0];
    expect(item.unitPrice).toBeCloseTo(plain.items[0].unitPrice ?? Number.NaN, 9);
    expect(byLabel(item.operations, "deburr")).toBeUndefined();
    expect(byLabel(item.operations, "finish_setup")).toBeUndefined();
    const flag = item.flags.find((f) => f.code === "finish.part_too_small");
    expect(flag?.severity).toBe("amber");
    expect(flag?.params).toMatchObject({ code: "deburr", widthMm: 100, heightMm: 100, minimum: "250×60 / 600×50" });
    expect(reds(priced.flags)).toEqual([]);
  });

  it("on 400×400 DC01 1.5 qty 1: add-on €35.06 = 33 per line + 1.6 m × 1.29", () => {
    const plain = quote([P400_DC01], [makeItem({ id: "a", partId: "p400" })]);
    const priced = quote([P400_DC01], [makeItem({ id: "a", partId: "p400", extras: [deburr] })]);
    const addOn = (priced.items[0].unitPrice ?? 0) - (plain.items[0].unitPrice ?? 0);
    within1pct(addOn, 35.06);
    expect(byLabel(priced.items[0].operations, "finish_setup")!.unitCost).toBeCloseTo(33, 9);
    expect(byLabel(priced.items[0].operations, "deburr")!.unitCost).toBeCloseTo(1.6 * 1.29, 9);
    expect(byLabel(priced.items[0].operations, "deburr")!.type).toBe("finish_deburr");
    // qty 5: the per-line set-up is spread over the pieces
    const five = quote([P400_DC01], [makeItem({ id: "a", partId: "p400", qty: 5, extras: [deburr] })]);
    expect(byLabel(five.items[0].operations, "finish_setup")!.unitCost).toBeCloseTo(33 / 5, 9);
  });

  it("edge rounding 33 + 37 €/m; burr-side-only deburring is not offered on mild steel, but is on stainless", () => {
    const edge = quote([P400_DC01], [makeItem({ id: "a", partId: "p400", extras: [{ type: "finish", code: "edge_round", maskingMinutes: 0, note: null }] })]);
    expect(byLabel(edge.items[0].operations, "finish_setup")!.unitCost).toBeCloseTo(33, 9);
    expect(byLabel(edge.items[0].operations, "edge_round")!.unitCost).toBeCloseTo(1.6 * 37, 9);
    const oneSide: PricingItem["extras"][number] = { type: "finish", code: "deburr_one_side", maskingMinutes: 0, note: null };
    const steel = quote([P400_DC01], [makeItem({ id: "a", partId: "p400", extras: [oneSide] })]);
    expect(byLabel(steel.items[0].operations, "deburr_one_side")).toBeUndefined();
    expect(steel.items[0].flags.find((f) => f.code === "finish.not_for_family")?.severity).toBe("amber");
    const inox = rect({ id: "inox", lengthMm: 100, widthMm: 100, thicknessMm: 1.5, materialCode: "1.4301" });
    const ss = quote([inox], [makeItem({ id: "s", partId: "inox", extras: [oneSide] })]);
    expect(byLabel(ss.items[0].operations, "finish_setup")!.unitCost).toBeCloseTo(21, 9);
    expect(byLabel(ss.items[0].operations, "deburr_one_side")!.unitCost).toBeCloseTo(0.4 * 0.74, 9);
  });

  it("engraving is €0.60 per part, on selection or on engraved geometry", () => {
    const selected = quote([E1_PART], [makeItem({ id: "i1", partId: "e1", extras: [{ type: "finish", code: "engrave", maskingMinutes: 0, note: null }] })]);
    expect(byLabel(selected.items[0].operations, "engrave")).toMatchObject({ unitCost: 0.6, driverUnit: "part", auto: false });
    const engraved = rect({ id: "eng", lengthMm: 100, widthMm: 100, thicknessMm: 1.5, materialCode: "DC01", engraveLengthMm: 80 });
    const auto = quote([engraved], [makeItem({ id: "i1", partId: "eng" })]);
    expect(byLabel(auto.items[0].operations, "engrave")).toMatchObject({ unitCost: 0.6, auto: true });
  });

  it("a finish the version has no row for is refused", () => {
    const priced = quote([P400_DC01], [makeItem({ id: "a", partId: "p400", extras: [{ type: "finish", code: "powder", maskingMinutes: 0, note: null }] })]);
    expect(priced.items[0].unitPrice).toBeNull();
    const flag = priced.items[0].flags.find((f) => f.code === "market.not_benchmarked");
    expect(flag?.severity).toBe("red");
    expect(flag?.params).toMatchObject({ operation: "finish powder" });
  });
});

describe("E7 — threads", () => {
  const threads = (n: number, size: string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`loop-hole-${i + 1}`, size]));
  const base = quote([rect({ id: "h16", lengthMm: 200, widthMm: 200, thicknessMm: 3, materialCode: "S235", holes: grid(16, 10.2, 200) })], [makeItem({ id: "x", partId: "h16" })]);

  it("16×M12 → +€14.75 (2.59 per line + 16 × 0.76); 1×M12 → +€3.35", () => {
    const p16 = rect({ id: "h16", lengthMm: 200, widthMm: 200, thicknessMm: 3, materialCode: "S235", holes: grid(16, 10.2, 200), threads: threads(16, "M12") });
    const priced16 = quote([p16], [makeItem({ id: "x", partId: "h16" })]);
    within1pct((priced16.items[0].unitPrice ?? 0) - (base.items[0].unitPrice ?? 0), 14.75);
    expect(byLabel(priced16.items[0].operations, "thread_setup")!.unitCost).toBeCloseTo(2.59, 9);
    expect(byLabel(priced16.items[0].operations, "M12")).toMatchObject({ driverQty: 16, unitCost: 16 * 0.76, type: "thread" });

    const p1 = rect({ id: "h16", lengthMm: 200, widthMm: 200, thicknessMm: 3, materialCode: "S235", holes: grid(16, 10.2, 200), threads: threads(1, "M12") });
    const priced1 = quote([p1], [makeItem({ id: "x", partId: "h16" })]);
    within1pct((priced1.items[0].unitPrice ?? 0) - (base.items[0].unitPrice ?? 0), 3.35);
    // qty 4: the per-line set-up is spread over the pieces
    const four = quote([p1], [makeItem({ id: "x", partId: "h16", qty: 4 })]);
    expect(byLabel(four.items[0].operations, "thread_setup")!.unitCost).toBeCloseTo(2.59 / 4, 9);
  });

  it("M6 → red market.not_benchmarked (thread M6), unit price null", () => {
    const p = rect({ id: "h16", lengthMm: 200, widthMm: 200, thicknessMm: 3, materialCode: "S235", holes: grid(16, 5, 200), threads: threads(16, "M6") });
    const priced = quote([p], [makeItem({ id: "x", partId: "h16" })]);
    expect(priced.items[0].unitPrice).toBeNull();
    const flag = priced.items[0].flags.find((f) => f.code === "market.not_benchmarked");
    expect(flag?.severity).toBe("red");
    expect(flag?.params).toMatchObject({ operation: "thread M6", size: "M6", count: 16 });
    expect(codes(priced.items[0].flags)).not.toContain("thread.no_rate_row");
  });
});

describe("E8 — everything the version does not benchmark is refused (red, unit price null)", () => {
  const cases: { name: string; part: PricingPart; extras?: PricingItem["extras"]; flag: FlagCode; params: Record<string, string | number> }[] = [
    { name: "DC01 0.5 mm (no laser row)", part: rect({ id: "a", lengthMm: 100, widthMm: 100, thicknessMm: 0.5, materialCode: "DC01" }), flag: "market.no_benchmark_rate", params: { materialCode: "DC01", thicknessMm: 0.5, what: "laser" } },
    { name: "S235 7 mm (between 6 and 8, no nearest)", part: rect({ id: "a", lengthMm: 100, widthMm: 100, thicknessMm: 7, materialCode: "S235" }), flag: "market.no_benchmark_rate", params: { materialCode: "S235", thicknessMm: 7, what: "laser" } },
    { name: "Cu-ETP 2 mm (material not listed)", part: rect({ id: "a", lengthMm: 100, widthMm: 100, thicknessMm: 2, materialCode: "Cu-ETP" }), flag: "market.no_benchmark_rate", params: { materialCode: "Cu-ETP", what: "material" } },
    { name: "S355 12 mm (no row)", part: rect({ id: "a", lengthMm: 100, widthMm: 100, thicknessMm: 12, materialCode: "S355" }), flag: "market.no_benchmark_rate", params: { materialCode: "S355", thicknessMm: 12 } },
    { name: "AlMg3 6 mm with a bend line", part: rect({ id: "a", lengthMm: 100, widthMm: 100, thicknessMm: 6, materialCode: "AlMg3", bend: true }), flag: "market.not_benchmarked", params: { operation: "bending", count: 1 } },
    { name: "countersink feature", part: rect({ id: "a", lengthMm: 100, widthMm: 100, thicknessMm: 3, materialCode: "S235" }), extras: [{ type: "feature", code: "countersink", count: 4 }], flag: "market.not_benchmarked", params: { operation: "feature countersink" } },
    { name: "powder coating", part: rect({ id: "a", lengthMm: 300, widthMm: 300, thicknessMm: 3, materialCode: "S235" }), extras: [{ type: "finish", code: "powder", maskingMinutes: 0, note: null }], flag: "market.not_benchmarked", params: { operation: "finish powder" } },
  ];

  for (const c of cases) {
    it(`${c.name} → ${c.flag}`, () => {
      const priced = quote([c.part], [makeItem({ id: "x", partId: "a", extras: c.extras ?? [] })]);
      const item = priced.items[0];
      expect(item.unitPrice).toBeNull();
      expect(item.batchPrice).toBeNull();
      expect(item.operations).toEqual([]);
      const flag = item.flags.find((f) => f.code === c.flag);
      expect(flag?.severity, codes(item.flags).join(",")).toBe("red");
      expect(flag?.params).toMatchObject(c.params);
      expect(priced.subtotalPrice).toBe(0);
      expect(priced.quoteLines).toEqual([]);
    });
  }

  it("a tube part, a rolled part and a welding-only quote are refused too", () => {
    const tubeExtra: PricingItem["extras"][number] = { type: "tube_cut", profileFamily: "round", wallMm: 2, cutLengthMm: 200, metres: 1, pricePerMTube: null };
    const tube = quote([rect({ id: "t", lengthMm: 100, widthMm: 100, thicknessMm: 3, materialCode: "S235" })], [makeItem({ id: "x", partId: "t", extras: [tubeExtra] })]);
    expect(tube.items[0].unitPrice).toBeNull();
    expect(tube.items[0].flags.find((f) => f.code === "market.not_benchmarked")?.params).toMatchObject({ operation: "tube" });

    const rolledGeometry = makeRectPartGeometry({ lengthMm: 100, widthMm: 314, thicknessMm: 3, densityKgM3: 7850, blankMarginMm: 0 });
    const rolled = makePricingPart({
      id: "r",
      name: "rolled",
      geometry: rolledGeometry,
      materialCode: "S235",
      thicknessMm: 3,
      annotations: makeAnnotations({ forming: "rolled", roll: { radiusMm: 50, axis: "x", arcAngleDeg: 360, axisLengthMm: 100, developedWidthMm: 314, cone: null } }),
    });
    const roll = quote([rolled], [makeItem({ id: "x", partId: "r" })]);
    expect(roll.items[0].unitPrice).toBeNull();
    expect(roll.items[0].flags.find((f) => f.code === "market.not_benchmarked")?.params).toMatchObject({ operation: "rolling" });

    const seam = { id: "s1", label: "Seam", process: "mig_mag" as const, beadMm: 4, lengthMm: 1000, pattern: "full" as const, stitch: null, sides: 1 as const, qty: 1 };
    const welding = quote([], [], 11, { type: "welding_only", weldingOnly: { seams: [seam], partsCount: 1 } });
    expect(welding.flags.find((f) => f.code === "market.not_benchmarked")?.params).toMatchObject({ operation: "welding" });
    expect(welding.welding).toBeNull();
    expect(reds(welding.flags)).toHaveLength(1);
  });

  it("a refused line is not counted in the set-up or order-charge split of the others", () => {
    const bad = rect({ id: "bad", lengthMm: 100, widthMm: 100, thicknessMm: 7, materialCode: "S235" });
    const priced = quote([E1_PART, bad], [makeItem({ id: "ok", partId: "e1" }), makeItem({ id: "no", partId: "bad", qty: 9 })]);
    expect(byLabel(priced.items[0].operations, "order_charge")!.unitCost).toBeCloseTo(17.886, 9);
    expect(priced.items[1].unitPrice).toBeNull();
    expect(priced.quoteLines[0].label).toBe("packaging_box");
  });
});

describe("manual lines, cost view and packaging once per quote", () => {
  it("machining minutes and lump sums are priced as typed with an amber market.manual_price", () => {
    const priced = quote(
      [E1_PART],
      [
        makeItem({
          id: "i1",
          partId: "e1",
          extras: [
            { type: "machining", minutes: 30, note: null },
            { type: "other", label: "Assembly", unitCost: 12.5 },
          ],
        }),
      ]
    );
    const item = priced.items[0];
    expect(byLabel(item.operations, "machining")!.unitCost).toBeCloseTo(30 * (60 / 60), 9);
    expect(byLabel(item.operations, "Assembly")!.unitCost).toBe(12.5);
    const manual = item.flags.filter((f) => f.code === "market.manual_price");
    expect(manual).toHaveLength(2);
    expect(manual.every((f) => f.severity === "amber")).toBe(true);
    expect(reds(priced.flags)).toEqual([]);
  });

  it("cost and margin are reported from the cost version; no margin is added to the price", () => {
    const priced = quote([E1_PART], [makeItem({ id: "i1", partId: "e1" })]);
    expect(priced.costRateVersionId).toBe(COST.versionId);
    expect(priced.subtotalCost).toBeGreaterThan(0);
    expect(priced.marginPct).toBeCloseTo((1 - priced.subtotalCost / priced.subtotalPrice) * 100, 9);
    expect(codes(priced.flags)).not.toContain("market.margin_below_default");
    const noCost = priceQuote(makeQuoteInput({ parts: [E1_PART], items: [makeItem({ id: "i1", partId: "e1" })], leadTimeDays: 11 }), V2, MACHINES);
    expect(noCost.items[0].unitPrice).toBeCloseTo(priced.items[0].unitPrice ?? Number.NaN, 9);
    expect(noCost.flags.find((f) => f.code === "market.no_cost_version")?.severity).toBe("amber");
  });

  it("packaging: box up to 600 mm and 5 kg, else a pallet; once per quote and outside the lead-time multiplier", () => {
    const long = rect({ id: "long", lengthMm: 601, widthMm: 100, thicknessMm: 1.5, materialCode: "DC01" });
    expect(quote([long], [makeItem({ id: "l", partId: "long" })]).quoteLines[0]).toMatchObject({ label: "packaging_pallet", unitCost: 36.78 });
    const heavy = quote([P400_DC01], [makeItem({ id: "h", partId: "p400", qty: 3 })]); // 3 × 1.884 kg = 5.65 kg
    expect(heavy.quoteLines[0].label).toBe("packaging_pallet");
    const light = quote([P400_DC01], [makeItem({ id: "h", partId: "p400", qty: 2 })], 4); // 3.77 kg
    expect(light.quoteLines).toHaveLength(1);
    expect(light.quoteLines[0]).toMatchObject({ label: "packaging_box", unitCost: 2.75 });
    expect(light.subtotalPrice).toBeCloseTo((light.items[0].batchPrice ?? 0) + 2.75, 9);
  });
});
