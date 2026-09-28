/**
 * Geometry engine — annotated DXF export.
 * File path: /lib/geometry/export-dxf.ts
 *
 * Writes the healed geometry with the user's annotations applied as an
 * ASCII DXF on our published layers (CUT, HOLES, BEND_UP, BEND_DOWN,
 * WELD, ENGRAVE, IGNORE). Entity set is LINE/ARC/CIRCLE only — flattened
 * curves are already line chains — so every CAM package reads it. The
 * file is written in the R12 dialect (AC1009: no handles, no
 * dictionaries) plus $INSUNITS, which every reader ignores or honours;
 * it round-trips through our own parser (test/geometry/export.test.ts).
 * Deleted entities are omitted, ignored/unknown roles land on IGNORE,
 * drawn bends and point-based welds are written as LINEs.
 *
 * The PRODUCTION DXF of a STEP sheet part (writeProductionDxf) is the
 * flat pattern on our shop layers — CUT for outline and holes (never a
 * HOLES layer), BEND_UP / BEND_DOWN for the bend lines, IGNORE for the
 * stud-position marks — written as AC1018 (AutoCAD 2004) with handles,
 * the block records and the root dictionary that dialect requires, and
 * $INSUNITS = 4. Viewed from the side the flanges bend towards (the
 * unfold already lays it out that way).
 */

import type { EntityRole, PartAnnotations, PartGeometry, Point, Segment } from "./types";
import { EXPORT_LAYER_FOR_ROLE } from "./layer-conventions";
import { applyAnnotationsSync } from "./annotate";
import { bboxUnionAll, segmentBbox } from "./math";

type LayerDef = { name: string; color: number; linetype: string };

export const EXPORT_LAYERS: LayerDef[] = [
  { name: "CUT", color: 7, linetype: "CONTINUOUS" },
  { name: "HOLES", color: 8, linetype: "CONTINUOUS" },
  { name: "BEND_UP", color: 1, linetype: "CONTINUOUS" },
  { name: "BEND_DOWN", color: 1, linetype: "DASHED" },
  { name: "WELD", color: 2, linetype: "CONTINUOUS" },
  { name: "ENGRAVE", color: 8, linetype: "CONTINUOUS" },
  { name: "IGNORE", color: 9, linetype: "CONTINUOUS" },
];

function num(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const s = v.toFixed(9).replace(/\.?0+$/, "");
  return s === "" || s === "-0" ? "0" : s.includes(".") ? s : `${s}.0`;
}

class DxfWriter {
  private lines: string[] = [];
  g(code: number, value: string | number): void {
    this.lines.push(String(code).padStart(3, " "));
    this.lines.push(typeof value === "number" ? num(value) : value);
  }
  point(base: number, p: Point): void {
    this.g(base, p.x);
    this.g(base + 10, p.y);
    this.g(base + 20, 0);
  }
  text(): string {
    return this.lines.join("\r\n") + "\r\n";
  }
}

function writeSegment(w: DxfWriter, seg: Segment, layer: string): void {
  switch (seg.kind) {
    case "line":
      w.g(0, "LINE");
      w.g(8, layer);
      w.point(10, seg.start);
      w.point(11, seg.end);
      break;
    case "arc":
      w.g(0, "ARC");
      w.g(8, layer);
      w.point(10, seg.center);
      w.g(40, seg.radius);
      w.g(50, seg.startAngleDeg);
      w.g(51, seg.endAngleDeg);
      break;
    case "circle":
      w.g(0, "CIRCLE");
      w.g(8, layer);
      w.point(10, seg.center);
      w.g(40, seg.radius);
      break;
  }
}

export function exportAnnotatedDxf(geometry: PartGeometry, annotations: PartAnnotations): string {
  const applied = applyAnnotationsSync(geometry, annotations);
  const entities = applied.entities;
  const bbox = entities.length > 0 ? bboxUnionAll(entities.flatMap((e) => e.segments.map(segmentBbox))) : applied.measures.bbox;

  const w = new DxfWriter();
  // HEADER
  w.g(0, "SECTION");
  w.g(2, "HEADER");
  w.g(9, "$ACADVER");
  w.g(1, "AC1009");
  w.g(9, "$INSUNITS");
  w.g(70, "4");
  w.g(9, "$EXTMIN");
  w.point(10, { x: bbox.minX, y: bbox.minY });
  w.g(9, "$EXTMAX");
  w.point(10, { x: bbox.maxX, y: bbox.maxY });
  w.g(0, "ENDSEC");

  // TABLES
  w.g(0, "SECTION");
  w.g(2, "TABLES");
  w.g(0, "TABLE");
  w.g(2, "LTYPE");
  w.g(70, "2");
  w.g(0, "LTYPE");
  w.g(2, "CONTINUOUS");
  w.g(70, "0");
  w.g(3, "Solid line");
  w.g(72, "65");
  w.g(73, "0");
  w.g(40, 0);
  w.g(0, "LTYPE");
  w.g(2, "DASHED");
  w.g(70, "0");
  w.g(3, "Dashed __ __ __");
  w.g(72, "65");
  w.g(73, "2");
  w.g(40, 0.75);
  w.g(49, 0.5);
  w.g(49, -0.25);
  w.g(0, "ENDTAB");
  w.g(0, "TABLE");
  w.g(2, "LAYER");
  w.g(70, String(EXPORT_LAYERS.length));
  for (const l of EXPORT_LAYERS) {
    w.g(0, "LAYER");
    w.g(2, l.name);
    w.g(70, "0");
    w.g(62, String(l.color));
    w.g(6, l.linetype);
  }
  w.g(0, "ENDTAB");
  w.g(0, "ENDSEC");

  // BLOCKS (empty)
  w.g(0, "SECTION");
  w.g(2, "BLOCKS");
  w.g(0, "ENDSEC");

  // ENTITIES
  w.g(0, "SECTION");
  w.g(2, "ENTITIES");
  for (const e of entities) {
    const layer = EXPORT_LAYER_FOR_ROLE[e.role] ?? "IGNORE";
    for (const s of e.segments) writeSegment(w, s, layer);
  }
  const drawnBends = applied.measures.bendLines.filter((b) => b.entityId === null);
  for (const b of drawnBends) {
    writeSegment(w, { kind: "line", start: b.start, end: b.end }, b.direction === "down" ? "BEND_DOWN" : "BEND_UP");
  }
  for (const weld of annotations.welds) {
    if (!weld.points || weld.points.length < 2) continue;
    for (let i = 0; i + 1 < weld.points.length; i++) {
      writeSegment(w, { kind: "line", start: weld.points[i], end: weld.points[i + 1] }, "WELD");
    }
  }
  w.g(0, "ENDSEC");
  w.g(0, "EOF");
  return w.text();
}

/* ─── Production DXF (AC1018) ──────────────────────────────── */

const PRODUCTION_LAYERS: LayerDef[] = [
  { name: "CUT", color: 7, linetype: "CONTINUOUS" },
  { name: "BEND_UP", color: 1, linetype: "CONTINUOUS" },
  { name: "BEND_DOWN", color: 1, linetype: "DASHED" },
  { name: "IGNORE", color: 9, linetype: "CONTINUOUS" },
];

/** Layer of a role on the production drawing: everything cut is CUT. */
export const PRODUCTION_LAYER_FOR_ROLE: Record<EntityRole, string> = {
  cut: "CUT",
  hole: "CUT",
  bend_up: "BEND_UP",
  bend_down: "BEND_DOWN",
  weld: "IGNORE",
  engrave: "IGNORE",
  ignore: "IGNORE",
  unknown: "IGNORE",
};

class HandleWriter extends DxfWriter {
  private next = 0x100;
  handle(): string {
    return (this.next++).toString(16).toUpperCase();
  }
  seed(): string {
    return (this.next + 0x100).toString(16).toUpperCase();
  }
}

function tableRecord(w: HandleWriter, type: string, name: string, ownerHandle: string, subclass: string, extra: () => void): void {
  w.g(0, type);
  w.g(5, w.handle());
  w.g(330, ownerHandle);
  w.g(100, "AcDbSymbolTableRecord");
  w.g(100, subclass);
  w.g(2, name);
  w.g(70, "0");
  extra();
}

function table(w: HandleWriter, name: string, count: number, body: (ownerHandle: string) => void): void {
  const handle = w.handle();
  w.g(0, "TABLE");
  w.g(2, name);
  w.g(5, handle);
  w.g(330, "0");
  w.g(100, "AcDbSymbolTable");
  w.g(70, String(count));
  body(handle);
  w.g(0, "ENDTAB");
}

export type ProductionDxfOptions = {
  /** Text placed in the file's comment (part name, revision). */
  title?: string;
};

/**
 * Production DXF of a flat pattern: AC1018, mm, layers CUT / BEND_UP /
 * BEND_DOWN / IGNORE. Uses the geometry as stored (annotations applied by
 * the caller when needed) plus the drawn bend lines of the annotations.
 */
export function writeProductionDxf(geometry: PartGeometry, annotations: PartAnnotations, options: ProductionDxfOptions = {}): string {
  const applied = applyAnnotationsSync(geometry, annotations);
  const entities = applied.entities;
  const bbox = entities.length > 0 ? bboxUnionAll(entities.flatMap((e) => e.segments.map(segmentBbox))) : applied.measures.bbox;

  const w = new HandleWriter();
  if (options.title) {
    w.g(999, options.title);
  }
  // HEADER
  w.g(0, "SECTION");
  w.g(2, "HEADER");
  w.g(9, "$ACADVER");
  w.g(1, "AC1018");
  w.g(9, "$HANDSEED");
  w.g(5, w.seed());
  w.g(9, "$INSUNITS");
  w.g(70, "4");
  w.g(9, "$MEASUREMENT");
  w.g(70, "1");
  w.g(9, "$EXTMIN");
  w.point(10, { x: bbox.minX, y: bbox.minY });
  w.g(9, "$EXTMAX");
  w.point(10, { x: bbox.maxX, y: bbox.maxY });
  w.g(0, "ENDSEC");

  // CLASSES (empty)
  w.g(0, "SECTION");
  w.g(2, "CLASSES");
  w.g(0, "ENDSEC");

  // TABLES
  w.g(0, "SECTION");
  w.g(2, "TABLES");
  table(w, "VPORT", 1, (owner) => {
    tableRecord(w, "VPORT", "*Active", owner, "AcDbViewportTableRecord", () => {
      w.g(10, 0);
      w.g(20, 0);
      w.g(11, 1);
      w.g(21, 1);
      w.g(12, (bbox.minX + bbox.maxX) / 2);
      w.g(22, (bbox.minY + bbox.maxY) / 2);
      w.g(40, Math.max(bbox.height, 1));
      w.g(41, Math.max(bbox.width / Math.max(bbox.height, 1), 0.1));
    });
  });
  table(w, "LTYPE", 3, (owner) => {
    for (const [name, desc, dashes] of [
      ["ByBlock", "", []],
      ["ByLayer", "", []],
      ["CONTINUOUS", "Solid line", []],
    ] as const) {
      tableRecord(w, "LTYPE", name, owner, "AcDbLinetypeTableRecord", () => {
        w.g(3, desc);
        w.g(72, "65");
        w.g(73, String(dashes.length));
        w.g(40, 0);
      });
    }
    tableRecord(w, "LTYPE", "DASHED", owner, "AcDbLinetypeTableRecord", () => {
      w.g(3, "Dashed __ __ __");
      w.g(72, "65");
      w.g(73, "2");
      w.g(40, 0.75);
      w.g(49, 0.5);
      w.g(74, "0");
      w.g(49, -0.25);
      w.g(74, "0");
    });
  });
  table(w, "LAYER", PRODUCTION_LAYERS.length + 1, (owner) => {
    tableRecord(w, "LAYER", "0", owner, "AcDbLayerTableRecord", () => {
      w.g(62, "7");
      w.g(6, "CONTINUOUS");
      w.g(370, "-3");
    });
    for (const l of PRODUCTION_LAYERS) {
      tableRecord(w, "LAYER", l.name, owner, "AcDbLayerTableRecord", () => {
        w.g(62, String(l.color));
        w.g(6, l.linetype);
        w.g(370, "-3");
      });
    }
  });
  table(w, "STYLE", 1, (owner) => {
    tableRecord(w, "STYLE", "Standard", owner, "AcDbTextStyleTableRecord", () => {
      w.g(40, 0);
      w.g(41, 1);
      w.g(50, 0);
      w.g(71, "0");
      w.g(42, 2.5);
      w.g(3, "txt");
      w.g(4, "");
    });
  });
  table(w, "VIEW", 0, () => undefined);
  table(w, "UCS", 0, () => undefined);
  table(w, "APPID", 1, (owner) => {
    tableRecord(w, "APPID", "ACAD", owner, "AcDbRegAppTableRecord", () => undefined);
  });
  table(w, "DIMSTYLE", 0, () => undefined);
  const modelSpaceHandle = w.handle();
  const paperSpaceHandle = w.handle();
  table(w, "BLOCK_RECORD", 2, (owner) => {
    for (const [name, handle] of [
      ["*Model_Space", modelSpaceHandle],
      ["*Paper_Space", paperSpaceHandle],
    ] as const) {
      w.g(0, "BLOCK_RECORD");
      w.g(5, handle);
      w.g(330, owner);
      w.g(100, "AcDbSymbolTableRecord");
      w.g(100, "AcDbBlockTableRecord");
      w.g(2, name);
      w.g(70, "0");
      w.g(280, "1");
      w.g(281, "0");
    }
  });
  w.g(0, "ENDSEC");

  // BLOCKS: the two mandatory empty blocks.
  w.g(0, "SECTION");
  w.g(2, "BLOCKS");
  for (const [name, owner] of [
    ["*Model_Space", modelSpaceHandle],
    ["*Paper_Space", paperSpaceHandle],
  ] as const) {
    w.g(0, "BLOCK");
    w.g(5, w.handle());
    w.g(330, owner);
    w.g(100, "AcDbEntity");
    w.g(8, "0");
    w.g(100, "AcDbBlockBegin");
    w.g(2, name);
    w.g(70, "0");
    w.g(10, 0);
    w.g(20, 0);
    w.g(30, 0);
    w.g(3, name);
    w.g(1, "");
    w.g(0, "ENDBLK");
    w.g(5, w.handle());
    w.g(330, owner);
    w.g(100, "AcDbEntity");
    w.g(8, "0");
    w.g(100, "AcDbBlockEnd");
  }
  w.g(0, "ENDSEC");

  // ENTITIES
  w.g(0, "SECTION");
  w.g(2, "ENTITIES");
  const emit = (seg: Segment, layer: string) => {
    w.g(0, seg.kind === "line" ? "LINE" : seg.kind === "arc" ? "ARC" : "CIRCLE");
    w.g(5, w.handle());
    w.g(330, modelSpaceHandle);
    w.g(100, "AcDbEntity");
    w.g(8, layer);
    switch (seg.kind) {
      case "line":
        w.g(100, "AcDbLine");
        w.point(10, seg.start);
        w.point(11, seg.end);
        break;
      case "arc":
        w.g(100, "AcDbCircle");
        w.point(10, seg.center);
        w.g(40, seg.radius);
        w.g(100, "AcDbArc");
        w.g(50, seg.startAngleDeg);
        w.g(51, seg.endAngleDeg);
        break;
      case "circle":
        w.g(100, "AcDbCircle");
        w.point(10, seg.center);
        w.g(40, seg.radius);
        break;
    }
  };
  for (const e of entities) {
    const layer = PRODUCTION_LAYER_FOR_ROLE[e.role] ?? "IGNORE";
    for (const s of e.segments) emit(s, layer);
  }
  for (const b of applied.measures.bendLines.filter((x) => x.entityId === null)) {
    emit({ kind: "line", start: b.start, end: b.end }, b.direction === "down" ? "BEND_DOWN" : "BEND_UP");
  }
  w.g(0, "ENDSEC");

  // OBJECTS: the root dictionary AC1018 readers expect.
  w.g(0, "SECTION");
  w.g(2, "OBJECTS");
  const root = w.handle();
  const groups = w.handle();
  w.g(0, "DICTIONARY");
  w.g(5, root);
  w.g(330, "0");
  w.g(100, "AcDbDictionary");
  w.g(281, "1");
  w.g(3, "ACAD_GROUP");
  w.g(350, groups);
  w.g(0, "DICTIONARY");
  w.g(5, groups);
  w.g(330, root);
  w.g(100, "AcDbDictionary");
  w.g(281, "1");
  w.g(0, "ENDSEC");
  w.g(0, "EOF");
  return w.text();
}
