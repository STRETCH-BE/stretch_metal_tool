/**
 * Pricing engine — validation of the numbers a user types: quote items and
 * their extras, the part annotations the engine prices (welds, bends,
 * roll) and welding-only seams.
 * File path: /lib/pricing/validate.ts
 *
 * The formulas guard their own arithmetic (finite inputs, qty > 0, die
 * V > 0 …), but a manual number that is copied straight into a line — an
 * "other" lump sum, a handling cost, tube metres × €/m, a feature count —
 * never reached a formula, so NaN, Infinity or a negative value flowed into
 * unitCost and the subtotals unchecked (review finding). Every number the
 * engine multiplies into a price is therefore checked here, once, before
 * any line or flag is built (buildPartContext / priceWeldingOnly call
 * these): finite and ≥ 0; quantities > 0; counts integers. A failure throws
 * PricingError("invalid_input") (a bad qty keeps the code "invalid_qty")
 * whose `details` name the item / part / seam, the extra index and the
 * field, so a route handler can map it to a form error. Invalid input is
 * never a Flag: flags are for data a salesperson can act on.
 *
 * Deliberately rejected: negative "other" / "handling" lines as discounts.
 * A discount belongs in the margin, not in a cost line that would then be
 * marked up.
 *
 * Bend annotations: a stored lengthMm ≤ 0 is legal (context.ts recomputes
 * it from the endpoints) and angles/coordinates may be negative, so those
 * are only checked for finiteness.
 */

import type {
  BendAnnotation,
  PartAnnotations,
  RollAnnotation,
  WeldAnnotation,
} from "../geometry/types";
import { PricingError } from "./errors";
import type { ExtraOperation, PricingItem, QuoteInput, WeldingOnlySeam } from "./types";

type Scope = Record<string, number | string>;

type NumberRule = {
  /** Lower bound (default 0), inclusive unless `exclusive`. */
  min?: number;
  exclusive?: boolean;
  integer?: boolean;
  /** No lower bound at all — only finiteness is checked. */
  anySign?: boolean;
};

/** The offending value as it goes into PricingError.details (NaN / ±Infinity as strings). */
function describeValue(value: unknown): number | string | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : typeof value;
}

function assertNumber(
  where: string,
  scope: Scope,
  field: string,
  value: unknown,
  rule: NumberRule = {}
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    const min = rule.min ?? 0;
    const inRange = rule.anySign === true || (rule.exclusive === true ? value > min : value >= min);
    const integral = rule.integer !== true || Number.isInteger(value);
    if (inRange && integral) return;
  }
  const kind = rule.integer === true ? "an integer" : "a finite number";
  const bound = rule.anySign === true ? "" : ` ${rule.exclusive === true ? ">" : "≥"} ${rule.min ?? 0}`;
  throw new PricingError("invalid_input", `${where}: ${field} must be ${kind}${bound}, got ${String(value)}`, {
    ...scope,
    field,
    value: describeValue(value),
  });
}

function assertNumberOrNull(
  where: string,
  scope: Scope,
  field: string,
  value: unknown,
  rule: NumberRule = {}
): void {
  if (value === null || value === undefined) return;
  assertNumber(where, scope, field, value, rule);
}

function assertQty(where: string, scope: Scope, qty: unknown): void {
  if (typeof qty === "number" && Number.isFinite(qty) && qty > 0) return;
  throw new PricingError("invalid_qty", `${where}: qty must be > 0, got ${String(qty)}`, {
    ...scope,
    qty: describeValue(qty),
  });
}

function assertSides(where: string, scope: Scope, sides: unknown): void {
  if (sides === 1 || sides === 2) return;
  throw new PricingError("invalid_input", `${where}: sides must be 1 or 2, got ${String(sides)}`, {
    ...scope,
    field: "sides",
    value: describeValue(sides),
  });
}

function assertStitch(
  where: string,
  scope: Scope,
  stitch: { beadLengthMm: number; pitchMm: number } | null
): void {
  if (!stitch) return;
  assertNumber(where, scope, "stitch.beadLengthMm", stitch.beadLengthMm);
  assertNumber(where, scope, "stitch.pitchMm", stitch.pitchMm, { exclusive: true });
}

/* ─── Quote items and extras ──────────────────────────────── */

/** One extra of an item; `index` is its position in item.extras. */
export function validateExtraOperation(itemId: string, index: number, extra: ExtraOperation): void {
  const scope: Scope = { itemId, index, type: extra.type };
  const where = `item ${itemId} extra #${index} (${extra.type})`;
  const num = (field: string, value: unknown, rule?: NumberRule): void =>
    assertNumber(where, scope, field, value, rule);
  const opt = (field: string, value: unknown): void => assertNumberOrNull(where, scope, field, value);
  switch (extra.type) {
    case "machining":
      num("minutes", extra.minutes);
      return;
    case "feature":
      num("count", extra.count, { integer: true });
      return;
    case "finish":
      num("maskingMinutes", extra.maskingMinutes);
      return;
    case "tube_cut":
      num("wallMm", extra.wallMm);
      num("cutLengthMm", extra.cutLengthMm);
      num("metres", extra.metres);
      opt("pricePerMTube", extra.pricePerMTube);
      opt("envelopeMm", extra.envelopeMm);
      opt("circumscribedMm", extra.circumscribedMm);
      opt("kgPerM", extra.kgPerM);
      return;
    case "other":
      num("unitCost", extra.unitCost);
      return;
    case "handling":
      num("unitCost", extra.unitCost);
      return;
    default: {
      // Unreachable for typed callers; JSON from a form may still carry an unknown type.
      const type = (extra as { type?: unknown }).type;
      throw new PricingError("invalid_input", `${where}: unknown extra type ${String(type)}`, {
        itemId,
        index,
        field: "type",
        value: describeValue(type),
      });
    }
  }
}

/** qty (> 0), the scrap override (≥ 0 or null) and every extra of a quote item. */
export function validatePricingItem(item: PricingItem): void {
  const where = `item ${item.id}`;
  assertQty(where, { itemId: item.id }, item.qty);
  assertNumberOrNull(where, { itemId: item.id }, "scrapPct", item.scrapPct);
  item.extras.forEach((extra, index) => validateExtraOperation(item.id, index, extra));
}

/* ─── Part annotations ────────────────────────────────────── */

function validateWeld(partId: string, index: number, weld: WeldAnnotation): void {
  const scope: Scope = { partId, weldId: weld.id, index };
  const where = `part ${partId} weld ${weld.id}`;
  assertNumber(where, scope, "lengthMm", weld.lengthMm);
  assertNumber(where, scope, "beadMm", weld.beadMm);
  assertSides(where, scope, weld.sides);
  assertStitch(where, scope, weld.stitch);
}

function validateBend(partId: string, index: number, bend: BendAnnotation): void {
  const scope: Scope = { partId, bendId: bend.id, index };
  const where = `part ${partId} bend ${bend.id}`;
  const any: NumberRule = { anySign: true };
  assertNumber(where, scope, "start.x", bend.start.x, any);
  assertNumber(where, scope, "start.y", bend.start.y, any);
  assertNumber(where, scope, "end.x", bend.end.x, any);
  assertNumber(where, scope, "end.y", bend.end.y, any);
  assertNumber(where, scope, "lengthMm", bend.lengthMm, any);
  assertNumber(where, scope, "angleDeg", bend.angleDeg, any);
  assertNumberOrNull(where, scope, "radiusMm", bend.radiusMm);
  assertNumberOrNull(where, scope, "dieVMm", bend.dieVMm);
}

function validateRoll(partId: string, roll: RollAnnotation): void {
  const scope: Scope = { partId };
  const where = `part ${partId} roll`;
  assertNumber(where, scope, "roll.radiusMm", roll.radiusMm);
  assertNumber(where, scope, "roll.axisLengthMm", roll.axisLengthMm);
  assertNumber(where, scope, "roll.developedWidthMm", roll.developedWidthMm);
  assertNumber(where, scope, "roll.arcAngleDeg", roll.arcAngleDeg, { anySign: true });
  if (roll.cone) {
    assertNumber(where, scope, "roll.cone.innerRadiusMm", roll.cone.innerRadiusMm);
    assertNumber(where, scope, "roll.cone.outerRadiusMm", roll.cone.outerRadiusMm);
    assertNumber(where, scope, "roll.cone.sweepDeg", roll.cone.sweepDeg, { anySign: true });
  }
}

/** The annotation numbers the engine prices or checks: welds, bends, roll. */
export function validatePartAnnotations(partId: string, annotations: PartAnnotations): void {
  annotations.welds.forEach((weld, index) => validateWeld(partId, index, weld));
  annotations.bends.forEach((bend, index) => validateBend(partId, index, bend));
  if (annotations.roll) validateRoll(partId, annotations.roll);
}

/* ─── Welding-only quotes ─────────────────────────────────── */

export function validateWeldingOnlySeam(seam: WeldingOnlySeam): void {
  const scope: Scope = { seamId: seam.id };
  const where = `seam ${seam.id}`;
  assertQty(where, scope, seam.qty);
  assertNumber(where, scope, "lengthMm", seam.lengthMm);
  assertNumber(where, scope, "beadMm", seam.beadMm);
  assertSides(where, scope, seam.sides);
  assertStitch(where, scope, seam.stitch);
}

/** partsCount (integer ≥ 0) and every seam of the welding-only block. */
export function validateWeldingOnly(block: NonNullable<QuoteInput["weldingOnly"]>): void {
  assertNumber("welding-only block", {}, "partsCount", block.partsCount, { integer: true });
  for (const seam of block.seams) validateWeldingOnlySeam(seam);
}
