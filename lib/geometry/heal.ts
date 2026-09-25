/**
 * Geometry engine — healing (snap, dedupe, overlap removal).
 * File path: /lib/geometry/heal.ts
 *
 * Runs on the normalised entity list before chaining:
 * 1. Snap: every free endpoint (line/arc ends, polyline ends) is put in
 *    a grid hash with cell = tolerance; endpoints within `tol` of an
 *    earlier one move onto it. A cluster whose members were more than
 *    1e-6 mm apart counts as one "gap joined" — floating-point noise
 *    (170.9999999999999 vs 171) is not a gap. Arcs keep centre and
 *    radius; their angles are re-derived from the snapped endpoints.
 * 2. Dedupe: entities with the same canonical geometry (direction
 *    independent, 1e-4 mm) are removed, first one wins.
 * 3. Overlaps: a straight LINE fully inside another collinear LINE of
 *    the same layer role is removed. Parallel lines further than `tol`
 *    apart are never touched, partial overlaps are left alone (a later
 *    phase may split them).
 * `loopsClosed` is filled by loops.ts (it needs the chains), the report
 * object is passed through the pipeline for that reason.
 */

import type { ArcSegment, GeometryEntity, HealingReport, Point, Segment } from "./types";
import { angleDeg, ccwSweepDeg, dist, distPointToLine, dot, normalizeDeg, round, sub } from "./math";
import { segmentKey } from "./ids";

export const DEFAULT_TOLERANCE_MM = 0.01;
export const MAX_TOLERANCE_MM = 0.5;
const NOISE_MM = 1e-6;

export type HealResult = { entities: GeometryEntity[]; report: HealingReport };

export function emptyHealingReport(toleranceMm: number): HealingReport {
  return {
    toleranceMm,
    gapsJoined: 0,
    duplicatesRemoved: 0,
    overlapsRemoved: 0,
    zeroLengthRemoved: 0,
    splinesFlattened: 0,
    ellipsesFlattened: 0,
    blocksExploded: 0,
    loopsClosed: 0,
  };
}

export function clampTolerance(tol: number | undefined): number {
  if (tol === undefined || !Number.isFinite(tol) || tol <= 0) return DEFAULT_TOLERANCE_MM;
  return Math.min(tol, MAX_TOLERANCE_MM);
}

/* ─── Endpoint grid ──────────────────────────────────────── */

/** Grid hash of points with cell = tol; `find` looks in the 3×3 neighbourhood. */
export class PointGrid<T> {
  private cells = new Map<string, { p: Point; v: T }[]>();
  constructor(private tol: number) {}

  private key(ix: number, iy: number): string {
    return `${ix},${iy}`;
  }

  private cellOf(p: Point): [number, number] {
    return [Math.floor(p.x / this.tol), Math.floor(p.y / this.tol)];
  }

  add(p: Point, v: T): void {
    const [ix, iy] = this.cellOf(p);
    const k = this.key(ix, iy);
    const list = this.cells.get(k);
    if (list) list.push({ p, v });
    else this.cells.set(k, [{ p, v }]);
  }

  /** Nearest stored point within tol, or null. */
  find(p: Point): { p: Point; v: T } | null {
    const [ix, iy] = this.cellOf(p);
    let best: { p: Point; v: T } | null = null;
    let bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.cells.get(this.key(ix + dx, iy + dy));
        if (!list) continue;
        for (const it of list) {
          const d = dist(it.p, p);
          if (d <= this.tol + 1e-12 && d < bestD) {
            best = it;
            bestD = d;
          }
        }
      }
    }
    return best;
  }

  /** Every stored point within tol. */
  findAll(p: Point): { p: Point; v: T }[] {
    const [ix, iy] = this.cellOf(p);
    const out: { p: Point; v: T }[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.cells.get(this.key(ix + dx, iy + dy));
        if (!list) continue;
        for (const it of list) if (dist(it.p, p) <= this.tol + 1e-12) out.push(it);
      }
    }
    return out;
  }
}

/* ─── Endpoint access ────────────────────────────────────── */

type EndRef = { entity: number; segment: number; end: "start" | "end" };

function setSegmentEnd(seg: Segment, end: "start" | "end", p: Point): Segment {
  if (seg.kind === "circle") return seg;
  if (seg.kind === "line") return end === "start" ? { ...seg, start: { ...p } } : { ...seg, end: { ...p } };
  const arc: ArcSegment = end === "start" ? { ...seg, start: { ...p } } : { ...seg, end: { ...p } };
  const s = angleDeg(arc.center, arc.start);
  const e = angleDeg(arc.center, arc.end);
  const sweep = ccwSweepDeg(s, e);
  // A snapped endpoint must not flip a tiny arc into a near-full circle.
  const safeSweep = Math.abs(sweep - seg.sweepDeg) > 180 ? seg.sweepDeg : sweep;
  return { ...arc, startAngleDeg: normalizeDeg(s), endAngleDeg: normalizeDeg(s + safeSweep), sweepDeg: safeSweep };
}

/**
 * Free endpoints of an entity: the segment ends that no other segment
 * of the same entity shares (interior polyline vertices are excluded).
 */
export function freeEndpoints(entity: GeometryEntity): { point: Point; segment: number; end: "start" | "end" }[] {
  if (entity.closed) return [];
  const ends: { point: Point; segment: number; end: "start" | "end" }[] = [];
  entity.segments.forEach((s, i) => {
    if (s.kind === "circle") return;
    ends.push({ point: s.start, segment: i, end: "start" });
    ends.push({ point: s.end, segment: i, end: "end" });
  });
  if (entity.segments.length === 1) return ends;
  const counts = new Map<string, number>();
  const keyOf = (p: Point) => `${round(p.x, 6)},${round(p.y, 6)}`;
  for (const e of ends) counts.set(keyOf(e.point), (counts.get(keyOf(e.point)) ?? 0) + 1);
  const free = ends.filter((e) => counts.get(keyOf(e.point)) === 1);
  if (free.length === 2) return free;
  // Degenerate multi-segment shape (self touching): fall back to the first/last.
  return [ends[0], ends[ends.length - 1]];
}

/* ─── Steps ──────────────────────────────────────────────── */

function snapEndpoints(entities: GeometryEntity[], tol: number): { entities: GeometryEntity[]; gapsJoined: number } {
  const grid = new PointGrid<{ rep: Point; spread: number }>(tol);
  const clusters: { rep: Point; spread: number }[] = [];
  const out = entities.map((e) => ({ ...e, segments: e.segments.map((s) => ({ ...s })) }));
  const moves: { ref: EndRef; to: Point }[] = [];

  out.forEach((entity, ei) => {
    for (const fe of freeEndpoints(entity)) {
      const hit = grid.find(fe.point);
      if (hit) {
        const d = dist(hit.p, fe.point);
        if (d > hit.v.spread) hit.v.spread = d;
        if (d > 0) moves.push({ ref: { entity: ei, segment: fe.segment, end: fe.end }, to: hit.v.rep });
      } else {
        const c = { rep: { ...fe.point }, spread: 0 };
        clusters.push(c);
        grid.add(fe.point, c);
      }
    }
  });

  for (const m of moves) {
    const e = out[m.ref.entity];
    const seg = e.segments[m.ref.segment];
    const before = m.ref.end === "start" ? (seg as { start: Point }).start : (seg as { end: Point }).end;
    e.segments[m.ref.segment] = setSegmentEnd(seg, m.ref.end, m.to);
    if (dist(before, m.to) > NOISE_MM) e.healed = true;
  }
  const gapsJoined = clusters.filter((c) => c.spread > NOISE_MM).length;
  return { entities: out, gapsJoined };
}

function canonicalKey(e: GeometryEntity): string {
  const keys = e.segments.map((s) => segmentKey(roundSegment(s)));
  keys.sort();
  return keys.join("|");
}

function roundSegment(s: Segment): Segment {
  const r = (v: number) => round(v, 4);
  const rp = (p: Point) => ({ x: r(p.x), y: r(p.y) });
  switch (s.kind) {
    case "line":
      return { kind: "line", start: rp(s.start), end: rp(s.end) };
    case "arc":
      return {
        ...s,
        center: rp(s.center),
        radius: r(s.radius),
        startAngleDeg: r(normalizeDeg(s.startAngleDeg)),
        sweepDeg: r(s.sweepDeg),
      };
    case "circle":
      return { kind: "circle", center: rp(s.center), radius: r(s.radius) };
  }
}

function removeDuplicates(entities: GeometryEntity[]): { entities: GeometryEntity[]; removed: number } {
  const seen = new Set<string>();
  const kept: GeometryEntity[] = [];
  let removed = 0;
  for (const e of entities) {
    const k = `${e.roleFromLayer ?? "-"}|${canonicalKey(e)}`;
    if (seen.has(k)) {
      removed += 1;
      continue;
    }
    seen.add(k);
    kept.push(e);
  }
  return { entities: kept, removed };
}

function isSingleLine(e: GeometryEntity): e is GeometryEntity & { segments: [Extract<Segment, { kind: "line" }>] } {
  return e.segments.length === 1 && e.segments[0].kind === "line";
}

function removeOverlaps(entities: GeometryEntity[], tol: number): { entities: GeometryEntity[]; removed: number } {
  const lines = entities
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => isSingleLine(e))
    .map(({ e, i }) => {
      const s = e.segments[0] as Extract<Segment, { kind: "line" }>;
      return { i, a: s.start, b: s.end, len: dist(s.start, s.end), role: e.roleFromLayer, bbox: e.bbox };
    });
  const drop = new Set<number>();
  for (let x = 0; x < lines.length; x++) {
    const A = lines[x];
    if (drop.has(A.i)) continue;
    for (let y = 0; y < lines.length; y++) {
      if (x === y) continue;
      const B = lines[y];
      if (drop.has(B.i) || A.role !== B.role) continue;
      // B must be the shorter (or equal) one, fully inside A.
      if (B.len > A.len + tol) continue;
      if (B.len === A.len && B.i < A.i) continue;
      if (
        B.bbox.minX < A.bbox.minX - tol ||
        B.bbox.minY < A.bbox.minY - tol ||
        B.bbox.maxX > A.bbox.maxX + tol ||
        B.bbox.maxY > A.bbox.maxY + tol
      )
        continue;
      if (distPointToLine(B.a, A.a, A.b) > tol || distPointToLine(B.b, A.a, A.b) > tol) continue;
      const ab = sub(A.b, A.a);
      const l2 = dot(ab, ab);
      const ta = dot(sub(B.a, A.a), ab) / l2;
      const tb = dot(sub(B.b, A.a), ab) / l2;
      const tolT = tol / Math.sqrt(l2);
      if (ta < -tolT || ta > 1 + tolT || tb < -tolT || tb > 1 + tolT) continue;
      drop.add(B.i);
    }
  }
  return { entities: entities.filter((_, i) => !drop.has(i)), removed: drop.size };
}

/* ─── Entry point ────────────────────────────────────────── */

export function heal(entities: GeometryEntity[], report: HealingReport): HealResult {
  const tol = report.toleranceMm;
  const snapped = snapEndpoints(entities, tol);
  const deduped = removeDuplicates(snapped.entities);
  const overlaps = removeOverlaps(deduped.entities, tol);
  return {
    entities: overlaps.entities,
    report: {
      ...report,
      gapsJoined: report.gapsJoined + snapped.gapsJoined,
      duplicatesRemoved: report.duplicatesRemoved + deduped.removed,
      overlapsRemoved: report.overlapsRemoved + overlaps.removed,
    },
  };
}
