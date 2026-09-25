/**
 * Geometry engine — loop classification and part grouping.
 * File path: /lib/geometry/classify.ts
 *
 * Order of authority: user role overrides > layer conventions > geometry.
 * A closed loop on a WELD layer is a weld seam, never a hole.
 *
 * Geometry rules (closed loops sorted by area, largest first):
 * - containment tree: a loop's parent is the smallest larger loop that
 *   contains it (bbox test + majority of sampled points inside);
 * - frame: a top-level axis-aligned rectangle that encloses a loop which
 *   itself has children (a part with holes drawn inside a border). Its
 *   children are promoted to top level and the frame is ignored;
 * - every remaining top-level loop starts a part group (partIndex by
 *   area, 0 = largest = `outerLoopId`); its descendants are holes;
 * - open chains inside a part are bend/engrave/weld candidates: role
 *   from a bend/weld/engrave layer or a user tag, otherwise "unknown"
 *   (the amber question) — even on a cut layer or layer "0". Open
 *   chains outside every part are noise and ignored;
 * - closed loops smaller than 0.5 mm are noise (dust, not features).
 * Loops made only of bend/weld/engrave-role entities keep those roles;
 * their loop kind is "open_chain" (open) or "noise" (closed) with the
 * partIndex of the part they lie in.
 */

import type { EntityRole, GeometryEntity, Loop, Point } from "./types";
import { bboxArea, bboxContains, bboxMaxSide, pointInPolygon } from "./math";

export type ClassifyOptions = {
  /** Per-entity role overrides from annotations (highest authority). */
  roleOverrides?: Record<string, EntityRole>;
};

export type ClassifyResult = {
  entities: GeometryEntity[];
  loops: Loop[];
  outerLoopId: string | null;
  partCount: number;
};

const MARKING_ROLES = new Set<EntityRole>(["bend_up", "bend_down", "weld", "engrave"]);
const NOISE_MAX_SIDE_MM = 0.5;

/** Up to `n` points spread along a point list. */
export function samplePoints(points: Point[], n = 7): Point[] {
  if (points.length <= n) return points;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) out.push(points[Math.floor((i * points.length) / n)]);
  return out;
}

/** Majority of `inner` sample points inside `outer` polygon (plus bbox check). */
export function loopContains(outer: Loop, inner: Loop, tol = 1e-6): boolean {
  if (outer.id === inner.id) return false;
  if (!bboxContains(outer.bbox, inner.bbox, tol + 1e-6)) return false;
  if (outer.points.length < 3) return false;
  const samples = samplePoints(inner.points);
  if (samples.length === 0) return false;
  let inside = 0;
  for (const p of samples) if (pointInPolygon(p, outer.points)) inside += 1;
  return inside * 2 > samples.length;
}

/** Interior points of an open chain (endpoints often sit on the outline). */
function chainInteriorSamples(loop: Loop): Point[] {
  const pts = loop.points;
  if (pts.length < 2) return pts;
  const out: Point[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    out.push({ x: a.x + (b.x - a.x) * 0.25, y: a.y + (b.y - a.y) * 0.25 });
    out.push({ x: a.x + (b.x - a.x) * 0.75, y: a.y + (b.y - a.y) * 0.75 });
  }
  return samplePoints(out, 9);
}

function chainInside(outer: Loop, chain: Loop): boolean {
  if (outer.points.length < 3) return false;
  const samples = chainInteriorSamples(chain);
  if (samples.length === 0) return false;
  let inside = 0;
  for (const p of samples) if (pointInPolygon(p, outer.points)) inside += 1;
  return inside * 2 > samples.length;
}

function isAxisAlignedRectangle(loop: Loop): boolean {
  if (loop.points.length < 4) return false;
  const a = bboxArea(loop.bbox);
  if (a <= 0) return false;
  return Math.abs(loop.areaMm2 - a) / a < 0.005;
}

export function classify(
  entities: GeometryEntity[],
  loops: Loop[],
  options: ClassifyOptions = {}
): ClassifyResult {
  const overrides = options.roleOverrides ?? {};
  const byId = new Map(entities.map((e) => [e.id, e]));

  const forcedRole = (e: GeometryEntity): EntityRole | null => {
    const o = overrides[e.id];
    if (o) return o;
    if (e.roleFromLayer && MARKING_ROLES.has(e.roleFromLayer)) return e.roleFromLayer;
    return null;
  };
  const loopEntities = (l: Loop) => l.entityIds.map((id) => byId.get(id)).filter((e): e is GeometryEntity => !!e);
  const isMarkingLoop = (l: Loop) => {
    const ents = loopEntities(l);
    return ents.length > 0 && ents.every((e) => {
      const f = forcedRole(e);
      return f !== null && MARKING_ROLES.has(f);
    });
  };

  const roles = new Map<string, EntityRole>();
  const kinds = new Map<string, Loop["kind"]>();
  const partOf = new Map<string, number>();

  const marking: Loop[] = [];
  const closedGeo: Loop[] = [];
  const openGeo: Loop[] = [];
  for (const l of loops) {
    if (isMarkingLoop(l)) marking.push(l);
    else if (l.closed) {
      if (bboxMaxSide(l.bbox) < NOISE_MAX_SIDE_MM) {
        kinds.set(l.id, "noise");
        partOf.set(l.id, -1);
      } else closedGeo.push(l);
    } else openGeo.push(l);
  }

  // Containment tree over closed geometric loops (sorted by area desc).
  closedGeo.sort((a, b) => b.areaMm2 - a.areaMm2 || (a.id < b.id ? -1 : 1));
  const parent = new Map<string, string | null>();
  for (let i = 0; i < closedGeo.length; i++) {
    let p: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (closedGeo[j].areaMm2 < closedGeo[i].areaMm2) continue;
      if (loopContains(closedGeo[j], closedGeo[i])) {
        p = closedGeo[j].id;
        break;
      }
    }
    parent.set(closedGeo[i].id, p);
  }
  const children = new Map<string, Loop[]>();
  for (const l of closedGeo) {
    const p = parent.get(l.id) ?? null;
    if (p) {
      const list = children.get(p);
      if (list) list.push(l);
      else children.set(p, [l]);
    }
  }
  const depthBelow = (id: string): number => {
    const kids = children.get(id) ?? [];
    let d = 0;
    for (const k of kids) d = Math.max(d, 1 + depthBelow(k.id));
    return d;
  };

  // Frames: top-level rectangles enclosing a part that has holes.
  const frames = new Set<string>();
  for (const l of closedGeo) {
    if (parent.get(l.id)) continue;
    if (!isAxisAlignedRectangle(l)) continue;
    if (depthBelow(l.id) >= 2) frames.add(l.id);
  }
  for (const l of closedGeo) {
    const p = parent.get(l.id);
    if (p && frames.has(p)) parent.set(l.id, null);
  }

  // Part groups.
  const roots = closedGeo.filter((l) => !frames.has(l.id) && parent.get(l.id) === null);
  roots.sort((a, b) => b.areaMm2 - a.areaMm2 || (a.id < b.id ? -1 : 1));
  const rootIndex = new Map<string, number>();
  roots.forEach((r, i) => rootIndex.set(r.id, i));
  const rootOf = (id: string): string => {
    let cur = id;
    let guard = closedGeo.length + 1;
    while (guard-- > 0) {
      const p = parent.get(cur);
      if (!p) return cur;
      cur = p;
    }
    return cur;
  };

  for (const l of closedGeo) {
    if (frames.has(l.id)) {
      kinds.set(l.id, "frame");
      partOf.set(l.id, -1);
      for (const e of loopEntities(l)) roles.set(e.id, forcedRole(e) ?? "ignore");
      continue;
    }
    const root = rootOf(l.id);
    const idx = rootIndex.get(root) ?? -1;
    partOf.set(l.id, idx);
    if (root === l.id) {
      kinds.set(l.id, idx === 0 ? "outer" : "other_part");
      for (const e of loopEntities(l)) roles.set(e.id, forcedRole(e) ?? "cut");
    } else {
      kinds.set(l.id, "hole");
      for (const e of loopEntities(l)) roles.set(e.id, forcedRole(e) ?? "hole");
    }
  }

  const partContaining = (l: Loop): number => {
    for (const r of roots) if (chainInside(r, l)) return rootIndex.get(r.id) ?? -1;
    return -1;
  };

  for (const l of openGeo) {
    const idx = partContaining(l);
    partOf.set(l.id, idx);
    kinds.set(l.id, idx >= 0 ? "open_chain" : "noise");
    for (const e of loopEntities(l)) {
      // An open chain on a cut layer (incl. layer "0") is still a candidate:
      // hand-made files put everything on "0", and an unclosed interior line
      // is never silently priced.
      const f = forcedRole(e);
      if (f) roles.set(e.id, f);
      else roles.set(e.id, idx >= 0 ? "unknown" : "ignore");
    }
  }

  for (const l of marking) {
    const idx = l.closed
      ? roots.findIndex((r) => loopContains(r, l))
      : partContaining(l);
    partOf.set(l.id, idx);
    kinds.set(l.id, l.closed ? "noise" : "open_chain");
    for (const e of loopEntities(l)) roles.set(e.id, forcedRole(e) ?? "ignore");
  }

  const outLoops: Loop[] = loops.map((l) => ({
    ...l,
    kind: kinds.get(l.id) ?? (l.closed ? "noise" : "open_chain"),
    partIndex: partOf.get(l.id) ?? -1,
  }));
  const outEntities: GeometryEntity[] = entities.map((e) => {
    const forced = overrides[e.id];
    const role = roles.get(e.id) ?? forced ?? (e.role === "ignore" ? "ignore" : (forcedRole(e) ?? "ignore"));
    return { ...e, role };
  });

  return {
    entities: outEntities,
    loops: outLoops,
    outerLoopId: roots.length > 0 ? roots[0].id : null,
    partCount: roots.length,
  };
}
