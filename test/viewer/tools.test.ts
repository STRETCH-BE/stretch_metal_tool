/**
 * Viewer reducers — tags, drawn bends, welds, roll, calibration, clean-up.
 * File path: /test/viewer/tools.test.ts
 */
import { describe, expect, it } from "vitest";
import { EMPTY_ANNOTATIONS, type PartAnnotations } from "@/lib/geometry/types";
import { applyAnnotationsSync } from "@/lib/geometry/annotate";
import { makeAnnotations, makeRectPartGeometry } from "@/test/helpers/geometry";
import { make200164Like } from "@/test/helpers/parts";
import { annotationsSchema, weldAnnotationSchema } from "@/lib/parts/schema";
import {
  STITCH_PITCH_MIN_MM,
  addDrawnBend,
  addWeldFromEntities,
  addWeldFromPoints,
  annotationCount,
  bendDefaults,
  clampJoinTolerance,
  clearRoll,
  clearScale,
  currentScaleFactor,
  deleteSelection,
  ignoreSelection,
  isWeldFormValid,
  joinWithinTolerance,
  keepLargestContour,
  mirror,
  nextId,
  previewWeldEffectiveLength,
  removeAnnotation,
  restoreDeleted,
  scalePreview,
  setRoll,
  setScale,
  splitIntoParts,
  tagEntities,
  untagEntities,
  updateWeld,
  weldDefaults,
  weldFormIssue,
  type WeldForm,
} from "@/lib/viewer/tools";

const g = make200164Like();
const frozen = (a: PartAnnotations) => JSON.stringify(a);

describe("tag tool", () => {
  it("sets role overrides without mutating the input", () => {
    const before = makeAnnotations();
    const snapshot = frozen(before);
    const next = tagEntities(before, ["hole-1", "hole-2"], "engrave");
    expect(next.entities).toEqual({ "hole-1": { role: "engrave" }, "hole-2": { role: "engrave" } });
    expect(frozen(before)).toBe(snapshot);
    expect(next).not.toBe(before);
    expect(tagEntities(before, [], "cut")).toBe(before);
  });

  it("creates a bend annotation per tagged entity with the form values", () => {
    const form = bendDefaults(2, "up");
    expect(form).toEqual({ angleDeg: 90, radiusMm: 2, direction: "up", dieVMm: null });
    const next = tagEntities(makeAnnotations(), ["bend-down-1"], "bend_up", { ...form, angleDeg: 45, dieVMm: 16 }, g.entities);
    expect(next.entities["bend-down-1"]).toEqual({ role: "bend_up" });
    expect(next.bends).toHaveLength(1);
    expect(next.bends[0]).toMatchObject({ id: "bend-1", entityId: "bend-down-1", angleDeg: 45, radiusMm: 2, direction: "up", dieVMm: 16, lengthMm: 60 });
    expect(next.bends[0].start).toEqual({ x: -1.131, y: -60 });
    // re-tagging as bend_down replaces the form, tagging as cut removes it
    const down = tagEntities(next, ["bend-down-1"], "bend_down", form, g.entities);
    expect(down.bends).toHaveLength(1);
    expect(down.bends[0].direction).toBe("down");
    expect(tagEntities(down, ["bend-down-1"], "cut").bends).toEqual([]);
    expect(untagEntities(down, ["bend-down-1"])).toEqual(makeAnnotations());
    // the engine reads it back as a drawn bend line
    const out = applyAnnotationsSync(g, next);
    const line = out.measures.bendLines.find((b) => b.entityId === "bend-down-1");
    expect(line).toMatchObject({ direction: "up", source: "drawn", lengthMm: 60 });
  });
});

describe("bends and welds", () => {
  it("adds a drawn bend with its computed length", () => {
    const a = addDrawnBend(makeAnnotations(), { x: 0, y: 0 }, { x: 30, y: 40 }, bendDefaults(3, "down"));
    expect(a.bends[0]).toMatchObject({ id: "bend-1", entityId: null, lengthMm: 50, angleDeg: 90, radiusMm: 3, direction: "down" });
    const b = addDrawnBend(a, { x: 0, y: 0 }, { x: 0, y: 10 }, bendDefaults(null, "up"));
    expect(b.bends[1].id).toBe("bend-2");
    expect(b.bends[1].radiusMm).toBeNull();
    expect(addDrawnBend(b, { x: 1, y: 1 }, { x: 1, y: 1 }, bendDefaults(3))).toBe(b);
    expect(nextId("bend", [{ id: "bend-7" }, { id: "weld-9" }, { id: "x" }])).toBe("bend-8");
  });

  it("welds from a chain of entities: length × bead/pitch × sides", () => {
    const form = weldDefaults(2);
    expect(form.beadMm).toBe(2);
    expect(form.stitch).toEqual({ beadLengthMm: 30, pitchMm: 60 });
    const full = addWeldFromEntities(makeAnnotations(), g.entities, ["bend-up-1", "bend-down-1"], form);
    expect(full.welds[0]).toMatchObject({ id: "weld-1", entityIds: ["bend-up-1", "bend-down-1"], points: null, lengthMm: 120, effectiveLengthMm: 120, stitch: null, sides: 1 });
    const stitch = addWeldFromEntities(full, g.entities, ["outer"], { ...form, pattern: "stitch", sides: 2 });
    const w = stitch.welds[1];
    expect(w.lengthMm).toBeCloseTo(2 * (554.3 + 60), 9);
    expect(w.effectiveLengthMm).toBeCloseTo(2 * (554.3 + 60) * 0.5 * 2, 9);
    expect(w.stitch).toEqual({ beadLengthMm: 30, pitchMm: 60 });
    expect(previewWeldEffectiveLength({ ...form, pattern: "stitch", stitch: { beadLengthMm: 20, pitchMm: 80 }, sides: 2 }, 1000)).toBeCloseTo(500, 9);
    expect(addWeldFromEntities(full, g.entities, ["nope"], form)).toBe(full);
    // the engine sums the effective lengths
    expect(applyAnnotationsSync(g, stitch).measures.weldLengthMm).toBeCloseTo(120 + 2 * (554.3 + 60), 6);
  });

  it("welds from two points and can be updated or removed", () => {
    const form = weldDefaults(null);
    expect(form.beadMm).toBe(3);
    const a = addWeldFromPoints(makeAnnotations(), [{ x: 0, y: 0 }, { x: 300, y: 400 }], { ...form, process: "tig" });
    expect(a.welds[0]).toMatchObject({ process: "tig", lengthMm: 500, effectiveLengthMm: 500, entityIds: [] });
    const u = updateWeld(a, "weld-1", { ...form, pattern: "stitch", stitch: { beadLengthMm: 25, pitchMm: 100 }, sides: 1 });
    expect(u.welds[0].effectiveLengthMm).toBeCloseTo(125, 9);
    expect(u.welds[0].lengthMm).toBe(500);
    expect(removeAnnotation(u, "weld-1").welds).toEqual([]);
    expect(addWeldFromPoints(a, [{ x: 1, y: 1 }], form)).toBe(a);
  });
});

describe("weld form validation (parity with lib/parts/schema)", () => {
  const form = weldDefaults(2);
  const zeroPitch: WeldForm = { ...form, pattern: "stitch", stitch: { beadLengthMm: 30, pitchMm: 0 } };
  const two = [
    { x: 0, y: 0 },
    { x: 500, y: 0 },
  ];

  it("refuses a stitch weld with a non-positive pitch instead of pricing it as a full seam", () => {
    expect(weldFormIssue(zeroPitch)).toBe("pitch");
    expect(weldFormIssue({ ...zeroPitch, stitch: { beadLengthMm: 30, pitchMm: -5 } })).toBe("pitch");
    expect(weldFormIssue({ ...zeroPitch, stitch: { beadLengthMm: 30, pitchMm: Number.NaN } })).toBe("pitch");
    expect(weldFormIssue({ ...zeroPitch, stitch: { beadLengthMm: -1, pitchMm: 60 } })).toBe("beadLength");
    expect(weldFormIssue({ ...form, beadMm: -1 })).toBe("bead");
    expect(weldFormIssue(form)).toBeNull();
    expect(isWeldFormValid({ ...form, pattern: "stitch", stitch: { beadLengthMm: 30, pitchMm: STITCH_PITCH_MIN_MM } })).toBe(true);
    // the panel previews "—", not the geometric length
    expect(previewWeldEffectiveLength(zeroPitch, 500)).toBeNull();
    expect(previewWeldEffectiveLength(form, 500)).toBe(500);
    // reducers return the input untouched → nothing invalid reaches onAnnotationsChange
    const a = makeAnnotations();
    expect(addWeldFromPoints(a, two, zeroPitch)).toBe(a);
    expect(addWeldFromEntities(a, g.entities, ["outer"], zeroPitch)).toBe(a);
    const valid = addWeldFromPoints(a, two, form);
    expect(valid.welds).toHaveLength(1);
    expect(updateWeld(valid, "weld-1", zeroPitch)).toBe(valid);
  });

  it("every weld the reducers emit passes the server annotations schema", () => {
    const stitch: WeldForm = { ...form, pattern: "stitch", stitch: { beadLengthMm: 30, pitchMm: STITCH_PITCH_MIN_MM } };
    let a = addWeldFromPoints(makeAnnotations(), two, stitch);
    a = addWeldFromEntities(a, g.entities, ["bend-up-1"], { ...form, sides: 2 });
    a = updateWeld(a, "weld-2", { ...form, pattern: "stitch", stitch: { beadLengthMm: 30, pitchMm: 60 } });
    expect(a.welds).toHaveLength(2);
    expect(a.welds[1].effectiveLengthMm).toBeCloseTo(30, 9);
    expect(annotationsSchema.safeParse(a).success).toBe(true);
    // the review probe: the server rejects pitch 0 — which is why the reducers must never build it
    expect(weldAnnotationSchema.safeParse({ ...a.welds[0], stitch: { beadLengthMm: 30, pitchMm: 0 } }).success).toBe(false);
  });
});

describe("roll, scale, mirror", () => {
  it("sets and clears the roll and answers the forming question", () => {
    const roll = { radiusMm: 100, axis: "x" as const, arcAngleDeg: 180, axisLengthMm: 554.3, developedWidthMm: 60, cone: null };
    const a = setRoll(makeAnnotations(), roll);
    expect(a.roll).toEqual(roll);
    expect(a.roll).not.toBe(roll);
    expect(a.forming).toBe("rolled");
    expect(clearRoll(a)).toEqual(makeAnnotations());
  });

  it("calibrates: factor = real / measured, coordinates recorded in the base frame", () => {
    const base = addDrawnBend(makeAnnotations(), { x: 0, y: 0 }, { x: 100, y: 0 }, bendDefaults(2));
    const prev = scalePreview(base, { x: 0, y: 0 }, { x: 200, y: 0 }, 400);
    expect(prev).toEqual({ factor: 2, ratio: 2, measuredMm: 200 });
    const a = setScale(base, { x: 0, y: 0 }, { x: 200, y: 0 }, 400);
    expect(a.scale).toEqual({ factor: 2, from: { x: 0, y: 0 }, to: { x: 200, y: 0 }, measuredMm: 200, realMm: 400 });
    expect(a.unitsConfirmed).toBe(true);
    // the bend drawn before calibration follows the outline
    expect(a.bends[0].end).toEqual({ x: 200, y: 0 });
    expect(a.bends[0].lengthMm).toBe(200);
    expect(currentScaleFactor(a)).toBe(2);
    // a second calibration measured in the scaled frame composes the factors
    const b = setScale(a, { x: 0, y: 0 }, { x: 100, y: 0 }, 300);
    expect(b.scale?.factor).toBeCloseTo(6, 9);
    expect(b.scale?.measuredMm).toBeCloseTo(50, 9);
    expect(b.scale?.realMm).toBe(300);
    expect(b.bends[0].end.x).toBeCloseTo(600, 9);
    expect(clearScale(b).bends[0].end.x).toBeCloseTo(100, 9);
    expect(clearScale(b).scale).toBeNull();
    // engine agrees: bbox width × 2
    expect(applyAnnotationsSync(g, a).measures.bbox.width).toBeCloseTo(2 * 554.3, 6);
    expect(setScale(base, { x: 0, y: 0 }, { x: 0, y: 0 }, 10)).toBe(base);
    expect(setScale(base, { x: 0, y: 0 }, { x: 1, y: 0 }, 0)).toBe(base);
  });

  it("mirror toggles the flag and flips drawn coordinates", () => {
    const base = addWeldFromPoints(addDrawnBend(makeAnnotations(), { x: 10, y: 0 }, { x: 10, y: 60 }, bendDefaults(2)), [{ x: 0, y: 0 }, { x: 50, y: 0 }], weldDefaults(2));
    const m = mirror(base);
    expect(m.mirrored).toBe(true);
    expect(m.bends[0].start).toEqual({ x: -10, y: 0 });
    expect(m.welds[0].points).toEqual([{ x: 0, y: 0 }, { x: -50, y: 0 }]);
    expect(m.welds[0].lengthMm).toBe(50);
    expect(mirror(m)).toEqual(base);
    const out = applyAnnotationsSync(g, m);
    expect(out.measures.bbox.minX).toBeCloseTo(-215.393, 3);
    expect(out.measures.bbox.maxX).toBeCloseTo(338.907, 3);
  });
});

describe("clean-up", () => {
  it("deletes a selection (dedup) and drops bends/welds that depended on it", () => {
    const a = addWeldFromEntities(tagEntities(makeAnnotations(), ["bend-up-1"], "bend_up", bendDefaults(2), g.entities), g.entities, ["bend-up-1", "bend-down-1"], weldDefaults(2));
    const d = deleteSelection(a, ["hole-1", "bend-up-1", "hole-1"]);
    expect(d.deletedEntityIds).toEqual(["hole-1", "bend-up-1"]);
    expect(d.bends).toEqual([]);
    expect(d.welds[0].entityIds).toEqual(["bend-down-1"]);
    expect(deleteSelection(deleteSelection(d, ["bend-down-1"]), []).welds).toEqual([]);
    const out = applyAnnotationsSync(g, d);
    expect(out.entities.map((e) => e.id)).not.toContain("hole-1");
    expect(out.measures.pierces).toBe(32);
    expect(out.measures.bendLines).toHaveLength(3);
    expect(restoreDeleted(d).deletedEntityIds).toEqual([]);
    expect(deleteSelection(a, [])).toBe(a);
  });

  it("marks a selection ignored", () => {
    const a = ignoreSelection(makeAnnotations(), ["bend-down-2"]);
    expect(a.entities["bend-down-2"]).toEqual({ role: "ignore" });
    const out = applyAnnotationsSync(g, a);
    expect(out.entities.find((e) => e.id === "bend-down-2")?.role).toBe("ignore");
    expect(out.measures.bendLines).toHaveLength(3);
  });

  it("keeps the largest closed contour, its holes and the lines inside it", () => {
    // two parts side by side: the 100 × 50 part with a hole and a bend candidate, plus a 20 × 20 square outside
    const part = makeRectPartGeometry({ lengthMm: 100, widthMm: 50, thicknessMm: 3, densityKgM3: 7850, holes: [{ x: 50, y: 25, diameterMm: 10 }], bendLines: [{ x1: 30, y1: 0, x2: 30, y2: 50, direction: "up" }] });
    const square = makeRectPartGeometry({ lengthMm: 20, widthMm: 20, thicknessMm: 3, densityKgM3: 7850, originX: 150, originY: 0 });
    const outsideLine = { ...square.entities[0], id: "stray", segments: [{ kind: "line" as const, start: { x: 200, y: 60 }, end: { x: 260, y: 60 } }], closed: false, loopId: null, bbox: { minX: 200, minY: 60, maxX: 260, maxY: 60, width: 60, height: 0 } };
    const multi = {
      ...part,
      entities: [...part.entities, { ...square.entities[0], id: "other", loopId: "loop-other" }, outsideLine],
      loops: [...part.loops, { ...square.loops[0], id: "loop-other", entityIds: ["other"], kind: "other_part" as const, partIndex: 1 }],
      partCount: 2,
    };
    const a = keepLargestContour(multi, makeAnnotations());
    expect(a.deletedEntityIds.sort()).toEqual(["other", "stray"]);
    // no outer loop → no-op
    expect(keepLargestContour({ ...multi, outerLoopId: null }, makeAnnotations())).toEqual(makeAnnotations());
  });

  it("join / split only validate and mark — the server does the work", () => {
    const a = makeAnnotations();
    expect(joinWithinTolerance(a, 0.2)).toEqual({ annotations: a, requestedToleranceMm: 0.2 });
    expect(joinWithinTolerance(a, 5).requestedToleranceMm).toBe(0.5);
    expect(joinWithinTolerance(a, 0).requestedToleranceMm).toBe(0.01);
    expect(clampJoinTolerance(Number.NaN)).toBe(0.01);
    expect(clampJoinTolerance(0.0001)).toBe(0.001);
    expect(splitIntoParts(a)).toEqual({ annotations: a, splitParts: true });
  });

  it("counts edits", () => {
    expect(annotationCount(EMPTY_ANNOTATIONS)).toBe(0);
    const a = mirror(deleteSelection(tagEntities(makeAnnotations(), ["a", "b"], "cut"), ["c"]));
    expect(annotationCount(a)).toBe(4);
  });
});
