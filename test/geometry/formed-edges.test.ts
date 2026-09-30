/**
 * Formed edges a press brake cannot make (lib/geometry/step/unfold.ts
 * findFormedEdges → SheetReport.formedEdges → dfm.not_press_brake_formable):
 * a toroidal or free-form wall at sheet thickness is reported with its
 * length; plain bends, edge fillets and hole walls are not.
 * File path: /test/geometry/formed-edges.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyseStepSync } from "@/lib/geometry/step/analyse";
import { evaluateBrep, type Body3, type Face3 } from "@/lib/geometry/step/brep";
import { parseStep } from "@/lib/geometry/step/part21";
import { bendGroups, findFormedEdges, unfoldBody, din6935Allowance } from "@/lib/geometry/step/unfold";
import { evaluateDfmFlags } from "@/lib/pricing/dfm";
import { buildStep, circle, lProfile, rect } from "./step-builder";

function torusFace(id: number, length: number): Face3 {
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: length, y: 0, z: 0 };
  const line = (start: typeof a, end: typeof a, eid: number) => ({ edge: { id: eid, start, end, curve: { kind: "line" as const, point: start, dir: { x: 1, y: 0, z: 0 } }, sameSense: true }, orientation: true });
  return {
    id,
    surface: { kind: "torus", placement: { origin: a, axis: { x: 0, y: 0, z: 1 }, ref: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 } }, majorRadius: 40, minorRadius: 3 },
    sameSense: true,
    outer: { id: id * 10, edges: [line(a, b, -100), line(b, a, -101)] },
    inner: [],
  };
}

describe("formed edges", () => {
  it("a bracket has none: its bends are cylinders between two flange tangent lines", () => {
    const body = evaluateBrep(parseStep(buildStep([{ outer: lProfile(80, 60, 5, 5), height: 40, frame: "xz" }]))).bodies[0];
    const groups = bendGroups(body, 5);
    expect(findFormedEdges(body, groups, groups, 5, 0.05)).toEqual([]);
    const u = unfoldBody(body, { thicknessMm: 5, unitScale: 1, allowance: (a, r) => ({ allowanceMm: din6935Allowance(a, r, 5), source: "din6935_formula" }) });
    expect(u?.formedEdges).toEqual([]);
  });

  it("a plate with a round hole has none: a hole wall is not a formed edge", () => {
    const g = analyseStepSync(buildStep([{ outer: rect(100, 50), holes: [circle({ x: 30, y: 25 }, 5)], height: 5 }]));
    expect(g.sheet?.formedEdges).toBeUndefined();
  });

  it("a toroidal wall at sheet thickness is reported with its length and raises the amber flag", () => {
    const base = evaluateBrep(parseStep(buildStep([{ outer: lProfile(80, 60, 2, 2), height: 40, frame: "xz" }]))).bodies[0];
    const body: Body3 = { ...base, faces: [...base.faces, torusFace(900, 120)] };
    const groups = bendGroups(body, 2);
    const edges = findFormedEdges(body, groups, groups, 2, 0.05);
    expect(edges).toEqual([{ kind: "torus", lengthMm: 120 }]);
    const u = unfoldBody(body, { thicknessMm: 2, unitScale: 1, allowance: (a, r) => ({ allowanceMm: din6935Allowance(a, r, 2), source: "din6935_formula" }) });
    expect(u?.formedEdges).toEqual(edges);
    const g = analyseStepSync(buildStep([{ outer: lProfile(80, 60, 2, 2), height: 40, frame: "xz" }]));
    const report = { ...g.sheet!, formedEdges: edges };
    const flags = evaluateDfmFlags({ partId: "p", itemId: "i", geometry: g, sheet: report, thicknessMm: 2, kerfMm: null, tools: [] });
    const flag = flags.find((f) => f.code === "dfm.not_press_brake_formable");
    expect(flag?.severity).toBe("amber");
    expect(flag?.params).toMatchObject({ count: 1, lengthMm: 120, kinds: "torus" });
  });
});
