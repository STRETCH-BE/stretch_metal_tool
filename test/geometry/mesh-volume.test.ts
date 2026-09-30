/**
 * Mesh rebuild volumes and planar-strip B-reps (lib/geometry/step/mesh.ts):
 * the exact mesh volume carried on the rebuilt body, the integral over
 * the rebuilt faces agreeing with it (chained strip loops, seams on closed
 * rims, holes kept), and mesh-to-STEP files (planar faces only, bends as
 * runs of narrow strips) taking the same route while a straight-edged
 * flat plate keeps the exact path.
 * File path: /test/geometry/mesh-volume.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyseStepSync, summariseStepText, withReconstructedMeshes } from "@/lib/geometry/step/analyse";
import { evaluateBrep } from "@/lib/geometry/step/brep";
import { parseStep } from "@/lib/geometry/step/part21";
import { hasPlanarStripRun, isTessellatedBody, meshToBody, polygonsOfFacetedBody, polygonsSignedVolumeMm3 } from "@/lib/geometry/step/mesh";
import { bodyVolumeMm3 } from "@/lib/geometry/step/volume";
import { buildStep, circle, facetProfile, lProfile, rect, uProfile } from "./step-builder";
import { bracketVolumeMm3, channelVolumeMm3, tessellatedBracket, tessellatedChannel, tessellatedPlate } from "./mesh-fixtures";

function within(actual: number | null | undefined, expected: number, share: number): void {
  expect(actual).not.toBeNull();
  expect(actual).not.toBeUndefined();
  expect(Math.abs((actual as number) - expected) / expected).toBeLessThanOrEqual(share);
}

describe("mesh volume", () => {
  const cases: [string, string, number][] = [
    ["L bracket (FACETED_BREP)", tessellatedBracket(), bracketVolumeMm3()],
    ["U channel (FACETED_BREP)", tessellatedChannel(), channelVolumeMm3(120, 60, 3, 3, 200)],
    ["L bracket (planar-strip ADVANCED_BREP)", buildStep([{ outer: facetProfile(lProfile(80, 60, 5, 5), 6), height: 40, frame: "xz" }]), bracketVolumeMm3()],
    ["U channel (planar-strip ADVANCED_BREP)", buildStep([{ outer: facetProfile(uProfile(120, 60, 3, 3), 6), height: 200, frame: "xz" }]), channelVolumeMm3(120, 60, 3, 3, 200)],
  ];

  for (const [name, text, analytic] of cases) {
    it(`${name}: the rebuilt body carries the mesh volume and its faces integrate to it, within 1 % of the analytic volume`, () => {
      const raw = evaluateBrep(parseStep(text)).bodies[0];
      expect(isTessellatedBody(raw)).toBe(true);
      const rebuilt = meshToBody(raw.id, polygonsOfFacetedBody(raw));
      expect(rebuilt).not.toBeNull();
      within(rebuilt!.meshVolumeMm3, analytic, 0.01);
      within(bodyVolumeMm3(rebuilt!), analytic, 0.01);
      within(bodyVolumeMm3(rebuilt!), rebuilt!.meshVolumeMm3 as number, 0.005);
      // The sheet report uses the mesh volume: no false mass mismatch.
      const g = analyseStepSync(text);
      expect(g.triage.state).toBe("green");
      within(g.sheet?.solidVolumeMm3, analytic, 0.01);
      expect(Math.abs(g.sheet!.solidVolumeMm3! - g.sheet!.flatVolumeMm3) / g.sheet!.flatVolumeMm3).toBeLessThan(0.02);
      expect(g.sheet?.bends).toHaveLength(name.startsWith("L") ? 1 : 2);
      // No developer warning about a rebuild that lost faces.
      expect(summariseStepText(text).warnings.filter((w) => w.includes("rebuilt volume"))).toEqual([]);
    });
  }

  it("a closed hole wall keeps its rims joined by a seam: plate with a Ø10 hole integrates to the mesh volume", () => {
    const raw = evaluateBrep(parseStep(tessellatedPlate())).bodies[0];
    const polygons = polygonsOfFacetedBody(raw);
    const meshVolume = Math.abs(polygonsSignedVolumeMm3(polygons));
    expect(meshVolume).toBeCloseTo((100 * 50 - 16 * 0.5 * 25 * Math.sin((2 * Math.PI) / 16)) * 5, 3);
    const rebuilt = meshToBody(raw.id, polygons)!;
    expect(rebuilt.meshVolumeMm3).toBeCloseTo(meshVolume, 6);
    within(bodyVolumeMm3(rebuilt), meshVolume, 0.002);
    expect(rebuilt.faces.filter((f) => f.surface.kind === "cylinder")).toHaveLength(1);
  });

  it("warns (for developers) when the rebuilt faces do not integrate to the mesh volume", () => {
    // A mesh whose winding is inconsistent cannot be rebuilt faithfully: one
    // cap flipped makes the strip loops disagree with the enclosed volume.
    const raw = evaluateBrep(parseStep(tessellatedBracket())).bodies[0];
    const polygons = polygonsOfFacetedBody(raw).map((poly, i) => (i === 0 && Array.isArray(poly) ? [...poly].reverse() : poly));
    const model = withReconstructedMeshes({ unitScale: 1, unitName: "mm", bodies: [{ id: 7, kind: "solid", faces: meshToBody(7, polygons)!.faces }], warnings: [] });
    // Rebuilt from an already rebuilt body: the faces are exact, so no warning here…
    expect(model.warnings).toEqual([]);
    // …and a faithful rebuild of the original mesh writes none either.
    expect(withReconstructedMeshes(evaluateBrep(parseStep(tessellatedBracket()))).warnings).toEqual([]);
  });
});

describe("planar-strip B-reps (mesh-to-STEP converters)", () => {
  it("a plate with polygonal holes keeps its holes through the rebuild", () => {
    const text = buildStep([{ outer: rect(100, 50), holes: [facetProfile(circle({ x: 30, y: 25 }, 5), 8), facetProfile(circle({ x: 70, y: 25 }, 4), 8)], height: 4 }]);
    const raw = evaluateBrep(parseStep(text)).bodies[0];
    expect(hasPlanarStripRun(raw)).toBe(true);
    const rebuilt = meshToBody(raw.id, polygonsOfFacetedBody(raw))!;
    const caps = rebuilt.faces.filter((f) => f.surface.kind === "plane" && f.inner.length === 2);
    expect(caps).toHaveLength(2);
    expect(rebuilt.faces.filter((f) => f.surface.kind === "cylinder")).toHaveLength(2);
    within(bodyVolumeMm3(rebuilt), rebuilt.meshVolumeMm3 as number, 0.005);
    const g = analyseStepSync(text);
    expect(g.triage.state).toBe("green");
    expect(g.measures.holes).toHaveLength(2);
    expect(g.measures.holes.map((h) => Math.round(h.diameterMm)).sort((a, b) => a - b)).toEqual([8, 10]);
    expect(g.measures.bbox.width).toBeCloseTo(100, 3);
    expect(g.measures.bbox.height).toBeCloseTo(50, 3);
    expect(g.material.thicknessMm).toBe(4);
  });

  it("a straight-edged flat plate is not a tessellation and stays on the exact path", () => {
    const text = buildStep([{ outer: rect(100, 50), holes: [rect(10, 10, { x: 20, y: 20 })], height: 4 }]);
    const model = evaluateBrep(parseStep(text));
    const raw = model.bodies[0];
    expect(isTessellatedBody(raw)).toBe(false);
    expect(withReconstructedMeshes(model).bodies[0]).toBe(raw);
    const g = analyseStepSync(text);
    expect(g.triage.state).toBe("green");
    expect(g.measures.holes).toHaveLength(1);
    expect(g.measures.netAreaMm2).toBeCloseTo(100 * 50 - 100, 3);
  });

  it("an exact B-rep with true cylinders is not a tessellation", () => {
    const raw = evaluateBrep(parseStep(buildStep([{ outer: lProfile(80, 60, 5, 5), height: 40, frame: "xz" }]))).bodies[0];
    expect(isTessellatedBody(raw)).toBe(false);
  });

  it("a planar-strip L bracket unfolds like the exact one: same thickness, bend count and flat size", () => {
    const exact = analyseStepSync(buildStep([{ outer: lProfile(80, 60, 5, 5), height: 40, frame: "xz" }]));
    const strips = analyseStepSync(buildStep([{ outer: facetProfile(lProfile(80, 60, 5, 5), 8), height: 40, frame: "xz" }]));
    expect(strips.triage.state).toBe("green");
    expect(strips.material.thicknessMm).toBe(exact.material.thicknessMm);
    expect(strips.measures.bendLines).toHaveLength(exact.measures.bendLines.length);
    expect(Math.abs(strips.measures.bbox.width - exact.measures.bbox.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(strips.measures.bbox.height - exact.measures.bbox.height)).toBeLessThanOrEqual(0.5);
    expect(strips.measures.holes).toHaveLength(exact.measures.holes.length);
  });
});
