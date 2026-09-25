/**
 * Pricing engine — rate-row lookups over a RateSnapshot / MachinePark.
 * File path: /lib/pricing/lookup.ts
 *
 * Every lookup is pure and deterministic and returns the ROW it picked
 * (never just a number) so the operation line can record it in `rateRef`
 * for the audit trail. Thickness comparisons use a 1e-6 mm epsilon.
 *
 * Fallback order (the "which row prices this?" rules):
 *
 *   materials        code match, case-insensitive, trimmed.
 *   price per kg     first band with maxThicknessMm ≥ t; thicker than every
 *                    band → the last (thickest) band; no bands → null.
 *   laser            1. t ≤ family limit of the flat laser AND an in-house
 *                       row at exactly (material, t) → in-house (reason
 *                       "in_house").
 *                    2. else the supplier row (in_house = false) at exactly
 *                       (material, t) → subcontract; reason "over_limit"
 *                       when t exceeds the machine limit, "supplier_row"
 *                       when the thickness is allowed but only a supplier
 *                       prices it, "no_machine" when the park has no flat
 *                       laser.
 *                    3. else the supplier row with the NEAREST thickness for
 *                       that material (ties → the thicker row, which is the
 *                       conservative price) → subcontract, exactThickness
 *                       false so the UI can flag it.
 *                    4. else null → red laser.no_rate_row.
 *                    Rows that cannot price (mode "time" without a speed,
 *                    mode "per_m" without €/m) are ignored at every step.
 *   bend             rows of the SMALLEST thickness class ≥ t, then the
 *                    smallest length class ≥ bend length; none → null.
 *   roll             same shape: smallest thickness class ≥ t, then the
 *                    smallest radius class ≥ radius; none → null.
 *   weld             rows of the process, smallest bead ≥ bead; bigger than
 *                    every bead → the largest; no rows for the process → null.
 *   tube laser       rows of the profile family, smallest wall ≥ wall;
 *                    none → null (a thicker wall is never priced from a
 *                    thinner row).
 *   thread           size match after normalisation (upper-case, "×" → "x",
 *                    spaces removed): "M10x1" = "m10 × 1".
 *   feature/finish   code match, case-insensitive, trimmed.
 *   machine          first machine of the kind in the park; null when absent.
 */

import type { WeldProcess } from "../geometry/types";
import type {
  BendRate,
  FeatureRate,
  FinishRate,
  FlatLaserLimits,
  LaserRate,
  Machine,
  MachineKind,
  MachinePark,
  MaterialFamily,
  MaterialRate,
  RateSnapshot,
  RollRate,
  ThicknessBandPrice,
  ThreadRate,
  TubeLaserRate,
  WeldRate,
} from "./types";

/** Epsilon for mm comparisons (rate rows are stored with 3 decimals). */
export const MM_EPSILON = 1e-6;

export function sameMm(a: number, b: number): boolean {
  return Math.abs(a - b) < MM_EPSILON;
}

function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

export function normaliseThreadSize(size: string): string {
  return size.trim().toUpperCase().replace(/×/g, "X").replace(/\s+/g, "");
}

/* ─── Materials ───────────────────────────────────────────── */

export function findMaterial(rates: RateSnapshot, code: string | null): MaterialRate | null {
  if (!code) return null;
  const key = normaliseCode(code);
  return rates.materials.find((m) => normaliseCode(m.code) === key) ?? null;
}

/** First band with maxThicknessMm ≥ t, else the last band, else null. */
export function materialPricePerKg(
  material: MaterialRate,
  thicknessMm: number
): ThicknessBandPrice | null {
  if (material.pricePerKg.length === 0) return null;
  const bands = [...material.pricePerKg].sort((a, b) => a.maxThicknessMm - b.maxThicknessMm);
  return bands.find((b) => b.maxThicknessMm >= thicknessMm - MM_EPSILON) ?? bands[bands.length - 1];
}

/* ─── Laser ───────────────────────────────────────────────── */

export type LaserLookupReason =
  | "in_house"
  | "over_limit"
  | "supplier_row"
  | "no_machine"
  | "none";

export type LaserRateLookup = {
  row: LaserRate | null;
  /** True when the cut is priced from a supplier row (subcontract_cutting). */
  subcontract: boolean;
  reason: LaserLookupReason;
  /** False when the nearest-thickness supplier row was used. */
  exactThickness: boolean;
  /** Flat-laser limit for the material family (null without a machine). */
  limitMm: number | null;
};

/** A row that the formulas can actually price. */
export function isUsableLaserRow(row: LaserRate): boolean {
  if (row.mode === "time") {
    return row.speedMMin !== null && row.speedMMin > 0 && row.pierceS !== null && row.pierceS >= 0;
  }
  return row.pricePerM !== null && row.pricePerM >= 0;
}

export function findLaserRate(
  rates: RateSnapshot,
  materialCode: string,
  thicknessMm: number,
  machineLimitMm: number | null
): LaserRateLookup {
  const code = normaliseCode(materialCode);
  const rows = rates.laser.filter(
    (r) => normaliseCode(r.materialCode) === code && isUsableLaserRow(r)
  );
  const withinLimit = machineLimitMm !== null && thicknessMm <= machineLimitMm + MM_EPSILON;

  if (withinLimit) {
    const inHouse = rows.find((r) => r.inHouse && sameMm(r.thicknessMm, thicknessMm));
    if (inHouse) {
      return {
        row: inHouse,
        subcontract: false,
        reason: "in_house",
        exactThickness: true,
        limitMm: machineLimitMm,
      };
    }
  }

  const reason: LaserLookupReason =
    machineLimitMm === null ? "no_machine" : withinLimit ? "supplier_row" : "over_limit";
  const supplierRows = rows.filter((r) => !r.inHouse);
  const exact = supplierRows.find((r) => sameMm(r.thicknessMm, thicknessMm));
  if (exact) {
    return { row: exact, subcontract: true, reason, exactThickness: true, limitMm: machineLimitMm };
  }
  if (supplierRows.length > 0) {
    const nearest = supplierRows.reduce((best, r) => {
      const d = Math.abs(r.thicknessMm - thicknessMm);
      const bd = Math.abs(best.thicknessMm - thicknessMm);
      if (d < bd - MM_EPSILON) return r;
      if (Math.abs(d - bd) < MM_EPSILON && r.thicknessMm > best.thicknessMm) return r;
      return best;
    });
    return {
      row: nearest,
      subcontract: true,
      reason,
      exactThickness: false,
      limitMm: machineLimitMm,
    };
  }
  return {
    row: null,
    subcontract: !withinLimit,
    reason: withinLimit ? "none" : reason,
    exactThickness: false,
    limitMm: machineLimitMm,
  };
}

/* ─── Bend / roll (thickness class → size class) ──────────── */

function smallestClassAtLeast(values: number[], target: number): number | null {
  const candidates = values.filter((v) => v >= target - MM_EPSILON).sort((a, b) => a - b);
  return candidates.length > 0 ? candidates[0] : null;
}

export function findBendRate(
  rates: RateSnapshot,
  thicknessMm: number,
  bendLengthMm: number
): BendRate | null {
  const thicknessClass = smallestClassAtLeast(
    rates.bend.map((r) => r.thicknessMm),
    thicknessMm
  );
  if (thicknessClass === null) return null;
  const rowsForT = rates.bend
    .filter((r) => sameMm(r.thicknessMm, thicknessClass))
    .sort((a, b) => a.lengthClassMm - b.lengthClassMm);
  return rowsForT.find((r) => r.lengthClassMm >= bendLengthMm - MM_EPSILON) ?? null;
}

export function findRollRate(
  rates: RateSnapshot,
  thicknessMm: number,
  radiusMm: number
): RollRate | null {
  const thicknessClass = smallestClassAtLeast(
    rates.roll.map((r) => r.thicknessMm),
    thicknessMm
  );
  if (thicknessClass === null) return null;
  const rowsForT = rates.roll
    .filter((r) => sameMm(r.thicknessMm, thicknessClass))
    .sort((a, b) => a.radiusClassMm - b.radiusClassMm);
  return rowsForT.find((r) => r.radiusClassMm >= radiusMm - MM_EPSILON) ?? null;
}

/* ─── Weld ────────────────────────────────────────────────── */

export function findWeldRate(
  rates: RateSnapshot,
  process: WeldProcess,
  beadMm: number
): WeldRate | null {
  const rows = rates.weld.filter((r) => r.process === process).sort((a, b) => a.beadMm - b.beadMm);
  if (rows.length === 0) return null;
  return rows.find((r) => r.beadMm >= beadMm - MM_EPSILON) ?? rows[rows.length - 1];
}

/* ─── Tube laser ──────────────────────────────────────────── */

export function findTubeLaserRate(
  rates: RateSnapshot,
  profileFamily: TubeLaserRate["profileFamily"],
  wallMm: number
): TubeLaserRate | null {
  const rows = rates.tubeLaser
    .filter((r) => r.profileFamily === profileFamily)
    .sort((a, b) => a.wallMm - b.wallMm);
  return rows.find((r) => r.wallMm >= wallMm - MM_EPSILON) ?? null;
}

/* ─── Threads, features, finishes ─────────────────────────── */

export function findThreadRate(rates: RateSnapshot, size: string): ThreadRate | null {
  const key = normaliseThreadSize(size);
  return rates.thread.find((r) => normaliseThreadSize(r.size) === key) ?? null;
}

export function findFeatureRate(rates: RateSnapshot, code: string): FeatureRate | null {
  const key = normaliseCode(code);
  return rates.feature.find((r) => normaliseCode(r.code) === key) ?? null;
}

export function findFinishRate(rates: RateSnapshot, code: string): FinishRate | null {
  const key = normaliseCode(code);
  return rates.finish.find((r) => normaliseCode(r.code) === key) ?? null;
}

/* ─── Machines ────────────────────────────────────────────── */

export function machineOf<K extends MachineKind>(
  park: MachinePark,
  kind: K
): Extract<Machine, { kind: K }> | null {
  for (const machine of park) {
    if (machine.kind === kind) return machine as Extract<Machine, { kind: K }>;
  }
  return null;
}

/** Flat-laser thickness limit for a material family; null without a machine or family. */
export function familyThicknessLimitMm(
  limits: FlatLaserLimits | null,
  family: MaterialFamily | null
): number | null {
  if (!limits || !family) return null;
  const limit = limits.maxThicknessMm[family];
  return typeof limit === "number" && Number.isFinite(limit) ? limit : null;
}
