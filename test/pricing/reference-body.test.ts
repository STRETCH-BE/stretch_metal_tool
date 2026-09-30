/**
 * Reference bodies (lib/pricing/reference-body.ts): the rule table row by
 * row, the flags evaluatePartFlags raises from a sheet report's body hints
 * against the laser bed, and the red body left out of the totals in cost
 * and market mode.
 * File path: /test/pricing/reference-body.test.ts
 */
import { describe, expect, it } from "vitest";
import type { BodyHints, PartGeometry, SheetReport } from "@/lib/geometry/types";
import { evaluatePartFlags } from "@/lib/pricing/feasibility";
import { priceQuote } from "@/lib/pricing";
import { referenceBodyVerdict } from "@/lib/pricing/reference-body";
import { canSend } from "@/lib/quotes/send-guard";
import { makeRectPartGeometry } from "@/test/helpers/geometry";
import { makeItem, makePricingPart, makeQuoteInput } from "@/test/helpers/quote";
import { MACHINE_PARK, RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";

const BED = 3000;

function hints(over: Partial<BodyHints> = {}): BodyHints {
  return { featureName: null, solidBlock: false, sliver: false, notSheet: false, bboxMm: [640, 230, 50], volumeMm3: 7_360_000, ...over };
}

function sheet(bodyHints: BodyHints, isSheetMetal = true): SheetReport {
  return {
    version: 1,
    thicknessMm: 50,
    isSheetMetal,
    bends: [],
    hardware: [],
    studPositions: [],
    maskingZones: [],
    countersinks: [],
    blindPockets: [],
    helicalHoles: [],
    reliefs: [],
    solidVolumeMm3: null,
    flatVolumeMm3: 0,
    hardwareBodies: 0,
    productName: "Aufsatz-Linear austragen6[1]",
    bodyHints,
  };
}

describe("rule table", () => {
  const rows: [string, BodyHints, number | null, ReturnType<typeof referenceBodyVerdict>][] = [
    ["sliver", hints({ sliver: true, bboxMm: [12, 6, 0.1], volumeMm3: 0.4 }), BED, { code: "geometry.reference_body", severity: "red" }],
    ["feature name + solid block (the 640 × 230 × 50 extrude)", hints({ featureName: "Aufsatz-Linear austragen", solidBlock: true }), BED, { code: "geometry.reference_body", severity: "red" }],
    ["feature name + not a sheet", hints({ featureName: "Cut-Extrude", notSheet: true, bboxMm: [300, 200, 100] }), BED, { code: "geometry.reference_body", severity: "red" }],
    ["solid block longer than the laser bed (3206 × 640 × 150)", hints({ solidBlock: true, bboxMm: [3206, 640, 150] }), BED, { code: "geometry.reference_body", severity: "red" }],
    ["not a sheet, longer than the bed", hints({ notSheet: true, bboxMm: [3206, 640, 150] }), BED, { code: "geometry.reference_body", severity: "red" }],
    ["feature name alone (the 2 mm logo plate named Schnitt-Linear austragen1)", hints({ featureName: "Schnitt-Linear austragen", bboxMm: [400, 300, 2] }), BED, { code: "geometry.unnamed_body", severity: "amber" }],
    ["solid block without a feature name", hints({ solidBlock: true }), BED, { code: "geometry.solid_block", severity: "amber" }],
    ["solid block longer than the bed but no laser in the park: amber only", hints({ solidBlock: true, bboxMm: [3206, 640, 150] }), null, { code: "geometry.solid_block", severity: "amber" }],
    ["a 10 mm base plate", hints({ bboxMm: [300, 200, 10] }), BED, null],
    ["a bent 2 mm part with a real name", hints({ bboxMm: [1200, 400, 90] }), BED, null],
    ["not a sheet, small, real name (a machined part): no reference flag", hints({ notSheet: true, bboxMm: [120, 80, 40] }), BED, null],
  ];
  for (const [name, h, bed, expected] of rows) {
    it(name, () => {
      expect(referenceBodyVerdict(h, bed)).toEqual(expected);
    });
  }
  it("no hints → no verdict", () => {
    expect(referenceBodyVerdict(undefined, BED)).toBeNull();
  });
});

function partWith(bodyHints: BodyHints): { geometry: PartGeometry } {
  const base = makeRectPartGeometry({ lengthMm: 640, widthMm: 230, thicknessMm: 50, densityKgM3: 7850, source: "step" });
  return { geometry: { ...base, sheet: sheet(bodyHints) } };
}

describe("flags", () => {
  it("raises the red flag (overridable, with name / size / feature params) for a feature-named block", () => {
    const part = makePricingPart({ ...partWith(hints({ featureName: "Aufsatz-Linear austragen", solidBlock: true })), name: "Aufsatz-Linear austragen6[1]" });
    const flags = evaluatePartFlags(part, makeItem({ partId: part.id }), RATE_SNAPSHOT_V1, MACHINE_PARK);
    const flag = flags.find((f) => f.code === "geometry.reference_body");
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("red");
    expect(flag?.overridable).toBe(true);
    expect(flag?.params).toMatchObject({ name: "Aufsatz-Linear austragen6[1]", featureName: "Aufsatz-Linear austragen", size: "640 × 230 × 50", thicknessMm: 50 });
    expect(flags.some((f) => f.code === "geometry.unnamed_body" || f.code === "geometry.solid_block")).toBe(false);
  });

  it("raises only the amber unnamed_body for a feature-named real-looking plate, and solid_block for an unnamed block", () => {
    const named = makePricingPart(partWith(hints({ featureName: "Schnitt-Linear austragen", bboxMm: [400, 300, 2] })));
    expect(evaluatePartFlags(named, makeItem({ partId: named.id }), RATE_SNAPSHOT_V1, MACHINE_PARK).filter((f) => f.code.startsWith("geometry.")).map((f) => [f.code, f.severity])).toEqual([["geometry.unnamed_body", "amber"]]);
    const block = makePricingPart(partWith(hints({ solidBlock: true })));
    expect(evaluatePartFlags(block, makeItem({ partId: block.id }), RATE_SNAPSHOT_V1, MACHINE_PARK).filter((f) => f.code.startsWith("geometry.")).map((f) => [f.code, f.severity])).toEqual([["geometry.solid_block", "amber"]]);
    const plate = makePricingPart(partWith(hints({ bboxMm: [300, 200, 10] })));
    expect(evaluatePartFlags(plate, makeItem({ partId: plate.id }), RATE_SNAPSHOT_V1, MACHINE_PARK).filter((f) => f.code.startsWith("geometry."))).toEqual([]);
  });

  it("leaves a red reference body out of the cost-mode total", () => {
    const real = makePricingPart({ ...partWith(hints({ bboxMm: [300, 200, 10] })), id: "real" });
    const helper = makePricingPart({ ...partWith(hints({ featureName: "Cut-Extrude", solidBlock: true })), id: "helper" });
    const alone = priceQuote(makeQuoteInput({ parts: [real], items: [makeItem({ id: "i1", partId: "real" })] }), RATE_SNAPSHOT_V1, MACHINE_PARK);
    const both = priceQuote(makeQuoteInput({ parts: [real, helper], items: [makeItem({ id: "i1", partId: "real" }), makeItem({ id: "i2", partId: "helper" })] }), RATE_SNAPSHOT_V1, MACHINE_PARK);
    const helperLine = both.items.find((i) => i.itemId === "i2");
    expect(helperLine?.unitPrice).toBeNull();
    expect(helperLine?.operations).toEqual([]);
    expect(helperLine?.flags.some((f) => f.code === "geometry.reference_body")).toBe(true);
    expect(both.subtotalPrice).toBeCloseTo(alone.subtotalPrice, 6);
  });
});

describe("send guard", () => {
  const redFlag = { code: "geometry.reference_body" as const, severity: "red" as const, partId: "p", itemId: "i", params: {}, overridable: true };
  const base = {
    quote: { status: "draft" } as never,
    customer: { name: "A", address: "B", customer_type: "b2b", email: "a@b.c" } as never,
    items: [{ id: "i" }] as never,
    flags: [redFlag],
    overrides: [] as never[],
    pricing: {} as never,
    weldingOnly: null,
    assemblies: [] as never[],
    company: null,
  };
  it("blocks a red reference body until an admin approves it as a real part", () => {
    expect(canSend(base as never).reasons).toContain("red_flags");
    const approved = { ...base, overrides: [{ status: "approved", rule_code: "geometry.reference_body", part_id: "p", item_id: "i", quote_id: "q", requested_by: "s", decided_by: "admin" }] as never };
    expect(canSend(approved as never).reasons).not.toContain("red_flags");
  });
});
