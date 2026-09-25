/**
 * Geometry engine — the TypeScript implementation of `GeometryEngine`.
 * File path: /lib/geometry/engine.ts
 *
 * Pipeline for a DXF (sync core, async interface):
 *   parse → normalise → heal → buildLoops → classify → measure → triage
 * `analyzeDxfSync` is deterministic (no Date, no random) and never throws
 * for garbage that still looks like a DXF: the result is a PartGeometry
 * in state red_no_closed_contour carrying the dropped/healing reports and
 * the parse error in `triage.details`. Only text without a SECTION group
 * throws (DxfFormatError) — that is a wrong file type, not a bad drawing.
 *
 * The class wraps the sync functions in Promises so a Python/ezdxf
 * service can implement the same interface over HTTP later.
 */

import type {
  AnalyzeOptions,
  GeometryEngine,
  PartAnnotations,
  PartGeometry,
  QuickPartInput,
} from "./types";
import { parseDxf, DxfFormatError, type ParsedDxf } from "./parse";
import { clampTolerance, emptyHealingReport } from "./heal";
import { measure } from "./measure";
import { evaluateTriage } from "./triage";
import { runPipeline, GEOMETRY_VERSION } from "./pipeline";
import { applyAnnotationsSync } from "./annotate";
import { quickPart } from "./quick-part";
import { exportAnnotatedDxf } from "./export-dxf";

/** Geometry for a file that produced nothing usable (still a valid snapshot). */
export function emptyGeometry(parsed: ParsedDxf | null, options: AnalyzeOptions, error: string | null): PartGeometry {
  const tol = clampTolerance(options.toleranceMm);
  const header = parsed?.header ?? {
    version: null,
    units: { insunits: null, detected: "unknown", scaleApplied: 1 },
    extmin: null,
    extmax: null,
    layers: [],
  };
  const healing = emptyHealingReport(tol);
  const measures = measure([], [], {
    blankMarginMm: options.blankMarginMm,
    thicknessMm: options.thicknessMm,
    densityKgM3: options.densityKgM3,
  });
  const triage = evaluateTriage({
    entities: [],
    loops: [],
    header,
    dropped: parsed?.dropped ?? [],
    partCount: 0,
    parseError: error ?? parsed?.parseError ?? null,
    name: options.name,
    pdfText: options.pdfText,
  });
  return {
    version: GEOMETRY_VERSION,
    source: "dxf",
    header,
    entities: [],
    loops: [],
    outerLoopId: null,
    measures,
    healing,
    dropped: parsed?.dropped ?? [],
    triage,
    partCount: 0,
    material: { thicknessMm: options.thicknessMm ?? null, densityKgM3: options.densityKgM3 ?? null },
  };
}

export function analyzeDxfSync(dxfText: string, options: AnalyzeOptions = {}): PartGeometry {
  // Throws DxfFormatError for non-DXF text (deliberate — wrong file type).
  const parsed = parseDxf(dxfText);
  try {
    return runPipeline(parsed, options);
  } catch (err) {
    return emptyGeometry(parsed, options, err instanceof Error ? err.message : String(err));
  }
}

export class TsGeometryEngine implements GeometryEngine {
  async analyzeDxf(dxfText: string, options: AnalyzeOptions = {}): Promise<PartGeometry> {
    return analyzeDxfSync(dxfText, options);
  }

  async applyAnnotations(
    geometry: PartGeometry,
    annotations: PartAnnotations,
    options: AnalyzeOptions = {}
  ): Promise<PartGeometry> {
    return applyAnnotationsSync(geometry, annotations, options);
  }

  async quickPart(input: QuickPartInput): Promise<PartGeometry> {
    return quickPart(input).geometry;
  }

  async exportAnnotatedDxf(geometry: PartGeometry, annotations: PartAnnotations): Promise<string> {
    return exportAnnotatedDxf(geometry, annotations);
  }
}

export { DxfFormatError, runPipeline, GEOMETRY_VERSION };
