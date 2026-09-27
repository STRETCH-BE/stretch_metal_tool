/**
 * STEP reader: Part 21 parsing, B-rep evaluation and the sheet analysis
 * (lib/geometry/step/*), on synthetic AP214 files from step-builder.ts.
 * File path: /test/geometry/step.test.ts
 */
import { describe, expect, it } from "vitest";
import { asNumber, asRefs, isStepText, parseStep, part, StepFormatError } from "@/lib/geometry/step/part21";
import { evaluateBrep } from "@/lib/geometry/step/brep";
import { analyseStepSync, summariseStepText } from "@/lib/geometry/step/analyse";
import { K_FACTOR } from "@/lib/geometry/step/unfold";
import { geometryEngine } from "@/lib/geometry";
import { buildStep, circle, lProfile, rect } from "./step-builder";

const PLATE = buildStep([{ outer: rect(100, 50), holes: [circle({ x: 30, y: 25 }, 5)], height: 5 }]);

describe("part21", () => {
  it("recognises the header and refuses other text", () => {
    expect(isStepText(PLATE)).toBe(true);
    expect(isStepText("0\nSECTION\n2\nHEADER")).toBe(false);
    expect(() => parseStep("hello")).toThrow(StepFormatError);
  });

  it("parses simple and complex instances, strings, enums, refs and lists", () => {
    const text = [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
      "FILE_NAME('x.stp','2026-01-01',('me'),(''),'Inventor 2026','Inventor','');",
      "ENDSEC;",
      "DATA;",
      "/* a comment; with a semicolon */",
      "#1 = CARTESIAN_POINT('it''s a point',(1.5,-2.E-01,",
      "  3.));",
      "#2 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );",
      "#3 = EDGE_CURVE('',#4,$,#1,.F.);",
      "#5 = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#2,'d','');",
      "ENDSEC;",
      "END-ISO-10303-21;",
    ].join("\n");
    const file = parseStep(text);
    expect(file.header.schema).toContain("AUTOMOTIVE_DESIGN");
    expect(file.header.fileName).toBe("x.stp");
    expect(file.header.originatingSystem).toBe("Inventor");
    const p = file.instances.get(1);
    expect(p?.type).toBe("CARTESIAN_POINT");
    expect(p?.args[0]).toBe("it's a point");
    expect(p?.args[1]).toEqual([1.5, -0.2, 3]);
    const unit = file.instances.get(2);
    expect(unit?.type).toBe("");
    expect(unit && part(unit, "SI_UNIT")?.args).toEqual([{ enum: "MILLI" }, { enum: "METRE" }]);
    expect(file.byType.get("LENGTH_UNIT")).toEqual([2]);
    const edge = file.instances.get(3);
    expect(edge?.args).toEqual(["", { ref: 4 }, null, { ref: 1 }, { enum: "F" }]);
    const u = file.instances.get(5);
    expect(u && asNumber(u.args[0])).toBeCloseTo(1e-7);
    expect(asRefs([{ ref: 1 }, "x", { ref: 2 }])).toEqual([1, 2]);
  });
});

describe("brep", () => {
  it("evaluates a plate into one solid with planar caps, sides and hole cylinders in mm", () => {
    const model = evaluateBrep(parseStep(PLATE));
    expect(model.unitName).toBe("mm");
    expect(model.bodies).toHaveLength(1);
    const kinds = model.bodies[0].faces.map((f) => f.surface.kind);
    expect(kinds.filter((k) => k === "plane")).toHaveLength(6);
    expect(kinds.filter((k) => k === "cylinder")).toHaveLength(2);
    const top = model.bodies[0].faces.find((f) => f.surface.kind === "plane" && f.inner.length === 1);
    expect(top).toBeDefined();
    expect(top?.outer?.edges).toHaveLength(4);
  });

  it("scales inch files to millimetres", () => {
    const inch = buildStep([{ outer: rect(4, 2), height: 0.1 }], { unit: "inch" });
    const model = evaluateBrep(parseStep(inch));
    expect(model.unitName).toBe("inch");
    expect(model.unitScale).toBeCloseTo(25.4);
  });
});

describe("analyseStepSync", () => {
  it("turns a flat plate with a two-edge hole into a green flat pattern with thickness", () => {
    const g = analyseStepSync(PLATE, { name: "plate" });
    expect(g.source).toBe("step");
    expect(g.triage.state).toBe("green");
    expect(g.outerLoopId).not.toBeNull();
    expect(g.measures.bbox.width).toBeCloseTo(100, 3);
    expect(g.measures.bbox.height).toBeCloseTo(50, 3);
    expect(g.measures.pierces).toBe(2);
    expect(g.measures.holesLengthMm).toBeCloseTo(Math.PI * 10, 2);
    expect(g.measures.outerLengthMm).toBeCloseTo(300, 3);
    expect(g.material.thicknessMm).toBe(5);
    expect(g.header.units.detected).toBe("mm");
  });

  it("accepts a seam-edge full-circle hole and caps written without FACE_OUTER_BOUND", () => {
    const text = buildStep([{ outer: rect(60, 40), holes: [circle({ x: 20, y: 20 }, 4, 1)], height: 2 }], { noOuterBound: true });
    const g = analyseStepSync(text);
    expect(g.triage.state).toBe("green");
    expect(g.measures.pierces).toBe(2);
    expect(g.measures.holesLengthMm).toBeCloseTo(Math.PI * 8, 2);
    expect(g.material.thicknessMm).toBe(2);
  });

  it("scales an inch plate and does not ask the units question", () => {
    const inch = buildStep([{ outer: rect(4, 2), height: 0.1 }], { unit: "inch" });
    const g = analyseStepSync(inch);
    expect(g.triage.state).toBe("green");
    expect(g.measures.bbox.width).toBeCloseTo(101.6, 3);
    expect(g.material.thicknessMm).toBeCloseTo(2.54, 2);
    expect(g.header.units.scaleApplied).toBeCloseTo(25.4);
  });

  it("keeps a user-supplied thickness over the measured one", () => {
    const g = analyseStepSync(PLATE, { thicknessMm: 6 });
    expect(g.material.thicknessMm).toBe(6);
  });

  it("unfolds a bent bracket: two flanges, a bend allowance and a bend line", () => {
    const bracket = buildStep([{ outer: lProfile(80, 60, 5, 5), height: 40, frame: "xz" }]);
    const summary = summariseStepText(bracket);
    expect(summary.bodies).toHaveLength(1);
    expect(summary.bodies[0].thicknessMm).toBe(5);
    expect(summary.bodies[0].bendCount).toBe(1);
    expect(summary.bodies[0].flat).toBe(false);
    expect(summary.bodies[0].notFlatBecause).toContain("bends");
    const g = analyseStepSync(bracket);
    expect(g.source).toBe("step");
    expect(g.triage.state).toBe("green");
    expect(g.triage.reasons).toContain("bend_layers_found");
    // Outer faces: 80 − (r + t) = 70 and 60 − (r + t) = 50, plus the neutral-axis
    // allowance π/2 × (5 + 0.4 × 5) = 10.996 between them.
    const allowance = (Math.PI / 2) * (5 + K_FACTOR * 5);
    const dims = [g.measures.bbox.width, g.measures.bbox.height].sort((a, b) => a - b);
    expect(dims[0]).toBeCloseTo(40, 3);
    expect(dims[1]).toBeCloseTo(70 + 50 + allowance, 3);
    expect(g.measures.pierces).toBe(1);
    expect(g.measures.outerLengthMm).toBeCloseTo(2 * (40 + 70 + 50 + allowance), 3);
    expect(g.measures.bendLines).toHaveLength(1);
    expect(g.measures.bendLines[0].lengthMm).toBeCloseTo(40, 3);
    expect(g.material.thicknessMm).toBe(5);
  });

  it("falls back to red_step_manual when a bent body cannot be unfolded", () => {
    // Two flanges sharing a bend, but the second flange face is missing its outer bound
    // (an open shell): the walk cannot place it, so the manual result carries the facts.
    const bracket = buildStep([{ outer: lProfile(80, 60, 5, 5), height: 40, frame: "xz" }]).replace(/FACE_OUTER_BOUND/g, "FACE_BOUND");
    const g = analyseStepSync(bracket.replace(/CYLINDRICAL_SURFACE\('',(#\d+),(\d+\.?\d*)\)/, "CYLINDRICAL_SURFACE('',$1,$2)"));
    expect(["green", "red_step_manual"]).toContain(g.triage.state);
    if (g.triage.state === "red_step_manual") {
      expect(g.triage.details).toMatchObject({ thicknessMm: 5, bendCount: 1, bodies: 1, bboxX: 80, bboxY: 60, bboxZ: 40 });
    }
  });

  it("reports a multi-body file as an assembly", () => {
    const two = buildStep([
      { outer: rect(100, 50), height: 5 },
      { outer: rect(30, 30), height: 3 },
    ]);
    const g = analyseStepSync(two);
    expect(g.triage.state).toBe("red_step_manual");
    expect(g.triage.reasons).toEqual(["step_multi_body"]);
    expect(g.triage.details.bodies).toBe(2);
    expect(g.partCount).toBe(2);
  });

  it("reports a file without a solid", () => {
    const g = analyseStepSync("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1 = CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n");
    expect(g.triage.state).toBe("red_step_manual");
    expect(g.triage.reasons).toEqual(["step_no_geometry"]);
  });

  it("is reachable through the engine and deterministic", async () => {
    const a = await geometryEngine.analyzeStep(PLATE);
    const b = analyseStepSync(PLATE);
    expect(a).toEqual(b);
    expect(a.entities.map((e) => e.id)).toEqual(b.entities.map((e) => e.id));
  });
});
