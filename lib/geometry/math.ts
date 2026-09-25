/**
 * Geometry engine — planar maths shared by every pipeline stage.
 * File path: /lib/geometry/math.ts
 *
 * Pure functions on the primitive types of ./types (Point, Bbox,
 * Segment). Angles are DEGREES at the type boundary (DXF convention,
 * CCW from +X) and radians only inside a function. Arcs are always
 * normalised to a positive CCW sweep in (0, 360] so every caller can
 * treat them alike; a full 360° arc is a legitimate ArcSegment (it is
 * what a bulge polyline with two coincident-direction arcs produces).
 *
 * Non-obvious choices:
 * - `flattenArc` picks the segment count from the chord error (default
 *   0.05 mm) so a Ø5 hole and a R500 blend both get sensible polygons.
 * - `bulgeToArc` returns the arc in CCW form; for a negative bulge the
 *   CCW arc runs from the second vertex to the first, so start/end are
 *   swapped relative to the polyline direction (chaining is direction
 *   agnostic, the SVG writer re-derives direction from the pen position).
 * - Point-in-polygon is the even-odd ray cast; boundary points are
 *   undefined by design — classification samples several points.
 */

import type { ArcSegment, Bbox, CircleSegment, LineSegment, Point, Segment } from "./types";

export const EPS = 1e-9;
export const DEFAULT_CHORD_ERROR_MM = 0.05;

/* ─── Scalars and angles ─────────────────────────────────── */

export function nearlyEqual(a: number, b: number, tol = EPS): boolean {
  return Math.abs(a - b) <= tol;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Normalise an angle in degrees to [0, 360). */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  if (nearlyEqual(d, 360, 1e-12)) d = 0;
  return d;
}

/**
 * Positive CCW sweep from start to end in (0, 360]. A zero difference is
 * read as a full circle (that is how DXF writers encode a 360° arc).
 */
export function ccwSweepDeg(startDeg: number, endDeg: number): number {
  const sweep = normalizeDeg(endDeg - startDeg);
  return sweep < 1e-9 ? 360 : sweep;
}

/* ─── Points and vectors ─────────────────────────────────── */

export function pt(x: number, y: number): Point {
  return { x, y };
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Point, k: number): Point {
  return { x: a.x * k, y: a.y * k };
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

/** 2-D cross product (z component). */
export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

export function length(a: Point): number {
  return Math.hypot(a.x, a.y);
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointsEqual(a: Point, b: Point, tol = EPS): boolean {
  return dist(a, b) <= tol;
}

export function normalize(a: Point): Point {
  const l = length(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Angle of the vector from `center` to `p`, degrees in [0, 360). */
export function angleDeg(center: Point, p: Point): number {
  return normalizeDeg(radToDeg(Math.atan2(p.y - center.y, p.x - center.x)));
}

/** Smallest absolute angle between two direction vectors, degrees [0, 180]. */
export function angleBetweenDeg(a: Point, b: Point): number {
  const la = length(a);
  const lb = length(b);
  if (la < EPS || lb < EPS) return 0;
  const c = Math.min(1, Math.max(-1, dot(a, b) / (la * lb)));
  return radToDeg(Math.acos(c));
}

export function pointOnCircle(center: Point, radius: number, angleDegrees: number): Point {
  const a = degToRad(angleDegrees);
  return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
}

/* ─── Segment constructors ───────────────────────────────── */

export function makeLine(start: Point, end: Point): LineSegment {
  return { kind: "line", start: { ...start }, end: { ...end } };
}

export function makeCircle(center: Point, radius: number): CircleSegment {
  return { kind: "circle", center: { ...center }, radius };
}

/** CCW arc from startDeg to endDeg (DXF semantics). */
export function makeArc(center: Point, radius: number, startDeg: number, endDeg: number): ArcSegment {
  const s = normalizeDeg(startDeg);
  const sweepDeg = ccwSweepDeg(startDeg, endDeg);
  const e = normalizeDeg(s + sweepDeg);
  return {
    kind: "arc",
    center: { ...center },
    radius,
    startAngleDeg: s,
    endAngleDeg: e,
    sweepDeg,
    start: pointOnCircle(center, radius, s),
    end: pointOnCircle(center, radius, e),
  };
}

/**
 * Arc from a polyline bulge (bulge = tan(θ/4)). A positive bulge turns
 * left (CCW) from p1 to p2; negative turns right, which as a CCW arc runs
 * from p2 to p1. Endpoints are copied exactly from the vertices so
 * chaining inside the polyline is exact.
 */
export function bulgeToArc(p1: Point, p2: Point, bulge: number): ArcSegment | LineSegment {
  const chord = dist(p1, p2);
  if (Math.abs(bulge) < 1e-12 || chord < EPS) return makeLine(p1, p2);
  const theta = 4 * Math.atan(Math.abs(bulge)); // sweep in radians, (0, 2π)
  const radius = chord / (2 * Math.sin(theta / 2));
  const mid = midpoint(p1, p2);
  const dir = normalize(sub(p2, p1));
  // Perpendicular to the left of the travel direction.
  const left = { x: -dir.y, y: dir.x };
  // Distance from chord midpoint to centre (negative when centre is on the
  // right, i.e. the arc bulges left / sweep > 180°).
  const h = radius * Math.cos(theta / 2);
  const sign = bulge > 0 ? 1 : -1;
  const center = add(mid, scale(left, sign * h));
  const a1 = angleDeg(center, p1);
  const a2 = angleDeg(center, p2);
  const sweepDeg = radToDeg(theta);
  if (bulge > 0) {
    return {
      kind: "arc",
      center,
      radius,
      startAngleDeg: a1,
      endAngleDeg: a2,
      sweepDeg,
      start: { ...p1 },
      end: { ...p2 },
    };
  }
  return {
    kind: "arc",
    center,
    radius,
    startAngleDeg: a2,
    endAngleDeg: a1,
    sweepDeg,
    start: { ...p2 },
    end: { ...p1 },
  };
}

/* ─── Arc helpers ────────────────────────────────────────── */

export function arcLength(arc: ArcSegment): number {
  return arc.radius * degToRad(arc.sweepDeg);
}

export function arcMidpoint(arc: ArcSegment): Point {
  return pointOnCircle(arc.center, arc.radius, arc.startAngleDeg + arc.sweepDeg / 2);
}

/** True when the CCW angle `deg` lies within the arc's sweep. */
export function arcContainsAngle(arc: ArcSegment, deg: number): boolean {
  const rel = normalizeDeg(deg - arc.startAngleDeg);
  return rel <= arc.sweepDeg + 1e-9;
}

/** Bbox including the axis-extreme points the arc passes through. */
export function arcBbox(arc: ArcSegment): Bbox {
  const pts: Point[] = [arc.start, arc.end];
  for (const a of [0, 90, 180, 270]) {
    if (arcContainsAngle(arc, a)) pts.push(pointOnCircle(arc.center, arc.radius, a));
  }
  return bboxOf(pts);
}

/** Number of chords needed to keep the sagitta under `chordError`. */
export function arcSegmentCount(radius: number, sweepDeg: number, chordError = DEFAULT_CHORD_ERROR_MM): number {
  if (radius <= chordError) return Math.max(1, Math.ceil(sweepDeg / 90));
  const maxStep = 2 * Math.acos(1 - chordError / radius); // radians per chord
  const n = Math.ceil(degToRad(sweepDeg) / maxStep);
  return Math.max(1, Math.min(n, 4096));
}

/** Points from start to end inclusive, CCW. */
export function flattenArc(arc: ArcSegment, chordError = DEFAULT_CHORD_ERROR_MM): Point[] {
  const n = arcSegmentCount(arc.radius, arc.sweepDeg, chordError);
  const out: Point[] = [{ ...arc.start }];
  for (let i = 1; i < n; i++) {
    out.push(pointOnCircle(arc.center, arc.radius, arc.startAngleDeg + (arc.sweepDeg * i) / n));
  }
  out.push({ ...arc.end });
  return out;
}

/** Polygon of the circle, first point NOT repeated at the end. */
export function flattenCircle(circle: CircleSegment, chordError = DEFAULT_CHORD_ERROR_MM): Point[] {
  const n = Math.max(8, arcSegmentCount(circle.radius, 360, chordError));
  const out: Point[] = [];
  for (let i = 0; i < n; i++) out.push(pointOnCircle(circle.center, circle.radius, (360 * i) / n));
  return out;
}

/** Area between chord and arc: r²/2·(θ − sin θ). */
export function circularSegmentArea(arc: ArcSegment): number {
  const theta = degToRad(arc.sweepDeg);
  return (arc.radius * arc.radius * (theta - Math.sin(theta))) / 2;
}

/* ─── Generic segment helpers ────────────────────────────── */

export function segmentLength(seg: Segment): number {
  switch (seg.kind) {
    case "line":
      return dist(seg.start, seg.end);
    case "arc":
      return arcLength(seg);
    case "circle":
      return 2 * Math.PI * seg.radius;
  }
}

export function segmentBbox(seg: Segment): Bbox {
  switch (seg.kind) {
    case "line":
      return bboxOf([seg.start, seg.end]);
    case "arc":
      return arcBbox(seg);
    case "circle":
      return makeBbox(
        seg.center.x - seg.radius,
        seg.center.y - seg.radius,
        seg.center.x + seg.radius,
        seg.center.y + seg.radius
      );
  }
}

/** Flattened points of a segment in its natural direction (start → end). */
export function flattenSegment(seg: Segment, chordError = DEFAULT_CHORD_ERROR_MM): Point[] {
  switch (seg.kind) {
    case "line":
      return [{ ...seg.start }, { ...seg.end }];
    case "arc":
      return flattenArc(seg, chordError);
    case "circle": {
      const pts = flattenCircle(seg, chordError);
      return [...pts, { ...pts[0] }];
    }
  }
}

/** Tangent direction (unit) at the start or end of a line/arc, pointing along the CCW direction of travel. */
export function tangentAt(seg: LineSegment | ArcSegment, at: "start" | "end"): Point {
  if (seg.kind === "line") return normalize(sub(seg.end, seg.start));
  const p = at === "start" ? seg.start : seg.end;
  const radial = normalize(sub(p, seg.center));
  return { x: -radial.y, y: radial.x }; // CCW tangent
}

/* ─── Distances ──────────────────────────────────────────── */

export function distPointToSegment(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

export function distPointToArc(p: Point, arc: ArcSegment): number {
  const a = angleDeg(arc.center, p);
  if (arcContainsAngle(arc, a)) return Math.abs(dist(p, arc.center) - arc.radius);
  return Math.min(dist(p, arc.start), dist(p, arc.end));
}

export function distPointToSegmentAny(p: Point, seg: Segment): number {
  switch (seg.kind) {
    case "line":
      return distPointToSegment(p, seg.start, seg.end);
    case "arc":
      return distPointToArc(p, seg);
    case "circle":
      return Math.abs(dist(p, seg.center) - seg.radius);
  }
}

/** Perpendicular distance from p to the infinite line through a, b. */
export function distPointToLine(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const l = length(ab);
  if (l < EPS) return dist(p, a);
  return Math.abs(cross(ab, sub(p, a))) / l;
}

/* ─── Polygons ───────────────────────────────────────────── */

/** Signed shoelace area (positive CCW). Accepts open or closed rings. */
export function polygonArea(points: Point[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Even-odd ray cast. Boundary points are unspecified. */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects =
      pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(points: Point[]): Point {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / n, y: sy / n };
}

/* ─── Bboxes ─────────────────────────────────────────────── */

export function makeBbox(minX: number, minY: number, maxX: number, maxY: number): Bbox {
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function emptyBbox(): Bbox {
  return makeBbox(0, 0, 0, 0);
}

export function bboxOf(points: Point[]): Bbox {
  if (points.length === 0) return emptyBbox();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return makeBbox(minX, minY, maxX, maxY);
}

export function bboxUnion(a: Bbox | null, b: Bbox): Bbox {
  if (!a) return { ...b };
  return makeBbox(
    Math.min(a.minX, b.minX),
    Math.min(a.minY, b.minY),
    Math.max(a.maxX, b.maxX),
    Math.max(a.maxY, b.maxY)
  );
}

export function bboxUnionAll(boxes: Bbox[]): Bbox {
  let acc: Bbox | null = null;
  for (const b of boxes) acc = bboxUnion(acc, b);
  return acc ?? emptyBbox();
}

/** True when `inner` lies entirely within `outer` (with tolerance). */
export function bboxContains(outer: Bbox, inner: Bbox, tol = 1e-6): boolean {
  return (
    inner.minX >= outer.minX - tol &&
    inner.minY >= outer.minY - tol &&
    inner.maxX <= outer.maxX + tol &&
    inner.maxY <= outer.maxY + tol
  );
}

export function bboxOverlaps(a: Bbox, b: Bbox, tol = 1e-6): boolean {
  return !(a.maxX < b.minX - tol || b.maxX < a.minX - tol || a.maxY < b.minY - tol || b.maxY < a.minY - tol);
}

export function bboxMaxSide(b: Bbox): number {
  return Math.max(b.width, b.height);
}

export function bboxCenter(b: Bbox): Point {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function bboxArea(b: Bbox): number {
  return b.width * b.height;
}

/* ─── Affine transforms (INSERT explode, scale, mirror) ──── */

/** Row-major 2×3 affine: x' = a·x + c·y + e ; y' = b·x + d·y + f. */
export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function affineApply(m: Affine, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** m1 ∘ m2 : apply m2 first, then m1. */
export function affineCompose(m1: Affine, m2: Affine): Affine {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function affineTranslate(dx: number, dy: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

export function affineScale(sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export function affineRotateDeg(deg: number): Affine {
  const r = degToRad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
}

/** Uniform scale magnitude when the transform is conformal, else null. */
export function affineUniformScale(m: Affine): number | null {
  const sx = Math.hypot(m.a, m.b);
  const sy = Math.hypot(m.c, m.d);
  if (!nearlyEqual(sx, sy, 1e-9 * Math.max(1, sx))) return null;
  if (!nearlyEqual(m.a * m.c + m.b * m.d, 0, 1e-9 * Math.max(1, sx * sx))) return null;
  return sx;
}

/** Determinant sign: negative = mirroring transform. */
export function affineIsMirror(m: Affine): boolean {
  return m.a * m.d - m.b * m.c < 0;
}

/**
 * Transform a segment. Conformal transforms keep arcs/circles exact
 * (mirroring reverses the arc so it stays CCW); anything else flattens
 * the curve into a line chain, which is what `flattened` reports.
 */
export function transformSegment(
  seg: Segment,
  m: Affine,
  chordError = DEFAULT_CHORD_ERROR_MM
): { segments: Segment[]; flattened: boolean } {
  if (seg.kind === "line") {
    return { segments: [makeLine(affineApply(m, seg.start), affineApply(m, seg.end))], flattened: false };
  }
  const k = affineUniformScale(m);
  if (k === null || k < EPS) {
    const pts = flattenSegment(seg, chordError).map((p) => affineApply(m, p));
    const segments: Segment[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      if (dist(pts[i], pts[i + 1]) > EPS) segments.push(makeLine(pts[i], pts[i + 1]));
    }
    return { segments, flattened: true };
  }
  if (seg.kind === "circle") {
    return { segments: [makeCircle(affineApply(m, seg.center), seg.radius * k)], flattened: false };
  }
  const center = affineApply(m, seg.center);
  const start = affineApply(m, seg.start);
  const end = affineApply(m, seg.end);
  const radius = seg.radius * k;
  const mirror = affineIsMirror(m);
  // After a mirror the CCW arc from start→end becomes CW, so the CCW arc runs end→start.
  const a0 = mirror ? angleDeg(center, end) : angleDeg(center, start);
  const arc: ArcSegment = {
    kind: "arc",
    center,
    radius,
    startAngleDeg: a0,
    endAngleDeg: normalizeDeg(a0 + seg.sweepDeg),
    sweepDeg: seg.sweepDeg,
    start: mirror ? end : start,
    end: mirror ? start : end,
  };
  return { segments: [arc], flattened: false };
}

/* ─── Rounding ───────────────────────────────────────────── */

export function round(v: number, decimals = 3): number {
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}
