/**
 * Geometry engine — STEP models of sheet parts → PartGeometry.
 * File path: /lib/geometry/step/analyse.ts
 *
 * What the reader gets out of a solid (spec 5.1 phase 3: "thickness and
 * bounding box for sheet parts"; unfolding of bent parts stays manual):
 *   - sheet thickness: the most common distance between a planar face
 *     and the nearest planar face facing the opposite way with material
 *     in between, weighted by face area (top/bottom of every flange win
 *     over the narrow edge faces);
 *   - the bounding box of the body in its own coordinates;
 *   - bends: coaxial cylinder pairs whose radii differ by the thickness
 *     (inner and outer bend surface); edge fillets have no partner and
 *     do not count;
 *   - FLAT parts (one body, every planar face parallel or perpendicular
 *     to the sheet normal, every cylinder / cone / torus axis along it, no
 *     bends, no free-form surfaces): the largest face on the sheet normal
 *     is the flat pattern. Its outer bound becomes the outline, its inner
 *     bounds the holes — exact lines and arcs, B-splines flattened — and
 *     the result goes through the same normalise → heal → loops →
 *     classify → measure → triage pipeline as a DXF, so pricing, the
 *     viewer and the thumbnail treat it as a 1:1 flat pattern.
 *   - everything else (bent parts, assemblies with several bodies, files
 *     without a readable solid) becomes a geometry with no entities and
 *     triage state red_step_manual whose details carry the thickness,
 *     bend count, bounding box and body count, so the quick-part dialog
 *     can be pre-filled and the message says what to enter by hand.
 *
 * Decisions:
 *   - A planar face at another angle (a chamfer) is tolerated while its
 *     area is under 5 % of the flat-pattern face; a cylinder whose axis
 *     is not on the sheet normal is tolerated when it is a fillet (no
 *     coaxial partner at thickness distance) — bends never are.
 *   - STEP units are declared exactly (SI prefix or a conversion unit),
 *     so an inch file is scaled and NOT sent to the amber_units question
 *     the DXF path asks; the header reports the applied factor.
 *   - Coordinates of the flat pattern are the face plane's own (ref, y)
 *     frame; the pipeline measures bbox, area and lengths from that, so
 *     the origin is irrelevant. Entity ids are content hashes as for DXF,
 *     so annotations re-attach when the same file is uploaded again.
 *   - No `any`; deterministic (no Date, no random); never throws below
 *     parseStep — an unreadable body yields the red_step_manual result.
 */

import type { AnalyzeOptions, DxfHeaderInfo, PartGeometry, Point, Triage, TriageReasonCode } from "../types";
import type { ParsedDxf, RawEntity } from "../parse";
import { runPipeline, GEOMETRY_VERSION } from "../pipeline";
import { clampTolerance, emptyHealingReport } from "../heal";
import { measure } from "../measure";
import { DEFAULT_CHORD_ERROR_MM, angleDeg, makeArc, makeCircle, makeLine, pointsEqual } from "../math";
import { parseStep, StepFormatError, isStepText, decodeStepBytes } from "./part21";
import {
  evaluateBrep,
  loopPolyline,
  sampleEdge,
  dot3,
  sub3,
  scale3,
  dist3,
  type Body3,
  type BrepModel,
  type Face3,
  type Loop3,
  type Placement,
  type Vec3,
} from "./brep";

export { StepFormatError, isStepText, decodeStepBytes };

/* ─── Public summary ────────────────────────────────────────── */

export type StepBodySummary = {
  faceCount: number;
  /** Axis-aligned extents in the body's own coordinates, mm. */
  bbox: { x: number; y: number; z: number } | null;
  thicknessMm: number | null;
  bendCount: number;
  flat: boolean;
  /** Why the body is not a flat sheet (empty when flat). */
  notFlatBecause: ("bends" | "tilted_faces" | "freeform_surfaces" | "no_planar_faces" | "no_thickness")[];
};

export type StepSummary = {
  unit: BrepModel["unitName"];
  bodies: StepBodySummary[];
  warnings: string[];
};

const PARALLEL = 0.999;
const PERPENDICULAR = 0.02;
const MIN_THICKNESS_MM = 0.1;
const MAX_THICKNESS_MM = 60;
const THICKNESS_BUCKET_MM = 0.02;
const CHAMFER_AREA_RATIO = 0.05;

/* ─── Per-face evaluation ───────────────────────────────────── */

type PlanarFace = {
  face: Face3;
  normal: Vec3;
  /** Signed offset along the normal: dot(normal, origin). */
  offset: number;
  area: number;
  /** 2D basis of the plane (ref, y) — independent of same_sense. */
  placement: Placement;
  outer2: Point[];
  inner2: Point[][];
};

function project(p: Placement, v: Vec3): Point {
  const d = sub3(v, p.origin);
  return { x: dot3(d, p.ref), y: dot3(d, p.y) };
}

function polygonArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function planarFace(face: Face3, chordError: number): PlanarFace | null {
  if (face.surface.kind !== "plane") return null;
  const placement = face.surface.placement;
  const normal = face.sameSense ? placement.axis : scale3(placement.axis, -1);
  const outer2 = face.outer ? loopPolyline(face.outer, chordError).map((v) => project(placement, v)) : [];
  const inner2 = face.inner.map((l) => loopPolyline(l, chordError).map((v) => project(placement, v)));
  let area = polygonArea(outer2);
  for (const hole of inner2) area -= polygonArea(hole);
  return { face, normal, offset: dot3(normal, placement.origin), area: Math.max(0, area), placement, outer2, inner2 };
}

type Cylinder = { axis: Vec3; axisPoint: Vec3; radius: number; face: Face3 };

function cylinderOf(face: Face3): Cylinder | null {
  if (face.surface.kind !== "cylinder") return null;
  const p = face.surface.placement;
  // A point on the axis line independent of where the placement origin sits along it.
  const axisPoint = sub3(p.origin, scale3(p.axis, dot3(p.origin, p.axis)));
  return { axis: p.axis, axisPoint, radius: face.surface.radius, face };
}

function coaxial(a: Cylinder, b: Cylinder): boolean {
  if (Math.abs(dot3(a.axis, b.axis)) < PARALLEL) return false;
  return dist3(a.axisPoint, b.axisPoint) < 0.05;
}

/* ─── Body analysis ─────────────────────────────────────────── */

type BodyAnalysis = {
  summary: StepBodySummary;
  sheetNormal: Vec3 | null;
  planar: PlanarFace[];
  /** The face used as the flat pattern (largest on the sheet normal), when flat. */
  patternFace: PlanarFace | null;
};

function bboxOfBody(body: Body3, chordError: number): StepBodySummary["bbox"] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let any = false;
  const take = (p: Vec3) => {
    any = true;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  };
  for (const face of body.faces) {
    const loops: Loop3[] = face.outer ? [face.outer, ...face.inner] : face.inner;
    for (const loop of loops) for (const p of loopPolyline(loop, chordError)) take(p);
  }
  if (!any) return null;
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
}

function thicknessOf(planar: PlanarFace[]): { thicknessMm: number; normal: Vec3 } | null {
  // Bucket → total area weight + a representative normal.
  const buckets = new Map<number, { weight: number; normal: Vec3; value: number }>();
  for (const a of planar) {
    if (a.area <= 0) continue;
    let best = Infinity;
    for (const b of planar) {
      if (a === b || dot3(a.normal, b.normal) > -PARALLEL) continue;
      // Material lies against a's normal: b's plane must be behind a.
      const d = dot3(scale3(a.normal, -1), sub3(b.placement.origin, a.placement.origin));
      if (d >= MIN_THICKNESS_MM && d <= MAX_THICKNESS_MM && d < best) best = d;
    }
    if (!Number.isFinite(best)) continue;
    const key = Math.round(best / THICKNESS_BUCKET_MM);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.weight += a.area;
      if (a.area > bucket.weight / 2) bucket.normal = a.normal;
    } else {
      buckets.set(key, { weight: a.area, normal: a.normal, value: best });
    }
  }
  if (buckets.size === 0) return null;
  let maxWeight = 0;
  for (const b of buckets.values()) if (b.weight > maxWeight) maxWeight = b.weight;
  // The thinnest distance that still carries a substantial share of the area:
  // the sheet faces, not the block's long sides.
  let chosen: { weight: number; normal: Vec3; value: number } | null = null;
  for (const b of buckets.values()) {
    if (b.weight < maxWeight * 0.25) continue;
    if (!chosen || b.value < chosen.value) chosen = b;
  }
  if (!chosen) return null;
  return { thicknessMm: Math.round(chosen.value * 100) / 100, normal: chosen.normal };
}

function countBends(body: Body3, thicknessMm: number | null): { bendCount: number; bendFaces: Set<Face3> } {
  const bendFaces = new Set<Face3>();
  if (thicknessMm === null) return { bendCount: 0, bendFaces };
  const cylinders: Cylinder[] = [];
  for (const face of body.faces) {
    const c = cylinderOf(face);
    if (c) cylinders.push(c);
  }
  const groups: Cylinder[][] = [];
  for (const c of cylinders) {
    const group = groups.find((g) => coaxial(g[0], c));
    if (group) group.push(c);
    else groups.push([c]);
  }
  let bendCount = 0;
  for (const group of groups) {
    const radii = Array.from(new Set(group.map((c) => Math.round(c.radius * 100) / 100))).sort((a, b) => a - b);
    let isBend = false;
    for (let i = 0; i < radii.length && !isBend; i++) {
      for (let j = i + 1; j < radii.length; j++) {
        if (Math.abs(radii[j] - radii[i] - thicknessMm) < 0.05) {
          isBend = true;
          break;
        }
      }
    }
    if (isBend) {
      bendCount++;
      for (const c of group) bendFaces.add(c.face);
    }
  }
  return { bendCount, bendFaces };
}

export function analyseBody(body: Body3, chordError = DEFAULT_CHORD_ERROR_MM): BodyAnalysis {
  const planar: PlanarFace[] = [];
  for (const face of body.faces) {
    const pf = planarFace(face, chordError);
    if (pf) planar.push(pf);
  }
  const bbox = bboxOfBody(body, chordError);
  const thickness = thicknessOf(planar);
  const thicknessMm = thickness?.thicknessMm ?? null;
  const { bendCount, bendFaces } = countBends(body, thicknessMm);

  const notFlatBecause: StepBodySummary["notFlatBecause"] = [];
  let sheetNormal: Vec3 | null = thickness?.normal ?? null;
  let patternFace: PlanarFace | null = null;

  if (planar.length === 0) notFlatBecause.push("no_planar_faces");
  if (thicknessMm === null) notFlatBecause.push("no_thickness");
  if (bendCount > 0) notFlatBecause.push("bends");

  if (sheetNormal && thicknessMm !== null) {
    const n = sheetNormal;
    const onNormal = planar.filter((f) => Math.abs(dot3(f.normal, n)) > PARALLEL && f.area > 0);
    // Flat pattern candidate: largest face on the normal; ties broken towards
    // the side with the smaller holes (the through-cut side of a countersink).
    onNormal.sort((a, b) => b.area - a.area || innerArea(a) - innerArea(b));
    patternFace = onNormal[0] ?? null;
    const patternArea = patternFace?.area ?? 0;
    let tilted = false;
    for (const f of planar) {
      const d = Math.abs(dot3(f.normal, n));
      if (d > PARALLEL || d < PERPENDICULAR) continue;
      if (f.area > patternArea * CHAMFER_AREA_RATIO) tilted = true;
    }
    if (tilted) notFlatBecause.push("tilted_faces");
    let freeform = false;
    let tiltedCurved = false;
    for (const face of body.faces) {
      const s = face.surface;
      if (s.kind === "plane") continue;
      if (s.kind === "other") {
        freeform = true;
        continue;
      }
      if (s.kind === "sphere") continue;
      const along = Math.abs(dot3(s.placement.axis, n)) > PARALLEL;
      if (!along && bendFaces.has(face)) tiltedCurved = true;
      if (!along && s.kind !== "cylinder" && s.kind !== "torus") tiltedCurved = true;
    }
    if (freeform) notFlatBecause.push("freeform_surfaces");
    if (tiltedCurved && !notFlatBecause.includes("bends")) notFlatBecause.push("bends");
    if (!patternFace) notFlatBecause.push("no_planar_faces");
  } else {
    sheetNormal = null;
  }

  const flat = notFlatBecause.length === 0 && patternFace !== null;
  return {
    summary: { faceCount: body.faces.length, bbox, thicknessMm, bendCount, flat, notFlatBecause: Array.from(new Set(notFlatBecause)) },
    sheetNormal,
    planar,
    patternFace: flat ? patternFace : null,
  };
}

function innerArea(f: PlanarFace): number {
  let a = 0;
  for (const hole of f.inner2) a += polygonArea(hole);
  return a;
}

/* ─── Flat pattern → parsed entities ────────────────────────── */

type Flattening = { entities: RawEntity[]; splinesFlattened: number; ellipsesFlattened: number };

function loopEntities(loop: Loop3, plane: Placement, chordError: number, out: Flattening): void {
  // A loop made of one full circle is a CIRCLE entity.
  if (loop.edges.length === 1) {
    const e = loop.edges[0].edge;
    if (e.curve.kind === "circle" && dist3(e.start, e.end) < 1e-6 && Math.abs(dot3(e.curve.placement.axis, plane.axis)) > PARALLEL) {
      const center = project(plane, e.curve.placement.origin);
      out.entities.push({ originalType: "CIRCLE", layer: "0", segments: [makeCircle(center, e.curve.radius)], closed: true });
      return;
    }
  }
  for (const oe of loop.edges) {
    const e = oe.edge;
    const c = e.curve;
    if (c.kind === "line") {
      const a = project(plane, e.start);
      const b = project(plane, e.end);
      if (pointsEqual(a, b, 1e-9)) continue;
      out.entities.push({ originalType: "LINE", layer: "0", segments: [makeLine(a, b)], closed: false });
      continue;
    }
    if (c.kind === "circle" && Math.abs(dot3(c.placement.axis, plane.axis)) > PARALLEL) {
      const center = project(plane, c.placement.origin);
      if (dist3(e.start, e.end) < 1e-6) {
        out.entities.push({ originalType: "CIRCLE", layer: "0", segments: [makeCircle(center, c.radius)], closed: true });
        continue;
      }
      const a = project(plane, e.start);
      const b = project(plane, e.end);
      // CCW around the circle's own axis when same_sense; mirrored in the
      // plane frame when the circle axis points against the plane axis.
      const ccwInPlane = e.sameSense !== dot3(c.placement.axis, plane.axis) < 0;
      const startDeg = angleDeg(center, ccwInPlane ? a : b);
      const endDeg = angleDeg(center, ccwInPlane ? b : a);
      out.entities.push({ originalType: "ARC", layer: "0", segments: [makeArc(center, c.radius, startDeg, endDeg)], closed: false });
      continue;
    }
    // Ellipses, B-splines, polylines, tilted circles: flatten.
    const pts = sampleEdge(e, chordError).map((v) => project(plane, v));
    const segments = [];
    for (let i = 0; i < pts.length - 1; i++) {
      if (pointsEqual(pts[i], pts[i + 1], 1e-9)) continue;
      segments.push(makeLine(pts[i], pts[i + 1]));
    }
    if (segments.length === 0) continue;
    const originalType = c.kind === "bspline" ? "SPLINE" : c.kind === "ellipse" ? "ELLIPSE" : "LWPOLYLINE";
    if (c.kind === "bspline") out.splinesFlattened++;
    if (c.kind === "ellipse") out.ellipsesFlattened++;
    out.entities.push({ originalType, layer: "0", segments, closed: false });
  }
}

function headerFor(model: BrepModel, extents: { min: Point; max: Point } | null): DxfHeaderInfo {
  return {
    version: null,
    units: { insunits: model.unitName === "inch" ? 1 : 4, detected: "mm", scaleApplied: model.unitScale },
    extmin: extents?.min ?? null,
    extmax: extents?.max ?? null,
    layers: ["0"],
  };
}

function extentsOf(pts: Point[][]): { min: Point; max: Point } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loop of pts) {
    for (const p of loop) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return Number.isFinite(minX) ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } : null;
}

/** The flat pattern of an analysed flat body as parsed entities (like a DXF). */
export function flatPatternOf(analysis: BodyAnalysis, model: BrepModel, chordError = DEFAULT_CHORD_ERROR_MM): ParsedDxf | null {
  const face = analysis.patternFace;
  if (!face || !face.face.outer) return null;
  const out: Flattening = { entities: [], splinesFlattened: 0, ellipsesFlattened: 0 };
  loopEntities(face.face.outer, face.placement, chordError, out);
  for (const hole of face.face.inner) loopEntities(hole, face.placement, chordError, out);
  return {
    header: headerFor(model, extentsOf([face.outer2, ...face.inner2])),
    entities: out.entities,
    dropped: [],
    splinesFlattened: out.splinesFlattened,
    ellipsesFlattened: out.ellipsesFlattened,
    blocksExploded: 0,
    parseError: null,
  };
}

/* ─── Whole file ────────────────────────────────────────────── */

export function summariseStep(model: BrepModel, chordError = DEFAULT_CHORD_ERROR_MM): StepSummary {
  return {
    unit: model.unitName,
    bodies: model.bodies.map((b) => analyseBody(b, chordError).summary),
    warnings: model.warnings,
  };
}

function manualTriage(model: BrepModel, analyses: BodyAnalysis[]): Triage {
  const reasons: TriageReasonCode[] = [];
  const details: Triage["details"] = {};
  if (model.bodies.length === 0) {
    reasons.push("step_no_geometry");
  } else if (model.bodies.length > 1) {
    reasons.push("step_multi_body");
  } else {
    reasons.push("step_not_flat");
  }
  details.bodies = model.bodies.length;
  // Largest body describes the part (an assembly's biggest plate is still a hint).
  const main = analyses.slice().sort((a, b) => (b.summary.bbox ? b.summary.bbox.x * b.summary.bbox.y * b.summary.bbox.z : 0) - (a.summary.bbox ? a.summary.bbox.x * a.summary.bbox.y * a.summary.bbox.z : 0))[0];
  if (main) {
    const s = main.summary;
    details.thicknessMm = s.thicknessMm ?? "?";
    details.bendCount = s.bendCount;
    details.faces = s.faceCount;
    // Sorted so the message reads "length × width × height" whatever the model axes.
    const dims = s.bbox ? [s.bbox.x, s.bbox.y, s.bbox.z].map((d) => Math.round(d * 10) / 10).sort((a, b) => b - a) : null;
    details.bboxX = dims ? dims[0] : "?";
    details.bboxY = dims ? dims[1] : "?";
    details.bboxZ = dims ? dims[2] : "?";
    if (s.notFlatBecause.length) details.because = s.notFlatBecause.join(",");
  }
  if (!main) {
    details.thicknessMm = "?";
    details.bendCount = 0;
    details.bboxX = "?";
    details.bboxY = "?";
    details.bboxZ = "?";
  }
  if (model.warnings.length) details.warnings = model.warnings.length;
  return { state: "red_step_manual", reasons, candidateEntityIds: [], details };
}

function manualGeometry(model: BrepModel, analyses: BodyAnalysis[], options: AnalyzeOptions): PartGeometry {
  const triage = manualTriage(model, analyses);
  const thicknessMm = options.thicknessMm ?? (typeof triage.details.thicknessMm === "number" ? triage.details.thicknessMm : null);
  const tol = clampTolerance(options.toleranceMm);
  const measures = measure([], [], {
    blankMarginMm: options.blankMarginMm,
    thicknessMm,
    densityKgM3: options.densityKgM3,
  });
  const main = analyses[0]?.summary.bbox ?? null;
  const header = headerFor(model, main ? { min: { x: 0, y: 0 }, max: { x: main.x, y: main.y } } : null);
  return {
    version: GEOMETRY_VERSION,
    source: "step",
    header,
    entities: [],
    loops: [],
    outerLoopId: null,
    measures,
    healing: emptyHealingReport(tol),
    dropped: [],
    triage,
    partCount: model.bodies.length,
    material: { thicknessMm, densityKgM3: options.densityKgM3 ?? null },
  };
}

/**
 * Analyse the text of a STEP file. Throws StepFormatError when the text is
 * not a STEP file at all; every other problem ends in red_step_manual.
 */
export function analyseStepSync(text: string, options: AnalyzeOptions = {}): PartGeometry {
  const file = parseStep(text);
  const model = evaluateBrep(file);
  const analyses = model.bodies.map((b) => analyseBody(b));
  if (model.bodies.length === 1 && analyses[0].summary.flat) {
    const parsed = flatPatternOf(analyses[0], model);
    if (parsed && parsed.entities.length > 0) {
      const thicknessMm = options.thicknessMm ?? analyses[0].summary.thicknessMm;
      try {
        const geometry = runPipeline(parsed, { ...options, thicknessMm }, "step");
        if (geometry.outerLoopId) return geometry;
      } catch {
        // fall through to the manual result
      }
    }
  }
  return manualGeometry(model, analyses, options);
}

/** Thickness / bend / size facts of a STEP file for tests and the intake result. */
export function summariseStepText(text: string): StepSummary {
  return summariseStep(evaluateBrep(parseStep(text)));
}
