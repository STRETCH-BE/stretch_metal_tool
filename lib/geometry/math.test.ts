/**
 * Unit tests — math helpers, ids, layer conventions, thread table.
 * File path: /lib/geometry/math.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  arcBbox,
  arcLength,
  bulgeToArc,
  ccwSweepDeg,
  circularSegmentArea,
  distPointToArc,
  distPointToSegment,
  flattenArc,
  makeArc,
  pointInPolygon,
  polygonArea,
  transformSegment,
  affineRotateDeg,
  affineScale,
  affineCompose,
  affineTranslate,
  normalizeDeg,
  round,
} from "./math";
import { entityId, fnv1a, assignUniqueIds } from "./ids";
import { DEFAULT_LAYER_CONVENTIONS, isIgnoredLayer, roleForLayer } from "./layer-conventions";
import { suggestThread, THREAD_TABLE, threadForSize } from "./threads";
import { hasFormingHint } from "./triage";

describe("math", () => {
  it("normalises angles and sweeps CCW", () => {
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(720)).toBe(0);
    expect(ccwSweepDeg(270, 0)).toBe(90);
    expect(ccwSweepDeg(180, 0)).toBe(180);
    expect(ccwSweepDeg(10, 10)).toBe(360);
    const a = makeArc({ x: 0, y: 0 }, 5, 270, 0);
    expect(a.sweepDeg).toBe(90);
    expect(a.start).toEqual({ x: expect.closeTo(0, 9), y: expect.closeTo(-5, 9) });
    expect(a.end).toEqual({ x: expect.closeTo(5, 9), y: expect.closeTo(0, 9) });
    expect(arcLength(a)).toBeCloseTo((Math.PI * 5) / 2, 12);
  });

  it("computes arc bboxes including extreme angles", () => {
    const a = makeArc({ x: 0, y: 0 }, 10, 45, 135); // passes through 90°
    const b = arcBbox(a);
    expect(b.maxY).toBeCloseTo(10, 9);
    expect(b.minY).toBeCloseTo(10 * Math.SQRT1_2, 9);
    expect(b.minX).toBeCloseTo(-10 * Math.SQRT1_2, 9);
    const c = arcBbox(makeArc({ x: 0, y: 0 }, 10, 350, 10)); // crosses 0°
    expect(c.maxX).toBeCloseTo(10, 9);
  });

  it("flattens arcs within the chord error", () => {
    const a = makeArc({ x: 0, y: 0 }, 100, 0, 90);
    const pts = flattenArc(a, 0.05);
    expect(pts[0]).toEqual({ x: expect.closeTo(100, 9), y: expect.closeTo(0, 9) });
    expect(pts[pts.length - 1]).toEqual({ x: expect.closeTo(0, 9), y: expect.closeTo(100, 9) });
    for (let i = 0; i + 1 < pts.length; i++) {
      const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
      expect(100 - Math.hypot(mid.x, mid.y)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it("converts bulges to arcs in both directions", () => {
    const ccw = bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    expect(ccw.kind).toBe("arc");
    if (ccw.kind === "arc") {
      expect(ccw.center).toEqual({ x: expect.closeTo(5, 9), y: expect.closeTo(0, 9) });
      expect(ccw.radius).toBeCloseTo(5, 9);
      expect(ccw.sweepDeg).toBeCloseTo(180, 9);
      expect(ccw.start).toEqual({ x: 0, y: 0 });
      expect(ccw.end).toEqual({ x: 10, y: 0 });
      expect(ccw.startAngleDeg).toBeCloseTo(180, 9);
    }
    const cw = bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, -1);
    if (cw.kind === "arc") {
      expect(cw.center).toEqual({ x: expect.closeTo(5, 9), y: expect.closeTo(0, 9) });
      expect(cw.start).toEqual({ x: 10, y: 0 });
      expect(cw.end).toEqual({ x: 0, y: 0 });
      expect(cw.startAngleDeg).toBeCloseTo(0, 9);
    }
    // bulge tan(45°/4) → 45° sweep
    const small = bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, Math.tan(Math.PI / 16));
    if (small.kind === "arc") expect(small.sweepDeg).toBeCloseTo(45, 9);
    expect(bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 0).kind).toBe("line");
  });

  it("computes polygon area, containment and distances", () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(polygonArea(sq)).toBe(100);
    expect(polygonArea([...sq].reverse())).toBe(-100);
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
    expect(distPointToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distPointToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    const arc = makeArc({ x: 0, y: 0 }, 10, 0, 90);
    expect(distPointToArc({ x: 12 * Math.SQRT1_2, y: 12 * Math.SQRT1_2 }, arc)).toBeCloseTo(2, 9);
    expect(distPointToArc({ x: -10, y: 0 }, arc)).toBeCloseTo(10 * Math.SQRT2, 9); // nearest endpoint is (0,10)
    expect(circularSegmentArea(makeArc({ x: 0, y: 0 }, 1, 0, 180))).toBeCloseTo(Math.PI / 2, 12);
  });

  it("transforms arcs exactly under rotation/scale and flattens under non-uniform scale", () => {
    const arc = makeArc({ x: 10, y: 0 }, 5, 0, 90);
    const m = affineCompose(affineTranslate(100, 50), affineCompose(affineRotateDeg(90), affineScale(2, 2)));
    const r = transformSegment(arc, m);
    expect(r.flattened).toBe(false);
    expect(r.segments).toHaveLength(1);
    const t = r.segments[0];
    if (t.kind === "arc") {
      expect(t.center).toEqual({ x: expect.closeTo(100, 9), y: expect.closeTo(70, 9) });
      expect(t.radius).toBeCloseTo(10, 9);
      expect(t.startAngleDeg).toBeCloseTo(90, 9);
      expect(t.sweepDeg).toBeCloseTo(90, 9);
    }
    const flat = transformSegment(arc, affineScale(1, 2));
    expect(flat.flattened).toBe(true);
    expect(flat.segments.length).toBeGreaterThan(4);
    expect(round(1.23456)).toBe(1.235);
    expect(round(-0.0001)).toBe(0);
  });
});

describe("ids", () => {
  it("hashes deterministically and suffixes duplicates", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    const a = entityId("LINE", [{ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    const b = entityId("LINE", [{ kind: "line", start: { x: 10, y: 0 }, end: { x: 0, y: 0 } }]);
    const c = entityId("LINE", [{ kind: "line", start: { x: 0, y: 0.0004 }, end: { x: 10, y: 0 } }]);
    const d = entityId("LINE", [{ kind: "line", start: { x: 0, y: 0.002 }, end: { x: 10, y: 0 } }]);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).not.toBe(d);
    expect(assignUniqueIds(["x", "x", "y", "x"])).toEqual(["x", "x-2", "y", "x-3"]);
  });
});

describe("layer conventions", () => {
  it("matches case-insensitively with prefixes", () => {
    expect(roleForLayer("IV_BEND")).toBe("bend_up");
    expect(roleForLayer("iv_bend_down")).toBe("bend_down");
    expect(roleForLayer("Bend Lines")).toBe("bend_up");
    expect(roleForLayer("BEND-DOWN")).toBe("bend_down");
    expect(roleForLayer("Dimensions")).toBe("ignore");
    expect(roleForLayer("TEXT_NOTES")).toBe("ignore");
    expect(roleForLayer("TitleBlock")).toBe("ignore");
    expect(roleForLayer("DEFPOINTS")).toBe("ignore");
    expect(roleForLayer("IV_FEATURE_PROFILES_DOWN")).toBe("ignore");
    expect(roleForLayer("0")).toBe("cut");
    expect(roleForLayer("IV_OUTER_PROFILE")).toBe("cut");
    expect(roleForLayer("MARK")).toBe("engrave");
    expect(roleForLayer("weld_seam")).toBe("weld");
    expect(roleForLayer("SOMETHING_ELSE")).toBeNull();
    expect(isIgnoredLayer("IV_TANGENT")).toBe(true);
    expect(isIgnoredLayer("CUT")).toBe(false);
    expect(roleForLayer("MYBEND", { ...DEFAULT_LAYER_CONVENTIONS, bendUp: ["MYBEND"] })).toBe("bend_up");
  });
});

describe("threads", () => {
  it("has the table from the spec", () => {
    expect(THREAD_TABLE.map((t) => t.size)).toEqual(["M3", "M4", "M5", "M6", "M8", "M10", "M10x1", "M12", "M12x1.5", "M16", "M20"]);
    for (const t of THREAD_TABLE) {
      // D1 = d − 1.0825·P
      const d = parseFloat(t.size.slice(1));
      expect(t.minorDiameterMm).toBeCloseTo(d - 1.0825 * t.pitchMm, 2);
    }
  });

  it("matches minor diameter or tap drill within ±0.05 and prefers the closer", () => {
    expect(suggestThread(6.647)).toMatchObject({ size: "M8", matchedBy: "minor_diameter", deviationMm: expect.closeTo(0, 9) });
    expect(suggestThread(6.8)).toMatchObject({ size: "M8", matchedBy: "tap_drill" });
    expect(suggestThread(6.84)).toMatchObject({ size: "M8", matchedBy: "tap_drill" });
    expect(suggestThread(6.9)).toBeNull();
    expect(suggestThread(8.917)).toMatchObject({ size: "M10x1", matchedBy: "minor_diameter" });
    expect(suggestThread(8.5)).toMatchObject({ size: "M10", matchedBy: "tap_drill" });
    expect(suggestThread(10.376)).toMatchObject({ size: "M12x1.5" });
    expect(suggestThread(10.2)).toMatchObject({ size: "M12", matchedBy: "tap_drill" });
    expect(suggestThread(2.48)).toMatchObject({ size: "M3", matchedBy: "tap_drill" });
    expect(suggestThread(2.47)).toMatchObject({ size: "M3", matchedBy: "minor_diameter" });
    expect(suggestThread(10)).toBeNull();
    expect(suggestThread(13)).toBeNull();
    expect(threadForSize("m6", 5)).toMatchObject({ size: "M6", matchedBy: "tap_drill", deviationMm: expect.closeTo(0, 9) });
    expect(threadForSize("M10×1", 8.9)?.size).toBe("M10x1");
    expect(threadForSize("M7", 6)).toBeNull();
  });
});

describe("forming hints", () => {
  it("detects forming words in several languages but not 'plech'", () => {
    for (const t of ["bent bracket", "Bending", "folded", "Abkanten", "gebogen", "gięty", "giąć", "ohýbaný", "ohyb", "walcowany", "zwijany", "rolled tube", "kantowanie"]) {
      expect(hasFormingHint(t)).toBe(true);
    }
    for (const t of ["PLECH 15x500x220", "flat plate", "", null, undefined]) expect(hasFormingHint(t)).toBe(false);
  });
});
