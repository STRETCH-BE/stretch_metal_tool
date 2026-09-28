/**
 * Geometry engine — bend reliefs and slits in a flat pattern.
 * File path: /lib/geometry/step/reliefs.ts
 *
 * At each end of a bend strip the outline either runs straight on (a full
 * width bend), steps aside (a corner relief), or holds a slit: two outline
 * segments that run away from the bend, parallel to the strip's normal,
 * close together, with a short bottom between them. The slit's WIDTH is
 * the distance between those two segments and its DEPTH their length —
 * what the RELIEF_TOO_NARROW rule compares with the laser kerf and the
 * thickness. Search window: RELIEF_SEARCH_FACTOR × t around the strip end
 * (a relief belongs to its bend; a hole further away is a hole).
 */

import type { GeometryEntity, PartGeometry, Point, ReliefInfo, SheetBend } from "../types";

const RELIEF_SEARCH_FACTOR = 6;
const RELIEF_MAX_WIDTH_FACTOR = 3;
const PARALLEL = 0.99;

type Seg = { a: Point; b: Point; entityId: string };

function outlineSegments(geometry: PartGeometry): Seg[] {
  const outer = geometry.loops.find((l) => l.id === geometry.outerLoopId);
  if (!outer) return [];
  const ids = new Set(outer.entityIds);
  const out: Seg[] = [];
  const byId = new Map(geometry.entities.map((e) => [e.id, e] as const));
  for (const id of ids) {
    const e: GeometryEntity | undefined = byId.get(id);
    if (!e) continue;
    for (const s of e.segments) if (s.kind === "line") out.push({ a: s.start, b: s.end, entityId: e.id });
  }
  return out;
}

function unit(a: Point, b: Point): Point {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

/** Distance of point p from the infinite line through a with direction d. */
function offsetFromLine(p: Point, a: Point, d: Point): number {
  return (p.x - a.x) * -d.y + (p.y - a.y) * d.x;
}

export function detectReliefs(geometry: PartGeometry, bends: readonly SheetBend[], thicknessMm: number): ReliefInfo[] {
  const segs = outlineSegments(geometry);
  if (segs.length === 0) return [];
  const window = RELIEF_SEARCH_FACTOR * thicknessMm + 1;
  const out: ReliefInfo[] = [];
  for (const bend of bends) {
    const along = unit(bend.strip.a1, bend.strip.a2);
    const n = unit(bend.strip.a1, bend.strip.t1); // strip normal: from the base flange into the folded flange
    for (const end of ["start", "end"] as const) {
      const corner = end === "start" ? { x: (bend.strip.a1.x + bend.strip.t1.x) / 2, y: (bend.strip.a1.y + bend.strip.t1.y) / 2 } : { x: (bend.strip.a2.x + bend.strip.t2.x) / 2, y: (bend.strip.a2.y + bend.strip.t2.y) / 2 };
      // Outline segments near the strip end that run along the strip normal (away from / into the bend).
      const near = segs.filter((s) => {
        const d = unit(s.a, s.b);
        if (Math.abs(d.x * n.x + d.y * n.y) < PARALLEL) return false;
        const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
        return Math.hypot(mid.x - corner.x, mid.y - corner.y) <= window + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) / 2;
      });
      // Pairs of parallel segments a small distance apart across the bend direction.
      let best: ReliefInfo | null = null;
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const p = near[i];
          const q = near[j];
          const width = Math.abs(offsetFromLine({ x: (q.a.x + q.b.x) / 2, y: (q.a.y + q.b.y) / 2 }, p.a, n));
          if (width <= 1e-6 || width > RELIEF_MAX_WIDTH_FACTOR * thicknessMm) continue;
          // Both segments must overlap in their extent along n.
          const span = (s: Seg) => [Math.min((s.a.x - corner.x) * n.x + (s.a.y - corner.y) * n.y, (s.b.x - corner.x) * n.x + (s.b.y - corner.y) * n.y), Math.max((s.a.x - corner.x) * n.x + (s.a.y - corner.y) * n.y, (s.b.x - corner.x) * n.x + (s.b.y - corner.y) * n.y)] as const;
          const sp = span(p);
          const sq = span(q);
          const overlap = Math.min(sp[1], sq[1]) - Math.max(sp[0], sq[0]);
          if (overlap <= 0.2) continue;
          // The pair must sit beside the strip end along the bend axis (within the window).
          const sideP = ((p.a.x + p.b.x) / 2 - corner.x) * along.x + ((p.a.y + p.b.y) / 2 - corner.y) * along.y;
          if (Math.abs(sideP) > window) continue;
          const depth = overlap;
          const at = { x: (p.a.x + p.b.x + q.a.x + q.b.x) / 4, y: (p.a.y + p.b.y + q.a.y + q.b.y) / 4 };
          const candidate: ReliefInfo = { bendId: bend.id, end, widthMm: Math.round(width * 1000) / 1000, depthMm: Math.round(depth * 1000) / 1000, at, entityIds: [p.entityId, q.entityId] };
          if (!best || candidate.widthMm < best.widthMm) best = candidate;
        }
      }
      if (best) out.push(best);
    }
  }
  return out;
}
