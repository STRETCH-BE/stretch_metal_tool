/**
 * Geometry engine — shared types (the contract between the DXF pipeline,
 * the viewer, the pricing engine and the database `parts.geometry` /
 * `parts.annotations` JSON columns).
 * File path: /lib/geometry/types.ts
 *
 * Units: every length is millimetres, every area mm², every angle
 * DEGREES (DXF convention, counter-clockwise from +X). Money never
 * appears here. No `any` — this file is consumed by the engine, which
 * lint forbids from using `any`.
 *
 * Stability: `PartGeometry.version` is bumped when the JSON shape stored
 * on `parts.geometry` changes incompatibly; old quotes keep their stored
 * snapshot and are never re-analysed.
 */

/* ─── Primitives ──────────────────────────────────────────── */

export type Point = { x: number; y: number };

export type Bbox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** maxX − minX */
  width: number;
  /** maxY − minY */
  height: number;
};

/** Straight segment. */
export type LineSegment = {
  kind: "line";
  start: Point;
  end: Point;
};

/**
 * Circular arc, always stored counter-clockwise from `startAngleDeg` to
 * `endAngleDeg` (DXF convention). `start`/`end` are the derived endpoints
 * so chaining code can treat every segment alike; `sweepDeg` is the
 * positive CCW sweep (0 < sweep ≤ 360).
 */
export type ArcSegment = {
  kind: "arc";
  center: Point;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  sweepDeg: number;
  start: Point;
  end: Point;
};

/** Full circle — a closed loop on its own, never chained. */
export type CircleSegment = {
  kind: "circle";
  center: Point;
  radius: number;
};

export type Segment = LineSegment | ArcSegment | CircleSegment;

/* ─── Entities ────────────────────────────────────────────── */

export type DxfEntityType =
  | "LINE"
  | "ARC"
  | "CIRCLE"
  | "LWPOLYLINE"
  | "POLYLINE"
  | "SPLINE"
  | "ELLIPSE"
  | "INSERT"
  | "MANUAL"
  | "DRAWN";

/**
 * Role of an entity in the part. `cut` and `hole` are both cut with the
 * laser; `hole` is assigned to interior closed loops so the viewer can
 * colour them differently. `unknown` = open chain inside the outline that
 * nobody has classified yet (a bend candidate).
 */
export type EntityRole =
  | "cut"
  | "hole"
  | "bend_up"
  | "bend_down"
  | "weld"
  | "engrave"
  | "ignore"
  | "unknown";

export type GeometryEntity = {
  /**
   * Stable id — hash of (type + rounded geometry), NOT the DXF handle, so
   * re-uploading the same file yields the same ids and stored annotations
   * re-attach. Unique within a part (collisions get a numeric suffix).
   */
  id: string;
  /** DXF handle (group 5) when present — informational only. */
  handle?: string;
  layer: string;
  linetype?: string;
  /** AutoCAD colour index (group 62) when present. */
  color?: number;
  originalType: DxfEntityType;
  /** Polylines / flattened curves carry many segments; LINE/ARC/CIRCLE one. */
  segments: Segment[];
  /** True for CIRCLE and closed polylines. */
  closed: boolean;
  /** Total length of all segments. */
  lengthMm: number;
  bbox: Bbox;
  /** Role implied by the layer name (layer-conventions.ts), before geometry. */
  roleFromLayer: EntityRole | null;
  /** Effective role after classification (layer → geometry heuristics). */
  role: EntityRole;
  /** Loop this entity belongs to after chaining, if any. */
  loopId: string | null;
  /** True when the healer altered this entity (snapped an endpoint, …). */
  healed?: boolean;
};

/* ─── Loops ───────────────────────────────────────────────── */

export type LoopKind =
  | "outer"
  | "hole"
  | "open_chain"
  | "other_part"
  | "frame"
  | "noise";

export type Loop = {
  id: string;
  /** Entity ids in chain order. */
  entityIds: string[];
  closed: boolean;
  /** Absolute enclosed area (0 for open chains). Exact for arcs. */
  areaMm2: number;
  perimeterMm: number;
  bbox: Bbox;
  /** Flattened polygon/polyline (≤ 0.05 mm chord error) for hit tests. */
  points: Point[];
  kind: LoopKind;
  /** Set for CIRCLE entities and near-circular closed loops. */
  circle?: { center: Point; diameterMm: number };
  /** Multi-part files: index of the part group this loop belongs to. */
  partIndex: number;
};

/* ─── Measures ────────────────────────────────────────────── */

export type ThreadSuggestion = {
  /** e.g. "M8", "M10x1" */
  size: string;
  pitchMm: number;
  /** ISO minor diameter D1 = d − 1.0825·P */
  minorDiameterMm: number;
  tapDrillMm: number;
  matchedBy: "minor_diameter" | "tap_drill";
  /** |hole diameter − matched value| */
  deviationMm: number;
};

export type HoleInfo = {
  loopId: string;
  center: Point;
  diameterMm: number;
  /** True for CIRCLE entities and loops within 1 % of a circle. */
  circular: boolean;
  /** Max side of the hole bbox — used for slow-contour detection. */
  maxSideMm: number;
  thread: ThreadSuggestion | null;
};

export type BendDirection = "up" | "down" | "unknown";

export type BendLine = {
  id: string;
  /** Source entity when the bend comes from the file. */
  entityId: string | null;
  layer: string | null;
  direction: BendDirection;
  start: Point;
  end: Point;
  lengthMm: number;
  /** Layer-named, user-drawn, or a heuristic candidate awaiting an answer. */
  source: "layer" | "drawn" | "candidate";
};

export type SlowContour = {
  loopId: string;
  maxSideMm: number;
  lengthMm: number;
};

export type PartMeasures = {
  /** Outer contour + every hole + open cuts answered "cut" (mm). */
  cutLengthMm: number;
  outerLengthMm: number;
  holesLengthMm: number;
  /** 1 (outer) + number of holes. */
  pierces: number;
  bbox: Bbox;
  /** Bbox + 2 × blank margin on each axis. */
  blank: { lengthMm: number; widthMm: number; marginMm: number };
  outerAreaMm2: number;
  holesAreaMm2: number;
  /** outer − holes */
  netAreaMm2: number;
  /** Only when thickness + density were supplied to the engine. */
  massKg: number | null;
  holes: HoleInfo[];
  bendLines: BendLine[];
  /** Max side of the smallest interior closed contour, null without holes. */
  smallestContourMm: number | null;
  /** Interior loops whose bbox max side < 10 × thickness (needs thickness). */
  slowContours: SlowContour[];
  /** Engraving/marking length from tagged entities. */
  engraveLengthMm: number;
  /**
   * Open chains inside the part the user answered "cut" (slits, open
   * cuts): their length is included in `cutLengthMm` and each chain adds
   * one pierce. Optional so snapshots written before these fields
   * existed still type-check (absent = 0).
   */
  openCutsLengthMm?: number;
  openCuts?: number;
  /**
   * Sum of `effectiveLengthMm` of the weld annotations applied to this
   * geometry (0 when no annotations were applied). Optional so stored
   * snapshots written before this field existed still type-check.
   */
  weldLengthMm?: number;
};

/* ─── Reports ─────────────────────────────────────────────── */

export type HealingReport = {
  toleranceMm: number;
  gapsJoined: number;
  duplicatesRemoved: number;
  overlapsRemoved: number;
  zeroLengthRemoved: number;
  splinesFlattened: number;
  ellipsesFlattened: number;
  blocksExploded: number;
  /** Loops closed by snapping their last endpoint to the first. */
  loopsClosed: number;
};

export type DroppedEntity = {
  /** DXF entity type, e.g. "POINT", "TEXT", "DIMENSION", "HATCH". */
  type: string;
  layer: string;
  count: number;
  /** Why: not geometry, zero length, ignored layer, unsupported type. */
  reason: "not_geometry" | "zero_length" | "ignored_layer" | "unsupported";
};

export type UnitsInfo = {
  /** Raw $INSUNITS (4 = mm, 1 = inch, 0/missing = unitless). */
  insunits: number | null;
  detected: "mm" | "inch" | "unknown";
  /** Factor applied to every coordinate (25.4 for inch files, else 1). */
  scaleApplied: number;
};

export type DxfHeaderInfo = {
  /** $ACADVER, e.g. "AC1018" */
  version: string | null;
  units: UnitsInfo;
  extmin: Point | null;
  extmax: Point | null;
  /** Layer names present in the file (TABLES + entities). */
  layers: string[];
};

/* ─── Triage ──────────────────────────────────────────────── */

export type TriageState =
  | "green"
  | "amber_bend_candidates"
  | "amber_forming_unknown"
  | "amber_units"
  | "red_drawing_sheet"
  | "red_no_closed_contour";

export type TriageReasonCode =
  | "bend_layers_found"
  | "no_interior_open_lines"
  | "interior_open_lines"
  | "forming_hint_in_name"
  | "forming_hint_in_pdf"
  | "units_missing"
  | "units_inch"
  | "extents_mismatch"
  | "dimension_text_heavy"
  | "multiple_view_clusters"
  | "no_closed_contour"
  | "multi_part";

export type Triage = {
  state: TriageState;
  reasons: TriageReasonCode[];
  /** Entity ids the amber question is about ("these N lines"). */
  candidateEntityIds: string[];
  /** Numbers the UI interpolates into the message (counts, sizes). */
  details: Record<string, number | string>;
};

/* ─── The stored geometry object ──────────────────────────── */

export type GeometrySource =
  | "dxf"
  | "manual"
  | "welding_drawing"
  | "step"
  | "pdf";

export type PartGeometry = {
  version: 1;
  source: GeometrySource;
  header: DxfHeaderInfo;
  entities: GeometryEntity[];
  loops: Loop[];
  /** Largest closed loop of part group 0, or null (red_no_closed_contour). */
  outerLoopId: string | null;
  measures: PartMeasures;
  healing: HealingReport;
  dropped: DroppedEntity[];
  triage: Triage;
  /** Number of separate part groups found (1 for a normal file). */
  partCount: number;
  /** Thickness/density the measures were computed with, if any. */
  material: { thicknessMm: number | null; densityKgM3: number | null };
};

/* ─── Annotations (user edits, stored on parts.annotations) ─ */

export type WeldProcess = "mig_mag" | "tig" | "laser" | "mma";

export type BendAnnotation = {
  id: string;
  /** Entity the bend was tagged on, or null when drawn. */
  entityId: string | null;
  start: Point;
  end: Point;
  lengthMm: number;
  angleDeg: number;
  /** Inside radius; defaults to thickness when omitted. */
  radiusMm: number | null;
  direction: "up" | "down";
  /** Optional die opening chosen by the user; default 8 × t. */
  dieVMm: number | null;
};

export type WeldAnnotation = {
  id: string;
  /** Tagged entities (chain) — or two clicked points. */
  entityIds: string[];
  points: Point[] | null;
  /** Geometric length of the seam path. */
  lengthMm: number;
  process: WeldProcess;
  beadMm: number;
  pattern: "full" | "stitch";
  stitch: { beadLengthMm: number; pitchMm: number } | null;
  sides: 1 | 2;
  /** length × (bead/pitch for stitch) × sides — computed, stored for audit. */
  effectiveLengthMm: number;
};

export type RollAnnotation = {
  radiusMm: number;
  axis: "x" | "y";
  arcAngleDeg: number;
  /** Length of the roll axis (the straight dimension). */
  axisLengthMm: number;
  /** Developed width across the roll (the curved dimension). */
  developedWidthMm: number;
  /** Prefilled when the outline is an annular sector. */
  cone: {
    innerRadiusMm: number;
    outerRadiusMm: number;
    sweepDeg: number;
  } | null;
};

export type ScaleAnnotation = {
  factor: number;
  from: Point;
  to: Point;
  measuredMm: number;
  realMm: number;
};

export type PartAnnotations = {
  version: 1;
  /** Per-entity role overrides keyed by stable entity id. */
  entities: Record<string, { role: EntityRole }>;
  bends: BendAnnotation[];
  welds: WeldAnnotation[];
  roll: RollAnnotation | null;
  scale: ScaleAnnotation | null;
  /** Thread confirmation per hole loop id: size, or null = "no thread". */
  threads: Record<string, string | null>;
  /** Amber answers */
  unitsConfirmed: boolean;
  forming: "flat" | "bent" | "rolled" | null;
  /** Loop ids the user removed ("delete selection") — hidden and unpriced. */
  deletedEntityIds: string[];
  /** Whether the outline was mirrored by the clean-up tool. */
  mirrored: boolean;
};

export const EMPTY_ANNOTATIONS: PartAnnotations = {
  version: 1,
  entities: {},
  bends: [],
  welds: [],
  roll: null,
  scale: null,
  threads: {},
  unitsConfirmed: false,
  forming: null,
  deletedEntityIds: [],
  mirrored: false,
};

/* ─── Engine interface ────────────────────────────────────── */

export type AnalyzeOptions = {
  /** Endpoint snap tolerance (default 0.01, UI allows up to 0.5). */
  toleranceMm?: number;
  /** Blank margin added on every side of the bbox (from rate_general). */
  blankMarginMm?: number;
  thicknessMm?: number | null;
  densityKgM3?: number | null;
  /** Part name / file name — forming hints ("bent", "gięty", …). */
  name?: string;
  /** Companion PDF text — forming hints for the amber_forming_unknown rule. */
  pdfText?: string | null;
  /** Optional layer-convention override (admin-edited in a later phase). */
  layerConventions?: LayerConventions;
  /**
   * Multi-part files: which part group the measures are computed for
   * (default 0 = largest outline). Loops keep their own `partIndex`.
   */
  partIndex?: number;
};

export type LayerConventions = {
  bendUp: string[];
  bendDown: string[];
  ignore: string[];
  engrave: string[];
  weld: string[];
  cut: string[];
};

export type QuickPartInput = {
  name: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  densityKgM3: number | null;
  holes: { diameterMm: number; count: number }[];
  bends: { lengthMm: number; angleDeg: number; count: number }[];
  roll: { radiusMm: number; axisLengthMm: number } | null;
  blankMarginMm?: number;
};

/**
 * The engine boundary. The TypeScript implementation lives in
 * lib/geometry/engine.ts; a Python/ezdxf service can implement the same
 * three calls over HTTP without touching the rest of the app.
 */
export interface GeometryEngine {
  /** Parse + normalise + heal + chain + classify + measure + triage a DXF. */
  analyzeDxf(dxfText: string, options?: AnalyzeOptions): Promise<PartGeometry>;
  /** Re-run classification/measures with user annotations applied. */
  applyAnnotations(
    geometry: PartGeometry,
    annotations: PartAnnotations,
    options?: AnalyzeOptions
  ): Promise<PartGeometry>;
  /** Build the geometry object for a manually entered part. */
  quickPart(input: QuickPartInput): Promise<PartGeometry>;
  /** Serialise healed geometry + annotations to an annotated DXF. */
  exportAnnotatedDxf(
    geometry: PartGeometry,
    annotations: PartAnnotations
  ): Promise<string>;
}
