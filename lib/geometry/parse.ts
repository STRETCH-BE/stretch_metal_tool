/**
 * Geometry engine — DXF parsing (wrapper over `dxf-parser`).
 * File path: /lib/geometry/parse.ts
 *
 * Turns DXF text into raw geometric entities (segments in mm) plus the
 * header facts triage needs. Facts about dxf-parser 1.1.2 this relies on
 * (checked in node_modules/dxf-parser/dist):
 * - ARC/CIRCLE start/end angles come back in RADIANS; INSERT rotation in
 *   degrees; ELLIPSE start/end are parameters in radians.
 * - LWPOLYLINE vertices carry `bulge` only when non-zero; POLYLINE
 *   vertices are VERTEX entities with the same fields.
 * - SPLINE weights (group 41) are NOT parsed by dxf-parser, so they are
 *   read here from the raw text (`scanSplineWeights`) and matched to the
 *   parsed SPLINE by handle (group 5), falling back to file order for
 *   top-level splines without handles. Rational splines (the standard
 *   9-point NURBS circle) are then evaluated exactly.
 * - An ARC whose sweep is 360° (start = end, or 0→360) is a full circle
 *   and becomes a CircleSegment (closed) — chaining a single open arc
 *   whose ends coincide would leave it an open chain.
 * - Unknown entity types (HATCH, LEADER, …) are skipped silently, so the
 *   dropped report comes from an independent raw scan of the ENTITIES
 *   section, not from the parsed object.
 * - The scanner throws on truncated files ("EOF group not read"); that
 *   is caught and reported as `parseError` — the caller still gets the
 *   header facts and the dropped list, and triage goes red.
 *
 * Units: $INSUNITS 1 (inch) and 2 (feet) are scaled to mm and flagged
 * "inch"; 5 (cm) and 6 (m) are scaled and treated as mm; 4 is mm; 0 or
 * missing is "unknown" (no scaling, amber_units downstream).
 */

import DxfParser from "dxf-parser";
import type {
  IArcEntity,
  IBlock,
  ICircleEntity,
  IDxf,
  IEllipseEntity,
  IEntity,
  IInsertEntity,
  ILineEntity,
  ILwpolylineEntity,
  IPoint,
  IPolylineEntity,
  ISplineEntity,
} from "dxf-parser";
import type { DroppedEntity, DxfEntityType, DxfHeaderInfo, Point, Segment, UnitsInfo } from "./types";
import {
  DEFAULT_CHORD_ERROR_MM,
  EPS,
  affineCompose,
  affineRotateDeg,
  affineScale,
  affineTranslate,
  bulgeToArc,
  dist,
  distPointToSegment,
  makeArc,
  makeCircle,
  makeLine,
  radToDeg,
  transformSegment,
  type Affine,
} from "./math";

/* ─── Public types ───────────────────────────────────────── */

export type RawEntity = {
  originalType: DxfEntityType;
  layer: string;
  linetype?: string;
  color?: number;
  handle?: string;
  segments: Segment[];
  closed: boolean;
};

export type ParsedDxf = {
  header: DxfHeaderInfo;
  entities: RawEntity[];
  dropped: DroppedEntity[];
  splinesFlattened: number;
  ellipsesFlattened: number;
  blocksExploded: number;
  /** Message when dxf-parser threw part-way (geometry may be partial). */
  parseError: string | null;
};

/** Thrown only when the text is not a DXF at all (no SECTION group). */
export class DxfFormatError extends Error {
  constructor(message = "Not a DXF file: no SECTION group found") {
    super(message);
    this.name = "DxfFormatError";
  }
}

/** Decode uploaded bytes without choking on cp1250 bytes (they become U+FFFD). */
export function decodeDxfBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function looksLikeDxf(text: string): boolean {
  return /(^|\r?\n)\s*0\s*\r?\n\s*SECTION\s*(\r?\n|$)/.test(text) || /\bSECTION\b/.test(text);
}

/* ─── Entity type sets ───────────────────────────────────── */

const GEOMETRY_TYPES = new Set(["LINE", "ARC", "CIRCLE", "LWPOLYLINE", "POLYLINE", "SPLINE", "ELLIPSE", "INSERT"]);
const POLYLINE_CHILD_TYPES = new Set(["VERTEX", "SEQEND"]);
const NOT_GEOMETRY_TYPES = new Set([
  "POINT",
  "TEXT",
  "MTEXT",
  "DIMENSION",
  "HATCH",
  "ATTDEF",
  "ATTRIB",
  "SOLID",
  "3DFACE",
  "LEADER",
  "MLEADER",
  "MULTILEADER",
  "TOLERANCE",
  "RAY",
  "XLINE",
  "VIEWPORT",
  "IMAGE",
  "WIPEOUT",
  "ACAD_TABLE",
  "TABLE",
  "TRACE",
  "SHAPE",
  "OLE2FRAME",
]);

/* ─── Raw scan of the ENTITIES section (dropped report) ──── */

type RawScanEntity = { type: string; layer: string };

/** Types and layers of every top-level entity in ENTITIES, from the raw text. */
export function scanEntitiesSection(text: string): RawScanEntity[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: RawScanEntity[] = [];
  let inEntities = false;
  let pendingSection = false;
  let current: RawScanEntity | null = null;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1].trim();
    if (Number.isNaN(code)) continue;
    if (code === 0) {
      if (value === "SECTION") {
        pendingSection = true;
        continue;
      }
      if (inEntities && value === "ENDSEC") {
        if (current) out.push(current);
        current = null;
        inEntities = false;
        continue;
      }
      if (inEntities) {
        if (current) out.push(current);
        current = POLYLINE_CHILD_TYPES.has(value) ? null : { type: value, layer: "0" };
      }
      continue;
    }
    if (code === 2 && pendingSection) {
      inEntities = value === "ENTITIES";
      pendingSection = false;
      continue;
    }
    pendingSection = false;
    if (code === 8 && current) current.layer = value;
  }
  if (current) out.push(current);
  return out;
}

/** Group 41 values of every SPLINE in the file, by handle and in ENTITIES order. */
export type SplineWeightsScan = {
  byHandle: Map<string, number[]>;
  /** Weights of the top-level SPLINEs of the ENTITIES section, in file order. */
  inOrder: number[][];
};

/**
 * Raw scan for SPLINE weights (group 41), which dxf-parser 1.1.2 drops.
 * Walks BLOCKS and ENTITIES; a spline's handle (group 5) keys the map,
 * the ENTITIES-section splines are also listed in order for files that
 * carry no handles.
 */
export function scanSplineWeights(text: string): SplineWeightsScan {
  const lines = text.split(/\r\n|\r|\n/);
  const byHandle = new Map<string, number[]>();
  const inOrder: number[][] = [];
  let pendingSection = false;
  let section: string | null = null;
  let current: { handle: string | null; weights: number[]; topLevel: boolean } | null = null;
  const flush = () => {
    if (!current) return;
    if (current.handle) byHandle.set(current.handle, current.weights);
    if (current.topLevel) inOrder.push(current.weights);
    current = null;
  };
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1].trim();
    if (Number.isNaN(code)) continue;
    if (code === 0) {
      flush();
      if (value === "SECTION") {
        pendingSection = true;
        continue;
      }
      if (value === "ENDSEC") {
        section = null;
        continue;
      }
      if (value === "SPLINE" && (section === "ENTITIES" || section === "BLOCKS")) {
        current = { handle: null, weights: [], topLevel: section === "ENTITIES" };
      }
      continue;
    }
    if (code === 2 && pendingSection) {
      section = value;
      pendingSection = false;
      continue;
    }
    pendingSection = false;
    if (!current) continue;
    if (code === 5) current.handle = value.toUpperCase();
    else if (code === 41) {
      const w = parseFloat(value);
      if (Number.isFinite(w)) current.weights.push(w);
    }
  }
  flush();
  return { byHandle, inOrder };
}

/* ─── Header ─────────────────────────────────────────────── */

function headerNumber(header: Record<string, unknown> | undefined, key: string): number | null {
  const v = header?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function headerString(header: Record<string, unknown> | undefined, key: string): string | null {
  const v = header?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function headerPoint(header: Record<string, unknown> | undefined, key: string): Point | null {
  const v = header?.[key];
  if (!v || typeof v !== "object") return null;
  const p = v as { x?: unknown; y?: unknown };
  if (typeof p.x !== "number" || typeof p.y !== "number") return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  // AutoCAD writes ±1e20 sentinels when the extents were never computed.
  if (Math.abs(p.x) > 1e15 || Math.abs(p.y) > 1e15) return null;
  return { x: p.x, y: p.y };
}

export function unitsFromInsunits(insunits: number | null): UnitsInfo {
  switch (insunits) {
    case 1:
      return { insunits, detected: "inch", scaleApplied: 25.4 };
    case 2:
      return { insunits, detected: "inch", scaleApplied: 304.8 };
    case 4:
      return { insunits, detected: "mm", scaleApplied: 1 };
    case 5:
      return { insunits, detected: "mm", scaleApplied: 10 };
    case 6:
      return { insunits, detected: "mm", scaleApplied: 1000 };
    default:
      return { insunits, detected: "unknown", scaleApplied: 1 };
  }
}

function readHeader(dxf: IDxf | null, entityLayers: string[]): DxfHeaderInfo {
  const header = dxf?.header as Record<string, unknown> | undefined;
  const units = unitsFromInsunits(headerNumber(header, "$INSUNITS"));
  const k = units.scaleApplied;
  const extmin = headerPoint(header, "$EXTMIN");
  const extmax = headerPoint(header, "$EXTMAX");
  const tableLayers = Object.keys(dxf?.tables?.layer?.layers ?? {});
  const layers: string[] = [];
  for (const l of [...tableLayers, ...entityLayers]) if (!layers.includes(l)) layers.push(l);
  return {
    version: headerString(header, "$ACADVER"),
    units,
    extmin: extmin ? { x: extmin.x * k, y: extmin.y * k } : null,
    extmax: extmax ? { x: extmax.x * k, y: extmax.y * k } : null,
    layers,
  };
}

/* ─── Entity conversion ──────────────────────────────────── */

type ConvertContext = {
  blocks: Record<string, IBlock>;
  dropped: Map<string, DroppedEntity>;
  splinesFlattened: number;
  ellipsesFlattened: number;
  blocksExploded: number;
  chordError: number;
  splineWeights: SplineWeightsScan;
  /** Ordinal of the next top-level SPLINE (fallback matching by file order). */
  splineOrdinal: number;
};

function addDropped(map: Map<string, DroppedEntity>, type: string, layer: string, reason: DroppedEntity["reason"]) {
  const key = `${type}\u0000${layer}\u0000${reason}`;
  const cur = map.get(key);
  if (cur) cur.count += 1;
  else map.set(key, { type, layer, count: 1, reason });
}

function p2(p: IPoint | undefined): Point | null {
  if (!p || typeof p.x !== "number" || typeof p.y !== "number") return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: p.x, y: p.y };
}

function commonFields(e: IEntity): Pick<RawEntity, "layer" | "linetype" | "color" | "handle"> {
  const out: Pick<RawEntity, "layer" | "linetype" | "color" | "handle"> = {
    layer: typeof e.layer === "string" && e.layer.length > 0 ? e.layer : "0",
  };
  if (typeof e.lineType === "string") out.linetype = e.lineType;
  if (typeof e.colorIndex === "number") out.color = e.colorIndex;
  const h = e.handle as unknown;
  if (typeof h === "string" && h.length > 0) out.handle = h;
  else if (typeof h === "number") out.handle = h.toString(16).toUpperCase();
  return out;
}

function segmentsFromVertices(
  vertices: { x: number; y: number; bulge?: number }[],
  closed: boolean
): Segment[] {
  const pts = vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge ?? 0 }));
  const segments: Segment[] = [];
  const n = pts.length;
  if (n < 2) return segments;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (dist(a, b) <= EPS) continue;
    segments.push(bulgeToArc(a, b, a.bulge));
  }
  return segments;
}

/** Cox–de Boor basis function N_{i,p}(u); `uEnd` closes the last span of the domain. */
function basis(i: number, p: number, u: number, knots: number[], uEnd: number): number {
  if (p === 0) {
    if (u >= knots[i] && u < knots[i + 1]) return 1;
    if (u === uEnd && knots[i] < knots[i + 1] && knots[i + 1] === uEnd) return 1;
    return 0;
  }
  let a = 0;
  const d1 = knots[i + p] - knots[i];
  if (d1 > 0) a = ((u - knots[i]) / d1) * basis(i, p - 1, u, knots, uEnd);
  let b = 0;
  const d2 = knots[i + p + 1] - knots[i + 1];
  if (d2 > 0) b = ((knots[i + p + 1] - u) / d2) * basis(i + 1, p - 1, u, knots, uEnd);
  return a + b;
}

function evalNurbs(u: number, degree: number, ctrl: Point[], knots: number[], weights: number[]): Point {
  let x = 0;
  let y = 0;
  let w = 0;
  const uEnd = knots[knots.length - degree - 1];
  for (let i = 0; i < ctrl.length; i++) {
    const n = basis(i, degree, u, knots, uEnd) * weights[i];
    if (n === 0) continue;
    x += n * ctrl[i].x;
    y += n * ctrl[i].y;
    w += n;
  }
  return w > 0 ? { x: x / w, y: y / w } : { ...ctrl[0] };
}

/** Centripetal Catmull–Rom through fit points, t in [0, n-1]. */
function evalCatmullRom(t: number, pts: Point[], closed: boolean): Point {
  const n = pts.length;
  const seg = Math.min(Math.floor(t), closed ? n - 1 : n - 2);
  const local = t - seg;
  const get = (i: number) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const p0 = get(seg - 1);
  const p1 = get(seg);
  const p2v = get(seg + 1);
  const p3 = get(seg + 2);
  const l = local;
  const l2 = l * l;
  const l3 = l2 * l;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * l + (2 * a - 5 * b + 4 * c - d) * l2 + (-a + 3 * b - 3 * c + d) * l3);
  return { x: f(p0.x, p1.x, p2v.x, p3.x), y: f(p0.y, p1.y, p2v.y, p3.y) };
}

/**
 * Adaptive sampling of a parametric curve: subdivide until the midpoint
 * of each span lies within `chordError` of its chord.
 */
export function adaptiveSample(
  f: (t: number) => Point,
  t0: number,
  t1: number,
  chordError: number,
  initialSpans = 8,
  maxDepth = 12
): Point[] {
  const out: Point[] = [f(t0)];
  const refine = (a: number, b: number, pa: Point, pb: Point, depth: number) => {
    const m = (a + b) / 2;
    const pm = f(m);
    const err = distPointToSegment(pm, pa, pb);
    if (depth < maxDepth && (err > chordError || depth < 2)) {
      refine(a, m, pa, pm, depth + 1);
      refine(m, b, pm, pb, depth + 1);
    } else {
      out.push(pb);
    }
  };
  let prevT = t0;
  let prevP = out[0];
  for (let i = 1; i <= initialSpans; i++) {
    const t = t0 + ((t1 - t0) * i) / initialSpans;
    const p = f(t);
    refine(prevT, t, prevP, p, 0);
    prevT = t;
    prevP = p;
  }
  return out;
}

function linesFromPoints(points: Point[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    if (dist(points[i], points[i + 1]) > EPS) segs.push(makeLine(points[i], points[i + 1]));
  }
  return segs;
}

function splineToSegments(
  e: ISplineEntity,
  chordError: number,
  rawWeights: number[] | undefined
): { segments: Segment[]; closed: boolean } | null {
  const ctrl = (e.controlPoints ?? []).map(p2).filter((p): p is Point => p !== null);
  const fit = (e.fitPoints ?? []).map(p2).filter((p): p is Point => p !== null);
  const degree = typeof e.degreeOfSplineCurve === "number" && e.degreeOfSplineCurve > 0 ? e.degreeOfSplineCurve : 3;
  const closedFlag = e.closed === true;
  let points: Point[];
  if (ctrl.length >= 2) {
    let knots = Array.isArray(e.knotValues) ? e.knotValues.filter((k) => Number.isFinite(k)) : [];
    if (knots.length !== ctrl.length + degree + 1) {
      // Rebuild a clamped uniform knot vector when the file's is unusable.
      const inner = ctrl.length - degree;
      knots = [];
      for (let i = 0; i <= degree; i++) knots.push(0);
      for (let i = 1; i < inner; i++) knots.push(i / inner);
      for (let i = 0; i <= degree; i++) knots.push(1);
      if (inner < 1) return fit.length >= 2 ? { segments: linesFromPoints(fit), closed: closedFlag } : null;
    }
    // Group 41 per control point; anything that does not line up is treated as non-rational.
    const rational = rawWeights !== undefined && rawWeights.length === ctrl.length && rawWeights.every((w) => Number.isFinite(w) && w > 0);
    const weights = rational ? rawWeights : ctrl.map(() => 1);
    const u0 = knots[degree];
    const u1 = knots[knots.length - degree - 1];
    if (!(u1 > u0)) return null;
    // One initial span per distinct knot interval keeps sharp knots honest.
    const spans = Math.max(8, 4 * (ctrl.length - degree));
    points = adaptiveSample((u) => evalNurbs(u, degree, ctrl, knots, weights), u0, u1, chordError, spans);
  } else if (fit.length >= 2) {
    const n = fit.length;
    const tEnd = closedFlag ? n : n - 1;
    points = adaptiveSample((t) => evalCatmullRom(t, fit, closedFlag), 0, tEnd, chordError, 4 * tEnd);
  } else {
    return null;
  }
  const closed = closedFlag || (points.length > 2 && dist(points[0], points[points.length - 1]) <= 1e-6);
  if (closed && points.length > 2 && dist(points[0], points[points.length - 1]) > EPS) points.push({ ...points[0] });
  return { segments: linesFromPoints(points), closed };
}

function ellipseToSegments(e: IEllipseEntity, chordError: number): { segments: Segment[]; closed: boolean } | null {
  const c = p2(e.center);
  const major = p2(e.majorAxisEndPoint);
  if (!c || !major) return null;
  const ratio = typeof e.axisRatio === "number" && e.axisRatio > 0 ? e.axisRatio : 1;
  const a = Math.hypot(major.x, major.y);
  if (a <= EPS) return null;
  const minor = { x: -major.y * ratio, y: major.x * ratio };
  const t0 = typeof e.startAngle === "number" ? e.startAngle : 0;
  let t1 = typeof e.endAngle === "number" ? e.endAngle : 2 * Math.PI;
  while (t1 <= t0 + 1e-12) t1 += 2 * Math.PI;
  if (t1 - t0 > 2 * Math.PI + 1e-9) t1 = t0 + 2 * Math.PI;
  const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-9;
  const f = (t: number) => ({
    x: c.x + Math.cos(t) * major.x + Math.sin(t) * minor.x,
    y: c.y + Math.cos(t) * major.y + Math.sin(t) * minor.y,
  });
  const spans = Math.max(8, Math.ceil(radToDeg(t1 - t0) / 15));
  const points = adaptiveSample(f, t0, t1, chordError, spans);
  if (full) points[points.length - 1] = { ...points[0] };
  return { segments: linesFromPoints(points), closed: full };
}

function convertEntity(e: IEntity, ctx: ConvertContext, transform: Affine | null, depth: number): RawEntity[] {
  const type = e.type;
  const common = commonFields(e);
  const emit = (originalType: DxfEntityType, segments: Segment[], closed: boolean): RawEntity[] => {
    let segs = segments;
    if (transform) {
      segs = [];
      for (const s of segments) segs.push(...transformSegment(s, transform, ctx.chordError).segments);
    }
    if (segs.length === 0) {
      addDropped(ctx.dropped, type, common.layer, "zero_length");
      return [];
    }
    return [{ originalType, ...common, segments: segs, closed }];
  };

  switch (type) {
    case "LINE": {
      const le = e as ILineEntity;
      const a = p2(le.vertices?.[0]);
      const b = p2(le.vertices?.[1]);
      if (!a || !b) return drop(ctx, type, common.layer, "unsupported");
      return emit("LINE", [makeLine(a, b)], false);
    }
    case "ARC": {
      const ae = e as IArcEntity;
      const c = p2(ae.center);
      if (!c || typeof ae.radius !== "number" || !(ae.radius > 0)) return drop(ctx, type, common.layer, "unsupported");
      const s = typeof ae.startAngle === "number" ? radToDeg(ae.startAngle) : 0;
      const en = typeof ae.endAngle === "number" ? radToDeg(ae.endAngle) : 360;
      const arc = makeArc(c, ae.radius, s, en);
      // 0→360 (or start = end) is a full circle: closed on its own, never chained.
      if (arc.sweepDeg >= 360 - 1e-9) return emit("ARC", [makeCircle(c, ae.radius)], true);
      return emit("ARC", [arc], false);
    }
    case "CIRCLE": {
      const ce = e as ICircleEntity;
      const c = p2(ce.center);
      if (!c || typeof ce.radius !== "number" || !(ce.radius > 0)) return drop(ctx, type, common.layer, "unsupported");
      return emit("CIRCLE", [makeCircle(c, ce.radius)], true);
    }
    case "LWPOLYLINE": {
      const pe = e as ILwpolylineEntity;
      const verts = (pe.vertices ?? []).filter((v) => typeof v.x === "number" && typeof v.y === "number");
      const closed = pe.shape === true;
      return emit("LWPOLYLINE", segmentsFromVertices(verts, closed), closed);
    }
    case "POLYLINE": {
      const pe = e as IPolylineEntity;
      if (pe.is3dPolygonMesh || pe.isPolyfaceMesh) return drop(ctx, type, common.layer, "unsupported");
      const verts = (pe.vertices ?? []).filter((v) => typeof v.x === "number" && typeof v.y === "number");
      const closed = pe.shape === true;
      return emit("POLYLINE", segmentsFromVertices(verts, closed), closed);
    }
    case "SPLINE": {
      const ordinal = depth === 0 && !transform ? ctx.splineOrdinal++ : -1;
      const handle = common.handle?.toUpperCase();
      const weights =
        (handle !== undefined ? ctx.splineWeights.byHandle.get(handle) : undefined) ??
        (ordinal >= 0 ? ctx.splineWeights.inOrder[ordinal] : undefined);
      const r = splineToSegments(e as ISplineEntity, ctx.chordError, weights);
      if (!r) return drop(ctx, type, common.layer, "unsupported");
      ctx.splinesFlattened += 1;
      return emit("SPLINE", r.segments, r.closed);
    }
    case "ELLIPSE": {
      const r = ellipseToSegments(e as IEllipseEntity, ctx.chordError);
      if (!r) return drop(ctx, type, common.layer, "unsupported");
      ctx.ellipsesFlattened += 1;
      return emit("ELLIPSE", r.segments, r.closed);
    }
    case "INSERT": {
      const ie = e as IInsertEntity;
      const block = typeof ie.name === "string" ? ctx.blocks[ie.name] : undefined;
      if (!block || !Array.isArray(block.entities) || depth > 8) return drop(ctx, type, common.layer, "unsupported");
      const pos = p2(ie.position) ?? { x: 0, y: 0 };
      const base = p2(block.position) ?? { x: 0, y: 0 };
      const sx = typeof ie.xScale === "number" && ie.xScale !== 0 ? ie.xScale : 1;
      const sy = typeof ie.yScale === "number" && ie.yScale !== 0 ? ie.yScale : 1;
      const rot = typeof ie.rotation === "number" ? ie.rotation : 0;
      // p' = T(pos) · R(rot) · S(sx, sy) · T(−base) · p
      let m = affineCompose(affineRotateDeg(rot), affineScale(sx, sy));
      m = affineCompose(m, affineTranslate(-base.x, -base.y));
      m = affineCompose(affineTranslate(pos.x, pos.y), m);
      const total = transform ? affineCompose(transform, m) : m;
      ctx.blocksExploded += 1;
      const out: RawEntity[] = [];
      for (const child of block.entities) {
        for (const r of convertEntity(child, ctx, total, depth + 1)) {
          // Children on layer "0" inherit the INSERT's layer (DXF rule).
          out.push(r.layer === "0" ? { ...r, layer: common.layer } : r);
        }
      }
      return out;
    }
    default:
      if (NOT_GEOMETRY_TYPES.has(type)) return drop(ctx, type, common.layer, "not_geometry");
      return drop(ctx, type, common.layer, "unsupported");
  }
}

function drop(ctx: ConvertContext, type: string, layer: string, reason: DroppedEntity["reason"]): RawEntity[] {
  addDropped(ctx.dropped, type, layer, reason);
  return [];
}

/* ─── Entry point ────────────────────────────────────────── */

export type ParseOptions = { chordErrorMm?: number };

/**
 * Parse DXF text. Throws `DxfFormatError` for non-DXF text; every other
 * problem is reported in the result (parseError, dropped) so the caller
 * can still triage the file.
 */
export function parseDxf(text: string, options: ParseOptions = {}): ParsedDxf {
  if (!looksLikeDxf(text)) throw new DxfFormatError();
  const chordError = options.chordErrorMm ?? DEFAULT_CHORD_ERROR_MM;
  const ctx: ConvertContext = {
    blocks: {},
    dropped: new Map(),
    splinesFlattened: 0,
    ellipsesFlattened: 0,
    blocksExploded: 0,
    chordError,
    splineWeights: scanSplineWeights(text),
    splineOrdinal: 0,
  };

  let dxf: IDxf | null = null;
  let parseError: string | null = null;
  try {
    dxf = new DxfParser().parseSync(text);
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }
  if (dxf?.blocks) ctx.blocks = dxf.blocks;

  // Dropped report from the raw scan: independent of what dxf-parser understood.
  const scanned = scanEntitiesSection(text);
  for (const s of scanned) {
    if (GEOMETRY_TYPES.has(s.type)) continue;
    addDropped(ctx.dropped, s.type, s.layer, NOT_GEOMETRY_TYPES.has(s.type) ? "not_geometry" : "unsupported");
  }

  const entities: RawEntity[] = [];
  const entityLayers: string[] = [];
  for (const s of scanned) if (!entityLayers.includes(s.layer)) entityLayers.push(s.layer);
  for (const e of dxf?.entities ?? []) {
    if (!e || typeof e.type !== "string") continue;
    // Non-geometry types were already counted by the raw scan.
    if (!GEOMETRY_TYPES.has(e.type)) continue;
    try {
      entities.push(...convertEntity(e, ctx, null, 0));
    } catch (err) {
      addDropped(ctx.dropped, e.type, typeof e.layer === "string" ? e.layer : "0", "unsupported");
      if (!parseError) parseError = err instanceof Error ? err.message : String(err);
    }
  }

  const header = readHeader(dxf, entityLayers);
  const k = header.units.scaleApplied;
  const scaled =
    k === 1
      ? entities
      : entities.map((e) => ({
          ...e,
          segments: e.segments.flatMap((s) => transformSegment(s, affineScale(k, k), chordError).segments),
        }));

  const dropped = [...ctx.dropped.values()].sort(
    (a, b) => a.type.localeCompare(b.type) || a.layer.localeCompare(b.layer) || a.reason.localeCompare(b.reason)
  );
  return {
    header,
    entities: scaled,
    dropped,
    splinesFlattened: ctx.splinesFlattened,
    ellipsesFlattened: ctx.ellipsesFlattened,
    blocksExploded: ctx.blocksExploded,
    parseError,
  };
}
