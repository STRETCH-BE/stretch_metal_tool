/**
 * Pricing engine — the 2-D vector math behind the press-brake rules
 * (hole edge to bend line, flange lengths). Pure, unit-tested separately.
 * File path: /lib/pricing/bend-checks.ts
 *
 * A bend line is a segment a→b. With d = unit(b − a) and the left normal
 * n = (−d.y, d.x):
 * - hole edge distance = |(c − a)·n| − r, evaluated only when the
 *   perpendicular foot (c − a)·d lies within [−r, |b − a| + r], i.e. the
 *   hole actually meets the bend's span; otherwise null (no rule fires).
 * - contour edge distance (non-circular holes) = the same, over the
 *   loop's polygon vertices: negative when vertices lie on both sides,
 *   null when the vertices' span along d misses [0, |b − a|].
 * - flange lengths = the extent of the outline on each side of the line
 *   (max of (p − a)·n over the outline points on the positive side, max of
 *   −(p − a)·n on the negative side), capped by the distance to the nearest
 *   PARALLEL bend (within 1°) whose span overlaps this one — two close
 *   parallel bends form a short flange between them.
 */

import type { Point } from "../geometry/types";

export type BendSegment = { start: Point; end: Point };

const PARALLEL_TOLERANCE_DEG = 1;
const EPS = 1e-9;

type Frame = { a: Point; d: Point; n: Point; length: number };

function frameOf(bend: BendSegment): Frame | null {
  const dx = bend.end.x - bend.start.x;
  const dy = bend.end.y - bend.start.y;
  const length = Math.hypot(dx, dy);
  if (length < EPS) return null;
  const d = { x: dx / length, y: dy / length };
  return { a: bend.start, d, n: { x: -d.y, y: d.x }, length };
}

function dot(p: Point, q: Point): number {
  return p.x * q.x + p.y * q.y;
}

function rel(p: Point, a: Point): Point {
  return { x: p.x - a.x, y: p.y - a.y };
}

/**
 * Signed distance (mm) from the hole EDGE to the bend line: negative when
 * the hole crosses the line, null when the hole lies beside the segment.
 */
export function holeEdgeToBendMm(
  bend: BendSegment,
  center: Point,
  holeRadiusMm: number
): number | null {
  const f = frameOf(bend);
  if (!f) return null;
  const v = rel(center, f.a);
  const along = dot(v, f.d);
  if (along < -holeRadiusMm || along > f.length + holeRadiusMm) return null;
  return Math.abs(dot(v, f.n)) - holeRadiusMm;
}

export function areParallel(a: BendSegment, b: BendSegment, toleranceDeg = PARALLEL_TOLERANCE_DEG): boolean {
  const fa = frameOf(a);
  const fb = frameOf(b);
  if (!fa || !fb) return false;
  const cross = Math.abs(fa.d.x * fb.d.y - fa.d.y * fb.d.x);
  return cross <= Math.sin((toleranceDeg * Math.PI) / 180);
}

/** True when the projection of `other` onto `bend`'s direction overlaps `bend`'s span. */
export function spansOverlap(bend: BendSegment, other: BendSegment): boolean {
  const f = frameOf(bend);
  if (!f) return false;
  const s = dot(rel(other.start, f.a), f.d);
  const e = dot(rel(other.end, f.a), f.d);
  const lo = Math.min(s, e);
  const hi = Math.max(s, e);
  return Math.max(0, lo) < Math.min(f.length, hi) - EPS;
}

export type FlangeLengths = {
  /** Extent (mm) on the normal's positive side. */
  positive: number;
  /** Extent (mm) on the normal's negative side. */
  negative: number;
  smaller: number;
  /** True when the smaller flange is bounded by a neighbouring parallel bend. */
  boundedByBend: boolean;
};

export function flangeLengthsMm(
  bend: BendSegment,
  outline: Point[],
  otherBends: BendSegment[] = []
): FlangeLengths | null {
  const f = frameOf(bend);
  if (!f || outline.length === 0) return null;
  let positive = 0;
  let negative = 0;
  for (const p of outline) {
    const s = dot(rel(p, f.a), f.n);
    if (s > positive) positive = s;
    if (-s > negative) negative = -s;
  }
  let boundedPositive = false;
  let boundedNegative = false;
  for (const other of otherBends) {
    if (other === bend || !areParallel(bend, other) || !spansOverlap(bend, other)) continue;
    const s = dot(rel(other.start, f.a), f.n);
    if (s > EPS && s < positive) {
      positive = s;
      boundedPositive = true;
    } else if (s < -EPS && -s < negative) {
      negative = -s;
      boundedNegative = true;
    }
  }
  const smaller = Math.min(positive, negative);
  return {
    positive,
    negative,
    smaller,
    boundedByBend: smaller === positive ? boundedPositive : boundedNegative,
  };
}

/**
 * Signed distance (mm) from a closed contour (the loop's flattened
 * polygon) to the bend line: negative when the contour straddles the
 * line (depth of the shallower side), null when the contour lies
 * entirely beside the bend's span. Used for non-circular holes (windows,
 * slots, rounded cut-outs) whose HoleInfo.diameterMm is only the bbox
 * max side — a 129 mm wide window treated as a Ø129 circle would "cross"
 * a bend 30 mm away. All vertices on one side of the line ⇒ the whole
 * polygon is (it lies inside the convex hull of its vertices), and the
 * nearest point of a non-crossing polygon to a line is always a vertex.
 */
export function contourEdgeToBendMm(bend: BendSegment, points: readonly Point[]): number | null {
  const f = frameOf(bend);
  if (!f || points.length === 0) return null;
  let minAlong = Number.POSITIVE_INFINITY;
  let maxAlong = Number.NEGATIVE_INFINITY;
  let minPerp = Number.POSITIVE_INFINITY;
  let maxPerp = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const v = rel(p, f.a);
    const along = dot(v, f.d);
    const perp = dot(v, f.n);
    if (along < minAlong) minAlong = along;
    if (along > maxAlong) maxAlong = along;
    if (perp < minPerp) minPerp = perp;
    if (perp > maxPerp) maxPerp = perp;
  }
  if (maxAlong < 0 || minAlong > f.length) return null;
  if (minPerp < -EPS && maxPerp > EPS) return -Math.min(-minPerp, maxPerp);
  return Math.min(Math.abs(minPerp), Math.abs(maxPerp));
}
