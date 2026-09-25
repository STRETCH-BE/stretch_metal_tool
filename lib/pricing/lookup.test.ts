/**
 * Unit tests for the rate lookups and their documented fallback order.
 * File path: /lib/pricing/lookup.test.ts
 */

import { describe, expect, it } from "vitest";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, cloneSnapshot } from "@/test/helpers/rates";
import {
  familyThicknessLimitMm,
  findBendRate,
  findFeatureRate,
  findFinishRate,
  findLaserRate,
  findMaterial,
  findRollRate,
  findThreadRate,
  findTubeLaserRate,
  findWeldRate,
  machineOf,
  materialPricePerKg,
  normaliseThreadSize,
} from "./lookup";
import type { MaterialRate } from "./types";

const rates = RATE_SNAPSHOT_V1;
const flatLaser = machineOf(MACHINE_PARK, "flat_laser");

describe("findMaterial / materialPricePerKg", () => {
  it("matches the code case-insensitively and trimmed", () => {
    expect(findMaterial(rates, "S355")?.rmNmm2).toBe(510);
    expect(findMaterial(rates, " s355 ")?.code).toBe("S355");
    expect(findMaterial(rates, "1.4301")?.family).toBe("stainless");
    expect(findMaterial(rates, "S999")).toBeNull();
    expect(findMaterial(rates, null)).toBeNull();
  });

  it("picks the first band ≥ t, the last band above every band, null without bands", () => {
    const m: MaterialRate = {
      ...rates.materials[0],
      pricePerKg: [
        { maxThicknessMm: 12, pricePerKg: 1.6 },
        { maxThicknessMm: 3, pricePerKg: 2.0 },
        { maxThicknessMm: 6, pricePerKg: 1.8 },
      ],
    };
    expect(materialPricePerKg(m, 2)?.pricePerKg).toBe(2.0);
    expect(materialPricePerKg(m, 3)?.pricePerKg).toBe(2.0);
    expect(materialPricePerKg(m, 4)?.pricePerKg).toBe(1.8);
    expect(materialPricePerKg(m, 12)?.pricePerKg).toBe(1.6);
    expect(materialPricePerKg(m, 20)?.pricePerKg).toBe(1.6);
    expect(materialPricePerKg({ ...m, pricePerKg: [] }, 2)).toBeNull();
  });
});

describe("findLaserRate", () => {
  const limit = familyThicknessLimitMm(flatLaser?.limits ?? null, "mild_steel");

  it("family limit comes from the machine park", () => {
    expect(limit).toBe(12.7);
    expect(familyThicknessLimitMm(flatLaser?.limits ?? null, "aluminium")).toBe(6);
    expect(familyThicknessLimitMm(null, "aluminium")).toBeNull();
    expect(familyThicknessLimitMm(flatLaser?.limits ?? null, null)).toBeNull();
  });

  it("uses the exact in-house row when t is within the limit", () => {
    const r = findLaserRate(rates, "S355", 12, limit);
    expect(r.subcontract).toBe(false);
    expect(r.reason).toBe("in_house");
    expect(r.exactThickness).toBe(true);
    expect(r.row?.speedMMin).toBe(1.7);
    expect(r.row?.pierceS).toBe(2.0);
    expect(r.limitMm).toBe(12.7);
  });

  it("15 mm S355 → exact supplier row, reason over_limit", () => {
    const r = findLaserRate(rates, "S355", 15, limit);
    expect(r.subcontract).toBe(true);
    expect(r.reason).toBe("over_limit");
    expect(r.exactThickness).toBe(true);
    expect(r.row?.inHouse).toBe(false);
    expect(r.row?.thicknessMm).toBe(15);
    expect(r.row?.pricePerM).toBe(4.5);
  });

  it("18 mm S355 → nearest supplier thickness (20), flagged as inexact", () => {
    const r = findLaserRate(rates, "S355", 18, limit);
    expect(r.row?.thicknessMm).toBe(20);
    expect(r.exactThickness).toBe(false);
    expect(r.reason).toBe("over_limit");
  });

  it("ties on distance go to the thicker (conservative) supplier row", () => {
    const r = findLaserRate(rates, "S355", 17.5, limit);
    expect(r.row?.thicknessMm).toBe(20);
  });

  it("allowed thickness without an in-house row → supplier row, reason supplier_row", () => {
    const r = findLaserRate(rates, "S355", 2.5, limit);
    expect(r.subcontract).toBe(true);
    expect(r.reason).toBe("supplier_row");
    expect(r.exactThickness).toBe(false);
    expect(r.row?.thicknessMm).toBe(15);
  });

  it("no row at all → null with reason over_limit / none", () => {
    const over = findLaserRate(rates, "DC01", 15, limit);
    expect(over.row).toBeNull();
    expect(over.subcontract).toBe(true);
    expect(over.reason).toBe("over_limit");

    const within = findLaserRate(rates, "DC01", 2.5, limit);
    expect(within.row).toBeNull();
    expect(within.subcontract).toBe(false);
    expect(within.reason).toBe("none");
  });

  it("an in-house row above the family limit is ignored (aluminium 8 mm)", () => {
    const aluLimit = familyThicknessLimitMm(flatLaser?.limits ?? null, "aluminium");
    expect(rates.laser.some((r) => r.materialCode === "AW5754" && r.thicknessMm === 8)).toBe(true);
    const r = findLaserRate(rates, "AW5754", 8, aluLimit);
    expect(r.row).toBeNull();
    expect(r.reason).toBe("over_limit");
  });

  it("without a flat laser every cut is subcontract (reason no_machine)", () => {
    const r = findLaserRate(rates, "S355", 12, null);
    expect(r.subcontract).toBe(true);
    expect(r.reason).toBe("no_machine");
    expect(r.row?.thicknessMm).toBe(15);
  });

  it("ignores rows the formulas cannot price", () => {
    const snap = cloneSnapshot();
    const row = snap.laser.find((r) => r.materialCode === "S355" && r.thicknessMm === 12);
    if (row) row.speedMMin = null;
    const r = findLaserRate(snap, "S355", 12, limit);
    expect(r.reason).toBe("supplier_row");
  });
});

describe("findBendRate", () => {
  it("thickness class ≥ t, then length class ≥ length", () => {
    expect(findBendRate(rates, 2, 60)?.pricePerBend).toBe(0.9);
    expect(findBendRate(rates, 2, 500)?.pricePerBend).toBe(0.9);
    expect(findBendRate(rates, 2, 500.5)?.pricePerBend).toBe(1.6);
    expect(findBendRate(rates, 6, 1500)?.pricePerBend).toBe(1.6);
    expect(findBendRate(rates, 6, 4420)?.pricePerBend).toBe(3.0);
    expect(findBendRate(rates, 8, 400)?.pricePerBend).toBe(1.35);
    expect(findBendRate(rates, 12, 4000)?.pricePerBend).toBe(4.5);
    expect(findBendRate(rates, 20, 4000)?.thicknessMm).toBe(20);
  });

  it("returns null above every thickness or length class", () => {
    expect(findBendRate(rates, 25, 100)).toBeNull();
    expect(findBendRate(rates, 6, 5000)).toBeNull();
  });
});

describe("findRollRate", () => {
  it("thickness class ≥ t, then radius class ≥ radius", () => {
    expect(findRollRate(rates, 4, 500)?.pricePerM).toBe(12);
    expect(findRollRate(rates, 6, 3000)?.setup).toBe(25);
  });
  it("null above every class", () => {
    expect(findRollRate(rates, 8, 500)).toBeNull();
    expect(findRollRate(rates, 4, 3500)).toBeNull();
  });
});

describe("findWeldRate", () => {
  it("smallest bead ≥ bead, else the largest", () => {
    expect(findWeldRate(rates, "mig_mag", 4)?.pricePerMm).toBe(0.045);
    expect(findWeldRate(rates, "mig_mag", 2)?.beadMm).toBe(4);
    expect(findWeldRate(rates, "mig_mag", 8)?.beadMm).toBe(4);
    expect(findWeldRate(rates, "tig", 4)?.pricePerMm).toBe(0.09);
    expect(findWeldRate(rates, "laser", 4)?.pricePerMm).toBe(0.06);
    expect(findWeldRate(rates, "mma", 4)?.pricePerMm).toBe(0.07);
  });
  it("prefers the smallest sufficient bead when several exist", () => {
    const snap = cloneSnapshot();
    snap.weld.push({ process: "mig_mag", beadMm: 6, pricePerMm: 0.06, setup: 15, minOrder: 60, placeholder: true });
    snap.weld.push({ process: "mig_mag", beadMm: 2, pricePerMm: 0.03, setup: 15, minOrder: 60, placeholder: true });
    expect(findWeldRate(snap, "mig_mag", 3)?.beadMm).toBe(4);
    expect(findWeldRate(snap, "mig_mag", 5)?.beadMm).toBe(6);
    expect(findWeldRate(snap, "mig_mag", 9)?.beadMm).toBe(6);
    expect(findWeldRate(snap, "mig_mag", 1)?.beadMm).toBe(2);
  });
  it("null without rows for the process", () => {
    const snap = cloneSnapshot();
    snap.weld = snap.weld.filter((r) => r.process !== "tig");
    expect(findWeldRate(snap, "tig", 4)).toBeNull();
  });
});

describe("findTubeLaserRate", () => {
  it("smallest wall ≥ wall for the family, null above every wall", () => {
    expect(findTubeLaserRate(rates, "round", 2)?.wallMm).toBe(3);
    expect(findTubeLaserRate(rates, "round", 3)?.wallMm).toBe(3);
    expect(findTubeLaserRate(rates, "square", 5)?.wallMm).toBe(6);
    expect(findTubeLaserRate(rates, "open", 6)?.pricePerMCut).toBe(4.0);
    expect(findTubeLaserRate(rates, "rectangular", 7)).toBeNull();
  });
});

describe("threads, features, finishes", () => {
  it("normalises thread sizes", () => {
    expect(normaliseThreadSize(" m10 × 1 ")).toBe("M10X1");
    expect(findThreadRate(rates, "M10x1")?.priceEach).toBe(1.0);
    expect(findThreadRate(rates, "m10×1")?.size).toBe("M10x1");
    expect(findThreadRate(rates, "M 8")?.size).toBe("M8");
    expect(findThreadRate(rates, "M7")).toBeNull();
  });
  it("feature and finish codes are case-insensitive", () => {
    expect(findFeatureRate(rates, "countersink")?.priceEach).toBe(0.8);
    expect(findFeatureRate(rates, "COUNTERSINK")?.code).toBe("countersink");
    expect(findFeatureRate(rates, "nope")).toBeNull();
    expect(findFinishRate(rates, "powder")?.minimum).toBe(25);
    expect(findFinishRate(rates, "Zinc")?.unit).toBe("kg");
    expect(findFinishRate(rates, "chrome")).toBeNull();
  });
});

describe("machineOf", () => {
  it("returns the typed machine of a kind, null when absent", () => {
    const brake = machineOf(MACHINE_PARK, "press_brake");
    expect(brake?.limits.forceKN).toBe(3200);
    expect(brake?.limits.dieFactor).toBe(8);
    expect(machineOf(MACHINE_PARK, "roll")?.limits.minRadiusMm).toBe(200);
    expect(machineOf(MACHINE_PARK, "tube_laser")?.limits.wallThicknessMm.stainless).toEqual([12.5, 8]);
    expect(machineOf(MACHINE_PARK, "weld")?.limits.processes).toHaveLength(4);
    expect(machineOf([], "flat_laser")).toBeNull();
    expect(machineOf(MACHINE_PARK.filter((m) => m.kind !== "roll"), "roll")).toBeNull();
  });
});
