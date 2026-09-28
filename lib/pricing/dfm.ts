/**
 * Pricing engine — design-for-manufacturing checks on STEP sheet-metal
 * parts (geometry.sheet, written by lib/geometry/step/sheet.ts).
 * File path: /lib/pricing/dfm.ts
 *
 * Every rule reads the flat pattern, the sheet report and the machine
 * park / rate snapshot it was priced with; nothing here reads a table.
 * Rules (severity, params, locations = flat-pattern points the viewer
 * circles):
 * - dfm.relief_too_narrow  amber  slit width < max(laser kerf, t); kerf
 *   from the laser row (`kerfMm`, else KERF_FALLBACK_MM); carries the
 *   proposed fix (width t, depth to the bend tangent + t) as params —
 *   applied only through an approved override (lib/parts/relief-fix.ts).
 * - dfm.hole_near_bend     amber  hole edge < 2t + r from a bend line.
 * - dfm.flange_too_short   amber  flange outside dimension < the smallest
 *   min_flange of a die with V ≥ 6t (press_brake_tools); no die → skipped.
 * - dfm.bend_collision     amber  two bends of the same direction, parallel,
 *   at inside distance W with legs h1, h2: needs a straight punch taller
 *   than W + BEND_COLLISION_CLEARANCE_MM or a gooseneck with throat ≥
 *   min(h1, h2); none in the tools → flag.
 * - dfm.laser_cannot_make  amber  countersinks (mapped to csk_m<size>),
 *   blind pockets that are not stud seats, modelled threads.
 * - dfm.flat_mass_mismatch amber  flat volume × (1 ± 2 %) does not contain
 *   the model's sheet-body volume (a missed hole or a misplaced feature).
 * - dfm.open_contour       red    no closed outline; dfm.overlapping_cuts
 *   red: two cut loops intersect.
 * - sheet.bend_deduction_unverified amber: any bend without a test-bend row.
 * - sheet.masking_not_priced        amber: masking zones present.
 * - sheet.hardware_mismatch / sheet.revision_mismatch amber: drawing checks
 *   (params from the intake — evaluated where the drawing text is known).
 * Red DFM problems block sending like every red flag; amber ones need a
 * confirmation or an approved override, as today.
 */

import type { PartGeometry, Point, SheetReport } from "../geometry/types";
import type { Flag, FlagCode, FlagSeverity, PressBrakeTool, RateSnapshot } from "./types";
import { holeEdgeToBendMm } from "./bend-checks";

const EPS = 1e-9;
export const KERF_FALLBACK_MM = 0.2;
export const BEND_COLLISION_CLEARANCE_MM = 10;
export const MASS_TOLERANCE = 0.02;

export type DfmInput = {
  partId: string;
  itemId: string;
  geometry: PartGeometry;
  sheet: SheetReport;
  thicknessMm: number;
  /** Kerf of the laser row that prices the part, when known. */
  kerfMm: number | null;
  tools: readonly PressBrakeTool[];
};

type Params = Record<string, number | string>;

function flag(input: DfmInput, code: FlagCode, severity: FlagSeverity, params: Params, locations: Point[] = []): Flag {
  return { code, severity, partId: input.partId, itemId: input.itemId, params, overridable: severity === "amber", locations: locations.map((p) => ({ x: round(p.x), y: round(p.y) })) };
}

function round(v: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

/* ─── Rules ───────────────────────────────────────────────── */

function reliefFlags(input: DfmInput): Flag[] {
  const t = input.thicknessMm;
  const minMm = Math.max(input.kerfMm ?? KERF_FALLBACK_MM, t);
  const narrow = input.sheet.reliefs.filter((r) => r.widthMm < minMm - EPS);
  if (narrow.length === 0) return [];
  const bend = input.sheet.bends.find((b) => b.id === narrow[0].bendId);
  const proposedDepth = round((narrow[0].depthMm > 0 ? Math.max(narrow[0].depthMm, (bend?.allowanceMm ?? 0) / 2) : t) + t);
  return [
    flag(
      input,
      "dfm.relief_too_narrow",
      "amber",
      {
        count: narrow.length,
        widthMm: round(Math.min(...narrow.map((r) => r.widthMm)), 3),
        minMm: round(minMm, 3),
        proposedWidthMm: round(t, 3),
        proposedDepthMm: proposedDepth,
        reliefs: narrow.map((r) => `${r.bendId}:${r.end}`).join(","),
        entityIds: narrow.flatMap((r) => r.entityIds).join(","),
      },
      narrow.map((r) => r.at)
    ),
  ];
}

function holeNearBendFlags(input: DfmInput): Flag[] {
  const t = input.thicknessMm;
  const out: Flag[] = [];
  for (const bend of input.sheet.bends) {
    const minMm = 2 * t + bend.innerRadiusMm;
    const near: { loopId: string; center: Point; distance: number }[] = [];
    for (const hole of input.geometry.measures.holes) {
      // Non-round holes are taken as their circumscribed circle (conservative).
      const radius = (hole.circular ? hole.diameterMm : hole.maxSideMm) / 2;
      const distance = holeEdgeToBendMm({ start: bend.start, end: bend.end }, hole.center, radius);
      if (distance === null) continue;
      if (distance < minMm - EPS) near.push({ loopId: hole.loopId, center: hole.center, distance });
    }
    if (near.length === 0) continue;
    out.push(
      flag(
        input,
        "dfm.hole_near_bend",
        "amber",
        { bendId: bend.id, count: near.length, distanceMm: round(Math.min(...near.map((n) => n.distance))), minMm: round(minMm), loopIds: near.map((n) => n.loopId).join(",") },
        near.map((n) => n.center)
      )
    );
  }
  return out;
}

function flangeFlags(input: DfmInput): Flag[] {
  const t = input.thicknessMm;
  const dies = input.tools.filter((x): x is Extract<PressBrakeTool, { kind: "die" }> => x.kind === "die" && x.vMm >= 6 * t - EPS);
  if (dies.length === 0) return [];
  const minFlange = Math.min(...dies.map((d) => d.minFlangeMm));
  const out: Flag[] = [];
  for (const bend of input.sheet.bends) {
    const candidates = [bend.flangeOutsideMm, bend.baseFlangeOutsideMm].filter((v): v is number => v !== null && v > 0);
    if (candidates.length === 0) continue;
    const flange = Math.min(...candidates);
    if (flange < minFlange - EPS) {
      out.push(flag(input, "dfm.flange_too_short", "amber", { bendId: bend.id, flangeMm: round(flange), minMm: round(minFlange), vMm: round(Math.min(...dies.map((d) => d.vMm))) }, [midpoint(bend.start, bend.end)]));
    }
  }
  return out;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function parallel(a: { start: Point; end: Point }, b: { start: Point; end: Point }): boolean {
  const da = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
  const db = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
  const la = Math.hypot(da.x, da.y) || 1;
  const lb = Math.hypot(db.x, db.y) || 1;
  return Math.abs((da.x * db.x + da.y * db.y) / (la * lb)) > 0.995;
}

/** Perpendicular distance between two parallel bend lines in the flat. */
function lineDistance(a: { start: Point; end: Point }, b: { start: Point; end: Point }): number {
  const d = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
  const l = Math.hypot(d.x, d.y) || 1;
  const n = { x: -d.y / l, y: d.x / l };
  const m = midpoint(b.start, b.end);
  return Math.abs((m.x - a.start.x) * n.x + (m.y - a.start.y) * n.y);
}

function collisionFlags(input: DfmInput): Flag[] {
  const t = input.thicknessMm;
  const punches = input.tools.filter((x): x is Extract<PressBrakeTool, { kind: "punch" }> => x.kind === "punch");
  const out: Flag[] = [];
  const bends = input.sheet.bends;
  for (let i = 0; i < bends.length; i++) {
    for (let j = i + 1; j < bends.length; j++) {
      const a = bends[i];
      const b = bends[j];
      if (a.direction !== b.direction || !parallel(a, b)) continue;
      const flatBetween = lineDistance(a, b) - a.allowanceMm / 2 - b.allowanceMm / 2;
      if (flatBetween <= 0) continue;
      // Inside width between the two flanges: the flat between the tangent lines plus both inner radii.
      const W = flatBetween + a.innerRadiusMm + b.innerRadiusMm;
      // Legs: the flange of each bend that is NOT the web shared with the other bend.
      const shared = [a.fromFlange, a.toFlange].find((f) => f === b.fromFlange || f === b.toFlange);
      const legOf = (bend: typeof a): number | null => {
        if (shared === undefined) return bend.flangeOutsideMm;
        return bend.toFlange === shared ? bend.baseFlangeOutsideMm : bend.flangeOutsideMm;
      };
      const h1 = legOf(a);
      const h2 = legOf(b);
      if (h1 === null || h2 === null) continue;
      const legs = Math.min(h1, h2);
      const neededStraight = W + BEND_COLLISION_CLEARANCE_MM;
      const straightOk = punches.some((p) => p.type === "straight" && p.heightMm >= neededStraight - EPS);
      const gooseneckOk = punches.some((p) => p.type === "gooseneck" && (p.throatDepthMm ?? 0) >= legs - EPS);
      if (straightOk || gooseneckOk) continue;
      out.push(
        flag(
          input,
          "dfm.bend_collision",
          "amber",
          { bendA: a.id, bendB: b.id, widthMm: round(W), legMm: round(legs), punchMm: round(neededStraight), thicknessMm: t },
          [midpoint(a.start, a.end), midpoint(b.start, b.end)]
        )
      );
    }
  }
  return out;
}

function laserFlags(input: DfmInput): Flag[] {
  const out: Flag[] = [];
  const s = input.sheet;
  if (s.countersinks.length > 0) {
    out.push(
      flag(
        input,
        "dfm.laser_cannot_make",
        "amber",
        { what: "countersink", count: s.countersinks.length, sizeMm: round(s.countersinks[0].throughDiameterMm, 1), topMm: round(s.countersinks[0].topDiameterMm, 1) },
        s.countersinks.map((c) => c.center)
      )
    );
  }
  if (s.blindPockets.length > 0) {
    out.push(flag(input, "dfm.laser_cannot_make", "amber", { what: "pocket", count: s.blindPockets.length, depthMm: round(s.blindPockets[0].depthMm, 2) }, s.blindPockets.map((p) => p.center)));
  }
  if (s.helicalHoles.length > 0) {
    out.push(flag(input, "dfm.laser_cannot_make", "amber", { what: "thread", count: s.helicalHoles.length }, s.helicalHoles));
  }
  return out;
}

function massFlags(input: DfmInput): Flag[] {
  const s = input.sheet;
  if (s.solidVolumeMm3 === null || s.flatVolumeMm3 <= 0) return [];
  const lo = s.flatVolumeMm3 * (1 - MASS_TOLERANCE);
  const hi = s.flatVolumeMm3 * (1 + MASS_TOLERANCE);
  if (s.solidVolumeMm3 >= lo - EPS && s.solidVolumeMm3 <= hi + EPS) return [];
  const t = input.thicknessMm;
  return [
    flag(input, "dfm.flat_mass_mismatch", "amber", {
      flatMm3: round(s.flatVolumeMm3, 0),
      solidMm3: round(s.solidVolumeMm3, 0),
      deltaPct: round(((s.solidVolumeMm3 - s.flatVolumeMm3) / s.flatVolumeMm3) * 100, 1),
      thicknessMm: t,
    }),
  ];
}

function contourFlags(input: DfmInput): Flag[] {
  const g = input.geometry;
  const out: Flag[] = [];
  if (!g.outerLoopId) out.push(flag(input, "dfm.open_contour", "red", {}));
  // Overlapping cuts: two closed cut loops whose polygons intersect (an edge crossing).
  const closed = g.loops.filter((l) => l.closed && (l.kind === "outer" || l.kind === "hole") && l.points.length >= 3);
  const crossings: Point[] = [];
  for (let i = 0; i < closed.length && crossings.length < 20; i++) {
    for (let j = i + 1; j < closed.length && crossings.length < 20; j++) {
      const a = closed[i].bbox;
      const b = closed[j].bbox;
      if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
      const p = firstCrossing(closed[i].points, closed[j].points);
      if (p) crossings.push(p);
    }
  }
  if (crossings.length > 0) out.push(flag(input, "dfm.overlapping_cuts", "red", { count: crossings.length }, crossings));
  return out;
}

function firstCrossing(a: Point[], b: Point[]): Point | null {
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i];
    const p2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const q1 = b[j];
      const q2 = b[(j + 1) % b.length];
      const p = segmentIntersection(p1, p2, q1, q2);
      if (p) return p;
    }
  }
  return null;
}

function segmentIntersection(p1: Point, p2: Point, q1: Point, q2: Point): Point | null {
  const r = { x: p2.x - p1.x, y: p2.y - p1.y };
  const s = { x: q2.x - q1.x, y: q2.y - q1.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return null;
  const qp = { x: q1.x - p1.x, y: q1.y - p1.y };
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;
  const inner = 1e-6;
  if (t <= inner || t >= 1 - inner || u <= inner || u >= 1 - inner) return null;
  return { x: p1.x + t * r.x, y: p1.y + t * r.y };
}

function sheetFlags(input: DfmInput): Flag[] {
  const out: Flag[] = [];
  const s = input.sheet;
  const unverified = s.bends.filter((b) => b.allowanceSource !== "test_bend");
  if (unverified.length > 0) {
    const formula = unverified.some((b) => b.allowanceSource === "din6935_formula");
    out.push(flag(input, "sheet.bend_deduction_unverified", "amber", { count: unverified.length, source: formula ? "formula" : "table", allowanceMm: round(unverified[0].allowanceMm, 3) }, unverified.map((b) => midpoint(b.start, b.end))));
  }
  if (s.maskingZones.length > 0) {
    const area = s.maskingZones.reduce((sum, z) => sum + z.areaMm2, 0);
    out.push(flag(input, "sheet.masking_not_priced", "amber", { count: s.maskingZones.length, areaMm2: round(area, 0), confirmed: s.maskingZones.some((z) => z.confirmed) ? "yes" : "no" }, s.maskingZones.map((z) => centroid(z.polygon))));
  }
  return out;
}

function drawingFlags(input: DfmInput): Flag[] {
  const d = input.sheet.drawing;
  if (!d) return [];
  const out: Flag[] = [];
  for (const m of d.hardwareMismatches) {
    out.push(flag(input, "sheet.hardware_mismatch", "amber", { item: `${m.kind === "weld_stud" ? "stud" : m.kind} ${m.size}`, drawingQty: m.drawingQty, modelQty: m.modelQty }));
  }
  if (d.fileRevision && d.drawingRevision && d.fileRevision !== d.drawingRevision) {
    out.push(flag(input, "sheet.revision_mismatch", "amber", { fileRevision: d.fileRevision, drawingRevision: d.drawingRevision }));
  }
  return out;
}

function centroid(pts: Point[]): Point {
  const n = Math.max(1, pts.length);
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
}

/** Kerf of the laser row that prices the part: rate_laser.kerf_mm when the snapshot carries it. */
export function laserKerfMm(rates: RateSnapshot, materialCode: string | null, thicknessMm: number | null): number | null {
  if (!materialCode || thicknessMm === null) return null;
  const row = rates.laser.find((r) => r.materialCode.toLowerCase() === materialCode.toLowerCase() && Math.abs(r.thicknessMm - thicknessMm) < 1e-6);
  const kerf = row && "kerfMm" in row ? (row as { kerfMm?: number | null }).kerfMm : null;
  return typeof kerf === "number" && kerf > 0 ? kerf : null;
}

/** Every DFM flag of a sheet part; empty for parts without a sheet report or not sheet metal. */
export function evaluateDfmFlags(input: DfmInput): Flag[] {
  if (!input.sheet.isSheetMetal) return [flag(input, "sheet.not_sheet_metal", "amber", { bodies: input.sheet.hardwareBodies + 1 })];
  return [
    ...contourFlags(input),
    ...reliefFlags(input),
    ...holeNearBendFlags(input),
    ...flangeFlags(input),
    ...collisionFlags(input),
    ...laserFlags(input),
    ...massFlags(input),
    ...sheetFlags(input),
    ...drawingFlags(input),
  ];
}
