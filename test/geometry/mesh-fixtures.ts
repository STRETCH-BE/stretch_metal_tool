/**
 * Test helper — tessellated (triangle / quad mesh) sheet parts as STEP
 * FACETED_BREPs, the way IFC exporters and SolidWorks facetation write
 * them: watertight, caps split into simple polygons around the holes,
 * arcs sampled into strips of quads.
 * File path: /test/geometry/mesh-fixtures.ts
 */
import type { Vec3 } from "@/lib/geometry/step/brep";
import { writeFacetedStep } from "@/lib/geometry/step/write-step";

type P = { x: number; y: number };

function ring(center: P, r: number, n: number): P[] {
  const out: P[] = [];
  for (let k = 0; k < n; k++) out.push({ x: center.x + r * Math.cos((2 * Math.PI * k) / n), y: center.y + r * Math.sin((2 * Math.PI * k) / n) });
  return out;
}

const at = (p: P, z: number): Vec3 => ({ x: p.x, y: p.y, z });

/** Side quad of an outline edge a→b (CCW outline seen from +z) between z0 and z1, outward winding. */
function wall(a: P, b: P, z0: number, z1: number): Vec3[] {
  return [at(a, z0), at(b, z0), at(b, z1), at(a, z1)];
}

/** Plate L × W × t with one round hole (n facets) at `hole`; caps as four polygons around the hole. */
export function tessellatedPlate(L = 100, W = 50, t = 5, hole = { x: 30, y: 25, r: 5 }, n = 16): string {
  const q = ring({ x: hole.x, y: hole.y }, hole.r, n);
  const quarter = n / 4;
  const cx = hole.x;
  const cy = hole.y;
  // Counter-clockwise cap polygons (top view), the hole arc walked clockwise.
  const arcBack = (from: number, to: number): P[] => {
    const out: P[] = [];
    for (let k = from - 1; k > to; k--) out.push(q[(k + n) % n]);
    return out;
  };
  const caps: P[][] = [
    [q[0], { x: L, y: cy }, { x: L, y: W }, { x: cx, y: W }, q[quarter], ...arcBack(quarter, 0)],
    [q[quarter], { x: cx, y: W }, { x: 0, y: W }, { x: 0, y: cy }, q[2 * quarter], ...arcBack(2 * quarter, quarter)],
    [q[2 * quarter], { x: 0, y: cy }, { x: 0, y: 0 }, { x: cx, y: 0 }, q[3 * quarter], ...arcBack(3 * quarter, 2 * quarter)],
    [q[3 * quarter], { x: cx, y: 0 }, { x: L, y: 0 }, { x: L, y: cy }, q[0], ...arcBack(n, 3 * quarter)],
  ];
  const polygons: Vec3[][] = [];
  for (const cap of caps) {
    polygons.push(cap.map((p) => at(p, t)));
    polygons.push(cap.map((p) => at(p, 0)).reverse());
  }
  // Outline split where the cap polygons touch it, so the mesh stays watertight.
  const outline: P[] = [
    { x: 0, y: 0 },
    { x: cx, y: 0 },
    { x: L, y: 0 },
    { x: L, y: cy },
    { x: L, y: W },
    { x: cx, y: W },
    { x: 0, y: W },
    { x: 0, y: cy },
  ];
  for (let i = 0; i < outline.length; i++) polygons.push(wall(outline[i], outline[(i + 1) % outline.length], 0, t));
  // Hole wall: ring is CCW in top view, the solid lies outside it.
  for (let k = 0; k < n; k++) polygons.push([at(q[k], 0), at(q[k], t), at(q[(k + 1) % n], t), at(q[(k + 1) % n], 0)]);
  return writeFacetedStep("plate", polygons);
}

/** Analytic volume of the L bracket: two straight legs plus the quarter annulus of the bend. */
export function bracketVolumeMm3(a = 80, b = 60, t = 5, r = 5, width = 40): number {
  return ((a - (r + t)) * t + (b - (r + t)) * t + (Math.PI / 4) * ((r + t) ** 2 - r * r)) * width;
}

/** Analytic volume of the U channel (web w, legs h, both outside; thickness t, inner radius r, length L). */
export function channelVolumeMm3(w: number, h: number, t: number, r: number, L: number): number {
  const R = r + t;
  return ((w - 2 * R) * t + 2 * (h - R) * t + 2 * (Math.PI / 4) * (R * R - r * r)) * L;
}

/** U channel (web w, legs h outside, thickness t, inner radius r, length L along z) with the bend arcs in n facets each. */
export function tessellatedChannel(w = 120, h = 60, t = 3, r = 3, L = 200, n = 6): string {
  const R = r + t;
  const arc = (c: P, radius: number, fromDeg: number, toDeg: number): P[] => {
    const out: P[] = [];
    for (let k = 0; k <= n; k++) {
      const deg = fromDeg + ((toDeg - fromDeg) * k) / n;
      out.push({ x: c.x + radius * Math.cos((deg * Math.PI) / 180), y: c.y + radius * Math.sin((deg * Math.PI) / 180) });
    }
    return out;
  };
  // Counter-clockwise: along the outside of the web, outer arc up the right
  // leg, over its top, down its inside, inner arc, along the inside of the
  // web, inner arc, up the left leg's inside, over, down its outside, outer arc.
  const profile: P[] = [];
  profile.push(...arc({ x: w - R, y: R }, R, 270, 360)); // (w-R, 0) → (w, R)
  profile.push({ x: w, y: h }, { x: w - t, y: h });
  profile.push(...arc({ x: w - R, y: R }, r, 0, -90).slice(0, -1)); // (w-t, R) → (w-R, t) (clockwise)
  profile.push(...arc({ x: R, y: R }, r, 270, 180)); // (R, t) → (t, R) (clockwise)
  profile.push({ x: t, y: h }, { x: 0, y: h });
  profile.push(...arc({ x: R, y: R }, R, 180, 270).slice(0, -1)); // (0, R) → (R, 0)
  const polygons: Vec3[][] = [];
  polygons.push(profile.map((p) => at(p, L)));
  polygons.push(profile.map((p) => at(p, 0)).reverse());
  for (let i = 0; i < profile.length; i++) polygons.push(wall(profile[i], profile[(i + 1) % profile.length], 0, L));
  return writeFacetedStep("channel", polygons);
}

/** L bracket (legs a, b, thickness t, inner radius r, width along z) with the bend arcs in n facets. */
export function tessellatedBracket(a = 80, b = 60, t = 5, r = 5, width = 40, n = 6): string {
  const c = { x: r + t, y: r + t };
  const arc = (radius: number, fromDeg: number, toDeg: number): P[] => {
    const out: P[] = [];
    for (let k = 0; k <= n; k++) {
      const deg = fromDeg + ((toDeg - fromDeg) * k) / n;
      out.push({ x: c.x + radius * Math.cos((deg * Math.PI) / 180), y: c.y + radius * Math.sin((deg * Math.PI) / 180) });
    }
    return out;
  };
  // Counter-clockwise profile: along the outside of leg a, up, back along the
  // top of leg a, inner arc (clockwise), up leg b's inside, over, down the
  // outside of leg b, outer arc (counter-clockwise) back to the start.
  const profile: P[] = [
    ...arc(r + t, 180, 270).slice(0, -1).reverse().reverse(), // placeholder, replaced below
  ];
  profile.length = 0;
  profile.push({ x: r + t, y: 0 }, { x: a, y: 0 }, { x: a, y: t }, { x: t + r, y: t });
  profile.push(...arc(r, 270, 180).slice(1)); // inner arc from (t+r, t) to (t, t+r), clockwise
  profile.push({ x: t, y: b }, { x: 0, y: b }, { x: 0, y: r + t });
  profile.push(...arc(r + t, 180, 270).slice(1, -1)); // outer arc from (0, r+t) towards (r+t, 0)
  const polygons: Vec3[][] = [];
  polygons.push(profile.map((p) => at(p, width)));
  polygons.push(profile.map((p) => at(p, 0)).reverse());
  for (let i = 0; i < profile.length; i++) polygons.push(wall(profile[i], profile[(i + 1) % profile.length], 0, width));
  return writeFacetedStep("bracket", polygons);
}
