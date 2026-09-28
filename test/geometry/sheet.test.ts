/**
 * STEP sheet-metal path (lib/geometry/step/sheet.ts + unfold.ts):
 * synthetic models through the library's own writer — a U channel with
 * the DIN 6935 allowance and a test-bend row, a plate with a stud seat,
 * a mask recess, a weld stud, a named insert placed through an assembly
 * transform, volumes, and the report the DFM checks read.
 * File path: /test/geometry/sheet.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyseStepSync, splitModelSync } from "@/lib/geometry/step/analyse";
import { din6935Allowance } from "@/lib/geometry/step/unfold";
import { bodyVolumeMm3 } from "@/lib/geometry/step/volume";
import { evaluateBrep, placementReader } from "@/lib/geometry/step/brep";
import { parseStep } from "@/lib/geometry/step/part21";
import { bodyPlacements } from "@/lib/geometry/step/assembly";
import { applyRigidPoint } from "@/lib/geometry/step/transform";
import { writeExtrudedStep, type Profile } from "@/lib/geometry/step/write-step";
import { buildStep, circle, lProfile, rect } from "./step-builder";
import type { BendTableLookup } from "@/lib/geometry/types";

/** U channel: web `w` (outside), legs `h` (outside), thickness t, inner radius r; profile in x–z, extruded along y. Counter-clockwise. */
function uProfile(w: number, h: number, t: number, r: number): Profile {
  const R = r + t;
  return {
    start: { x: R, y: 0 },
    segments: [
      { kind: "line", to: { x: w - R, y: 0 } },
      { kind: "arc", to: { x: w, y: R }, center: { x: w - R, y: R }, ccw: true },
      { kind: "line", to: { x: w, y: h } },
      { kind: "line", to: { x: w - t, y: h } },
      { kind: "line", to: { x: w - t, y: R } },
      { kind: "arc", to: { x: w - R, y: t }, center: { x: w - R, y: R }, ccw: false },
      { kind: "line", to: { x: R, y: t } },
      { kind: "arc", to: { x: t, y: R }, center: { x: R, y: R }, ccw: false },
      { kind: "line", to: { x: t, y: h } },
      { kind: "line", to: { x: 0, y: h } },
      { kind: "line", to: { x: 0, y: R } },
      { kind: "arc", to: { x: R, y: 0 }, center: { x: R, y: R }, ccw: true },
    ],
  };
}

const T = 2;
const R = 1;
const BA90 = din6935Allowance(Math.PI / 2, R, T);

describe("bend allowance", () => {
  it("DIN 6935: 2 mm, r 1, 90° gives 2.355 mm; k caps at 1 beyond r/t = 5", () => {
    expect(BA90).toBeCloseTo(2.355, 3);
    expect(din6935Allowance(Math.PI / 2, 12, 2)).toBeCloseTo((Math.PI / 2) * 13, 6);
  });
});

describe("U channel", () => {
  const W = 240.5;
  const H = 320.5;
  const L = 380;
  const text = buildStep([{ name: "hood", outer: uProfile(W, H, T, R), height: L, frame: "xz" }]);

  it("unfolds to web + 2 legs + 2 allowances, two BEND_UP lines of the full length, bends carry angle / radius / allowance", () => {
    const g = analyseStepSync(text, { name: "M040320_E" });
    expect(g.triage.state).toBe("green");
    expect(g.sheet?.isSheetMetal).toBe(true);
    const flatWeb = W - 2 * (R + T);
    const flatLeg = H - (R + T);
    const expectedLength = flatWeb + 2 * flatLeg + 2 * BA90;
    const dims = [g.measures.bbox.width, g.measures.bbox.height].sort((a, b) => a - b);
    expect(dims[0]).toBeCloseTo(L, 3);
    expect(dims[1]).toBeCloseTo(expectedLength, 3);
    expect(g.measures.pierces).toBe(1);
    expect(g.measures.bendLines).toHaveLength(2);
    for (const b of g.measures.bendLines) {
      expect(b.direction).toBe("up");
      expect(b.lengthMm).toBeCloseTo(L, 3);
      expect(b.angleDeg).toBeCloseTo(90, 3);
      expect(b.innerRadiusMm).toBeCloseTo(R, 3);
      expect(b.allowanceMm).toBeCloseTo(BA90, 3);
      expect(b.allowanceSource).toBe("din6935_formula");
    }
    const sheet = g.sheet!;
    expect(sheet.bends).toHaveLength(2);
    // Each bend joins the web (240.5 across both radii) and a leg (320.5).
    for (const b of sheet.bends) {
      const dims = [b.flangeOutsideMm, b.baseFlangeOutsideMm].map((v) => Math.round((v ?? 0) * 10) / 10).sort((x, y) => x - y);
      expect(dims).toEqual([W, H]);
    }
    const [b1, b2] = sheet.bends;
    expect([b1.fromFlange, b1.toFlange].some((f) => f === b2.fromFlange || f === b2.toFlange)).toBe(true);
    expect(sheet.hardware).toEqual([]);
    expect(sheet.maskingZones).toEqual([]);
    expect(sheet.studPositions).toEqual([]);
    // Model volume vs flat volume: the strip is the neutral-axis length, the bend the true material — within 2 %.
    expect(sheet.solidVolumeMm3).not.toBeNull();
    expect(Math.abs(sheet.solidVolumeMm3! - sheet.flatVolumeMm3) / sheet.flatVolumeMm3).toBeLessThan(0.02);
    expect(sheet.flatVolumeMm3).toBeCloseTo(g.measures.netAreaMm2 * T, 3);
  });

  it("uses a test-bend row of the bend table when one matches and marks the source", () => {
    const table: BendTableLookup = {
      materialFamily: "mild_steel",
      rows: [{ materialFamily: "mild_steel", thicknessMm: 2, innerRadiusMm: 1, vDieMm: 16, angleDeg: 90, bendAllowanceMm: 2.6, source: "test_bend" }],
    };
    const g = analyseStepSync(text, { bendTable: table });
    const dims = [g.measures.bbox.width, g.measures.bbox.height].sort((a, b) => a - b);
    expect(dims[1]).toBeCloseTo(W - 2 * (R + T) + 2 * (H - (R + T)) + 2 * 2.6, 3);
    expect(g.measures.bendLines.every((b) => b.allowanceSource === "test_bend" && b.allowanceMm === 2.6)).toBe(true);
    // A row of another family does not apply: back to the formula.
    const other = analyseStepSync(text, { bendTable: { ...table, materialFamily: "aluminium" } });
    expect(other.measures.bendLines[0].allowanceSource).toBe("din6935_formula");
    // A DIN table row keeps the "unverified" source.
    const din = analyseStepSync(text, { bendTable: { ...table, rows: [{ ...table.rows[0], source: "din6935", bendAllowanceMm: 2.3554 }] } });
    expect(din.measures.bendLines[0].allowanceSource).toBe("din6935_table");
  });

  it("solid volume of a plain plate is exact", () => {
    const plate = buildStep([{ outer: rect(100, 50), holes: [circle({ x: 30, y: 25 }, 5)], height: 5 }]);
    const model = evaluateBrep(parseStep(plate));
    expect(bodyVolumeMm3(model.bodies[0])!).toBeCloseTo((100 * 50 - Math.PI * 25) * 5, 0);
  });
});

describe("blind features", () => {
  const t = 2;
  it("a 0.3 mm round pocket is a stud seat (IGNORE mark, not a cut); a 0.01 mm recess is a masking zone", () => {
    const text = buildStep([
      {
        outer: rect(120, 80),
        holes: [circle({ x: 100, y: 40 }, 3)],
        height: t,
        pockets: [
          { profile: circle({ x: 30, y: 40 }, 2.5), depth: 0.3 },
          { profile: rect(20, 9, { x: 60, y: 10 }), depth: 0.01 },
        ],
      },
    ]);
    const g = analyseStepSync(text);
    expect(g.triage.state).toBe("green");
    expect(g.measures.pierces).toBe(2);
    expect(g.measures.holes).toHaveLength(1);
    expect(g.measures.holes[0].diameterMm).toBeCloseTo(6, 3);
    const sheet = g.sheet!;
    expect(sheet.studPositions).toHaveLength(1);
    expect(sheet.maskingZones).toHaveLength(1);
    expect(sheet.maskingZones[0].kind).toBe("recess");
    expect(sheet.maskingZones[0].areaMm2).toBeCloseTo(180, 2);
    expect(sheet.blindPockets).toEqual([]);
    // Seat centre lands on the pocket: 30 from one short edge, 40 from a long edge (the flat frame may be flipped).
    const seat = sheet.studPositions[0];
    const bb = g.measures.bbox;
    expect([seat.x - bb.minX, bb.maxX - seat.x].map((v) => Math.round(v * 1000) / 1000).sort((a, b) => a - b)).toEqual([30, 90]);
    expect(Math.abs(seat.y - bb.minY - 40) < 1e-6 || Math.abs(bb.maxY - seat.y - 40) < 1e-6).toBe(true);
  });

  it("a deep non-round pocket is a blind pocket the laser cannot make", () => {
    const text = buildStep([{ outer: rect(60, 40), height: 3, pockets: [{ profile: rect(10, 6, { x: 20, y: 17 }), depth: 1.5 }] }]);
    const g = analyseStepSync(text);
    expect(g.measures.pierces).toBe(1);
    expect(g.sheet?.blindPockets).toHaveLength(1);
    expect(g.sheet?.blindPockets[0].depthMm).toBeCloseTo(1.5, 3);
  });
});

describe("hardware", () => {
  const t = 2;
  const plate = { name: "plate", outer: rect(100, 60), holes: [circle({ x: 80, y: 30 }, 3.05)], height: t };

  it("an unnamed cylinder standing on the sheet is a weld stud sized by diameter and length", () => {
    const stud = { name: "", outer: circle({ x: 25, y: 30 }, 1.5), height: 8.1, frame: { origin: { x: 0, y: 0, z: t }, axis: { x: 0, y: 0, z: 1 }, ref: { x: 1, y: 0, z: 0 } } };
    const text = writeExtrudedStep([plate, stud], { products: [{ name: "plate" }, { name: "" }] });
    const split = splitModelSync(text, { name: "bracket" });
    expect(split.parts).toHaveLength(1);
    const g = split.parts[0].geometry;
    expect(g.triage.state).toBe("green");
    expect(g.measures.pierces).toBe(2);
    const hw = g.sheet!.hardware;
    expect(hw).toHaveLength(1);
    expect(hw[0]).toMatchObject({ kind: "weld_stud", size: "M3x8", qty: 1, featureCode: "stud_m3x8", source: "geometry" });
    expect(hw[0].positions).toHaveLength(1);
    expect(g.sheet!.hardwareBodies).toBe(1);
  });

  it("a body sitting in a through hole is an insert sized from the hole; a name rule wins over geometry", () => {
    const insert = { name: "ACAO470ZP", outer: circle({ x: 80, y: 30 }, 2.9), height: 6, frame: { origin: { x: 0, y: 0, z: -2 }, axis: { x: 0, y: 0, z: 1 }, ref: { x: 1, y: 0, z: 0 } } };
    const text = writeExtrudedStep([plate, insert], { products: [{ name: "plate" }, { name: "C2G - Soudage Innovation | ACAO470ZP", occurrences: 3 }] });
    const byGeometry = splitModelSync(text).parts[0].geometry.sheet!.hardware;
    expect(byGeometry).toHaveLength(1);
    expect(byGeometry[0]).toMatchObject({ kind: "insert", size: "M4", qty: 3, featureCode: "insert_m4", source: "geometry" });
    const byName = splitModelSync(text, { hardwareNames: [{ pattern: "acao470zp", kind: "insert", size: "M4", featureCode: "insert_m4_custom" }] }).parts[0].geometry.sheet!.hardware;
    expect(byName[0]).toMatchObject({ kind: "insert", size: "M4", qty: 3, featureCode: "insert_m4_custom", source: "name", productName: "C2G - Soudage Innovation | ACAO470ZP" });
  });

  it("hardware is never part of the sheet's cut geometry, bbox or mass", () => {
    const stud = { name: "", outer: circle({ x: 25, y: 30 }, 1.5), height: 15.1, frame: { origin: { x: 0, y: 0, z: t }, axis: { x: 0, y: 0, z: 1 }, ref: { x: 1, y: 0, z: 0 } } };
    const text = writeExtrudedStep([plate, stud], { products: [{ name: "plate" }, { name: "" }] });
    const g = splitModelSync(text).parts[0].geometry;
    expect(g.measures.bbox.width).toBeCloseTo(100, 3);
    expect(g.measures.bbox.height).toBeCloseTo(60, 3);
    expect(g.measures.netAreaMm2).toBeCloseTo(6000 - Math.PI * 3.05 * 3.05, 1);
    expect(g.sheet!.hardware[0].size).toBe("M3x15");
  });
});

describe("assembly placements", () => {
  it("moves a placed product into the assembly frame and finds the stud on the sheet", () => {
    const t = 2;
    const plate = { name: "plate", outer: rect(100, 60), height: t };
    // The stud is modelled at its own origin and PLACED at (40, 20, t) by the assembly transform.
    const stud = { name: "", outer: circle({ x: 0, y: 0 }, 2), height: 10 };
    const text = writeExtrudedStep([plate, stud], {
      products: [{ name: "plate" }, { name: "stud", placement: { origin: { x: 40, y: 20, z: t }, axis: { x: 0, y: 0, z: 1 }, ref: { x: 1, y: 0, z: 0 } } }],
    });
    const file = parseStep(text);
    const placements = bodyPlacements(file, placementReader(file));
    const model = evaluateBrep(file);
    const studBody = model.bodies[1];
    const transforms = placements.get(studBody.id)!;
    expect(transforms).toHaveLength(1);
    expect(applyRigidPoint(transforms[0], { x: 0, y: 0, z: 0 })).toEqual({ x: 40, y: 20, z: t });
    const g = splitModelSync(text).parts[0].geometry;
    expect(g.sheet!.hardware).toHaveLength(1);
    expect(g.sheet!.hardware[0].kind).toBe("weld_stud");
    const p = g.sheet!.hardware[0].positions[0];
    const bb = g.measures.bbox;
    expect([p.x - bb.minX, bb.maxX - p.x].map((v) => Math.round(v * 1000) / 1000).sort((a, b) => a - b)).toEqual([40, 60]);
    expect([p.y - bb.minY, bb.maxY - p.y].map((v) => Math.round(v * 1000) / 1000).sort((a, b) => a - b)).toEqual([20, 40]);
  });

  it("two sheet bodies stay two parts; hardware bodies do not become parts", () => {
    const text = buildStep([
      { outer: rect(100, 50), height: 5 },
      { outer: rect(30, 30), height: 3 },
    ]);
    expect(splitModelSync(text).parts).toHaveLength(2);
    const g = analyseStepSync(text);
    expect(g.triage.state).toBe("red_step_manual");
  });
});

describe("not sheet metal", () => {
  it("a block without a sheet-like face pair is flagged, not unfolded", () => {
    // A 20 × 20 × 20 cube: thickness 20, largest face 400 < 25 × 20².
    const g = analyseStepSync(buildStep([{ outer: rect(20, 20), height: 20 }]));
    expect(g.triage.state).toBe("red_step_manual");
    expect(g.sheet?.isSheetMetal).toBe(false);
  });
});

describe("L bracket (regression)", () => {
  it("still unfolds with the DIN allowance and a bend line", () => {
    const g = analyseStepSync(buildStep([{ outer: lProfile(80, 60, 5, 5), height: 40, frame: "xz" }]));
    expect(g.triage.state).toBe("green");
    expect(g.measures.bendLines).toHaveLength(1);
    expect(g.measures.bendLines[0].allowanceMm).toBeCloseTo(din6935Allowance(Math.PI / 2, 5, 5), 6);
  });
});
