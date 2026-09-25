/**
 * Geometry engine — quick part (manual entry fallback).
 * File path: /lib/geometry/quick-part.ts
 *
 * Builds a real PartGeometry from typed numbers so the pricing engine
 * never needs a special case: a rectangle L × W at the origin (4 LINEs on
 * layer CUT), the holes as CIRCLEs spread on a grid inside the outline
 * (layout is cosmetic — only count, diameter and cut length matter; the
 * centres are clamped so a hole never crosses the edge), and the bends
 * as DRAWN bend annotations (full-length lines, direction up, angle from
 * the input) so triage stays green with `no_interior_open_lines` and the
 * bend lines carry their angle for pricing. Roll goes to
 * annotations.roll. Mass uses the density given (null → no mass).
 */

import type { BendAnnotation, PartAnnotations, PartGeometry, QuickPartInput, RollAnnotation } from "./types";
import { EMPTY_ANNOTATIONS } from "./types";
import type { ParsedDxf, RawEntity } from "./parse";
import { makeCircle, makeLine, radToDeg } from "./math";
import { runPipeline } from "./pipeline";
import { applyAnnotationsSync } from "./annotate";

export type QuickPartResult = { geometry: PartGeometry; annotations: PartAnnotations };

function holeCentres(input: QuickPartInput): { x: number; y: number; r: number }[] {
  const holes: number[] = [];
  for (const h of input.holes) {
    const n = Math.max(0, Math.floor(h.count));
    for (let i = 0; i < n; i++) if (h.diameterMm > 0) holes.push(h.diameterMm);
  }
  holes.sort((a, b) => b - a);
  const n = holes.length;
  if (n === 0) return [];
  const maxD = holes[0];
  const margin = Math.max(5, maxD);
  const L = input.lengthMm;
  const W = input.widthMm;
  const availW = Math.max(0, L - 2 * margin);
  const availH = Math.max(0, W - 2 * margin);
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt((n * Math.max(availW, 1)) / Math.max(availH, 1)))));
  const rows = Math.ceil(n / cols);
  const pitchX = cols > 1 ? availW / (cols - 1) : 0;
  const pitchY = rows > 1 ? availH / (rows - 1) : 0;
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = holes[i] / 2;
    const c = i % cols;
    const rw = Math.floor(i / cols);
    const x = cols > 1 ? margin + c * pitchX : L / 2;
    const y = rows > 1 ? margin + rw * pitchY : W / 2;
    out.push({
      x: Math.min(Math.max(x, r + 1), Math.max(r + 1, L - r - 1)),
      y: Math.min(Math.max(y, r + 1), Math.max(r + 1, W - r - 1)),
      r,
    });
  }
  return out;
}

function bendAnnotations(input: QuickPartInput): BendAnnotation[] {
  const L = input.lengthMm;
  const W = input.widthMm;
  const all: { lengthMm: number; angleDeg: number }[] = [];
  for (const b of input.bends) {
    const n = Math.max(0, Math.floor(b.count));
    for (let i = 0; i < n; i++) if (b.lengthMm > 0) all.push({ lengthMm: b.lengthMm, angleDeg: b.angleDeg });
  }
  return all.map((b, i) => {
    const alongX = b.lengthMm <= L + 1e-9 || b.lengthMm > W;
    const len = alongX ? Math.min(b.lengthMm, L) : Math.min(b.lengthMm, W);
    const t = (i + 1) / (all.length + 1);
    const start = alongX ? { x: (L - len) / 2, y: W * t } : { x: L * t, y: (W - len) / 2 };
    const end = alongX ? { x: (L + len) / 2, y: W * t } : { x: L * t, y: (W + len) / 2 };
    return {
      id: `qb${i + 1}`,
      entityId: null,
      start,
      end,
      lengthMm: len,
      angleDeg: b.angleDeg,
      radiusMm: null,
      direction: "up",
      dieVMm: null,
    };
  });
}

function rollAnnotation(input: QuickPartInput): RollAnnotation | null {
  if (!input.roll || input.roll.radiusMm <= 0) return null;
  const L = input.lengthMm;
  const W = input.widthMm;
  const axisIsX = Math.abs(input.roll.axisLengthMm - L) <= Math.abs(input.roll.axisLengthMm - W);
  const developed = axisIsX ? W : L;
  return {
    radiusMm: input.roll.radiusMm,
    axis: axisIsX ? "x" : "y",
    arcAngleDeg: Math.min(360, radToDeg(developed / input.roll.radiusMm)),
    axisLengthMm: input.roll.axisLengthMm,
    developedWidthMm: developed,
    cone: null,
  };
}

export function quickPart(input: QuickPartInput): QuickPartResult {
  const L = Math.max(0, input.lengthMm);
  const W = Math.max(0, input.widthMm);
  const raw: RawEntity[] = [];
  const corners = [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: W },
    { x: 0, y: W },
  ];
  for (let i = 0; i < 4; i++) {
    raw.push({ originalType: "MANUAL", layer: "CUT", segments: [makeLine(corners[i], corners[(i + 1) % 4])], closed: false });
  }
  for (const h of holeCentres({ ...input, lengthMm: L, widthMm: W })) {
    raw.push({ originalType: "MANUAL", layer: "HOLES", segments: [makeCircle({ x: h.x, y: h.y }, h.r)], closed: true });
  }
  const parsed: ParsedDxf = {
    header: {
      version: null,
      units: { insunits: 4, detected: "mm", scaleApplied: 1 },
      extmin: { x: 0, y: 0 },
      extmax: { x: L, y: W },
      layers: ["CUT", "HOLES"],
    },
    entities: raw,
    dropped: [],
    splinesFlattened: 0,
    ellipsesFlattened: 0,
    blocksExploded: 0,
    parseError: null,
  };
  const options = {
    thicknessMm: input.thicknessMm,
    densityKgM3: input.densityKgM3,
    blankMarginMm: input.blankMarginMm,
    name: input.name,
  };
  const base = runPipeline(parsed, options, "manual");
  const bends = bendAnnotations({ ...input, lengthMm: L, widthMm: W });
  const roll = rollAnnotation({ ...input, lengthMm: L, widthMm: W });
  const annotations: PartAnnotations = {
    ...EMPTY_ANNOTATIONS,
    entities: {},
    bends,
    welds: [],
    roll,
    threads: {},
    deletedEntityIds: [],
    forming: bends.length > 0 ? "bent" : roll ? "rolled" : "flat",
  };
  const geometry = applyAnnotationsSync(base, annotations, options);
  return { geometry, annotations };
}
