/**
 * Packaging from packaging_rates: the first row in position order whose
 * limits hold, else the last; gross mass = net × 1.05; the quote-level
 * line and its details.
 * File path: /lib/pricing/packaging.test.ts
 */
import { describe, expect, it } from "vitest";
import { makeRectPartGeometry } from "@/test/helpers/geometry";
import { makeItem, makePricingPart } from "@/test/helpers/quote";
import { JOB_RATES, RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";
import { PACKAGING_ALLOWANCE_PCT, grossMassKg } from "./market-rules";
import { packagingEnvelope, packagingForParts, packagingLine, packedPart, pickPackaging } from "./packaging";
import type { PackagingRate } from "./types";

const RATES = JOB_RATES.packaging;

describe("pickPackaging", () => {
  it("picks the first row in position order whose side AND mass limits hold", () => {
    expect(pickPackaging(RATES, 300, 4)?.code).toBe("carton");
    expect(pickPackaging(RATES, 400, 5)?.code).toBe("carton");
    expect(pickPackaging(RATES, 300, 6)?.code).toBe("carton_foam");
    expect(pickPackaging(RATES, 500, 4)?.code).toBe("carton_foam");
    expect(pickPackaging(RATES, 1000, 50)?.code).toBe("crate");
    expect(pickPackaging(RATES, 2000, 500)?.code).toBe("pallet");
  });

  it("falls back to the last row when nothing holds; empty table → null; position order wins over row order", () => {
    expect(pickPackaging(RATES, 5000, 2000)?.code).toBe("pallet");
    expect(pickPackaging([], 100, 1)).toBeNull();
    const shuffled: PackagingRate[] = [
      { code: "big", name: "Big", maxSideMm: 3000, maxMassKg: 1000, priceEur: 40, position: 2 },
      { code: "small", name: "Small", maxSideMm: 400, maxMassKg: 5, priceEur: 3, position: 1 },
    ];
    expect(pickPackaging(shuffled, 100, 1)?.code).toBe("small");
    expect(pickPackaging(shuffled, 100, 900)?.code).toBe("big");
  });
});

describe("envelope and line", () => {
  const part = (lengthMm: number, widthMm: number, t: number) =>
    makePricingPart({ id: `p${lengthMm}`, geometry: makeRectPartGeometry({ lengthMm, widthMm, thicknessMm: t, densityKgM3: 7850 }), materialCode: "S235", thicknessMm: t });

  it("packedPart reads the largest side and the net mass from the snapshot's density", () => {
    const p = packedPart(part(375, 247, 3), makeItem({ partId: "x", qty: 2 }), RATE_SNAPSHOT_V1);
    expect(p.maxSideMm).toBe(375);
    expect(p.netMassKg).toBeCloseTo(375 * 247 * 3 * 7850e-9, 9);
    expect(p.qty).toBe(2);
    const unknown = packedPart({ ...part(100, 100, 2), materialCode: "XX", geometry: { ...part(100, 100, 2).geometry, material: { thicknessMm: 2, densityKgM3: null } } }, makeItem({ partId: "x" }), RATE_SNAPSHOT_V1);
    expect(unknown.netMassKg).toBeNull();
  });

  it("the envelope sums net mass × qty and adds the 5 % allowance", () => {
    const env = packagingEnvelope([
      { maxSideMm: 375, netMassKg: 3, qty: 1 },
      { maxSideMm: 247, netMassKg: 1, qty: 2 },
      { maxSideMm: 30, netMassKg: null, qty: 11 },
    ]);
    expect(env).toEqual({ largestSideMm: 375, netKg: 5, grossKg: 5.25, parts: 3 });
    expect(PACKAGING_ALLOWANCE_PCT).toBe(5);
    expect(grossMassKg(10)).toBeCloseTo(10.5, 12);
  });

  it("packagingForParts → one quote-level lot line with label packaging, code / grossKg / largestSideMm in details, placeholder from the job rates", () => {
    const { line, rate, envelope } = packagingForParts([{ maxSideMm: 375, netMassKg: 15.2, qty: 1 }], RATES, true);
    expect(rate?.code).toBe("crate");
    expect(envelope.grossKg).toBeCloseTo(15.96, 9);
    expect(line).toMatchObject({ id: "quote:packaging", type: "packaging", label: "packaging", driverQty: 1, driverUnit: "lot", unitCost: 24, setupShare: 0 });
    expect(line?.rateRef).toMatchObject({ table: "manual", key: "packaging_rates/crate" });
    expect(line?.rateRef.values).toMatchObject({ code: "crate", priceEur: 24, maxSideMm: 1200, maxMassKg: 60, placeholder: true });
    expect(line?.details).toMatchObject({ code: "crate", name: "Wooden crate", largestSideMm: 375, netKg: 15.2, allowancePct: 5 });
    expect(line?.details.grossKg).toBeCloseTo(15.96, 9);
  });

  it("no parts → no line; a free row → no line", () => {
    expect(packagingForParts([], RATES, false).line).toBeNull();
    expect(packagingLine({ code: "free", name: "Free", maxSideMm: 1, maxMassKg: 1, priceEur: 0, position: 1 }, packagingEnvelope([]), false)).toBeNull();
  });
});
