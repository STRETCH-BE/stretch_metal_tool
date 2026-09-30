/**
 * Test helper — folded sheet parts as watertight tessellated solids, built
 * from a MID-SURFACE: flanges as polygons, bends as strips of quads on an
 * arc, every vertex with its sheet normal. The solid is the mid-surface
 * offset by ± t/2 along those normals plus a wall quad on every boundary
 * edge, so shared vertices (flange ↔ bend tangent lines) stay shared and
 * the mesh is closed. Writes a FACETED_BREP through write-step.ts.
 * File path: /test/geometry/folded-fixtures.ts
 *
 * cornerPart(): a top plate with bends on two ADJACENT edges (a side wall
 * hanging down from the far edge, an end face from the right edge, the
 * corner notched so the bends never meet — the relief), optionally with
 * a base flange bent outward from the wall's bottom (Stützenfuß Pos 2
 * shape) and with round holes as polygons in the plate. The end face can
 * fold up instead of down so the two bends run in opposite directions
 * (Pos 1 shape).
 */
import type { Vec3 } from "@/lib/geometry/step/brep";
import type { MeshPolygon } from "@/lib/geometry/step/mesh";
import { writeFacetedStep } from "@/lib/geometry/step/write-step";

type MidVertex = { p: Vec3; n: Vec3 };
type MidPolygon = { outer: MidVertex[]; holes: MidVertex[][] };

const key = (p: Vec3) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;

function offset(v: MidVertex, d: number): Vec3 {
  return { x: v.p.x + v.n.x * d, y: v.p.y + v.n.y * d, z: v.p.z + v.n.z * d };
}

/** The closed solid of thickness t around a mid-surface: top and bottom copies of every polygon, walls on the boundary edges. */
export function solidFromMidSurface(polys: MidPolygon[], t: number): MeshPolygon[] {
  const h = t / 2;
  const out: MeshPolygon[] = [];
  const edgeUse = new Map<string, number>();
  const directed: { a: MidVertex; b: MidVertex }[] = [];
  for (const poly of polys) {
    const top = poly.outer.map((v) => offset(v, h));
    const bottom = poly.outer.map((v) => offset(v, -h)).reverse();
    const topHoles = poly.holes.map((ring) => ring.map((v) => offset(v, h)));
    const bottomHoles = poly.holes.map((ring) => ring.map((v) => offset(v, -h)).reverse());
    out.push(topHoles.length ? { outer: top, holes: topHoles } : top);
    out.push(bottomHoles.length ? { outer: bottom, holes: bottomHoles } : bottom);
    for (const ring of [poly.outer, ...poly.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const k = [key(a.p), key(b.p)].sort().join("|");
        edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
        directed.push({ a, b });
      }
    }
  }
  for (const { a, b } of directed) {
    const k = [key(a.p), key(b.p)].sort().join("|");
    if ((edgeUse.get(k) ?? 0) !== 1) continue;
    // Boundary edge a→b with the sheet interior on its left (seen from +n): the wall faces right, outward.
    out.push([offset(a, -h), offset(b, -h), offset(b, h), offset(a, h)]);
  }
  return out;
}

export type CornerPartSpec = {
  /** Top plate size along x and y (mid-surface). */
  A: number;
  B: number;
  /** Wall (from the far edge y = B) and end face (from the right edge x = A) heights, flat parts only. */
  wall: number;
  end: number;
  /** Base flange bent outward from the wall's bottom, flat length; null for none. */
  flange: number | null;
  /** Corner notch size (from the corner along both edges): keeps the two bends apart — the relief. */
  notch: number;
  /** End face folds down like the wall, or up (opposite bend direction). */
  endDir: "down" | "up";
  t: number;
  /** Inner bend radius. */
  r: number;
  /** Facets per 90° bend. */
  facets: number;
  /** Round holes in the top plate: centre and diameter, as regular polygons with `holeFacets` sides. */
  holes: { x: number; y: number; d: number }[];
  holeFacets: number;
};

export const CORNER_DEFAULTS: CornerPartSpec = { A: 240, B: 180, wall: 100, end: 80, flange: 60, notch: 12, endDir: "down", t: 4, r: 4, facets: 6, holes: [{ x: 60, y: 60, d: 13 }, { x: 160, y: 60, d: 13 }], holeFacets: 16 };

/** Mid-surface polygons of the corner part. */
export function cornerPartMidSurface(spec: Partial<CornerPartSpec> = {}): MidPolygon[] {
  const s = { ...CORNER_DEFAULTS, ...spec };
  const Rm = s.r + s.t / 2;
  const c = s.notch;
  const polys: MidPolygon[] = [];
  const up: Vec3 = { x: 0, y: 0, z: 1 };
  const at = (x: number, y: number, z: number, n: Vec3): MidVertex => ({ p: { x, y, z }, n });

  // Top plate, counter-clockwise seen from +z, the corner (A, B) notched.
  const outer = [at(0, 0, 0, up), at(s.A, 0, 0, up), at(s.A, s.B - c, 0, up), at(s.A - c, s.B - c, 0, up), at(s.A - c, s.B, 0, up), at(0, s.B, 0, up)];
  const holes = s.holes.map((hole) =>
    Array.from({ length: s.holeFacets }, (_, k) => {
      // Clockwise seen from +z (against the outer ring).
      const a = (-2 * Math.PI * k) / s.holeFacets;
      return at(hole.x + (hole.d / 2) * Math.cos(a), hole.y + (hole.d / 2) * Math.sin(a), 0, up);
    })
  );
  polys.push({ outer, holes });

  // Bend 1 (about x, along the far edge y = B) folding down: angle θ from 90° to 0°, centre (y = B, z = −Rm).
  const bend1 = (theta: number, x: number): MidVertex => at(x, s.B + Rm * Math.cos(theta), -Rm + Rm * Math.sin(theta), { x: 0, y: Math.cos(theta), z: Math.sin(theta) });
  for (let k = 0; k < s.facets; k++) {
    const t0 = (Math.PI / 2) * (1 - k / s.facets);
    const t1 = (Math.PI / 2) * (1 - (k + 1) / s.facets);
    polys.push({ outer: [bend1(t0, 0), bend1(t0, s.A - c), bend1(t1, s.A - c), bend1(t1, 0)], holes: [] });
  }
  // Wall, normal +y, from z = −Rm down.
  const ny: Vec3 = { x: 0, y: 1, z: 0 };
  const zw = -Rm - s.wall;
  polys.push({ outer: [at(0, s.B + Rm, -Rm, ny), at(s.A - c, s.B + Rm, -Rm, ny), at(s.A - c, s.B + Rm, zw, ny), at(0, s.B + Rm, zw, ny)], holes: [] });

  if (s.flange !== null) {
    // Bend 3 at the wall's bottom, outward (+y): φ from 0 to 90°, centre (y = B + 2Rm, z = zw), normal towards the centre.
    const bend3 = (phi: number, x: number): MidVertex => at(x, s.B + 2 * Rm - Rm * Math.cos(phi), zw - Rm * Math.sin(phi), { x: 0, y: Math.cos(phi), z: Math.sin(phi) });
    for (let k = 0; k < s.facets; k++) {
      const p0 = (Math.PI / 2) * (k / s.facets);
      const p1 = (Math.PI / 2) * ((k + 1) / s.facets);
      polys.push({ outer: [bend3(p0, 0), bend3(p0, s.A - c), bend3(p1, s.A - c), bend3(p1, 0)], holes: [] });
    }
    const zf = zw - Rm;
    const yf = s.B + 2 * Rm;
    polys.push({ outer: [at(0, yf, zf, up), at(s.A - c, yf, zf, up), at(s.A - c, yf + s.flange, zf, up), at(0, yf + s.flange, zf, up)], holes: [] });
  }

  // Bend 2 (about y, along the right edge x = A): down like bend 1, or up.
  if (s.endDir === "down") {
    const bend2 = (theta: number, y: number): MidVertex => at(s.A + Rm * Math.cos(theta), y, -Rm + Rm * Math.sin(theta), { x: Math.cos(theta), y: 0, z: Math.sin(theta) });
    for (let k = 0; k < s.facets; k++) {
      const t0 = (Math.PI / 2) * (1 - k / s.facets);
      const t1 = (Math.PI / 2) * (1 - (k + 1) / s.facets);
      polys.push({ outer: [bend2(t0, s.B - c), bend2(t0, 0), bend2(t1, 0), bend2(t1, s.B - c)], holes: [] });
    }
    const nx: Vec3 = { x: 1, y: 0, z: 0 };
    const ze = -Rm - s.end;
    polys.push({ outer: [at(s.A + Rm, s.B - c, -Rm, nx), at(s.A + Rm, 0, -Rm, nx), at(s.A + Rm, 0, ze, nx), at(s.A + Rm, s.B - c, ze, nx)], holes: [] });
  } else {
    // Folding up: the sheet normal (+z on the plate) turns towards −x; centre (x = A, z = +Rm).
    const bend2 = (theta: number, y: number): MidVertex => at(s.A + Rm * Math.cos(theta), y, Rm - Rm * Math.sin(theta), { x: -Math.cos(theta), y: 0, z: Math.sin(theta) });
    for (let k = 0; k < s.facets; k++) {
      const t0 = (Math.PI / 2) * (1 - k / s.facets);
      const t1 = (Math.PI / 2) * (1 - (k + 1) / s.facets);
      polys.push({ outer: [bend2(t0, s.B - c), bend2(t0, 0), bend2(t1, 0), bend2(t1, s.B - c)], holes: [] });
    }
    const nx: Vec3 = { x: -1, y: 0, z: 0 };
    const ze = Rm + s.end;
    polys.push({ outer: [at(s.A + Rm, s.B - c, Rm, nx), at(s.A + Rm, 0, Rm, nx), at(s.A + Rm, 0, ze, nx), at(s.A + Rm, s.B - c, ze, nx)], holes: [] });
  }
  return polys;
}

/** The corner part as a FACETED_BREP STEP text. */
export function cornerPartStep(spec: Partial<CornerPartSpec> = {}, name = "corner"): string {
  const s = { ...CORNER_DEFAULTS, ...spec };
  return writeFacetedStep(name, solidFromMidSurface(cornerPartMidSurface(s), s.t));
}

/** Analytic volume of the corner part (mid-surface area × t is exact for offset surfaces of a developable sheet up to the bend correction, so integrate exactly). */
export function cornerPartVolumeMm3(spec: Partial<CornerPartSpec> = {}): number {
  const s = { ...CORNER_DEFAULTS, ...spec };
  const c = s.notch;
  const R = s.r + s.t;
  const bendArea = (length: number) => (Math.PI / 4) * (R * R - s.r * s.r) * length;
  let volume = (s.A * s.B - c * c) * s.t;
  for (const h of s.holes) volume -= s.holeFacets * 0.5 * (h.d / 2) ** 2 * Math.sin((2 * Math.PI) / s.holeFacets) * s.t;
  volume += bendArea(s.A - c) + s.wall * s.t * (s.A - c);
  volume += bendArea(s.B - c) + s.end * s.t * (s.B - c);
  if (s.flange !== null) volume += bendArea(s.A - c) + s.flange * s.t * (s.A - c);
  return volume;
}
