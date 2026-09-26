/**
 * Viewer maths — entity hit-testing (6 px) and lasso rules.
 * File path: /test/viewer/hit-test.test.ts
 */
import { describe, expect, it } from "vitest";
import { make200164Like } from "@/test/helpers/parts";
import { makeRectPartGeometry } from "@/test/helpers/geometry";
import { fitToBbox, worldToScreen } from "@/lib/viewer/view-transform";
import {
  HIT_TOLERANCE_PX,
  distanceToEntityMm,
  entitiesInRect,
  entityHitDistancePx,
  nearestEntity,
  rectToWorldBbox,
  selectionLengthMm,
} from "@/lib/viewer/hit-test";

const g = make200164Like();
const viewport = { width: 1200, height: 400 };
const vt = fitToBbox(g.measures.bbox, viewport);
const outer = g.entities.find((e) => e.id === "outer")!;
const hole = g.entities.find((e) => e.id === "hole-1")!;
const bend = g.entities.find((e) => e.id === "bend-up-1")!;

describe("hit-test", () => {
  it("measures the distance to lines, arcs and circles in mm", () => {
    expect(distanceToEntityMm({ x: 0, y: -70 }, outer)).toBeCloseTo(10, 9); // below the bottom edge y = −60
    expect(distanceToEntityMm({ x: -330, y: -30 }, hole)).toBeCloseTo(2.75, 9); // centre of a Ø5.5 hole
    expect(distanceToEntityMm({ x: -330, y: -27.25 }, hole)).toBeCloseTo(0, 9);
    expect(distanceToEntityMm({ x: 160, y: -30 }, bend)).toBeCloseTo(160 - 156.926, 9);
  });

  it("converts to px at the current zoom and prefilters by bbox", () => {
    const onEdge = worldToScreen(vt, { x: 0, y: -60 });
    expect(entityHitDistancePx(outer, onEdge, vt)).toBeCloseTo(0, 6);
    const off = worldToScreen(vt, { x: 0, y: -60 - 4 / vt.scale });
    expect(entityHitDistancePx(outer, off, vt)).toBeCloseTo(4, 6);
    const far = worldToScreen(vt, { x: 0, y: -200 });
    expect(entityHitDistancePx(outer, far, vt)).toBe(Infinity);
  });

  it("finds the nearest entity within 6 px and nothing beyond", () => {
    const pBend = worldToScreen(vt, { x: 156.926 + 3 / vt.scale, y: -30 });
    const hit = nearestEntity(g.entities, pBend, vt);
    expect(hit?.entity.id).toBe("bend-up-1");
    expect(hit?.distancePx).toBeCloseTo(3, 6);
    const pFar = worldToScreen(vt, { x: 156.926 + (HIT_TOLERANCE_PX + 1) / vt.scale, y: -30 });
    expect(nearestEntity(g.entities, pFar, vt)).toBeNull();
    // a bigger tolerance reaches it, a filter can exclude it
    expect(nearestEntity(g.entities, pFar, vt, 12)?.entity.id).toBe("bend-up-1");
    expect(nearestEntity(g.entities, pBend, vt, 6, (e) => e.role !== "bend_up")).toBeNull();
    // the hole rim wins over the outline when closer
    const rim = worldToScreen(vt, { x: -330 + 2.75, y: -30 });
    expect(nearestEntity(g.entities, rim, vt)?.entity.id).toBe("hole-1");
  });

  it("lasso keeps only entities fully inside the rectangle", () => {
    const a = worldToScreen(vt, { x: -336, y: -40 });
    const b = worldToScreen(vt, { x: -304, y: -20 }); // holes at x = −330, −320, −310 (Ø5.5) fit; −300 does not
    const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
    const box = rectToWorldBbox(rect, vt);
    expect(box.minX).toBeCloseTo(-336, 6);
    expect(box.maxY).toBeCloseTo(-20, 6);
    expect(entitiesInRect(g.entities, rect, vt)).toEqual(["hole-1", "hole-2", "hole-3"]);
    // the whole part
    const all = worldToScreen(vt, { x: -400, y: 10 });
    const all2 = worldToScreen(vt, { x: 300, y: -70 });
    const everything = entitiesInRect(g.entities, { x: all.x, y: all.y, width: all2.x - all.x, height: all2.y - all.y }, vt);
    expect(everything).toHaveLength(37);
    expect(selectionLengthMm(g.entities, new Set(["bend-up-1", "bend-down-1"]))).toBeCloseTo(120, 9);
  });

  it("handles a polyline outline on a different geometry", () => {
    const r = makeRectPartGeometry({ lengthMm: 100, widthMm: 50, thicknessMm: 3, densityKgM3: 7850 });
    const v = fitToBbox(r.measures.bbox, { width: 500, height: 300 });
    const corner = worldToScreen(v, { x: 100, y: 50 });
    expect(nearestEntity(r.entities, corner, v)?.entity.id).toBe("outer");
  });
});
