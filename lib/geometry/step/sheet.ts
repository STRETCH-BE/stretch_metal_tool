/**
 * Geometry engine — a STEP file as sheet-metal parts: which bodies are
 * sheets and which are hardware, the flat pattern of each sheet with its
 * bend table allowance, the hardware sitting on it, and the facts the
 * verification report and the DFM checks need.
 * File path: /lib/geometry/step/sheet.ts
 *
 * Bodies are first moved into the assembly frame (assembly.ts
 * bodyPlacements, one copy per occurrence) so a stud's base can be found
 * on the sheet it is welded to. A body is a SHEET when its planar faces
 * give a thickness and the faces on that normal are large against it
 * (≥ SHEET_MIN_FACE_FACTOR × t² and ≥ SHEET_MIN_PLANAR_SHARE of its
 * surface); the largest such body is always a sheet, any other sheet-like
 * body is a sheet too unless it is tiny (largest face under
 * HARDWARE_MAX_FACE_MM2 and under HARDWARE_MAX_SHARE of the largest
 * sheet's) — a nut insert, never a small bracket. Everything else is hardware and is attached to the sheet
 * whose face its base point touches (else the largest sheet).
 *
 * Hardware: an admin name rule (hardwareNames: substring of the PRODUCT
 * name) wins; otherwise the body's main cylinder gives the axis and
 * diameter, its extent the length, and the sheet decides the kind — a
 * base on a sheet face with no through hole beneath is a WELD STUD
 * (size M<d>x<length above the sheet>), a body whose axis passes a through
 * hole is an INSERT sized from the hole (INSERT_HOLE_SIZES), anything
 * else is unknown. Feature codes: the rule's, else `insert_m<size>` /
 * `stud_<size>` so the market engine prices what is benchmarked and
 * refuses the rest by name.
 *
 * Bend allowance: an exact bend-table row (material family, thickness,
 * inner radius, angle within 1°) wins — a test bend clears the
 * verification flag, a DIN table row keeps it; without a row the DIN
 * 6935 formula is used. Everything is passed in through AnalyzeOptions:
 * this module never reads a table.
 */

import type { AnalyzeOptions, BendAllowanceSource, BendTableLookup, HardwareLine, HardwareNameRule, Point, SheetReport } from "../types";
import { DEFAULT_CHORD_ERROR_MM } from "../math";
import type { StepFile } from "./part21";
import { add3, dot3, loopPolyline, placementReader, scale3, sub3, type Body3, type BrepModel, type Face3, type Loop3, type Vec3 } from "./brep";
import { bodyPlacements, stepBodyInfos, type StepBodyInfo } from "./assembly";
import { transformBody, type Rigid3 } from "./transform";
import { bodyVolumeMm3 } from "./volume";
import { din6935Allowance, unfoldBody, type AllowanceFn, type UnfoldResult } from "./unfold";

const PARALLEL = 0.999;
const SHEET_MIN_FACE_FACTOR = 25;
const SHEET_MIN_PLANAR_SHARE = 0.3;
/** A sheet-like body this small (mm², and this share of the largest sheet) is hardware, not a second sheet. [CONFIRM] */
const HARDWARE_MAX_FACE_MM2 = 400;
const HARDWARE_MAX_SHARE = 0.05;
const MIN_THICKNESS_MM = 0.1;
const MAX_THICKNESS_MM = 60;
const THICKNESS_BUCKET_MM = 0.02;
const ANGLE_TOL_DEG = 1;
const RADIUS_TOL_MM = 0.05;
const THICKNESS_TOL_MM = 0.05;
/** Base of a stud may float this much above the sheet face (exporters round). */
const CONTACT_TOL_MM = 0.3;

/** Press-in insert size from the sheet hole it sits in (mm ranges, PEM S-type plus SST's ACAO rows). [CONFIRM] */
export const INSERT_HOLE_SIZES: readonly { size: string; minMm: number; maxMm: number }[] = [
  { size: "M3", minMm: 4.0, maxMm: 4.7 },
  { size: "M4", minMm: 5.2, maxMm: 6.25 },
  { size: "M5", minMm: 6.25, maxMm: 7.2 },
  { size: "M6", minMm: 8.2, maxMm: 9.6 },
  { size: "M8", minMm: 10.2, maxMm: 11.5 },
  { size: "M10", minMm: 12.5, maxMm: 14.5 },
];

/* ─── Bend allowance ────────────────────────────────────────── */

export function allowanceFrom(table: BendTableLookup | null | undefined, thicknessMm: number): AllowanceFn {
  return (angleRad, innerRadiusMm) => {
    const angleDeg = (angleRad * 180) / Math.PI;
    if (table && table.materialFamily) {
      const rows = table.rows.filter(
        (r) =>
          r.materialFamily === table.materialFamily &&
          Math.abs(r.thicknessMm - thicknessMm) <= THICKNESS_TOL_MM &&
          Math.abs(r.innerRadiusMm - innerRadiusMm) <= RADIUS_TOL_MM &&
          Math.abs(r.angleDeg - angleDeg) <= ANGLE_TOL_DEG
      );
      // A test bend beats a DIN row of the same key.
      const row = rows.find((r) => r.source === "test_bend") ?? rows[0];
      if (row) {
        const source: BendAllowanceSource = row.source === "test_bend" ? "test_bend" : "din6935_table";
        return { allowanceMm: row.bendAllowanceMm, source };
      }
    }
    return { allowanceMm: din6935Allowance(angleRad, innerRadiusMm, thicknessMm), source: "din6935_formula" };
  };
}

/* ─── Body facts ────────────────────────────────────────────── */

type PlanarFacts = { face: Face3; normal: Vec3; origin: Vec3; area: number; polygon: Vec3[] };

function planarFacts(face: Face3, chordError: number): PlanarFacts | null {
  if (face.surface.kind !== "plane" || !face.outer) return null;
  const p = face.surface.placement;
  const normal = face.sameSense ? p.axis : scale3(p.axis, -1);
  const polygon = loopPolyline(face.outer, chordError);
  if (polygon.length < 3) return null;
  const to2 = (q: Vec3): Point => {
    const d = sub3(q, p.origin);
    return { x: dot3(d, p.ref), y: dot3(d, p.y) };
  };
  let area = polygonArea2(polygon.map(to2));
  for (const hole of face.inner) area -= polygonArea2(loopPolyline(hole, chordError).map(to2));
  return { face, normal, origin: p.origin, area: Math.max(0, area), polygon };
}

function polygonArea2(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Most common distance between opposite planar faces with material in between, area-weighted (analyse.ts rule). */
export function sheetThickness(planar: PlanarFacts[]): { thicknessMm: number; normal: Vec3 } | null {
  const buckets = new Map<number, { weight: number; normal: Vec3; value: number }>();
  for (const a of planar) {
    if (a.area <= 0) continue;
    let best = Infinity;
    // A pocket floor is a small parallel face just below the sheet face: it
    // must not shorten the thickness, so partners under a quarter of the
    // face's area are only used when nothing larger lies behind.
    let bestLarge = Infinity;
    for (const b of planar) {
      if (a === b || dot3(a.normal, b.normal) > -PARALLEL) continue;
      const d = dot3(scale3(a.normal, -1), sub3(b.origin, a.origin));
      if (d < MIN_THICKNESS_MM || d > MAX_THICKNESS_MM) continue;
      if (d < best) best = d;
      if (b.area >= a.area * 0.25 && d < bestLarge) bestLarge = d;
    }
    if (Number.isFinite(bestLarge)) best = bestLarge;
    if (!Number.isFinite(best)) continue;
    const key = Math.round(best / THICKNESS_BUCKET_MM);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.weight += a.area;
      if (a.area > bucket.weight / 2) bucket.normal = a.normal;
    } else buckets.set(key, { weight: a.area, normal: a.normal, value: best });
  }
  if (buckets.size === 0) return null;
  let maxWeight = 0;
  for (const b of buckets.values()) if (b.weight > maxWeight) maxWeight = b.weight;
  let chosen: { weight: number; normal: Vec3; value: number } | null = null;
  for (const b of buckets.values()) {
    if (b.weight < maxWeight * 0.25) continue;
    if (!chosen || b.value < chosen.value) chosen = b;
  }
  return chosen ? { thicknessMm: Math.round(chosen.value * 100) / 100, normal: chosen.normal } : null;
}

export type BodyFacts = {
  body: Body3;
  planar: PlanarFacts[];
  thicknessMm: number | null;
  sheetNormal: Vec3 | null;
  /** Largest planar face area. */
  largestFaceMm2: number;
  /** Area of planar faces on the sheet normal / all planar area. */
  onNormalShare: number;
  bbox: { min: Vec3; max: Vec3 } | null;
  sheetLike: boolean;
};

export function bodyFacts(body: Body3, chordError = DEFAULT_CHORD_ERROR_MM): BodyFacts {
  const planar: PlanarFacts[] = [];
  for (const face of body.faces) {
    const f = planarFacts(face, chordError);
    if (f) planar.push(f);
  }
  const thickness = sheetThickness(planar);
  const thicknessMm = thickness?.thicknessMm ?? null;
  const normal = thickness?.normal ?? null;
  let largest = 0;
  let total = 0;
  let onNormal = 0;
  for (const f of planar) {
    total += f.area;
    largest = Math.max(largest, f.area);
    if (normal && Math.abs(dot3(f.normal, normal)) > PARALLEL) onNormal += f.area;
  }
  let bbox: BodyFacts["bbox"] = null;
  for (const face of body.faces) {
    const loops: Loop3[] = face.outer ? [face.outer, ...face.inner] : face.inner;
    for (const loop of loops) for (const p of loopPolyline(loop, chordError)) {
      if (!bbox) bbox = { min: { ...p }, max: { ...p } };
      else {
        bbox.min = { x: Math.min(bbox.min.x, p.x), y: Math.min(bbox.min.y, p.y), z: Math.min(bbox.min.z, p.z) };
        bbox.max = { x: Math.max(bbox.max.x, p.x), y: Math.max(bbox.max.y, p.y), z: Math.max(bbox.max.z, p.z) };
      }
    }
  }
  const onNormalShare = total > 0 ? onNormal / total : 0;
  const sheetLike = thicknessMm !== null && largest >= SHEET_MIN_FACE_FACTOR * thicknessMm * thicknessMm && onNormalShare >= SHEET_MIN_PLANAR_SHARE;
  return { body, planar, thicknessMm, sheetNormal: normal, largestFaceMm2: largest, onNormalShare, bbox, sheetLike };
}

/* ─── Model in the assembly frame ───────────────────────────── */

export type PlacedBody = {
  body: Body3;
  solidId: number;
  occurrence: number;
  info: StepBodyInfo | null;
  transform: Rigid3;
};

/** Every occurrence of every body, moved into the assembly frame. */
export function placeBodies(file: StepFile, model: BrepModel): PlacedBody[] {
  const infos = stepBodyInfos(file);
  const placements = bodyPlacements(file, placementReader(file));
  const out: PlacedBody[] = [];
  for (const body of model.bodies) {
    const transforms = placements.get(body.id) ?? [];
    const info = infos.get(body.id) ?? null;
    if (transforms.length === 0) {
      out.push({ body, solidId: body.id, occurrence: 0, info, transform: { cx: { x: 1, y: 0, z: 0 }, cy: { x: 0, y: 1, z: 0 }, cz: { x: 0, y: 0, z: 1 }, t: { x: 0, y: 0, z: 0 } } });
      continue;
    }
    transforms.forEach((t, i) => out.push({ body: transformBody(body, t), solidId: body.id, occurrence: i, info, transform: t }));
  }
  return out;
}

export type SheetClassification = {
  /** One entry per sheet body occurrence (the part candidates). */
  sheets: { placed: PlacedBody; facts: BodyFacts }[];
  hardware: { placed: PlacedBody; facts: BodyFacts }[];
};

/** Sheets vs hardware among the placed bodies. */
export function classifyBodies(placed: PlacedBody[], chordError = DEFAULT_CHORD_ERROR_MM): SheetClassification {
  const all = placed.map((p) => ({ placed: p, facts: bodyFacts(p.body, chordError) }));
  const candidates = all.filter((b) => b.facts.sheetLike).sort((a, b) => b.facts.largestFaceMm2 - a.facts.largestFaceMm2);
  const sheets: SheetClassification["sheets"] = [];
  const hardware: SheetClassification["hardware"] = [];
  const top = candidates[0]?.facts.largestFaceMm2 ?? 0;
  for (const b of all) {
    const tiny = b.facts.largestFaceMm2 < HARDWARE_MAX_FACE_MM2 && b.facts.largestFaceMm2 < top * HARDWARE_MAX_SHARE;
    const isSheet = b.facts.sheetLike && (b === candidates[0] || !tiny);
    if (isSheet) sheets.push(b);
    else hardware.push(b);
  }
  return { sheets, hardware };
}

/* ─── Hardware ──────────────────────────────────────────────── */

type HardwareShape = {
  axis: Vec3;
  diameterMm: number;
  /** Ends of the body along its axis. */
  lo: Vec3;
  hi: Vec3;
  lengthMm: number;
};

function hardwareShape(body: Body3, chordError: number): HardwareShape | null {
  // Main cylinder: the one with the longest extent along its axis (area proxy: extent × radius).
  let best: { axis: Vec3; radius: number; origin: Vec3; score: number } | null = null;
  for (const face of body.faces) {
    if (face.surface.kind !== "cylinder" || !face.outer) continue;
    const p = face.surface.placement;
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of loopPolyline(face.outer, chordError)) {
      const h = dot3(sub3(q, p.origin), p.axis);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    const score = (hi - lo) * face.surface.radius;
    if (!best || score > best.score) best = { axis: p.axis, radius: face.surface.radius, origin: p.origin, score };
  }
  if (!best) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const face of body.faces) {
    const loops: Loop3[] = face.outer ? [face.outer, ...face.inner] : face.inner;
    for (const loop of loops) for (const q of loopPolyline(loop, chordError)) {
      const h = dot3(sub3(q, best.origin), best.axis);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  // Axis point on the centre line (the cylinder placement origin may sit anywhere along it).
  const base = sub3(best.origin, scale3(best.axis, dot3(best.origin, best.axis)));
  return { axis: best.axis, diameterMm: best.radius * 2, lo: add3(base, scale3(best.axis, lo)), hi: add3(base, scale3(best.axis, hi)), lengthMm: hi - lo };
}

function matchRule(name: string | null, rules: readonly HardwareNameRule[]): HardwareNameRule | null {
  if (!name) return null;
  const n = name.toLowerCase();
  return rules.find((r) => r.pattern.trim() !== "" && n.includes(r.pattern.trim().toLowerCase())) ?? null;
}

export function insertSizeForHole(diameterMm: number): string | null {
  return INSERT_HOLE_SIZES.find((r) => diameterMm >= r.minMm && diameterMm < r.maxMm)?.size ?? null;
}

function defaultFeatureCode(kind: HardwareLine["kind"], size: string | null): string | null {
  if (!size) return null;
  const s = size.toLowerCase().replace(/×/g, "x");
  if (kind === "insert") return `insert_${s}`;
  if (kind === "weld_stud") return `stud_${s}`;
  return null;
}

/** Hardware lines of one sheet: each hardware body classified against the sheet's flat pattern. */
export function classifyHardware(
  hardware: { placed: PlacedBody; facts: BodyFacts }[],
  sheet: { facts: BodyFacts; unfold: UnfoldResult; holeDiameterAt: (p: Point) => number | null },
  rules: readonly HardwareNameRule[],
  chordError = DEFAULT_CHORD_ERROR_MM
): HardwareLine[] {
  const lines = new Map<string, HardwareLine>();
  const t = sheet.facts.thicknessMm ?? 0;
  for (const h of hardware) {
    const name = h.placed.info?.name ?? null;
    const rule = matchRule(name, rules);
    const shape = hardwareShape(h.placed.body, chordError);
    let position: Point | null = null;
    let kind: HardwareLine["kind"] = rule?.kind ?? "unknown";
    let size: string | null = rule?.size ?? null;
    let contact: Vec3 | null = null;
    if (shape) {
      // The end nearer a sheet face is the base; the other end is the free end.
      const ends: [Vec3, Vec3][] = [
        [shape.lo, shape.hi],
        [shape.hi, shape.lo],
      ];
      for (const [base] of ends) {
        const mapped = sheet.unfold.mapToFlat(base);
        if (mapped) {
          position = mapped;
          contact = base;
          break;
        }
      }
      if (!position) {
        // Not touching a face: try the middle of the axis (an insert spanning the sheet).
        const mid = scale3(add3(shape.lo, shape.hi), 0.5);
        position = sheet.unfold.mapToFlat(mid);
        contact = position ? mid : null;
      }
      if (!rule && position && contact) {
        const inHole = sheet.unfold.overThroughHole(contact) || sheet.unfold.overThroughHole(scale3(add3(shape.lo, shape.hi), 0.5));
        if (inHole) {
          kind = "insert";
          const hole = sheet.holeDiameterAt(position);
          size = hole !== null ? insertSizeForHole(hole) : null;
        } else {
          kind = "weld_stud";
          // Length above the sheet: the whole body when its base sits on the surface.
          const above = Math.max(0, shape.lengthMm - (contact === shape.lo || contact === shape.hi ? 0 : t));
          size = `M${Math.round(shape.diameterMm)}x${Math.round(above)}`;
        }
      }
    }
    void CONTACT_TOL_MM;
    const key = `${kind}|${size ?? "?"}|${name ?? ""}`;
    const line = lines.get(key);
    if (line) {
      line.qty += 1;
      if (position) line.positions.push(position);
    } else {
      lines.set(key, {
        kind,
        size,
        qty: 1,
        featureCode: rule ? rule.featureCode : defaultFeatureCode(kind, size),
        productName: name,
        source: rule ? "name" : "geometry",
        positions: position ? [position] : [],
        diameterMm: shape ? Math.round(shape.diameterMm * 100) / 100 : null,
        lengthMm: shape ? Math.round(shape.lengthMm * 100) / 100 : null,
      });
    }
  }
  return Array.from(lines.values());
}

/* ─── The report ────────────────────────────────────────────── */

export type SheetAnalysis = {
  unfold: UnfoldResult;
  facts: BodyFacts;
  solidVolumeMm3: number | null;
};

/** Flat pattern + facts of one sheet body (null when it cannot be unfolded). */
export function analyseSheetBody(placed: PlacedBody, facts: BodyFacts, options: AnalyzeOptions, unitScale: number, chordError = DEFAULT_CHORD_ERROR_MM): SheetAnalysis | null {
  const thicknessMm = options.thicknessMm ?? facts.thicknessMm;
  if (thicknessMm === null || thicknessMm <= 0) return null;
  const unfold = unfoldBody(placed.body, { thicknessMm, unitScale, allowance: allowanceFrom(options.bendTable, thicknessMm), chordError });
  if (!unfold) return null;
  return { unfold, facts, solidVolumeMm3: bodyVolume(placed.body) };
}

/** Volume of a body: the exact mesh volume of a rebuilt tessellation, else the integral over its faces (null when a surface is not covered). */
export function bodyVolume(body: Body3): number | null {
  return body.meshVolumeMm3 ?? bodyVolumeMm3(body);
}

export function buildSheetReport(input: {
  analysis: SheetAnalysis;
  thicknessMm: number;
  hardware: HardwareLine[];
  hardwareBodies: number;
  flatNetAreaMm2: number;
  productName: string | null;
  maskingConfirmed: boolean;
}): SheetReport {
  const u = input.analysis.unfold;
  return {
    version: 1,
    thicknessMm: input.thicknessMm,
    isSheetMetal: true,
    bends: u.bends,
    hardware: input.hardware,
    studPositions: u.studPositions,
    maskingZones: u.maskingZones.map((z) => ({ ...z, confirmed: input.maskingConfirmed })),
    countersinks: u.countersinks,
    blindPockets: u.blindPockets,
    helicalHoles: u.helicalHoles,
    reliefs: [],
    solidVolumeMm3: input.analysis.solidVolumeMm3,
    flatVolumeMm3: input.flatNetAreaMm2 * input.thicknessMm,
    hardwareBodies: input.hardwareBodies,
    productName: input.productName,
  };
}
