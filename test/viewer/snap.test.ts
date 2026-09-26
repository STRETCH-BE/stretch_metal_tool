/**
 * Viewer maths — snapping priorities and the perpendicular foot.
 * File path: /test/viewer/snap.test.ts
 */
import { describe, expect, it } from "vitest";
import { makeArc } from "@/lib/geometry/math";
import type { GeometryEntity } from "@/lib/geometry/types";
import { makeRectPartGeometry } from "@/test/helpers/geometry";
import { fitToBbox, worldToScreen } from "@/lib/viewer/view-transform";
import { entityPickPoints, projectOntoSegment, snapCandidates, snapPoint } from "@/lib/viewer/snap";

const g = makeRectPartGeometry({ lengthMm: 100, widthMm: 50, thicknessMm: 3, densityKgM3: 7850, holes: [{ x: 50, y: 25, diameterMm: 10 }] });
const vt = fitToBbox(g.measures.bbox, { width: 1000, height: 500 }); // ≈ 9.5 px/mm

describe("snap", () => {
  it("snaps to an endpoint before a midpoint or an edge", () => {
    const nearCorner = worldToScreen(vt, { x: 0.6, y: 0.3 }); // ~6 px from (0,0), on the edge is closer
    const r = snapPoint(g.entities, nearCorner, vt);
    expect(r.kind).toBe("endpoint");
    expect(r.point).toEqual({ x: 0, y: 0 });
    expect(r.entityId).toBe("outer");
  });

  it("snaps to the midpoint of a line and the centre of a circle", () => {
    const mid = worldToScreen(vt, { x: 50.4, y: 0.2 });
    const r = snapPoint(g.entities, mid, vt);
    expect(r.kind).toBe("midpoint");
    expect(r.point.x).toBeCloseTo(50, 9);
    expect(r.point.y).toBeCloseTo(0, 9);
    const centre = snapPoint(g.entities, worldToScreen(vt, { x: 50.3, y: 25.2 }), vt);
    expect(centre.kind).toBe("center");
    expect(centre.point).toEqual({ x: 50, y: 25 });
    expect(centre.entityId).toBe("hole-1");
  });

  it("projects the cursor perpendicularly onto the nearest edge", () => {
    const r = snapPoint(g.entities, worldToScreen(vt, { x: 30, y: 0.5 }), vt);
    expect(r.kind).toBe("perpendicular");
    expect(r.point.x).toBeCloseTo(30, 9);
    expect(r.point.y).toBeCloseTo(0, 9);
  });

  it("offers the foot of the perpendicular from the first picked point", () => {
    const from = { x: 30, y: 20 };
    // cursor near the bottom edge but 0.4 mm off the foot x = 30
    const cursor = worldToScreen(vt, { x: 30.4, y: 0.3 });
    const cands = snapCandidates(g.entities, cursor, vt, { from });
    const foot = cands.find((c) => c.kind === "perpendicular");
    expect(foot?.point.x).toBeCloseTo(30, 9);
    expect(foot?.point.y).toBeCloseTo(0, 9);
    expect(cands[0].kind).toBe("perpendicular");
  });

  it("returns the raw world point without candidates and respects the radius", () => {
    const r = snapPoint(g.entities, worldToScreen(vt, { x: 20, y: 20 }), vt);
    expect(r.kind).toBeNull();
    expect(r.entityId).toBeNull();
    expect(r.point.x).toBeCloseTo(20, 9);
    expect(r.point.y).toBeCloseTo(20, 9);
    const near = worldToScreen(vt, { x: 0, y: 0.8 }); // ~7.6 px from the corner
    expect(snapPoint(g.entities, near, vt, { radiusPx: 4 }).kind).toBe("perpendicular");
    expect(snapPoint(g.entities, near, vt, { radiusPx: 10 }).kind).toBe("endpoint");
  });

  it("projects onto arcs only within their sweep", () => {
    const arc = makeArc({ x: 0, y: 0 }, 10, 0, 90);
    const inside = projectOntoSegment({ x: 5, y: 5 }, arc)!;
    expect(inside.x).toBeCloseTo(10 / Math.SQRT2, 9);
    expect(inside.y).toBeCloseTo(10 / Math.SQRT2, 9);
    expect(projectOntoSegment({ x: -5, y: -5 }, arc)).toBeNull();
    expect(projectOntoSegment({ x: 5, y: 3 }, { kind: "circle", center: { x: 0, y: 0 }, radius: 2 })!.x).toBeCloseTo(2 * 5 / Math.hypot(5, 3), 9);
    // arc midpoint is a candidate
    const arcEntity: GeometryEntity = {
      id: "arc", layer: "0", originalType: "ARC", segments: [arc], closed: false, lengthMm: 15.7,
      bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 }, roleFromLayer: null, role: "cut", loopId: null,
    };
    const v = { scale: 10, tx: 100, ty: 300 };
    const mid = snapPoint([arcEntity], worldToScreen(v, { x: 7.2, y: 7.0 }), v);
    expect(mid.kind).toBe("midpoint");
    expect(mid.point.x).toBeCloseTo(10 * Math.cos(Math.PI / 4), 9);
  });
});

describe("keyboard pick (entityPickPoints)", () => {
  it("picks a line's ends, a circle's horizontal diameter and a closed chain's first edge", () => {
    const part = makeRectPartGeometry({
      lengthMm: 100,
      widthMm: 50,
      thicknessMm: 3,
      densityKgM3: 7850,
      holes: [{ x: 50, y: 25, diameterMm: 10 }],
      bendLines: [{ x1: 30, y1: 0, x2: 30, y2: 50, direction: "up" }],
    });
    const line = part.entities.find((e) => e.role === "bend_up");
    expect(line && entityPickPoints(line)).toEqual([
      { x: 30, y: 0 },
      { x: 30, y: 50 },
    ]);
    const hole = part.entities.find((e) => e.segments[0]?.kind === "circle");
    expect(hole && entityPickPoints(hole)).toEqual([
      { x: 45, y: 25 },
      { x: 55, y: 25 },
    ]);
    const outer = part.entities.find((e) => e.id === "outer");
    expect(outer?.closed).toBe(true);
    expect(outer && entityPickPoints(outer)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(outer && entityPickPoints({ ...outer, segments: [] })).toBeNull();
    // an open two-segment chain: first start → last end
    const chain: GeometryEntity = {
      ...(line as GeometryEntity),
      id: "chain",
      segments: [
        { kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        makeArc({ x: 10, y: 10 }, 10, 270, 0),
      ],
    };
    const pts = entityPickPoints(chain);
    expect(pts?.[0]).toEqual({ x: 0, y: 0 });
    expect(pts?.[1].x).toBeCloseTo(20, 9);
    expect(pts?.[1].y).toBeCloseTo(10, 9);
  });
});
