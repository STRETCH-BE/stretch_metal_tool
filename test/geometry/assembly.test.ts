/**
 * STEP assemblies (lib/geometry/step/assembly.ts) through splitModelSync:
 * product names, occurrence counts, and per-solid files that analyse
 * exactly like the single part.
 * File path: /test/geometry/assembly.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyseStepSync, splitModelSync } from "@/lib/geometry/step/analyse";
import { parseStep } from "@/lib/geometry/step/part21";
import { stepBodyInfos } from "@/lib/geometry/step/assembly";
import { circle, lProfile, rect, writeExtrudedStep, FRAME_XZ } from "@/lib/geometry/step/write-step";

const PLATE = { outer: rect(100, 50), holes: [circle({ x: 30, y: 25 }, 5)], height: 5 };
const BRACKET = { outer: lProfile(80, 60, 5, 5), height: 40, frame: FRAME_XZ };

describe("assembly", () => {
  it("names the solids after their products and counts placements", () => {
    const text = writeExtrudedStep([PLATE, BRACKET], { products: [{ name: "Platte t5", occurrences: 2 }, { name: "Winkel t5" }] });
    const infos = Array.from(stepBodyInfos(parseStep(text)).values());
    expect(infos.map((i) => [i.name, i.occurrences])).toEqual([
      ["Platte t5", 2],
      ["Winkel t5", 1],
    ]);
  });

  it("splits into one analysed part per solid, each equal to the single-part analysis", () => {
    const text = writeExtrudedStep([PLATE, BRACKET], { products: [{ name: "Platte t5", occurrences: 2 }, { name: "Winkel t5" }] });
    const split = splitModelSync(text);
    expect(split.format).toBe("step");
    expect(split.parts.map((p) => [p.name, p.occurrences])).toEqual([
      ["Platte t5", 2],
      ["Winkel t5", 1],
    ]);
    const [plate, bracket] = split.parts;
    expect(plate.stepText).toContain("FILE_NAME('Platte t5.step'");
    expect(plate.stepText).toContain("ADVANCED_BREP_SHAPE_REPRESENTATION('Platte t5'");
    expect(plate.geometry.triage.state).toBe("green");
    expect(plate.geometry.measures.pierces).toBe(2);
    expect(bracket.geometry.triage.state).toBe("green");
    expect(bracket.geometry.measures.bendLines).toHaveLength(1);
    // The extracted file analyses like the part written on its own.
    const single = analyseStepSync(writeExtrudedStep([PLATE]), { name: "Platte t5" });
    expect(plate.geometry.measures).toEqual(single.measures);
    expect(analyseStepSync(plate.stepText as string).entities.map((e) => e.id)).toEqual(single.entities.map((e) => e.id));
  });

  it("keeps a single-body file as one part without a derived file", () => {
    const split = splitModelSync(writeExtrudedStep([PLATE]), { name: "plate" });
    expect(split.parts).toHaveLength(1);
    expect(split.parts[0].stepText).toBeNull();
    expect(split.parts[0].name).toBe("plate");
  });
});
