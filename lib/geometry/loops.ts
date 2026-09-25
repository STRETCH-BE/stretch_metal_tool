/**
 * Geometry engine — chaining entities into closed loops and open chains.
 * File path: /lib/geometry/loops.ts
 *
 * Every entity is a "unit" with two free endpoints (or none when it is
 * closed: CIRCLE, closed polyline). Units are chained through a grid
 * hash of endpoints (cell = tolerance). At a branching vertex the walk
 * continues with the unit whose outgoing tangent turns least from the
 * incoming tangent; whatever is left over becomes further chains.
 *
 * Chains are built per "chain class": cut-like entities (layer role
 * null/cut) chain together; bend/weld/engrave-layer entities only chain
 * with their own role, so a weld seam drawn along the outline can never
 * hijack the outer contour, and a bend line split in two still reads as
 * one bend line.
 *
 * Area is exact: shoelace over the chord polygon plus the signed
 * circular-segment area of every arc (+ when the arc is traversed CCW,
 * − when traversed against its CCW direction). Circles are π·r².
 * Perimeter uses exact arc lengths; bbox uses true arc extents.
 *
 * `loopsClosed` counts chains whose two free ends lay within tolerance
 * and were closed here (a polyline without the closed flag whose last
 * vertex returns to the first is the typical case).
 */

import type { ArcSegment, EntityRole, GeometryEntity, Loop, Point, Segment } from "./types";
import {
  DEFAULT_CHORD_ERROR_MM,
  angleBetweenDeg,
  bboxOf,
  bboxUnionAll,
  circularSegmentArea,
  dist,
  flattenSegment,
  polygonArea,
  scale,
  segmentBbox,
  segmentLength,
  tangentAt,
} from "./math";
import { PointGrid, freeEndpoints } from "./heal";
import { loopIdFor } from "./ids";

export type BuildLoopsResult = {
  loops: Loop[];
  /** Same entities with `loopId` filled in. */
  entities: GeometryEntity[];
  loopsClosed: number;
};

export type OrientedSegment = { segment: Segment; reversed: boolean };

type Unit = {
  index: number;
  entity: GeometryEntity;
  ends: { point: Point; segment: number; end: "start" | "end" }[];
  closed: boolean;
};

type ChainLink = { unit: Unit; reversed: boolean };

/* ─── Chain classes ──────────────────────────────────────── */

function chainClass(e: GeometryEntity): string {
  const r: EntityRole | null = e.roleFromLayer;
  if (r === "bend_up" || r === "bend_down" || r === "weld" || r === "engrave") return r;
  return "cut";
}

/* ─── Tangents at a unit end ─────────────────────────────── */

function dirAt(seg: Segment, which: "start" | "end", leaving: boolean): Point {
  if (seg.kind === "circle") return { x: 1, y: 0 };
  const t = tangentAt(seg, which);
  // leaving: we go from the vertex into the segment.
  // arriving: we come along the segment into the vertex.
  const forward = leaving ? which === "start" : which === "end";
  return forward ? t : scale(t, -1);
}

function unitEnd(u: Unit, reversed: boolean, at: "entry" | "exit") {
  // Forward traversal enters at ends[0] and exits at ends[1].
  const i = (at === "entry") !== reversed ? 0 : 1;
  return u.ends[i];
}

function arrivingDir(link: ChainLink): Point {
  const e = unitEnd(link.unit, link.reversed, "exit");
  return dirAt(link.unit.entity.segments[e.segment], e.end, false);
}

function leavingDir(u: Unit, reversed: boolean): Point {
  const e = unitEnd(u, reversed, "entry");
  return dirAt(u.entity.segments[e.segment], e.end, true);
}

/* ─── Orientation of the segments along a chain ──────────── */

/** Segments of a chain in traversal order with per-segment direction. */
export function orientChain(links: ChainLink[], tol: number): OrientedSegment[] {
  const out: OrientedSegment[] = [];
  let pen: Point | null = null;
  for (const link of links) {
    const segs = link.reversed ? [...link.unit.entity.segments].reverse() : link.unit.entity.segments;
    if (pen === null) {
      if (link.unit.ends.length === 2) pen = unitEnd(link.unit, link.reversed, "entry").point;
      else {
        const first = segs[0];
        pen = first.kind === "circle" ? first.center : first.start;
      }
    }
    for (const seg of segs) {
      if (seg.kind === "circle") {
        out.push({ segment: seg, reversed: false });
        continue;
      }
      const dS = dist(seg.start, pen);
      const dE = dist(seg.end, pen);
      const reversed = dE < dS;
      out.push({ segment: seg, reversed });
      pen = reversed ? seg.start : seg.end;
      void tol;
    }
  }
  return out;
}

/** Flattened points of an oriented segment list (no duplicate joints). */
export function flattenOriented(oriented: OrientedSegment[], chordError = DEFAULT_CHORD_ERROR_MM): Point[] {
  const pts: Point[] = [];
  for (const { segment, reversed } of oriented) {
    let f = flattenSegment(segment, chordError);
    if (reversed) f = [...f].reverse();
    for (const p of f) {
      const last = pts[pts.length - 1];
      if (last && dist(last, p) <= 1e-9) continue;
      pts.push(p);
    }
  }
  return pts;
}

/** Exact absolute area enclosed by a closed oriented chain. */
export function orientedArea(oriented: OrientedSegment[]): number {
  if (oriented.length === 1 && oriented[0].segment.kind === "circle") {
    const c = oriented[0].segment;
    return Math.PI * c.radius * c.radius;
  }
  const verts: Point[] = [];
  let arcs = 0;
  for (const { segment, reversed } of oriented) {
    if (segment.kind === "circle") continue;
    if (verts.length === 0) verts.push(reversed ? segment.end : segment.start);
    verts.push(reversed ? segment.start : segment.end);
    if (segment.kind === "arc") arcs += (reversed ? -1 : 1) * circularSegmentArea(segment as ArcSegment);
  }
  return Math.abs(polygonArea(verts) + arcs);
}

/* ─── Circle detection ───────────────────────────────────── */

export function detectCircle(entities: GeometryEntity[], points: Point[]): Loop["circle"] | undefined {
  if (entities.length === 1 && entities[0].segments.length === 1 && entities[0].segments[0].kind === "circle") {
    const c = entities[0].segments[0];
    return { center: { ...c.center }, diameterMm: 2 * c.radius };
  }
  if (points.length < 6) return undefined;
  // Sample the flattened points plus the midpoints of straight edges, so
  // a square (corners equidistant from the centre) is not mistaken.
  const samples: Point[] = [...points];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    samples.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  const bb = bboxOf(points);
  const center = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const p of samples) {
    const r = dist(p, center);
    if (r < min) min = r;
    if (r > max) max = r;
    sum += r;
  }
  const mean = sum / samples.length;
  if (mean <= 0) return undefined;
  if ((max - min) / mean >= 0.01) return undefined;
  const onCircle = points.reduce((acc, p) => acc + dist(p, center), 0) / points.length;
  return { center, diameterMm: 2 * onCircle };
}

/* ─── Entry point ────────────────────────────────────────── */

export function buildLoops(
  entities: GeometryEntity[],
  toleranceMm: number,
  chordError = DEFAULT_CHORD_ERROR_MM
): BuildLoopsResult {
  const tol = toleranceMm;
  const loops: Loop[] = [];
  let loopsClosed = 0;
  const loopIdByEntity = new Map<string, string>();

  const makeLoop = (links: ChainLink[], closed: boolean): Loop => {
    const ents = links.map((l) => l.unit.entity);
    const oriented = orientChain(links, tol);
    const points = flattenOriented(oriented, chordError);
    if (closed && points.length > 1 && dist(points[0], points[points.length - 1]) <= tol) points.pop();
    const area = closed ? orientedArea(oriented) : 0;
    const perimeter = ents.reduce((acc, e) => acc + e.lengthMm, 0);
    const bbox = bboxUnionAll(ents.flatMap((e) => e.segments.map(segmentBbox)));
    const entityIds = ents.map((e) => e.id);
    const loop: Loop = {
      id: loopIdFor(entityIds),
      entityIds,
      closed,
      areaMm2: area,
      perimeterMm: perimeter,
      bbox,
      points,
      kind: closed ? "noise" : "open_chain",
      partIndex: -1,
    };
    if (closed) {
      const circle = detectCircle(ents, points);
      if (circle) loop.circle = circle;
    }
    return loop;
  };

  // Group by chain class, preserving entity order inside each class.
  const classes = new Map<string, GeometryEntity[]>();
  for (const e of entities) {
    if (e.role === "ignore") continue;
    const c = chainClass(e);
    const list = classes.get(c);
    if (list) list.push(e);
    else classes.set(c, [e]);
  }

  for (const list of classes.values()) {
    const units: Unit[] = [];
    for (const e of list) {
      if (e.closed) {
        loops.push(makeLoop([{ unit: { index: -1, entity: e, ends: [], closed: true }, reversed: false }], true));
        continue;
      }
      const ends = freeEndpoints(e);
      if (ends.length < 2) {
        // Unflagged polyline that returns to its start.
        if (e.segments.length > 1) loopsClosed += 1;
        loops.push(makeLoop([{ unit: { index: -1, entity: e, ends: [], closed: true }, reversed: false }], true));
        continue;
      }
      if (e.segments.length > 1 && dist(ends[0].point, ends[1].point) <= tol) {
        loopsClosed += 1;
        loops.push(makeLoop([{ unit: { index: -1, entity: e, ends, closed: true }, reversed: false }], true));
        continue;
      }
      units.push({ index: units.length, entity: e, ends: [ends[0], ends[1]], closed: false });
    }

    const grid = new PointGrid<{ unit: Unit; endIndex: 0 | 1 }>(tol);
    for (const u of units) {
      grid.add(u.ends[0].point, { unit: u, endIndex: 0 });
      grid.add(u.ends[1].point, { unit: u, endIndex: 1 });
    }
    const visited = new Set<number>();

    const walk = (chain: ChainLink[]): boolean => {
      // Extends `chain` forward from its current exit; returns true when it closed.
      let guard = units.length + 1;
      while (guard-- > 0) {
        const last = chain[chain.length - 1];
        const exit = unitEnd(last.unit, last.reversed, "exit").point;
        const first = chain[0];
        const entry = unitEnd(first.unit, first.reversed, "entry").point;
        if (chain.length >= 2 && dist(exit, entry) <= tol) return true;
        const cands = grid
          .findAll(exit)
          .map((c) => c.v)
          .filter((c) => !visited.has(c.unit.index))
          .sort((a, b) => a.unit.index - b.unit.index);
        if (cands.length === 0) return false;
        let pick = cands[0];
        if (cands.length > 1) {
          const inDir = arrivingDir(last);
          let bestAngle = Infinity;
          for (const c of cands) {
            const reversed = c.endIndex === 1;
            const ang = angleBetweenDeg(inDir, leavingDir(c.unit, reversed));
            if (ang < bestAngle - 1e-9) {
              bestAngle = ang;
              pick = c;
            }
          }
        }
        visited.add(pick.unit.index);
        chain.push({ unit: pick.unit, reversed: pick.endIndex === 1 });
      }
      return false;
    };

    for (const u of units) {
      if (visited.has(u.index)) continue;
      visited.add(u.index);
      const chain: ChainLink[] = [{ unit: u, reversed: false }];
      let closed = walk(chain);
      if (!closed) {
        // Extend backwards: flip the chain and keep walking.
        chain.reverse();
        for (const l of chain) l.reversed = !l.reversed;
        closed = walk(chain);
      }
      if (!closed && chain.length >= 2) {
        const exit = unitEnd(chain[chain.length - 1].unit, chain[chain.length - 1].reversed, "exit").point;
        const entry = unitEnd(chain[0].unit, chain[0].reversed, "entry").point;
        if (dist(exit, entry) <= tol) closed = true;
      }
      loops.push(makeLoop(chain, closed));
    }
  }

  // Deterministic order: closed loops by area desc, then open chains by length desc, ties by id.
  loops.sort((a, b) => {
    if (a.closed !== b.closed) return a.closed ? -1 : 1;
    const d = a.closed ? b.areaMm2 - a.areaMm2 : b.perimeterMm - a.perimeterMm;
    if (Math.abs(d) > 1e-9) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (const l of loops) for (const id of l.entityIds) loopIdByEntity.set(id, l.id);

  return {
    loops,
    entities: entities.map((e) => ({ ...e, loopId: loopIdByEntity.get(e.id) ?? null })),
    loopsClosed,
  };
}

/** Segment lengths summed for a subset of entity ids. */
export function lengthOfEntities(entities: GeometryEntity[], ids: Iterable<string>): number {
  const byId = new Map(entities.map((e) => [e.id, e]));
  let total = 0;
  for (const id of ids) {
    const e = byId.get(id);
    if (e) total += e.segments.reduce((acc, s) => acc + segmentLength(s), 0);
  }
  return total;
}
