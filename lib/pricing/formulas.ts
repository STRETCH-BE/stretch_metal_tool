/**
 * Pricing engine — the pure formulas (build prompt Step 9, spec §6 / §8).
 * File path: /lib/pricing/formulas.ts
 *
 * Every function is a tiny deterministic calculator: numbers in, number
 * out, no I/O, no rates read from anywhere. Units are stated on every
 * parameter (mm, m, m², kg, min, s, N, €). Money is EUR, unrounded.
 *
 * The only constants allowed in this file are FORMULA constants quoted
 * from the spec: the 1.42 air-bending factor, the 2.5 × t hole-to-bend
 * distance, the 10 × t slow-contour rule, the 2 mm flange margin and the
 * two faces of a powder-coated sheet. Machine capacities and prices never
 * live here — they come from the RateSnapshot / MachinePark passed to
 * the engine (CLAUDE.md "Engines are pure").
 *
 * Inputs that would make the arithmetic meaningless (speed ≤ 0, qty ≤ 0,
 * V ≤ 0, pitch ≤ 0, non-finite numbers) throw a PricingError rather than
 * returning NaN/Infinity that would silently poison a quote.
 */

import { PricingError } from "./errors";

/* ─── Formula constants from the spec ─────────────────────── */

/** Spec §8.1 / build prompt Step 6.7: interior contours with max side < 10 × t cut slowly. */
export const SLOW_CONTOUR_THICKNESS_MULTIPLIER = 10;

/** Spec §8.3: hole edge to bend line must be ≥ 2.5 × t (amber below). */
export const HOLE_TO_BEND_THICKNESS_MULTIPLIER = 2.5;

/** Build prompt Step 9: minimum flange = V/2 + r + 2 mm. */
export const MIN_FLANGE_MARGIN_MM = 2;

/** Spec §8.3: air-bending force F = 1.42 × Rm × t² × L / V (N). */
export const AIR_BENDING_FACTOR = 1.42;

/** Build prompt Step 9: powder coating covers both faces → net area × 2. */
export const POWDER_COAT_FACES = 2;

/* ─── Guards ──────────────────────────────────────────────── */

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new PricingError("invalid_input", `${name} must be a finite number, got ${String(value)}`, {
      field: name,
      value: Number.isNaN(value) ? "NaN" : String(value),
    });
  }
}

function assertPositive(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) {
    throw new PricingError("invalid_input", `${name} must be > 0, got ${value}`, {
      field: name,
      value,
    });
  }
}

/* ─── Unit helpers ────────────────────────────────────────── */

export function mmToM(mm: number): number {
  return mm / 1000;
}

export function mm2ToM2(mm2: number): number {
  return mm2 / 1_000_000;
}

/* ─── Slow contours / thresholds ──────────────────────────── */

/** Contours with a bbox max side below this (mm) cut at the slow factor. */
export function slowContourThresholdMm(thicknessMm: number): number {
  return SLOW_CONTOUR_THICKNESS_MULTIPLIER * thicknessMm;
}

/** Minimum hole-edge-to-bend-line distance (mm) before the amber warning. */
export function minHoleToBendMm(thicknessMm: number): number {
  return HOLE_TO_BEND_THICKNESS_MULTIPLIER * thicknessMm;
}

/* ─── Laser cutting ───────────────────────────────────────── */

/**
 * Cut length with slow contours weighted by the slow factor. `slowLengthM`
 * is the part of `cutLengthM` that belongs to slow contours (it is NOT
 * added on top): adjusted = cutLength + slowLength × (factor − 1).
 */
export function adjustedCutLengthM(
  cutLengthM: number,
  slowLengthM: number,
  slowFactor: number
): number {
  assertFinite("cutLengthM", cutLengthM);
  assertFinite("slowLengthM", slowLengthM);
  assertFinite("slowFactor", slowFactor);
  return cutLengthM + slowLengthM * (slowFactor - 1);
}

/**
 * Laser cut time in minutes (mode "time"):
 * adjustedCutLengthM / speedMMin + pierces × pierceS / 60.
 */
export function laserCutTimeMin(
  cutLengthM: number,
  speedMMin: number,
  pierces: number,
  pierceS: number,
  slowLengthM = 0,
  slowFactor = 1
): number {
  assertPositive("speedMMin", speedMMin);
  assertFinite("pierces", pierces);
  assertFinite("pierceS", pierceS);
  const adjusted = adjustedCutLengthM(cutLengthM, slowLengthM, slowFactor);
  return adjusted / speedMMin + (pierces * pierceS) / 60;
}

/** Mode "time": cutTimeMin / 60 × machine rate (€/h) + pierces × €/pierce. */
export function laserTimeCost(
  cutTimeMin: number,
  machineRateEurH: number,
  pierces: number,
  pricePerPierce: number
): number {
  assertFinite("cutTimeMin", cutTimeMin);
  assertFinite("machineRateEurH", machineRateEurH);
  return (cutTimeMin / 60) * machineRateEurH + pierces * pricePerPierce;
}

/** Mode "per_m" (also supplier rows): adjustedCutLengthM × €/m + pierces × €/pierce. */
export function laserPerMCost(
  adjustedCutLengthMValue: number,
  pricePerM: number,
  pierces: number,
  pricePerPierce: number
): number {
  assertFinite("adjustedCutLengthM", adjustedCutLengthMValue);
  assertFinite("pricePerM", pricePerM);
  return adjustedCutLengthMValue * pricePerM + pierces * pricePerPierce;
}

/* ─── Material ────────────────────────────────────────────── */

/** Blank mass (kg) = L × W × t (mm³) × density (kg/m³) × 1e-9. */
export function blankMassKg(
  blankLengthMm: number,
  blankWidthMm: number,
  thicknessMm: number,
  densityKgM3: number
): number {
  assertFinite("blankLengthMm", blankLengthMm);
  assertFinite("blankWidthMm", blankWidthMm);
  assertFinite("thicknessMm", thicknessMm);
  assertFinite("densityKgM3", densityKgM3);
  return blankLengthMm * blankWidthMm * thicknessMm * densityKgM3 * 1e-9;
}

/** Mass (kg) of a flat area (mm²) at thickness t (mm) — the part's net mass. */
export function areaMassKg(areaMm2: number, thicknessMm: number, densityKgM3: number): number {
  assertFinite("areaMm2", areaMm2);
  assertFinite("thicknessMm", thicknessMm);
  assertFinite("densityKgM3", densityKgM3);
  return areaMm2 * thicknessMm * densityKgM3 * 1e-9;
}

/** Material cost = mass × (1 + scrap %/100) × €/kg. */
export function materialCost(massKg: number, scrapPct: number, pricePerKg: number): number {
  assertFinite("massKg", massKg);
  assertFinite("scrapPct", scrapPct);
  assertFinite("pricePerKg", pricePerKg);
  return massKg * (1 + scrapPct / 100) * pricePerKg;
}

/* ─── Press brake ─────────────────────────────────────────── */

/** Default V-die opening = dieFactor × t (dieFactor from the press-brake limits, 8 in the seed). */
export function defaultDieVMm(thicknessMm: number, dieFactor: number): number {
  assertPositive("thicknessMm", thicknessMm);
  assertPositive("dieFactor", dieFactor);
  return dieFactor * thicknessMm;
}

/** Air-bending force (N) = 1.42 × Rm (N/mm²) × t² × L / V (all mm). */
export function bendForceN(
  rmNmm2: number,
  thicknessMm: number,
  bendLengthMm: number,
  dieVMm: number
): number {
  assertFinite("rmNmm2", rmNmm2);
  assertFinite("thicknessMm", thicknessMm);
  assertFinite("bendLengthMm", bendLengthMm);
  assertPositive("dieVMm", dieVMm);
  return (AIR_BENDING_FACTOR * rmNmm2 * thicknessMm * thicknessMm * bendLengthMm) / dieVMm;
}

/** Minimum flange (mm) = V/2 + inside radius + 2 mm. */
export function minFlangeMm(dieVMm: number, insideRadiusMm: number): number {
  assertFinite("dieVMm", dieVMm);
  assertFinite("insideRadiusMm", insideRadiusMm);
  return dieVMm / 2 + insideRadiusMm + MIN_FLANGE_MARGIN_MM;
}

/* ─── Setup spreading ─────────────────────────────────────── */

/** Setup cost per part = setup / qty (batch price breaks fall out of this). */
export function setupShare(setup: number, qty: number): number {
  assertFinite("setup", setup);
  assertPositive("qty", qty);
  return setup / qty;
}

/* ─── Rolling ─────────────────────────────────────────────── */

/** Rolling unit cost = setup / qty + €/m × roll-axis length (m). */
export function rollCost(
  setup: number,
  qty: number,
  pricePerM: number,
  axisLengthM: number
): number {
  assertFinite("pricePerM", pricePerM);
  assertFinite("axisLengthM", axisLengthM);
  return setupShare(setup, qty) + pricePerM * axisLengthM;
}

/* ─── Welding ─────────────────────────────────────────────── */

export type StitchPattern = { beadLengthMm: number; pitchMm: number };

/**
 * Effective weld length (mm) = length × (bead/pitch for stitch, else 1) × sides.
 * A stitch pattern with bead ≥ pitch is a continuous weld (ratio capped at 1).
 */
export function weldEffectiveLengthMm(
  lengthMm: number,
  pattern: "full" | "stitch",
  stitch: StitchPattern | null,
  sides: 1 | 2
): number {
  assertFinite("lengthMm", lengthMm);
  let ratio = 1;
  if (pattern === "stitch") {
    if (!stitch) {
      throw new PricingError("invalid_input", "stitch pattern requires bead length and pitch", {
        field: "stitch",
        value: null,
      });
    }
    assertPositive("stitch.pitchMm", stitch.pitchMm);
    assertFinite("stitch.beadLengthMm", stitch.beadLengthMm);
    ratio = Math.min(1, Math.max(0, stitch.beadLengthMm / stitch.pitchMm));
  }
  return lengthMm * ratio * sides;
}

/** Weld cost = effective length (mm) × €/mm. Sides are already inside the effective length. */
export function weldCost(effectiveLengthMm: number, pricePerMm: number): number {
  assertFinite("effectiveLengthMm", effectiveLengthMm);
  assertFinite("pricePerMm", pricePerMm);
  return effectiveLengthMm * pricePerMm;
}

/* ─── Threads, features, machining ────────────────────────── */

/** Threads / features: count × €/each. */
export function countCost(count: number, priceEach: number): number {
  assertFinite("count", count);
  assertFinite("priceEach", priceEach);
  return count * priceEach;
}

/** Machining: minutes / 60 × machining rate (€/h). */
export function machiningCost(minutes: number, machiningRateEurH: number): number {
  assertFinite("minutes", minutes);
  assertFinite("machiningRateEurH", machiningRateEurH);
  return (minutes / 60) * machiningRateEurH;
}

/* ─── Finishing ───────────────────────────────────────────── */

/** Powder coat per part = net area (m²) × 2 faces × €/m² + masking min / 60 × labour €/h. */
export function powderCoatUnitCost(
  netAreaM2: number,
  pricePerM2: number,
  maskingMinutes: number,
  labourRateEurH: number
): number {
  assertFinite("netAreaM2", netAreaM2);
  assertFinite("pricePerM2", pricePerM2);
  assertFinite("maskingMinutes", maskingMinutes);
  assertFinite("labourRateEurH", labourRateEurH);
  return netAreaM2 * POWDER_COAT_FACES * pricePerM2 + (maskingMinutes / 60) * labourRateEurH;
}

/** Zinc plating / galvanising per part = mass (kg) × €/kg. */
export function zincUnitCost(massKg: number, pricePerKg: number): number {
  assertFinite("massKg", massKg);
  assertFinite("pricePerKg", pricePerKg);
  return massKg * pricePerKg;
}

/** Deburring per part = cut length (m) × €/m. */
export function deburrCost(cutLengthM: number, pricePerM: number): number {
  assertFinite("cutLengthM", cutLengthM);
  assertFinite("pricePerM", pricePerM);
  return cutLengthM * pricePerM;
}

/** Engraving / marking per part = engraved length (m) × €/m. */
export function engraveCost(engraveLengthM: number, pricePerM: number): number {
  assertFinite("engraveLengthM", engraveLengthM);
  assertFinite("pricePerM", pricePerM);
  return engraveLengthM * pricePerM;
}

/**
 * Batch minimum for finishes (powder min 25 €, zinc min 30 € …): when
 * unitCost × qty falls below the minimum, the unit cost is raised so the
 * batch costs exactly the minimum.
 */
export function applyBatchMinimum(
  unitCost: number,
  qty: number,
  minimum: number
): { unitCost: number; batchCost: number; applied: boolean } {
  assertFinite("unitCost", unitCost);
  assertPositive("qty", qty);
  assertFinite("minimum", minimum);
  const batch = unitCost * qty;
  if (minimum > 0 && batch < minimum) {
    return { unitCost: minimum / qty, batchCost: minimum, applied: true };
  }
  return { unitCost, batchCost: batch, applied: false };
}
