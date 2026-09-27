/**
 * Geometry engine — faces from a triangle / polygon mesh (tessellated solids).
 * File path: /lib/geometry/step/mesh.ts
 *
 * IFC exports (and STEP FACETED_BREPs) carry no surfaces, only planar
 * facets: a plate's top is dozens of triangles, a bend is a strip of
 * narrow quads, a hole wall a ring of quads. This module rebuilds what
 * the sheet analysis and the unfolder need from that:
 *   1. vertices are merged by position and facets welded into a closed
 *      mesh (edge → the two facets using it); winding is made outward
 *      by the sign of the enclosed volume;
 *   2. coplanar facets that share an edge are merged into planar REGIONS
 *      (flange tops and bottoms, edge walls); a region's boundary is the
 *      set of its directed edges whose twin lies outside it, chained into
 *      loops and simplified by dropping collinear vertices;
 *   3. quad regions whose neighbours across a pair of parallel edges are
 *      quads with a normal rotated about that edge direction form STRIPS:
 *      a circle fitted through the strip vertices in the plane across its
 *      axis gives a cylinder (bend inner / outer surface, hole wall, corner
 *      round); a strip that closes on itself is a full cylinder;
 *   4. the result is a Body3: planar faces with line-edge loops (edges
 *      shared by object between neighbouring faces, so the unfolder finds
 *      a bend's tangent lines), cylinder faces for the strips whose loop
 *      holds the two tangent lines and two polyline sides.
 *
 * Decisions:
 *   - Positions are merged at 0.001 mm; coplanarity at 0.01 mm / 0.01°;
 *     a strip's facets rotate by 0.05°–60° per step, in one direction.
 *   - Facet normals come from the winding (Newell); the mesh volume sign
 *     decides whether they are outward. A mesh with inconsistent winding
 *     yields regions with wrong thickness pairs and ends in the manual
 *     result, never in a wrong flat pattern.
 *   - No `any`; deterministic; never throws for a mesh with ≥ 1 facet.
 */

import type { Point } from "../types";
import { add3, cross3, dot3, len3, norm3, scale3, sub3, type Body3, type Edge3, type Face3, type Loop3, type OrientedEdge3, type Placement, type Vec3 } from "./brep";

const MERGE_MM = 0.001;
const COPLANAR_MM = 0.01;
const COPLANAR_DOT = 0.99999;
const COLLINEAR_DOT = 0.99999;
const STRIP_MIN_DEG = 0.05;
const STRIP_MAX_DEG = 60;

export type MeshPolygon = Vec3[];

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

/* ─── Mesh ──────────────────────────────────────────────────── */

type Facet = { vertices: number[]; normal: Vec3; area: number; offset: number; region: number };

class Mesh {
  readonly positions: Vec3[] = [];
  readonly facets: Facet[] = [];
  /** undirected edge key "a-b" (a < b) → facet indices */
  readonly edgeFacets = new Map<string, number[]>();
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

  addPolygon(points: Vec3[]): void {
    const ids: number[] = [];
    for (const p of points) {
      const id = this.vertex(p);
      if (ids.length === 0 || ids[ids.length - 1] !== id) ids.push(id);
    }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    if (ids.length < 3) return;
    const pts = ids.map((i) => this.positions[i]);
    const n = newell(pts);
    const area2 = len3(n);
    if (area2 < 1e-9) return;
    const normal = scale3(n, 1 / area2);
    const facet: Facet = { vertices: ids, normal, area: area2 / 2, offset: dot3(normal, pts[0]), region: -1 };
    const fi = this.facets.length;
    this.facets.push(facet);
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % ids.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const list = this.edgeFacets.get(key);
      if (list) list.push(fi);
      else this.edgeFacets.set(key, [fi]);
    }
  }

  /** Flip every facet when the winding encloses a negative volume. */
  orientOutward(): void {
    let volume = 0;
    for (const f of this.facets) {
      const p0 = this.positions[f.vertices[0]];
      for (let i = 1; i < f.vertices.length - 1; i++) {
        const p1 = this.positions[f.vertices[i]];
        const p2 = this.positions[f.vertices[i + 1]];
        volume += dot3(p0, cross3(p1, p2)) / 6;
      }
    }
    if (volume >= 0) return;
    for (const f of this.facets) {
      f.vertices.reverse();
      f.normal = scale3(f.normal, -1);
      f.offset = -f.offset;
    }
  }

  neighbours(fi: number): { facet: number; a: number; b: number }[] {
    const f = this.facets[fi];
    const out: { facet: number; a: number; b: number }[] = [];
    for (let i = 0; i < f.vertices.length; i++) {
      const a = f.vertices[i];
      const b = f.vertices[(i + 1) % f.vertices.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      for (const other of this.edgeFacets.get(key) ?? []) if (other !== fi) out.push({ facet: other, a, b });
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
    for (let i = 0; i < f.vertices.length; i++) {
      const a = f.vertices[i];
      const b = f.vertices[(i + 1) % f.vertices.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const twins = (mesh.edgeFacets.get(key) ?? []).filter((other) => other !== fi);
      if (twins.some((other) => mesh.facets[other].region === region.id)) continue;
      const across = twins.length ? mesh.facets[twins[0]].region : -1;
      const list = next.get(a);
      if (list) list.push({ to: b, across });
      else next.set(a, [{ to: b, across }]);
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

type Strip = {
  regions: number[];
  axis: Vec3;
  center: Vec3;
  radius: number;
  closed: boolean;
  /** Boundary rings at both ends of the strip (vertex ids along the axis edges), or null when closed. */
  endEdges: [number, number][] | null;
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
  const key = a < b ? `${a}-${b}` : `${b}-${a}`;
  for (const fi of mesh.edgeFacets.get(key) ?? []) {
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

type ChainLink = { region: number; entry: [number, number]; exit: [number, number] };

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
        strips.push({
          regions: r.map((l) => l.region),
          axis,
          center,
          radius: fit.radius,
          closed: wholeRing,
          endEdges: wholeRing ? null : [r[0].entry, r[r.length - 1].exit],
        });
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

  line(a: number, b: number): { edge: Edge3; forward: boolean } {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    let edge = this.edges.get(key);
    if (!edge) {
      const start = this.mesh.positions[Math.min(a, b)];
      const end = this.mesh.positions[Math.max(a, b)];
      edge = { id: this.next++, start, end, curve: { kind: "line", point: start, dir: norm3(sub3(end, start)) }, sameSense: true };
      this.edges.set(key, edge);
    }
    return { edge, forward: a < b };
  }

  polyline(points: Vec3[]): Edge3 {
    return { id: this.next++, start: points[0], end: points[points.length - 1], curve: { kind: "polyline", points }, sameSense: true };
  }

  ringLoop(id: number, ring: number[]): Loop3 {
    const edges: OrientedEdge3[] = [];
    for (let i = 0; i < ring.length; i++) {
      const { edge, forward } = this.line(ring[i], ring[(i + 1) % ring.length]);
      edges.push({ edge, orientation: forward });
    }
    return { id, edges };
  }
}

/**
 * Rebuild faces from planar polygons (each a closed ring of points, any
 * winding as long as the mesh is consistent). Returns null when nothing
 * usable is in the mesh.
 */
export function meshToBody(id: number, polygons: MeshPolygon[]): Body3 | null {
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
    const edges: OrientedEdge3[] = [];
    if (strip.endEdges && strip.endEdges.length === 2) {
      // Tangent line A, side polyline, tangent line B, side polyline.
      const [ea, eb] = strip.endEdges;
      const la = cache.line(ea[0], ea[1]);
      const lb = cache.line(eb[0], eb[1]);
      // Side polylines: walk the strip's vertices on each end of the axis.
      const sideA: Vec3[] = [];
      const sideB: Vec3[] = [];
      const alongA0 = dot3(mesh.positions[ea[0]], strip.axis);
      for (const rid of strip.regions) {
        for (const vi of regions[rid].loops[0]) {
          const p = mesh.positions[vi];
          (Math.abs(dot3(p, strip.axis) - alongA0) < MERGE_MM * 10 ? sideA : sideB).push(p);
        }
      }
      edges.push({ edge: la.edge, orientation: la.forward });
      if (sideB.length >= 2) edges.push({ edge: cache.polyline(dedupe(sideB)), orientation: true });
      edges.push({ edge: lb.edge, orientation: lb.forward });
      if (sideA.length >= 2) edges.push({ edge: cache.polyline(dedupe(sideA)), orientation: true });
    } else {
      // Closed ring (hole wall, full round): both rims as polylines.
      const rimA: Vec3[] = [];
      const rimB: Vec3[] = [];
      const along0 = dot3(mesh.positions[first.loops[0][0]], strip.axis);
      for (const rid of strip.regions) {
        for (const vi of regions[rid].loops[0]) {
          const p = mesh.positions[vi];
          (Math.abs(dot3(p, strip.axis) - along0) < MERGE_MM * 10 ? rimA : rimB).push(p);
        }
      }
      if (rimA.length >= 2) edges.push({ edge: cache.polyline(dedupe(rimA)), orientation: true });
      if (rimB.length >= 2) edges.push({ edge: cache.polyline(dedupe(rimB)), orientation: true });
    }
    faces.push({
      id: faceId++,
      surface: { kind: "cylinder", placement, radius: strip.radius },
      sameSense: convex,
      outer: { id: faceId * 10, edges },
      inner: [],
    });
  }

  return faces.length ? { id, kind: "solid", faces } : null;
}

function dedupe(points: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  const seen = new Set<string>();
  for (const p of points) {
    const k = keyOf(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Polygons of a body whose faces are all planar polygon loops (FACETED_BREP / POLY_LOOP). */
export function isFacetedBody(body: Body3): boolean {
  if (body.faces.length === 0) return false;
  for (const face of body.faces) {
    if (face.surface.kind !== "plane" || !face.outer) return false;
    for (const oe of face.outer.edges) if (oe.edge.id >= 0 || oe.edge.curve.kind !== "line") return false;
  }
  return true;
}

export function polygonsOfFacetedBody(body: Body3): MeshPolygon[] {
  const out: MeshPolygon[] = [];
  for (const face of body.faces) {
    if (!face.outer) continue;
    const ring: Vec3[] = [];
    for (const oe of face.outer.edges) ring.push(oe.orientation ? oe.edge.start : oe.edge.end);
    if (ring.length >= 3) out.push(ring);
  }
  return out;
}

