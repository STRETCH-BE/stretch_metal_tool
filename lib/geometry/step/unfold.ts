/**
 * Geometry engine — flat pattern of a bent sheet-metal STEP body.
 * File path: /lib/geometry/step/unfold.ts
 *
 * A press-brake part is a set of planar flanges joined by cylindrical
 * bends. The solid has two sheet sides; every bend shows on each side as
 * one cylinder (inner radius r on one side, r + t on the other) that
 * shares one straight tangent edge with each of the two flanges it joins.
 * Unfolding walks that graph on ONE side:
 *   1. the largest planar face is the root flange, drawn in its own plane;
 *   2. for every bend cylinder touching a placed flange, the flange on the
 *      cylinder's other tangent edge is placed next to it: the tangent
 *      edges become parallel lines a bend allowance apart, matched point
 *      for point along the bend axis, and the flange's interior lies away
 *      from the placed one;
 *   3. the bend zone is the strip between the two tangent lines: its two
 *      short sides join the outline, its centre line is emitted on the
 *      BEND_UP / BEND_DOWN layer so the ordinary pipeline measures it as a
 *      bend line (pricing: 90°, inner radius = thickness by default, the
 *      user adjusts in the bends table).
 * Flange outlines (minus the tangent edges) and holes are copied through
 * each flange's rigid placement, so the result chains into one closed
 * outline like a DXF flat pattern.
 *
 * Bend allowance = angle × (r_inner + K_FACTOR × t), the neutral-axis
 * length; the angle is the angle between the flanges' outward normals.
 *
 * Refused (null → the manual path): a bend cylinder without exactly two
 * flange tangent edges, tangent edges of unequal length, a flange whose
 * placement lands on the wrong side, or a walk that places less than a
 * third of the planar area (a joint that is not a plain cylinder). Never
 * throws for a well-formed model.
 */

import type { ParsedDxf, RawEntity } from "../parse";
import type { DxfHeaderInfo, Point } from "../types";
import { DEFAULT_CHORD_ERROR_MM, angleDeg, makeArc, makeCircle, makeLine, pointsEqual } from "../math";
import {
  add3,
  cross3,
  dist3,
  dot3,
  loopPolyline,
  norm3,
  sampleEdge,
  scale3,
  sub3,
  type Body3,
  type Edge3,
  type Face3,
  type Loop3,
  type Vec3,
} from "./brep";

/** Neutral-axis factor of the bend allowance (DIN 6935 style; shops use 0.33–0.5). */
export const K_FACTOR = 0.4; // [CONFIRM]

const PARALLEL = 0.999;
const COAXIAL_MM = 0.2;
const RADIUS_TOL_MM = 0.1;
const EDGE_LENGTH_TOL_MM = 0.5;
/** Placed flange area must be at least this share of all planar area (both sides + edges). */
const MIN_PLACED_SHARE = 0.3;

/* ─── Bend cylinders ────────────────────────────────────────── */

export type BendGroup = {
  axis: Vec3;
  axisPoint: Vec3;
  innerRadius: number;
  outerRadius: number;
  faces: Face3[];
};

type Cyl = { face: Face3; axis: Vec3; axisPoint: Vec3; radius: number };

function cylinderOf(face: Face3): Cyl | null {
  if (face.surface.kind !== "cylinder") return null;
  const p = face.surface.placement;
  return { face, axis: p.axis, axisPoint: sub3(p.origin, scale3(p.axis, dot3(p.origin, p.axis))), radius: face.surface.radius };
}

function coaxial(a: Cyl, b: Cyl): boolean {
  return Math.abs(dot3(a.axis, b.axis)) >= PARALLEL && dist3(a.axisPoint, b.axisPoint) < COAXIAL_MM;
}

/** Coaxial cylinder groups holding an inner + outer bend surface (radii differ by the thickness). */
export function bendGroups(body: Body3, thicknessMm: number | null): BendGroup[] {
  if (thicknessMm === null) return [];
  const cylinders: Cyl[] = [];
  for (const face of body.faces) {
    const c = cylinderOf(face);
    if (c) cylinders.push(c);
  }
  const groups: Cyl[][] = [];
  for (const c of cylinders) {
    const g = groups.find((group) => coaxial(group[0], c));
    if (g) g.push(c);
    else groups.push([c]);
  }
  const out: BendGroup[] = [];
  for (const g of groups) {
    const radii = Array.from(new Set(g.map((c) => Math.round(c.radius * 100) / 100))).sort((a, b) => a - b);
    let pair: [number, number] | null = null;
    for (let i = 0; i < radii.length && !pair; i++) {
      for (let j = i + 1; j < radii.length; j++) {
        if (Math.abs(radii[j] - radii[i] - thicknessMm) < RADIUS_TOL_MM) {
          pair = [radii[i], radii[j]];
          break;
        }
      }
    }
    if (!pair) continue;
    const [inner, outer] = pair;
    const faces = g.filter((c) => Math.abs(c.radius - inner) < RADIUS_TOL_MM || Math.abs(c.radius - outer) < RADIUS_TOL_MM).map((c) => c.face);
    out.push({ axis: g[0].axis, axisPoint: g[0].axisPoint, innerRadius: inner, outerRadius: outer, faces });
  }
  return out;
}

/* ─── Loops → 2D entities ───────────────────────────────────── */

export type Flattening = { entities: RawEntity[]; splinesFlattened: number; ellipsesFlattened: number };

/** Maps a 3D point of one face into flat-pattern coordinates; `normal` orients arcs. */
export type FlatMap = { toFlat(p: Vec3): Point; normal: Vec3 };

/**
 * Emit the edges of a loop as DXF-like entities: exact lines, arcs and
 * circles (circles whose axis lies on the face normal), everything else
 * flattened. Edges listed in `skip` (bend tangent lines) are left out.
 */
export function loopToEntities(loop: Loop3, map: FlatMap, skip: Set<number> | null, chordError: number, out: Flattening, layer = "0"): void {
  if (loop.edges.length === 1) {
    const e = loop.edges[0].edge;
    if (e.curve.kind === "circle" && dist3(e.start, e.end) < 1e-6 && Math.abs(dot3(e.curve.placement.axis, map.normal)) > PARALLEL) {
      out.entities.push({ originalType: "CIRCLE", layer, segments: [makeCircle(map.toFlat(e.curve.placement.origin), e.curve.radius)], closed: true });
      return;
    }
  }
  for (const oe of loop.edges) {
    const e = oe.edge;
    if (skip && skip.has(e.id)) continue;
    const c = e.curve;
    if (c.kind === "line") {
      const a = map.toFlat(e.start);
      const b = map.toFlat(e.end);
      if (pointsEqual(a, b, 1e-9)) continue;
      out.entities.push({ originalType: "LINE", layer, segments: [makeLine(a, b)], closed: false });
      continue;
    }
    if (c.kind === "circle" && Math.abs(dot3(c.placement.axis, map.normal)) > PARALLEL) {
      const center = map.toFlat(c.placement.origin);
      if (dist3(e.start, e.end) < 1e-6) {
        out.entities.push({ originalType: "CIRCLE", layer, segments: [makeCircle(center, c.radius)], closed: true });
        continue;
      }
      const a = map.toFlat(e.start);
      const b = map.toFlat(e.end);
      // CCW around the circle's own axis when same_sense; mirrored when
      // the circle axis points against the face normal. A rigid placement
      // keeps the orientation, so the flat frame agrees with the face frame.
      const ccw = e.sameSense !== dot3(c.placement.axis, map.normal) < 0;
      const startDeg = angleDeg(center, ccw ? a : b);
      const endDeg = angleDeg(center, ccw ? b : a);
      out.entities.push({ originalType: "ARC", layer, segments: [makeArc(center, c.radius, startDeg, endDeg)], closed: false });
      continue;
    }
    const pts = sampleEdge(e, chordError).map((v) => map.toFlat(v));
    const segments = [];
    for (let i = 0; i < pts.length - 1; i++) {
      if (pointsEqual(pts[i], pts[i + 1], 1e-9)) continue;
      segments.push(makeLine(pts[i], pts[i + 1]));
    }
    if (segments.length === 0) continue;
    const originalType = c.kind === "bspline" ? "SPLINE" : c.kind === "ellipse" ? "ELLIPSE" : "LWPOLYLINE";
    if (c.kind === "bspline") out.splinesFlattened++;
    if (c.kind === "ellipse") out.ellipsesFlattened++;
    out.entities.push({ originalType, layer, segments, closed: false });
  }
}

export function polygonArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function polygonCentroid(pts: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const w = p.x * q.y - q.x * p.y;
    a += w;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  if (Math.abs(a) < 1e-12) {
    const n = Math.max(1, pts.length);
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function extentsOf(loops: Point[][]): { min: Point; max: Point } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const p of loop) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return Number.isFinite(minX) ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } : null;
}

/* ─── Flanges ───────────────────────────────────────────────── */

/** A planar face with a right-handed 2D frame about its OUTWARD normal. */
type Flange = {
  face: Face3;
  origin: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  area: number;
  /** Centroid of the outer loop in the face frame. */
  centroid: Point;
  /** Rigid placement into the flat pattern (set when placed). */
  placement: Rigid | null;
};

type Rigid = { cos: number; sin: number; tx: number; ty: number };

function applyRigid(r: Rigid, p: Point): Point {
  return { x: r.cos * p.x - r.sin * p.y + r.tx, y: r.sin * p.x + r.cos * p.y + r.ty };
}

/** Rotation + translation mapping (a1 → b1, a2 → b2) as closely as a rigid motion can. */
function rigidFromPairs(a1: Point, a2: Point, b1: Point, b2: Point): Rigid {
  const theta = Math.atan2(b2.y - b1.y, b2.x - b1.x) - Math.atan2(a2.y - a1.y, a2.x - a1.x);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return { cos, sin, tx: b1.x - (cos * a1.x - sin * a1.y), ty: b1.y - (sin * a1.x + cos * a1.y) };
}

function flangeOf(face: Face3, chordError: number): Flange | null {
  if (face.surface.kind !== "plane" || !face.outer) return null;
  const p = face.surface.placement;
  const normal = face.sameSense ? p.axis : scale3(p.axis, -1);
  const u = p.ref;
  const v = norm3(cross3(normal, u));
  const origin = p.origin;
  const to2 = (q: Vec3): Point => {
    const d = sub3(q, origin);
    return { x: dot3(d, u), y: dot3(d, v) };
  };
  const outer2 = loopPolyline(face.outer, chordError).map(to2);
  if (outer2.length < 3) return null;
  let area = polygonArea(outer2);
  for (const hole of face.inner) area -= polygonArea(loopPolyline(hole, chordError).map(to2));
  return { face, origin, normal, u, v, area: Math.max(0, area), centroid: polygonCentroid(outer2), placement: null };
}

function to2(f: Flange, q: Vec3): Point {
  const d = sub3(q, f.origin);
  return { x: dot3(d, f.u), y: dot3(d, f.v) };
}

function centroid3(f: Flange): Vec3 {
  return add3(f.origin, add3(scale3(f.u, f.centroid.x), scale3(f.v, f.centroid.y)));
}

/* ─── Unfold ────────────────────────────────────────────────── */

export type UnfoldResult = {
  parsed: ParsedDxf;
  flanges: number;
  bends: number;
};

type Tangent = { edge: Edge3; flange: Flange };

export function unfoldBody(body: Body3, thicknessMm: number, unitScale: number, chordError = DEFAULT_CHORD_ERROR_MM): UnfoldResult | null {
  const groups = bendGroups(body, thicknessMm);
  if (groups.length === 0) return null;

  // Planar faces as flanges, indexed by face.
  const flanges = new Map<Face3, Flange>();
  let planarArea = 0;
  for (const face of body.faces) {
    const f = flangeOf(face, chordError);
    if (f) {
      flanges.set(face, f);
      planarArea += f.area;
    }
  }
  if (flanges.size === 0) return null;

  // Edge id → planar faces using it (outer loops only: tangent lines are outer edges).
  const facesByEdge = new Map<number, Face3[]>();
  for (const face of body.faces) {
    if (!face.outer) continue;
    for (const oe of face.outer.edges) {
      if (oe.edge.id < 0) continue;
      const list = facesByEdge.get(oe.edge.id);
      if (list) {
        if (!list.includes(face)) list.push(face);
      } else facesByEdge.set(oe.edge.id, [face]);
    }
  }

  // Each bend shows on each sheet side as the cylinder(s) of one radius;
  // that side's straight edges shared with flanges are its two tangent
  // lines (a cylinder split into several faces still yields two).
  type BendInfo = { group: BendGroup; tangents: Tangent[] };
  const bends: BendInfo[] = [];
  const tangentEdgeIds = new Set<number>();
  for (const group of groups) {
    for (const radius of [group.innerRadius, group.outerRadius]) {
      const tangents: Tangent[] = [];
      for (const cyl of group.faces) {
        if (!cyl.outer || cyl.surface.kind !== "cylinder" || Math.abs(cyl.surface.radius - radius) > RADIUS_TOL_MM) continue;
        for (const oe of cyl.outer.edges) {
          const e = oe.edge;
          if (e.curve.kind !== "line") continue;
          const others = (facesByEdge.get(e.id) ?? []).filter((f) => f !== cyl);
          for (const other of others) {
            const flange = flanges.get(other);
            if (flange && !tangents.some((t) => t.edge.id === e.id)) tangents.push({ edge: e, flange });
          }
        }
      }
      if (tangents.length !== 2) continue;
      if (Math.abs(dist3(tangents[0].edge.start, tangents[0].edge.end) - dist3(tangents[1].edge.start, tangents[1].edge.end)) > EDGE_LENGTH_TOL_MM) continue;
      bends.push({ group, tangents });
      for (const t of tangents) tangentEdgeIds.add(t.edge.id);
    }
  }
  if (bends.length === 0) return null;

  // Root: the largest flange.
  let root: Flange | null = null;
  for (const f of flanges.values()) if (!root || f.area > root.area) root = f;
  if (!root) return null;
  root.placement = { cos: 1, sin: 0, tx: 0, ty: 0 };

  const out: Flattening = { entities: [], splinesFlattened: 0, ellipsesFlattened: 0 };
  const allPoints: Point[][] = [];
  let bendCount = 0;

  const placedFlat = (f: Flange, q: Vec3): Point => applyRigid(f.placement as Rigid, to2(f, q));

  // Breadth-first over bends from placed flanges.
  const queue: Flange[] = [root];
  // One walk per bend: the side reached first is the side being unfolded.
  const usedGroups = new Set<BendGroup>();
  while (queue.length) {
    const from = queue.shift() as Flange;
    for (const bend of bends) {
      if (usedGroups.has(bend.group)) continue;
      const mine = bend.tangents.find((t) => t.flange === from);
      if (!mine) continue;
      const theirs = bend.tangents.find((t) => t !== mine) as Tangent;
      usedGroups.add(bend.group);
      const to = theirs.flange;
      if (to.placement) continue; // closed loop of flanges: leave the second path out

      const d = bend.group.axis;
      // Tangent edge of `from` in the flat pattern, both ends.
      const A = [mine.edge.start, mine.edge.end];
      const B = [theirs.edge.start, theirs.edge.end];
      // Match the ends along the bend axis.
      const same = Math.abs(dot3(A[0], d) - dot3(B[0], d)) + Math.abs(dot3(A[1], d) - dot3(B[1], d));
      const swapped = Math.abs(dot3(A[0], d) - dot3(B[1], d)) + Math.abs(dot3(A[1], d) - dot3(B[0], d));
      if (swapped < same) B.reverse();

      const a1 = placedFlat(from, A[0]);
      const a2 = placedFlat(from, A[1]);
      const ex = a2.x - a1.x;
      const ey = a2.y - a1.y;
      const el = Math.hypot(ex, ey);
      if (el < 1e-6) return null;
      let nx = -ey / el;
      let ny = ex / el;
      const cFrom = applyRigid(from.placement as Rigid, from.centroid);
      if ((cFrom.x - a1.x) * nx + (cFrom.y - a1.y) * ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      const angle = Math.acos(Math.max(-1, Math.min(1, dot3(from.normal, to.normal))));
      const allowance = angle * (bend.group.innerRadius + K_FACTOR * thicknessMm);
      const t1 = { x: a1.x + allowance * nx, y: a1.y + allowance * ny };
      const t2 = { x: a2.x + allowance * nx, y: a2.y + allowance * ny };

      let placement = rigidFromPairs(to2(to, B[0]), to2(to, B[1]), t1, t2);
      let cTo = applyRigid(placement, to.centroid);
      if ((cTo.x - t1.x) * nx + (cTo.y - t1.y) * ny < 0) {
        // Try the other end correspondence before giving up.
        placement = rigidFromPairs(to2(to, B[1]), to2(to, B[0]), t1, t2);
        cTo = applyRigid(placement, to.centroid);
        if ((cTo.x - t1.x) * nx + (cTo.y - t1.y) * ny < 0) return null;
      }
      to.placement = placement;
      queue.push(to);

      // Bend zone: two short sides join the outline; the centre line is the bend line.
      out.entities.push({ originalType: "LINE", layer: "0", segments: [makeLine(a1, t1)], closed: false });
      out.entities.push({ originalType: "LINE", layer: "0", segments: [makeLine(a2, t2)], closed: false });
      const mid3 = scale3(add3(theirs.edge.start, theirs.edge.end), 0.5);
      const rises = dot3(sub3(centroid3(to), mid3), from.normal) > 0;
      const c1 = { x: a1.x + (allowance / 2) * nx, y: a1.y + (allowance / 2) * ny };
      const c2 = { x: a2.x + (allowance / 2) * nx, y: a2.y + (allowance / 2) * ny };
      out.entities.push({ originalType: "LINE", layer: rises ? "BEND_UP" : "BEND_DOWN", segments: [makeLine(c1, c2)], closed: false });
      allPoints.push([a1, a2, t1, t2]);
      bendCount++;
    }
  }

  // Outlines and holes of the placed flanges.
  let placedArea = 0;
  let placed = 0;
  for (const f of flanges.values()) {
    if (!f.placement || !f.face.outer) continue;
    placed++;
    placedArea += f.area;
    const map: FlatMap = { toFlat: (q) => placedFlat(f, q), normal: f.normal };
    loopToEntities(f.face.outer, map, tangentEdgeIds, chordError, out);
    for (const hole of f.face.inner) loopToEntities(hole, map, null, chordError, out);
    allPoints.push(loopPolyline(f.face.outer, chordError).map((q) => placedFlat(f, q)));
  }
  if (bendCount === 0 || placedArea < planarArea * MIN_PLACED_SHARE) return null;

  const extents = extentsOf(allPoints);
  const header: DxfHeaderInfo = {
    version: null,
    units: { insunits: Math.abs(unitScale - 25.4) < 1e-6 ? 1 : 4, detected: "mm", scaleApplied: unitScale },
    extmin: extents?.min ?? null,
    extmax: extents?.max ?? null,
    layers: ["0", "BEND_UP", "BEND_DOWN"],
  };
  return {
    parsed: {
      header,
      entities: out.entities,
      dropped: [],
      splinesFlattened: out.splinesFlattened,
      ellipsesFlattened: out.ellipsesFlattened,
      blocksExploded: 0,
      parseError: null,
    },
    flanges: placed,
    bends: bendCount,
  };
}
