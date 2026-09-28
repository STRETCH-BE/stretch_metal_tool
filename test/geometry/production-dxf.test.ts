/**
 * Production DXF (lib/geometry/export-dxf.ts writeProductionDxf): AC1018
 * with $INSUNITS 4, holes on CUT, bend lines on BEND_UP / BEND_DOWN, stud
 * marks on IGNORE — and it round-trips through our own parser.
 * File path: /test/geometry/production-dxf.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyseStepSync } from "@/lib/geometry/step/analyse";
import { analyzeDxfSync, writeProductionDxf } from "@/lib/geometry";
import { EMPTY_ANNOTATIONS } from "@/lib/geometry/types";
import { buildStep, circle, lProfile, rect } from "./step-builder";

describe("writeProductionDxf", () => {
  it("writes an AC1018 file on CUT / BEND_UP / IGNORE that parses back to the same flat pattern", () => {
    const bracket = analyseStepSync(buildStep([{ outer: lProfile(80, 60, 2, 1), height: 40, frame: "xz" }]));
    expect(bracket.triage.state).toBe("green");
    const text = writeProductionDxf(bracket, EMPTY_ANNOTATIONS, { title: "bracket rev A" });
    expect(text).toContain("AC1018");
    expect(text).toMatch(/\$INSUNITS\r?\n 70\r?\n4/);
    expect(text).toContain("BEND_UP");
    expect(text).not.toContain("HOLES");
    const back = analyzeDxfSync(text, { thicknessMm: 2 });
    expect(back.triage.state).toBe("green");
    expect(back.measures.bbox.width).toBeCloseTo(bracket.measures.bbox.width, 3);
    expect(back.measures.bbox.height).toBeCloseTo(bracket.measures.bbox.height, 3);
    expect(back.measures.bendLines).toHaveLength(1);
    expect(back.measures.bendLines[0].direction).toBe("up");
    expect(back.measures.outerLengthMm).toBeCloseTo(bracket.measures.outerLengthMm, 3);
  });

  it("puts holes on CUT and stud seats on IGNORE without cutting them", () => {
    const plate = analyseStepSync(
      buildStep([{ outer: rect(100, 60), holes: [circle({ x: 80, y: 30 }, 3)], height: 2, pockets: [{ profile: circle({ x: 30, y: 30 }, 2.5), depth: 0.3 }] }])
    );
    expect(plate.sheet?.studPositions).toHaveLength(1);
    const text = writeProductionDxf(plate, EMPTY_ANNOTATIONS);
    const layersUsed = new Set(text.split(/\r?\n/).map((l, i, all) => (l.trim() === "8" ? all[i + 1] : null)).filter(Boolean));
    expect(layersUsed).toEqual(new Set(["CUT", "IGNORE", "0"]));
    const back = analyzeDxfSync(text, { thicknessMm: 2 });
    expect(back.measures.pierces).toBe(2);
    expect(back.measures.holes).toHaveLength(1);
    expect(back.dropped.some((d) => d.layer === "IGNORE")).toBe(true);
  });
});
