/**
 * priceQuote with job rates — the seams between the loose-part model and
 * assembly mode: forming operations on LOOSE items, market quote-level
 * top-ups (finish minimums) staying price-only, and a member's inherited
 * thickness reaching the packaging mass.
 * File path: /test/pricing/job-quote.test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { priceQuote } from "@/lib/pricing/price-quote";
import { rowsToMachinePark, rowsToRateSnapshot, type RateRows } from "@/lib/pricing/snapshot";
import type { PricedQuote, PricingItem, PricingPart } from "@/lib/pricing/types";
import { makeAnnotations, makeRectPartGeometry } from "@/test/helpers/geometry";
import { makeAssembly, makeForming, makeItem, makePricingPart, makeQuoteInput } from "@/test/helpers/quote";
import { JOB_RATES, MACHINE_PARK, RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";

type RatesJson = RateRows & { machines: Parameters<typeof rowsToMachinePark>[0] };
const json = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/rates/market-247-v3.json"), "utf8")) as RatesJson;
const { machines: machineRows, ...rows } = json;
const V3 = rowsToRateSnapshot(rows);
const V3_MACHINES = rowsToMachinePark(machineRows);

function rect(id: string, lengthMm: number, widthMm: number, thicknessMm: number | null, materialCode = "S235"): PricingPart {
  const geometry = makeRectPartGeometry({ lengthMm, widthMm, thicknessMm: thicknessMm ?? 3, densityKgM3: 7850, holes: [], bendLines: [], blankMarginMm: 0, engraveLengthMm: 0 });
  return makePricingPart({ id, name: id, geometry, materialCode, thicknessMm, annotations: makeAnnotations() });
}

function costQuote(parts: PricingPart[], items: PricingItem[], extra: Record<string, unknown> = {}): PricedQuote {
  return priceQuote(makeQuoteInput({ parts, items, marginPct: 30, ...extra }), RATE_SNAPSHOT_V1, MACHINE_PARK, { jobRates: JOB_RATES });
}

describe("forming operations on loose items", () => {
  const p7 = rect("p7", 285.9, 247, 2);
  const plain = costQuote([p7], [makeItem({ id: "i", partId: "p7" })]);

  it("an unresolved infeasible roll makes the loose item unpriceable with red forming.not_feasible", () => {
    const priced = costQuote([p7], [makeItem({ id: "i", partId: "p7", forming: [makeForming({ id: "op", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: null })] })]);
    expect(priced.items[0].unitPrice).toBeNull();
    expect(priced.items[0].batchPrice).toBeNull();
    const flag = priced.flags.find((f) => f.code === "forming.not_feasible");
    expect(flag).toMatchObject({ severity: "red", itemId: "i", partId: "p7", overridable: false });
    expect(flag?.params).toMatchObject({ opId: "op", reason: "min_radius" });
  });

  it("step bending adds the press-brake hits as a cost-plus labour line (19 hits × 25 s at 25 €/h, ÷ 0.7)", () => {
    const priced = costQuote([p7], [makeItem({ id: "i", partId: "p7", forming: [makeForming({ id: "op", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: { kind: "step_bend", hits: 19 } })] })]);
    const labourEur = ((19 * JOB_RATES.assembly.stepBendSecondsPerHit) / 60) * (JOB_RATES.assembly.labourRateEurH / 60);
    expect(priced.items[0].unitCost - plain.items[0].unitCost).toBeCloseTo(labourEur, 9);
    expect(priced.items[0].unitPrice! - plain.items[0].unitPrice!).toBeCloseTo(labourEur / 0.7, 9);
    const line = priced.items[0].operations.find((l) => l.label === "step_bend");
    expect(line).toMatchObject({ type: "bend", driverQty: 19, unitCost: expect.closeTo(labourEur, 9) });
    expect(priced.flags.some((f) => f.code === "forming.step_bend" && f.itemId === "i")).toBe(true);
    expect(priced.subtotalPrice - plain.subtotalPrice).toBeCloseTo(labourEur / 0.7, 9);
    expect(priced.totalsByType.bend?.cost ?? 0).toBeCloseTo((plain.totalsByType.bend?.cost ?? 0) + labourEur, 9);
  });

  it("subcontracted forming is the supplier cost × (1 + subcontract margin), passed through", () => {
    const priced = costQuote([p7], [makeItem({ id: "i", partId: "p7", forming: [makeForming({ id: "op", resolution: { kind: "subcontract", supplier: "Walcownia X", costEur: 200, extraLeadDays: 3 } })] })]);
    const priced200 = 200 * (1 + JOB_RATES.subcontractMarginPct / 100);
    expect(priced.items[0].unitCost - plain.items[0].unitCost).toBeCloseTo(priced200, 9);
    expect(priced.items[0].unitPrice! - plain.items[0].unitPrice!).toBeCloseTo(priced200, 9);
    expect(priced.items[0].operations.find((l) => l.label === "subcontract_forming")?.details).toMatchObject({ supplier: "Walcownia X", extraLeadDays: 3 });
    expect(priced.flags.some((f) => f.code === "forming.subcontract")).toBe(true);
  });

  it("a confirmed none_needed operation prices like no operation at all", () => {
    const priced = costQuote([p7], [makeItem({ id: "i", partId: "p7", forming: [makeForming({ id: "op", resolution: { kind: "none_needed" } })] })]);
    expect(priced.items[0].unitPrice).toBeCloseTo(plain.items[0].unitPrice!, 9);
    expect(priced.flags.filter((f) => f.code.startsWith("forming."))).toEqual([]);
  });
});

describe("market quote-level top-ups with job rates", () => {
  it("a finish minimum stays a price top-up: never cost, never doubled in the totals", () => {
    const p400 = rect("p400", 400, 400, 1.5, "DC01");
    const input = makeQuoteInput({
      parts: [p400],
      items: [makeItem({ id: "a", partId: "p400", extras: [{ type: "finish", code: "powder", maskingMinutes: 0, note: null, colour: "RAL 9005" }] })],
      leadTimeDays: 19,
      marginPct: 0,
    });
    const plain = priceQuote(input, V3, V3_MACHINES, { costRates: RATE_SNAPSHOT_V1 });
    const withJob = priceQuote(input, V3, V3_MACHINES, { costRates: RATE_SNAPSHOT_V1, jobRates: JOB_RATES });
    const minimum = plain.quoteLines.find((l) => l.label === "finish_minimum");
    expect(minimum).toBeDefined();
    expect(withJob.quoteLines.find((l) => l.label === "finish_minimum")?.unitCost).toBeCloseTo(minimum!.unitCost, 9);

    const packaging = (q: PricedQuote) => q.quoteLines.filter((l) => l.type === "packaging").reduce((s, l) => s + l.unitCost, 0);
    // price: the legacy packaging line swapped for the table one, nothing else
    expect(withJob.subtotalPrice - packaging(withJob)).toBeCloseTo(plain.subtotalPrice - packaging(plain), 6);
    // cost: at most the packaging pass-through on top — the minimum is not cost
    expect(withJob.subtotalCost - packaging(withJob)).toBeLessThanOrEqual(plain.subtotalCost + 1e-6);
    expect(withJob.subtotalCost - packaging(withJob)).toBeGreaterThanOrEqual(plain.subtotalCost - packaging(plain) - 1e-6);
    expect(withJob.totalsByType.finish_powder).toEqual(plain.totalsByType.finish_powder);
    expect(Math.abs(withJob.marginPct - plain.marginPct)).toBeLessThan(5);
  });
});

describe("member mass for packaging", () => {
  it("a member without its own thickness weighs what the assembly thickness says", () => {
    const member = rect("m1", 375, 375, null);
    const assembly = makeAssembly({ id: "asm", qty: 1, materialCode: "S235", thicknessMm: 3, seams: [] });
    const priced = priceQuote(
      makeQuoteInput({ parts: [member], items: [makeItem({ id: "i1", partId: "m1", assemblyId: "asm", qtyPerAssembly: 1, qty: 1 })], assemblies: [assembly] }),
      RATE_SNAPSHOT_V1,
      MACHINE_PARK,
      { jobRates: JOB_RATES }
    );
    const packaging = priced.quoteLines.find((l) => l.type === "packaging");
    expect(packaging).toBeDefined();
    // 375 × 375 × 3 mm of steel ≈ 3.31 kg net
    expect(Number(packaging!.details.netKg)).toBeGreaterThan(3);
    expect(Number(packaging!.details.grossKg)).toBeGreaterThan(3);
  });
});
