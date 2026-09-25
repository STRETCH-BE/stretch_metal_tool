/**
 * Geometry engine — triage state of an uploaded file.
 * File path: /lib/geometry/triage.ts
 *
 * Rules (build prompt Step 6.9, spec 5.1), evaluated in priority order:
 *  1. red_no_closed_contour — no closed loop at all (or parse failure).
 *  2. red_drawing_sheet — dropped DIMENSION+TEXT+MTEXT ≥ 8, OR ≥ 3
 *     separated closed-loop clusters (bboxes neither overlap nor nest),
 *     OR $EXTMIN/$EXTMAX size differs from the geometry size by more
 *     than 3× on an axis (positions are irrelevant: Inventor writes
 *     extents relative to the origin).
 *  3. amber_units — $INSUNITS missing/0 or inches (scaled ×25.4), until
 *     the user confirms the size.
 *  4. amber_bend_candidates — open chains with role "unknown" inside the
 *     outline; `candidateEntityIds` lists them for the "these N lines"
 *     question.
 *  5. amber_forming_unknown — no bend lines (layer or tagged) AND the part
 *     name or PDF text contains a forming hint (bend/fold/roll in EN, PL,
 *     CZ/SK, DE stems; "plech" = sheet is NOT a hint), until answered.
 *     Weld/engrave/cut-tagged open lines do not answer the question —
 *     only a bend line, an answered candidate (step 4) or the user does.
 *  6. green — bend_layers_found or no_interior_open_lines.
 * `multi_part` is added to the reasons of any state when partCount > 1.
 */

import type { DroppedEntity, DxfHeaderInfo, GeometryEntity, Loop, Triage, TriageReasonCode } from "./types";
import { bboxOverlaps, bboxUnionAll } from "./math";

export const DIMENSION_TEXT_THRESHOLD = 8;
export const VIEW_CLUSTER_THRESHOLD = 3;
export const EXTENTS_RATIO_THRESHOLD = 3;

/** Lower-case stems that mark a forming hint in a name or PDF text. */
export const FORMING_HINT_STEMS = [
  "bend",
  "bent",
  "fold",
  "kant",
  "roll",
  "ohyb",
  "ohýb",
  "biegen",
  "gebogen",
  "biegung",
  "walc",
  "zwijan",
  "gięc",
  "gięt",
  "giąć",
];

export function hasFormingHint(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return FORMING_HINT_STEMS.some((s) => t.includes(s));
}

export type TriageInput = {
  entities: GeometryEntity[];
  loops: Loop[];
  header: DxfHeaderInfo;
  dropped: DroppedEntity[];
  partCount: number;
  parseError?: string | null;
  name?: string;
  pdfText?: string | null;
  /** Amber answers already given (annotations). */
  unitsConfirmed?: boolean;
  formingAnswered?: boolean;
};

/** Number of groups of closed loops whose bboxes touch/overlap/nest. */
export function closedLoopClusters(loops: Loop[]): number {
  const closed = loops.filter((l) => l.closed && l.kind !== "noise");
  const parent = closed.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < closed.length; i++) {
    for (let j = i + 1; j < closed.length; j++) {
      if (bboxOverlaps(closed[i].bbox, closed[j].bbox, 0.5)) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const roots = new Set<number>();
  for (let i = 0; i < closed.length; i++) roots.add(find(i));
  return roots.size;
}

/** Largest per-axis ratio between header extents size and geometry size, or null when not comparable. */
export function extentsRatio(header: DxfHeaderInfo, loops: Loop[]): number | null {
  if (!header.extmin || !header.extmax) return null;
  const closed = loops.filter((l) => l.closed && l.kind !== "noise");
  if (closed.length === 0) return null;
  const g = bboxUnionAll(closed.map((l) => l.bbox));
  const ex = Math.abs(header.extmax.x - header.extmin.x);
  const ey = Math.abs(header.extmax.y - header.extmin.y);
  let worst: number | null = null;
  const consider = (e: number, gs: number) => {
    if (e <= 1 || gs <= 1) return;
    const r = Math.max(e / gs, gs / e);
    if (worst === null || r > worst) worst = r;
  };
  consider(ex, g.width);
  consider(ey, g.height);
  return worst;
}

export function evaluateTriage(input: TriageInput): Triage {
  const { entities, loops, header, dropped } = input;
  const reasons: TriageReasonCode[] = [];
  const details: Record<string, number | string> = {};
  const withMulti = (state: Triage["state"], candidateEntityIds: string[] = []): Triage => {
    if (input.partCount > 1) {
      reasons.push("multi_part");
      details.partCount = input.partCount;
    }
    return { state, reasons, candidateEntityIds, details };
  };

  const closedLoops = loops.filter((l) => l.closed && l.kind !== "noise");
  const hasOuter = loops.some((l) => l.kind === "outer");
  if (input.parseError) details.parseError = input.parseError;

  if (!hasOuter || closedLoops.length === 0) {
    reasons.push("no_closed_contour");
    return withMulti("red_no_closed_contour");
  }

  // 2. Drawing sheet.
  const dimText = dropped
    .filter((d) => d.type === "DIMENSION" || d.type === "TEXT" || d.type === "MTEXT")
    .reduce((acc, d) => acc + d.count, 0);
  const clusters = closedLoopClusters(loops);
  const ratio = extentsRatio(header, loops);
  let red = false;
  if (dimText >= DIMENSION_TEXT_THRESHOLD) {
    reasons.push("dimension_text_heavy");
    details.dimensionTextCount = dimText;
    red = true;
  }
  if (clusters >= VIEW_CLUSTER_THRESHOLD) {
    reasons.push("multiple_view_clusters");
    details.clusterCount = clusters;
    red = true;
  }
  if (ratio !== null && ratio > EXTENTS_RATIO_THRESHOLD) {
    reasons.push("extents_mismatch");
    details.extentsRatio = Math.round(ratio * 100) / 100;
    red = true;
  }
  if (red) return withMulti("red_drawing_sheet");

  // 3. Units.
  if (!input.unitsConfirmed) {
    if (header.units.detected === "unknown") {
      reasons.push("units_missing");
      details.units = "missing";
      return withMulti("amber_units");
    }
    if (header.units.detected === "inch") {
      reasons.push("units_inch");
      details.units = "inch";
      details.scaleApplied = header.units.scaleApplied;
      return withMulti("amber_units");
    }
  }

  // 4. Bend candidates.
  const candidateLoops = loops.filter((l) => l.kind === "open_chain" && l.partIndex >= 0);
  const candidateIds: string[] = [];
  for (const l of candidateLoops) {
    for (const id of l.entityIds) {
      const e = entities.find((x) => x.id === id);
      if (e && e.role === "unknown") candidateIds.push(id);
    }
  }
  if (candidateIds.length > 0) {
    reasons.push("interior_open_lines");
    details.count = candidateIds.length;
    return withMulti("amber_bend_candidates", candidateIds);
  }

  // 5. Forming unknown (every interior open line is answered by now, so only
  //    a bend line or the user can settle the forming question).
  const bendEntities = entities.filter((e) => e.role === "bend_up" || e.role === "bend_down");
  if (bendEntities.length === 0 && !input.formingAnswered) {
    if (hasFormingHint(input.name)) {
      reasons.push("forming_hint_in_name");
      details.hint = "name";
      return withMulti("amber_forming_unknown");
    }
    if (hasFormingHint(input.pdfText)) {
      reasons.push("forming_hint_in_pdf");
      details.hint = "pdf";
      return withMulti("amber_forming_unknown");
    }
  }

  // 6. Green.
  if (bendEntities.length > 0) {
    reasons.push("bend_layers_found");
    details.bendLines = bendEntities.length;
  } else {
    reasons.push("no_interior_open_lines");
  }
  return withMulti("green");
}
