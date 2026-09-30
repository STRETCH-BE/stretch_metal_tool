/**
 * Multi-body STEP files through splitModelSync: no body is dropped in
 * silence — every solid ends as a part, as hardware carried by a sheet
 * part, or as a warning. A bent part written as planar strips (the
 * mesh-to-STEP form) is a part, never a hardware line; a block is its own
 * not-sheet-metal part with body hints.
 * File path: /test/geometry/split-invariant.test.ts
 */
import { describe, expect, it } from "vitest";
import { splitModelSync } from "@/lib/geometry/step/analyse";
import { evaluateBrep } from "@/lib/geometry/step/brep";
import { parseStep } from "@/lib/geometry/step/part21";
import { circle, facetProfile, lProfile, rect, writeExtrudedStep, FRAME_XZ } from "@/lib/geometry/step/write-step";

const PLATE = { outer: rect(200, 100), holes: [circle({ x: 50, y: 50 }, 5)], height: 4 };
const STRIP_BRACKET = { outer: facetProfile(lProfile(80, 60, 4, 4), 6), height: 40, frame: FRAME_XZ };
const STUD = { outer: circle({ x: 150, y: 50 }, 4), height: 12, frame: { origin: { x: 0, y: 0, z: 4 }, axis: { x: 0, y: 0, z: 1 }, ref: { x: 1, y: 0, z: 0 } } };
const BLOCK = { outer: rect(640, 230), height: 50 };

/** Every solid id of the file appears in a part's derived STEP (as the part or as hardware) or in the warnings. */
function assertNoSilentDrop(text: string): ReturnType<typeof splitModelSync> {
  const split = splitModelSync(text);
  const ids = evaluateBrep(parseStep(text)).bodies.map((b) => b.id);
  for (const id of ids) {
    const inPart = split.parts.some((p) => p.stepText === null || new RegExp(`#${id} = (MANIFOLD_SOLID_BREP|FACETED_BREP)`).test(p.stepText));
    const warned = split.warnings.some((w) => w.includes(`#${id}`));
    expect(inPart || warned, `body #${id}`).toBe(true);
  }
  return split;
}

describe("split invariant", () => {
  it("plate + planar-strip bracket + stud: two parts, the stud as hardware on the plate, no warnings", () => {
    const text = writeExtrudedStep([PLATE, STRIP_BRACKET, STUD], { products: [{ name: "Platte" }, { name: "Winkel-003-001" }, { name: "Bolzen" }] });
    const split = assertNoSilentDrop(text);
    expect(split.warnings).toEqual([]);
    expect(split.parts.map((p) => p.name)).toEqual(["Platte", "Winkel-003-001"]);
    const [plate, bracket] = split.parts;
    expect(plate.geometry.triage.state).toBe("green");
    expect(plate.geometry.sheet?.hardwareBodies).toBe(1);
    expect(plate.geometry.sheet?.hardware.map((h) => h.kind)).toEqual(["weld_stud"]);
    expect(bracket.geometry.triage.state).toBe("green");
    expect(bracket.geometry.sheet?.bends).toHaveLength(1);
    expect(bracket.geometry.sheet?.hardwareBodies).toBe(0);
  });

  it("plate + block: the block is its own not-sheet-metal part with body hints, not hardware", () => {
    const text = writeExtrudedStep([PLATE, BLOCK], { products: [{ name: "Sockelplatte" }, { name: "Schnitt-Linear austragen5" }] });
    const split = assertNoSilentDrop(text);
    expect(split.warnings).toEqual([]);
    expect(split.parts.map((p) => p.name)).toEqual(["Sockelplatte", "Schnitt-Linear austragen5"]);
    // The block's two big faces pair at 50 mm, so geometry alone reads it as a
    // 50 mm plate (the customer symptom); the hints carry what tells it apart.
    const block = split.parts[1].geometry;
    expect(block.triage.state).toBe("green");
    expect(block.material.thicknessMm).toBe(50);
    expect(block.sheet?.bodyHints).toMatchObject({ featureName: "Schnitt-Linear austragen", solidBlock: true, sliver: false, notSheet: false, bboxMm: [640, 230, 50] });
    expect(split.parts[0].geometry.sheet?.bodyHints).toMatchObject({ featureName: null, solidBlock: false, sliver: false, notSheet: false });
    expect(split.parts[0].geometry.sheet?.hardwareBodies).toBe(0);
  });

  it("a single big block file is one part with hints", () => {
    const split = splitModelSync(writeExtrudedStep([BLOCK]), { name: "Aufsatz-Linear austragen6[1]" });
    expect(split.parts).toHaveLength(1);
    expect(split.parts[0].geometry.sheet?.bodyHints?.featureName).toBe("Aufsatz-Linear austragen");
    expect(split.parts[0].geometry.sheet?.bodyHints?.solidBlock).toBe(true);
  });
});
