/**
 * Geometry engine — faces from a triangle / polygon mesh (tessellated solids).
 * File path: /lib/geometry/step/mesh.ts
 *
 * IFC exports (and STEP FACETED_BREPs) carry no surfaces, only planar
 * facets: a plate's top is dozens of triangles, a bend is a strip of
 * narrow quads, a hole wall a ring of quads. Mesh-to-STEP converters
 * (OpenCASCADE, Revit, SketchUp) write the same thing as an ADVANCED_BREP
 * whose faces are all planar with straight edges: merged flange faces
 * with holes as inner bounds and bends as runs of narrow planar strips.
 * This module rebuilds what the sheet analysis and the unfolder need from
 * either form:
 *   1. vertices are merged by position and facets welded into a closed
 *      mesh (edge → the two facets using it); a facet may carry inner
 *      rings (holes), wound against its outer ring; winding is made
 *      outward by the sign of the enclosed volume, which is also the
 *      exact volume of the mesh (`Body3.meshVolumeMm3`);
 *   2. coplanar facets that share an edge are merged into planar REGIONS
 *      (flange tops and bottoms, edge walls); a region's boundary is the
 *      set of its directed edges whose twin lies outside it, chained into
 *      loops (outer + holes) and simplified by dropping collinear vertices;
 *   3. quad regions whose neighbours across a pair of parallel edges are
 *      quads with a normal rotated about that edge direction form STRIPS:
 *      a circle fitted through the strip vertices in the plane across its
 *      axis gives a cylinder (bend inner / outer surface, hole wall, corner
 *      round); a strip that closes on itself is a full cylinder;
 *   4. the result is a Body3: planar faces with line-edge loops (edges
 *      shared by object between neighbouring faces, so the unfolder finds
 *      a bend's tangent lines), cylinder faces for the strips whose loop is
 *      CHAINED end to end — tangent line, side polyline, tangent line, side
 *      polyline — and, for a closed strip, both rims as closed polylines
 *      joined by a seam line walked twice, as a STEP seam is. volume.ts
 *      integrates a cylinder face by scanning its loop in (angle, axial)
 *      parameter space, so an unchained loop (the earlier form) made the
 *      even / odd coverage miss part of the face; since the divergence
 *      theorem multiplies the missing area by the distance from the origin,
 *      a part modelled metres from its origin came out with a volume tens
 *      of percent off.
 *
 * Decisions:
 *   - Positions are merged at 0.001 mm; coplanarity at 0.01 mm / 0.01°;
 *     a strip's facets rotate by 0.05°–60° per step, in one direction.
 *   - Facet normals come from the winding (Newell); the mesh volume sign
 *     decides whether they are outward. A mesh with inconsistent winding
 *     yields regions with wrong thickness pairs and ends in the manual
 *     result, never in a wrong flat pattern.
 *   - A planar-strip B-rep qualifies for the rebuild (isTessellatedBody)
 *     when every face is planar with line edges and at least one run of
 *     STRIP_MIN_RUN edge-adjacent narrow quads (width across the shared
 *     edges under NARROW_MAX_RATIO of their length) rotates about parallel
 *     edges by 0.05°–60° per step; a plain flat plate with straight edges
 *     has no such run and keeps the exact path.
 *   - No `any`; deterministic; never throws for a mesh with ≥ 1 facet.
 */

import type { Point } from "../types";
import { add3, cross3, dot3, len3, loopPolyline, norm3, scale3, sub3, type Body3, type Edge3, type Face3, type Loop3, type OrientedEdge3, type Placement, type Vec3 } from "./brep";

const MERGE_MM = 0.001;
const COPLANAR_MM = 0.01;
const COPLANAR_DOT = 0.99999;
const COLLINEAR_DOT = 0.99999;
const STRIP_MIN_DEG = 0.05;
const STRIP_MAX_DEG = 60;
/** A planar-strip B-rep needs a run of this many rotating narrow quads to count as a tessellation. */
const STRIP_MIN_RUN = 3;
/** A quad is "narrow" when its width across the shared (axis) edges is under this share of their length. */
const NARROW_MAX_RATIO = 0.4;

/** A facet: a simple ring, or an outer ring with holes (any winding, the holes are wound against the outer ring). */
export type MeshPolygon = Vec3[] | { outer: Vec3[]; holes: Vec3[][] };

export function polygonOuter(poly: MeshPolygon): Vec3[] {
  return Array.isArray(poly) ? poly : poly.outer;
}

export function polygonHoles(poly: MeshPolygon): Vec3[][] {
  return Array.isArray(poly) ? [] : poly.holes;
}

/* ─── Small helpers ─────────────────────────────────────────── */

function keyOf(p: Vec3): string {
  return `${Math.round(p.x / MERGE_MM)},${Math.round(p.y / MERGE_MM)},${Math.round(p.z / MERGE_MM)}`;
}

function newell(points: Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return { x, y, z };
}

function perpendicular(axis: Vec3): Vec3 {
  const seed = Math.abs(axis.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  return norm3(sub3(seed, scale3(axis, dot3(seed, axis))));
}

function placementOf(origin: Vec3, axis: Vec3): Placement {
  const ref = perpendicular(axis);
  return { origin, axis, ref, y: cross3(axis, ref) };
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Signed volume of the fan of tetrahedra (origin, p0, pi, pi+1) over a ring — exact for a planar ring, any winding. */
function fanVolume(positions: Vec3[], ring: number[]): number {
  let volume = 0;
  const p0 = positions[ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const p1 = positions[ring[i]];
    const p2 = positions[ring[i + 1]];
    volume += dot3(p0, cross3(p1, p2)) / 6;
  }
  return volume;
}

/** Volume enclosed by polygons as written (before any orientation fix); the sign tells the winding. */
export function polygonsSignedVolumeMm3(polygons: readonly MeshPolygon[]): number {
  let volume = 0;
  for (const poly of polygons) {
    const outer = polygonOuter(poly);
    if (outer.length < 3) continue;
    const n = newell(outer);
    volume += fanVolume(outer, outer.map((_, i) => i));
    for (const hole of polygonHoles(poly)) {
      if (hole.length < 3) continue;
      // A hole wound with the outer ring would add material: flip it.
      const ring = dot3(newell(hole), n) > 0 ? [...hole].reverse() : hole;
      volume += fanVolume(ring, ring.map((_, i) => i));
    }
  }
  return volume;
}

/* ─── Mesh ──────────────────────────────────────────────────── */

type Facet = {
  /** rings[0] is the outer ring (= vertices); the rest are holes wound against it. */
  rings: number[][];
  vertices: number[];
  normal: Vec3;
  /** Outer area minus the holes. */
  area: number;
  offset: number;
  region: number;
};

class Mesh {
  readonly positions: Vec3[] = [];
  readonly facets: Facet[] = [];
  /** undirected edge key "a-b" (a < b) → facet indices */
  readonly edgeFacets = new Map<string, number[]>();
  /** Enclosed volume (mm³), set by orientOutward(). */
  volumeMm3 = 0;
  private readonly index = new Map<string, number>();

  vertex(p: Vec3): number {
    const k = keyOf(p);
    const cached = this.index.get(k);
    if (cached !== undefined) return cached;
    const id = this.positions.length;
    this.positions.push(p);
    this.index.set(k, id);
    return id;
  }

  private ring(points: Vec3[]): number[] {
    const ids: number[] = [];
    for (const p of points) {
      const id = this.vertex(p);
      if (ids.length === 0 || ids[ids.length - 1] !== id) ids.push(id);
    }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    return ids;
  }

  addPolygon(poly: MeshPolygon): void {
    const ids = this.ring(polygonOuter(poly));
    if (ids.length < 3) return;
    const pts = ids.map((i) => this.positions[i]);
    const n = newell(pts);
    const area2 = len3(n);
    if (area2 < 1e-9) return;
    const normal = scale3(n, 1 / area2);
    let area = area2 / 2;
    const rings: number[][] = [ids];
    for (const hole of polygonHoles(poly)) {
      let ring = this.ring(hole);
      if (ring.length < 3) continue;
      const hn = newell(ring.map((i) => this.positions[i]));
      if (dot3(hn, normal) > 0) ring = ring.reverse();
      area -= len3(hn) / 2;
      rings.push(ring);
    }
    const facet: Facet = { rings, vertices: ids, normal, area: Math.max(0, area), offset: dot3(normal, pts[0]), region: -1 };
    const fi = this.facets.length;
    this.facets.push(facet);
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const key = edgeKey(ring[i], ring[(i + 1) % ring.length]);
        const list = this.edgeFacets.get(key);
        if (list) list.push(fi);
        else this.edgeFacets.set(key, [fi]);
      }
    }
  }

  signedVolume(): number {
    let volume = 0;
    for (const f of this.facets) for (const ring of f.rings) volume += fanVolume(this.positions, ring);
    return volume;
  }

  /** Flip every facet when the winding encloses a negative volume; records the enclosed volume. */
  orientOutward(): void {
    const volume = this.signedVolume();
    this.volumeMm3 = Math.abs(volume);
    if (volume >= 0) return;
    for (const f of this.facets) {
      for (const ring of f.rings) ring.reverse();
      f.normal = scale3(f.normal, -1);
      f.offset = -f.offset;
    }
  }

  neighbours(fi: number): { facet: number; a: number; b: number }[] {
    const f = this.facets[fi];
    const out: { facet: number; a: number; b: number }[] = [];
    for (const ring of f.rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        for (const other of this.edgeFacets.get(edgeKey(a, b)) ?? []) if (other !== fi) out.push({ facet: other, a, b });
      }
    }
    return out;
  }
}

/* ─── Regions ───────────────────────────────────────────────── */

type Region = {
  id: number;
  facets: number[];
  normal: Vec3;
  area: number;
  /** Directed boundary loops as vertex index rings (outer first after sorting). */
  loops: number[][];
};

function buildRegions(mesh: Mesh): Region[] {
  const regions: Region[] = [];
  for (let start = 0; start < mesh.facets.length; start++) {
    if (mesh.facets[start].region >= 0) continue;
    const id = regions.length;
    const members: number[] = [];
    const stack = [start];
    mesh.facets[start].region = id;
    while (stack.length) {
      const fi = stack.pop() as number;
      members.push(fi);
      const f = mesh.facets[fi];
      for (const nb of mesh.neighbours(fi)) {
        const g = mesh.facets[nb.facet];
        if (g.region >= 0) continue;
        if (dot3(f.normal, g.normal) < COPLANAR_DOT) continue;
        if (Math.abs(dot3(f.normal, mesh.positions[g.vertices[0]]) - f.offset) > COPLANAR_MM) continue;
        g.region = id;
        stack.push(nb.facet);
      }
    }
    // Area-weighted normal.
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let area = 0;
    for (const fi of members) {
      const f = mesh.facets[fi];
      nx += f.normal.x * f.area;
      ny += f.normal.y * f.area;
      nz += f.normal.z * f.area;
      area += f.area;
    }
    regions.push({ id, facets: members, normal: norm3({ x: nx, y: ny, z: nz }), area, loops: [] });
  }
  for (const region of regions) region.loops = regionLoops(mesh, region);
  return regions;
}

/**
 * Boundary of a region as directed vertex rings. Collinear vertices are
 * removed only when the region on the other side of the boundary is the
 * same before and after the vertex: where a bend strip ends and an edge
 * wall begins on one straight flange edge, the vertex stays, so the
 * strip's tangent edge and the flange's edge are the same vertex pair.
 */
function regionLoops(mesh: Mesh, region: Region): number[][] {
  type Out = { to: number; across: number };
  const next = new Map<number, Out[]>();
  for (const fi of region.facets) {
    const f = mesh.facets[fi];
    for (const ring of f.rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const twins = (mesh.edgeFacets.get(edgeKey(a, b)) ?? []).filter((other) => other !== fi);
        if (twins.some((other) => mesh.facets[other].region === region.id)) continue;
        const across = twins.length ? mesh.facets[twins[0]].region : -1;
        const list = next.get(a);
        if (list) list.push({ to: b, across });
        else next.set(a, [{ to: b, across }]);
      }
    }
  }
  const loops: number[][] = [];
  const startKeys = Array.from(next.keys()).sort((a, b) => a - b);
  for (const start of startKeys) {
    const outgoing = next.get(start);
    if (!outgoing || outgoing.length === 0) continue;
    const loop: { v: number; across: number }[] = [];
    let current = start;
    let guard = 0;
    while (guard++ < 100000) {
      const list = next.get(current);
      if (!list || list.length === 0) break;
      const out = list.shift() as Out;
      loop.push({ v: current, across: out.across });
      current = out.to;
      if (current === start) break;
    }
    if (loop.length >= 3 && current === start) loops.push(simplifyRing(mesh, loop));
  }
  return loops.filter((l) => l.length >= 3);
}

function simplifyRing(mesh: Mesh, ring: { v: number; across: number }[]): number[] {
  if (ring.length <= 3) return ring.map((r) => r.v);
  const out: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const prevItem = ring[(i - 1 + ring.length) % ring.length];
    const curItem = ring[i];
    const prev = mesh.positions[prevItem.v];
    const cur = mesh.positions[curItem.v];
    const nxt = mesh.positions[ring[(i + 1) % ring.length].v];
    const a = norm3(sub3(cur, prev));
    const b = norm3(sub3(nxt, cur));
    if (dot3(a, b) > COLLINEAR_DOT && prevItem.across === curItem.across) continue;
    out.push(curItem.v);
  }
  return out.length >= 3 ? out : ring.map((r) => r.v);
}

function ringArea(mesh: Mesh, ring: number[], normal: Vec3): number {
  const n = newell(ring.map((i) => mesh.positions[i]));
  return Math.abs(dot3(n, normal)) / 2;
}

/* ─── Strips (cylinders) ────────────────────────────────────── */

type ChainLink = { region: number; entry: [number, number]; exit: [number, number] };

type Strip = {
  /** Links in chain order: consecutive exit / entry edges are the same undirected edge. */
  links: ChainLink[];
  regions: number[];
  axis: Vec3;
  center: Vec3;
  radius: number;
  closed: boolean;
};

type Quad = { region: number; ring: number[] };

/** The two opposite edge pairs of a 4-ring; each pair as [[a,b],[c,d]] with both edges parallel. */
function parallelPairs(mesh: Mesh, ring: number[]): { edges: [[number, number], [number, number]]; dir: Vec3 }[] {
  const out: { edges: [[number, number], [number, number]]; dir: Vec3 }[] = [];
  for (const [i, j] of [
    [0, 2],
    [1, 3],
  ] as const) {
    const e1: [number, number] = [ring[i], ring[(i + 1) % 4]];
    const e2: [number, number] = [ring[j], ring[(j + 1) % 4]];
    const d1 = norm3(sub3(mesh.positions[e1[1]], mesh.positions[e1[0]]));
    const d2 = norm3(sub3(mesh.positions[e2[1]], mesh.positions[e2[0]]));
    if (Math.abs(dot3(d1, d2)) > 0.9999) out.push({ edges: [e1, e2], dir: d1 });
  }
  return out;
}

function regionAcross(mesh: Mesh, region: Region, a: number, b: number): number | null {
  for (const fi of mesh.edgeFacets.get(edgeKey(a, b)) ?? []) {
    const r = mesh.facets[fi].region;
    if (r !== region.id) return r;
  }
  return null;
}

function stepAngleDeg(a: Vec3, b: Vec3): number {
  return (Math.acos(Math.max(-1, Math.min(1, dot3(a, b)))) * 180) / Math.PI;
}

function fitCircle(points: Point[]): { center: Point; radius: number } | null {
  // Kåsa fit: x² + y² + D x + E y + F = 0, least squares in D, E, F.
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sx = 0;
  let sy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  const n = points.length;
  if (n < 3) return null;
  for (const p of points) {
    const z = p.x * p.x + p.y * p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
    syy += p.y * p.y;
    sx += p.x;
    sy += p.y;
    sxz += p.x * z;
    syz += p.y * z;
    sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [D E F]^T = -[sxz syz sz]^T
  const m = [
    [sxx, sxy, sx, -sxz],
    [sxy, syy, sy, -syz],
    [sx, sy, n, -sz],
  ];
  for (let c = 0; c < 3; c++) {
    let pivot = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (Math.abs(m[pivot][c]) < 1e-12) return null;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = m[r][c] / m[c][c];
      for (let j = c; j < 4; j++) m[r][j] -= k * m[c][j];
    }
  }
  const D = m[0][3] / m[0][0];
  const E = m[1][3] / m[1][1];
  const F = m[2][3] / m[2][2];
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  return { center: { x: cx, y: cy }, radius: Math.sqrt(r2) };
}

/** Width of a quad region across the strip axis: area over the axis-parallel edge length. */
function quadWidth(mesh: Mesh, region: Region, edge: [number, number]): number {
  const l = len3(sub3(mesh.positions[edge[1]], mesh.positions[edge[0]]));
  return l < 1e-9 ? Infinity : region.area / l;
}

function sameEdge(a: [number, number], b: [number, number]): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

function findStrips(mesh: Mesh, regions: Region[]): Strip[] {
  const quads = new Map<number, Quad>();
  for (const r of regions) {
    if (r.loops.length === 1 && r.loops[0].length === 4) quads.set(r.id, { region: r.id, ring: r.loops[0] });
  }
  const assigned = new Set<number>();
  const strips: Strip[] = [];

  // Walk from `edge` of `region` away from it, link by link, until the next
  // region is not a rotating quad. Returns the links and whether the walk
  // came back to `origin` (a closed ring).
  const walk = (origin: number, region: Region, edge: [number, number], dir: Vec3): { links: ChainLink[]; closed: boolean } => {
    const links: ChainLink[] = [];
    let current = region;
    let through = edge;
    for (let guard = 0; guard < 5000; guard++) {
      const acrossId = regionAcross(mesh, current, through[0], through[1]);
      if (acrossId === null) return { links, closed: false };
      if (acrossId === origin) return { links, closed: true };
      const acrossQuad = quads.get(acrossId);
      const across = regions[acrossId];
      const step = stepAngleDeg(current.normal, across.normal);
      if (!acrossQuad || assigned.has(acrossId) || step < STRIP_MIN_DEG || step > STRIP_MAX_DEG) return { links, closed: false };
      const nextPair = parallelPairs(mesh, acrossQuad.ring).find((p) => Math.abs(dot3(p.dir, dir)) > 0.9999);
      if (!nextPair) return { links, closed: false };
      const [e1, e2] = nextPair.edges;
      const entry = sameEdge(e1, through) ? e1 : e2;
      const exit = entry === e1 ? e2 : e1;
      links.push({ region: acrossId, entry, exit });
      current = across;
      through = exit;
    }
    return { links, closed: false };
  };

  for (const quad of quads.values()) {
    if (assigned.has(quad.region)) continue;
    for (const pair of parallelPairs(mesh, quad.ring)) {
      const forward = walk(quad.region, regions[quad.region], pair.edges[0], pair.dir);
      const backward = forward.closed ? { links: [], closed: true } : walk(quad.region, regions[quad.region], pair.edges[1], pair.dir);
      // Ordered chain: backward links reversed (entry/exit swapped), the start, forward links.
      const chain: ChainLink[] = [
        ...backward.links.map((l) => ({ region: l.region, entry: l.exit, exit: l.entry })).reverse(),
        { region: quad.region, entry: pair.edges[1], exit: pair.edges[0] },
        ...forward.links,
      ];
      const closed = forward.closed || backward.closed;
      if (chain.length < 2) continue;
      // Flange quads (no holes) are walked through like strip facets: a
      // link far wider than the strip's own facets splits the chain, so a
      // flange between two parallel bends, or the straight walls of a
      // slot, stay planar faces and each arc becomes its own cylinder.
      const widths = chain.map((l) => quadWidth(mesh, regions[l.region], l.entry));
      const sorted = widths.slice().sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const wide = widths.map((w) => w > median * 2.5);
      const runs: ChainLink[][] = [];
      let run: ChainLink[] = [];
      chain.forEach((l, i) => {
        if (wide[i]) {
          if (run.length) runs.push(run);
          run = [];
        } else run.push(l);
      });
      if (run.length) runs.push(run);
      const wholeRing = closed && runs.length === 1 && runs[0].length === chain.length;
      if (closed && !wholeRing && runs.length > 1 && !wide[0] && !wide[chain.length - 1]) {
        // The ring wraps: the last and first runs are one arc.
        const last = runs.pop() as ChainLink[];
        runs[0] = [...last, ...runs[0]];
      }
      let made = 0;
      for (const r of runs) {
        if (r.length < 2) continue;
        const axis = pair.dir;
        const u = perpendicular(axis);
        const v = cross3(axis, u);
        const pts: Point[] = [];
        const seen = new Set<number>();
        for (const link of r) {
          for (const vi of regions[link.region].loops[0]) {
            if (seen.has(vi)) continue;
            seen.add(vi);
            const p = mesh.positions[vi];
            pts.push({ x: dot3(p, u), y: dot3(p, v) });
          }
        }
        const fit = fitCircle(pts);
        if (!fit) continue;
        const along = dot3(mesh.positions[quad.ring[0]], axis);
        const center = add3(add3(scale3(u, fit.center.x), scale3(v, fit.center.y)), scale3(axis, along));
        for (const link of r) assigned.add(link.region);
        strips.push({ links: r, regions: r.map((l) => l.region), axis, center, radius: fit.radius, closed: wholeRing });
        made++;
      }
      if (made === 0) continue;
      break;
    }
  }
  return strips;
}

/* ─── Body assembly ─────────────────────────────────────────── */

class EdgeCache {
  private next = 1;
  private readonly edges = new Map<string, Edge3>();
  constructor(private readonly mesh: Mesh) {}

  /** The shared line edge between vertices a and b, oriented from a to b. */
  line(a: number, b: number): OrientedEdge3 {
    const key = edgeKey(a, b);
    let edge = this.edges.get(key);
    if (!edge) {
      const start = this.mesh.positions[Math.min(a, b)];
      const end = this.mesh.positions[Math.max(a, b)];
      edge = { id: this.next++, start, end, curve: { kind: "line", point: start, dir: norm3(sub3(end, start)) }, sameSense: true };
      this.edges.set(key, edge);
    }
    return { edge, orientation: a < b };
  }

  /** A polyline edge through the vertices, in the given order (orientation true). */
  polyline(ids: number[]): OrientedEdge3 {
    const points = ids.map((i) => this.mesh.positions[i]);
    return { edge: { id: this.next++, start: points[0], end: points[points.length - 1], curve: { kind: "polyline", points }, sameSense: true }, orientation: true };
  }

  ringLoop(id: number, ring: number[]): Loop3 {
    const edges: OrientedEdge3[] = [];
    for (let i = 0; i < ring.length; i++) edges.push(this.line(ring[i], ring[(i + 1) % ring.length]));
    return { id, edges };
  }
}

/** The endpoints of an axis-parallel edge split by their position along the axis: [low, high]. */
function bySide(mesh: Mesh, edge: [number, number], axis: Vec3): [number, number] {
  return dot3(mesh.positions[edge[0]], axis) <= dot3(mesh.positions[edge[1]], axis) ? [edge[0], edge[1]] : [edge[1], edge[0]];
}

/**
 * The two sides of a strip as vertex sequences in chain order: side 0 at
 * the low end of the axis, side 1 at the high end. Both start at the
 * first link's entry edge; an open strip ends at the last link's exit
 * edge, a closed one comes back to its start (the closing vertex is
 * repeated).
 */
function stripSides(mesh: Mesh, strip: Strip): [number[], number[]] {
  const lo: number[] = [];
  const hi: number[] = [];
  const push = (edge: [number, number]) => {
    const [a, b] = bySide(mesh, edge, strip.axis);
    if (lo[lo.length - 1] !== a) lo.push(a);
    if (hi[hi.length - 1] !== b) hi.push(b);
  };
  for (const link of strip.links) push(link.entry);
  push(strip.links[strip.links.length - 1].exit);
  return [lo, hi];
}

/**
 * Rebuild faces from planar polygons (each a closed ring of points, with
 * optional holes, any winding as long as the mesh is consistent). Returns
 * null when nothing usable is in the mesh. The body carries the exact
 * enclosed volume of the mesh as `meshVolumeMm3`.
 */
export function meshToBody(id: number, polygons: readonly MeshPolygon[]): Body3 | null {
  const mesh = new Mesh();
  for (const poly of polygons) mesh.addPolygon(poly);
  if (mesh.facets.length === 0) return null;
  mesh.orientOutward();
  const regions = buildRegions(mesh);
  const strips = findStrips(mesh, regions);
  const stripRegion = new Set<number>();
  for (const s of strips) for (const r of s.regions) stripRegion.add(r);

  const cache = new EdgeCache(mesh);
  const faces: Face3[] = [];
  let faceId = 1;

  // Planar faces from regions that are not part of a strip.
  for (const region of regions) {
    if (stripRegion.has(region.id) || region.loops.length === 0) continue;
    const rings = region.loops.slice().sort((a, b) => ringArea(mesh, b, region.normal) - ringArea(mesh, a, region.normal));
    const outer = cache.ringLoop(faceId * 10, rings[0]);
    const inner = rings.slice(1).map((r, i) => cache.ringLoop(faceId * 10 + 1 + i, r));
    const origin = mesh.positions[rings[0][0]];
    faces.push({ id: faceId++, surface: { kind: "plane", placement: placementOf(origin, region.normal) }, sameSense: true, outer, inner });
  }

  // Cylinder faces from strips.
  for (const strip of strips) {
    const placement = placementOf(strip.center, strip.axis);
    const first = regions[strip.regions[0]];
    const centroid = first.loops[0].reduce((acc, vi) => add3(acc, mesh.positions[vi]), { x: 0, y: 0, z: 0 });
    const c = scale3(centroid, 1 / first.loops[0].length);
    const radial = sub3(c, add3(strip.center, scale3(strip.axis, dot3(sub3(c, strip.center), strip.axis))));
    const convex = dot3(first.normal, radial) > 0;
    const [lo, hi] = stripSides(mesh, strip);
    const edges: OrientedEdge3[] = [];
    if (!strip.closed && lo.length >= 2 && hi.length >= 2) {
      // Tangent line at the entry (low → high), the high side forward, the
      // tangent line at the exit (high → low), the low side back: a loop
      // chained end to end.
      const p0 = lo[0];
      const p1 = hi[0];
      const q0 = lo[lo.length - 1];
      const q1 = hi[hi.length - 1];
      edges.push(cache.line(p0, p1));
      edges.push(cache.polyline(hi));
      edges.push(cache.line(q1, q0));
      edges.push(cache.polyline([...lo].reverse()));
    } else if (lo.length >= 3 && hi.length >= 3) {
      // Closed ring (hole wall, full round): both rims as closed polylines
      // joined by the seam edge walked down and up, as a STEP seam is.
      const rimLo = lo[lo.length - 1] === lo[0] ? lo : [...lo, lo[0]];
      const rimHi = hi[hi.length - 1] === hi[0] ? hi : [...hi, hi[0]];
      edges.push(cache.polyline(rimLo));
      edges.push(cache.line(rimLo[0], rimHi[0]));
      edges.push(cache.polyline([...rimHi].reverse()));
      edges.push(cache.line(rimHi[0], rimLo[0]));
    } else {
      continue;
    }
    faces.push({
      id: faceId++,
      surface: { kind: "cylinder", placement, radius: strip.radius },
      sameSense: convex,
      outer: { id: faceId * 10, edges },
      inner: [],
    });
  }

  return faces.length ? { id, kind: "solid", faces, meshVolumeMm3: mesh.volumeMm3 } : null;
}

/* ─── Which bodies are tessellations ────────────────────────── */

/** Every face is a planar polygon of synthetic POLY_LOOP edges (FACETED_BREP / IFC facets). */
export function isFacetedBody(body: Body3): boolean {
  if (body.faces.length === 0) return false;
  for (const face of body.faces) {
    if (face.surface.kind !== "plane" || !face.outer) return false;
    for (const oe of face.outer.edges) if (oe.edge.id >= 0 || oe.edge.curve.kind !== "line") return false;
  }
  return true;
}

/** Every face planar, every edge a line (real EDGE_CURVEs or POLY_LOOPs alike). */
export function isPlanarLineBody(body: Body3): boolean {
  if (body.faces.length === 0) return false;
  for (const face of body.faces) {
    if (face.surface.kind !== "plane" || !face.outer) return false;
    for (const loop of [face.outer, ...face.inner]) for (const oe of loop.edges) if (oe.edge.curve.kind !== "line") return false;
  }
  return true;
}

type BrepQuad = { face: Face3; ring: Vec3[]; edgeIds: number[]; normal: Vec3; area: number };

/**
 * A planar B-rep that is really a tessellation: at least one run of
 * STRIP_MIN_RUN edge-adjacent narrow quads that rotate about parallel edges
 * by STRIP_MIN_DEG–STRIP_MAX_DEG per step, in one direction — a bend, a
 * round or a hole wall written as facets. A flat plate with straight
 * edges, or a body with true cylinders, is not one.
 */
export function hasPlanarStripRun(body: Body3): boolean {
  if (!isPlanarLineBody(body)) return false;
  const quads: BrepQuad[] = [];
  const facesByEdge = new Map<number, Face3[]>();
  for (const face of body.faces) {
    const outer = face.outer as Loop3;
    for (const loop of [outer, ...face.inner]) {
      for (const oe of loop.edges) {
        if (oe.edge.id < 0) continue;
        const list = facesByEdge.get(oe.edge.id) ?? [];
        if (!list.includes(face)) list.push(face);
        facesByEdge.set(oe.edge.id, list);
      }
    }
    if (face.inner.length > 0 || outer.edges.length !== 4) continue;
    const ring = outer.edges.map((oe) => (oe.orientation ? oe.edge.start : oe.edge.end));
    const n = newell(ring);
    const area2 = len3(n);
    if (area2 < 1e-9) continue;
    const normal = scale3(n, face.sameSense ? 1 / area2 : -1 / area2);
    quads.push({ face, ring, edgeIds: outer.edges.map((oe) => oe.edge.id), normal, area: area2 / 2 });
  }
  if (quads.length < STRIP_MIN_RUN) return false;
  const quadOfFace = new Map<Face3, BrepQuad>();
  for (const q of quads) quadOfFace.set(q.face, q);

  // Parallel edge pairs of a quad by edge index: (0, 2) and (1, 3).
  const pairOf = (q: BrepQuad, i: number): { dir: Vec3; length: number; narrow: boolean } | null => {
    const a = q.ring[i];
    const b = q.ring[(i + 1) % 4];
    const c = q.ring[(i + 2) % 4];
    const d = q.ring[(i + 3) % 4];
    const d1 = sub3(b, a);
    const d2 = sub3(d, c);
    const l1 = len3(d1);
    const l2 = len3(d2);
    if (l1 < 1e-9 || l2 < 1e-9 || Math.abs(dot3(d1, d2)) / (l1 * l2) < 0.9999) return null;
    const length = (l1 + l2) / 2;
    return { dir: scale3(d1, 1 / l1), length, narrow: q.area / length < NARROW_MAX_RATIO * length };
  };

  const visited = new Set<Face3>();
  for (const start of quads) {
    if (visited.has(start.face)) continue;
    for (const i of [0, 1]) {
      const pair = pairOf(start, i);
      if (!pair || !pair.narrow) continue;
      // Walk both ways across the pair's edges, counting narrow quads that rotate consistently about the pair direction.
      let run = 1;
      for (const edgeIndex of [i, i + 2]) {
        let current = start;
        let edgeId = start.edgeIds[edgeIndex];
        let sign = 0;
        for (let guard = 0; guard < 10000; guard++) {
          const next = (facesByEdge.get(edgeId) ?? []).find((f) => f !== current.face);
          const nq = next ? quadOfFace.get(next) : undefined;
          if (!nq || nq === start || visited.has(nq.face)) break;
          const step = stepAngleDeg(current.normal, nq.normal);
          if (step < STRIP_MIN_DEG || step > STRIP_MAX_DEG) break;
          const turn = dot3(cross3(current.normal, nq.normal), pair.dir);
          const s = turn > 0 ? 1 : -1;
          if (sign !== 0 && s !== sign) break;
          sign = s;
          // The quad must have the shared edge in a parallel pair of its own, and be narrow.
          const shared = nq.edgeIds.indexOf(edgeId);
          if (shared < 0) break;
          const np = pairOf(nq, shared % 2);
          if (!np || !np.narrow || Math.abs(dot3(np.dir, pair.dir)) < 0.9999) break;
          run++;
          if (run >= STRIP_MIN_RUN) return true;
          current = nq;
          edgeId = nq.edgeIds[(shared + 2) % 4];
        }
      }
    }
    visited.add(start.face);
  }
  return false;
}

/** Bodies that go through the mesh rebuild: POLY_LOOP facets, or a planar-strip B-rep. */
export function isTessellatedBody(body: Body3): boolean {
  return isFacetedBody(body) || hasPlanarStripRun(body);
}

/** Polygons (outer ring + holes) of a body whose faces are all planar with line edges. */
export function polygonsOfFacetedBody(body: Body3): MeshPolygon[] {
  const out: MeshPolygon[] = [];
  for (const face of body.faces) {
    if (!face.outer) continue;
    const outer = loopPolyline(face.outer, 1);
    if (outer.length < 3) continue;
    const holes = face.inner.map((l) => loopPolyline(l, 1)).filter((h) => h.length >= 3);
    out.push(holes.length ? { outer, holes } : outer);
  }
  return out;
}
