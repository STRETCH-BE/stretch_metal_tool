/**
 * Viewer — world (mm, Y up) ↔ screen (px, Y down) transform, pan/zoom,
 * fit and grid selection. Pure, no React.
 * File path: /lib/viewer/view-transform.ts
 *
 * The transform is `screen.x = world.x · scale + tx`,
 * `screen.y = −world.y · scale + ty` (the Y flip happens here). The SVG
 * path strings from lib/geometry/svg.ts already carry a negated y, so
 * the view <g> uses `translate(tx ty) scale(scale)` with NO negative
 * scale — text and stroke maths inside the group stay upright.
 *
 * Non-obvious choices:
 * - `scale` is px per mm; 1 = 100 % zoom. Limits keep a 20 m sheet and
 *   a Ø1 mm hole both reachable without the numbers going degenerate.
 * - `gridStepMm` picks the first step of the 1/2/5 series whose spacing
 *   on screen is at least `minPx`; beyond 500 mm the series continues
 *   ×10 (1000, 2000, 5000 …) so a huge part never floods the canvas.
 * - `gridLines` caps the line count: when a viewport would need more
 *   than MAX_GRID_LINES the grid is returned empty rather than slow.
 * - `panToReveal` (keyboard entity cycling) only pans, never zooms: a
 *   focused entity outside the viewport is centred at the current zoom
 *   so the view does not jump scale while stepping through entities.
 */

import type { Bbox, Point } from "@/lib/geometry/types";

export type ViewTransform = { scale: number; tx: number; ty: number };
export type Viewport = { width: number; height: number };

export const MIN_SCALE = 0.005;
export const MAX_SCALE = 2000;
export const GRID_STEPS_MM: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500];
export const GRID_MIN_PX = 48;
export const MAX_GRID_LINES = 400;
export const FIT_PADDING_PX = 24;
export const ZOOM_STEP = 1.25;

export const IDENTITY_VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function worldToScreen(vt: ViewTransform, p: Point): Point {
  return { x: p.x * vt.scale + vt.tx, y: -p.y * vt.scale + vt.ty };
}

export function screenToWorld(vt: ViewTransform, s: Point): Point {
  return { x: (s.x - vt.tx) / vt.scale, y: -(s.y - vt.ty) / vt.scale };
}

/** px → mm at the current zoom. */
export function pxToMm(vt: ViewTransform, px: number): number {
  return px / vt.scale;
}

/** `transform` attribute for the view group (paths are already Y-flipped). */
export function svgGroupTransform(vt: ViewTransform): string {
  return `translate(${fmt(vt.tx)} ${fmt(vt.ty)}) scale(${fmt(vt.scale)})`;
}

function fmt(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  return String(Object.is(r, -0) ? 0 : r);
}

/** Zoom by `factor` keeping the world point under `screenPoint` fixed. */
export function zoomAbout(vt: ViewTransform, screenPoint: Point, factor: number): ViewTransform {
  const next = clampScale(vt.scale * factor);
  const k = next / vt.scale;
  return {
    scale: next,
    tx: screenPoint.x - (screenPoint.x - vt.tx) * k,
    ty: screenPoint.y - (screenPoint.y - vt.ty) * k,
  };
}

/** Zoom about the viewport centre (toolbar buttons / keyboard). */
export function zoomCenter(vt: ViewTransform, viewport: Viewport, factor: number): ViewTransform {
  return zoomAbout(vt, { x: viewport.width / 2, y: viewport.height / 2 }, factor);
}

export function panBy(vt: ViewTransform, dxPx: number, dyPx: number): ViewTransform {
  return { scale: vt.scale, tx: vt.tx + dxPx, ty: vt.ty + dyPx };
}

/** Fit `bbox` into the viewport with `paddingPx` on every side, centred. */
export function fitToBbox(bbox: Bbox, viewport: Viewport, paddingPx = FIT_PADDING_PX): ViewTransform {
  const w = Math.max(bbox.width, 1e-6);
  const h = Math.max(bbox.height, 1e-6);
  const availW = Math.max(viewport.width - 2 * paddingPx, 1);
  const availH = Math.max(viewport.height - 2 * paddingPx, 1);
  const scale = clampScale(Math.min(availW / w, availH / h));
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  return {
    scale,
    tx: viewport.width / 2 - cx * scale,
    ty: viewport.height / 2 + cy * scale,
  };
}

/** Wheel delta → zoom factor (pixel, line and page delta modes). */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
  const px = Math.max(-200, Math.min(200, deltaY * unit));
  return Math.exp(-px * 0.0025);
}

/** Grid step (mm) so that adjacent lines are ≥ `minPx` apart on screen. */
export function gridStepMm(scale: number, minPx = GRID_MIN_PX): number {
  const s = clampScale(scale);
  for (const step of GRID_STEPS_MM) if (step * s >= minPx) return step;
  let step = GRID_STEPS_MM[GRID_STEPS_MM.length - 1];
  while (step * s < minPx && step < 1e9) step *= 10;
  return step;
}

export type GridLine = { worldMm: number; screenPx: number; major: boolean };
export type Grid = { stepMm: number; vertical: GridLine[]; horizontal: GridLine[] };

/** Grid lines visible in the viewport; every 5th line (multiples of 5·step) is major. */
export function gridLines(vt: ViewTransform, viewport: Viewport, minPx = GRID_MIN_PX): Grid {
  const stepMm = gridStepMm(vt.scale, minPx);
  const topLeft = screenToWorld(vt, { x: 0, y: 0 });
  const bottomRight = screenToWorld(vt, { x: viewport.width, y: viewport.height });
  const xs = range(topLeft.x, bottomRight.x, stepMm);
  const ys = range(bottomRight.y, topLeft.y, stepMm);
  if (xs.length + ys.length > MAX_GRID_LINES) return { stepMm, vertical: [], horizontal: [] };
  const majorEvery = stepMm * 5;
  const isMajor = (v: number) => Math.abs(v / majorEvery - Math.round(v / majorEvery)) < 1e-6;
  return {
    stepMm,
    vertical: xs.map((x) => ({ worldMm: x, screenPx: worldToScreen(vt, { x, y: 0 }).x, major: isMajor(x) })),
    horizontal: ys.map((y) => ({ worldMm: y, screenPx: worldToScreen(vt, { x: 0, y }).y, major: isMajor(y) })),
  };
}

function range(from: number, to: number, step: number): number[] {
  if (!(step > 0) || !Number.isFinite(from) || !Number.isFinite(to)) return [];
  const start = Math.ceil(from / step) * step;
  const out: number[] = [];
  const count = Math.floor((to - start) / step) + 1;
  if (count > MAX_GRID_LINES) return new Array<number>(MAX_GRID_LINES + 1).fill(0);
  for (let i = 0; i < count; i++) {
    const v = start + i * step;
    out.push(Math.abs(v) < 1e-9 ? 0 : Math.round(v * 1e6) / 1e6);
  }
  return out;
}

export function zoomPercent(vt: ViewTransform): number {
  return vt.scale * 100;
}

/** Screen-space rectangle from two corners, normalised. */
export type ScreenRect = { x: number; y: number; width: number; height: number };

export function normalizeRect(a: Point, b: Point): ScreenRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Screen-space rectangle of a world bbox at the current view. */
export function bboxToScreenRect(vt: ViewTransform, bbox: Bbox): ScreenRect {
  const a = worldToScreen(vt, { x: bbox.minX, y: bbox.minY });
  const b = worldToScreen(vt, { x: bbox.maxX, y: bbox.maxY });
  return normalizeRect(a, b);
}

/**
 * Pan (never zoom) so the bbox is visible: unchanged when it already lies
 * inside the viewport minus `marginPx`, otherwise centred on the viewport.
 */
export function panToReveal(vt: ViewTransform, bbox: Bbox, viewport: Viewport, marginPx = FIT_PADDING_PX): ViewTransform {
  const r = bboxToScreenRect(vt, bbox);
  const inside =
    r.x >= marginPx && r.y >= marginPx && r.x + r.width <= viewport.width - marginPx && r.y + r.height <= viewport.height - marginPx;
  if (inside) return vt;
  const centre = worldToScreen(vt, { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 });
  return panBy(vt, viewport.width / 2 - centre.x, viewport.height / 2 - centre.y);
}
