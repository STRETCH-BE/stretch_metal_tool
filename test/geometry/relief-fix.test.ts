/**
 * Relief proposed fix (lib/geometry/step/relief-fix.ts): a 0.1 mm slit next
 * to a bend end becomes t wide and reaches the tangent + t, the outline
 * stays closed, and applyAnnotations with `reliefFix` re-measures the
 * reliefs so RELIEF_TOO_NARROW no longer fires.
 * File path: /test/geometry/relief-fix.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyzeDxfSync, applyAnnotationsSync } from "@/lib/geometry";
import { applyReliefFix, proposedReliefDepthMm } from "@/lib/geometry/step/relief-fix";
import { detectReliefs } from "@/lib/geometry/step/reliefs";
import { EMPTY_ANNOTATIONS, type PartGeometry, type SheetBend, type SheetReport } from "@/lib/geometry/types";
import { buildDxf, line, type EntitySpec } from "./dxf-builder";

const T = 2;
const BA = 2.355;

function bend(): SheetBend {
  return {
    id: "sb1",
    start: { x: 100 + BA / 2, y: 0 },
    end: { x: 100 + BA / 2, y: 60 },
    lengthMm: 60,
    angleDeg: 90,
    innerRadiusMm: 1,
    allowanceMm: BA,
    allowanceSource: "din6935_formula",
    direction: "up",
    strip: { a1: { x: 100, y: 0 }, a2: { x: 100, y: 60 }, t1: { x: 100 + BA, y: 0 }, t2: { x: 100 + BA, y: 60 } },
    flangeOutsideMm: 50,
    baseFlangeOutsideMm: 100,
    fromFlange: 0,
    toFlange: 1,
  };
}

/** L flat with an 18 mm end tab and a slit `w` wide, 3 deep between tab and bend end (see test/pricing/dfm.test.ts). */
function flat(w: number): PartGeometry {
  const xEnd = 100 + BA + 50;
  const xTab = 103;
  const entities: EntitySpec[] = [
    line(0, -18, xTab, -18),
    line(xTab, -18, xTab, -w / 2),
    line(xTab, -w / 2, 100, -w / 2),
    line(100, -w / 2, 100, w / 2),
    line(100, w / 2, xTab, w / 2),
    line(xTab, w / 2, xEnd, w / 2),
    line(xEnd, w / 2, xEnd, 60),
    line(xEnd, 60, 0, 60),
    line(0, 60, 0, -18),
    line(100 + BA / 2, 0, 100 + BA / 2, 60, "BEND_UP"),
  ];
  return analyzeDxfSync(buildDxf({ entities }), { thicknessMm: T, blankMarginMm: 10 });
}

function withSheet(g: PartGeometry): PartGeometry {
  const bends = [bend()];
  const sheet: SheetReport = {
    version: 1,
    thicknessMm: T,
    isSheetMetal: true,
    bends,
    hardware: [],
    studPositions: [],
    maskingZones: [],
    countersinks: [],
    blindPockets: [],
    helicalHoles: [],
    reliefs: detectReliefs(g, bends, T),
    solidVolumeMm3: null,
    flatVolumeMm3: g.measures.netAreaMm2 * T,
    hardwareBodies: 0,
    productName: null,
  };
  return { ...g, sheet };
}

describe("applyReliefFix", () => {
  it("widens the slit to t and deepens it to the tangent + t, keeping the outline closed", () => {
    const g = withSheet(flat(0.1));
    expect(g.sheet!.reliefs).toHaveLength(1);
    const relief = g.sheet!.reliefs[0];
    expect(proposedReliefDepthMm(relief, bend(), T)).toBeCloseTo(3 + T, 6);
    const fixed = applyReliefFix(g.entities, g.sheet!.reliefs, g.sheet!.bends, T);
    const after = applyAnnotationsSync({ ...g, entities: fixed }, EMPTY_ANNOTATIONS);
    expect(after.triage.state).toBe("green");
    expect(after.outerLoopId).not.toBeNull();
    const reliefs = detectReliefs(after, g.sheet!.bends, T);
    expect(reliefs).toHaveLength(1);
    expect(reliefs[0].widthMm).toBeCloseTo(T, 3);
    expect(reliefs[0].depthMm).toBeCloseTo(5, 3);
    // Only the slit changed: the outer size is the same, the net area shrank by the added slit material.
    expect(after.measures.bbox.width).toBeCloseTo(g.measures.bbox.width, 6);
    expect(after.measures.bbox.height).toBeCloseTo(g.measures.bbox.height, 6);
    expect(g.measures.netAreaMm2 - after.measures.netAreaMm2).toBeCloseTo(T * 5 - 0.1 * 3, 3);
  });

  it("is applied through applyAnnotations when the annotation flag is set, and the report follows", () => {
    const g = withSheet(flat(0.1));
    const before = applyAnnotationsSync(g, EMPTY_ANNOTATIONS);
    expect(before.sheet!.reliefs[0].widthMm).toBeCloseTo(0.1, 3);
    const after = applyAnnotationsSync(g, { ...EMPTY_ANNOTATIONS, reliefFix: true });
    expect(after.sheet!.reliefs[0].widthMm).toBeCloseTo(T, 3);
    expect(after.sheet!.flatVolumeMm3).toBeCloseTo(after.measures.netAreaMm2 * T, 6);
  });
});
