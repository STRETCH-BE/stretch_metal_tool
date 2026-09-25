/**
 * Test fixture — builds a complete, valid PartGeometry for a rectangular
 * sheet part WITHOUT the geometry engine, so pricing/UI tests can run
 * while the engine is built in parallel.
 * File path: /test/helpers/geometry.ts
 *
 * The rectangle spans (originX, originY) → (originX + length, originY +
 * width). Holes are circles (entity + hole loop + HoleInfo), bend lines
 * are LINE entities on IV_BEND / IV_BEND_DOWN with a matching BendLine in
 * measures. Measures are computed with the same formulas the engine uses
 * (cut length = perimeter + Σ π d, pierces = 1 + holes, net area = L × W −
 * Σ π d²/4, mass = net area × t × density × 1e-9, slow contours = holes
 * with max side < 10 × t). Triage is green unless overridden.
 */

import {
  EMPTY_ANNOTATIONS,
  type BendLine,
  type Bbox,
  type GeometryEntity,
  type GeometrySource,
  type HoleInfo,
  type Loop,
  type PartAnnotations,
  type PartGeometry,
  type Point,
  type SlowContour,
  type ThreadSuggestion,
  type Triage,
} from "@/lib/geometry/types";

export type RectHole = {
  x: number;
  y: number;
  diameterMm: number;
  thread?: ThreadSuggestion | null;
};

export type RectBendLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  direction: "up" | "down" | "unknown";
  id?: string;
  source?: BendLine["source"];
};

export type RectPartOptions = {
  lengthMm: number;
  widthMm: number;
  thicknessMm: number | null;
  densityKgM3: number | null;
  holes?: RectHole[];
  bendLines?: RectBendLine[];
  name?: string;
  originX?: number;
  originY?: number;
  /** Blank margin the engine was run with (rate_general default 10). */
  blankMarginMm?: number;
  source?: GeometrySource;
  triage?: Partial<Triage>;
  engraveLengthMm?: number;
};

function bboxOf(minX: number, minY: number, maxX: number, maxY: number): Bbox {
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function circlePoints(center: Point, radius: number, n = 24): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n;
    points.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return points;
}

export function makeRectPartGeometry(options: RectPartOptions): PartGeometry {
  const {
    lengthMm,
    widthMm,
    thicknessMm,
    densityKgM3,
    holes = [],
    bendLines = [],
    originX = 0,
    originY = 0,
    blankMarginMm = 10,
    source = "dxf",
    engraveLengthMm = 0,
  } = options;

  const minX = originX;
  const minY = originY;
  const maxX = originX + lengthMm;
  const maxY = originY + widthMm;
  const corners: Point[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  const outerBbox = bboxOf(minX, minY, maxX, maxY);
  const outerPerimeter = 2 * (lengthMm + widthMm);

  const outerEntity: GeometryEntity = {
    id: "outer",
    layer: "IV_OUTER_PROFILE",
    originalType: "LWPOLYLINE",
    segments: corners.map((c, i) => ({
      kind: "line" as const,
      start: c,
      end: corners[(i + 1) % 4],
    })),
    closed: true,
    lengthMm: outerPerimeter,
    bbox: outerBbox,
    roleFromLayer: "cut",
    role: "cut",
    loopId: "loop-outer",
  };
  const outerLoop: Loop = {
    id: "loop-outer",
    entityIds: ["outer"],
    closed: true,
    areaMm2: lengthMm * widthMm,
    perimeterMm: outerPerimeter,
    bbox: outerBbox,
    points: corners,
    kind: "outer",
    partIndex: 0,
  };

  const entities: GeometryEntity[] = [outerEntity];
  const loops: Loop[] = [outerLoop];
  const holeInfos: HoleInfo[] = [];
  let holesLength = 0;
  let holesArea = 0;

  holes.forEach((h, i) => {
    const r = h.diameterMm / 2;
    const center = { x: h.x, y: h.y };
    const bbox = bboxOf(h.x - r, h.y - r, h.x + r, h.y + r);
    const perimeter = Math.PI * h.diameterMm;
    const area = Math.PI * r * r;
    const entityId = `hole-${i + 1}`;
    const loopId = `loop-hole-${i + 1}`;
    entities.push({
      id: entityId,
      layer: "IV_INTERIOR_PROFILES",
      originalType: "CIRCLE",
      segments: [{ kind: "circle", center, radius: r }],
      closed: true,
      lengthMm: perimeter,
      bbox,
      roleFromLayer: "cut",
      role: "hole",
      loopId,
    });
    loops.push({
      id: loopId,
      entityIds: [entityId],
      closed: true,
      areaMm2: area,
      perimeterMm: perimeter,
      bbox,
      points: circlePoints(center, r),
      kind: "hole",
      circle: { center, diameterMm: h.diameterMm },
      partIndex: 0,
    });
    holeInfos.push({
      loopId,
      center,
      diameterMm: h.diameterMm,
      circular: true,
      maxSideMm: h.diameterMm,
      thread: h.thread ?? null,
    });
    holesLength += perimeter;
    holesArea += area;
  });

  const bendInfos: BendLine[] = bendLines.map((b, i) => {
    const id = b.id ?? `bend-${i + 1}`;
    const start = { x: b.x1, y: b.y1 };
    const end = { x: b.x2, y: b.y2 };
    const length = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
    const layer = b.direction === "down" ? "IV_BEND_DOWN" : "IV_BEND";
    const role = b.direction === "down" ? "bend_down" : "bend_up";
    entities.push({
      id,
      layer,
      originalType: "LINE",
      segments: [{ kind: "line", start, end }],
      closed: false,
      lengthMm: length,
      bbox: bboxOf(
        Math.min(b.x1, b.x2),
        Math.min(b.y1, b.y2),
        Math.max(b.x1, b.x2),
        Math.max(b.y1, b.y2)
      ),
      roleFromLayer: role,
      role,
      loopId: null,
    });
    return {
      id,
      entityId: id,
      layer,
      direction: b.direction,
      start,
      end,
      lengthMm: length,
      source: b.source ?? "layer",
    };
  });

  const netArea = lengthMm * widthMm - holesArea;
  const massKg =
    thicknessMm !== null && densityKgM3 !== null
      ? netArea * thicknessMm * densityKgM3 * 1e-9
      : null;
  const slowContours: SlowContour[] =
    thicknessMm !== null
      ? holeInfos
          .filter((h) => h.maxSideMm < 10 * thicknessMm)
          .map((h) => ({
            loopId: h.loopId,
            maxSideMm: h.maxSideMm,
            lengthMm: Math.PI * h.diameterMm,
          }))
      : [];
  const smallest = holeInfos.length
    ? Math.min(...holeInfos.map((h) => h.maxSideMm))
    : null;

  const layers = Array.from(new Set(entities.map((e) => e.layer)));
  const triage: Triage = {
    state: "green",
    reasons: bendInfos.length ? ["bend_layers_found"] : ["no_interior_open_lines"],
    candidateEntityIds: [],
    details: {},
    ...options.triage,
  };

  return {
    version: 1,
    source,
    header: {
      version: "AC1018",
      units: { insunits: 4, detected: "mm", scaleApplied: 1 },
      extmin: { x: minX, y: minY },
      extmax: { x: maxX, y: maxY },
      layers,
    },
    entities,
    loops,
    outerLoopId: "loop-outer",
    measures: {
      cutLengthMm: outerPerimeter + holesLength,
      outerLengthMm: outerPerimeter,
      holesLengthMm: holesLength,
      pierces: 1 + holes.length,
      bbox: outerBbox,
      blank: {
        lengthMm: lengthMm + 2 * blankMarginMm,
        widthMm: widthMm + 2 * blankMarginMm,
        marginMm: blankMarginMm,
      },
      outerAreaMm2: lengthMm * widthMm,
      holesAreaMm2: holesArea,
      netAreaMm2: netArea,
      massKg,
      holes: holeInfos,
      bendLines: bendInfos,
      smallestContourMm: smallest,
      slowContours,
      engraveLengthMm,
    },
    healing: {
      toleranceMm: 0.01,
      gapsJoined: 0,
      duplicatesRemoved: 0,
      overlapsRemoved: 0,
      zeroLengthRemoved: 0,
      splinesFlattened: 0,
      ellipsesFlattened: 0,
      blocksExploded: 0,
      loopsClosed: 0,
    },
    dropped: [],
    triage,
    partCount: 1,
    material: { thicknessMm, densityKgM3 },
  };
}

/** Annotations with defaults — spread your edits over EMPTY_ANNOTATIONS. */
export function makeAnnotations(overrides: Partial<PartAnnotations> = {}): PartAnnotations {
  return { ...structuredClone(EMPTY_ANNOTATIONS), ...overrides };
}
