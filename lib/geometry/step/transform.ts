/**
 * Geometry engine — rigid 3D transforms for STEP bodies (assembly
 * placements): a rotation given by three orthonormal column vectors plus
 * a translation, applied to points, directions, placements, curves and
 * surfaces of an evaluated body.
 * File path: /lib/geometry/step/transform.ts
 *
 * Bodies are evaluated in their own product frame (brep.ts). To relate
 * hardware bodies to the sheet they sit on, each occurrence is moved into
 * the assembly frame with the transform composed from the
 * ITEM_DEFINED_TRANSFORMATIONs along its NEXT_ASSEMBLY_USAGE_OCCURRENCE
 * chain (assembly.ts bodyPlacements). Rotations only, never scaling: a
 * placement is orthonormal by construction, so the inverse is the
 * transpose.
 */

import type { Body3, Curve3, Edge3, Face3, Loop3, Placement, Surface3, Vec3 } from "./brep";
import { add3, cross3, dot3, norm3, scale3, sub3 } from "./brep";

/** x' = R·x + t, with R given by the images of the unit axes (columns). */
export type Rigid3 = { cx: Vec3; cy: Vec3; cz: Vec3; t: Vec3 };

export const RIGID_IDENTITY: Rigid3 = { cx: { x: 1, y: 0, z: 0 }, cy: { x: 0, y: 1, z: 0 }, cz: { x: 0, y: 0, z: 1 }, t: { x: 0, y: 0, z: 0 } };

export function applyRigidDir(m: Rigid3, d: Vec3): Vec3 {
  return add3(add3(scale3(m.cx, d.x), scale3(m.cy, d.y)), scale3(m.cz, d.z));
}

export function applyRigidPoint(m: Rigid3, p: Vec3): Vec3 {
  return add3(applyRigidDir(m, p), m.t);
}

/** a ∘ b: apply b first, then a. */
export function composeRigid(a: Rigid3, b: Rigid3): Rigid3 {
  return { cx: applyRigidDir(a, b.cx), cy: applyRigidDir(a, b.cy), cz: applyRigidDir(a, b.cz), t: applyRigidPoint(a, b.t) };
}

export function invertRigid(m: Rigid3): Rigid3 {
  // Transpose of an orthonormal matrix: rows become columns.
  const cx = { x: m.cx.x, y: m.cy.x, z: m.cz.x };
  const cy = { x: m.cx.y, y: m.cy.y, z: m.cz.y };
  const cz = { x: m.cx.z, y: m.cy.z, z: m.cz.z };
  const inv: Rigid3 = { cx, cy, cz, t: { x: 0, y: 0, z: 0 } };
  return { ...inv, t: scale3(applyRigidDir(inv, m.t), -1) };
}

/** The frame of an AXIS2_PLACEMENT_3D as a transform from local (ref, y, axis) coordinates to the model. */
export function rigidFromPlacement(p: Placement): Rigid3 {
  return { cx: p.ref, cy: p.y, cz: p.axis, t: p.origin };
}

export function isRigidIdentity(m: Rigid3, tol = 1e-9): boolean {
  const near = (a: Vec3, b: Vec3) => Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.z - b.z) < tol;
  return near(m.cx, RIGID_IDENTITY.cx) && near(m.cy, RIGID_IDENTITY.cy) && near(m.cz, RIGID_IDENTITY.cz) && near(m.t, RIGID_IDENTITY.t);
}

function transformPlacement(m: Rigid3, p: Placement): Placement {
  const axis = norm3(applyRigidDir(m, p.axis));
  const ref = norm3(applyRigidDir(m, p.ref));
  return { origin: applyRigidPoint(m, p.origin), axis, ref, y: cross3(axis, ref) };
}

function transformCurve(m: Rigid3, c: Curve3): Curve3 {
  switch (c.kind) {
    case "line":
      return { kind: "line", point: applyRigidPoint(m, c.point), dir: norm3(applyRigidDir(m, c.dir)) };
    case "circle":
      return { kind: "circle", placement: transformPlacement(m, c.placement), radius: c.radius };
    case "ellipse":
      return { kind: "ellipse", placement: transformPlacement(m, c.placement), semi1: c.semi1, semi2: c.semi2 };
    case "bspline":
      return { ...c, controlPoints: c.controlPoints.map((p) => applyRigidPoint(m, p)) };
    case "polyline":
      return { kind: "polyline", points: c.points.map((p) => applyRigidPoint(m, p)) };
    case "other":
      return c;
  }
}

function transformSurface(m: Rigid3, s: Surface3): Surface3 {
  switch (s.kind) {
    case "plane":
      return { kind: "plane", placement: transformPlacement(m, s.placement) };
    case "cylinder":
      return { kind: "cylinder", placement: transformPlacement(m, s.placement), radius: s.radius };
    case "cone":
      return { kind: "cone", placement: transformPlacement(m, s.placement), radius: s.radius, semiAngleDeg: s.semiAngleDeg };
    case "torus":
      return { kind: "torus", placement: transformPlacement(m, s.placement), majorRadius: s.majorRadius, minorRadius: s.minorRadius };
    case "sphere":
      return { kind: "sphere", placement: transformPlacement(m, s.placement), radius: s.radius };
    case "other":
      return s;
  }
}

/** Moves a body into another frame. Shared edges stay shared (one transformed copy per edge id). */
export function transformBody(body: Body3, m: Rigid3): Body3 {
  if (isRigidIdentity(m)) return body;
  const edges = new Map<Edge3, Edge3>();
  const edge = (e: Edge3): Edge3 => {
    const cached = edges.get(e);
    if (cached) return cached;
    const moved: Edge3 = { id: e.id, start: applyRigidPoint(m, e.start), end: applyRigidPoint(m, e.end), curve: transformCurve(m, e.curve), sameSense: e.sameSense };
    edges.set(e, moved);
    return moved;
  };
  const loop = (l: Loop3): Loop3 => ({ id: l.id, edges: l.edges.map((oe) => ({ edge: edge(oe.edge), orientation: oe.orientation })) });
  const faces: Face3[] = body.faces.map((f) => ({
    id: f.id,
    surface: transformSurface(m, f.surface),
    sameSense: f.sameSense,
    outer: f.outer ? loop(f.outer) : null,
    inner: f.inner.map(loop),
  }));
  return body.meshVolumeMm3 === undefined ? { id: body.id, kind: body.kind, faces } : { id: body.id, kind: body.kind, faces, meshVolumeMm3: body.meshVolumeMm3 };
}

/** Sanity check on a placement-derived transform: columns orthonormal. */
export function rigidIsOrthonormal(m: Rigid3, tol = 1e-6): boolean {
  const unit = (v: Vec3) => Math.abs(dot3(v, v) - 1) < tol;
  return unit(m.cx) && unit(m.cy) && unit(m.cz) && Math.abs(dot3(m.cx, m.cy)) < tol && Math.abs(dot3(m.cy, m.cz)) < tol && Math.abs(dot3(m.cx, m.cz)) < tol;
}

export { sub3 as rigidSub3 };
