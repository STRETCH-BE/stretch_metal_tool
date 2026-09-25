/**
 * Geometry engine — chaining entities into closed loops and open chains.
 * File path: /lib/geometry/loops.ts
 *
 * Every entity is a "unit" with two free endpoints (or none when it is
 * closed: CIRCLE, closed polyline, a single segment whose two ends
 * coincide). Units are chained through a grid hash of endpoints (cell =
 * tolerance) in three passes per chain class:
 * 1. leaf peeling — a unit with an end nothing else touches can never
 *    lie on a closed loop (an AutoCAD overshoot past a corner, a bend
 *    candidate, a dangling tail); peeling repeats until no leaf is left;
 * 2. loop search — from every remaining unit a depth-first walk tries the
 *    continuations at each branch in order of smallest turning angle and
 *    BACKTRACKS when a path dead-ends, so a stray line through a corner
 *    can no longer swallow the outline. A loop closes as soon as the
 *    exit meets the entry of any earlier link; the links before that
 *    link (a bridge between two parts) are released and retried. A walk
 *    that exhausts without closing proves its component acyclic, so
 *    everything it explored is deferred. A global step budget
 *    (`DFS_BUDGET_BASE + DFS_BUDGET_PER_UNIT × units`) bounds pathological
 *    files; once spent, pass 3 takes over for what is left;
 * 3. greedy open chains — leftovers are walked forward and backward
 *    with the smallest-turn rule without backtracking (the pre-review
 *    behaviour), which is all an open chain needs.
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

/* ─── Chaining ───────────────────────────────────────────── */

type Cand = { unit: Unit; endIndex: 0 | 1 };
type Chain = { links: ChainLink[]; closed: boolean };

/** Steps the loop search may spend per chain class before the greedy walk takes over. */
export const DFS_BUDGET_BASE = 20_000;
export const DFS_BUDGET_PER_UNIT = 200;

function entryPoint(link: ChainLink): Point {
  return unitEnd(link.unit, link.reversed, "entry").point;
}

function exitPoint(link: ChainLink): Point {
  return unitEnd(link.unit, link.reversed, "exit").point;
}

/** Continuations at `exit`, smallest turning angle first (ties by unit index). */
function continuations(grid: PointGrid<Cand>, exit: Point, inDir: Point, excluded: (u: Unit) => boolean): Cand[] {
  const cands = grid
    .findAll(exit)
    .map((c) => c.v)
    .filter((c) => !excluded(c.unit));
  if (cands.length <= 1) return cands;
  return cands
    .map((c) => ({ c, ang: angleBetweenDeg(inDir, leavingDir(c.unit, c.endIndex === 1)) }))
    .sort((a, b) => (Math.abs(a.ang - b.ang) > 1e-9 ? a.ang - b.ang : a.c.unit.index - b.c.unit.index))
    .map((x) => x.c);
}

/**
 * Chains open units into closed loops and open chains (see the header
 * for the three passes). Deterministic: unit order and turning angles
 * decide every choice.
 */
function chainUnits(units: Unit[], tol: number): Chain[] {
  const out: Chain[] = [];
  if (units.length === 0) return out;

  const grid = new PointGrid<Cand>(tol);
  for (const u of units) {
    grid.add(u.ends[0].point, { unit: u, endIndex: 0 });
    grid.add(u.ends[1].point, { unit: u, endIndex: 1 });
  }

  // 1. Leaf peeling: a unit end that touches no other unit can never close.
  const adj: Cand[][][] = units.map((u) =>
    u.ends.map((end) =>
      grid
        .findAll(end.point)
        .map((c) => c.v)
        .filter((c) => c.unit.index !== u.index)
    )
  );
  const live = adj.map((ends) => ends.map((list) => list.length));
  const leaf = new Set<number>();
  const queue: number[] = [];
  for (const u of units) {
    if (live[u.index][0] === 0 || live[u.index][1] === 0) {
      leaf.add(u.index);
      queue.push(u.index);
    }
  }
  while (queue.length > 0) {
    const ui = queue.pop() as number;
    for (const endList of adj[ui]) {
      for (const c of endList) {
        if (leaf.has(c.unit.index)) continue;
        live[c.unit.index][c.endIndex] -= 1;
        if (live[c.unit.index][c.endIndex] === 0) {
          leaf.add(c.unit.index);
          queue.push(c.unit.index);
        }
      }
    }
  }

  // 2. Loop search with backtracking.
  const visited = new Set<number>(); // members of emitted loops
  const deferred = new Set<number>(); // proven acyclic (or out of budget): open chains
  let budget = DFS_BUDGET_BASE + DFS_BUDGET_PER_UNIT * units.length;

  const findLoop = (start: Unit): { loop: ChainLink[]; released: ChainLink[] } | { explored: Set<number> } | "budget" => {
    const chain: ChainLink[] = [{ unit: start, reversed: false }];
    const onPath = new Set<number>([start.index]);
    const explored = new Set<number>([start.index]);
    const entries = new PointGrid<number>(tol);
    entries.add(entryPoint(chain[0]), 0);
    const excluded = (u: Unit) => leaf.has(u.index) || visited.has(u.index) || deferred.has(u.index) || onPath.has(u.index);
    const stack: { cands: Cand[]; next: number }[] = [
      { cands: continuations(grid, exitPoint(chain[0]), arrivingDir(chain[0]), excluded), next: 0 },
    ];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.next < top.cands.length) {
        if (budget <= 0) return "budget";
        budget -= 1;
        const c = top.cands[top.next++];
        const link: ChainLink = { unit: c.unit, reversed: c.endIndex === 1 };
        chain.push(link);
        onPath.add(c.unit.index);
        explored.add(c.unit.index);
        const exit = exitPoint(link);
        // Closed when the exit meets the entry of an earlier link (the most
        // recent one gives the tightest loop; links before it are released).
        let k = -1;
        for (const hit of entries.findAll(exit)) if (hit.v <= chain.length - 2 && hit.v > k) k = hit.v;
        if (k >= 0) return { loop: chain.slice(k), released: chain.slice(0, k) };
        entries.add(entryPoint(link), chain.length - 1);
        stack.push({ cands: continuations(grid, exit, arrivingDir(link), excluded), next: 0 });
      } else {
        stack.pop();
        if (stack.length === 0) break;
        const link = chain.pop() as ChainLink;
        onPath.delete(link.unit.index);
        entries.remove(entryPoint(link), chain.length);
      }
    }
    return { explored };
  };

  let i = 0;
  while (i < units.length) {
    const u = units[i];
    if (leaf.has(u.index) || visited.has(u.index) || deferred.has(u.index)) {
      i += 1;
      continue;
    }
    const r = findLoop(u);
    if (r === "budget") {
      deferred.add(u.index);
      i += 1;
      continue;
    }
    if ("explored" in r) {
      for (const x of r.explored) deferred.add(x);
      i += 1;
      continue;
    }
    for (const l of r.loop) visited.add(l.unit.index);
    out.push({ links: r.loop, closed: true });
    // A released prefix (bridge) stays unvisited; retry the same start when it was released.
    if (!visited.has(u.index)) continue;
    i += 1;
  }

  // 3. Greedy open chains for whatever is left (leaves, deferred, budget fallbacks).
  const walk = (chain: ChainLink[]): boolean => {
    let guard = units.length + 1;
    while (guard-- > 0) {
      const last = chain[chain.length - 1];
      const exit = exitPoint(last);
      if (chain.length >= 2 && dist(exit, entryPoint(chain[0])) <= tol) return true;
      const cands = continuations(grid, exit, arrivingDir(last), (x) => visited.has(x.index));
      if (cands.length === 0) return false;
      const pick = cands[0];
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
    if (!closed && chain.length >= 2 && dist(exitPoint(chain[chain.length - 1]), entryPoint(chain[0])) <= tol) closed = true;
    out.push({ links: chain, closed });
  }
  return out;
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
      if (dist(ends[0].point, ends[1].point) <= tol) {
        // Ends within tolerance: an unflagged polyline back at its start, or a
        // single arc healed shut (a 359.99° arc). A zero-length LINE never gets here.
        loopsClosed += 1;
        loops.push(makeLoop([{ unit: { index: -1, entity: e, ends, closed: true }, reversed: false }], true));
        continue;
      }
      units.push({ index: units.length, entity: e, ends: [ends[0], ends[1]], closed: false });
    }
    for (const chain of chainUnits(units, tol)) loops.push(makeLoop(chain.links, chain.closed));
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
