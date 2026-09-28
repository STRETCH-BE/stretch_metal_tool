/**
 * Mesh reconstruction (lib/geometry/step/mesh.ts): tessellated solids
 * (FACETED_BREP / IFC style) rebuilt into flanges and bend cylinders so
 * the flat-pattern and unfold paths work on them.
 * File path: /test/geometry/mesh.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyseStepSync, summariseStepText } from "@/lib/geometry/step/analyse";
import { din6935Allowance } from "@/lib/geometry/step/unfold";
import { tessellatedBracket, tessellatedPlate } from "./mesh-fixtures";

describe("mesh reconstruction", () => {
  it("reads a triangulated plate with a round hole as a flat pattern", () => {
    const g = analyseStepSync(tessellatedPlate());
    expect(g.triage.state).toBe("green");
    expect(g.measures.bbox.width).toBeCloseTo(100, 3);
    expect(g.measures.bbox.height).toBeCloseTo(50, 3);
    expect(g.material.thicknessMm).toBe(5);
    expect(g.measures.pierces).toBe(2);
    expect(g.measures.holes).toHaveLength(1);
    // 16-gon around a Ø10 hole.
    expect(g.measures.holesLengthMm).toBeCloseTo(16 * 2 * 5 * Math.sin(Math.PI / 16), 3);
    expect(g.measures.holes[0].maxSideMm).toBeCloseTo(10, 1);
  });

  it("finds the bend strips of a tessellated bracket and unfolds it", () => {
    const text = tessellatedBracket();
    const summary = summariseStepText(text);
    expect(summary.bodies[0].thicknessMm).toBe(5);
    expect(summary.bodies[0].bendCount).toBe(1);
    const g = analyseStepSync(text);
    expect(g.triage.state).toBe("green");
    expect(g.measures.bendLines).toHaveLength(1);
    expect(g.measures.bendLines[0].lengthMm).toBeCloseTo(40, 3);
    const allowance = din6935Allowance(Math.PI / 2, 5, 5);
    const dims = [g.measures.bbox.width, g.measures.bbox.height].sort((a, b) => a - b);
    expect(dims[0]).toBeCloseTo(40, 3);
    expect(dims[1]).toBeCloseTo(70 + 50 + allowance, 1);
  });
});
