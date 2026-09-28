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
  /** STEP sheet parts: read from the model (lib/geometry/step/sheet.ts); absent for DXF lines. */
  angleDeg?: number;
  innerRadiusMm?: number;
  allowanceMm?: number;
  allowanceSource?: BendAllowanceSource;
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
  | "red_no_closed_contour"
  /** STEP model that is not a flat sheet (bent, several bodies, no solid): enter the flat pattern by hand. */
  | "red_step_manual";

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
  | "multi_part"
  | "step_not_flat"
  | "step_multi_body"
  | "step_no_geometry";

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
  /** STEP sheet-metal parts only: what the model held beyond the flat pattern (sheet.ts). */
  sheet?: SheetReport;
};

/* ─── Sheet-metal report (STEP) ───────────────────────────── */

/** Where a bend allowance came from: a test bend of ours, a DIN 6935 table row, or the DIN formula itself. */
export type BendAllowanceSource = "test_bend" | "din6935_table" | "din6935_formula";

/** One row of the admin bend table (bend_table), as the engine receives it — never read from the DB here. */
export type BendTableRow = {
  materialFamily: string;
  thicknessMm: number;
  innerRadiusMm: number;
  vDieMm: number | null;
  angleDeg: number;
  bendAllowanceMm: number;
  source: "din6935" | "test_bend";
};

/** Bend table handed to the engine: the rows of the pinned version plus the part's material family. */
export type BendTableLookup = {
  materialFamily: string | null;
  rows: readonly BendTableRow[];
};

/** Admin mapping of a hardware PRODUCT name (substring, case-insensitive) to a hardware line. */
export type HardwareNameRule = {
  pattern: string;
  kind: HardwareKind;
  size: string;
  /** rate_feature code the line is priced with, or null (not benchmarked). */
  featureCode: string | null;
};

export type HardwareKind = "weld_stud" | "insert" | "unknown";

export type SheetBend = {
  id: string;
  start: Point;
  end: Point;
  lengthMm: number;
  angleDeg: number;
  innerRadiusMm: number;
  allowanceMm: number;
  allowanceSource: BendAllowanceSource;
  direction: "up" | "down";
  /** Flat-pattern coordinates of the strip: the two tangent lines (start/end of each). */
  strip: { a1: Point; a2: Point; t1: Point; t2: Point };
  /** Outside dimension of the flange placed through this bend, perpendicular to the bend line (mm). */
  flangeOutsideMm: number | null;
  /** The flange placed before this bend (the side already unfolded). */
  baseFlangeOutsideMm: number | null;
  /** Flange indices of the model (the two flanges the bend joins), for rules that need the shared flange. */
  fromFlange: number;
  toFlange: number;
};

export type HardwareLine = {
  kind: HardwareKind;
  /** e.g. "M4", "M3x8"; null when unknown. */
  size: string | null;
  qty: number;
  featureCode: string | null;
  /** Name from the STEP product, or null for unnamed bodies. */
  productName: string | null;
  source: "name" | "geometry";
  /** Positions in flat-pattern coordinates when they could be mapped. */
  positions: Point[];
  /** Diameter / length measured on the body (mm), for the report. */
  diameterMm: number | null;
  lengthMm: number | null;
};

export type MaskingZone = {
  kind: "recess" | "split_face";
  /** Outline in flat-pattern coordinates. */
  polygon: Point[];
  areaMm2: number;
  /** True when the drawing text names paint masking. */
  confirmed: boolean;
};

export type CountersinkInfo = {
  center: Point;
  throughDiameterMm: number;
  topDiameterMm: number;
  depthMm: number;
  /** Which sheet side carries the cone: the unfolded (outside) face or the other. */
  side: "outside" | "inside";
  featureCode: string | null;
};

export type BlindPocket = {
  center: Point;
  maxSideMm: number;
  depthMm: number;
  circular: boolean;
};

/** A slit or corner relief next to a bend strip end (flat coordinates). */
export type ReliefInfo = {
  bendId: string;
  end: "start" | "end";
  widthMm: number;
  depthMm: number;
  /** Centre of the relief mouth. */
  at: Point;
  /** Ids of the two parallel outline entities that form the slit. */
  entityIds: string[];
};

export type SheetReport = {
  version: 1;
  thicknessMm: number;
  /** How the sheet body was told apart from hardware; false → the file held no sheet body. */
  isSheetMetal: boolean;
  bends: SheetBend[];
  hardware: HardwareLine[];
  /** Stud seat centres (blind pockets ≤ the seat depth), on the IGNORE layer of the production DXF. */
  studPositions: Point[];
  maskingZones: MaskingZone[];
  countersinks: CountersinkInfo[];
  /** Blind pockets that are neither seats nor masking recesses (the laser cannot make them). */
  blindPockets: BlindPocket[];
  /** Hole walls with a helical / free-form surface (modelled threads). */
  helicalHoles: Point[];
  reliefs: ReliefInfo[];
  /** Volume of the sheet body in the model (mm³), null when a face could not be integrated. */
  solidVolumeMm3: number | null;
  /** Net flat area × thickness (mm³). */
  flatVolumeMm3: number;
  /** Bodies in the file that were taken as hardware. */
  hardwareBodies: number;
  /** Product name of the sheet body, when the file had one. */
  productName: string | null;
  /** Cross-checks against the companion drawing text, when one was given. */
  drawing?: DrawingCrossCheck | null;
};

export type DrawingCrossCheck = {
  /** Revision letter in the file name ("M040120_G" → "G"). */
  fileRevision: string | null;
  /** Latest revision letter of the drawing's revision table. */
  drawingRevision: string | null;
  material: string | null;
  finish: string | null;
  hardwareMismatches: { kind: HardwareKind; size: string; drawingQty: number; modelQty: number }[];
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
  /**
   * STEP sheet parts: the RELIEF_TOO_NARROW proposed fix (widen to t, deepen
   * to the bend tangent + t) is applied to the flat pattern. Set by the
   * approval of that override (lib/parts/relief-fix.ts), never by hand.
   */
  reliefFix?: boolean;
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
  /** STEP: bend allowances of the pinned bend-table version (else the DIN 6935 formula). */
  bendTable?: BendTableLookup | null;
  /** STEP: admin name → hardware mapping for the PRODUCT names of hardware bodies. */
  hardwareNames?: readonly HardwareNameRule[];
  /** STEP: the drawing text (parts list, revision table) for the cross-checks. */
  drawingText?: string | null;
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

/** One part of a STEP / IFC file (a solid or an IFC element), analysed. */
export type ModelPart = {
  /** Product / element name from the file, or a numbered fallback. */
  name: string;
  /** Placements of this part in the assembly (quote item quantity). */
  occurrences: number;
  /**
   * STEP text holding just this part, to be stored as the part's file;
   * null when the source file already holds only this part.
   */
  stepText: string | null;
  geometry: PartGeometry;
  /** Representation items that could not be converted (IFC), or reader warnings. */
  warnings: string[];
};

export type SplitModel = {
  format: "step" | "ifc";
  parts: ModelPart[];
  warnings: string[];
};

/**
 * The engine boundary. The TypeScript implementation lives in
 * lib/geometry/engine.ts; a Python/ezdxf service can implement the same
 * three calls over HTTP without touching the rest of the app.
 */
export interface GeometryEngine {
  /** Parse + normalise + heal + chain + classify + measure + triage a DXF. */
  analyzeDxf(dxfText: string, options?: AnalyzeOptions): Promise<PartGeometry>;
  /**
   * STEP model → flat pattern through the same pipeline when the body is a
   * flat sheet; otherwise a geometry without entities in state
   * red_step_manual carrying thickness / bends / size in triage.details.
   */
  analyzeStep(stepText: string, options?: AnalyzeOptions): Promise<PartGeometry>;
  /**
   * STEP or IFC file → one part per body / element: assemblies are split,
   * each part analysed like a single STEP (flat pattern, unfold or manual).
   */
  splitModel(text: string, options?: AnalyzeOptions): Promise<SplitModel>;
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
