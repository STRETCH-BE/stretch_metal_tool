/**
 * Annotations — role tags, deletions, scale, mirror, welds, threads, amber answers.
 * File path: /test/geometry/annotate.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyzeDxfSync, applyAnnotationsSync, EMPTY_ANNOTATIONS, geometryEngine, weldEffectiveLength, type PartAnnotations, type WeldAnnotation } from "@/lib/geometry";
import { buildDxf, circle, line, rectLines } from "./dxf-builder";

const base = () =>
  analyzeDxfSync(buildDxf({ entities: [...rectLines(0, 0, 100, 50), circle(20, 25, 2.5), circle(80, 25, 5), line(50, 0, 50, 50)] }), {
    thicknessMm: 3,
    densityKgM3: 7850,
  });

const ann = (patch: Partial<PartAnnotations>): PartAnnotations => ({ ...EMPTY_ANNOTATIONS, ...patch });

describe("applyAnnotations", () => {
  it("turns tagged candidates into bend lines and green", async () => {
    const g = base();
    expect(g.triage.state).toBe("amber_bend_candidates");
    const [candidate] = g.triage.candidateEntityIds;
    const out = await geometryEngine.applyAnnotations(g, ann({ entities: { [candidate]: { role: "bend_up" } } }));
    expect(out.triage.state).toBe("green");
    expect(out.triage.reasons).toEqual(["bend_layers_found"]);
    expect(out.triage.candidateEntityIds).toEqual([]);
    expect(out.measures.bendLines).toHaveLength(1);
    expect(out.measures.bendLines[0]).toMatchObject({ entityId: candidate, direction: "up", source: "drawn", lengthMm: 50 });
    expect(out.entities.find((e) => e.id === candidate)?.role).toBe("bend_up");
    // the geometry snapshot is untouched
    expect(g.triage.state).toBe("amber_bend_candidates");
    expect(out.measures.cutLengthMm).toBeCloseTo(g.measures.cutLengthMm, 9);
  });

  it("ignores a tagged entity and removes deleted loops from pricing", () => {
    const g = base();
    const [candidate] = g.triage.candidateEntityIds;
    const ignored = applyAnnotationsSync(g, ann({ entities: { [candidate]: { role: "ignore" } } }));
    expect(ignored.triage.state).toBe("green");
    expect(ignored.entities.find((e) => e.id === candidate)).toMatchObject({ role: "ignore", loopId: null });
    const bigHole = g.measures.holes.find((h) => h.diameterMm > 9)!;
    const deleted = applyAnnotationsSync(g, ann({ entities: { [candidate]: { role: "cut" } }, deletedEntityIds: [bigHole.loopId] }));
    expect(deleted.measures.holes).toHaveLength(1);
    expect(deleted.triage.state).toBe("green");
    // a cut-tagged open line is no candidate; it is priced as an open cut (its length + one pierce)
    expect(deleted.entities.find((e) => e.id === candidate)?.role).toBe("cut");
    expect(deleted.measures.openCuts).toBe(1);
    expect(deleted.measures.openCutsLengthMm).toBeCloseTo(50, 6);
    expect(deleted.measures.cutLengthMm).toBeCloseTo(300 + 2 * Math.PI * 2.5 + 50, 6);
    expect(deleted.measures.pierces).toBe(3);
  });

  it("applies a scale factor of 2 (lengths ×2, areas ×4, ids kept)", () => {
    const g = base();
    const [candidate] = g.triage.candidateEntityIds;
    const out = applyAnnotationsSync(
      g,
      ann({
        entities: { [candidate]: { role: "bend_down" } },
        scale: { factor: 2, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, measuredMm: 100, realMm: 200 },
      })
    );
    expect(out.measures.cutLengthMm).toBeCloseTo(2 * g.measures.cutLengthMm, 6);
    expect(out.measures.bbox.width).toBeCloseTo(200, 6);
    expect(out.measures.netAreaMm2).toBeCloseTo(4 * g.measures.netAreaMm2, 6);
    expect(out.measures.massKg).toBeCloseTo(4 * (g.measures.massKg ?? 0), 6);
    expect(out.measures.bendLines[0].lengthMm).toBeCloseTo(100, 6);
    expect(out.measures.holes.map((h) => h.diameterMm).sort((a, b) => a - b)).toEqual([expect.closeTo(10, 6), expect.closeTo(20, 6)]);
    expect(out.entities.map((e) => e.id).sort()).toEqual(g.entities.map((e) => e.id).sort());
  });

  it("mirrors the outline on X", () => {
    const g = base();
    const [candidate] = g.triage.candidateEntityIds;
    const out = applyAnnotationsSync(g, ann({ entities: { [candidate]: { role: "ignore" } }, mirrored: true }));
    expect(out.measures.bbox.minX).toBeCloseTo(-100, 6);
    expect(out.measures.bbox.maxX).toBeCloseTo(0, 6);
    expect(out.measures.cutLengthMm).toBeCloseTo(g.measures.cutLengthMm, 6);
    expect(out.measures.holes.find((h) => h.diameterMm > 9)?.center.x).toBeCloseTo(-80, 6);
  });

  it("recomputes stitch weld effective lengths (30/60 × 2 sides) and sums them", () => {
    const weld: WeldAnnotation = {
      id: "w1",
      entityIds: [],
      points: [{ x: 0, y: 0 }, { x: 60, y: 0 }],
      lengthMm: 0,
      process: "mig_mag",
      beadMm: 4,
      pattern: "stitch",
      stitch: { beadLengthMm: 30, pitchMm: 60 },
      sides: 2,
      effectiveLengthMm: 999,
    };
    expect(weldEffectiveLength({ ...weld, lengthMm: 60 })).toBe(60);
    const g = base();
    const [candidate] = g.triage.candidateEntityIds;
    const out = applyAnnotationsSync(g, ann({ entities: { [candidate]: { role: "weld" } }, welds: [weld, { ...weld, id: "w2", pattern: "full", stitch: null, sides: 1, points: null, entityIds: [candidate] }] }));
    // w1: 60 × 0.5 × 2 = 60 ; w2: entity length 50 × 1 × 1 = 50
    expect(out.measures.weldLengthMm).toBeCloseTo(110, 6);
    expect(out.entities.find((e) => e.id === candidate)?.role).toBe("weld");
    expect(out.triage.state).toBe("green");
  });

  it("adds drawn bends with their angle source and dedupes by entity", () => {
    const g = base();
    const [candidate] = g.triage.candidateEntityIds;
    const out = applyAnnotationsSync(
      g,
      ann({
        entities: { [candidate]: { role: "bend_up" } },
        bends: [
          { id: "b1", entityId: null, start: { x: 0, y: 10 }, end: { x: 100, y: 10 }, lengthMm: 0, angleDeg: 90, radiusMm: null, direction: "down", dieVMm: null },
          { id: "b2", entityId: candidate, start: { x: 50, y: 0 }, end: { x: 50, y: 50 }, lengthMm: 50, angleDeg: 45, radiusMm: null, direction: "up", dieVMm: null },
        ],
      })
    );
    expect(out.measures.bendLines).toHaveLength(2);
    expect(out.measures.bendLines.find((b) => b.id === "b1")).toMatchObject({ direction: "down", lengthMm: 100, source: "drawn", entityId: null });
    expect(out.measures.bendLines.find((b) => b.id === "b2")).toMatchObject({ entityId: candidate, source: "drawn" });
  });

  it("applies thread confirmations", () => {
    const g = base();
    const [candidate] = g.triage.candidateEntityIds;
    const small = g.measures.holes.find((h) => h.diameterMm < 6)!;
    const big = g.measures.holes.find((h) => h.diameterMm > 9)!;
    expect(small.thread?.size).toBe("M6"); // Ø5 = M6 tap drill
    const out = applyAnnotationsSync(g, ann({ entities: { [candidate]: { role: "ignore" } }, threads: { [small.loopId]: null, [big.loopId]: "M12" } }));
    expect(out.measures.holes.find((h) => h.loopId === small.loopId)?.thread).toBeNull();
    expect(out.measures.holes.find((h) => h.loopId === big.loopId)?.thread).toMatchObject({ size: "M12" });
  });

  it("answers amber questions", () => {
    const inch = analyzeDxfSync(buildDxf({ insunits: 1, entities: rectLines(0, 0, 4, 2) }));
    expect(inch.triage.state).toBe("amber_units");
    expect(applyAnnotationsSync(inch, ann({ unitsConfirmed: true })).triage.state).toBe("green");
    const forming = analyzeDxfSync(buildDxf({ entities: rectLines(0, 0, 100, 50) }), { name: "bent part" });
    expect(forming.triage.state).toBe("amber_forming_unknown");
    expect(applyAnnotationsSync(forming, ann({ forming: "flat" }), { name: "bent part" }).triage.state).toBe("green");
    expect(applyAnnotationsSync(forming, ann({ roll: { radiusMm: 50, axis: "x", arcAngleDeg: 90, axisLengthMm: 100, developedWidthMm: 50, cone: null } }), { name: "bent part" }).triage.state).toBe("green");
    // without an answer it stays amber when the name is passed again
    expect(applyAnnotationsSync(forming, ann({}), { name: "bent part" }).triage.state).toBe("amber_forming_unknown");
  });

  it("uses new thickness/density when given and keeps the stored ones otherwise", () => {
    const g = base();
    const [candidate] = g.triage.candidateEntityIds;
    const same = applyAnnotationsSync(g, ann({ entities: { [candidate]: { role: "ignore" } } }));
    expect(same.material).toEqual({ thicknessMm: 3, densityKgM3: 7850 });
    expect(same.measures.massKg).toBeCloseTo(g.measures.massKg ?? 0, 9);
    const thicker = applyAnnotationsSync(g, ann({ entities: { [candidate]: { role: "ignore" } } }), { thicknessMm: 6 });
    expect(thicker.measures.massKg).toBeCloseTo(2 * (g.measures.massKg ?? 0), 9);
  });
});
