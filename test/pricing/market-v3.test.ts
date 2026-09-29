/**
 * Acceptance tests for the phase-2 market rates (v3, "market-247+10% v3 (28
 * Sep 2026)") on the market pricing engine (lib/pricing/market.ts): the
 * owner's cases F1–F3 (threads by thickness), B1–B5 (bending), C1–C2
 * (features), P1–P3 (powder coating), Z1–Z2 (zinc, hot-dip), K1
 * (certificates), D1–D2 (edge finishing) and V2 (the v2 numbers are
 * unchanged), ±1 %, plus one check per rule 14–24 of the v3 prompt, and
 * B6–B7 for the same-thickness steel fallback of the bending rate and W1–W3
 * for welding priced cost-plus from the cost version (v3 has no weld rows).
 * Rates come only from test/fixtures/rates/market-247-v3.json, the DB rows
 * of migration 20260928090000_rates_v3_market.sql (flat laser = v2 copied).
 * File path: /test/pricing/market-v3.test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getContent } from "@/content";
import { flagMessage } from "@/lib/parts/flag-message";
import { priceQuote } from "@/lib/pricing/price-quote";
import { rowsToMachinePark, rowsToRateSnapshot, type RateRows } from "@/lib/pricing/snapshot";
import { priceFromCost, type Flag, type FlagCode, type OperationLine, type PricedQuote, type PricingItem, type PricingPart, type QuoteInput } from "@/lib/pricing/types";
import type { WeldAnnotation } from "@/lib/geometry/types";
import { makeAnnotations, makeRectPartGeometry, type RectBendLine, type RectHole } from "@/test/helpers/geometry";
import { makeItem, makePricingPart, makeQuoteInput } from "@/test/helpers/quote";
import { RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";

type RatesJson = RateRows & { machines: Parameters<typeof rowsToMachinePark>[0] };

function load(file: string): RatesJson {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/rates", file), "utf8")) as RatesJson;
}
const v3Json = load("market-247-v3.json");
const v2Json = load("market-247-v2.json");
const { machines: machineRows, ...v3Rows } = v3Json;
const V3 = rowsToRateSnapshot(v3Rows);
const V2 = rowsToRateSnapshot(Object.fromEntries(Object.entries(v2Json).filter(([key]) => key !== "machines")) as RateRows);
const MACHINES = rowsToMachinePark(machineRows);
const COST = RATE_SNAPSHOT_V1;

const DENSITY: Record<string, number> = { DC01: 7850, DX51D: 7850, S235: 7850, S355: 7850, "1.4301": 7900, AlMg3: 2660 };

type RectOptions = {
  id: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  materialCode: string;
  holes?: RectHole[];
  /** Bend lines across the width, one per entry, of the given length (≤ widthMm). */
  bendLengthsMm?: number[];
  threads?: Record<string, string>;
  forming?: "flat" | "bent" | null;
};

function rect(o: RectOptions): PricingPart {
  const bends = o.bendLengthsMm ?? [];
  const bendLines: RectBendLine[] = bends.map((len, i) => {
    const x = (o.lengthMm * (i + 1)) / (bends.length + 1);
    return { x1: x, y1: 0, x2: x, y2: len, direction: "up" as const };
  });
  const geometry = makeRectPartGeometry({
    lengthMm: o.lengthMm,
    widthMm: o.widthMm,
    thicknessMm: o.thicknessMm,
    densityKgM3: DENSITY[o.materialCode] ?? 7850,
    holes: o.holes ?? [],
    bendLines,
    blankMarginMm: 0,
  });
  return makePricingPart({
    id: o.id,
    name: o.id,
    geometry,
    materialCode: o.materialCode,
    thicknessMm: o.thicknessMm,
    annotations: makeAnnotations({ threads: o.threads ?? {}, forming: o.forming ?? null }),
  });
}

function grid(n: number, diameterMm: number, sizeMm: number): RectHole[] {
  const side = Math.ceil(Math.sqrt(n));
  const step = sizeMm / (side + 1);
  const holes: RectHole[] = [];
  for (let i = 0; i < n; i += 1) holes.push({ x: step * (1 + (i % side)), y: step * (1 + Math.floor(i / side)), diameterMm });
  return holes;
}
const threads = (n: number, size: string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`loop-hole-${i + 1}`, size]));

type Extra = PricingItem["extras"][number];
const finish = (code: string, colour: string | null = null): Extra => ({ type: "finish", code, maskingMinutes: 0, note: null, colour });
const feature = (code: string, count: number): Extra => ({ type: "feature", code, count });

function quote(parts: PricingPart[], items: PricingItem[], leadTimeDays: number | null = 11, extra: Partial<QuoteInput> = {}): PricedQuote {
  return priceQuote(makeQuoteInput({ parts, items, leadTimeDays, marginPct: 0, ...extra }), V3, MACHINES, { costRates: COST });
}

const byLabel = (ops: readonly OperationLine[], label: string) => ops.find((o) => o.label === label);
const codes = (flags: readonly Flag[]): FlagCode[] => flags.map((f) => f.code);
const reds = (flags: readonly Flag[]) => flags.filter((f) => f.severity === "red");
const unit = (priced: PricedQuote, index = 0) => priced.items[index].unitPrice ?? Number.NaN;
/** ±1 % as the owner's acceptance tolerance. */
const within1pct = (actual: number | null, expected: number) => {
  expect(actual, `expected ${expected}`).not.toBeNull();
  expect(Math.abs((actual ?? Number.NaN) - expected) / expected, `expected ${expected}, got ${actual}`).toBeLessThanOrEqual(0.01);
};
/** Add-on of an option: the same part priced with and without it (same qty, same lead time). */
function addOn(part: PricingPart, plain: PricingPart, item: Partial<PricingItem>, leadTimeDays = 11): { addOn: number; priced: PricedQuote; base: PricedQuote } {
  const priced = quote([part], [makeItem({ id: "x", partId: part.id, ...item })], leadTimeDays);
  const base = quote([plain], [makeItem({ id: "x", partId: plain.id, ...item, extras: [] })], leadTimeDays);
  return { addOn: unit(priced) - unit(base), priced, base };
}

const S235_3_H16 = (t: Record<string, string> = {}) => rect({ id: "h16", lengthMm: 200, widthMm: 200, thicknessMm: 3, materialCode: "S235", holes: grid(16, 8.5, 200), threads: t });
const P400_DC01 = rect({ id: "p400", lengthMm: 400, widthMm: 400, thicknessMm: 1.5, materialCode: "DC01" });
const P100_DC01 = rect({ id: "p100", lengthMm: 100, widthMm: 100, thicknessMm: 1.5, materialCode: "DC01" });

describe("v3 fixture is the migration: v2 flat laser copied 1:1 plus the phase-2 tables", () => {
  it("has the v3 version, the v2 general row and identical laser / material / lead-time rows", () => {
    expect(V3.versionId).toBe("3b8d1a38-0000-4000-8000-000000000003");
    expect(V3.general).toEqual(V2.general);
    expect(V3.laser).toEqual(V2.laser);
    expect(V3.materials).toEqual(V2.materials);
    expect(V3.leadtime).toEqual(V2.leadtime);
    expect(V3.bend).toHaveLength(4);
    expect(V3.bend.every((b) => b.lengthClassMm === 4400)).toBe(true);
    expect(V3.thread.map((t) => t.size)).toEqual(["M10", "M12", "M16", "M20", "M4", "M5", "M6", "M8"]);
    expect(V3.feature.map((f) => f.code)).toEqual(["csk_m6", "csk_m8", "insert_m6"]);
    expect(V3.finish.map((f) => f.code)).toEqual(["cert31", "deburr", "deburr_nonferrous", "deburr_one_side", "edge_round", "engrave", "hot_dip", "powder", "zinc"]);
    expect(V3.tubeLaser).toEqual([]);
    expect(V3.roll).toEqual([]);
    expect(V3.weld).toEqual([]);
    const powder = V3.finish.find((f) => f.code === "powder")!;
    expect(powder).toMatchObject({ unit: "m2", price: 42.49, minimum: 186.53, setupPerLineEur: 1.91, pricePerPartEur: 6.98, minLeadTimeDays: 19, minimumScope: "colour", materialCodes: ["DC01", "S235"], minThicknessMm: 1.5, maxThicknessMm: 3 });
    expect(V3.finish.find((f) => f.code === "hot_dip")!.limits).toEqual({ maxOrderNetKg: 10 });
    expect(V3.finish.find((f) => f.code === "cert31")!.tierMultiplierApplies).toBe(false);
    expect(V3.thread.find((t) => t.size === "M8")!.priceByThickness).toEqual([
      { thicknessMm: 3, priceEach: 0.9688 },
      { thicknessMm: 6, priceEach: 2.0543 },
    ]);
    expect(V3.bend[0]).toMatchObject({ thicknessMm: 1.5, lengthClassMm: 4400, pricePerBend: 1.4152, setupPerPartType: 2.7747, setupPerBendLineEur: 0.8136, familyMultipliers: { stainless: 2.233 }, materialCodes: ["DC01", "1.4301"], pricePerBendPerM: 14.8646, benchmarkedMaxLengthMm: 200 });
    expect(V3.bend[1]).toMatchObject({ thicknessMm: 2, benchmarkedMaxLengthMm: 1460, pricePerBendPerM: 14.8646 });
    expect(V3.bend[3]).toMatchObject({ thicknessMm: 6, pricePerBendPerM: 29.7292 });
  });
});

describe("V2 — the v2 numbers are unchanged on v3", () => {
  it("E1 €54.61 + box, E2 €58.85, E5 €115.12", () => {
    const e1 = quote([P100_DC01], [makeItem({ id: "i1", partId: "p100" })]);
    within1pct(unit(e1), 54.61);
    expect(e1.quoteLines).toEqual([expect.objectContaining({ label: "packaging_box", unitCost: 2.75 })]);
    within1pct(quote([P100_DC01], [makeItem({ id: "i1", partId: "p100", qty: 10 })]).items[0].batchPrice, 58.85);
    const inox = rect({ id: "inox", lengthMm: 400, widthMm: 400, thicknessMm: 3, materialCode: "1.4301" });
    const e5 = quote([P400_DC01, inox], [makeItem({ id: "a", partId: "p400", qty: 2 }), makeItem({ id: "b", partId: "inox" })]);
    within1pct((e5.items[0].batchPrice ?? 0) + (e5.items[1].batchPrice ?? 0), 115.12);
    expect(reds(e5.flags)).toEqual([]);
  });
});

describe("F — threads priced by sheet thickness (rule 15)", () => {
  it("F1: 16 × M10 on S235 3 mm → +€18.38 (2.88 + 16 × 0.97); 1 × M12 → +€3.85", () => {
    const r16 = addOn(S235_3_H16(threads(16, "M10")), S235_3_H16(), {});
    within1pct(r16.addOn, 18.38);
    expect(byLabel(r16.priced.items[0].operations, "thread_setup")!.unitCost).toBeCloseTo(2.8812, 9);
    expect(byLabel(r16.priced.items[0].operations, "M10")).toMatchObject({ driverQty: 16, unitCost: 16 * 0.9688, type: "thread" });
    within1pct(addOn(S235_3_H16(threads(1, "M12")), S235_3_H16(), {}).addOn, 3.85);
  });

  it("F2: 16 × M4 on DC01 1.5 → +€10.78; 16 × M20 on S235 6 → +€33.51; 16 × M8 on S235 6 → +€35.75", () => {
    const dc = (t: Record<string, string>) => rect({ id: "dc", lengthMm: 200, widthMm: 200, thicknessMm: 1.5, materialCode: "DC01", holes: grid(16, 3.3, 200), threads: t });
    within1pct(addOn(dc(threads(16, "M4")), dc({}), {}).addOn, 10.78);
    const s6 = (t: Record<string, string>) => rect({ id: "s6", lengthMm: 300, widthMm: 300, thicknessMm: 6, materialCode: "S235", holes: grid(16, 14, 300), threads: t });
    within1pct(addOn(s6(threads(16, "M20")), s6({}), {}).addOn, 33.51);
    within1pct(addOn(s6(threads(16, "M8")), s6({}), {}).addOn, 35.75);
    // the per-line set-up is spread over the pieces
    const four = quote([s6(threads(16, "M8"))], [makeItem({ id: "x", partId: "s6", qty: 4 })]);
    expect(byLabel(four.items[0].operations, "thread_setup")!.unitCost).toBeCloseTo(2.8812 / 4, 9);
  });

  it("F3: M6 on DC01 1.5, M10 on S235 4, M16 on S235 3, M8 on 1.4301 3 → red market.no_benchmark_rate, no number", () => {
    const cases = [
      rect({ id: "a", lengthMm: 200, widthMm: 200, thicknessMm: 1.5, materialCode: "DC01", holes: grid(4, 5, 200), threads: threads(4, "M6") }),
      rect({ id: "a", lengthMm: 200, widthMm: 200, thicknessMm: 4, materialCode: "S235", holes: grid(4, 8.5, 200), threads: threads(4, "M10") }),
      rect({ id: "a", lengthMm: 200, widthMm: 200, thicknessMm: 3, materialCode: "S235", holes: grid(4, 14, 200), threads: threads(4, "M16") }),
      rect({ id: "a", lengthMm: 200, widthMm: 200, thicknessMm: 3, materialCode: "1.4301", holes: grid(4, 6.8, 200), threads: threads(4, "M8") }),
    ];
    for (const part of cases) {
      const priced = quote([part], [makeItem({ id: "x", partId: "a" })]);
      expect(priced.items[0].unitPrice, part.materialCode ?? "").toBeNull();
      const flag = priced.items[0].flags.find((f) => f.code === "market.no_benchmark_rate");
      expect(flag?.severity, `${part.materialCode} ${part.thicknessMm}`).toBe("red");
      expect(String(flag?.params.what)).toMatch(/^thread M/);
    }
  });
});

describe("B — bending (rule 14)", () => {
  const L = (materialCode: string, t: number, bends: number[], id = "l") => rect({ id, lengthMm: 200, widthMm: Math.max(160, ...bends), thicknessMm: t, materialCode, bendLengthsMm: bends });
  const flat = (materialCode: string, t: number, widthMm: number, id = "l") => rect({ id, lengthMm: 200, widthMm, thicknessMm: t, materialCode });

  it("B1: L bracket DC01 1.5, one 160 mm bend → +€5.00 (2.77 + 0.81 + 1.42); qty 100 → €1.45 per piece", () => {
    const one = addOn(L("DC01", 1.5, [160]), flat("DC01", 1.5, 160), {});
    within1pct(one.addOn, 5.0);
    const ops = one.priced.items[0].operations;
    expect(byLabel(ops, "bend_setup")!.unitCost).toBeCloseTo(2.7747, 9);
    expect(byLabel(ops, "bend_line_setup")!.unitCost).toBeCloseTo(0.8136, 9);
    expect(byLabel(ops, "bend")).toMatchObject({ driverQty: 1, driverUnit: "bend", unitCost: 1.4152 });
    within1pct(addOn(L("DC01", 1.5, [160]), flat("DC01", 1.5, 160), { qty: 100 }).addOn, 1.45);
  });

  it("B2: U channel DC01 1.5 (2 × 160) → +€7.23; L bracket in 1.4301 1.5 → +€7.75 (× 2.233 on Sb and p)", () => {
    within1pct(addOn(L("DC01", 1.5, [160, 160]), flat("DC01", 1.5, 160), {}).addOn, 7.23);
    const inox = addOn(L("1.4301", 1.5, [160]), flat("1.4301", 1.5, 160), {});
    within1pct(inox.addOn, 7.75);
    expect(byLabel(inox.priced.items[0].operations, "bend")!.rateRef.values.familyFactor).toBe(2.233);
    expect(byLabel(inox.priced.items[0].operations, "bend_setup")!.unitCost).toBeCloseTo(2.7747, 9); // S is not multiplied
  });

  it("B3: L bracket S235 3 → +€5.58; AlMg3 3 → +€8.29; S235 6 → +€30.40", () => {
    within1pct(addOn(L("S235", 3, [160]), flat("S235", 3, 160), {}).addOn, 5.58);
    within1pct(addOn(L("AlMg3", 3, [160]), flat("AlMg3", 3, 160), {}).addOn, 8.29);
    within1pct(addOn(L("S235", 6, [160]), flat("S235", 6, 160), {}).addOn, 30.4);
  });

  it("B4: DC01 2 mm, one 1460 mm bend → +€24.55 (per-metre extension beyond 200 mm, within the benchmarked length, no flag); Z bracket 2 mm, 2 × 160 → +€8.87", () => {
    const long = addOn(rect({ id: "z", lengthMm: 300, widthMm: 1460, thicknessMm: 2, materialCode: "DC01", bendLengthsMm: [1460] }), rect({ id: "z", lengthMm: 300, widthMm: 1460, thicknessMm: 2, materialCode: "DC01" }), {});
    within1pct(long.addOn, 24.55);
    const bend = byLabel(long.priced.items[0].operations, "bend")!;
    expect(bend.unitCost).toBeCloseTo(1.9371 + 14.8646 * 1.26, 6);
    expect(bend.details).toMatchObject({ lengthClassMm: 4400, benchmarkedMaxLengthMm: 1460, extrapolatedBends: 0 });
    expect(codes(long.priced.flags)).not.toContain("market.extrapolated_rate");
    within1pct(addOn(L("DC01", 2, [160, 160]), flat("DC01", 2, 160), {}).addOn, 8.87);
  });

  it("B5: 3000 mm bends are priced by extrapolation with an amber flag; 4400 mm is the limit, 4500 mm is refused", () => {
    const one = (materialCode: string, t: number, lengthMm: number, qty = 1) =>
      addOn(rect({ id: "b", lengthMm: 300, widthMm: lengthMm, thicknessMm: t, materialCode, bendLengthsMm: [lengthMm] }), rect({ id: "b", lengthMm: 300, widthMm: lengthMm, thicknessMm: t, materialCode }), { qty });
    const cases: [string, number, number][] = [
      ["DC01", 2, 47.45],
      ["DC01", 1.5, 46.62],
      ["S235", 3, 47.2],
      ["S235", 6, 113.64],
      ["1.4301", 1.5, 100.69],
    ];
    for (const [materialCode, t, expected] of cases) {
      const r = one(materialCode, t, 3000);
      within1pct(r.addOn, expected);
      const flag = r.priced.items[0].flags.find((f) => f.code === "market.extrapolated_rate");
      expect(flag?.severity, `${materialCode} ${t}`).toBe("amber");
      expect(flag?.params).toMatchObject({ operation: "bending", count: 1, longestMm: 3000 });
      expect(r.priced.items[0].unitPrice).not.toBeNull();
    }
    const ten = one("S235", 3, 1000, 10);
    within1pct(ten.addOn, 13.75);
    expect(ten.priced.items[0].flags.some((f) => f.code === "market.extrapolated_rate")).toBe(true);
    const limit = one("DC01", 2, 4400);
    within1pct(limit.addOn, 68.26);
    expect(limit.priced.items[0].flags.some((f) => f.code === "market.extrapolated_rate")).toBe(true);
    const tooLong = quote([rect({ id: "b", lengthMm: 300, widthMm: 4500, thicknessMm: 2, materialCode: "DC01", bendLengthsMm: [4500] })], [makeItem({ id: "x", partId: "b" })]);
    expect(tooLong.items[0].unitPrice).toBeNull();
    const red = tooLong.items[0].flags.find((f) => f.code === "market.bend_too_long");
    expect(red?.severity).toBe("red");
    expect(red?.params).toMatchObject({ longestMm: 4500, limitMm: 4400 });
    expect(codes(tooLong.items[0].flags)).not.toContain("market.not_benchmarked");
  });

  it("B6: a bend at a thickness with no steel row either (S235 4 mm, AlMg3 1.0 mm) → red market.not_benchmarked: bending, no price, no nearest thickness", () => {
    const cases = [L("S235", 4, [160], "a"), L("AlMg3", 1, [160], "a"), L("AlMg3", 1, [160, 160, 160], "a")];
    for (const part of cases) {
      const priced = quote([part], [makeItem({ id: "x", partId: "a" })]);
      expect(priced.items[0].unitPrice, `${part.materialCode} ${part.thicknessMm}`).toBeNull();
      const flag = priced.items[0].flags.find((f) => f.code === "market.not_benchmarked" && f.params.operation === "bending");
      expect(flag?.severity, `${part.materialCode} ${part.thicknessMm}`).toBe("red");
      expect(flag?.params).toMatchObject({ count: part.geometry.measures.bendLines.length });
      expect(codes(priced.items[0].flags)).not.toContain("market.bend_rate_from_steel");
      expect(priced.items[0].operations.filter((o) => o.type === "bend")).toEqual([]);
    }
  });

  const STEEL_ROW = { 1.5: "6fcf5918-080a-4cc0-85b2-3c9a5cd31237", 2: "0a78eaed-4837-4552-bf7b-d50f4e882d19", 3: "e56f4607-373a-4c76-94a9-613a505add0e" } as const;

  it("B7: AlMg3 1.5 mm, 3 bends ≤ 200 mm, qty 1 → €17.38 from the 1.5 mm steel row × 2.184 (aluminium, from the 3 mm row), amber market.bend_rate_from_steel, no red", () => {
    const r = addOn(L("AlMg3", 1.5, [160, 160, 160]), flat("AlMg3", 1.5, 160), {});
    within1pct(r.addOn, 17.38);
    expect(r.addOn).toBeCloseTo(2.7747 + 3 * (0.8136 + 1.4152) * 2.184, 6);
    const item = r.priced.items[0];
    expect(item.unitPrice).not.toBeNull();
    const ops = item.operations;
    expect(byLabel(ops, "bend_setup")!.unitCost).toBeCloseTo(2.7747, 9); // setup_per_part_type is never multiplied
    expect(byLabel(ops, "bend_line_setup")!.unitCost).toBeCloseTo(3 * 0.8136 * 2.184, 9);
    const bend = byLabel(ops, "bend")!;
    expect(bend).toMatchObject({ driverQty: 3, driverUnit: "bend" });
    expect(bend.unitCost).toBeCloseTo(3 * 1.4152 * 2.184, 9);
    // the breakdown records which row priced it and how
    for (const label of ["bend_setup", "bend_line_setup", "bend"]) {
      expect(byLabel(ops, label)!.rateRef, label).toMatchObject({ table: "rate_bend", key: "1.5/4400", values: { rateBendId: STEEL_ROW[1.5], source: "steel_fallback", familyFactor: 2.184, thicknessMm: 1.5 } });
    }
    expect(bend.details).toMatchObject({ rateSource: "steel_fallback", rateBendId: STEEL_ROW[1.5], factor: 2.184, extrapolatedBends: 0 });
    const amber = item.flags.find((f) => f.code === "market.bend_rate_from_steel");
    expect(amber?.severity).toBe("amber");
    expect(amber?.params).toMatchObject({ thicknessMm: 1.5, factor: 2.184, family: "aluminium", materialCode: "AlMg3", count: 3 });
    expect(codes(item.flags)).not.toContain("market.not_benchmarked");
    expect(codes(item.flags)).not.toContain("market.extrapolated_rate");
    expect(reds(item.flags)).toEqual([]);
    expect(flagMessage(getContent("en").flags, amber!, "en")).toBe("Bending priced from the 1.5 mm steel rate × 2.184 (aluminium) — not benchmarked for AlMg3; check before sending.");
    expect(flagMessage(getContent("pl").flags, amber!, "pl")).toBe("Gięcie wycenione wg stawki dla stali 1,5 mm × 2,184 (aluminium) — brak benchmarku dla AlMg3; sprawdź przed wysłaniem.");
    // the quote-level flags carry it too (quote line, admin override view read the same list)
    expect(r.priced.flags.some((f) => f.code === "market.bend_rate_from_steel" && f.partId === item.partId)).toBe(true);
  });

  it("B7: the fallback keeps the rest of rule 14 — set-up spread over qty, per-metre extension + amber beyond the benchmarked length, the 4 400 mm limit, the lead-time multiplier", () => {
    const qty10 = addOn(L("AlMg3", 1.5, [160, 160, 160]), flat("AlMg3", 1.5, 160), { qty: 10 });
    expect(qty10.addOn).toBeCloseTo(2.7747 / 10 + (3 * 0.8136 * 2.184) / 10 + 3 * 1.4152 * 2.184, 6);
    const long = addOn(rect({ id: "b", lengthMm: 300, widthMm: 1000, thicknessMm: 1.5, materialCode: "AlMg3", bendLengthsMm: [1000] }), rect({ id: "b", lengthMm: 300, widthMm: 1000, thicknessMm: 1.5, materialCode: "AlMg3" }), {});
    expect(long.addOn).toBeCloseTo(2.7747 + 0.8136 * 2.184 + (1.4152 + 14.8646 * 0.8) * 2.184, 6);
    expect(codes(long.priced.items[0].flags)).toEqual(expect.arrayContaining(["market.bend_rate_from_steel", "market.extrapolated_rate"]));
    const tooLong = quote([rect({ id: "b", lengthMm: 300, widthMm: 4500, thicknessMm: 1.5, materialCode: "AlMg3", bendLengthsMm: [4500] })], [makeItem({ id: "x", partId: "b" })]);
    expect(tooLong.items[0].unitPrice).toBeNull();
    expect(tooLong.items[0].flags.find((f) => f.code === "market.bend_too_long")?.params).toMatchObject({ longestMm: 4500, limitMm: 4400 });
    expect(codes(tooLong.items[0].flags)).not.toContain("market.bend_rate_from_steel");
    const rush = addOn(L("AlMg3", 1.5, [160, 160, 160]), flat("AlMg3", 1.5, 160), {}, 4);
    expect(rush.addOn).toBeCloseTo((2.7747 + 3 * (0.8136 + 1.4152) * 2.184) * 1.75, 6);
  });

  it("B7: exact rows are untouched — DC01 1.5 (factor 1) and AlMg3 3 mm (own factor 2.184) carry source = exact and no fallback flag", () => {
    const dc = addOn(L("DC01", 1.5, [160]), flat("DC01", 1.5, 160), {});
    within1pct(dc.addOn, 5.0);
    expect(byLabel(dc.priced.items[0].operations, "bend")!.rateRef.values).toMatchObject({ rateBendId: STEEL_ROW[1.5], source: "exact", familyFactor: 1 });
    expect(codes(dc.priced.items[0].flags)).not.toContain("market.bend_rate_from_steel");
    const al3 = addOn(L("AlMg3", 3, [160]), flat("AlMg3", 3, 160), {});
    within1pct(al3.addOn, 8.29);
    expect(byLabel(al3.priced.items[0].operations, "bend")!.rateRef.values).toMatchObject({ rateBendId: STEEL_ROW[3], source: "exact", familyFactor: 2.184 });
    expect(codes(al3.priced.items[0].flags)).not.toContain("market.bend_rate_from_steel");
  });

  it("B7: DX51D 2 mm (steel, factor 1), 1.4404 3 mm (× 2.233 from the 1.5 mm row), CuZn37 2 mm (brass, no multiplier anywhere → 1), DC01 3 mm (factor 1) → priced from the steel row, amber", () => {
    const cases: [string, number, number, string][] = [
      ["DX51D", 2, 1, STEEL_ROW[2]],
      ["1.4404", 3, 2.233, STEEL_ROW[3]],
      ["CuZn37", 2, 1, STEEL_ROW[2]],
      ["DC01", 3, 1, STEEL_ROW[3]],
    ];
    for (const [materialCode, t, factor, rowId] of cases) {
      const r = addOn(L(materialCode, t, [160], "a"), flat(materialCode, t, 160, "a"), {});
      const item = r.priced.items[0];
      const row = V3.bend.find((b) => b.id === rowId)!;
      expect(item.unitPrice, `${materialCode} ${t}`).not.toBeNull();
      expect(r.addOn, `${materialCode} ${t}`).toBeCloseTo(row.setupPerPartType + (row.setupPerBendLineEur + row.pricePerBend) * factor, 6);
      expect(byLabel(item.operations, "bend")!.rateRef.values, `${materialCode} ${t}`).toMatchObject({ rateBendId: rowId, source: "steel_fallback", familyFactor: factor });
      const amber = item.flags.find((f) => f.code === "market.bend_rate_from_steel");
      expect(amber?.severity, `${materialCode} ${t}`).toBe("amber");
      expect(amber?.params, `${materialCode} ${t}`).toMatchObject({ thicknessMm: t, factor, materialCode, count: 1 });
      expect(reds(item.flags), `${materialCode} ${t}`).toEqual([]);
      expect(codes(item.flags)).not.toContain("market.not_benchmarked");
    }
  });

  it("B7: the production part 0737475.000-AA (AlMg3 1.5 mm, bends 33 / 51 / 35.5 mm, qty 20, 11 days) prices at ≈ €9.68 per piece for bending", () => {
    const part = rect({ id: "traegerblech", lengthMm: 250, widthMm: 120, thicknessMm: 1.5, materialCode: "AlMg3", bendLengthsMm: [33, 51, 35.5] });
    const plain = rect({ id: "traegerblech", lengthMm: 250, widthMm: 120, thicknessMm: 1.5, materialCode: "AlMg3" });
    const r = addOn(part, plain, { qty: 20 }, 11);
    const ops = r.priced.items[0].operations;
    expect(byLabel(ops, "bend_setup")!.unitCost).toBeCloseTo(2.7747 / 20, 9);
    expect(byLabel(ops, "bend_line_setup")!.unitCost).toBeCloseTo((3 * 0.8136 * 2.184) / 20, 9);
    expect(byLabel(ops, "bend")!.unitCost).toBeCloseTo(3 * 1.4152 * 2.184, 9);
    expect(r.addOn).toBeCloseTo(0.138735 + 0.26653536 + 9.27239, 4);
    within1pct(r.addOn, 9.68);
    const amber = r.priced.items[0].flags.find((f) => f.code === "market.bend_rate_from_steel");
    expect(amber?.params).toMatchObject({ thicknessMm: 1.5, factor: 2.184, family: "aluminium", materialCode: "AlMg3", count: 3 });
    expect(reds(r.priced.items[0].flags)).toEqual([]);
  });

  it("rule 14: a part marked bent with no bend line recognised is flagged, never priced flat; angle does not matter", () => {
    const bent = rect({ id: "a", lengthMm: 200, widthMm: 160, thicknessMm: 1.5, materialCode: "DC01", forming: "bent" });
    const priced = quote([bent], [makeItem({ id: "x", partId: "a" })]);
    expect(priced.items[0].unitPrice).toBeNull();
    expect(priced.items[0].flags.find((f) => f.code === "market.not_benchmarked")?.params).toMatchObject({ operation: "bending", count: 0 });
    const part = L("DC01", 1.5, [160]);
    const angled = makePricingPart({ ...part, annotations: makeAnnotations({ bends: part.geometry.measures.bendLines.map((b) => ({ id: b.id, entityId: b.entityId, start: b.start, end: b.end, lengthMm: b.lengthMm, angleDeg: 135, radiusMm: null, direction: "up" as const, dieVMm: null })) }) });
    expect(unit(quote([angled], [makeItem({ id: "x", partId: "l" })]))).toBeCloseTo(unit(quote([part], [makeItem({ id: "x", partId: "l" })])), 9);
    // bends of different lengths: each priced with its own length (160 mm flat, 1000 mm with 0.8 m extension)
    const mixed = addOn(rect({ id: "m", lengthMm: 400, widthMm: 1000, thicknessMm: 2, materialCode: "DC01", bendLengthsMm: [160, 1000] }), rect({ id: "m", lengthMm: 400, widthMm: 1000, thicknessMm: 2, materialCode: "DC01" }), {});
    expect(mixed.addOn).toBeCloseTo(2.7747 + 2 * 1.113 + 1.9371 + (1.9371 + 14.8646 * 0.8), 6);
    expect(mixed.priced.items[0].flags.some((f) => f.code === "market.extrapolated_rate")).toBe(false); // 1000 ≤ 1460 benchmarked
  });
});

describe("W — welding cost-plus (v3 has no rate_weld rows; the v1 cost version does)", () => {
  const seam = (id: string, lengthMm: number, extra: Partial<WeldAnnotation> = {}): WeldAnnotation => ({
    id,
    entityIds: [],
    points: null,
    lengthMm,
    process: "mig_mag",
    beadMm: 4,
    pattern: "full",
    stitch: null,
    sides: 1,
    effectiveLengthMm: lengthMm,
    ...extra,
  });
  const plain = rect({ id: "w", lengthMm: 200, widthMm: 160, thicknessMm: 2, materialCode: "DC01" });
  const welded = (welds: WeldAnnotation[]) => makePricingPart({ ...plain, annotations: makeAnnotations({ welds }) });
  const priceWith = (part: PricingPart, extra: Partial<QuoteInput> = {}, leadTimeDays = 11) => quote([part], [makeItem({ id: "x", partId: "w" })], leadTimeDays, extra);
  const weldOps = (ops: readonly OperationLine[]) => ({ weld: ops.find((o) => o.type === "weld")!, setup: ops.find((o) => o.type === "setup" && o.id.includes("weld-setup"))! });

  it("W1: one 300 mm MIG seam at 30 % margin → v1 cost 13.50 ÷ 0.7 = 19.29 + set-up 15 ÷ 0.7 = 21.43, amber market.cost_plus, no red, cost side unchanged", () => {
    const priced = priceWith(welded([seam("w1", 300)]), { marginPct: 30 });
    const base = priceWith(plain, { marginPct: 30 });
    const item = priced.items[0];
    expect(item.unitPrice).not.toBeNull();
    expect(unit(priced) - unit(base)).toBeCloseTo((300 * 0.045 + 15) / 0.7, 6);
    const { weld, setup } = weldOps(item.operations);
    expect(weld.unitCost).toBeCloseTo(13.5 / 0.7, 9);
    expect(weld).toMatchObject({ driverQty: 300, driverUnit: "mm" });
    expect(weld.rateRef).toMatchObject({ table: "rate_weld", key: "mig_mag/4", values: { source: "cost_plus", marginPct: 30, costEur: 13.5, costRateVersionId: COST.versionId, pricePerMm: 0.045 } });
    expect(weld.details).toMatchObject({ source: "cost_plus", costEur: 13.5, marginPct: 30, process: "mig_mag", effectiveLengthMm: 300 });
    expect(setup.unitCost).toBeCloseTo(15 / 0.7, 9);
    expect(setup.setupShare).toBeCloseTo(15 / 0.7, 9);
    expect(setup.rateRef.values).toMatchObject({ source: "cost_plus", costEur: 15 });
    const amber = item.flags.find((f) => f.code === "market.cost_plus");
    expect(amber?.severity).toBe("amber");
    expect(amber?.params).toMatchObject({ operation: "welding", marginPct: 30, count: 1 });
    expect(codes(item.flags)).not.toContain("market.not_benchmarked");
    expect(codes(item.flags)).not.toContain("weld.no_rate_row");
    expect(reds(item.flags)).toEqual([]);
    // the summary's welding row: cost from the cost version, price cost-plus
    expect(priced.totalsByType.weld?.cost).toBeCloseTo(13.5, 6);
    expect(priced.totalsByType.weld?.price).toBeCloseTo(13.5 / 0.7, 6);
    expect(priced.subtotalPrice - base.subtotalPrice).toBeCloseTo((13.5 + 15) / 0.7, 6);
  });

  it("W1b: margin 0 → price = cost; stitch 30/60 on 2 sides halves and doubles the length; the lead-time multiplier applies like any line", () => {
    const zero = priceWith(welded([seam("w1", 300)]), { marginPct: 0 });
    expect(weldOps(zero.items[0].operations).weld.unitCost).toBeCloseTo(13.5, 9);
    expect(zero.items[0].flags.find((f) => f.code === "market.cost_plus")?.params).toMatchObject({ marginPct: 0 });
    const stitch = priceWith(welded([seam("w1", 600, { pattern: "stitch", stitch: { beadLengthMm: 30, pitchMm: 60 }, sides: 2, effectiveLengthMm: 600 })]), { marginPct: 30 });
    expect(weldOps(stitch.items[0].operations).weld).toMatchObject({ driverQty: 600 });
    expect(weldOps(stitch.items[0].operations).weld.unitCost).toBeCloseTo((600 * 0.045) / 0.7, 9);
    const rush = priceWith(welded([seam("w1", 300)]), { marginPct: 30 }, 4);
    const rushBase = priceWith(plain, { marginPct: 30 }, 4);
    expect(unit(rush) - unit(rushBase)).toBeCloseTo(((13.5 + 15) / 0.7) * 1.75, 6);
  });

  it("W2: no cost version, or a seam process the cost version has no row for → still red market.not_benchmarked: welding, no price", () => {
    const part = welded([seam("w1", 300)]);
    const input = makeQuoteInput({ parts: [part], items: [makeItem({ id: "x", partId: "w" })], leadTimeDays: 11, marginPct: 30 });
    const noCost = priceQuote(input, V3, MACHINES, { costRates: null });
    expect(noCost.items[0].unitPrice).toBeNull();
    expect(noCost.items[0].flags.find((f) => f.code === "market.not_benchmarked")?.params).toMatchObject({ operation: "welding", count: 1 });
    expect(codes(noCost.items[0].flags)).not.toContain("market.cost_plus");
    const noMig = priceQuote(input, V3, MACHINES, { costRates: { ...COST, weld: COST.weld.filter((w) => w.process !== "mig_mag") } });
    expect(noMig.items[0].unitPrice).toBeNull();
    expect(codes(noMig.items[0].flags)).toContain("market.not_benchmarked");
    // a part without seams is untouched
    expect(codes(priceWith(plain, { marginPct: 30 }).items[0].flags)).not.toContain("market.cost_plus");
  });

  it("W3: the welding-only block (customer-supplied parts) is priced cost-plus the same way, with the amber flag at quote level", () => {
    const block: NonNullable<QuoteInput["weldingOnly"]> = {
      seams: [{ id: "s1", label: "", process: "mig_mag", beadMm: 4, lengthMm: 1000, pattern: "full", stitch: null, sides: 1, qty: 2 }],
      partsCount: 2,
    };
    const priced = quote([], [], 11, { type: "welding_only", marginPct: 30, weldingOnly: block });
    expect(priced.welding).not.toBeNull();
    const cost = priced.welding!.cost;
    expect(cost).toBeCloseTo(2 * 1000 * 0.045 + 15 + 2 * 5, 6); // seams + set-up + handling per part (v1 placeholders), above the 60 minimum
    expect(priced.welding!.price).toBeCloseTo(priceFromCost(cost, 30), 6);
    expect(priced.welding!.operations.reduce((sum, o) => sum + o.unitCost, 0)).toBeCloseTo(priced.welding!.price, 6);
    expect(priced.welding!.operations.every((o) => o.rateRef.values.source === "cost_plus")).toBe(true);
    expect(priced.subtotalPrice).toBeCloseTo(priced.welding!.price, 6);
    const amber = priced.flags.find((f) => f.code === "market.cost_plus");
    expect(amber?.severity).toBe("amber");
    expect(amber?.params).toMatchObject({ operation: "welding", marginPct: 30, count: 1 });
    expect(codes(priced.flags)).not.toContain("market.not_benchmarked");
    const noCost = priceQuote(makeQuoteInput({ type: "welding_only", marginPct: 30, weldingOnly: block }), V3, MACHINES, { costRates: null });
    expect(noCost.welding).toBeNull();
    expect(noCost.flags.find((f) => f.code === "market.not_benchmarked")?.params).toMatchObject({ operation: "welding" });
  });
});

describe("C — features (rule 16)", () => {
  it("C1: 16 countersinks M6 on S235 3 → +€41.80 (6.76 + 16 × 2.19); same on S235 5; on DC01 1.5 → red", () => {
    const s3 = S235_3_H16();
    const r = addOn(s3, s3, { extras: [feature("csk_m6", 16)] });
    within1pct(r.addOn, 41.8);
    expect(byLabel(r.priced.items[0].operations, "feature_setup")!.unitCost).toBeCloseTo(6.76, 9);
    expect(r.priced.items[0].operations.find((o) => o.type === "feature")).toMatchObject({ driverQty: 16, unitCost: 16 * 2.19 });
    const s5 = rect({ id: "s5", lengthMm: 200, widthMm: 200, thicknessMm: 5, materialCode: "S235", holes: grid(16, 6.4, 200) });
    within1pct(addOn(s5, s5, { extras: [feature("csk_m8", 16)] }).addOn, 41.8);
    const dc = rect({ id: "dc", lengthMm: 200, widthMm: 200, thicknessMm: 1.5, materialCode: "DC01", holes: grid(16, 6.4, 200) });
    const refused = quote([dc], [makeItem({ id: "x", partId: "dc", extras: [feature("csk_m6", 16)] })]);
    expect(refused.items[0].unitPrice).toBeNull();
    expect(refused.items[0].flags.find((f) => f.code === "market.no_benchmark_rate")?.params).toMatchObject({ what: "feature csk_m6", reason: "thickness" });
  });

  it("C2: 16 press-in nuts M6 on DC01 1.5 → +€43.28 (10.32 + 16 × 2.06); on S235 6 → red; an unknown feature code → red", () => {
    const dc = rect({ id: "dc", lengthMm: 200, widthMm: 200, thicknessMm: 1.5, materialCode: "DC01", holes: grid(16, 6.4, 200) });
    within1pct(addOn(dc, dc, { extras: [feature("insert_m6", 16)] }).addOn, 43.28);
    const s6 = rect({ id: "s6", lengthMm: 200, widthMm: 200, thicknessMm: 6, materialCode: "S235", holes: grid(16, 6.4, 200) });
    const refused = quote([s6], [makeItem({ id: "x", partId: "s6", extras: [feature("insert_m6", 16)] })]);
    expect(refused.items[0].unitPrice).toBeNull();
    expect(refused.items[0].flags.find((f) => f.code === "market.no_benchmark_rate")?.params).toMatchObject({ what: "feature insert_m6" });
    const unknown = quote([dc], [makeItem({ id: "x", partId: "dc", extras: [feature("bore_h7", 2)] })]);
    expect(unknown.items[0].flags.find((f) => f.code === "market.not_benchmarked")?.params).toMatchObject({ operation: "feature bore_h7" });
  });
});

describe("P — powder coating (rules 17, 19, 23)", () => {
  it("P1: RAL 9005 on one 400×400 DC01 1.5 line, qty 1, 19 WD → add-on €22.49, topped up to the colour minimum €186.53; at 11 WD → not offered", () => {
    const r = addOn(P400_DC01, P400_DC01, { extras: [finish("powder", "RAL 9005")] }, 19);
    within1pct(r.addOn, 22.49);
    const ops = r.priced.items[0].operations;
    expect(byLabel(ops, "finish_setup")!.unitCost).toBeCloseTo(1.91, 9);
    expect(byLabel(ops, "powder")).toMatchObject({ driverUnit: "m2", type: "finish_powder" });
    expect(byLabel(ops, "powder")!.driverQty).toBeCloseTo(0.32, 9); // both sides of 0.16 m²
    expect(byLabel(ops, "powder")!.unitCost).toBeCloseTo(6.98 + 0.32 * 42.49, 9);
    const minimum = r.priced.quoteLines.find((l) => l.label === "finish_minimum")!;
    expect(minimum.details).toMatchObject({ code: "powder", colour: "RAL 9005", minimum: 186.53 });
    within1pct(minimum.unitCost + r.addOn, 186.53);
    expect(r.priced.leadTimeMultiplier).toBe(1);
    const late = quote([P400_DC01], [makeItem({ id: "x", partId: "p400", extras: [finish("powder", "RAL 9005")] })], 11);
    const flag = late.flags.find((f) => f.code === "market.leadtime_not_offered");
    expect(flag?.severity).toBe("red");
    expect(flag?.params).toMatchObject({ workingDays: 11, minDays: 19, reason: "powder" });
    expect(late.items[0].unitPrice).toBeNull();
  });

  it("P2: RAL 9005 on 100×100 × 10 (€80.21) and RAL 7016 on 400×400 × 1 (€22.49) → each topped up to 186.53, coating total €373.06", () => {
    const priced = quote(
      [P100_DC01, P400_DC01],
      [makeItem({ id: "a", partId: "p100", qty: 10, extras: [finish("powder", "RAL 9005")] }), makeItem({ id: "b", partId: "p400", extras: [finish("powder", "RAL 7016")] })],
      19
    );
    const plain = quote([P100_DC01, P400_DC01], [makeItem({ id: "a", partId: "p100", qty: 10 }), makeItem({ id: "b", partId: "p400" })], 19);
    const lineA = (priced.items[0].batchPrice ?? 0) - (plain.items[0].batchPrice ?? 0);
    const lineB = (priced.items[1].batchPrice ?? 0) - (plain.items[1].batchPrice ?? 0);
    within1pct(lineA, 80.21);
    within1pct(lineB, 22.49);
    const minimums = priced.quoteLines.filter((l) => l.label === "finish_minimum");
    expect(minimums.map((l) => l.details.colour).sort()).toEqual(["RAL 7016", "RAL 9005"]);
    const coatingTotal = lineA + lineB + minimums.reduce((s, l) => s + l.unitCost, 0);
    within1pct(coatingTotal, 373.06);
    expect(priced.subtotalPrice).toBeCloseTo(plain.subtotalPrice + coatingTotal, 6);
  });

  it("P3: powder on AlMg3 3, S235 6 and 1.4301 1.5 → red market.not_benchmarked: finish powder", () => {
    const cases = [
      rect({ id: "a", lengthMm: 200, widthMm: 200, thicknessMm: 3, materialCode: "AlMg3" }),
      rect({ id: "a", lengthMm: 200, widthMm: 200, thicknessMm: 6, materialCode: "S235" }),
      rect({ id: "a", lengthMm: 200, widthMm: 200, thicknessMm: 1.5, materialCode: "1.4301" }),
    ];
    for (const part of cases) {
      const priced = quote([part], [makeItem({ id: "x", partId: "a", extras: [finish("powder", "RAL 9005")] })], 19);
      expect(priced.items[0].unitPrice, part.materialCode ?? "").toBeNull();
      expect(priced.items[0].flags.find((f) => f.code === "market.not_benchmarked")?.params, part.materialCode ?? "").toMatchObject({ operation: "finish powder" });
    }
  });

  it("rule 19: powder implies edge breaking — a deburr option on the same line is dropped with an info flag, not charged", () => {
    const both = quote([P400_DC01], [makeItem({ id: "x", partId: "p400", extras: [finish("powder", "RAL 9005"), finish("deburr")] })], 19);
    const only = quote([P400_DC01], [makeItem({ id: "x", partId: "p400", extras: [finish("powder", "RAL 9005")] })], 19);
    expect(unit(both)).toBeCloseTo(unit(only), 9);
    expect(byLabel(both.items[0].operations, "deburr")).toBeUndefined();
    const flag = both.items[0].flags.find((f) => f.code === "market.finish_implied");
    expect(flag?.severity).toBe("green");
    expect(flag?.params).toMatchObject({ code: "deburr", by: "powder" });
    expect(reds(both.flags)).toEqual([]);
  });
});

describe("Z — zinc and hot-dip (rules 20–21)", () => {
  const S235_3_400 = rect({ id: "s3", lengthMm: 400, widthMm: 400, thicknessMm: 3, materialCode: "S235" });

  it("Z1: electro zinc on 400×400 S235 3 (net 3.768 kg), qty 1, 19 WD → +€38.41 (0.81 + 3.768 × 9.98), no minimum", () => {
    const r = addOn(S235_3_400, S235_3_400, { extras: [finish("zinc")] }, 19);
    within1pct(r.addOn, 38.41);
    expect(byLabel(r.priced.items[0].operations, "zinc")).toMatchObject({ driverUnit: "kg", type: "finish_zinc" });
    expect(byLabel(r.priced.items[0].operations, "zinc")!.driverQty).toBeCloseTo(3.768, 6);
    expect(byLabel(r.priced.items[0].operations, "finish_setup")).toBeUndefined();
    expect(r.priced.quoteLines.filter((l) => l.label === "finish_minimum")).toEqual([]);
    // rule 20: zinc includes one-sided edge breaking → the deburr option is dropped
    const withDeburr = quote([S235_3_400], [makeItem({ id: "x", partId: "s3", extras: [finish("zinc"), finish("deburr_one_side")] })], 19);
    expect(unit(withDeburr)).toBeCloseTo(unit(r.priced), 9);
    expect(withDeburr.items[0].flags.find((f) => f.code === "market.finish_implied")?.params).toMatchObject({ code: "deburr_one_side", by: "zinc" });
  });

  it("Z2: hot-dip on one 200×200×3 S235 part (0.94 kg) → quote-level €330.78, lead time ≥ 22 WD; 12 kg net → red", () => {
    const small = rect({ id: "hd", lengthMm: 200, widthMm: 200, thicknessMm: 3, materialCode: "S235" });
    const priced = quote([small], [makeItem({ id: "x", partId: "hd", extras: [finish("hot_dip")] })], 22);
    const plain = quote([small], [makeItem({ id: "x", partId: "hd" })], 22);
    expect(unit(priced)).toBeCloseTo(unit(plain), 9); // price 0 per piece
    const minimum = priced.quoteLines.find((l) => l.label === "finish_minimum")!;
    expect(minimum).toMatchObject({ unitCost: 330.78 });
    expect(minimum.details).toMatchObject({ code: "hot_dip", scope: "order" });
    expect(reds(priced.flags)).toEqual([]);
    const late = quote([small], [makeItem({ id: "x", partId: "hd", extras: [finish("hot_dip")] })], 19);
    expect(late.flags.find((f) => f.code === "market.leadtime_not_offered")?.params).toMatchObject({ minDays: 22, reason: "hot_dip" });
    // 4 × 3.768 kg = 15 kg > 10 kg
    const heavy = quote([S235_3_400], [makeItem({ id: "x", partId: "s3", qty: 4, extras: [finish("hot_dip")] })], 22);
    const flag = heavy.flags.find((f) => f.code === "market.not_benchmarked");
    expect(flag?.severity).toBe("red");
    expect(flag?.params).toMatchObject({ operation: "hot_dip (> 10 kg)", limitKg: 10 });
    expect(heavy.quoteLines.find((l) => l.label === "finish_minimum")).toBeUndefined();
  });
});

describe("K — certificates (rule 22)", () => {
  it("K1: certificate 3.1 on two lines at 7 WD → +€33.00 exactly (not × 1.12)", () => {
    const inox = rect({ id: "inox", lengthMm: 400, widthMm: 400, thicknessMm: 3, materialCode: "1.4301" });
    const priced = quote([P400_DC01, inox], [makeItem({ id: "a", partId: "p400", qty: 3, extras: [finish("cert31")] }), makeItem({ id: "b", partId: "inox", extras: [finish("cert31")] })], 7);
    const plain = quote([P400_DC01, inox], [makeItem({ id: "a", partId: "p400", qty: 3 }), makeItem({ id: "b", partId: "inox" })], 7);
    expect(priced.leadTimeMultiplier).toBe(1.12);
    expect(priced.subtotalPrice - plain.subtotalPrice).toBeCloseTo(33.0, 6);
    const setup = byLabel(priced.items[0].operations, "finish_setup")!;
    expect(setup.unitCost).toBeCloseTo(16.5 / 3, 9);
    expect(setup.details.tierExempt).toBe(1);
    expect(byLabel(priced.items[0].operations, "lead_time")!.details.baseUnitPrice).toBeCloseTo(byLabel(plain.items[0].operations, "lead_time")!.details.baseUnitPrice as number, 9);
  });
});

describe("D — edge finishing by material family (rules 17–18)", () => {
  const INOX_400 = rect({ id: "i400", lengthMm: 400, widthMm: 400, thicknessMm: 3, materialCode: "1.4301" });
  const INOX_100 = rect({ id: "i100", lengthMm: 100, widthMm: 100, thicknessMm: 3, materialCode: "1.4301" });

  it("D1: edge breaking both sides on 400×400 1.4301 3 (1.6 m) → +€20.41 from the non-ferrous row; burr side only → +€10.43; 100×100 → +€9.34", () => {
    const both = addOn(INOX_400, INOX_400, { extras: [finish("deburr")] });
    within1pct(both.addOn, 20.41);
    expect(byLabel(both.priced.items[0].operations, "deburr_nonferrous")).toMatchObject({ driverUnit: "m" });
    expect(byLabel(both.priced.items[0].operations, "finish_setup")!.unitCost).toBeCloseTo(5.65, 9);
    within1pct(addOn(INOX_400, INOX_400, { extras: [finish("deburr_one_side")] }).addOn, 10.43);
    within1pct(addOn(INOX_100, INOX_100, { extras: [finish("deburr")] }).addOn, 9.34);
  });

  it("D2: both sides on 400×400 DC01 1.5 → +€38.41; 100×100 DC01 → not available, price unchanged, flag; edge rounding on S235 3 → refused; on S235 5 400×400 → +€92.20", () => {
    const steel = addOn(P400_DC01, P400_DC01, { extras: [finish("deburr")] });
    within1pct(steel.addOn, 38.41);
    expect(byLabel(steel.priced.items[0].operations, "finish_setup")!.unitCost).toBeCloseTo(36.35, 9);
    const small = addOn(P100_DC01, P100_DC01, { extras: [finish("deburr")] });
    expect(small.addOn).toBeCloseTo(0, 9);
    expect(small.priced.items[0].flags.find((f) => f.code === "finish.part_too_small")?.severity).toBe("amber");
    const s3 = rect({ id: "s3", lengthMm: 400, widthMm: 400, thicknessMm: 3, materialCode: "S235" });
    const rounded3 = quote([s3], [makeItem({ id: "x", partId: "s3", extras: [finish("edge_round")] })]);
    expect(rounded3.items[0].unitPrice).toBeNull();
    expect(rounded3.items[0].flags.find((f) => f.code === "market.not_benchmarked")?.params).toMatchObject({ operation: "finish edge_round", reason: "thickness" });
    const s5 = rect({ id: "s5", lengthMm: 400, widthMm: 400, thicknessMm: 5, materialCode: "S235" });
    within1pct(addOn(s5, s5, { extras: [finish("edge_round")] }).addOn, 92.2);
    // burr side only stays refused on steel (no steel row, no variant)
    const oneSide = quote([P400_DC01], [makeItem({ id: "x", partId: "p400", extras: [finish("deburr_one_side")] })]);
    expect(oneSide.items[0].unitPrice).toBeNull();
    expect(oneSide.items[0].flags.find((f) => f.code === "market.not_benchmarked")?.params).toMatchObject({ operation: "finish deburr_one_side", reason: "material" });
  });

  it("rule 17: units — m2 is net area × 2, kg is net mass, part is 1; engraving stays €0.60 per part", () => {
    const engraved = quote([P100_DC01], [makeItem({ id: "x", partId: "p100", extras: [finish("engrave")] })]);
    expect(byLabel(engraved.items[0].operations, "engrave")).toMatchObject({ unitCost: 0.6, driverUnit: "part" });
    const zinc = quote([P100_DC01], [makeItem({ id: "x", partId: "p100", extras: [finish("zinc")] })], 19);
    expect(byLabel(zinc.items[0].operations, "zinc")!.driverQty).toBeCloseTo(0.11775, 9);
    const powder = quote([P100_DC01], [makeItem({ id: "x", partId: "p100", extras: [finish("powder", "RAL 9005")] })], 19);
    expect(byLabel(powder.items[0].operations, "powder")!.driverQty).toBeCloseTo(0.02, 9);
  });

  it("rule 24: quantity only spreads the set-ups — a lone 100×100 inside a 112-piece group pays its share", () => {
    const priced = quote([P100_DC01, P400_DC01], [makeItem({ id: "a", partId: "p100" }), makeItem({ id: "b", partId: "p400", qty: 111 })]);
    const a = priced.items[0];
    expect(byLabel(a.operations, "laser_setup")!.unitCost).toBeCloseTo(36.253 / 112, 9);
    expect(byLabel(a.operations, "order_charge")!.unitCost).toBeCloseTo(17.886 / 112, 9);
    within1pct(unit(priced), 0.35244 + 0.0954 + 0.0228 + 36.253 / 112 + 17.886 / 112);
    expect(codes(priced.flags).filter((c) => c.startsWith("market."))).toEqual([]);
  });
});
