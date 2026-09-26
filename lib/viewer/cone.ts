/**
 * Viewer — cone detection for the rolling dialog. Pure, no React.
 * File path: /lib/viewer/cone.ts
 *
 * A rolled cone unfolds to an annular sector: two concentric arcs of
 * the same sweep joined by two radial lines. When the outer contour of
 * the geometry has exactly that shape the dialog is prefilled:
 *   slant height  = Ro − Ri              → `axisLengthMm`
 *   outer arc     = Ro · θ               → `developedWidthMm`
 *   large-end radius = Ro · θ / 2π       → suggested `radiusMm`
 * Tolerances: centres within `toleranceMm`, sweeps within 0.5°, line
 * endpoints on the two radii within `toleranceMm`. Polylines are
 * accepted (their segments are flattened into the arc/line lists).
 */

import type { ArcSegment, LineSegment, PartGeometry, Point, RollAnnotation, Segment } from "@/lib/geometry/types";
import { degToRad, dist, distPointToLine } from "@/lib/geometry/math";

export type ConeDetection = {
  center: Point;
  innerRadiusMm: number;
  outerRadiusMm: number;
  sweepDeg: number;
  /** Slant height Ro − Ri: the straight dimension along the cone. */
  axisLengthMm: number;
  /** Outer arc length Ro·θ: the curved dimension. */
  developedWidthMm: number;
  largeEndRadiusMm: number;
  smallEndRadiusMm: number;
};

export const CONE_TOLERANCE_MM = 0.05;
export const CONE_SWEEP_TOLERANCE_DEG = 0.5;

function outerSegments(geometry: PartGeometry): Segment[] | null {
  const loop = geometry.loops.find((l) => l.id === geometry.outerLoopId);
  if (!loop) return null;
  const byId = new Map(geometry.entities.map((e) => [e.id, e]));
  const segs: Segment[] = [];
  for (const id of loop.entityIds) {
    const e = byId.get(id);
    if (!e) return null;
    segs.push(...e.segments);
  }
  return segs;
}

export function detectAnnularSector(geometry: PartGeometry, toleranceMm = CONE_TOLERANCE_MM): ConeDetection | null {
  const segs = outerSegments(geometry);
  if (!segs) return null;
  const arcs: ArcSegment[] = [];
  const lines: LineSegment[] = [];
  for (const s of segs) {
    if (s.kind === "circle") return null;
    if (s.kind === "arc") arcs.push(s);
    else if (dist(s.start, s.end) > toleranceMm) lines.push(s);
  }
  if (arcs.length !== 2 || lines.length !== 2) return null;
  const [a, b] = arcs;
  if (dist(a.center, b.center) > toleranceMm) return null;
  if (Math.abs(a.sweepDeg - b.sweepDeg) > CONE_SWEEP_TOLERANCE_DEG) return null;
  const inner = Math.min(a.radius, b.radius);
  const outer = Math.max(a.radius, b.radius);
  if (outer - inner <= toleranceMm || inner <= toleranceMm) return null;
  const center = { x: (a.center.x + b.center.x) / 2, y: (a.center.y + b.center.y) / 2 };
  for (const line of lines) {
    if (distPointToLine(center, line.start, line.end) > toleranceMm) return null;
    const radii = [dist(line.start, center), dist(line.end, center)].sort((x, y) => x - y);
    if (Math.abs(radii[0] - inner) > toleranceMm || Math.abs(radii[1] - outer) > toleranceMm) return null;
  }
  const sweepDeg = (a.sweepDeg + b.sweepDeg) / 2;
  const theta = degToRad(sweepDeg);
  return {
    center,
    innerRadiusMm: inner,
    outerRadiusMm: outer,
    sweepDeg,
    axisLengthMm: outer - inner,
    developedWidthMm: outer * theta,
    largeEndRadiusMm: (outer * theta) / (2 * Math.PI),
    smallEndRadiusMm: (inner * theta) / (2 * Math.PI),
  };
}

/**
 * Rolling-dialog prefill: cone data when detected, otherwise the bbox
 * (axis along the longer side, radius left for the user). The arc angle
 * defaults to a full 360° tube.
 */
export function rollPrefill(geometry: PartGeometry, existing: RollAnnotation | null): RollAnnotation & { radiusMm: number } {
  if (existing) return { ...existing, cone: existing.cone ? { ...existing.cone } : null };
  const cone = detectAnnularSector(geometry);
  const bbox = geometry.measures.bbox;
  if (cone) {
    return {
      radiusMm: cone.largeEndRadiusMm,
      axis: bbox.width >= bbox.height ? "x" : "y",
      arcAngleDeg: 360,
      axisLengthMm: cone.axisLengthMm,
      developedWidthMm: cone.developedWidthMm,
      cone: { innerRadiusMm: cone.innerRadiusMm, outerRadiusMm: cone.outerRadiusMm, sweepDeg: cone.sweepDeg },
    };
  }
  const axis = bbox.width >= bbox.height ? "x" : "y";
  return {
    radiusMm: 0,
    axis,
    arcAngleDeg: 360,
    axisLengthMm: axis === "x" ? bbox.width : bbox.height,
    developedWidthMm: axis === "x" ? bbox.height : bbox.width,
    cone: null,
  };
}

/** Dimensions along / across the roll axis for a given bbox and axis. */
export function rollDimensions(bbox: { width: number; height: number }, axis: "x" | "y"): { axisLengthMm: number; developedWidthMm: number } {
  return axis === "x"
    ? { axisLengthMm: bbox.width, developedWidthMm: bbox.height }
    : { axisLengthMm: bbox.height, developedWidthMm: bbox.width };
}
