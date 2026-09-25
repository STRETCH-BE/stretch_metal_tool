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
 * - frame: a top-level axis-aligned rectangle (every vertex on its bbox,
 *   so a rounded plate never qualifies) that is NOT on a named cut layer
 *   (IV_OUTER_PROFILE, CUT, … — layer "0" does not count as named) and
 *   either (a) holds a title block (a child rectangle touching two of
 *   its edges), (b) directly encloses two or more loops that have
 *   children (a nest of parts with holes inside a sheet border), or
 *   (c) encloses a loop with children and shares no layer with its
 *   children (a border on its own layer around a part with holes). A
 *   plain rectangle on layer "0" with a window that holds an island is
 *   therefore a plate, not a frame: cut geometry is never dropped
 *   silently. Frame children are promoted to top level, the frame and
 *   its title block are ignored;
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
import type { Bbox } from "./types";
import { bboxArea, bboxCenter, bboxContains, bboxMaxSide, pointInPolygon, polygonCentroid } from "./math";

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
/** Vertex-on-bbox tolerance for the rectangle test (frames, title blocks). */
const RECT_TOL_MM = 0.01;

/** Up to `n` points spread along a point list. */
export function samplePoints(points: Point[], n = 7): Point[] {
  if (points.length <= n) return points;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) out.push(points[Math.floor((i * points.length) / n)]);
  return out;
}

/**
 * Majority of `inner` sample points inside `outer` polygon (plus bbox
 * check). The samples are the inner vertices nudged 0.1 % towards the
 * inner centroid: a loop touching the outer boundary from inside (a
 * title block in a sheet corner) then reads as inside, one touching from
 * outside (a part nested in a notch) reads as outside.
 */
export function loopContains(outer: Loop, inner: Loop, tol = 1e-6): boolean {
  if (outer.id === inner.id) return false;
  if (!bboxContains(outer.bbox, inner.bbox, tol + 1e-6)) return false;
  if (outer.points.length < 3) return false;
  const raw = samplePoints(inner.points);
  if (raw.length === 0) return false;
  let c = inner.points.length >= 3 ? polygonCentroid(inner.points) : bboxCenter(inner.bbox);
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) c = bboxCenter(inner.bbox);
  const samples = raw.map((p) => ({ x: p.x + (c.x - p.x) * 1e-3, y: p.y + (c.y - p.y) * 1e-3 }));
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

/** Closed loop whose area fills its bbox and whose every vertex lies on the bbox boundary. */
export function isAxisAlignedRectangle(loop: Loop, tol = RECT_TOL_MM): boolean {
  if (!loop.closed || loop.points.length < 4) return false;
  const a = bboxArea(loop.bbox);
  if (a <= 0) return false;
  if (Math.abs(loop.areaMm2 - a) / a > 1e-3) return false;
  const b = loop.bbox;
  return loop.points.every(
    (p) => Math.abs(p.x - b.minX) <= tol || Math.abs(p.x - b.maxX) <= tol || Math.abs(p.y - b.minY) <= tol || Math.abs(p.y - b.maxY) <= tol
  );
}

/** How many edges of `outer` the box `inner` lies on (a title block touches ≥ 2). */
function edgesTouched(inner: Bbox, outer: Bbox, tol = RECT_TOL_MM): number {
  let n = 0;
  if (Math.abs(inner.minX - outer.minX) <= tol) n += 1;
  if (Math.abs(inner.maxX - outer.maxX) <= tol) n += 1;
  if (Math.abs(inner.minY - outer.minY) <= tol) n += 1;
  if (Math.abs(inner.maxY - outer.maxY) <= tol) n += 1;
  return n;
}

/** Entity on an explicitly named cut layer (layer "0" is the default, not a name). */
function onNamedCutLayer(e: GeometryEntity): boolean {
  return e.roleFromLayer === "cut" && e.layer.trim() !== "0";
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

  // Frames (see the header): never a loop on a named cut layer.
  const frames = new Set<string>();
  const layersOf = (l: Loop) => new Set(loopEntities(l).map((e) => e.layer.trim().toUpperCase()));
  for (const l of closedGeo) {
    if (parent.get(l.id)) continue;
    if (!isAxisAlignedRectangle(l)) continue;
    const ents = loopEntities(l);
    if (ents.some(onNamedCutLayer)) continue;
    const kids = children.get(l.id) ?? [];
    const titleBlocks = kids.filter((k) => isAxisAlignedRectangle(k) && edgesTouched(k.bbox, l.bbox) >= 2);
    const kidsWithKids = kids.filter((k) => depthBelow(k.id) >= 1);
    const own = layersOf(l);
    const sharesLayer = kids.some((k) => [...layersOf(k)].some((x) => own.has(x)));
    const isFrame = titleBlocks.length > 0 || kidsWithKids.length >= 2 || (kidsWithKids.length >= 1 && !sharesLayer);
    if (!isFrame) continue;
    frames.add(l.id);
    for (const t of titleBlocks) frames.add(t.id);
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
