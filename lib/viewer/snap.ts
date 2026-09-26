/**
 * Viewer — snapping for the point-pick tools (draw bend, weld by points,
 * calibrate). Pure, no React.
 * File path: /lib/viewer/snap.ts
 *
 * Candidates within `radiusPx` of the cursor, in priority order:
 *   1. endpoints of lines and arcs,
 *   2. midpoints of lines and arcs,
 *   3. circle centres,
 *   4. perpendicular feet — the foot of the perpendicular from `from`
 *      (the previously picked point) onto the edge under the cursor,
 *      then the plain projection of the cursor onto the nearest edge.
 * Priority wins over distance (an endpoint 8 px away beats an edge
 * projection 1 px away) — that is what makes two clicks land exactly on
 * the outline corners. Without a candidate the raw world point is
 * returned with `kind: null`.
 *
 * `entityPickPoints` is the keyboard equivalent of two snapped clicks:
 * Enter on the focused entity picks its two ends (a circle: the ends of
 * its horizontal diameter; a closed chain: the first edge), so a bend
 * along an edge, a weld over it or a calibration on a known edge / hole
 * needs no pointer.
 */

import type { ArcSegment, GeometryEntity, LineSegment, Point, Segment } from "@/lib/geometry/types";
import {
  add,
  angleDeg,
  arcContainsAngle,
  arcMidpoint,
  dist,
  dot,
  midpoint,
  normalize,
  scale as scaleVec,
  sub,
} from "@/lib/geometry/math";
import { screenToWorld, worldToScreen, type ViewTransform } from "./view-transform";

export const SNAP_RADIUS_PX = 10;

export type SnapKind = "endpoint" | "midpoint" | "center" | "perpendicular";

export type SnapCandidate = {
  point: Point;
  kind: SnapKind;
  entityId: string;
  priority: number;
  distancePx: number;
};

export type SnapResult = {
  point: Point;
  kind: SnapKind | null;
  entityId: string | null;
};

export type SnapOptions = {
  radiusPx?: number;
  /** Previously picked point — enables the perpendicular-foot candidate. */
  from?: Point | null;
  filter?: (entity: GeometryEntity) => boolean;
};

const PRIORITY: Record<SnapKind, number> = { endpoint: 0, midpoint: 1, center: 2, perpendicular: 3 };
/** The plain cursor projection ranks below the foot from the picked point. */
const PRIORITY_PROJECTION = 4;

/** Nearest point of the segment to `p` (the perpendicular foot when it lies on the segment). */
export function projectOntoSegment(p: Point, seg: Segment): Point | null {
  if (seg.kind === "line") return projectOntoLine(p, seg);
  if (seg.kind === "circle") {
    const r = sub(p, seg.center);
    if (dist(p, seg.center) < 1e-9) return null;
    return add(seg.center, scaleVec(normalize(r), seg.radius));
  }
  return projectOntoArc(p, seg);
}

function projectOntoLine(p: Point, seg: LineSegment): Point | null {
  const ab = sub(seg.end, seg.start);
  const l2 = dot(ab, ab);
  if (l2 < 1e-18) return null;
  const t = dot(sub(p, seg.start), ab) / l2;
  if (t < 0 || t > 1) return null;
  return add(seg.start, scaleVec(ab, t));
}

function projectOntoArc(p: Point, seg: ArcSegment): Point | null {
  if (dist(p, seg.center) < 1e-9) return null;
  const a = angleDeg(seg.center, p);
  if (!arcContainsAngle(seg, a)) return null;
  return add(seg.center, scaleVec(normalize(sub(p, seg.center)), seg.radius));
}

function bboxNear(entity: GeometryEntity, world: Point, radiusMm: number): boolean {
  const b = entity.bbox;
  return (
    world.x >= b.minX - radiusMm &&
    world.x <= b.maxX + radiusMm &&
    world.y >= b.minY - radiusMm &&
    world.y <= b.maxY + radiusMm
  );
}

/** Every snap candidate within the radius, best first. */
export function snapCandidates(
  entities: readonly GeometryEntity[],
  screenPoint: Point,
  vt: ViewTransform,
  options: SnapOptions = {}
): SnapCandidate[] {
  const radiusPx = options.radiusPx ?? SNAP_RADIUS_PX;
  const world = screenToWorld(vt, screenPoint);
  const radiusMm = radiusPx / vt.scale;
  const out: SnapCandidate[] = [];
  const push = (point: Point, kind: SnapKind, entityId: string, priority = PRIORITY[kind]) => {
    const d = dist(worldToScreen(vt, point), screenPoint);
    if (d <= radiusPx) out.push({ point, kind, entityId, priority, distancePx: d });
  };
  for (const entity of entities) {
    if (options.filter && !options.filter(entity)) continue;
    if (!bboxNear(entity, world, radiusMm)) continue;
    for (const seg of entity.segments) {
      if (seg.kind === "circle") {
        push(seg.center, "center", entity.id);
      } else {
        push(seg.start, "endpoint", entity.id);
        push(seg.end, "endpoint", entity.id);
        push(seg.kind === "line" ? midpoint(seg.start, seg.end) : arcMidpoint(seg), "midpoint", entity.id);
      }
      if (options.from) {
        const foot = projectOntoSegment(options.from, seg);
        if (foot) push(foot, "perpendicular", entity.id);
      }
      const proj = projectOntoSegment(world, seg);
      if (proj) push(proj, "perpendicular", entity.id, PRIORITY_PROJECTION);
    }
  }
  out.sort((a, b) => a.priority - b.priority || a.distancePx - b.distancePx);
  return out;
}

/** Best candidate, or the raw world point under the cursor. */
export function snapPoint(
  entities: readonly GeometryEntity[],
  screenPoint: Point,
  vt: ViewTransform,
  options: SnapOptions = {}
): SnapResult {
  const [best] = snapCandidates(entities, screenPoint, vt, options);
  if (best) return { point: best.point, kind: best.kind, entityId: best.entityId };
  return { point: screenToWorld(vt, screenPoint), kind: null, entityId: null };
}

/**
 * The two points a keyboard pick of the entity yields, or null when the
 * entity has no segments. Open chains: first start → last end; closed
 * chains (start = end): the first edge; circles: horizontal diameter.
 */
export function entityPickPoints(entity: GeometryEntity): [Point, Point] | null {
  const first = entity.segments[0];
  const last = entity.segments[entity.segments.length - 1];
  if (!first || !last) return null;
  if (first.kind === "circle") {
    return [
      { x: first.center.x - first.radius, y: first.center.y },
      { x: first.center.x + first.radius, y: first.center.y },
    ];
  }
  const start = { ...first.start };
  const end = last.kind === "circle" ? { ...last.center } : { ...last.end };
  if (dist(start, end) > 1e-9) return [start, end];
  return [start, { ...first.end }];
}
