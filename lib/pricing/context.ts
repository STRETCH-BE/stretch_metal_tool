/**
 * Pricing engine — per-part resolution shared by the feasibility rules and
 * the operations builder, so both see exactly the same thickness, material,
 * laser row, bends and slow contours.
 * File path: /lib/pricing/context.ts
 *
 * Decisions:
 * - Thickness = part.thicknessMm, else the thickness the geometry was
 *   analysed with. Density and Rm come from the material RATE ROW (the
 *   snapshot is the source of truth), falling back to the geometry's
 *   density only when the material row is missing.
 * - The blank is recomputed from the bbox with the snapshot's blank margin
 *   (rate_general), not taken from the geometry, so re-pricing an old
 *   quote with its pinned rate version is exact.
 * - Bends: annotations.bends win; otherwise the geometry's bend lines
 *   (layer-named or drawn — never "candidate" lines still awaiting the
 *   user's answer) with the defaults angle 90°, inside radius = t and
 *   die V = dieFactor × t from the press-brake limits.
 * - Slow contours are the interior closed loops (kind "hole", same part
 *   group as the outline, not deleted) whose bbox max side is below the
 *   laser row's minContourMm, or 10 × t when the row has none. Geometry
 *   objects without loops fall back to measures.slowContours.
 * - A part with a tube_cut extra is a tube part: no flat laser / sheet
 *   material lines are produced for it.
 * - Deleted entities (annotations.deletedEntityIds) are assumed already
 *   applied to the geometry by the engine's applyAnnotations; they are
 *   filtered here again only for holes and slow contours as a safety net.
 * - buildPartContext validates the user-typed numbers first (validate.ts:
 *   qty, scrap, extras, weld/bend/roll annotations) and throws
 *   PricingError before anything is priced or flagged, so neither the
 *   operations builder nor the feasibility rules ever see NaN, Infinity or
 *   a negative cost driver.
 */

import type { HoleInfo, PartGeometry, PartAnnotations, Point, SlowContour } from "../geometry/types";
import {
  areaMassKg,
  blankMassKg,
  defaultDieVMm,
  slowContourThresholdMm,
} from "./formulas";
import {
  familyThicknessLimitMm,
  findLaserRate,
  findMaterial,
  machineOf,
  materialPricePerKg,
  normaliseThreadSize,
  type LaserRateLookup,
} from "./lookup";
import type {
  Machine,
  MachinePark,
  MaterialFamily,
  MaterialRate,
  PricingItem,
  PricingPart,
  RateSnapshot,
  ThicknessBandPrice,
} from "./types";
import { validatePartAnnotations, validatePricingItem } from "./validate";

export type FlatLaserMachine = Extract<Machine, { kind: "flat_laser" }>;
export type TubeLaserMachine = Extract<Machine, { kind: "tube_laser" }>;
export type PressBrakeMachine = Extract<Machine, { kind: "press_brake" }>;
export type RollMachine = Extract<Machine, { kind: "roll" }>;
export type WeldMachine = Extract<Machine, { kind: "weld" }>;

export type ResolvedBend = {
  id: string;
  start: Point;
  end: Point;
  lengthMm: number;
  angleDeg: number;
  /** Inside radius (mm); defaults to t. */
  radiusMm: number;
  direction: "up" | "down" | "unknown";
  /** Die opening (mm); 0 when neither the user nor the press-brake limits give one. */
  dieVMm: number;
  origin: "annotation" | "geometry";
};

export type ConfirmedThreadGroup = {
  /** Size as the user confirmed it (first occurrence). */
  size: string;
  loopIds: string[];
};

export type PartContext = {
  part: PricingPart;
  item: PricingItem;
  rates: RateSnapshot;
  geometry: PartGeometry;
  annotations: PartAnnotations;
  thicknessMm: number | null;
  material: MaterialRate | null;
  family: MaterialFamily | null;
  densityKgM3: number | null;
  priceBand: ThicknessBandPrice | null;
  /** Item override, else the material default, else null. */
  scrapPct: number | null;
  flatLaser: FlatLaserMachine | null;
  tubeLaser: TubeLaserMachine | null;
  pressBrake: PressBrakeMachine | null;
  rollMachine: RollMachine | null;
  weldMachine: WeldMachine | null;
  /** Laser row lookup; null when thickness/material are missing or the part is a tube. */
  laser: LaserRateLookup | null;
  slowContours: SlowContour[];
  slowLengthMm: number;
  blank: { lengthMm: number; widthMm: number; marginMm: number };
  netMassKg: number | null;
  blankMassKg: number | null;
  bends: ResolvedBend[];
  holes: HoleInfo[];
  isTubePart: boolean;
  confirmedThreads: ConfirmedThreadGroup[];
};

export function resolveThickness(part: PricingPart): number | null {
  const t = part.thicknessMm ?? part.geometry.material.thicknessMm;
  return t !== null && Number.isFinite(t) && t > 0 ? t : null;
}

function deletedSet(annotations: PartAnnotations): Set<string> {
  return new Set(annotations.deletedEntityIds);
}

function outerPartIndex(geometry: PartGeometry): number {
  return geometry.loops.find((l) => l.id === geometry.outerLoopId)?.partIndex ?? 0;
}

export function resolveSlowContours(
  geometry: PartGeometry,
  annotations: PartAnnotations,
  thresholdMm: number
): SlowContour[] {
  const deleted = deletedSet(annotations);
  if (geometry.loops.length > 0) {
    const partIndex = outerPartIndex(geometry);
    return geometry.loops
      .filter(
        (l) =>
          l.kind === "hole" &&
          l.closed &&
          l.partIndex === partIndex &&
          !deleted.has(l.id) &&
          !l.entityIds.some((id) => deleted.has(id))
      )
      .map((l) => ({
        loopId: l.id,
        maxSideMm: Math.max(l.bbox.width, l.bbox.height),
        lengthMm: l.perimeterMm,
      }))
      .filter((c) => c.maxSideMm < thresholdMm);
  }
  return geometry.measures.slowContours.filter(
    (c) => c.maxSideMm < thresholdMm && !deleted.has(c.loopId)
  );
}

export function resolveHoles(geometry: PartGeometry, annotations: PartAnnotations): HoleInfo[] {
  const deleted = deletedSet(annotations);
  if (deleted.size === 0) return geometry.measures.holes;
  const loopEntities = new Map(geometry.loops.map((l) => [l.id, l.entityIds] as const));
  return geometry.measures.holes.filter(
    (h) => !deleted.has(h.loopId) && !(loopEntities.get(h.loopId) ?? []).some((id) => deleted.has(id))
  );
}

export function resolveBends(
  part: PricingPart,
  thicknessMm: number | null,
  pressBrake: PressBrakeMachine | null
): ResolvedBend[] {
  const { annotations, geometry } = part;
  const defaultV =
    thicknessMm !== null && pressBrake && pressBrake.limits.dieFactor > 0
      ? defaultDieVMm(thicknessMm, pressBrake.limits.dieFactor)
      : 0;
  const lengthOf = (start: Point, end: Point, stored: number): number =>
    stored > 0 ? stored : Math.hypot(end.x - start.x, end.y - start.y);

  if (annotations.bends.length > 0) {
    return annotations.bends.map((b) => ({
      id: b.id,
      start: b.start,
      end: b.end,
      lengthMm: lengthOf(b.start, b.end, b.lengthMm),
      angleDeg: b.angleDeg,
      radiusMm: b.radiusMm ?? thicknessMm ?? 0,
      direction: b.direction,
      dieVMm: b.dieVMm ?? defaultV,
      origin: "annotation",
    }));
  }
  const deleted = deletedSet(annotations);
  return geometry.measures.bendLines
    .filter(
      (b) =>
        b.source !== "candidate" &&
        !deleted.has(b.id) &&
        !(b.entityId !== null && deleted.has(b.entityId))
    )
    .map((b) => ({
      id: b.id,
      start: b.start,
      end: b.end,
      lengthMm: lengthOf(b.start, b.end, b.lengthMm),
      angleDeg: 90,
      radiusMm: thicknessMm ?? 0,
      direction: b.direction,
      dieVMm: defaultV,
      origin: "geometry",
    }));
}

export function resolveConfirmedThreads(annotations: PartAnnotations): ConfirmedThreadGroup[] {
  const groups = new Map<string, ConfirmedThreadGroup>();
  const entries = Object.entries(annotations.threads).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [loopId, size] of entries) {
    if (!size) continue;
    const key = normaliseThreadSize(size);
    const group = groups.get(key);
    if (group) group.loopIds.push(loopId);
    else groups.set(key, { size: size.trim(), loopIds: [loopId] });
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, g]) => g);
}

export function buildPartContext(
  part: PricingPart,
  item: PricingItem,
  rates: RateSnapshot,
  machines: MachinePark
): PartContext {
  validatePricingItem(item);
  validatePartAnnotations(part.id, part.annotations);
  const geometry = part.geometry;
  const annotations = part.annotations;
  const thicknessMm = resolveThickness(part);
  const material = findMaterial(rates, part.materialCode);
  const family = material?.family ?? null;
  const densityKgM3 = material?.densityKgM3 ?? geometry.material.densityKgM3 ?? null;
  const priceBand = material && thicknessMm !== null ? materialPricePerKg(material, thicknessMm) : null;
  const scrapPct = item.scrapPct ?? material?.scrapPctDefault ?? null;

  const flatLaser = machineOf(machines, "flat_laser");
  const tubeLaser = machineOf(machines, "tube_laser");
  const pressBrake = machineOf(machines, "press_brake");
  const rollMachine = machineOf(machines, "roll");
  const weldMachine = machineOf(machines, "weld");

  const isTubePart = item.extras.some((e) => e.type === "tube_cut");
  const limitMm = familyThicknessLimitMm(flatLaser?.limits ?? null, family);
  const laser =
    material && thicknessMm !== null && !isTubePart
      ? findLaserRate(rates, material.code, thicknessMm, limitMm)
      : null;

  const thresholdMm =
    laser?.row?.minContourMm ?? (thicknessMm !== null ? slowContourThresholdMm(thicknessMm) : null);
  const slowContours = thresholdMm === null ? [] : resolveSlowContours(geometry, annotations, thresholdMm);
  const slowLengthMm = slowContours.reduce((sum, c) => sum + c.lengthMm, 0);

  const marginMm = rates.general.blankMarginMm;
  const blank = {
    lengthMm: geometry.measures.bbox.width + 2 * marginMm,
    widthMm: geometry.measures.bbox.height + 2 * marginMm,
    marginMm,
  };
  const hasMass = thicknessMm !== null && densityKgM3 !== null;
  const netMassKg = hasMass ? areaMassKg(geometry.measures.netAreaMm2, thicknessMm, densityKgM3) : null;
  const blankMass = hasMass ? blankMassKg(blank.lengthMm, blank.widthMm, thicknessMm, densityKgM3) : null;

  return {
    part,
    item,
    rates,
    geometry,
    annotations,
    thicknessMm,
    material,
    family,
    densityKgM3,
    priceBand,
    scrapPct,
    flatLaser,
    tubeLaser,
    pressBrake,
    rollMachine,
    weldMachine,
    laser,
    slowContours,
    slowLengthMm,
    blank,
    netMassKg,
    blankMassKg: blankMass,
    bends: resolveBends(part, thicknessMm, pressBrake),
    holes: resolveHoles(geometry, annotations),
    isTubePart,
    confirmedThreads: resolveConfirmedThreads(annotations),
  };
}
