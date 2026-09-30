/**
 * Folded sheet parts with bends in several directions (folded-fixtures.ts
 * through the mesh rebuild, sheet.ts and unfold.ts): a box-shaped part is
 * sheet-like by its thickness-partner share and unfolds; a wall with
 * bends on two adjacent edges and a corner relief unfolds to ONE closed
 * outline with both bend strips and the notch; a block is not a sheet.
 * File path: /test/geometry/folded.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyseStepSync, withReconstructedMeshes } from "@/lib/geometry/step/analyse";
import { evaluateBrep } from "@/lib/geometry/step/brep";
import { parseStep } from "@/lib/geometry/step/part21";
import { bodyFacts } from "@/lib/geometry/step/sheet";
import { din6935Allowance } from "@/lib/geometry/step/unfold";
import { buildStep, rect } from "./step-builder";
import { CORNER_DEFAULTS, cornerPartStep, cornerPartVolumeMm3 } from "./folded-fixtures";

const T = CORNER_DEFAULTS.t;
const R = CORNER_DEFAULTS.r;
const BA = din6935Allowance(Math.PI / 2, R, T);

function facts(text: string) {
  return bodyFacts(withReconstructedMeshes(evaluateBrep(parseStep(text))).bodies[0]);
}

describe("box part (top plate, two adjacent bent sides, outward base flange)", () => {
  const text = cornerPartStep();

  it("is sheet-like: nearly all planar area has a partner face at thickness distance", () => {
    const f = facts(text);
    expect(f.thicknessMm).toBe(T);
    expect(f.pairedShare).toBeGreaterThan(0.9);
    expect(f.sheetLike).toBe(true);
  });

  it("unfolds with three bends in two directions, both holes, one closed outline, and the model volume within 1 %", () => {
    const g = analyseStepSync(text);
    expect(g.triage.state).toBe("green");
    expect(g.sheet?.isSheetMetal).toBe(true);
    expect(g.sheet?.bends).toHaveLength(3);
    expect(g.measures.bendLines.map((b) => b.direction).sort()).toEqual(["down", "up", "up"]);
    expect(g.measures.holes).toHaveLength(2);
    expect(g.loops.filter((l) => l.kind === "outer")).toHaveLength(1);
    expect(g.partCount).toBe(1);
    const { A, B, wall, end, notch } = CORNER_DEFAULTS;
    const flange = CORNER_DEFAULTS.flange as number;
    // Along y: top plate B, wall, base flange, two allowances; along x: plate A, end face, one allowance (mid-surface sizes).
    const dims = [g.measures.bbox.width, g.measures.bbox.height].sort((a, b) => a - b);
    expect(dims[1]).toBeCloseTo(B + wall + flange + 2 * BA, 1);
    expect(dims[0]).toBeCloseTo(A + end + BA, 1);
    expect(g.measures.bendLines.map((b) => Math.round(b.lengthMm)).sort((a, b) => a - b)).toEqual([B - notch, A - notch, A - notch]);
    expect(Math.abs(g.sheet!.solidVolumeMm3! - cornerPartVolumeMm3()) / cornerPartVolumeMm3()).toBeLessThan(0.01);
    expect(Math.abs(g.sheet!.solidVolumeMm3! - g.sheet!.flatVolumeMm3) / g.sheet!.flatVolumeMm3).toBeLessThan(0.02);
  });
});

describe("wall with bends on two adjacent edges and a corner relief", () => {
  it("unfolds to one closed outer loop holding both bend strips and the relief notch; opposite bend directions", () => {
    const g = analyseStepSync(cornerPartStep({ flange: null, endDir: "up", notch: 4 + R + T / 2 }));
    expect(g.triage.state).toBe("green");
    expect(g.triage.reasons).not.toContain("multi_part");
    expect(g.partCount).toBe(1);
    const outer = g.loops.filter((l) => l.kind === "outer");
    expect(outer).toHaveLength(1);
    expect(g.loops.filter((l) => l.kind === "open_chain" && l.closed)).toEqual([]);
    expect(g.measures.holes).toHaveLength(2);
    expect(g.sheet?.bends).toHaveLength(2);
    expect(g.measures.bendLines.map((b) => b.direction).sort()).toEqual(["down", "up"]);
    // The outline is far bigger than a hole: the hole did not become the outer loop.
    expect(g.measures.bbox.width).toBeGreaterThan(200);
    expect(g.measures.bbox.height).toBeGreaterThan(200);
    // Relief: the notch keeps the two strips apart, so their ends are inside the bbox.
    for (const b of g.sheet!.bends) expect(b.lengthMm).toBeLessThan(Math.max(g.measures.bbox.width, g.measures.bbox.height) - 4);
  });
});

describe("not a sheet", () => {
  it("a 640 × 230 × 50 block has partner faces but no sheet-like face pair ratio", () => {
    const f = facts(buildStep([{ outer: rect(640, 230), height: 50 }]));
    expect(f.thicknessMm).toBe(50);
    // Its two big faces pair at 50 mm: the block IS sheet-like by geometry — the solid-block hint is what tells it apart.
    expect(f.sheetLike).toBe(true);
  });

  it("a stud is never sheet-like", () => {
    const f = facts(buildStep([{ outer: { start: { x: 4, y: 0 }, segments: [{ kind: "arc", to: { x: -4, y: 0 }, center: { x: 0, y: 0 }, ccw: true }, { kind: "arc", to: { x: 4, y: 0 }, center: { x: 0, y: 0 }, ccw: true }] }, height: 20 }]));
    expect(f.sheetLike).toBe(false);
  });
});
