/**
 * Geometry engine — normalisation (raw entities → GeometryEntity list).
 * File path: /lib/geometry/normalise.ts
 *
 * Applies the layer conventions, drops what must never be priced and
 * gives every surviving entity its stable id, length and bbox. Entities
 * on ignored layers (IV_FEATURE_PROFILES_DOWN countersinks, IV_TANGENT,
 * DEFPOINTS, DIM*, …) are removed here and listed in the dropped report
 * with reason `ignored_layer`; a user can still tag anything that
 * survives, but ignored-layer geometry never reaches chaining so it can
 * never become a hole or a bend candidate by accident.
 */

import type { DroppedEntity, GeometryEntity, LayerConventions, Segment } from "./types";
import type { RawEntity } from "./parse";
import { DEFAULT_LAYER_CONVENTIONS, roleForLayer } from "./layer-conventions";
import { assignUniqueIds, entityKey, fnv1a } from "./ids";
import { EPS, bboxUnionAll, segmentBbox, segmentLength } from "./math";

export type NormaliseResult = {
  entities: GeometryEntity[];
  dropped: DroppedEntity[];
  zeroLengthRemoved: number;
};

export const ZERO_LENGTH_MM = 1e-6;

function mergeDropped(into: Map<string, DroppedEntity>, d: DroppedEntity) {
  const key = `${d.type}\u0000${d.layer}\u0000${d.reason}`;
  const cur = into.get(key);
  if (cur) cur.count += d.count;
  else into.set(key, { ...d });
}

/** Build a GeometryEntity (without id) from segments; null when nothing is left. */
export function buildEntity(
  base: Omit<GeometryEntity, "id" | "segments" | "lengthMm" | "bbox" | "loopId" | "role" | "roleFromLayer" | "closed"> & {
    roleFromLayer: GeometryEntity["roleFromLayer"];
    closed: boolean;
  },
  segments: Segment[]
): Omit<GeometryEntity, "id"> | null {
  const kept = segments.filter((s) => segmentLength(s) > ZERO_LENGTH_MM);
  if (kept.length === 0) return null;
  const lengthMm = kept.reduce((acc, s) => acc + segmentLength(s), 0);
  const bbox = bboxUnionAll(kept.map(segmentBbox));
  return {
    ...base,
    segments: kept,
    closed: base.closed,
    lengthMm,
    bbox,
    roleFromLayer: base.roleFromLayer,
    role: base.roleFromLayer ?? "unknown",
    loopId: null,
  };
}

export function normalise(
  raw: RawEntity[],
  previouslyDropped: DroppedEntity[],
  conventions: LayerConventions = DEFAULT_LAYER_CONVENTIONS
): NormaliseResult {
  const dropped = new Map<string, DroppedEntity>();
  for (const d of previouslyDropped) mergeDropped(dropped, d);
  let zeroLengthRemoved = 0;

  const pending: Omit<GeometryEntity, "id">[] = [];
  for (const r of raw) {
    const roleFromLayer = roleForLayer(r.layer, conventions);
    if (roleFromLayer === "ignore") {
      mergeDropped(dropped, { type: r.originalType, layer: r.layer, count: 1, reason: "ignored_layer" });
      continue;
    }
    const built = buildEntity(
      {
        layer: r.layer,
        linetype: r.linetype,
        color: r.color,
        handle: r.handle,
        originalType: r.originalType,
        roleFromLayer,
        closed: r.closed,
      },
      r.segments
    );
    if (!built || built.lengthMm <= ZERO_LENGTH_MM) {
      zeroLengthRemoved += 1;
      mergeDropped(dropped, { type: r.originalType, layer: r.layer, count: 1, reason: "zero_length" });
      continue;
    }
    // Strip undefined optionals so JSON snapshots stay tidy.
    if (built.linetype === undefined) delete built.linetype;
    if (built.color === undefined) delete built.color;
    if (built.handle === undefined) delete built.handle;
    pending.push(built);
  }

  const ids = assignUniqueIds(pending.map((e) => `e${fnv1a(entityKey(e.originalType, e.segments))}`));
  const entities: GeometryEntity[] = pending.map((e, i) => ({ id: ids[i], ...e }));
  const droppedList = [...dropped.values()].sort(
    (a, b) => a.type.localeCompare(b.type) || a.layer.localeCompare(b.layer) || a.reason.localeCompare(b.reason)
  );
  return { entities, dropped: droppedList, zeroLengthRemoved };
}

/** Recompute length/bbox after a coordinate change (annotate scale/mirror). */
export function refreshEntityMetrics(e: GeometryEntity): GeometryEntity {
  const kept = e.segments.filter((s) => segmentLength(s) > EPS);
  return {
    ...e,
    segments: kept,
    lengthMm: kept.reduce((acc, s) => acc + segmentLength(s), 0),
    bbox: bboxUnionAll(kept.map(segmentBbox)),
  };
}
