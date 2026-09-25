/**
 * Geometry engine — measures for one part group.
 * File path: /lib/geometry/measure.ts
 *
 * Everything the pricing engine bills from: cut length (outer + holes +
 * open chains the user answered "cut"), pierces (1 + holes + open cuts),
 * bbox and blank, areas, mass, holes with thread suggestions, bend lines
 * from bend-role entities, engrave length, slow contours.
 * - Every member of a closed outer/hole loop is laser-cut, whatever tag
 *   it carries: a weld or engrave tag on an outline edge ADDS an
 *   operation, it never removes the cut. (An "ignore" tag takes the
 *   entity out of chaining, so it can never be a loop member.)
 * - Bend lines and engrave length belong to the part group whose outline
 *   contains them (`loop.partIndex`); a marking line that lies inside no
 *   outline goes to the part whose bbox holds it, or to the only part.
 * - Holes nested inside holes are islands: their area is added back and
 *   their contour is still cut (pierce + length).
 * Units: mm, mm², kg. Mass = net area × thickness × density / 1e9.
 */

import type { BendLine, GeometryEntity, HoleInfo, Loop, PartMeasures, SlowContour } from "./types";
import { bboxCenter, bboxContains, bboxMaxSide, bboxUnionAll, emptyBbox } from "./math";
import { loopContains } from "./classify";
import { freeEndpoints } from "./heal";
import { suggestThread } from "./threads";

export const DEFAULT_BLANK_MARGIN_MM = 10;
export const SLOW_CONTOUR_FACTOR = 10;

export type MeasureOptions = {
  partIndex?: number;
  blankMarginMm?: number;
  thicknessMm?: number | null;
  densityKgM3?: number | null;
};

export function massKgFor(netAreaMm2: number, thicknessMm: number | null | undefined, densityKgM3: number | null | undefined): number | null {
  if (!thicknessMm || !densityKgM3 || thicknessMm <= 0 || densityKgM3 <= 0) return null;
  return (netAreaMm2 * thicknessMm * densityKgM3) / 1e9;
}

/** Bend line derived from a bend-role entity (source "layer"). */
export function bendLineFromEntity(e: GeometryEntity): BendLine | null {
  if (e.role !== "bend_up" && e.role !== "bend_down") return null;
  let start = e.bbox ? { x: e.bbox.minX, y: e.bbox.minY } : { x: 0, y: 0 };
  let end = e.bbox ? { x: e.bbox.maxX, y: e.bbox.maxY } : { x: 0, y: 0 };
  const ends = freeEndpoints(e);
  if (ends.length >= 2) {
    start = { ...ends[0].point };
    end = { ...ends[1].point };
  } else if (e.segments[0]?.kind === "line") {
    start = { ...e.segments[0].start };
    end = { ...e.segments[0].end };
  }
  return {
    id: `b${e.id}`,
    entityId: e.id,
    layer: e.layer,
    direction: e.role === "bend_up" ? "up" : "down",
    start,
    end,
    lengthMm: e.lengthMm,
    source: "layer",
  };
}

export function measure(entities: GeometryEntity[], loops: Loop[], options: MeasureOptions = {}): PartMeasures {
  const partIndex = options.partIndex ?? 0;
  const margin = options.blankMarginMm ?? DEFAULT_BLANK_MARGIN_MM;
  const thickness = options.thicknessMm ?? null;
  const density = options.densityKgM3 ?? null;
  const byId = new Map(entities.map((e) => [e.id, e]));
  const loopById = new Map(loops.map((l) => [l.id, l]));

  const outer = loops.find((l) => (l.kind === "outer" || l.kind === "other_part") && l.partIndex === partIndex) ?? null;
  const holes = loops.filter((l) => l.kind === "hole" && l.partIndex === partIndex);
  const partCount = loops.filter((l) => l.kind === "outer" || l.kind === "other_part").length;

  // Every member of a closed contour is cut, whatever else it is tagged as.
  const cutLength = (l: Loop) => l.entityIds.reduce((acc, id) => acc + (byId.get(id)?.lengthMm ?? 0), 0);

  const outerLengthMm = outer ? cutLength(outer) : 0;
  const holesLengthMm = holes.reduce((acc, h) => acc + cutLength(h), 0);

  // Open chains answered "cut" (slits): length + one pierce per chain.
  let openCutsLengthMm = 0;
  let openCuts = 0;
  for (const l of loops) {
    if (l.kind !== "open_chain" || l.partIndex !== partIndex) continue;
    const len = l.entityIds.reduce((acc, id) => {
      const e = byId.get(id);
      return e && e.role === "cut" ? acc + e.lengthMm : acc;
    }, 0);
    if (len > 0) {
      openCutsLengthMm += len;
      openCuts += 1;
    }
  }

  // Marking entities (bends, engraving) of THIS part group only.
  const inThisPart = (e: GeometryEntity): boolean => {
    const idx = e.loopId ? (loopById.get(e.loopId)?.partIndex ?? -1) : -1;
    if (idx === partIndex) return true;
    if (idx >= 0) return false;
    if (outer && bboxContains(outer.bbox, e.bbox, 1e-6)) return true;
    return partCount <= 1;
  };

  // Island parity: a hole inside an odd number of other holes adds material back.
  const holesAreaMm2 = holes.reduce((acc, h) => {
    let depth = 0;
    for (const o of holes) if (o.id !== h.id && o.areaMm2 > h.areaMm2 && loopContains(o, h)) depth += 1;
    return acc + (depth % 2 === 0 ? h.areaMm2 : -h.areaMm2);
  }, 0);
  const outerAreaMm2 = outer ? outer.areaMm2 : 0;
  const netAreaMm2 = Math.max(0, outerAreaMm2 - holesAreaMm2);

  const bbox = outer ? outer.bbox : entities.length > 0 ? bboxUnionAll(entities.map((e) => e.bbox)) : emptyBbox();

  const holeInfos: HoleInfo[] = holes.map((h) => {
    const circular = h.circle !== undefined;
    const maxSideMm = bboxMaxSide(h.bbox);
    const diameterMm = h.circle ? h.circle.diameterMm : maxSideMm;
    return {
      loopId: h.id,
      center: h.circle ? { ...h.circle.center } : bboxCenter(h.bbox),
      diameterMm,
      circular,
      maxSideMm,
      thread: circular ? suggestThread(diameterMm) : null,
    };
  });

  const bendLines: BendLine[] = [];
  for (const e of entities) {
    if (!inThisPart(e)) continue;
    const b = bendLineFromEntity(e);
    if (b) bendLines.push(b);
  }

  const smallestContourMm = holeInfos.length > 0 ? Math.min(...holeInfos.map((h) => h.maxSideMm)) : null;
  const slowContours: SlowContour[] =
    thickness && thickness > 0
      ? holes
          .filter((h) => bboxMaxSide(h.bbox) < SLOW_CONTOUR_FACTOR * thickness)
          .map((h) => ({ loopId: h.id, maxSideMm: bboxMaxSide(h.bbox), lengthMm: cutLength(h) }))
      : [];

  const engraveLengthMm = entities.reduce((acc, e) => (e.role === "engrave" && inThisPart(e) ? acc + e.lengthMm : acc), 0);

  return {
    cutLengthMm: outerLengthMm + holesLengthMm + openCutsLengthMm,
    outerLengthMm,
    holesLengthMm,
    openCutsLengthMm,
    openCuts,
    pierces: outer ? 1 + holes.length + openCuts : 0,
    bbox,
    blank: { lengthMm: bbox.width + 2 * margin, widthMm: bbox.height + 2 * margin, marginMm: margin },
    outerAreaMm2,
    holesAreaMm2,
    netAreaMm2,
    massKg: massKgFor(netAreaMm2, thickness, density),
    holes: holeInfos,
    bendLines,
    smallestContourMm,
    slowContours,
    engraveLengthMm,
    weldLengthMm: 0,
  };
}
