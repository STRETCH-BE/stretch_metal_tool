/**
 * Steel fallback of the bending rate with BEND_FALLBACK_APPLY_FAMILY_FACTOR
 * switched off: the same-thickness steel row prices the bends at factor
 * 1.0 and the amber flag says so. Own file because the constant is
 * mocked for the whole module graph (the engine passes it explicitly to
 * resolveBendRateForMaterial, so the mock reaches market.ts).
 * File path: /test/pricing/bend-fallback-off.test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { priceQuote } from "@/lib/pricing/price-quote";
import { rowsToMachinePark, rowsToRateSnapshot, type RateRows } from "@/lib/pricing/snapshot";
import { BEND_FALLBACK_APPLY_FAMILY_FACTOR } from "@/lib/pricing/eligibility";
import type { PricingPart } from "@/lib/pricing/types";
import { makeAnnotations, makeRectPartGeometry } from "@/test/helpers/geometry";
import { makeItem, makePricingPart, makeQuoteInput } from "@/test/helpers/quote";
import { RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";

vi.mock("@/lib/pricing/eligibility", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/pricing/eligibility")>();
  return { ...original, BEND_FALLBACK_APPLY_FAMILY_FACTOR: false };
});

type RatesJson = RateRows & { machines: Parameters<typeof rowsToMachinePark>[0] };
const json = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/rates/market-247-v3.json"), "utf8")) as RatesJson;
const { machines, ...rows } = json;
const V3 = rowsToRateSnapshot(rows);
const MACHINES = rowsToMachinePark(machines);

function almg3(bendLengthsMm: number[]): PricingPart {
  const geometry = makeRectPartGeometry({
    lengthMm: 200,
    widthMm: 160,
    thicknessMm: 1.5,
    densityKgM3: 2660,
    holes: [],
    bendLines: bendLengthsMm.map((len, i) => ({ x1: (200 * (i + 1)) / (bendLengthsMm.length + 1), y1: 0, x2: (200 * (i + 1)) / (bendLengthsMm.length + 1), y2: len, direction: "up" as const })),
    blankMarginMm: 0,
  });
  return makePricingPart({ id: "al", name: "al", geometry, materialCode: "AlMg3", thicknessMm: 1.5, annotations: makeAnnotations() });
}

function unit(part: PricingPart): { unitPrice: number | null; item: ReturnType<typeof priceQuote>["items"][number] } {
  const priced = priceQuote(makeQuoteInput({ parts: [part], items: [makeItem({ id: "x", partId: "al" })], leadTimeDays: 11, marginPct: 0 }), V3, MACHINES, { costRates: RATE_SNAPSHOT_V1 });
  return { unitPrice: priced.items[0].unitPrice, item: priced.items[0] };
}

describe("BEND_FALLBACK_APPLY_FAMILY_FACTOR = false", () => {
  it("is mocked off", () => {
    expect(BEND_FALLBACK_APPLY_FAMILY_FACTOR).toBe(false);
  });

  it("AlMg3 1.5 mm, 3 bends, qty 1 → +€9.46 (2.7747 + 3 × (0.8136 + 1.4152) × 1.0), amber flag with factor 1", () => {
    const bent = unit(almg3([160, 160, 160]));
    const flat = unit(almg3([]));
    expect(bent.unitPrice).not.toBeNull();
    const addOn = (bent.unitPrice ?? Number.NaN) - (flat.unitPrice ?? Number.NaN);
    expect(addOn).toBeCloseTo(2.7747 + 3 * (0.8136 + 1.4152), 6);
    expect(Math.abs(addOn - 9.46) / 9.46).toBeLessThanOrEqual(0.01);
    const bend = bent.item.operations.find((o) => o.label === "bend")!;
    expect(bend.unitCost).toBeCloseTo(3 * 1.4152, 9);
    expect(bend.rateRef.values).toMatchObject({ source: "steel_fallback", familyFactor: 1, rateBendId: "6fcf5918-080a-4cc0-85b2-3c9a5cd31237" });
    const amber = bent.item.flags.find((f) => f.code === "market.bend_rate_from_steel");
    expect(amber?.severity).toBe("amber");
    expect(amber?.params).toMatchObject({ thicknessMm: 1.5, factor: 1, family: "aluminium", materialCode: "AlMg3", count: 3 });
    expect(bent.item.flags.some((f) => f.severity === "red")).toBe(false);
  });
});
