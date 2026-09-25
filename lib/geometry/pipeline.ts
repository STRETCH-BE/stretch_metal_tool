/**
 * Geometry engine — the shared analysis pipeline (parsed input → PartGeometry).
 * File path: /lib/geometry/pipeline.ts
 *
 * normalise → heal → buildLoops → classify → measure → triage. Lives in
 * its own module so both the DXF entry point (engine.ts) and the manual
 * quick part (quick-part.ts) run exactly the same code without a
 * circular import. Deterministic: no Date, no random.
 */

import type { AnalyzeOptions, PartGeometry } from "./types";
import type { ParsedDxf } from "./parse";
import { DEFAULT_LAYER_CONVENTIONS } from "./layer-conventions";
import { normalise } from "./normalise";
import { heal, clampTolerance, emptyHealingReport } from "./heal";
import { buildLoops } from "./loops";
import { classify } from "./classify";
import { measure } from "./measure";
import { evaluateTriage } from "./triage";

export const GEOMETRY_VERSION = 1 as const;

export function runPipeline(parsed: ParsedDxf, options: AnalyzeOptions, source: PartGeometry["source"] = "dxf"): PartGeometry {
  const conventions = options.layerConventions ?? DEFAULT_LAYER_CONVENTIONS;
  const tol = clampTolerance(options.toleranceMm);

  const norm = normalise(parsed.entities, parsed.dropped, conventions);
  const report = {
    ...emptyHealingReport(tol),
    zeroLengthRemoved: norm.zeroLengthRemoved,
    splinesFlattened: parsed.splinesFlattened,
    ellipsesFlattened: parsed.ellipsesFlattened,
    blocksExploded: parsed.blocksExploded,
  };
  const healed = heal(norm.entities, report);
  const chained = buildLoops(healed.entities, tol);
  const healing = { ...healed.report, loopsClosed: healed.report.loopsClosed + chained.loopsClosed };
  const classified = classify(chained.entities, chained.loops);
  const measures = measure(classified.entities, classified.loops, {
    partIndex: options.partIndex,
    blankMarginMm: options.blankMarginMm,
    thicknessMm: options.thicknessMm,
    densityKgM3: options.densityKgM3,
  });
  const triage = evaluateTriage({
    entities: classified.entities,
    loops: classified.loops,
    header: parsed.header,
    dropped: norm.dropped,
    partCount: classified.partCount,
    parseError: parsed.parseError,
    name: options.name,
    pdfText: options.pdfText,
  });
  return {
    version: GEOMETRY_VERSION,
    source,
    header: parsed.header,
    entities: classified.entities,
    loops: classified.loops,
    outerLoopId: classified.outerLoopId,
    measures,
    healing,
    dropped: norm.dropped,
    triage,
    partCount: classified.partCount,
    material: { thicknessMm: options.thicknessMm ?? null, densityKgM3: options.densityKgM3 ?? null },
  };
}
