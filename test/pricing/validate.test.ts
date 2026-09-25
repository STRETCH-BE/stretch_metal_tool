/**
 * Input validation — review finding "manual extras are never validated":
 * NaN / Infinity / negative numbers typed into an extra, an annotation or
 * a welding-only seam must throw PricingError("invalid_input") naming the
 * field, never flow into unitCost or the subtotals. Every probe from the
 * review is reproduced here through priceQuote() first, then the
 * validators are exercised field by field.
 * File path: /test/pricing/validate.test.ts
 */

import { describe, expect, it } from "vitest";
import { PricingError } from "@/lib/pricing/errors";
import { evaluatePartFlags } from "@/lib/pricing/feasibility";
import { buildItemOperations } from "@/lib/pricing/operations";
import { priceQuote } from "@/lib/pricing/price-quote";
import type { ExtraOperation, PricingItem, QuoteInput, WeldingOnlySeam } from "@/lib/pricing/types";
import {
  validatePartAnnotations,
  validatePricingItem,
  validateWeldingOnly,
  validateWeldingOnlySeam,
} from "@/lib/pricing/validate";
import { makeAnnotations, makeRectPartGeometry } from "@/test/helpers/geometry";
import { make200164Like } from "@/test/helpers/parts";
import { makeItem, makePricingPart, makeQuoteInput } from "@/test/helpers/quote";
import { MACHINE_PARK, RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";

const part = () => makePricingPart({ id: "p1", geometry: make200164Like(), materialCode: "DC01", thicknessMm: 2 });

function quoteWith(extras: ExtraOperation[], itemOverrides: Partial<PricingItem> = {}): QuoteInput {
  return makeQuoteInput({
    parts: [part()],
    items: [makeItem({ id: "i1", partId: "p1", extras, ...itemOverrides })],
  });
}

/** Runs fn and returns the PricingError it threw (fails the test when it does not throw). */
function caught(fn: () => unknown): PricingError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PricingError);
    return e as PricingError;
  }
  throw new Error("expected a PricingError");
}

describe("review probes through priceQuote (no NaN / Infinity / negative price ever comes out)", () => {
  it('{type:"other", unitCost: NaN} → invalid_input, not a NaN subtotal', () => {
    const e = caught(() => priceQuote(quoteWith([{ type: "other", label: "x", unitCost: Number.NaN }]), RATE_SNAPSHOT_V1, MACHINE_PARK));
    expect(e.code).toBe("invalid_input");
    expect(e.details).toMatchObject({ itemId: "i1", index: 0, type: "other", field: "unitCost", value: "NaN" });
  });

  it('{type:"handling", unitCost: Infinity} → invalid_input', () => {
    const e = caught(() => priceQuote(quoteWith([{ type: "handling", unitCost: Number.POSITIVE_INFINITY }]), RATE_SNAPSHOT_V1, MACHINE_PARK));
    expect(e.code).toBe("invalid_input");
    expect(e.details).toMatchObject({ itemId: "i1", index: 0, type: "handling", field: "unitCost", value: "Infinity" });
  });

  it('{type:"tube_cut", metres: NaN} → invalid_input', () => {
    const e = caught(() =>
      priceQuote(
        quoteWith([{ type: "tube_cut", profileFamily: "round", wallMm: 3, cutLengthMm: 500, metres: Number.NaN, pricePerMTube: 5 }]),
        RATE_SNAPSHOT_V1,
        MACHINE_PARK
      )
    );
    expect(e.code).toBe("invalid_input");
    expect(e.details).toMatchObject({ itemId: "i1", index: 0, type: "tube_cut", field: "metres" });
  });

  it('{type:"feature", count: -3} → invalid_input (a negative feature count would lower the quote)', () => {
    const e = caught(() => priceQuote(quoteWith([{ type: "feature", code: "countersink", count: -3 }]), RATE_SNAPSHOT_V1, MACHINE_PARK));
    expect(e.code).toBe("invalid_input");
    expect(e.details).toMatchObject({ itemId: "i1", index: 0, type: "feature", field: "count", value: -3 });
  });

  it("the extra index is reported, so a form can point at the right row", () => {
    const e = caught(() =>
      priceQuote(
        quoteWith([
          { type: "other", label: "crate", unitCost: 4 },
          { type: "machining", minutes: 10, note: null },
          { type: "finish", code: "powder", maskingMinutes: -1, note: null },
        ]),
        RATE_SNAPSHOT_V1,
        MACHINE_PARK
      )
    );
    expect(e.details).toMatchObject({ index: 2, type: "finish", field: "maskingMinutes", value: -1 });
  });

  it("a negative scrap override is rejected (it would discount the material below its mass)", () => {
    const e = caught(() => priceQuote(quoteWith([], { scrapPct: -100 }), RATE_SNAPSHOT_V1, MACHINE_PARK));
    expect(e.code).toBe("invalid_input");
    expect(e.details).toMatchObject({ itemId: "i1", field: "scrapPct", value: -100 });
  });

  it("a negative welding-only seam length is rejected instead of producing a negative weld cost", () => {
    const seam: WeldingOnlySeam = { id: "s1", label: "seam", process: "mig_mag", beadMm: 4, lengthMm: -500, pattern: "full", stitch: null, sides: 1, qty: 1 };
    const e = caught(() =>
      priceQuote(makeQuoteInput({ type: "welding_only", weldingOnly: { seams: [seam], partsCount: 1 } }), RATE_SNAPSHOT_V1, MACHINE_PARK)
    );
    expect(e.code).toBe("invalid_input");
    expect(e.details).toMatchObject({ seamId: "s1", field: "lengthMm", value: -500 });
  });

  it("a negative weld annotation length or roll axis is rejected (both multiply straight into a cost)", () => {
    const weldPart = {
      ...part(),
      annotations: makeAnnotations({
        welds: [{ id: "w1", entityIds: [], points: null, lengthMm: -100, process: "mig_mag", beadMm: 4, pattern: "full", stitch: null, sides: 1, effectiveLengthMm: -100 }],
      }),
    };
    const e1 = caught(() => priceQuote(makeQuoteInput({ parts: [weldPart], items: [makeItem({ id: "i1", partId: "p1" })] }), RATE_SNAPSHOT_V1, MACHINE_PARK));
    expect(e1.code).toBe("invalid_input");
    expect(e1.details).toMatchObject({ partId: "p1", weldId: "w1", field: "lengthMm", value: -100 });

    const rollPart = {
      ...part(),
      annotations: makeAnnotations({
        roll: { radiusMm: 500, axis: "x", arcAngleDeg: 90, axisLengthMm: Number.NaN, developedWidthMm: 500, cone: null },
      }),
    };
    const e2 = caught(() => evaluatePartFlags(rollPart, makeItem({ partId: "p1" }), RATE_SNAPSHOT_V1, MACHINE_PARK));
    expect(e2.details).toMatchObject({ partId: "p1", field: "roll.axisLengthMm", value: "NaN" });
  });

  it("valid extras still price exactly as before (zero is allowed everywhere)", () => {
    const priced = priceQuote(
      quoteWith([
        { type: "other", label: "x", unitCost: 0 },
        { type: "handling", unitCost: 0 },
        { type: "feature", code: "countersink", count: 0 },
        { type: "machining", minutes: 0, note: null },
        { type: "finish", code: "deburr", maskingMinutes: 0, note: null },
      ]),
      RATE_SNAPSHOT_V1,
      MACHINE_PARK
    );
    expect(Number.isFinite(priced.subtotalPrice)).toBe(true);
    expect(priced.items[0].operations.filter((o) => !o.auto)).toHaveLength(5);
  });
});

describe("validatePricingItem", () => {
  const item = (over: Partial<PricingItem>): PricingItem => makeItem({ partId: "p", ...over });

  it("qty must be a finite number > 0 (code invalid_qty, as before)", () => {
    for (const qty of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const e = caught(() => validatePricingItem(item({ qty })));
      expect(e.code).toBe("invalid_qty");
      expect(e.details.itemId).toBe("item-1");
    }
    expect(() => validatePricingItem(item({ qty: 1 }))).not.toThrow();
    expect(() => validatePricingItem(item({ qty: 250 }))).not.toThrow();
  });

  it("scrapPct: null or a finite number ≥ 0", () => {
    expect(() => validatePricingItem(item({ scrapPct: null }))).not.toThrow();
    expect(() => validatePricingItem(item({ scrapPct: 0 }))).not.toThrow();
    expect(() => validatePricingItem(item({ scrapPct: 12.5 }))).not.toThrow();
    expect(caught(() => validatePricingItem(item({ scrapPct: Number.NaN }))).details.field).toBe("scrapPct");
    expect(caught(() => validatePricingItem(item({ scrapPct: -1 }))).details.field).toBe("scrapPct");
  });

  const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.01, -3];

  it("every numeric field of every extra: finite and ≥ 0", () => {
    const cases: Array<[ExtraOperation, string]> = [];
    for (const v of bad) {
      cases.push([{ type: "machining", minutes: v, note: null }, "minutes"]);
      cases.push([{ type: "feature", code: "countersink", count: v }, "count"]);
      cases.push([{ type: "finish", code: "powder", maskingMinutes: v, note: null }, "maskingMinutes"]);
      cases.push([{ type: "other", label: "x", unitCost: v }, "unitCost"]);
      cases.push([{ type: "handling", unitCost: v }, "unitCost"]);
      const tube = { type: "tube_cut" as const, profileFamily: "round" as const, wallMm: 3, cutLengthMm: 500, metres: 2, pricePerMTube: 5 };
      cases.push([{ ...tube, wallMm: v }, "wallMm"]);
      cases.push([{ ...tube, cutLengthMm: v }, "cutLengthMm"]);
      cases.push([{ ...tube, metres: v }, "metres"]);
      cases.push([{ ...tube, pricePerMTube: v }, "pricePerMTube"]);
      cases.push([{ ...tube, envelopeMm: v }, "envelopeMm"]);
      cases.push([{ ...tube, circumscribedMm: v }, "circumscribedMm"]);
      cases.push([{ ...tube, kgPerM: v }, "kgPerM"]);
    }
    for (const [extra, field] of cases) {
      const e = caught(() => validatePricingItem(item({ extras: [extra] })));
      expect(e.code, `${extra.type}.${field}`).toBe("invalid_input");
      expect(e.details, `${extra.type}.${field}`).toMatchObject({ itemId: "item-1", index: 0, type: extra.type, field });
    }
  });

  it("feature count must be an integer", () => {
    const e = caught(() => validatePricingItem(item({ extras: [{ type: "feature", code: "countersink", count: 2.5 }] })));
    expect(e.details).toMatchObject({ field: "count", value: 2.5 });
    expect(() => validatePricingItem(item({ extras: [{ type: "feature", code: "countersink", count: 2 }] }))).not.toThrow();
  });

  it("optional tube fields may be null or undefined", () => {
    const tube: ExtraOperation = { type: "tube_cut", profileFamily: "square", wallMm: 0, cutLengthMm: 0, metres: 0, pricePerMTube: null };
    expect(() => validatePricingItem(item({ extras: [tube] }))).not.toThrow();
    expect(() => validatePricingItem(item({ extras: [{ ...tube, envelopeMm: null, circumscribedMm: undefined, kgPerM: 12 }] }))).not.toThrow();
  });

  it("buildItemOperations validates too (the client preview path)", () => {
    const e = caught(() =>
      buildItemOperations(part(), item({ partId: "p1", extras: [{ type: "other", label: "x", unitCost: -5 }] }), RATE_SNAPSHOT_V1, MACHINE_PARK)
    );
    expect(e.details).toMatchObject({ field: "unitCost", value: -5 });
  });
});

describe("validatePartAnnotations", () => {
  const weld = (over: Partial<ReturnType<typeof makeAnnotations>["welds"][number]>) => ({
    id: "w",
    entityIds: [],
    points: null,
    lengthMm: 100,
    process: "mig_mag" as const,
    beadMm: 4,
    pattern: "full" as const,
    stitch: null,
    sides: 1 as const,
    effectiveLengthMm: 100,
    ...over,
  });

  it("weld seams: length and bead ≥ 0, stitch bead ≥ 0 and pitch > 0, sides 1 or 2", () => {
    const ok = makeAnnotations({ welds: [weld({ pattern: "stitch", stitch: { beadLengthMm: 30, pitchMm: 60 }, sides: 2 })] });
    expect(() => validatePartAnnotations("p", ok)).not.toThrow();
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ welds: [weld({ lengthMm: -1 })] }))).details).toMatchObject({ partId: "p", weldId: "w", field: "lengthMm" });
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ welds: [weld({ beadMm: Number.NaN })] }))).details.field).toBe("beadMm");
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ welds: [weld({ stitch: { beadLengthMm: -30, pitchMm: 60 } })] }))).details.field).toBe("stitch.beadLengthMm");
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ welds: [weld({ stitch: { beadLengthMm: 30, pitchMm: 0 } })] }))).details.field).toBe("stitch.pitchMm");
    const threeSides = makeAnnotations({ welds: [weld({ sides: 3 as unknown as 1 })] });
    expect(caught(() => validatePartAnnotations("p", threeSides)).details.field).toBe("sides");
  });

  it("bends: finite geometry, radius and die ≥ 0 when given", () => {
    const bend = (over: Partial<ReturnType<typeof makeAnnotations>["bends"][number]>) => ({
      id: "b",
      entityId: null,
      start: { x: 0, y: 0 },
      end: { x: 0, y: 50 },
      lengthMm: 50,
      angleDeg: 90,
      radiusMm: null,
      direction: "up" as const,
      dieVMm: null,
      ...over,
    });
    expect(() => validatePartAnnotations("p", makeAnnotations({ bends: [bend({ radiusMm: 2, dieVMm: 16 })] }))).not.toThrow();
    // a stored length ≤ 0 is recomputed from the endpoints, so only non-finite is rejected
    expect(() => validatePartAnnotations("p", makeAnnotations({ bends: [bend({ lengthMm: 0 })] }))).not.toThrow();
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ bends: [bend({ lengthMm: Number.NaN })] }))).details).toMatchObject({ partId: "p", bendId: "b", field: "lengthMm" });
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ bends: [bend({ radiusMm: -1 })] }))).details.field).toBe("radiusMm");
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ bends: [bend({ dieVMm: Number.POSITIVE_INFINITY })] }))).details.field).toBe("dieVMm");
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ bends: [bend({ end: { x: Number.NaN, y: 0 } })] }))).details.field).toBe("end.x");
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ bends: [bend({ angleDeg: Number.NaN })] }))).details.field).toBe("angleDeg");
  });

  it("roll: radius, axis length and developed width ≥ 0, cone radii ≥ 0", () => {
    const roll = { radiusMm: 500, axis: "x" as const, arcAngleDeg: 90, axisLengthMm: 1000, developedWidthMm: 500, cone: null };
    expect(() => validatePartAnnotations("p", makeAnnotations({ roll }))).not.toThrow();
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ roll: { ...roll, radiusMm: -200 } }))).details.field).toBe("roll.radiusMm");
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ roll: { ...roll, axisLengthMm: -1 } }))).details.field).toBe("roll.axisLengthMm");
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ roll: { ...roll, developedWidthMm: Number.NaN } }))).details.field).toBe("roll.developedWidthMm");
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ roll: { ...roll, arcAngleDeg: Number.NaN } }))).details.field).toBe("roll.arcAngleDeg");
    const cone = { ...roll, cone: { innerRadiusMm: 100, outerRadiusMm: -1, sweepDeg: 90 } };
    expect(caught(() => validatePartAnnotations("p", makeAnnotations({ roll: cone }))).details.field).toBe("roll.cone.outerRadiusMm");
  });

  it("the empty annotations are valid", () => {
    expect(() => validatePartAnnotations("p", makeAnnotations())).not.toThrow();
    const geometry = makeRectPartGeometry({ lengthMm: 10, widthMm: 10, thicknessMm: 1, densityKgM3: 7850 });
    expect(() => validatePartAnnotations("p", makePricingPart({ geometry }).annotations)).not.toThrow();
  });
});

describe("validateWeldingOnly", () => {
  const seam = (over: Partial<WeldingOnlySeam> = {}): WeldingOnlySeam => ({
    id: "s1",
    label: "seam",
    process: "tig",
    beadMm: 4,
    lengthMm: 500,
    pattern: "full",
    stitch: null,
    sides: 1,
    qty: 1,
    ...over,
  });

  it("seam qty > 0 keeps the invalid_qty code; numbers finite and ≥ 0", () => {
    expect(caught(() => validateWeldingOnlySeam(seam({ qty: 0 }))).code).toBe("invalid_qty");
    expect(caught(() => validateWeldingOnlySeam(seam({ qty: Number.NaN }))).details).toMatchObject({ seamId: "s1", qty: "NaN" });
    expect(caught(() => validateWeldingOnlySeam(seam({ lengthMm: Number.NEGATIVE_INFINITY }))).details).toMatchObject({ seamId: "s1", field: "lengthMm", value: "-Infinity" });
    expect(caught(() => validateWeldingOnlySeam(seam({ beadMm: -4 }))).details.field).toBe("beadMm");
    expect(caught(() => validateWeldingOnlySeam(seam({ pattern: "stitch", stitch: { beadLengthMm: 30, pitchMm: -60 } }))).details.field).toBe("stitch.pitchMm");
    expect(caught(() => validateWeldingOnlySeam(seam({ sides: 0 as unknown as 1 }))).details.field).toBe("sides");
    expect(() => validateWeldingOnlySeam(seam({ pattern: "stitch", stitch: { beadLengthMm: 30, pitchMm: 60 }, sides: 2, qty: 12 }))).not.toThrow();
  });

  it("partsCount is a non-negative integer", () => {
    expect(() => validateWeldingOnly({ seams: [seam()], partsCount: 0 })).not.toThrow();
    expect(caught(() => validateWeldingOnly({ seams: [seam()], partsCount: -1 })).details.field).toBe("partsCount");
    expect(caught(() => validateWeldingOnly({ seams: [seam()], partsCount: 1.5 })).details.field).toBe("partsCount");
    expect(caught(() => validateWeldingOnly({ seams: [seam({ lengthMm: -1 })], partsCount: 1 })).details.field).toBe("lengthMm");
  });
});
