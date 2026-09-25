/**
 * Unit tests for the pure pricing formulas — every number hand-computed.
 * File path: /lib/pricing/formulas.test.ts
 */

import { describe, expect, it } from "vitest";
import {
  adjustedCutLengthM,
  applyBatchMinimum,
  areaMassKg,
  bendForceN,
  blankMassKg,
  countCost,
  deburrCost,
  defaultDieVMm,
  engraveCost,
  laserCutTimeMin,
  laserPerMCost,
  laserTimeCost,
  machiningCost,
  materialCost,
  minFlangeMm,
  minHoleToBendMm,
  mm2ToM2,
  mmToM,
  powderCoatUnitCost,
  rollCost,
  setupShare,
  slowContourThresholdMm,
  weldCost,
  weldEffectiveLengthMm,
  zincUnitCost,
} from "./formulas";
import { PricingError } from "./errors";
import { marginToMarkup, priceFromCost } from "./types";

describe("laser formulas", () => {
  it("adjusts the cut length by weighting slow contours (not adding them)", () => {
    expect(adjustedCutLengthM(2.0, 0.5, 1.5)).toBeCloseTo(2.25, 12);
    expect(adjustedCutLengthM(2.0, 0.5, 1.0)).toBeCloseTo(2.0, 12);
    expect(adjustedCutLengthM(2.0, 0, 1.5)).toBeCloseTo(2.0, 12);
  });

  it("200005-like: 2224.5 mm, 26 pierces at 1.7 m/min and 2.0 s pierce", () => {
    // 2.2245 / 1.7 = 1.308529… min; 26 × 2.0 / 60 = 0.866667 min
    const t = laserCutTimeMin(2.2245, 1.7, 26, 2.0);
    expect(t).toBeCloseTo(2.2245 / 1.7 + 52 / 60, 10);
    expect(t).toBeCloseTo(2.175196, 5);
    // cost at 70 €/h and no €/pierce: 2.175196 / 60 × 70
    expect(laserTimeCost(t, 70, 26, 0)).toBeCloseTo(2.537729, 5);
    // with 0.10 €/pierce
    expect(laserTimeCost(t, 70, 26, 0.1)).toBeCloseTo(2.537729 + 2.6, 5);
  });

  it("200164-like: 1796.1 mm with 571.8 mm of slow contours at factor 1.5, 16 m/min, 33 pierces × 0.3 s", () => {
    // adjusted = 1.7961 + 0.5718 × 0.5 = 2.082 m → 2.082/16 = 0.130125; pierces 33 × 0.3 / 60 = 0.165
    const t = laserCutTimeMin(1.7961, 16, 33, 0.3, 0.5718, 1.5);
    expect(t).toBeCloseTo(0.295125, 9);
  });

  it("per-metre mode multiplies the plain cut length (no slow-contour weighting, Step 9) and adds pierces", () => {
    expect(laserPerMCost(2.2245, 4.5, 26, 0.5)).toBeCloseTo(2.2245 * 4.5 + 13, 10);
    expect(laserPerMCost(2.2245, 4.5, 26, 0.5)).toBeCloseTo(23.01025, 9);
  });

  it("rejects a non-positive speed and non-finite inputs", () => {
    expect(() => laserCutTimeMin(1, 0, 1, 1)).toThrow(PricingError);
    expect(() => laserCutTimeMin(1, -2, 1, 1)).toThrow(PricingError);
    expect(() => laserCutTimeMin(Number.NaN, 10, 1, 1)).toThrow(PricingError);
    try {
      laserCutTimeMin(1, 0, 1, 1);
    } catch (e) {
      expect(e).toBeInstanceOf(PricingError);
      expect((e as PricingError).code).toBe("invalid_input");
      expect((e as PricingError).details.field).toBe("speedMMin");
    }
  });
});

describe("material formulas", () => {
  it("blank mass: 520 × 240 × 15 mm in steel 7850 kg/m³", () => {
    // 520 × 240 × 15 = 1 872 000 mm³ × 7850 × 1e-9 = 14.6952 kg
    expect(blankMassKg(520, 240, 15, 7850)).toBeCloseTo(14.6952, 9);
  });

  it("net mass reproduces the 200005 and 200164 drawing masses", () => {
    expect(areaMassKg(101824.9, 15, 7850)).toBeCloseTo(11.99, 2);
    expect(areaMassKg(32421.3, 2, 7850)).toBeCloseTo(0.509, 3);
  });

  it("material cost applies scrap on top of the mass", () => {
    // 14.6952 × 1.25 × 1.20 = 22.0428
    expect(materialCost(14.6952, 25, 1.2)).toBeCloseTo(22.0428, 9);
    expect(materialCost(10, 0, 2)).toBeCloseTo(20, 12);
  });
});

describe("press-brake formulas", () => {
  it("default die V = dieFactor × t", () => {
    expect(defaultDieVMm(12, 8)).toBe(96);
    expect(defaultDieVMm(2, 8)).toBe(16);
    expect(() => defaultDieVMm(0, 8)).toThrow(PricingError);
  });

  it("force: 4000 mm bend in 12 mm S355 with V = 96 is 4.3452 MN", () => {
    // 1.42 × 510 × 144 × 4000 / 96 = 4 345 200 N
    expect(bendForceN(510, 12, 4000, 96)).toBeCloseTo(4_345_200, 6);
  });

  it("force: 8 mm S355 over the full 4420 mm is right at the 3.2 MN limit (spec §8.3 table)", () => {
    // 1.42 × 510 × 64 × 4420 / 64 = 3 200 964 N
    expect(bendForceN(510, 8, 4420, 64)).toBeCloseTo(3_200_964, 6);
  });

  it("force rejects a zero die opening", () => {
    expect(() => bendForceN(510, 8, 100, 0)).toThrow(PricingError);
  });

  it("minimum flange = V/2 + r + 2", () => {
    expect(minFlangeMm(16, 2)).toBe(12);
    expect(minFlangeMm(64, 8)).toBe(42);
  });

  it("hole-to-bend and slow-contour thresholds scale with thickness", () => {
    expect(minHoleToBendMm(8)).toBe(20);
    expect(minHoleToBendMm(2)).toBe(5);
    expect(slowContourThresholdMm(2)).toBe(20);
    expect(slowContourThresholdMm(15)).toBe(150);
  });
});

describe("setup, rolling, welding", () => {
  it("setup share spreads over the quantity and rejects qty ≤ 0", () => {
    expect(setupShare(8, 50)).toBeCloseTo(0.16, 12);
    expect(setupShare(15, 1)).toBe(15);
    expect(() => setupShare(8, 0)).toThrow(PricingError);
    expect(() => setupShare(8, -1)).toThrow(PricingError);
  });

  it("roll cost = setup / qty + €/m × axis length", () => {
    // 25/10 + 12 × 1.5 = 2.5 + 18
    expect(rollCost(25, 10, 12, 1.5)).toBeCloseTo(20.5, 12);
  });

  it("effective weld length: full, stitch, sides", () => {
    expect(weldEffectiveLengthMm(554.3, "full", null, 1)).toBeCloseTo(554.3, 12);
    expect(weldEffectiveLengthMm(554.3, "full", null, 2)).toBeCloseTo(1108.6, 12);
    // stitch 30/60 → half
    expect(weldEffectiveLengthMm(554.3, "stitch", { beadLengthMm: 30, pitchMm: 60 }, 1)).toBeCloseTo(277.15, 12);
    expect(weldEffectiveLengthMm(554.3, "stitch", { beadLengthMm: 30, pitchMm: 60 }, 2)).toBeCloseTo(554.3, 12);
    // bead ≥ pitch is a continuous weld
    expect(weldEffectiveLengthMm(100, "stitch", { beadLengthMm: 80, pitchMm: 40 }, 1)).toBe(100);
    // a stitch pattern is ignored for a full weld
    expect(weldEffectiveLengthMm(100, "full", { beadLengthMm: 10, pitchMm: 40 }, 1)).toBe(100);
  });

  it("stitch without a pattern or with a zero pitch throws", () => {
    expect(() => weldEffectiveLengthMm(100, "stitch", null, 1)).toThrow(PricingError);
    expect(() => weldEffectiveLengthMm(100, "stitch", { beadLengthMm: 10, pitchMm: 0 }, 1)).toThrow(
      PricingError
    );
  });

  it("weld cost = effective mm × €/mm (sides are already inside the length)", () => {
    expect(weldCost(277.15, 0.045)).toBeCloseTo(12.47175, 9);
  });
});

describe("threads, features, machining, finishing", () => {
  it("count × price each", () => {
    expect(countCost(8, 0.9)).toBeCloseTo(7.2, 12);
    expect(countCost(0, 0.9)).toBe(0);
  });

  it("machining minutes / 60 × rate", () => {
    expect(machiningCost(30, 60)).toBe(30);
    expect(machiningCost(45, 80)).toBe(60);
  });

  it("powder coat: both faces plus masking labour", () => {
    // 0.0324213 m² × 2 × 14 = 0.9077964; 5 min / 60 × 35 = 2.9166667
    expect(powderCoatUnitCost(0.0324213, 14, 5, 35)).toBeCloseTo(0.9077964 + 2.9166667, 6);
    expect(powderCoatUnitCost(1, 14, 0, 35)).toBe(28);
  });

  it("zinc, deburr, engrave are linear in their driver", () => {
    expect(zincUnitCost(0.509, 1.2)).toBeCloseTo(0.6108, 12);
    expect(deburrCost(1.7961, 0.4)).toBeCloseTo(0.71844, 12);
    expect(engraveCost(0.25, 1.0)).toBe(0.25);
  });

  it("batch minimum raises the unit cost so the batch costs exactly the minimum", () => {
    expect(applyBatchMinimum(0.5, 10, 25)).toEqual({ unitCost: 2.5, batchCost: 25, applied: true });
    expect(applyBatchMinimum(3, 10, 25)).toEqual({ unitCost: 3, batchCost: 30, applied: false });
    expect(applyBatchMinimum(0.5, 10, 0)).toEqual({ unitCost: 0.5, batchCost: 5, applied: false });
    expect(() => applyBatchMinimum(1, 0, 25)).toThrow(PricingError);
  });
});

describe("unit helpers and margin", () => {
  it("mm → m and mm² → m²", () => {
    expect(mmToM(2224.5)).toBeCloseTo(2.2245, 12);
    expect(mm2ToM2(32421.3)).toBeCloseTo(0.0324213, 12);
  });

  it("30 % margin on price equals 42.857 % markup on cost", () => {
    expect(marginToMarkup(30)).toBeCloseTo(42.857142857, 8);
    expect(priceFromCost(7, 30)).toBeCloseTo(10, 12);
    expect(priceFromCost(100, 0)).toBe(100);
    expect(marginToMarkup(100)).toBe(Infinity);
  });
});
