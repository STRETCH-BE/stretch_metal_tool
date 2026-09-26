/**
 * Base geometry + re-analysis with injectable deps (unit-testable).
 * File path: /lib/parts/reanalyse.ts
 *
 * parts.geometry stores the ANNOTATED geometry (what the viewer, the
 * pricing engine and the PDF consume: measures after scale/mirror/
 * deletions/role tags). applyAnnotations is not idempotent for scale,
 * mirror and deletions, so re-applying annotations needs the base
 * (freshly analysed) geometry:
 *   - DXF parts: re-analyse the stored file (deterministic — same entity
 *     ids, so stored annotations re-attach), with the SHA-256 cache: a
 *     part with the same file_hash, the same healing tolerance and
 *     base-equivalent annotations (no scale, no mirror, no deletions)
 *     already holds the base result and is copied instead of parsed;
 *   - manual / STEP parts: the stored geometry is the base (quick parts
 *     are synthetic rectangles; scale/mirror are not offered for them and
 *     are ignored on re-apply).
 * The result is applyAnnotations(base, annotations, options) plus the
 * light-theme thumbnail.
 */

import type { AnalyzeOptions, PartAnnotations, PartGeometry } from "@/lib/geometry/types";
import { decodeDxfBytes } from "@/lib/geometry/parse";
import { THUMBNAIL_SIZE } from "./intake";

export type ReanalyseDeps = {
  analyse(text: string, options: AnalyzeOptions): Promise<PartGeometry>;
  applyAnnotations(geometry: PartGeometry, annotations: PartAnnotations, options: AnalyzeOptions): Promise<PartGeometry>;
  toSvg(geometry: PartGeometry, annotations: PartAnnotations, size: { width: number; height: number }): string;
  download(storagePath: string): Promise<Uint8Array>;
  /** Base-equivalent geometry of another part with this hash + tolerance, or null. */
  findCachedGeometry(fileHash: string, toleranceMm: number, excludePartId: string): Promise<PartGeometry | null>;
};

export type ReanalysePart = {
  id: string;
  source: "dxf" | "pdf" | "step" | "manual" | "welding_drawing";
  name: string;
  storagePath: string | null;
  fileHash: string | null;
  geometry: PartGeometry | null;
  annotations: PartAnnotations;
  pdfText: string | null;
  thicknessMm: number | null;
  densityKgM3: number | null;
};

export type ReanalyseOptions = { toleranceMm: number; blankMarginMm: number };

/** True when the stored (annotated) geometry equals the base analysis for chaining purposes. */
export function isBaseEquivalent(annotations: PartAnnotations): boolean {
  return annotations.scale === null && !annotations.mirrored && annotations.deletedEntityIds.length === 0;
}

export function analyseOptionsFor(part: ReanalysePart, options: ReanalyseOptions): AnalyzeOptions {
  return {
    toleranceMm: options.toleranceMm,
    blankMarginMm: options.blankMarginMm,
    thicknessMm: part.thicknessMm,
    densityKgM3: part.densityKgM3,
    name: part.name,
    pdfText: part.pdfText,
  };
}

export async function baseGeometryFor(
  part: ReanalysePart,
  options: ReanalyseOptions,
  deps: ReanalyseDeps
): Promise<{ geometry: PartGeometry; fromCache: boolean; annotations: PartAnnotations }> {
  const analyseOptions = analyseOptionsFor(part, options);
  if (part.source === "dxf" && part.storagePath) {
    if (part.fileHash) {
      const cached = await deps.findCachedGeometry(part.fileHash, options.toleranceMm, part.id);
      if (cached) return { geometry: cached, fromCache: true, annotations: part.annotations };
    }
    const bytes = await deps.download(part.storagePath);
    const geometry = await deps.analyse(decodeDxfBytes(bytes), analyseOptions);
    return { geometry, fromCache: false, annotations: part.annotations };
  }
  if (!part.geometry) throw new Error(`part ${part.id} has no geometry to re-apply annotations to`);
  // Synthetic geometry: the stored object is the base; scale/mirror would double up.
  return {
    geometry: part.geometry,
    fromCache: false,
    annotations: { ...part.annotations, scale: null, mirrored: false },
  };
}

export type ReanalyseResult = {
  geometry: PartGeometry;
  annotations: PartAnnotations;
  thumbnailSvg: string;
  fromCache: boolean;
};

/** Base geometry → annotations applied → thumbnail. */
export async function reanalysePart(
  part: ReanalysePart,
  annotations: PartAnnotations,
  options: ReanalyseOptions,
  deps: ReanalyseDeps
): Promise<ReanalyseResult> {
  const base = await baseGeometryFor({ ...part, annotations }, options, deps);
  const geometry = await deps.applyAnnotations(base.geometry, base.annotations, analyseOptionsFor(part, options));
  return {
    geometry,
    annotations,
    thumbnailSvg: deps.toSvg(geometry, annotations, THUMBNAIL_SIZE),
    fromCache: base.fromCache,
  };
}
