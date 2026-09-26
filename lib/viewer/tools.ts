/**
 * Viewer — pure reducers over PartAnnotations for every editing tool.
 * Pure, no React; every function returns a NEW annotations object and
 * never mutates its input (the viewer emits the result through
 * onAnnotationsChange, the parent persists and re-analyses).
 * File path: /lib/viewer/tools.ts
 *
 * Coordinate frame: the viewer shows applyAnnotationsSync(geometry,
 * annotations), i.e. the scaled / mirrored frame, and annotate.ts reads
 * bend and weld coordinates in that same frame. So:
 * - `setScale` records `from`/`to`/`measuredMm` in the BASE (unscaled,
 *   unmirrored) frame, hence `factor = realMm / measuredMm` holds, and
 *   rescales the coordinates of bends and welds drawn earlier so they
 *   stay on the outline;
 * - `mirror` flips x of every drawn bend / weld point together with the
 *   outline.
 * Ids of new bends / welds are deterministic ("bend-3" = max suffix + 1)
 * so the reducers stay pure and testable.
 * `joinWithinTolerance` and `splitIntoParts` only validate / mark: the
 * healing and the split run server-side (the viewer asks through
 * onRequestReanalyse).
 * Weld forms are validated here with the same rule as the server schema
 * (lib/parts/schema: stitch pitch > 0): an invalid form is refused by the
 * reducers (input returned unchanged) and previews as null, so a stitch
 * weld with pitch 0 can never be emitted, saved or priced as a full seam.
 */

import type {
  BendAnnotation,
  EntityRole,
  GeometryEntity,
  PartAnnotations,
  PartGeometry,
  Point,
  RollAnnotation,
  WeldAnnotation,
  WeldProcess,
} from "@/lib/geometry/types";
import { weldEffectiveLength } from "@/lib/geometry/annotate";
import { dist, pointInPolygon } from "@/lib/geometry/math";

/* ─── Constants ──────────────────────────────────────────── */

export const DEFAULT_BEND_ANGLE_DEG = 90;
export const DEFAULT_STITCH_BEAD_MM = 30;
export const DEFAULT_STITCH_PITCH_MM = 60;
export const JOIN_TOLERANCE_DEFAULT_MM = 0.01;
export const JOIN_TOLERANCE_MAX_MM = 0.5;
export const JOIN_TOLERANCE_MIN_MM = 0.001;

export const WELD_PROCESSES: readonly WeldProcess[] = ["mig_mag", "tig", "laser", "mma"];
export const TAG_ROLES: readonly EntityRole[] = ["cut", "bend_up", "bend_down", "weld", "engrave", "ignore"];

/* ─── Forms ──────────────────────────────────────────────── */

export type BendForm = {
  angleDeg: number;
  radiusMm: number | null;
  direction: "up" | "down";
  dieVMm: number | null;
};

export type WeldForm = {
  process: WeldProcess;
  beadMm: number;
  pattern: "full" | "stitch";
  stitch: { beadLengthMm: number; pitchMm: number };
  sides: 1 | 2;
};

/** Smallest stitch pitch the form accepts (mm) — the server schema requires pitch > 0. */
export const STITCH_PITCH_MIN_MM = 0.1;

export type WeldFormIssue = "bead" | "beadLength" | "pitch";

/** First value the server schema (lib/parts/schema) would reject, or null when the form is valid. */
export function weldFormIssue(form: WeldForm): WeldFormIssue | null {
  if (!Number.isFinite(form.beadMm) || form.beadMm < 0) return "bead";
  if (form.pattern === "stitch") {
    if (!Number.isFinite(form.stitch.beadLengthMm) || form.stitch.beadLengthMm < 0) return "beadLength";
    if (!Number.isFinite(form.stitch.pitchMm) || form.stitch.pitchMm <= 0) return "pitch";
  }
  return null;
}

export function isWeldFormValid(form: WeldForm): boolean {
  return weldFormIssue(form) === null;
}

export function bendDefaults(thicknessMm: number | null, direction: "up" | "down" = "up"): BendForm {
  return { angleDeg: DEFAULT_BEND_ANGLE_DEG, radiusMm: thicknessMm ?? null, direction, dieVMm: null };
}

export function weldDefaults(thicknessMm: number | null): WeldForm {
  return {
    process: "mig_mag",
    beadMm: thicknessMm && thicknessMm > 0 ? thicknessMm : 3, // [CONFIRM] default bead = sheet thickness (3 mm when unknown)
    pattern: "full",
    stitch: { beadLengthMm: DEFAULT_STITCH_BEAD_MM, pitchMm: DEFAULT_STITCH_PITCH_MM },
    sides: 1,
  };
}

/* ─── Helpers ────────────────────────────────────────────── */

export function nextId(prefix: string, existing: readonly { id: string }[]): string {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const item of existing) {
    const m = re.exec(item.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${max + 1}`;
}

function unique(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

function bendFromEntity(entity: GeometryEntity, form: BendForm, id: string): BendAnnotation {
  const first = entity.segments[0];
  const last = entity.segments[entity.segments.length - 1];
  const start = first.kind === "circle" ? first.center : first.start;
  const end = last.kind === "circle" ? last.center : last.end;
  return {
    id,
    entityId: entity.id,
    start: { ...start },
    end: { ...end },
    lengthMm: entity.lengthMm,
    angleDeg: form.angleDeg,
    radiusMm: form.radiusMm,
    direction: form.direction,
    dieVMm: form.dieVMm,
  };
}

/** Builds the annotation, or null when the form would fail the server schema. */
function weldFromForm(id: string, form: WeldForm, lengthMm: number, entityIds: string[], points: Point[] | null): WeldAnnotation | null {
  if (!isWeldFormValid(form)) return null;
  const base: WeldAnnotation = {
    id,
    entityIds,
    points,
    lengthMm,
    process: form.process,
    beadMm: form.beadMm,
    pattern: form.pattern,
    stitch: form.pattern === "stitch" ? { ...form.stitch } : null,
    sides: form.sides,
    effectiveLengthMm: 0,
  };
  return { ...base, effectiveLengthMm: weldEffectiveLength(base, lengthMm) };
}

/** Effective seam length the form would produce for a geometric length — null for an invalid form. */
export function previewWeldEffectiveLength(form: WeldForm, lengthMm: number): number | null {
  return weldFromForm("preview", form, lengthMm, [], null)?.effectiveLengthMm ?? null;
}

export function polylineLength(points: readonly Point[]): number {
  let l = 0;
  for (let i = 0; i + 1 < points.length; i++) l += dist(points[i], points[i + 1]);
  return l;
}

/* ─── Tag ────────────────────────────────────────────────── */

/**
 * Set the role of the given entities. For bend roles with a form and the
 * entities available, a BendAnnotation is created (or replaced) per
 * entity so angle/radius/direction are stored; any other role removes a
 * bend annotation that was tagged on those entities.
 */
export function tagEntities(
  annotations: PartAnnotations,
  ids: readonly string[],
  role: EntityRole,
  bendForm?: BendForm,
  entities?: readonly GeometryEntity[]
): PartAnnotations {
  const idSet = new Set(ids);
  if (idSet.size === 0) return annotations;
  const overrides = { ...annotations.entities };
  for (const id of idSet) overrides[id] = { role };
  let bends = annotations.bends.filter((b) => !(b.entityId && idSet.has(b.entityId)));
  if ((role === "bend_up" || role === "bend_down") && bendForm && entities) {
    const form: BendForm = { ...bendForm, direction: role === "bend_up" ? "up" : "down" };
    const fresh: BendAnnotation[] = [];
    for (const entity of entities) {
      if (!idSet.has(entity.id) || entity.segments.length === 0) continue;
      fresh.push(bendFromEntity(entity, form, nextId("bend", [...bends, ...fresh])));
    }
    bends = [...bends, ...fresh];
  }
  return { ...annotations, entities: overrides, bends };
}

/** Remove the role override of the given entities (back to layer / geometry). */
export function untagEntities(annotations: PartAnnotations, ids: readonly string[]): PartAnnotations {
  const idSet = new Set(ids);
  const overrides: PartAnnotations["entities"] = {};
  for (const [id, v] of Object.entries(annotations.entities)) if (!idSet.has(id)) overrides[id] = v;
  return {
    ...annotations,
    entities: overrides,
    bends: annotations.bends.filter((b) => !(b.entityId && idSet.has(b.entityId))),
  };
}

/* ─── Bends ──────────────────────────────────────────────── */

export function addDrawnBend(annotations: PartAnnotations, p1: Point, p2: Point, form: BendForm): PartAnnotations {
  const lengthMm = dist(p1, p2);
  if (!(lengthMm > 0)) return annotations;
  const bend: BendAnnotation = {
    id: nextId("bend", annotations.bends),
    entityId: null,
    start: { ...p1 },
    end: { ...p2 },
    lengthMm,
    angleDeg: form.angleDeg,
    radiusMm: form.radiusMm,
    direction: form.direction,
    dieVMm: form.dieVMm,
  };
  return { ...annotations, bends: [...annotations.bends, bend] };
}

export function updateBend(annotations: PartAnnotations, id: string, patch: Partial<BendForm>): PartAnnotations {
  return {
    ...annotations,
    bends: annotations.bends.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  };
}

/* ─── Welds ──────────────────────────────────────────────── */

export function addWeldFromEntities(
  annotations: PartAnnotations,
  entities: readonly GeometryEntity[],
  ids: readonly string[],
  form: WeldForm
): PartAnnotations {
  const idSet = new Set(ids);
  const chain = entities.filter((e) => idSet.has(e.id));
  if (chain.length === 0) return annotations;
  const lengthMm = chain.reduce((acc, e) => acc + e.lengthMm, 0);
  const weld = weldFromForm(nextId("weld", annotations.welds), form, lengthMm, chain.map((e) => e.id), null);
  if (!weld) return annotations;
  return { ...annotations, welds: [...annotations.welds, weld] };
}

export function addWeldFromPoints(annotations: PartAnnotations, points: readonly Point[], form: WeldForm): PartAnnotations {
  if (points.length < 2) return annotations;
  const lengthMm = polylineLength(points);
  if (!(lengthMm > 0)) return annotations;
  const weld = weldFromForm(
    nextId("weld", annotations.welds),
    form,
    lengthMm,
    [],
    points.map((p) => ({ ...p }))
  );
  if (!weld) return annotations;
  return { ...annotations, welds: [...annotations.welds, weld] };
}

export function updateWeld(annotations: PartAnnotations, id: string, form: WeldForm): PartAnnotations {
  if (!isWeldFormValid(form)) return annotations;
  return {
    ...annotations,
    welds: annotations.welds.map((w) => (w.id === id ? (weldFromForm(w.id, form, w.lengthMm, w.entityIds, w.points) ?? w) : w)),
  };
}

/* ─── Roll ───────────────────────────────────────────────── */

export function setRoll(annotations: PartAnnotations, roll: RollAnnotation): PartAnnotations {
  return { ...annotations, roll: { ...roll, cone: roll.cone ? { ...roll.cone } : null }, forming: "rolled" };
}

export function clearRoll(annotations: PartAnnotations): PartAnnotations {
  return { ...annotations, roll: null, forming: annotations.forming === "rolled" ? null : annotations.forming };
}

/* ─── Scale (calibration) ────────────────────────────────── */

/** Current cumulative factor (1 when no calibration). */
export function currentScaleFactor(annotations: PartAnnotations): number {
  const f = annotations.scale?.factor;
  return f !== undefined && Number.isFinite(f) && f > 0 ? f : 1;
}

/** Display-frame point → base frame (undo scale and mirror). */
export function toBaseFrame(annotations: PartAnnotations, p: Point): Point {
  const f = currentScaleFactor(annotations);
  const x = (annotations.mirrored ? -p.x : p.x) / f;
  return { x, y: p.y / f };
}

/** Base-frame point → display frame (apply scale then mirror). */
export function toDisplayFrame(annotations: PartAnnotations, p: Point): Point {
  const f = currentScaleFactor(annotations);
  const x = p.x * f;
  return { x: annotations.mirrored ? -x : x, y: p.y * f };
}

/** Kills −0 so mirrored coordinates compare and serialise cleanly. */
function nz(v: number): number {
  return Object.is(v, -0) ? 0 : v;
}

function mapPoints(annotations: PartAnnotations, map: (p: Point) => Point): PartAnnotations {
  const fn = (p: Point): Point => {
    const q = map(p);
    return { x: nz(q.x), y: nz(q.y) };
  };
  return {
    ...annotations,
    bends: annotations.bends.map((b) => {
      const start = fn(b.start);
      const end = fn(b.end);
      return { ...b, start, end, lengthMm: dist(start, end) };
    }),
    welds: annotations.welds.map((w) => {
      if (!w.points) return w;
      const points = w.points.map(fn);
      const lengthMm = polylineLength(points);
      return { ...w, points, lengthMm, effectiveLengthMm: weldEffectiveLength(w, lengthMm) };
    }),
  };
}

/** Scale preview: factor the calibration would set and the resulting display ratio. */
export function scalePreview(annotations: PartAnnotations, from: Point, to: Point, realMm: number): { factor: number; ratio: number; measuredMm: number } | null {
  const measuredDisplay = dist(from, to);
  if (!(measuredDisplay > 0) || !(realMm > 0)) return null;
  const ratio = realMm / measuredDisplay;
  return { factor: currentScaleFactor(annotations) * ratio, ratio, measuredMm: measuredDisplay };
}

/**
 * Calibrate from two clicked points (display frame) and the real
 * distance. Records from/to/measured in the base frame so that
 * factor = realMm / measuredMm; earlier drawn bends / welds are rescaled.
 */
export function setScale(annotations: PartAnnotations, from: Point, to: Point, realMm: number): PartAnnotations {
  const preview = scalePreview(annotations, from, to, realMm);
  if (!preview) return annotations;
  const baseFrom = toBaseFrame(annotations, from);
  const baseTo = toBaseFrame(annotations, to);
  const measuredMm = dist(baseFrom, baseTo);
  const factor = realMm / measuredMm;
  const rescaled = mapPoints(annotations, (p) => ({ x: p.x * preview.ratio, y: p.y * preview.ratio }));
  return {
    ...rescaled,
    scale: { factor, from: baseFrom, to: baseTo, measuredMm, realMm },
    unitsConfirmed: true,
  };
}

export function clearScale(annotations: PartAnnotations): PartAnnotations {
  const f = currentScaleFactor(annotations);
  const rescaled = f !== 1 ? mapPoints(annotations, (p) => ({ x: p.x / f, y: p.y / f })) : annotations;
  return { ...rescaled, scale: null };
}

/* ─── Clean-up ───────────────────────────────────────────── */

export function deleteSelection(annotations: PartAnnotations, ids: readonly string[]): PartAnnotations {
  if (ids.length === 0) return annotations;
  const idSet = new Set(ids);
  return {
    ...annotations,
    deletedEntityIds: unique([...annotations.deletedEntityIds, ...ids]),
    bends: annotations.bends.filter((b) => !(b.entityId && idSet.has(b.entityId))),
    welds: annotations.welds
      .map((w) => (w.entityIds.some((id) => idSet.has(id)) ? { ...w, entityIds: w.entityIds.filter((id) => !idSet.has(id)) } : w))
      .filter((w) => w.entityIds.length > 0 || (w.points !== null && w.points.length >= 2)),
  };
}

export function restoreDeleted(annotations: PartAnnotations): PartAnnotations {
  return { ...annotations, deletedEntityIds: [] };
}

export function ignoreSelection(annotations: PartAnnotations, ids: readonly string[]): PartAnnotations {
  return tagEntities(annotations, ids, "ignore");
}

function loopPolygon(geometry: PartGeometry, loopId: string | null): Point[] | null {
  if (!loopId) return null;
  const loop = geometry.loops.find((l) => l.id === loopId);
  return loop && loop.points.length >= 3 ? loop.points : null;
}

function entityAnchor(entity: GeometryEntity): Point {
  const seg = entity.segments[Math.floor(entity.segments.length / 2)];
  if (!seg) return { x: entity.bbox.minX, y: entity.bbox.minY };
  if (seg.kind === "circle") return seg.center;
  if (seg.kind === "line") return { x: (seg.start.x + seg.end.x) / 2, y: (seg.start.y + seg.end.y) / 2 };
  return seg.start;
}

/**
 * Keep the outer contour, its holes and everything drawn inside it
 * (bend / weld / engrave / candidate lines); mark every other entity
 * (other parts, frames, dimension leftovers, noise) as deleted.
 */
export function keepLargestContour(geometry: PartGeometry, annotations: PartAnnotations): PartAnnotations {
  const outerId = geometry.outerLoopId;
  const polygon = loopPolygon(geometry, outerId);
  if (!outerId || !polygon) return annotations;
  const outer = geometry.loops.find((l) => l.id === outerId);
  const keepLoops = new Set<string>([outerId]);
  for (const loop of geometry.loops) {
    if (loop.kind === "hole" && loop.partIndex === (outer?.partIndex ?? 0)) keepLoops.add(loop.id);
  }
  const box = outer?.bbox;
  const remove: string[] = [];
  for (const entity of geometry.entities) {
    if (entity.loopId && keepLoops.has(entity.loopId)) continue;
    const inBox =
      !box ||
      (entity.bbox.minX >= box.minX - 1e-6 &&
        entity.bbox.maxX <= box.maxX + 1e-6 &&
        entity.bbox.minY >= box.minY - 1e-6 &&
        entity.bbox.maxY <= box.maxY + 1e-6);
    if (inBox && pointInPolygon(entityAnchor(entity), polygon)) continue;
    remove.push(entity.id);
  }
  return deleteSelection(annotations, remove);
}

export function clampJoinTolerance(toleranceMm: number): number {
  if (!Number.isFinite(toleranceMm) || toleranceMm <= 0) return JOIN_TOLERANCE_DEFAULT_MM;
  return Math.min(JOIN_TOLERANCE_MAX_MM, Math.max(JOIN_TOLERANCE_MIN_MM, toleranceMm));
}

/** Healing runs server-side: returns the annotations untouched plus the clamped tolerance to request. */
export function joinWithinTolerance(annotations: PartAnnotations, toleranceMm: number): { annotations: PartAnnotations; requestedToleranceMm: number } {
  return { annotations, requestedToleranceMm: clampJoinTolerance(toleranceMm) };
}

/** Toggle the mirror flag and flip drawn coordinates with the outline. */
export function mirror(annotations: PartAnnotations): PartAnnotations {
  const flipped = mapPoints(annotations, (p) => ({ x: -p.x, y: p.y }));
  return { ...flipped, mirrored: !annotations.mirrored };
}

/** The server decides how to split a multi-part file; this only marks the request. */
export function splitIntoParts(annotations: PartAnnotations): { annotations: PartAnnotations; splitParts: true } {
  return { annotations, splitParts: true };
}

/* ─── Removal ────────────────────────────────────────────── */

/** Remove a drawn bend or weld by id (an entity-tagged bend keeps the role tag). */
export function removeAnnotation(annotations: PartAnnotations, id: string): PartAnnotations {
  return {
    ...annotations,
    bends: annotations.bends.filter((b) => b.id !== id),
    welds: annotations.welds.filter((w) => w.id !== id),
  };
}

/** Count of user edits — for the "unsaved" hint and the restore button. */
export function annotationCount(annotations: PartAnnotations): number {
  return (
    Object.keys(annotations.entities).length +
    annotations.bends.length +
    annotations.welds.length +
    (annotations.roll ? 1 : 0) +
    (annotations.scale ? 1 : 0) +
    annotations.deletedEntityIds.length +
    (annotations.mirrored ? 1 : 0)
  );
}
