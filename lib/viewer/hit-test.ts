/**
 * Viewer — entity hit-testing in screen space. Pure, no React.
 * File path: /lib/viewer/hit-test.ts
 *
 * Distances are measured in world mm with the geometry maths
 * (line / arc / circle exact), then converted to px with the view scale
 * so the tolerance is a constant 6 px at every zoom. Every test runs a
 * coarse prefilter on the entity bbox (expanded by the tolerance) before
 * touching segments, so a 2000-entity file costs ~2000 rectangle checks
 * per hover and only a handful of real distance computations.
 * Lasso selection uses the fully-inside rule on the entity bbox.
 */

import type { Bbox, GeometryEntity, Point } from "@/lib/geometry/types";
import { bboxContains, distPointToSegmentAny, makeBbox } from "@/lib/geometry/math";
import { screenToWorld, type ScreenRect, type ViewTransform } from "./view-transform";

export const HIT_TOLERANCE_PX = 6;

export type EntityHit = { entity: GeometryEntity; distancePx: number };
export type EntityFilter = (entity: GeometryEntity) => boolean;

function bboxHolds(b: Bbox, p: Point, tolMm: number): boolean {
  return p.x >= b.minX - tolMm && p.x <= b.maxX + tolMm && p.y >= b.minY - tolMm && p.y <= b.maxY + tolMm;
}

/** Minimum distance (mm) from a world point to any segment of the entity. */
export function distanceToEntityMm(p: Point, entity: GeometryEntity): number {
  let best = Infinity;
  for (const seg of entity.segments) {
    const d = distPointToSegmentAny(p, seg);
    if (d < best) best = d;
  }
  return best;
}

/** Distance in px from a screen point to the entity, Infinity when the bbox prefilter rejects it. */
export function entityHitDistancePx(entity: GeometryEntity, screenPoint: Point, vt: ViewTransform, tolerancePx = HIT_TOLERANCE_PX): number {
  const world = screenToWorld(vt, screenPoint);
  const tolMm = tolerancePx / vt.scale;
  if (!bboxHolds(entity.bbox, world, tolMm)) return Infinity;
  return distanceToEntityMm(world, entity) * vt.scale;
}

/** Nearest entity within `tolerancePx` of the screen point, or null. */
export function nearestEntity(
  entities: readonly GeometryEntity[],
  screenPoint: Point,
  vt: ViewTransform,
  tolerancePx = HIT_TOLERANCE_PX,
  filter?: EntityFilter
): EntityHit | null {
  const world = screenToWorld(vt, screenPoint);
  const tolMm = tolerancePx / vt.scale;
  let best: EntityHit | null = null;
  for (const entity of entities) {
    if (filter && !filter(entity)) continue;
    if (!bboxHolds(entity.bbox, world, tolMm)) continue;
    const dPx = distanceToEntityMm(world, entity) * vt.scale;
    if (dPx <= tolerancePx && (best === null || dPx < best.distancePx)) best = { entity, distancePx: dPx };
  }
  return best;
}

/** World bbox covered by a screen rectangle. */
export function rectToWorldBbox(rect: ScreenRect, vt: ViewTransform): Bbox {
  const a = screenToWorld(vt, { x: rect.x, y: rect.y });
  const b = screenToWorld(vt, { x: rect.x + rect.width, y: rect.y + rect.height });
  return makeBbox(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
}

/** Ids of the entities whose bbox lies fully inside the lasso rectangle. */
export function entitiesInRect(
  entities: readonly GeometryEntity[],
  rect: ScreenRect,
  vt: ViewTransform,
  filter?: EntityFilter
): string[] {
  const box = rectToWorldBbox(rect, vt);
  const out: string[] = [];
  for (const entity of entities) {
    if (filter && !filter(entity)) continue;
    if (bboxContains(box, entity.bbox, 1e-6)) out.push(entity.id);
  }
  return out;
}

/** Total length of the given entity ids (mm). */
export function selectionLengthMm(entities: readonly GeometryEntity[], ids: ReadonlySet<string>): number {
  let l = 0;
  for (const e of entities) if (ids.has(e.id)) l += e.lengthMm;
  return l;
}
