/**
 * Price scale (lib/pricing/scale.ts): a 1.5 mm AlMg3 loose part on the
 * market v3 version at 20 / 50 / 100 / 200 / 500 / 1 000 pieces → strictly
 * decreasing unit prices (set-up and order charge spread over the pieces);
 * an assembly's scale spreads its job set-ups the same way; the scaled
 * inputs never recurse.
 * File path: /test/pricing/price-scale.test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { priceQuote } from "@/lib/pricing/price-quote";
import { priceScale, scaleQuantities, scaledInput } from "@/lib/pricing/scale";
import { rowsToMachinePark, rowsToRateSnapshot, type RateRows } from "@/lib/pricing/snapshot";
import type { PriceScale, PricingPart } from "@/lib/pricing/types";
import { makeRectPartGeometry } from "@/test/helpers/geometry";
import { makeAssembly, makeItem, makePricingPart, makeQuoteInput, makeSeam } from "@/test/helpers/quote";
import { JOB_RATES, MACHINE_PARK, RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";

type RatesJson = RateRows & { machines: Parameters<typeof rowsToMachinePark>[0] };
const json = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/rates/market-247-v3.json"), "utf8")) as RatesJson;
const { machines: _machineRows, ...rows } = json;
void _machineRows;
const V3 = rowsToRateSnapshot(rows);

const SCALE = [20, 50, 100, 200, 500, 1000];

function rect(id: string, lengthMm: number, widthMm: number, thicknessMm: number, materialCode: string, densityKgM3: number): PricingPart {
  return makePricingPart({ id, name: id, geometry: makeRectPartGeometry({ lengthMm, widthMm, thicknessMm, densityKgM3, blankMarginMm: 0 }), materialCode, thicknessMm });
}

function strictlyDecreasing(scale: PriceScale, expectedQtys: number[]): void {
  expect(scale.entries.map((e) => e.qty)).toEqual(expectedQtys);
  const prices = scale.entries.map((e) => e.unitPrice);
  for (const p of prices) expect(p).not.toBeNull();
  for (let i = 1; i < prices.length; i += 1) expect(prices[i]!).toBeLessThan(prices[i - 1]!);
  for (const e of scale.entries) expect(e.total).toBeCloseTo((e.unitPrice ?? 0) * e.qty, 9);
}

describe("price scale — loose part", () => {
  const alu = rect("alu", 200, 100, 1.5, "AlMg3", 2660);
  const input = makeQuoteInput({ marginPct: 0, leadTimeDays: 11, parts: [alu], items: [makeItem({ id: "i1", partId: "alu", qty: 1 })], priceScale: SCALE, customerType: "b2b", customerCountry: "PL" });

  it("1.5 mm AlMg3 200×100 at [20, 50, 100, 200, 500, 1000] → strictly decreasing unit prices, totals = unit × qty", () => {
    const priced = priceQuote(input, V3, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1, jobRates: JOB_RATES });
    expect(priced.priceScale).toHaveLength(1);
    expect(priced.priceScale[0]).toMatchObject({ subjectId: "i1", kind: "item" });
    strictlyDecreasing(priced.priceScale[0], SCALE);
    // the line itself is still priced at its own quantity (1)
    expect(priced.items[0].qty).toBe(1);
    expect(priced.items[0].unitPrice).toBeGreaterThan(priced.priceScale[0].entries[0].unitPrice ?? 0);
  });

  it("the scaled input carries priceScale [] and the quantity on every loose item; the quantities are unique, positive and ascending", () => {
    const scaled = scaledInput(input, 50);
    expect(scaled.priceScale).toEqual([]);
    expect(scaled.items[0].qty).toBe(50);
    expect(scaleQuantities([100, 20, 20, 0, -5, Number.NaN, 50])).toEqual([20, 50, 100]);
    expect(scaleQuantities(null)).toEqual([]);
    expect(priceQuote({ ...input, priceScale: [] }, V3, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1, jobRates: JOB_RATES }).priceScale).toEqual([]);
  });

  it("without job rates (legacy path) no scale is computed", () => {
    expect(priceQuote(input, V3, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1 }).priceScale).toEqual([]);
  });
});

describe("price scale — assembly and loose part together", () => {
  const base = rect("base", 300, 200, 3, "S235", 7850);
  const lid = rect("lid", 300, 200, 2, "S235", 7850);
  const loose = rect("loose", 100, 100, 1.5, "DC01", 7850);
  const assembly = makeAssembly({ id: "asm", qty: 1, seams: [makeSeam({ lengthMm: 800, thicknessMm: 2 })] });
  const input = makeQuoteInput({
    marginPct: 0,
    leadTimeDays: 11,
    parts: [base, lid, loose],
    items: [
      makeItem({ id: "i-base", partId: "base", qty: 1, assemblyId: "asm", qtyPerAssembly: 1 }),
      makeItem({ id: "i-lid", partId: "lid", qty: 2, assemblyId: "asm", qtyPerAssembly: 2 }),
      makeItem({ id: "i-loose", partId: "loose", qty: 1 }),
    ],
    assemblies: [assembly],
    priceScale: [5, 10, 50],
  });

  it("scales the loose item and the assembly (members at qty × qtyPerAssembly), both strictly decreasing; members are not subjects", () => {
    const priced = priceQuote(input, V3, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1, jobRates: JOB_RATES });
    expect(priced.priceScale.map((s) => [s.kind, s.subjectId])).toEqual([["item", "i-loose"], ["assembly", "asm"]]);
    strictlyDecreasing(priced.priceScale[0], [5, 10, 50]);
    strictlyDecreasing(priced.priceScale[1], [5, 10, 50]);
    const scaled = scaledInput(input, 10);
    expect(scaled.assemblies?.[0].qty).toBe(10);
    expect(scaled.items.map((i) => i.qty)).toEqual([10, 20, 10]);
  });

  it("priceScale() with an injected pricer reports null for an unpriceable subject and never recurses", () => {
    let calls = 0;
    const scale = priceScale({ ...input, priceScale: [2, 4] }, (scaled) => {
      calls += 1;
      expect(scaled.priceScale).toEqual([]);
      return priceQuote(scaled, V3, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1, jobRates: JOB_RATES });
    });
    expect(calls).toBe(2);
    expect(scale[1].entries.every((e) => e.unitPrice !== null)).toBe(true);
    const refused = priceScale(
      { ...input, priceScale: [2], parts: input.parts.map((p) => (p.id === "loose" ? { ...p, materialCode: "CuZn37" } : p)) },
      (scaled) => priceQuote(scaled, V3, MACHINE_PARK, { costRates: RATE_SNAPSHOT_V1, jobRates: JOB_RATES })
    );
    // CuZn37 1.5 mm has no laser row in v3: refused → null at every quantity
    expect(refused[0].entries).toEqual([{ qty: 2, unitPrice: null, total: null }]);
  });
});
