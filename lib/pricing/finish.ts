/**
 * Pricing engine — finishing cost per rate_finish unit, shared by the
 * operations builder (the line) and the feasibility rules (the
 * finish.minimum_applied flag) so both agree.
 * File path: /lib/pricing/finish.ts
 *
 * Unit → driver: m2 → net area × 2 faces (powder), kg → part net mass
 * (zinc), m → cut length (deburr), each → 1 per part. Masking minutes ×
 * labour rate are added for every unit (masking is entered per finish).
 * The rate's `minimum` is a BATCH minimum: unit cost is raised so that
 * unitCost × qty = minimum when the batch would fall below it.
 * Operation type is derived from the rate code prefix (powder → finish_powder,
 * zinc/galv → finish_zinc, deburr → finish_deburr, else finish_other).
 */

import {
  applyBatchMinimum,
  deburrCost,
  mm2ToM2,
  mmToM,
  powderCoatUnitCost,
  zincUnitCost,
} from "./formulas";
import type { DriverUnit, FinishRate, GeneralRate, OperationType } from "./types";

export type FinishDrivers = {
  netAreaMm2: number;
  massKg: number | null;
  cutLengthMm: number;
};

export type FinishComputation = {
  rate: FinishRate;
  type: OperationType;
  driverQty: number;
  driverUnit: DriverUnit;
  unitCostBeforeMinimum: number;
  unitCost: number;
  maskingCost: number;
  minimumApplied: boolean;
  batchCost: number;
};

export function finishTypeFor(code: string): OperationType {
  const c = code.trim().toLowerCase();
  if (c.startsWith("powder")) return "finish_powder";
  if (c.startsWith("zinc") || c.startsWith("galv")) return "finish_zinc";
  if (c.startsWith("deburr")) return "finish_deburr";
  return "finish_other";
}

/** Null when the unit needs a driver we do not have (kg without a mass). */
export function computeFinish(
  rate: FinishRate,
  drivers: FinishDrivers,
  maskingMinutes: number,
  qty: number,
  general: GeneralRate
): FinishComputation | null {
  const maskingCost = (maskingMinutes / 60) * general.labourRateEurH;
  let driverQty: number;
  let driverUnit: DriverUnit;
  let base: number;
  switch (rate.unit) {
    case "m2": {
      driverQty = mm2ToM2(drivers.netAreaMm2);
      driverUnit = "m2";
      base = powderCoatUnitCost(driverQty, rate.price, maskingMinutes, general.labourRateEurH) - maskingCost;
      break;
    }
    case "kg": {
      if (drivers.massKg === null) return null;
      driverQty = drivers.massKg;
      driverUnit = "kg";
      base = zincUnitCost(driverQty, rate.price);
      break;
    }
    case "m": {
      driverQty = mmToM(drivers.cutLengthMm);
      driverUnit = "m";
      base = deburrCost(driverQty, rate.price);
      break;
    }
    case "each": {
      driverQty = 1;
      driverUnit = "each";
      base = rate.price;
      break;
    }
  }
  const before = base + maskingCost;
  const applied = applyBatchMinimum(before, qty, rate.minimum);
  return {
    rate,
    type: finishTypeFor(rate.code),
    driverQty,
    driverUnit,
    unitCostBeforeMinimum: before,
    unitCost: applied.unitCost,
    maskingCost,
    minimumApplied: applied.applied,
    batchCost: applied.batchCost,
  };
}
