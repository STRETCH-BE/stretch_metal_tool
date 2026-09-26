/**
 * Viewer maths — world ↔ screen transform, zoom about a point, fit, grid.
 * File path: /test/viewer/view-transform.test.ts
 */
import { describe, expect, it } from "vitest";
import { makeBbox } from "@/lib/geometry/math";
import {
  GRID_STEPS_MM,
  MAX_SCALE,
  MIN_SCALE,
  bboxToScreenRect,
  fitToBbox,
  gridLines,
  gridStepMm,
  normalizeRect,
  panBy,
  panToReveal,
  screenToWorld,
  svgGroupTransform,
  wheelZoomFactor,
  worldToScreen,
  zoomAbout,
  zoomCenter,
  zoomPercent,
} from "@/lib/viewer/view-transform";

describe("view transform", () => {
  it("maps world to screen with a Y flip and back", () => {
    const vt = { scale: 2, tx: 100, ty: 300 };
    expect(worldToScreen(vt, { x: 10, y: 20 })).toEqual({ x: 120, y: 260 });
    expect(screenToWorld(vt, { x: 120, y: 260 })).toEqual({ x: 10, y: 20 });
    const p = { x: -37.25, y: 12.5 };
    const back = screenToWorld(vt, worldToScreen(vt, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    expect(svgGroupTransform(vt)).toBe("translate(100 300) scale(2)");
  });

  it("zooms about a screen point keeping the world point under it fixed", () => {
    const vt = { scale: 1, tx: 50, ty: 400 };
    const cursor = { x: 200, y: 150 };
    const before = screenToWorld(vt, cursor);
    const next = zoomAbout(vt, cursor, 2);
    expect(next.scale).toBe(2);
    const after = screenToWorld(next, cursor);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    // clamps
    expect(zoomAbout(vt, cursor, 1e9).scale).toBe(MAX_SCALE);
    expect(zoomAbout(vt, cursor, 1e-9).scale).toBe(MIN_SCALE);
    const centred = zoomCenter(vt, { width: 800, height: 600 }, 0.5);
    const cw = screenToWorld(centred, { x: 400, y: 300 });
    const cb = screenToWorld(vt, { x: 400, y: 300 });
    expect(cw.x).toBeCloseTo(cb.x, 9);
    expect(cw.y).toBeCloseTo(cb.y, 9);
  });

  it("pans in px", () => {
    expect(panBy({ scale: 3, tx: 1, ty: 2 }, 10, -5)).toEqual({ scale: 3, tx: 11, ty: -3 });
  });

  it("fits a bbox into the viewport with padding, centred", () => {
    const bbox = makeBbox(-42, 0, 458, 220); // 500 × 220
    const viewport = { width: 1000, height: 500 };
    const vt = fitToBbox(bbox, viewport, 20);
    // limiting axis: width (960 / 500 = 1.92) vs height (460 / 220 = 2.09)
    expect(vt.scale).toBeCloseTo(1.92, 9);
    const c = worldToScreen(vt, { x: 208, y: 110 });
    expect(c.x).toBeCloseTo(500, 9);
    expect(c.y).toBeCloseTo(250, 9);
    const tl = worldToScreen(vt, { x: -42, y: 220 });
    expect(tl.x).toBeCloseTo(20, 9);
    expect(tl.y).toBeCloseTo(250 - 110 * 1.92, 9);
    // degenerate bbox does not blow up
    const zero = fitToBbox(makeBbox(5, 5, 5, 5), viewport);
    expect(Number.isFinite(zero.scale)).toBe(true);
    expect(zero.scale).toBe(MAX_SCALE);
  });

  it("selects the grid step from the 1/2/5 series by zoom", () => {
    expect(gridStepMm(1)).toBe(50); // 50 px ≥ 48
    expect(gridStepMm(2)).toBe(50); // 20 × 2 = 40 < 48, 50 × 2 = 100
    expect(gridStepMm(5)).toBe(10);
    expect(gridStepMm(50)).toBe(1);
    expect(gridStepMm(0.1)).toBe(500);
    expect(gridStepMm(0.01)).toBe(5000); // beyond the series continues ×10
    for (const s of [0.5, 1, 3, 7, 12, 30, 80]) expect(GRID_STEPS_MM).toContain(gridStepMm(s));
    expect(zoomPercent({ scale: 1.5, tx: 0, ty: 0 })).toBe(150);
  });

  it("lists visible grid lines with screen positions and major flags", () => {
    const vt = { scale: 2, tx: 0, ty: 400 }; // world x 0..400 visible in 800 px, y 0..200
    const grid = gridLines(vt, { width: 800, height: 400 });
    expect(grid.stepMm).toBe(50);
    expect(grid.vertical.map((l) => l.worldMm)).toEqual([0, 50, 100, 150, 200, 250, 300, 350, 400]);
    expect(grid.vertical[1].screenPx).toBe(100);
    expect(grid.vertical.filter((l) => l.major).map((l) => l.worldMm)).toEqual([0, 250]);
    expect(grid.horizontal.map((l) => l.worldMm)).toEqual([0, 50, 100, 150, 200]);
    expect(grid.horizontal.find((l) => l.worldMm === 100)?.screenPx).toBe(200);
    // an absurd viewport returns an empty grid instead of thousands of lines
    const huge = gridLines({ scale: 1, tx: 0, ty: 0 }, { width: 50000, height: 50000 });
    expect(huge.vertical).toEqual([]);
  });

  it("wheel deltas map to bounded zoom factors", () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(-100) * wheelZoomFactor(100)).toBeCloseTo(1, 9);
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(wheelZoomFactor(-48), 9);
    expect(wheelZoomFactor(-1e6)).toBeCloseTo(Math.exp(0.5), 9);
  });

  it("pans — never zooms — to reveal a bbox outside the viewport (keyboard entity cycling)", () => {
    const viewport = { width: 1000, height: 500 };
    const vt = { scale: 2, tx: 500, ty: 250 }; // world origin at the viewport centre
    const inside = makeBbox(-10, -10, 10, 10);
    expect(bboxToScreenRect(vt, inside)).toEqual({ x: 480, y: 230, width: 40, height: 40 });
    expect(panToReveal(vt, inside, viewport)).toBe(vt);
    const far = makeBbox(1000, 1000, 1010, 1010);
    const moved = panToReveal(vt, far, viewport);
    expect(moved.scale).toBe(2);
    const centre = worldToScreen(moved, { x: 1005, y: 1005 });
    expect(centre.x).toBeCloseTo(500, 9);
    expect(centre.y).toBeCloseTo(250, 9);
    // inside the viewport but within the margin counts as hidden
    const edge = makeBbox(-260, -10, -240, 10); // screen x −20 … 20
    expect(panToReveal(vt, edge, viewport)).not.toBe(vt);
    expect(panToReveal(vt, edge, viewport, 0)).not.toBe(vt);
    expect(panToReveal(vt, makeBbox(-240, -10, -230, 10), viewport, 0)).toBe(vt);
  });

  it("normalises a drag rectangle", () => {
    expect(normalizeRect({ x: 10, y: 50 }, { x: 4, y: 20 })).toEqual({ x: 4, y: 20, width: 6, height: 30 });
  });
});
