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
 */

import type { PartAnnotations, PartGeometry, Point, Segment } from "./types";
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
