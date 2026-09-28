/**
 * Geometry engine — flat pattern of a sheet-metal STEP body, with the
 * features the model holds beyond the outline.
 * File path: /lib/geometry/step/unfold.ts
 *
 * A press-brake part is a set of planar flanges joined by cylindrical
 * bends. The solid has two sheet sides; every bend shows on each side as
 * one cylinder (inner radius r on one side, r + t on the other) that
 * shares one straight tangent edge with each of the two flanges it joins.
 * Unfolding walks that graph on ONE side:
 *   1. planar faces that are coplanar and share an edge are one FLANGE
 *      (exporters split a face for a masking zone or a cosmetic reason;
 *      the split lines are internal, never outline);
 *   2. the largest flange is the root, drawn in its own plane;
 *   3. for every bend cylinder touching a placed flange, the flange on the
 *      cylinder's other tangent edge is placed next to it: the tangent
 *      edges become parallel lines a bend allowance apart, matched point
 *      for point along the bend axis, the flange's interior lying away
 *      from the placed one. The allowance comes from the caller (bend
 *      table row or DIN 6935 formula — sheet.ts), never a constant;
 *   4. the bend zone is the strip between the two tangent lines: its two
 *      short sides join the outline, its centre line is emitted on the
 *      BEND_UP / BEND_DOWN layer. The drawing is viewed from the side the
 *      flanges bend towards, so a flange folding towards the viewer is
 *      BEND_UP; walking the outside face therefore mirrors the layout.
 * Flange outlines (minus tangent and split edges) and THROUGH holes are
 * copied through each flange's rigid placement, so the result chains
 * into one closed outline like a DXF flat pattern. A hole that does not
 * reach the other sheet side is not a cut: a pocket up to
 * MASK_RECESS_MAX_MM deep is a paint-mask recess, a round pocket up to
 * SEAT_MAX_DIAMETER_MM a stud seat (its centre is reported; the production
 * DXF draws it on the IGNORE layer),
 * anything else a blind pocket the laser cannot make. A conical wall on
 * a through hole is a countersink: the cut is the through diameter, the
 * cone is reported. A free-form wall is a modelled thread. Features on the
 * side that is not walked are found the same way on the opposite faces.
 *
 * Refused (null → the manual path): a bend cylinder without exactly two
 * flange tangent edges, tangent edges of unequal length, a flange whose
 * placement lands on the wrong side, or a walk that places less than a
 * third of the planar area (a joint that is not a plain cylinder). A body
 * without bends is laid out as its single root flange. Never throws for a
 * well-formed model.
 */

import type { ParsedDxf, RawEntity } from "../parse";
import type { BendAllowanceSource, BlindPocket, CountersinkInfo, DxfHeaderInfo, MaskingZone, Point, SheetBend } from "../types";
import { DEFAULT_CHORD_ERROR_MM, angleDeg, makeArc, makeCircle, makeLine, pointsEqual, pointInPolygon } from "../math";
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

const PARALLEL = 0.999;
const COAXIAL_MM = 0.2;
const RADIUS_TOL_MM = 0.1;
const EDGE_LENGTH_TOL_MM = 0.5;
const COPLANAR_MM = 0.02;
/** Placed flange area must be at least this share of all planar area (both sides + edges). */
const MIN_PLACED_SHARE = 0.3;
/** A pocket this shallow (or less) is a paint-mask recess, not a feature. */
export const MASK_RECESS_MAX_MM = 0.05;
/** Round blind pockets up to this diameter are stud seats. */
export const SEAT_MAX_DIAMETER_MM = 12;
/** A hole wall must reach this close to the other side to count as through. */
const THROUGH_TOL_MM = 0.05;
/** A coplanar member of a flange smaller than this share of the flange is a masking split. */
const SPLIT_FACE_MAX_SHARE = 0.4;

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

/** Coplanar, edge-connected planar faces with a right-handed 2D frame about their OUTWARD normal. */
export type Flange = {
  faces: Face3[];
  origin: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  /** Net area of the members (outer loops minus holes). */
  area: number;
  /** Centroid of the largest member's outer loop, in the flange frame. */
  centroid: Point;
  /** Edge ids shared by two members (split lines: internal, not outline). */
  internalEdgeIds: Set<number>;
  /** Rigid placement into the flat pattern (set when placed). */
  placement: Rigid | null;
  /** Members other than the largest that carry no holes: masking-split candidates. */
  splitMembers: Face3[];
};

export type Rigid = { cos: number; sin: number; tx: number; ty: number };

export function applyRigid(r: Rigid, p: Point): Point {
  return { x: r.cos * p.x - r.sin * p.y + r.tx, y: r.sin * p.x + r.cos * p.y + r.ty };
}

/** Rotation + translation mapping (a1 → b1, a2 → b2) as closely as a rigid motion can. */
function rigidFromPairs(a1: Point, a2: Point, b1: Point, b2: Point): Rigid {
  const theta = Math.atan2(b2.y - b1.y, b2.x - b1.x) - Math.atan2(a2.y - a1.y, a2.x - a1.x);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return { cos, sin, tx: b1.x - (cos * a1.x - sin * a1.y), ty: b1.y - (sin * a1.x + cos * a1.y) };
}

type PlanarInfo = { face: Face3; normal: Vec3; offset: number; area: number; outer2: Point[] };

function planarInfo(face: Face3, chordError: number): PlanarInfo | null {
  if (face.surface.kind !== "plane" || !face.outer) return null;
  const p = face.surface.placement;
  const normal = face.sameSense ? p.axis : scale3(p.axis, -1);
  const to2 = (q: Vec3): Point => {
    const d = sub3(q, p.origin);
    return { x: dot3(d, p.ref), y: dot3(d, p.y) };
  };
  const outer2 = loopPolyline(face.outer, chordError).map(to2);
  if (outer2.length < 3) return null;
  let area = polygonArea(outer2);
  for (const hole of face.inner) area -= polygonArea(loopPolyline(hole, chordError).map(to2));
  return { face, normal, offset: dot3(normal, p.origin), area: Math.max(0, area), outer2 };
}

/** Groups coplanar planar faces that share an edge into flanges. */
export function buildFlanges(body: Body3, chordError: number): Flange[] {
  const infos: PlanarInfo[] = [];
  for (const face of body.faces) {
    const info = planarInfo(face, chordError);
    if (info) infos.push(info);
  }
  const edgeOwners = new Map<number, PlanarInfo[]>();
  for (const info of infos) {
    for (const loop of [info.face.outer as Loop3, ...info.face.inner]) {
      for (const oe of loop.edges) {
        if (oe.edge.id < 0) continue;
        const list = edgeOwners.get(oe.edge.id) ?? [];
        list.push(info);
        edgeOwners.set(oe.edge.id, list);
      }
    }
  }
  // Union-find over coplanar edge-sharing faces.
  const parent = new Map<PlanarInfo, PlanarInfo>();
  const find = (a: PlanarInfo): PlanarInfo => {
    let r = a;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r) as PlanarInfo;
    parent.set(a, r);
    return r;
  };
  for (const info of infos) parent.set(info, info);
  const internal = new Set<number>();
  for (const [edgeId, owners] of edgeOwners) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const a = owners[i];
        const b = owners[j];
        if (a === b) continue;
        if (dot3(a.normal, b.normal) < PARALLEL || Math.abs(a.offset - b.offset) > COPLANAR_MM) continue;
        internal.add(edgeId);
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
  }
  const groups = new Map<PlanarInfo, PlanarInfo[]>();
  for (const info of infos) {
    const r = find(info);
    const list = groups.get(r) ?? [];
    list.push(info);
    groups.set(r, list);
  }
  const out: Flange[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => b.area - a.area);
    const main = members[0];
    const p = main.face.surface.kind === "plane" ? main.face.surface.placement : null;
    if (!p) continue;
    const normal = main.normal;
    const u = p.ref;
    const v = norm3(cross3(normal, u));
    const area = members.reduce((s, m) => s + m.area, 0);
    const internalEdgeIds = new Set<number>();
    for (const m of members) {
      for (const loop of [m.face.outer as Loop3, ...m.face.inner]) for (const oe of loop.edges) if (internal.has(oe.edge.id)) internalEdgeIds.add(oe.edge.id);
    }
    const splitMembers = members.slice(1).filter((m) => m.face.inner.length === 0 && m.area <= area * SPLIT_FACE_MAX_SHARE).map((m) => m.face);
    const flange: Flange = { faces: members.map((m) => m.face), origin: p.origin, normal, u, v, area, centroid: { x: 0, y: 0 }, internalEdgeIds, placement: null, splitMembers };
    // Centroid in the flange's own right-handed frame (v = normal × u differs from the plane's y on a flipped face).
    flange.centroid = polygonCentroid(loopPolyline(main.face.outer as Loop3, chordError).map((q) => flangeTo2(flange, q)));
    out.push(flange);
  }
  return out;
}

export function flangeTo2(f: Flange, q: Vec3): Point {
  const d = sub3(q, f.origin);
  return { x: dot3(d, f.u), y: dot3(d, f.v) };
}

function centroid3(f: Flange): Vec3 {
  return add3(f.origin, add3(scale3(f.u, f.centroid.x), scale3(f.v, f.centroid.y)));
}

/* ─── Through / blind features of a sheet face ──────────────── */

export type LoopFeature =
  | { kind: "through"; loop: Loop3; countersink: { throughRadius: number; topRadius: number; depthMm: number } | null; helical: boolean }
  | { kind: "recess"; loop: Loop3; depthMm: number }
  | { kind: "seat"; loop: Loop3; depthMm: number; center: Vec3; diameterMm: number }
  | { kind: "pocket"; loop: Loop3; depthMm: number; center: Vec3; maxSideMm: number; circular: boolean };

function loopCircle(loop: Loop3, normal: Vec3): { center: Vec3; radius: number } | null {
  const circles = loop.edges.map((oe) => oe.edge.curve).filter((c): c is Extract<typeof c, { kind: "circle" }> => c.kind === "circle" && Math.abs(dot3(c.placement.axis, normal)) > PARALLEL);
  if (circles.length === 0 || circles.length !== loop.edges.length) return null;
  const r = circles[0].radius;
  if (circles.some((c) => Math.abs(c.radius - r) > 1e-3)) return null;
  return { center: circles[0].placement.origin, radius: r };
}

function loopMaxSide(loop: Loop3, chordError: number, f: (q: Vec3) => Point): number {
  const pts = loopPolyline(loop, chordError).map(f);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

function loopCenter3(loop: Loop3, chordError: number): Vec3 {
  const pts = loopPolyline(loop, chordError);
  const n = Math.max(1, pts.length);
  return scale3(pts.reduce((s, p) => add3(s, p), { x: 0, y: 0, z: 0 }), 1 / n);
}

/**
 * Classify an inner loop of a sheet face by the wall faces on its edges:
 * how deep they reach into the sheet (along −normal), and whether one of
 * them is a cone (countersink) or a free-form surface (thread).
 */
export function classifyLoop(
  loop: Loop3,
  face: Face3,
  normal: Vec3,
  thicknessMm: number,
  facesByEdge: Map<number, Face3[]>,
  chordError: number
): LoopFeature {
  const origin = face.surface.kind === "plane" ? face.surface.placement.origin : (loop.edges[0]?.edge.start ?? { x: 0, y: 0, z: 0 });
  const walls: Face3[] = [];
  for (const oe of loop.edges) {
    for (const w of facesByEdge.get(oe.edge.id) ?? []) if (w !== face && !walls.includes(w)) walls.push(w);
  }
  let depth = 0;
  let helical = false;
  let cone: Face3 | null = null;
  for (const w of walls) {
    if (w.surface.kind === "cone") cone = w;
    if (w.surface.kind === "other") helical = true;
    const loops: Loop3[] = w.outer ? [w.outer, ...w.inner] : w.inner;
    for (const l of loops) for (const p of loopPolyline(l, chordError)) depth = Math.max(depth, -dot3(sub3(p, origin), normal));
  }
  // No wall found through shared edge ids (tessellated bodies carry no
  // edge identity): keep today's behaviour and cut the loop.
  if (walls.length === 0) return { kind: "through", loop, countersink: null, helical: false };
  if (depth >= thicknessMm - THROUGH_TOL_MM) {
    let countersink: Extract<LoopFeature, { kind: "through" }>["countersink"] = null;
    if (cone) {
      const top = loopCircle(loop, normal);
      // The through diameter: the smallest circle edge on the cone face (its other rim).
      let throughR = Infinity;
      let depthMm = 0;
      const rims: Loop3[] = cone.outer ? [cone.outer, ...cone.inner] : cone.inner;
      for (const rim of rims) for (const oe of rim.edges) {
        const c = oe.edge.curve;
        if (c.kind === "circle" && c.radius < throughR) throughR = c.radius;
        for (const p of sampleEdge(oe.edge, chordError)) depthMm = Math.max(depthMm, -dot3(sub3(p, origin), normal));
      }
      if (top && Number.isFinite(throughR) && throughR < top.radius) countersink = { throughRadius: throughR, topRadius: top.radius, depthMm };
    }
    return { kind: "through", loop, countersink, helical };
  }
  if (depth <= MASK_RECESS_MAX_MM) return { kind: "recess", loop, depthMm: depth };
  const circle = loopCircle(loop, normal);
  if (circle && circle.radius * 2 <= SEAT_MAX_DIAMETER_MM) return { kind: "seat", loop, depthMm: depth, center: circle.center, diameterMm: circle.radius * 2 };
  const to2 = (q: Vec3): Point => {
    const d = sub3(q, origin);
    return { x: dot3(d, face.surface.kind === "plane" ? face.surface.placement.ref : { x: 1, y: 0, z: 0 }), y: dot3(d, face.surface.kind === "plane" ? face.surface.placement.y : { x: 0, y: 1, z: 0 }) };
  };
  return { kind: "pocket", loop, depthMm: depth, center: circle ? circle.center : loopCenter3(loop, chordError), maxSideMm: circle ? circle.radius * 2 : loopMaxSide(loop, chordError, to2), circular: circle !== null };
}

/* ─── Unfold ────────────────────────────────────────────────── */

export type AllowanceFn = (angleRad: number, innerRadiusMm: number, lengthMm: number) => { allowanceMm: number; source: BendAllowanceSource };

export type UnfoldOptions = {
  thicknessMm: number;
  unitScale: number;
  allowance: AllowanceFn;
  chordError?: number;
};

export type UnfoldResult = {
  parsed: ParsedDxf;
  flanges: number;
  bends: SheetBend[];
  studPositions: Point[];
  maskingZones: MaskingZone[];
  countersinks: CountersinkInfo[];
  blindPockets: BlindPocket[];
  helicalHoles: Point[];
  /** Which sheet side was laid out: the drawing is always shown from the inside. */
  walkedSide: "outside" | "inside";
  /** Maps a model point lying on (or just above) a placed flange to flat coordinates, else null. */
  mapToFlat: (p: Vec3) => Point | null;
  /** True when the point lies over a through hole of the flange it maps to. */
  overThroughHole: (p: Vec3) => boolean;
  /** Placed flange area / all planar area of the body. */
  placedShare: number;
};

type Tangent = { edge: Edge3; flange: Flange };

/** DIN 6935 neutral-axis allowance: k = 0.65 + 0.5·log10(r/t), capped at 1 for r/t > 5; BA = angle × (r + k·t/2). */
export function din6935Allowance(angleRad: number, innerRadiusMm: number, thicknessMm: number): number {
  const ratio = innerRadiusMm / thicknessMm;
  const k = ratio > 5 ? 1 : Math.min(1, Math.max(0, 0.65 + 0.5 * Math.log10(Math.max(ratio, 1e-6))));
  return angleRad * (innerRadiusMm + (k * thicknessMm) / 2);
}

export function unfoldBody(body: Body3, options: UnfoldOptions): UnfoldResult | null {
  const chordError = options.chordError ?? DEFAULT_CHORD_ERROR_MM;
  const thicknessMm = options.thicknessMm;
  const groups = bendGroups(body, thicknessMm);
  const flanges = buildFlanges(body, chordError);
  if (flanges.length === 0) return null;
  const planarArea = flanges.reduce((s, f) => s + f.area, 0);

  // Edge id → faces using it (any loop), and → flange of a planar face.
  const facesByEdge = new Map<number, Face3[]>();
  for (const face of body.faces) {
    const loops: Loop3[] = face.outer ? [face.outer, ...face.inner] : face.inner;
    for (const loop of loops) for (const oe of loop.edges) {
      if (oe.edge.id < 0) continue;
      const list = facesByEdge.get(oe.edge.id);
      if (list) {
        if (!list.includes(face)) list.push(face);
      } else facesByEdge.set(oe.edge.id, [face]);
    }
  }
  const flangeOfFace = new Map<Face3, Flange>();
  for (const f of flanges) for (const face of f.faces) flangeOfFace.set(face, f);

  // Each bend shows on each sheet side as the cylinder(s) of one radius;
  // that side's straight edges shared with flanges are its two tangent lines.
  type BendInfo = { group: BendGroup; radius: number; tangents: Tangent[] };
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
          for (const other of (facesByEdge.get(e.id) ?? []).filter((f) => f !== cyl)) {
            const flange = flangeOfFace.get(other);
            if (flange && !tangents.some((t) => t.edge.id === e.id)) tangents.push({ edge: e, flange });
          }
        }
      }
      if (tangents.length !== 2) continue;
      if (Math.abs(dist3(tangents[0].edge.start, tangents[0].edge.end) - dist3(tangents[1].edge.start, tangents[1].edge.end)) > EDGE_LENGTH_TOL_MM) continue;
      bends.push({ group, radius, tangents });
      for (const t of tangents) tangentEdgeIds.add(t.edge.id);
    }
  }
  if (groups.length > 0 && bends.length === 0) return null;

  // Root: the largest flange. Its side is "outside" when its bends attach through the outer radius.
  let root: Flange | null = null;
  for (const f of flanges) if (!root || f.area > root.area) root = f;
  if (!root) return null;
  root.placement = { cos: 1, sin: 0, tx: 0, ty: 0 };
  const rootBends = bends.filter((b) => b.tangents.some((t) => t.flange === root));
  const outerCount = rootBends.filter((b) => Math.abs(b.radius - b.group.outerRadius) < RADIUS_TOL_MM).length;
  const walkedSide: UnfoldResult["walkedSide"] = rootBends.length === 0 ? "outside" : outerCount * 2 >= rootBends.length ? "outside" : "inside";

  const out: Flattening = { entities: [], splinesFlattened: 0, ellipsesFlattened: 0 };
  const allPoints: Point[][] = [];
  const sheetBends: SheetBend[] = [];
  const placedFlat = (f: Flange, q: Vec3): Point => applyRigid(f.placement as Rigid, flangeTo2(f, q));

  // Breadth-first over bends from placed flanges; one walk per bend group.
  const queue: Flange[] = [root];
  const usedGroups = new Set<BendGroup>();
  const flangeVia = new Map<Flange, { bendIndex: number; direction: { nx: number; ny: number }; tangent: { t1: Point; t2: Point } }>();
  const bendFrom: Flange[] = [];
  const bendTo: Flange[] = [];
  const flangeIndex = new Map<Flange, number>();
  flanges.forEach((f, i) => flangeIndex.set(f, i));
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
      const A = [mine.edge.start, mine.edge.end];
      const B = [theirs.edge.start, theirs.edge.end];
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
      const lengthMm = dist3(mine.edge.start, mine.edge.end);
      const { allowanceMm, source } = options.allowance(angle, bend.group.innerRadius, lengthMm);
      const t1 = { x: a1.x + allowanceMm * nx, y: a1.y + allowanceMm * ny };
      const t2 = { x: a2.x + allowanceMm * nx, y: a2.y + allowanceMm * ny };

      let placement = rigidFromPairs(flangeTo2(to, B[0]), flangeTo2(to, B[1]), t1, t2);
      let cTo = applyRigid(placement, to.centroid);
      if ((cTo.x - t1.x) * nx + (cTo.y - t1.y) * ny < 0) {
        placement = rigidFromPairs(flangeTo2(to, B[1]), flangeTo2(to, B[0]), t1, t2);
        cTo = applyRigid(placement, to.centroid);
        if ((cTo.x - t1.x) * nx + (cTo.y - t1.y) * ny < 0) return null;
      }
      to.placement = placement;
      queue.push(to);

      out.entities.push({ originalType: "LINE", layer: "0", segments: [makeLine(a1, t1)], closed: false });
      out.entities.push({ originalType: "LINE", layer: "0", segments: [makeLine(a2, t2)], closed: false });
      const mid3 = scale3(add3(theirs.edge.start, theirs.edge.end), 0.5);
      const alongNormal = dot3(sub3(centroid3(to), mid3), from.normal) > 0;
      // Viewed from the inside: a flange folding towards the inside is BEND_UP.
      const up = alongNormal === (walkedSide === "inside");
      const c1 = { x: a1.x + (allowanceMm / 2) * nx, y: a1.y + (allowanceMm / 2) * ny };
      const c2 = { x: a2.x + (allowanceMm / 2) * nx, y: a2.y + (allowanceMm / 2) * ny };
      out.entities.push({ originalType: "LINE", layer: up ? "BEND_UP" : "BEND_DOWN", segments: [makeLine(c1, c2)], closed: false });
      allPoints.push([a1, a2, t1, t2]);
      const index = sheetBends.length;
      sheetBends.push({
        id: `sb${index + 1}`,
        start: c1,
        end: c2,
        lengthMm,
        angleDeg: (angle * 180) / Math.PI,
        innerRadiusMm: bend.group.innerRadius,
        allowanceMm,
        allowanceSource: source,
        direction: up ? "up" : "down",
        strip: { a1, a2, t1, t2 },
        flangeOutsideMm: null,
        baseFlangeOutsideMm: null,
        fromFlange: flangeIndex.get(from) ?? -1,
        toFlange: flangeIndex.get(to) ?? -1,
      });
      flangeVia.set(to, { bendIndex: index, direction: { nx, ny }, tangent: { t1, t2 } });
      bendFrom.push(from);
      bendTo.push(to);
    }
  }

  // Outlines, through holes and the features of the placed flanges.
  const studPositions: Point[] = [];
  const maskingZones: MaskingZone[] = [];
  const countersinks: CountersinkInfo[] = [];
  const blindPockets: BlindPocket[] = [];
  const helicalHoles: Point[] = [];
  const throughLoopsByFlange = new Map<Flange, Point[][]>();
  const placedOutline = new Map<Flange, Point[]>();
  let placedArea = 0;
  let placed = 0;
  const placedFlanges = flanges.filter((f) => f.placement);
  for (const f of placedFlanges) {
    placed++;
    placedArea += f.area;
    const map: FlatMap = { toFlat: (q) => placedFlat(f, q), normal: f.normal };
    const skip = new Set<number>([...tangentEdgeIds, ...f.internalEdgeIds]);
    const through: Point[][] = [];
    const outlinePts: Point[] = [];
    for (const face of f.faces) {
      if (!face.outer) continue;
      loopToEntities(face.outer, map, skip, chordError, out);
      for (const q of loopPolyline(face.outer, chordError)) outlinePts.push(placedFlat(f, q));
      for (const hole of face.inner) {
        const feature = classifyLoop(hole, face, f.normal, thicknessMm, facesByEdge, chordError);
        recordFeature(feature, map, f.normal, chordError, out, through, { studPositions, maskingZones, countersinks, blindPockets, helicalHoles }, "outside", true);
      }
    }
    for (const member of f.splitMembers) {
      if (!member.outer) continue;
      const polygon = loopPolyline(member.outer, chordError).map((q) => placedFlat(f, q));
      maskingZones.push({ kind: "split_face", polygon, areaMm2: polygonArea(polygon), confirmed: false });
    }
    throughLoopsByFlange.set(f, through);
    placedOutline.set(f, outlinePts);
    allPoints.push(outlinePts);
  }
  if (placedArea < planarArea * MIN_PLACED_SHARE) return null;

  // Features on the other side of each placed flange (faces parallel at thickness distance, overlapping).
  for (const f of placedFlanges) {
    const outline = placedOutline.get(f) ?? [];
    if (outline.length < 3) continue;
    const map: FlatMap = { toFlat: (q) => placedFlat(f, q), normal: f.normal };
    for (const other of flanges) {
      if (other === f || other.placement) continue;
      if (dot3(other.normal, f.normal) > -PARALLEL) continue;
      const gap = dot3(sub3(other.origin, f.origin), f.normal);
      if (Math.abs(Math.abs(gap) - thicknessMm) > COPLANAR_MM * 5) continue;
      const c = placedFlat(f, centroid3(other));
      if (!pointInPolygon(c, outline)) continue;
      for (const face of other.faces) {
        for (const hole of face.inner) {
          const feature = classifyLoop(hole, face, other.normal, thicknessMm, facesByEdge, chordError);
          recordFeature(feature, map, f.normal, chordError, out, null, { studPositions, maskingZones, countersinks, blindPockets, helicalHoles }, "inside", false);
        }
      }
      for (const member of other.splitMembers) {
        if (!member.outer) continue;
        const polygon = loopPolyline(member.outer, chordError).map((q) => placedFlat(f, q));
        maskingZones.push({ kind: "split_face", polygon, areaMm2: polygonArea(polygon), confirmed: false });
      }
    }
  }

  // Outside dimension of a flange as seen from one of its bends: the flat
  // extent beyond that bend's tangent line, plus r + t for the bend itself,
  // plus r + t again when the far edge is the tangent line of another bend
  // (a web between two flanges measures across both radii).
  const outsideFrom = (flange: Flange, origin: Point, dirX: number, dirY: number, bendIndex: number): number => {
    const outline = placedOutline.get(flange) ?? [];
    let far = 0;
    for (const p of outline) far = Math.max(far, (p.x - origin.x) * dirX + (p.y - origin.y) * dirY);
    const here = sheetBends[bendIndex];
    let total = far + here.innerRadiusMm + thicknessMm;
    for (let j = 0; j < sheetBends.length; j++) {
      if (j === bendIndex) continue;
      if (bendFrom[j] !== flange && bendTo[j] !== flange) continue;
      const other = sheetBends[j];
      const line = bendFrom[j] === flange ? [other.strip.a1, other.strip.a2] : [other.strip.t1, other.strip.t2];
      const d = Math.max(...line.map((p) => (p.x - origin.x) * dirX + (p.y - origin.y) * dirY));
      if (Math.abs(d - far) < 1e-3) total += other.innerRadiusMm + thicknessMm;
    }
    return total;
  };
  for (let i = 0; i < sheetBends.length; i++) {
    const bend = sheetBends[i];
    const nx = bend.strip.t1.x - bend.strip.a1.x;
    const ny = bend.strip.t1.y - bend.strip.a1.y;
    const len = Math.hypot(nx, ny) || 1;
    bend.flangeOutsideMm = outsideFrom(bendTo[i], bend.strip.t1, nx / len, ny / len, i);
    bend.baseFlangeOutsideMm = outsideFrom(bendFrom[i], bend.strip.a1, -nx / len, -ny / len, i);
  }

  // Viewed from the inside: mirror a layout of the outside face.
  const mirror = walkedSide === "outside";
  const mx = (p: Point): Point => (mirror ? { x: -p.x, y: p.y } : p);
  if (mirror) {
    for (const e of out.entities) {
      e.segments = e.segments.map((s) => {
        switch (s.kind) {
          case "line":
            return makeLine(mx(s.start), mx(s.end));
          case "circle":
            return makeCircle(mx(s.center), s.radius);
          case "arc": {
            // Mirroring x reverses the sweep: new start = 180 − old end.
            return makeArc(mx(s.center), s.radius, 180 - s.endAngleDeg, 180 - s.startAngleDeg);
          }
        }
      });
    }
    for (const b of sheetBends) {
      b.start = mx(b.start);
      b.end = mx(b.end);
      b.strip = { a1: mx(b.strip.a1), a2: mx(b.strip.a2), t1: mx(b.strip.t1), t2: mx(b.strip.t2) };
    }
    for (let i = 0; i < studPositions.length; i++) studPositions[i] = mx(studPositions[i]);
    for (const z of maskingZones) z.polygon = z.polygon.map(mx);
    for (const c of countersinks) c.center = mx(c.center);
    for (const p of blindPockets) p.center = mx(p.center);
    for (let i = 0; i < helicalHoles.length; i++) helicalHoles[i] = mx(helicalHoles[i]);
    for (const [f, pts] of placedOutline) placedOutline.set(f, pts.map(mx));
    for (const [f, loops] of throughLoopsByFlange) throughLoopsByFlange.set(f, loops.map((l) => l.map(mx)));
    for (let i = 0; i < allPoints.length; i++) allPoints[i] = allPoints[i].map(mx);
  }

  const extents = extentsOf(allPoints);
  const header: DxfHeaderInfo = {
    version: null,
    units: { insunits: Math.abs(options.unitScale - 25.4) < 1e-6 ? 1 : 4, detected: "mm", scaleApplied: options.unitScale },
    extmin: extents?.min ?? null,
    extmax: extents?.max ?? null,
    layers: ["0", "BEND_UP", "BEND_DOWN"],
  };

  const flangeAt = (p: Vec3): Flange | null => {
    for (const f of placedFlanges) {
      const h = dot3(sub3(p, f.origin), f.normal);
      // On the flange plane (either sheet side) or just above it (a stud base sits on the surface).
      if (h < -thicknessMm - 0.5 || h > 0.5) continue;
      const q = mx(placedFlat(f, p));
      const outline = placedOutline.get(f) ?? [];
      if (outline.length >= 3 && pointInPolygon(q, outline)) return f;
    }
    return null;
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
    bends: sheetBends,
    studPositions,
    maskingZones,
    countersinks,
    blindPockets,
    helicalHoles,
    walkedSide,
    mapToFlat: (p) => {
      const f = flangeAt(p);
      return f ? mx(placedFlat(f, p)) : null;
    },
    overThroughHole: (p) => {
      const f = flangeAt(p);
      if (!f) return false;
      const q = mx(placedFlat(f, p));
      return (throughLoopsByFlange.get(f) ?? []).some((loop) => pointInPolygon(q, loop));
    },
    placedShare: planarArea > 0 ? placedArea / planarArea : 0,
  };
}

type FeatureSinks = { studPositions: Point[]; maskingZones: MaskingZone[]; countersinks: CountersinkInfo[]; blindPockets: BlindPocket[]; helicalHoles: Point[] };

/** Emit a through loop as cut (countersinks as their through circle); record everything else. */
function recordFeature(
  feature: LoopFeature,
  map: FlatMap,
  normal: Vec3,
  chordError: number,
  out: Flattening,
  through: Point[][] | null,
  sinks: FeatureSinks,
  side: "outside" | "inside",
  emit: boolean
): void {
  switch (feature.kind) {
    case "through": {
      if (feature.countersink) {
        const c = loopCircle(feature.loop, normal);
        const center = c ? map.toFlat(c.center) : map.toFlat(loopCenter3(feature.loop, chordError));
        if (emit) out.entities.push({ originalType: "CIRCLE", layer: "0", segments: [makeCircle(center, feature.countersink.throughRadius)], closed: true });
        sinks.countersinks.push({
          center,
          throughDiameterMm: feature.countersink.throughRadius * 2,
          topDiameterMm: feature.countersink.topRadius * 2,
          depthMm: feature.countersink.depthMm,
          side,
          featureCode: null,
        });
        through?.push(loopPolyline(feature.loop, chordError).map(map.toFlat));
        return;
      }
      if (emit) {
        loopToEntities(feature.loop, map, null, chordError, out);
        through?.push(loopPolyline(feature.loop, chordError).map(map.toFlat));
      }
      if (feature.helical) sinks.helicalHoles.push(map.toFlat(loopCenter3(feature.loop, chordError)));
      return;
    }
    case "recess": {
      const polygon = loopPolyline(feature.loop, chordError).map(map.toFlat);
      sinks.maskingZones.push({ kind: "recess", polygon, areaMm2: polygonArea(polygon), confirmed: false });
      return;
    }
    case "seat":
      sinks.studPositions.push(map.toFlat(feature.center));
      return;
    case "pocket":
      sinks.blindPockets.push({ center: map.toFlat(feature.center), maxSideMm: feature.maxSideMm, depthMm: feature.depthMm, circular: feature.circular });
      return;
  }
}
