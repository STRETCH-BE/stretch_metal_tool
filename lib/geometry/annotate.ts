/**
 * Geometry engine — applying user annotations to a stored geometry.
 * File path: /lib/geometry/annotate.ts
 *
 * Takes the healed geometry snapshot plus `PartAnnotations` and returns a
 * re-classified, re-measured, re-triaged PartGeometry:
 * 1. deleted ids (entity or loop ids of the INPUT geometry) are removed;
 * 2. scale factor and mirror (x → −x) are applied to every coordinate —
 *    entity ids are kept, so annotations keyed by id stay attached;
 * 3. role overrides win over layer and geometry ("ignore" also removes
 *    the entity from chaining);
 * 4. chaining/classification/measures run again;
 * 5. bends from annotations become BendLines (source "drawn"; a bend
 *    that references a tagged entity replaces the layer-derived line);
 * 6. weld effective lengths are recomputed (length × bead/pitch for
 *    stitch × sides) and summed into measures.weldLengthMm;
 * 7. thread confirmations replace the automatic suggestion per hole;
 * 8. triage is re-evaluated with the amber answers (unitsConfirmed,
 *    forming/roll/bends given) so an answered question turns green.
 * Annotation coordinates are taken as already in the final (scaled /
 * mirrored) coordinate system, i.e. what the viewer showed when the
 * user drew them.
 */

import type {
  AnalyzeOptions,
  BendAnnotation,
  BendLine,
  EntityRole,
  GeometryEntity,
  PartAnnotations,
  PartGeometry,
  Point,
  WeldAnnotation,
} from "./types";
import { IDENTITY, affineCompose, affineScale, dist, transformSegment, type Affine } from "./math";
import { clampTolerance } from "./heal";
import { refreshEntityMetrics } from "./normalise";
import { buildLoops } from "./loops";
import { classify } from "./classify";
import { measure } from "./measure";
import { evaluateTriage } from "./triage";
import { threadForSize } from "./threads";

/* ─── Annotation normalisation ───────────────────────────── */

function polylineLength(points: Point[]): number {
  let l = 0;
  for (let i = 0; i + 1 < points.length; i++) l += dist(points[i], points[i + 1]);
  return l;
}

/** Geometric seam length: stored length, else from points, else from tagged entities. */
export function weldSeamLength(weld: WeldAnnotation, entities: GeometryEntity[] = []): number {
  if (weld.lengthMm > 0) return weld.lengthMm;
  if (weld.points && weld.points.length >= 2) return polylineLength(weld.points);
  const byId = new Map(entities.map((e) => [e.id, e]));
  return weld.entityIds.reduce((acc, id) => acc + (byId.get(id)?.lengthMm ?? 0), 0);
}

/** length × (bead/pitch when stitched) × sides. */
export function weldEffectiveLength(weld: WeldAnnotation, lengthMm = weld.lengthMm): number {
  let factor = 1;
  if (weld.pattern === "stitch" && weld.stitch && weld.stitch.pitchMm > 0) {
    factor = Math.min(1, Math.max(0, weld.stitch.beadLengthMm / weld.stitch.pitchMm));
  }
  return lengthMm * factor * weld.sides;
}

/** Copy of the annotations with derived numbers (bend/weld lengths) recomputed. */
export function normalizeAnnotations(annotations: PartAnnotations, entities: GeometryEntity[] = []): PartAnnotations {
  const bends = annotations.bends.map((b) => {
    const l = dist(b.start, b.end);
    return { ...b, lengthMm: l > 0 ? l : b.lengthMm };
  });
  const welds = annotations.welds.map((w) => {
    const lengthMm = weldSeamLength(w, entities);
    return { ...w, lengthMm, effectiveLengthMm: weldEffectiveLength(w, lengthMm) };
  });
  return { ...annotations, bends, welds };
}

/* ─── Bend lines from annotations ────────────────────────── */

export function bendLineFromAnnotation(b: BendAnnotation, entities: GeometryEntity[]): BendLine {
  const e = b.entityId ? entities.find((x) => x.id === b.entityId) : undefined;
  return {
    id: b.id,
    entityId: b.entityId,
    layer: e?.layer ?? null,
    direction: b.direction,
    start: { ...b.start },
    end: { ...b.end },
    lengthMm: b.lengthMm,
    source: "drawn",
  };
}

/* ─── Entry point ────────────────────────────────────────── */

export function applyAnnotationsSync(
  geometry: PartGeometry,
  annotations: PartAnnotations,
  options: AnalyzeOptions = {}
): PartGeometry {
  const tol = clampTolerance(options.toleranceMm ?? geometry.healing.toleranceMm);
  const ann = normalizeAnnotations(annotations, geometry.entities);
  const overrides: Record<string, EntityRole> = {};
  for (const [id, v] of Object.entries(ann.entities)) if (v && v.role) overrides[id] = v.role;

  // 1. Deletions (entity ids or loop ids of the input geometry).
  const deleted = new Set(ann.deletedEntityIds);
  let entities = geometry.entities.filter((e) => !deleted.has(e.id) && !(e.loopId && deleted.has(e.loopId)));

  // 2. Scale + mirror.
  const factor = ann.scale && Number.isFinite(ann.scale.factor) && ann.scale.factor > 0 ? ann.scale.factor : 1;
  let m: Affine = IDENTITY;
  if (factor !== 1) m = affineScale(factor, factor);
  if (ann.mirrored) m = affineCompose(affineScale(-1, 1), m);
  if (m !== IDENTITY) {
    entities = entities.map((e) =>
      refreshEntityMetrics({
        ...e,
        segments: e.segments.flatMap((s) => transformSegment(s, m).segments),
      })
    );
  }

  // 3. Reset roles: override > layer > unknown (classification decides the rest).
  entities = entities.map((e) => ({
    ...e,
    role: overrides[e.id] ?? e.roleFromLayer ?? "unknown",
    loopId: null,
  }));

  // 4. Chain, classify, measure.
  const chained = buildLoops(entities, tol);
  const classified = classify(chained.entities, chained.loops, { roleOverrides: overrides });
  const thicknessMm = options.thicknessMm !== undefined ? options.thicknessMm : geometry.material.thicknessMm;
  const densityKgM3 = options.densityKgM3 !== undefined ? options.densityKgM3 : geometry.material.densityKgM3;
  const measures = measure(classified.entities, classified.loops, {
    partIndex: options.partIndex,
    blankMarginMm: options.blankMarginMm ?? geometry.measures.blank.marginMm,
    thicknessMm,
    densityKgM3,
  });

  // 5. Bend lines: layer/tagged ones from measure, drawn ones from annotations.
  const bendLines: BendLine[] = measures.bendLines.map((b) =>
    b.entityId && overrides[b.entityId] ? { ...b, source: "drawn" } : b
  );
  for (const b of ann.bends) {
    const line = bendLineFromAnnotation(b, classified.entities);
    const idx = b.entityId ? bendLines.findIndex((x) => x.entityId === b.entityId) : -1;
    if (idx >= 0) bendLines[idx] = line;
    else bendLines.push(line);
  }

  // 6. Welds.
  const weldLengthMm = ann.welds.reduce((acc, w) => acc + w.effectiveLengthMm, 0);

  // 7. Thread confirmations.
  const holes = measures.holes.map((h) => {
    if (!(h.loopId in ann.threads)) return h;
    const size = ann.threads[h.loopId];
    return { ...h, thread: size ? threadForSize(size, h.diameterMm) : null };
  });

  // 8. Triage with the amber answers.
  const formingAnswered = ann.forming !== null || ann.roll !== null || ann.bends.length > 0;
  const triage = evaluateTriage({
    entities: classified.entities,
    loops: classified.loops,
    header: geometry.header,
    dropped: geometry.dropped,
    partCount: classified.partCount,
    name: options.name,
    pdfText: options.pdfText,
    unitsConfirmed: ann.unitsConfirmed,
    formingAnswered,
  });

  return {
    ...geometry,
    entities: classified.entities,
    loops: classified.loops,
    outerLoopId: classified.outerLoopId,
    measures: { ...measures, bendLines, holes, weldLengthMm },
    healing: { ...geometry.healing, toleranceMm: tol },
    triage,
    partCount: classified.partCount,
    material: { thicknessMm: thicknessMm ?? null, densityKgM3: densityKgM3 ?? null },
  };
}
