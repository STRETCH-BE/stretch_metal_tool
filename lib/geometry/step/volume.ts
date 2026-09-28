/**
 * Geometry engine — volume of an evaluated STEP body (divergence theorem).
 * File path: /lib/geometry/step/volume.ts
 *
 * V = ⅓ ∮ (p · n) dA over the closed shell, face by face:
 *   - planar faces exactly: the polygon (outer loop minus holes) with the
 *     face's outward normal;
 *   - cylinders, cones and tori by strips in their own parameter space:
 *     the face's loops are mapped to (angle, axial) coordinates, a
 *     scan-line over the angle finds the covered axial intervals (even /
 *     odd, so holes through a bend are subtracted), and every strip
 *     contributes (p · n) at its centre times its area. Fine enough
 *     (1 000 strips per turn) that a 2 mm bend of radius 1 mm integrates
 *     to 0.01 %;
 *   - a sphere or an unknown surface makes the volume null — the caller
 *     skips the mass cross-check rather than trusting a guess.
 * Outward normal = surface normal × ADVANCED_FACE same_sense; loop
 * orientation is not needed because the strips are unsigned areas.
 * Used by sheet.ts for FLAT_MASS_MISMATCH (flat volume vs model volume).
 */

import { add3, cross3, dot3, loopPolyline, norm3, sampleEdge, scale3, sub3, type Body3, type Face3, type Loop3, type Placement, type Vec3 } from "./brep";

const CHORD_MM = 0.02;
const STRIPS_PER_TURN = 1000;
const TWO_PI = 2 * Math.PI;

function polygonArea3(pts: Vec3[], normal: Vec3): number {
  // Projected area: ½ |Σ p_i × p_{i+1}| · n.
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = cross3(a, b);
    sx += c.x;
    sy += c.y;
    sz += c.z;
  }
  return Math.abs(dot3({ x: sx, y: sy, z: sz }, normal)) / 2;
}

function faceNormalSign(face: Face3): number {
  return face.sameSense ? 1 : -1;
}

function planarContribution(face: Face3, placement: Placement): number {
  const n = scale3(placement.axis, faceNormalSign(face));
  const loops: Loop3[] = face.outer ? [face.outer, ...face.inner] : face.inner;
  let area = 0;
  for (let i = 0; i < loops.length; i++) {
    const pts = loopPolyline(loops[i], CHORD_MM);
    if (pts.length < 3) continue;
    area += (i === 0 && face.outer ? 1 : -1) * polygonArea3(pts, n);
  }
  // p · n is constant on the plane (the plane offset).
  return (dot3(placement.origin, n) * area) / 3;
}

type ParamPoint = { u: number; v: number };

/** Angle of a point about the placement axis, continuous along a polyline (unwrapped). */
function unwrap(angles: number[]): number[] {
  const out = [angles[0]];
  for (let i = 1; i < angles.length; i++) {
    let a = angles[i];
    const prev = out[i - 1];
    while (a - prev > Math.PI) a -= TWO_PI;
    while (a - prev < -Math.PI) a += TWO_PI;
    out.push(a);
  }
  return out;
}

/** (angle, axial) polygon of a loop on a surface of revolution about `placement`. */
function paramLoop(loop: Loop3, placement: Placement, axial: (p: Vec3) => number): ParamPoint[] {
  const pts: Vec3[] = [];
  for (const oe of loop.edges) {
    let s = sampleEdge(oe.edge, CHORD_MM);
    if (!oe.orientation) s = [...s].reverse();
    for (let i = 0; i < s.length - 1; i++) pts.push(s[i]);
  }
  if (pts.length < 3) return [];
  const angles = unwrap(
    pts.map((p) => {
      const d = sub3(p, placement.origin);
      return Math.atan2(dot3(d, placement.y), dot3(d, placement.ref));
    })
  );
  return pts.map((p, i) => ({ u: angles[i], v: axial(p) }));
}

/** Covered axial intervals at angle u by even/odd crossing of all loops. */
function coveredIntervals(loops: ParamPoint[][], u: number): [number, number][] {
  const crossings: number[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      // Edges may wrap: try the polygon and its ±2π copies.
      for (const shift of [-TWO_PI, 0, TWO_PI]) {
        const au = a.u + shift;
        const bu = b.u + shift;
        if ((au <= u && bu > u) || (bu <= u && au > u)) {
          const t = (u - au) / (bu - au);
          crossings.push(a.v + t * (b.v - a.v));
        }
      }
    }
  }
  crossings.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) out.push([crossings[i], crossings[i + 1]]);
  return out;
}

function angleRange(loops: ParamPoint[][]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const loop of loops) for (const p of loop) {
    if (p.u < min) min = p.u;
    if (p.u > max) max = p.u;
  }
  return { min, max };
}

function revolutionContribution(
  face: Face3,
  placement: Placement,
  axial: (p: Vec3) => number,
  /** Point on the surface at (angle, axial) and the outward surface normal there (before same_sense). */
  at: (u: number, v: number) => { p: Vec3; n: Vec3; dA: number }
): number | null {
  const loops: Loop3[] = face.outer ? [face.outer, ...face.inner] : face.inner;
  const params = loops.map((l) => paramLoop(l, placement, axial)).filter((l) => l.length >= 3);
  if (params.length === 0) return null;
  // Normalise every loop into the same 2π window as the outer loop's mean.
  const base = params[0].reduce((s, p) => s + p.u, 0) / params[0].length;
  for (let i = 1; i < params.length; i++) {
    const mean = params[i].reduce((s, p) => s + p.u, 0) / params[i].length;
    const shift = Math.round((base - mean) / TWO_PI) * TWO_PI;
    if (shift !== 0) params[i] = params[i].map((p) => ({ u: p.u + shift, v: p.v }));
  }
  const { min, max } = angleRange(params);
  if (!(max > min)) return 0;
  const span = Math.min(max - min, TWO_PI);
  const strips = Math.max(8, Math.ceil((span / TWO_PI) * STRIPS_PER_TURN));
  const du = (max - min) / strips;
  const sign = faceNormalSign(face);
  let total = 0;
  for (let i = 0; i < strips; i++) {
    const u = min + (i + 0.5) * du;
    for (const [v0, v1] of coveredIntervals(params, u)) {
      if (v1 - v0 < 1e-9) continue;
      const { p, n, dA } = at(u, (v0 + v1) / 2);
      total += dot3(p, scale3(n, sign)) * dA * du * (v1 - v0);
    }
  }
  return total / 3;
}

function faceContribution(face: Face3): number | null {
  const s = face.surface;
  switch (s.kind) {
    case "plane":
      return planarContribution(face, s.placement);
    case "cylinder": {
      const P = s.placement;
      const r = s.radius;
      return revolutionContribution(
        face,
        P,
        (p) => dot3(sub3(p, P.origin), P.axis),
        (u, v) => {
          const radial = add3(scale3(P.ref, Math.cos(u)), scale3(P.y, Math.sin(u)));
          return { p: add3(add3(P.origin, scale3(radial, r)), scale3(P.axis, v)), n: radial, dA: r };
        }
      );
    }
    case "cone": {
      const P = s.placement;
      const tan = Math.tan((s.semiAngleDeg * Math.PI) / 180);
      const cos = Math.cos((s.semiAngleDeg * Math.PI) / 180);
      const sin = Math.sin((s.semiAngleDeg * Math.PI) / 180);
      return revolutionContribution(
        face,
        P,
        (p) => dot3(sub3(p, P.origin), P.axis),
        (u, v) => {
          const radial = add3(scale3(P.ref, Math.cos(u)), scale3(P.y, Math.sin(u)));
          const rv = s.radius + v * tan;
          const n = norm3(sub3(scale3(radial, cos), scale3(P.axis, sin)));
          // dA = r(v) · du · dv / cos(semi-angle) (slant length per axial unit).
          return { p: add3(add3(P.origin, scale3(radial, rv)), scale3(P.axis, v)), n, dA: Math.abs(rv) / Math.max(cos, 1e-9) };
        }
      );
    }
    case "torus": {
      const P = s.placement;
      const R = s.majorRadius;
      const rr = s.minorRadius;
      // Second parameter: the angle around the tube, from the point's position.
      const tube = (p: Vec3): number => {
        const d = sub3(p, P.origin);
        const h = dot3(d, P.axis);
        const radialLen = Math.hypot(dot3(d, P.ref), dot3(d, P.y));
        return Math.atan2(h, radialLen - R);
      };
      return revolutionContribution(
        face,
        P,
        tube,
        (u, v) => {
          const radial = add3(scale3(P.ref, Math.cos(u)), scale3(P.y, Math.sin(u)));
          const n = norm3(add3(scale3(radial, Math.cos(v)), scale3(P.axis, Math.sin(v))));
          const p = add3(P.origin, add3(scale3(radial, R + rr * Math.cos(v)), scale3(P.axis, rr * Math.sin(v))));
          return { p, n, dA: rr * (R + rr * Math.cos(v)) };
        }
      );
    }
    case "sphere":
    case "other":
      return null;
  }
}

/** Volume of a closed body in mm³, or null when a face has a surface the integrator does not cover. */
export function bodyVolumeMm3(body: Body3): number | null {
  let total = 0;
  for (const face of body.faces) {
    const c = faceContribution(face);
    if (c === null) return null;
    total += c;
  }
  return Math.abs(total);
}
