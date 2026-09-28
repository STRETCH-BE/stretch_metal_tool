/**
 * Geometry engine — the proposed fix for a bend relief that is too narrow:
 * widen the slit to the sheet thickness and deepen it to the bend tangent
 * line plus one thickness, on the flat pattern's entities.
 * File path: /lib/geometry/step/relief-fix.ts
 *
 * A relief (reliefs.ts) is two parallel outline segments (the slit walls)
 * with a short bottom between their inner ends and the outline continuing
 * from their outer ends (the mouth). The fix widens the slit to the
 * thickness — taking the material from the tab side when the other wall
 * continues straight into a flange edge (the M040400 case), from both
 * sides for a slit in the middle of an edge — moves the bottom with the
 * walls, pushes it (and the walls' inner ends) to the target depth
 * measured from the mouth, and shortens the mouth neighbours so the
 * outline stays closed. Nothing else moves. The
 * caller re-chains the entities (annotate.ts) and re-detects the reliefs,
 * so the RELIEF_TOO_NARROW rule sees the widened slit. Applied only when
 * `annotations.reliefFix` is set — that flag is written by the override
 * approval (lib/parts/relief-fix.ts), never by the engine on its own.
 */

import type { GeometryEntity, Point, ReliefInfo, SheetBend } from "../types";
import { dist } from "../math";
import { refreshEntityMetrics } from "../normalise";

const TOUCH_MM = 1e-3;

type Wall = { entity: GeometryEntity; a: Point; b: Point };

function lineOf(e: GeometryEntity): { a: Point; b: Point } | null {
  const s = e.segments[0];
  return e.segments.length === 1 && s.kind === "line" ? { a: s.start, b: s.end } : null;
}

function unit(a: Point, b: Point): Point {
  const l = dist(a, b) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

/** Moves one endpoint of a single-line entity (whichever touches `from`) to `to`. */
function moveEndpoint(e: GeometryEntity, from: Point, to: Point): GeometryEntity {
  const s = e.segments[0];
  if (s.kind !== "line") return e;
  if (dist(s.start, from) <= TOUCH_MM) return refreshEntityMetrics({ ...e, segments: [{ kind: "line", start: { ...to }, end: s.end }] });
  if (dist(s.end, from) <= TOUCH_MM) return refreshEntityMetrics({ ...e, segments: [{ kind: "line", start: s.start, end: { ...to } }] });
  return e;
}

/** Proposed depth: to the bend tangent line plus one thickness, at least the current depth + t. */
export function proposedReliefDepthMm(relief: ReliefInfo, bend: SheetBend | undefined, thicknessMm: number): number {
  const toTangent = bend ? bend.allowanceMm : relief.depthMm;
  return Math.max(relief.depthMm, toTangent) + thicknessMm;
}

/**
 * Applies the fix for every relief narrower than `minWidthMm` and returns
 * the new entity list (unchanged entities are the same objects). Entities
 * are single-segment lines from the unfold, so the edit is exact.
 */
export function applyReliefFix(entities: GeometryEntity[], reliefs: readonly ReliefInfo[], bends: readonly SheetBend[], thicknessMm: number, minWidthMm = thicknessMm): GeometryEntity[] {
  let out = entities.slice();
  const byId = () => new Map(out.map((e) => [e.id, e] as const));
  for (const relief of reliefs) {
    if (relief.widthMm >= minWidthMm - 1e-9) continue;
    const map = byId();
    const wallEntities = relief.entityIds.map((id) => map.get(id)).filter((e): e is GeometryEntity => Boolean(e));
    if (wallEntities.length !== 2) continue;
    const walls: Wall[] = [];
    for (const e of wallEntities) {
      const l = lineOf(e);
      if (!l) break;
      walls.push({ entity: e, ...l });
    }
    if (walls.length !== 2) continue;
    const bend = bends.find((b) => b.id === relief.bendId);
    // Cross direction: from wall 0 towards wall 1.
    const mid1 = { x: (walls[1].a.x + walls[1].b.x) / 2, y: (walls[1].a.y + walls[1].b.y) / 2 };
    const mid0 = { x: (walls[0].a.x + walls[0].b.x) / 2, y: (walls[0].a.y + walls[0].b.y) / 2 };
    let cross = { x: mid1.x - mid0.x, y: mid1.y - mid0.y };
    const cl = Math.hypot(cross.x, cross.y) || 1;
    cross = { x: cross.x / cl, y: cross.y / cl };
    const widen = (thicknessMm - relief.widthMm) / 2;
    // Bottom: the entity touching the inner ends of both walls; mouth neighbours: entities touching the outer ends.
    const ends = (w: Wall) => [w.a, w.b];
    const touching = (p: Point, except: Set<string>) => out.filter((e) => !except.has(e.id) && e.segments.some((s) => s.kind === "line" && (dist(s.start, p) <= TOUCH_MM || dist(s.end, p) <= TOUCH_MM)));
    const wallIds = new Set(walls.map((w) => w.entity.id));
    let bottom: GeometryEntity | null = null;
    let innerEnds: [Point, Point] | null = null;
    for (const p0 of ends(walls[0])) {
      for (const p1 of ends(walls[1])) {
        const shared = touching(p0, wallIds).filter((e) => touching(p1, wallIds).includes(e));
        if (shared.length === 1) {
          bottom = shared[0];
          innerEnds = [p0, p1];
        }
      }
    }
    if (!bottom || !innerEnds) continue;
    const outerEnds: [Point, Point] = [ends(walls[0]).find((p) => p !== innerEnds![0]) as Point, ends(walls[1]).find((p) => p !== innerEnds![1]) as Point];
    // Depth direction: from the mouth (outer ends) towards the bottom (inner ends).
    const depthDir = unit(outerEnds[0], innerEnds[0]);
    const targetDepth = proposedReliefDepthMm(relief, bend, thicknessMm);
    const extra = Math.max(0, targetDepth - relief.depthMm);
    // Which wall may move: a wall whose mouth neighbour continues it in a
    // straight line is a flange edge (the slit lies beside a flange) — it
    // stays, the other wall (the tab side) gives the whole missing width.
    // Two free walls (a slit in the middle of an edge) share it.
    const collinear = (w: Wall, outer: Point): boolean =>
      touching(outer, new Set([...wallIds, bottom!.id])).some((e) => {
        const l = lineOf(e);
        if (!l) return false;
        const d = unit(l.a, l.b);
        return Math.abs(d.x * depthDir.x + d.y * depthDir.y) > 0.9999;
      });
    const fixed0 = collinear(walls[0], outerEnds[0]);
    const fixed1 = collinear(walls[1], outerEnds[1]);
    const move0 = fixed0 && !fixed1 ? 0 : fixed1 && !fixed0 ? 2 * widen : widen;
    const move1 = fixed1 && !fixed0 ? 0 : fixed0 && !fixed1 ? 2 * widen : widen;
    const shift = (p: Point, move: number, sign: number, deeper: number): Point => ({ x: p.x + sign * move * cross.x + deeper * depthDir.x, y: p.y + sign * move * cross.y + deeper * depthDir.y });
    const newOuter: [Point, Point] = [shift(outerEnds[0], move0, -1, 0), shift(outerEnds[1], move1, 1, 0)];
    const newInner: [Point, Point] = [shift(innerEnds[0], move0, -1, extra), shift(innerEnds[1], move1, 1, extra)];
    const replaced = new Map<string, GeometryEntity>();
    walls.forEach((w, i) => {
      replaced.set(w.entity.id, refreshEntityMetrics({ ...w.entity, segments: [{ kind: "line", start: newOuter[i], end: newInner[i] }] }));
    });
    let newBottom = moveEndpoint(bottom, innerEnds[0], newInner[0]);
    newBottom = moveEndpoint(newBottom, innerEnds[1], newInner[1]);
    replaced.set(bottom.id, newBottom);
    // Mouth neighbours: the outline segments touching the outer ends (other than the walls).
    for (let i = 0; i < 2; i++) {
      for (const neighbour of touching(outerEnds[i], new Set([...wallIds, bottom.id]))) {
        replaced.set(neighbour.id, moveEndpoint(replaced.get(neighbour.id) ?? neighbour, outerEnds[i], newOuter[i]));
      }
    }
    out = out.map((e) => replaced.get(e.id) ?? e);
  }
  return out;
}
