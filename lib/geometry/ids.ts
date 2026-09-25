/**
 * Geometry engine — stable entity and loop ids.
 * File path: /lib/geometry/ids.ts
 *
 * Ids are a 32-bit FNV-1a hash (hex) of the entity type plus its
 * geometry rounded to 0.001 mm, NOT the DXF handle: re-uploading the same
 * drawing (even re-exported with new handles) yields the same ids, so
 * stored annotations re-attach. FNV-1a is implemented inline because the
 * engine must run in the browser (no Node crypto) and be deterministic.
 * Duplicate keys (two identical entities, before healing removes them)
 * get a "-2", "-3", … suffix in encounter order.
 */

import type { Segment } from "./types";
import { round } from "./math";

/** 32-bit FNV-1a over the UTF-16 code units of `s`, as 8 hex chars. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit multiply by the FNV prime 16777619 without overflow.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function fmt(v: number): string {
  return String(round(v, 3));
}

/** Canonical, direction-independent text of a segment. */
export function segmentKey(seg: Segment): string {
  switch (seg.kind) {
    case "line": {
      const a = `${fmt(seg.start.x)},${fmt(seg.start.y)}`;
      const b = `${fmt(seg.end.x)},${fmt(seg.end.y)}`;
      return a <= b ? `L${a};${b}` : `L${b};${a}`;
    }
    case "arc":
      return `A${fmt(seg.center.x)},${fmt(seg.center.y)},${fmt(seg.radius)},${fmt(seg.startAngleDeg)},${fmt(seg.sweepDeg)}`;
    case "circle":
      return `C${fmt(seg.center.x)},${fmt(seg.center.y)},${fmt(seg.radius)}`;
  }
}

/** Text the entity id is hashed from: type + sorted segment keys. */
export function entityKey(type: string, segments: Segment[]): string {
  const keys = segments.map(segmentKey);
  if (keys.length > 1) keys.sort();
  return `${type}|${keys.join("|")}`;
}

export function entityId(type: string, segments: Segment[]): string {
  return `e${fnv1a(entityKey(type, segments))}`;
}

/** Assign unique ids to a list in order, suffixing collisions. */
export function assignUniqueIds(keys: string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n === 1 ? k : `${k}-${n}`;
  });
}

export function loopIdFor(entityIds: string[]): string {
  return `l${fnv1a(entityIds.join(","))}`;
}
