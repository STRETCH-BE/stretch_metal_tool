/**
 * DFM checks on sheet parts (lib/pricing/dfm.ts) against flat patterns
 * built in code: an L bracket with a 0.1 mm relief, a hole 3 mm from a
 * bend in 2 mm steel, a 4 mm flange, a U channel that needs a tall punch,
 * countersinks, a mass mismatch, and the drawing cross-checks.
 * File path: /test/pricing/dfm.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyzeDxfSync } from "@/lib/geometry";
import { detectReliefs } from "@/lib/geometry/step/reliefs";
import type { PartGeometry, SheetBend, SheetReport } from "@/lib/geometry/types";
import { evaluateDfmFlags, type DfmInput } from "@/lib/pricing/dfm";
import type { PressBrakeTool } from "@/lib/pricing/types";
import { buildDxf, circle, line, type EntitySpec } from "../geometry/dxf-builder";

const T = 2;
const R = 1;
const BA = 2.355;

/** A bend strip of the flat between two parallel lines, `x0` = base tangent, along y from 0 to L. */
function bend(id: string, x0: number, L: number, direction: "up" | "down" = "up", flangeOutsideMm = 50, baseFlangeOutsideMm = 100, from = 0, to = 1): SheetBend {
  return {
    id,
    start: { x: x0 + BA / 2, y: 0 },
    end: { x: x0 + BA / 2, y: L },
    lengthMm: L,
    angleDeg: 90,
    innerRadiusMm: R,
    allowanceMm: BA,
    allowanceSource: "din6935_formula",
    direction,
    strip: { a1: { x: x0, y: 0 }, a2: { x: x0, y: L }, t1: { x: x0 + BA, y: 0 }, t2: { x: x0 + BA, y: L } },
    flangeOutsideMm,
    baseFlangeOutsideMm,
    fromFlange: from,
    toFlange: to,
  };
}

function report(over: Partial<SheetReport> = {}): SheetReport {
  return {
    version: 1,
    thicknessMm: T,
    isSheetMetal: true,
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
    productName: null,
    ...over,
  };
}

function input(geometry: PartGeometry, sheet: SheetReport, tools: PressBrakeTool[] = TOOLS): DfmInput {
  return { partId: "p", itemId: "i", geometry, sheet, thicknessMm: T, kerfMm: null, tools };
}

const TOOLS: PressBrakeTool[] = [
  { kind: "punch", code: "s120", name: "straight 120", heightMm: 120, type: "straight", tipRadiusMm: 1, throatDepthMm: null, placeholder: true },
  { kind: "punch", code: "g120", name: "gooseneck 120", heightMm: 120, type: "gooseneck", tipRadiusMm: 1, throatDepthMm: 60, placeholder: true },
  { kind: "die", code: "v12", name: "V12", vMm: 12, minFlangeMm: 9, placeholder: true },
  { kind: "die", code: "v16", name: "V16", vMm: 16, minFlangeMm: 12, placeholder: true },
];

/**
 * L bracket flat: base 100 × 60 (x 0..100, y 0..60), strip x 100..102.355,
 * flange x 102.355..(102.355 + flange). With `slit`, an 18 mm end tab of the
 * base runs below y = 0 and reaches 3 mm past the base tangent line; the
 * relief between the tab and the bend end is a slit `slitWidth` wide (in y)
 * and `slitDepth` deep (in x), like the M040400 flange ends.
 */
function lFlat(options: { slitWidth?: number; slitDepth?: number; hole?: { x: number; y: number; r: number }; flangeMm?: number } = {}): PartGeometry {
  const flange = options.flangeMm ?? 50;
  const xEnd = 100 + BA + flange;
  const entities: EntitySpec[] = [];
  if (options.slitWidth) {
    const w = options.slitWidth;
    const d = options.slitDepth ?? 3;
    const xTab = 100 + d;
    // Outline: tab bottom, tab outer edge up to the slit, slit in (−x), slit bottom, slit out (+x), flange bottom edge …
    entities.push(
      line(0, -18, xTab, -18),
      line(xTab, -18, xTab, -w / 2),
      line(xTab, -w / 2, 100, -w / 2),
      line(100, -w / 2, 100, w / 2),
      line(100, w / 2, xTab, w / 2),
      line(xTab, w / 2, xEnd, w / 2),
      line(xEnd, w / 2, xEnd, 60),
      line(xEnd, 60, 0, 60),
      line(0, 60, 0, -18)
    );
  } else {
    entities.push(line(0, 0, xEnd, 0), line(xEnd, 0, xEnd, 60), line(xEnd, 60, 0, 60), line(0, 60, 0, 0));
  }
  entities.push(line(100 + BA / 2, 0, 100 + BA / 2, 60, "BEND_UP"));
  if (options.hole) entities.push(circle(options.hole.x, options.hole.y, options.hole.r));
  const g = analyzeDxfSync(buildDxf({ entities }), { thicknessMm: T, blankMarginMm: 10 });
  return g;
}

describe("RELIEF_TOO_NARROW", () => {
  it("a 0.1 mm slit at a bend end is found and flagged with the proposed fix; a 2 mm one passes", () => {
    const g = lFlat({ slitWidth: 0.1, slitDepth: 3 });
    expect(g.triage.state).toBe("green");
    const bends = [bend("sb1", 100, 60)];
    const reliefs = detectReliefs(g, bends, T);
    expect(reliefs).toHaveLength(1);
    expect(reliefs[0].widthMm).toBeCloseTo(0.1, 3);
    expect(reliefs[0].depthMm).toBeCloseTo(3, 3);
    const flags = evaluateDfmFlags(input(g, report({ bends, reliefs })));
    const relief = flags.find((f) => f.code === "dfm.relief_too_narrow");
    expect(relief).toBeDefined();
    expect(relief?.severity).toBe("amber");
    expect(relief?.params).toMatchObject({ count: 1, widthMm: 0.1, minMm: 2, proposedWidthMm: 2 });
    expect(relief?.locations).toHaveLength(1);

    const wide = lFlat({ slitWidth: 2.5, slitDepth: 3 });
    const wideReliefs = detectReliefs(wide, bends, T);
    expect(evaluateDfmFlags(input(wide, report({ bends, reliefs: wideReliefs }))).some((f) => f.code === "dfm.relief_too_narrow")).toBe(false);
  });
});

describe("HOLE_NEAR_BEND", () => {
  it("a hole 3 mm from a bend line in 2 mm steel (minimum 2t + r = 5) is flagged; at 6 mm it is not", () => {
    const near = lFlat({ hole: { x: 100 + BA / 2 - 3 - 2, y: 30, r: 2 } });
    const bends = [bend("sb1", 100, 60)];
    const flags = evaluateDfmFlags(input(near, report({ bends })));
    const f = flags.find((x) => x.code === "dfm.hole_near_bend");
    expect(f).toBeDefined();
    expect(f?.params).toMatchObject({ bendId: "sb1", count: 1, minMm: 5 });
    expect(f?.locations).toHaveLength(1);
    const far = lFlat({ hole: { x: 100 + BA / 2 - 6 - 2, y: 30, r: 2 } });
    expect(evaluateDfmFlags(input(far, report({ bends }))).some((x) => x.code === "dfm.hole_near_bend")).toBe(false);
  });
});

describe("FLANGE_TOO_SHORT", () => {
  it("a 4 mm flange on 2 mm is shorter than the smallest die with V ≥ 6t (V12 → 9 mm)", () => {
    const g = lFlat({ flangeMm: 1 });
    const bends = [bend("sb1", 100, 60, "up", 4, 100)];
    const flags = evaluateDfmFlags(input(g, report({ bends })));
    const f = flags.find((x) => x.code === "dfm.flange_too_short");
    expect(f?.params).toMatchObject({ bendId: "sb1", flangeMm: 4, minMm: 9, vMm: 12 });
    // Without dies the rule cannot run.
    expect(evaluateDfmFlags(input(g, report({ bends }), [])).some((x) => x.code === "dfm.flange_too_short")).toBe(false);
  });
});

describe("BEND_COLLISION", () => {
  it("a U channel 236.5 inside with 320.5 legs needs a punch ≥ 246.5 mm or a gooseneck with a 318.5 mm throat", () => {
    const g = lFlat();
    // Two parallel same-direction bends 234.5 mm apart (flat between the tangent lines) → W = 236.5.
    const a = { ...bend("sb1", 0, 380, "up", 240.5, 320.5, 0, 1) };
    const b = { ...bend("sb2", BA + 234.5, 380, "up", 320.5, 240.5, 1, 2) };
    const flags = evaluateDfmFlags(input(g, report({ bends: [a, b] })));
    const f = flags.find((x) => x.code === "dfm.bend_collision");
    expect(f).toBeDefined();
    expect(f?.params).toMatchObject({ bendA: "sb1", bendB: "sb2", widthMm: 236.5, legMm: 320.5, punchMm: 246.5 });
    // A 250 mm straight punch clears it; so does a gooseneck with a 320 mm throat.
    const tall: PressBrakeTool[] = [...TOOLS, { kind: "punch", code: "s250", name: "straight 250", heightMm: 250, type: "straight", tipRadiusMm: 1, throatDepthMm: null, placeholder: false }];
    expect(evaluateDfmFlags(input(g, report({ bends: [a, b] }), tall)).some((x) => x.code === "dfm.bend_collision")).toBe(false);
    const deep: PressBrakeTool[] = [...TOOLS, { kind: "punch", code: "g", name: "gooseneck", heightMm: 200, type: "gooseneck", tipRadiusMm: 1, throatDepthMm: 330, placeholder: false }];
    expect(evaluateDfmFlags(input(g, report({ bends: [a, b] }), deep)).some((x) => x.code === "dfm.bend_collision")).toBe(false);
    // Opposite directions never collide this way.
    const opposite = { ...b, direction: "down" as const };
    expect(evaluateDfmFlags(input(g, report({ bends: [a, opposite] }))).some((x) => x.code === "dfm.bend_collision")).toBe(false);
  });
});

describe("LASER_CANNOT_MAKE, mass, contours, masking, bend deduction", () => {
  it("countersinks, pockets and threads each raise the flag with their kind and count", () => {
    const g = lFlat();
    const flags = evaluateDfmFlags(
      input(
        g,
        report({
          countersinks: [
            { center: { x: 120, y: 20 }, throughDiameterMm: 6.1, topDiameterMm: 6.9, depthMm: 0.4, side: "outside", featureCode: "csk_m6" },
            { center: { x: 120, y: 40 }, throughDiameterMm: 6.1, topDiameterMm: 6.9, depthMm: 0.4, side: "outside", featureCode: "csk_m6" },
          ],
          blindPockets: [{ center: { x: 50, y: 30 }, maxSideMm: 10, depthMm: 1.5, circular: false }],
          helicalHoles: [{ x: 20, y: 20 }],
        })
      )
    );
    const laser = flags.filter((f) => f.code === "dfm.laser_cannot_make");
    expect(laser.map((f) => [f.params.what, f.params.count])).toEqual([
      ["countersink", 2],
      ["pocket", 1],
      ["thread", 1],
    ]);
  });

  it("flat volume vs model volume: 1 % passes, 3 % is flagged", () => {
    const g = lFlat();
    const flat = g.measures.netAreaMm2 * T;
    expect(evaluateDfmFlags(input(g, report({ flatVolumeMm3: flat, solidVolumeMm3: flat * 1.01 }))).some((f) => f.code === "dfm.flat_mass_mismatch")).toBe(false);
    const f = evaluateDfmFlags(input(g, report({ flatVolumeMm3: flat, solidVolumeMm3: flat * 1.03 }))).find((x) => x.code === "dfm.flat_mass_mismatch");
    expect(f?.params.deltaPct).toBe(3);
  });

  it("an unverified bend deduction and masking zones are amber; a test-bend row clears the deduction flag", () => {
    const g = lFlat();
    const bends = [bend("sb1", 100, 60)];
    const zones = [{ kind: "recess" as const, polygon: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 20 }, { x: 10, y: 20 }], areaMm2: 300, confirmed: true }];
    const flags = evaluateDfmFlags(input(g, report({ bends, maskingZones: zones })));
    expect(flags.find((f) => f.code === "sheet.bend_deduction_unverified")?.params).toMatchObject({ count: 1, source: "formula" });
    expect(flags.find((f) => f.code === "sheet.masking_not_priced")?.params).toMatchObject({ count: 1, areaMm2: 300, confirmed: "yes" });
    const verified = evaluateDfmFlags(input(g, report({ bends: [{ ...bends[0], allowanceSource: "test_bend" }] })));
    expect(verified.some((f) => f.code === "sheet.bend_deduction_unverified")).toBe(false);
  });

  it("a part without a sheet body is flagged not sheet metal and nothing else", () => {
    const g = lFlat();
    const flags = evaluateDfmFlags(input(g, report({ isSheetMetal: false, hardwareBodies: 0 })));
    expect(flags.map((f) => f.code)).toEqual(["sheet.not_sheet_metal"]);
  });

  it("drawing cross-checks: hardware and revision mismatches", () => {
    const g = lFlat();
    const flags = evaluateDfmFlags(
      input(
        g,
        report({
          drawing: {
            fileRevision: "G",
            drawingRevision: "F",
            material: "DC01",
            finish: "RAL9005",
            hardwareMismatches: [{ kind: "weld_stud", size: "M3X8", drawingQty: 5, modelQty: 4 }],
          },
        })
      )
    );
    expect(flags.find((f) => f.code === "sheet.hardware_mismatch")?.params).toMatchObject({ item: "stud M3X8", drawingQty: 5, modelQty: 4 });
    expect(flags.find((f) => f.code === "sheet.revision_mismatch")?.params).toMatchObject({ fileRevision: "G", drawingRevision: "F" });
  });
});
