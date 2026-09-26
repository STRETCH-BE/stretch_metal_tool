/**
 * Viewer maths — annular-sector (cone) detection and the rolling prefill.
 * File path: /test/viewer/cone.test.ts
 */
import { describe, expect, it } from "vitest";
import { analyzeDxfSync } from "@/lib/geometry/engine";
import { buildDxf, circle, rectLines } from "@/test/geometry/dxf-builder";
import { make200164Like } from "@/test/helpers/parts";
import { detectAnnularSector, rollDimensions, rollPrefill } from "@/lib/viewer/cone";

/** Annular sector Ri = 100, Ro = 300, sweep 90° (0° → 90°), centred at the origin. */
function sectorDxf(inner = 100, outer = 300, start = 0, end = 90) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const p = (r: number, d: number) => ({ x: r * Math.cos(rad(d)), y: r * Math.sin(rad(d)) });
  return buildDxf({
    entities: [
      { type: "ARC", center: { x: 0, y: 0 }, radius: inner, startDeg: start, endDeg: end },
      { type: "ARC", center: { x: 0, y: 0 }, radius: outer, startDeg: start, endDeg: end },
      { type: "LINE", start: p(inner, start), end: p(outer, start) },
      { type: "LINE", start: p(inner, end), end: p(outer, end) },
      circle(200 * Math.cos(rad(45)), 200 * Math.sin(rad(45)), 5),
    ],
  });
}

describe("cone detection", () => {
  it("recognises two concentric arcs joined by two radial lines", () => {
    const g = analyzeDxfSync(sectorDxf());
    expect(g.triage.state).toBe("green");
    const cone = detectAnnularSector(g)!;
    expect(cone).not.toBeNull();
    expect(cone.innerRadiusMm).toBeCloseTo(100, 6);
    expect(cone.outerRadiusMm).toBeCloseTo(300, 6);
    expect(cone.sweepDeg).toBeCloseTo(90, 6);
    expect(cone.axisLengthMm).toBeCloseTo(200, 6);
    expect(cone.developedWidthMm).toBeCloseTo(300 * Math.PI / 2, 6); // 471.24
    expect(cone.largeEndRadiusMm).toBeCloseTo(75, 6); // 471.24 / 2π
    expect(cone.smallEndRadiusMm).toBeCloseTo(25, 6);
    expect(cone.center.x).toBeCloseTo(0, 6);
  });

  it("works for a sector across the 0° seam", () => {
    const cone = detectAnnularSector(analyzeDxfSync(sectorDxf(50, 120, 330, 30)))!;
    expect(cone.sweepDeg).toBeCloseTo(60, 6);
    expect(cone.axisLengthMm).toBeCloseTo(70, 6);
    expect(cone.developedWidthMm).toBeCloseTo(120 * Math.PI / 3, 6);
  });

  it("rejects rectangles, rounded rectangles and sectors whose lines are not radial", () => {
    expect(detectAnnularSector(make200164Like())).toBeNull();
    const rect = analyzeDxfSync(buildDxf({ entities: rectLines(0, 0, 100, 50) }));
    expect(detectAnnularSector(rect)).toBeNull();
    const skew = buildDxf({
      entities: [
        { type: "ARC", center: { x: 0, y: 0 }, radius: 100, startDeg: 0, endDeg: 90 },
        { type: "ARC", center: { x: 0, y: 0 }, radius: 300, startDeg: 0, endDeg: 90 },
        { type: "LINE", start: { x: 100, y: 0 }, end: { x: 0, y: 300 } },
        { type: "LINE", start: { x: 0, y: 100 }, end: { x: 300, y: 0 } },
      ],
    });
    expect(detectAnnularSector(analyzeDxfSync(skew))).toBeNull();
    const offCentre = buildDxf({
      entities: [
        { type: "ARC", center: { x: 0, y: 0 }, radius: 100, startDeg: 0, endDeg: 90 },
        { type: "ARC", center: { x: 5, y: 0 }, radius: 300, startDeg: 0, endDeg: 90 },
        { type: "LINE", start: { x: 100, y: 0 }, end: { x: 305, y: 0 } },
        { type: "LINE", start: { x: 0, y: 100 }, end: { x: 5, y: 300 } },
      ],
    });
    expect(detectAnnularSector(analyzeDxfSync(offCentre))).toBeNull();
  });

  it("prefills the rolling dialog from the cone, else from the bbox", () => {
    const g = analyzeDxfSync(sectorDxf());
    const pre = rollPrefill(g, null);
    expect(pre.radiusMm).toBeCloseTo(75, 6);
    expect(pre.arcAngleDeg).toBe(360);
    expect(pre.axisLengthMm).toBeCloseTo(200, 6);
    expect(pre.developedWidthMm).toBeCloseTo(471.239, 3);
    expect(pre.cone).toEqual({ innerRadiusMm: expect.closeTo(100, 6), outerRadiusMm: expect.closeTo(300, 6), sweepDeg: expect.closeTo(90, 6) });
    const flat = rollPrefill(make200164Like(), null);
    expect(flat).toEqual({ radiusMm: 0, axis: "x", arcAngleDeg: 360, axisLengthMm: expect.closeTo(554.3, 6), developedWidthMm: 60, cone: null });
    const existing = { radiusMm: 50, axis: "y" as const, arcAngleDeg: 90, axisLengthMm: 1, developedWidthMm: 2, cone: null };
    expect(rollPrefill(g, existing)).toEqual(existing);
    expect(rollDimensions({ width: 300, height: 100 }, "y")).toEqual({ axisLengthMm: 100, developedWidthMm: 300 });
  });
});
