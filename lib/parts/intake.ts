/**
 * Intake orchestrator — turns an uploaded file (already in Storage, files
 * row written) into a part + quote item, or attaches a PDF companion.
 * File path: /lib/parts/intake.ts
 *
 * Pure-ish: every side effect goes through `IntakeDeps` (analyse, SVG,
 * PDF text, AI pre-fill, storage download, DB, re-price) so the whole
 * flow is unit-tested with the customer DXFs in test/fixtures and an
 * in-memory DB (test/intake/intake.test.ts). Production wiring lives in
 * lib/parts/intake-db.ts + app/api/files/complete/route.ts.
 *
 * DXF: decode → find a PDF companion already in the quote (same base
 * name) and extract its text → analyse (tolerance 0.01, blank margin from
 * rate_general, name = base name, pdfText for the forming hint) → restore
 * the latest annotations stored against the same file hash (spec 5.3: a
 * re-upload restores them) and re-apply them → thumbnail (light, 160×120)
 * → parts row (source dxf) + quote_items row (qty 1, next position) → AI
 * suggestions when a companion exists (prefill, else heuristics) → reprice.
 * PDF: extract text → DXF part with the same base name in this quote?
 * attach (pdf_file_id, pdf_text, ai_suggestions, triage re-run with the
 * PDF forming hint) else keep the files row — a DXF uploaded later picks
 * it up. STEP: part with source step, no geometry (manual entry prompt).
 *
 * Nothing from the AI is ever applied: suggestions are stored on the
 * part and shown as amber chips.
 */

import type {
  AnalyzeOptions,
  HealingReport,
  PartAnnotations,
  PartGeometry,
  Triage,
} from "@/lib/geometry/types";
import { EMPTY_ANNOTATIONS } from "@/lib/geometry/types";
import { decodeDxfBytes } from "@/lib/geometry/parse";
import type { Suggestions } from "@/lib/ai/types";
import { baseName } from "@/lib/files/sniff";

export const INTAKE_TOLERANCE_MM = 0.01;
export const THUMBNAIL_SIZE = { width: 160, height: 120 } as const;

export type IntakeKind = "dxf" | "pdf" | "step";

export type IntakeFile = {
  id: string;
  originalName: string;
  storagePath: string;
  sha256: string;
};

export type PartInsert = {
  quoteId: string;
  name: string;
  source: "dxf" | "step";
  fileId: string;
  fileHash: string;
  geometry: PartGeometry | null;
  annotations: PartAnnotations;
  triage: Triage | null;
  thumbnailSvg: string | null;
  pdfFileId: string | null;
  pdfText: string | null;
  aiSuggestions: Suggestions | null;
};

export type PartPatch = Partial<
  Pick<PartInsert, "geometry" | "annotations" | "triage" | "thumbnailSvg" | "pdfFileId" | "pdfText" | "aiSuggestions">
>;

export type ExistingPart = {
  id: string;
  name: string;
  geometry: PartGeometry | null;
  annotations: PartAnnotations;
  thicknessMm: number | null;
  materialCode: string | null;
};

export type IntakeDb = {
  /** Latest non-empty annotations of any part with this file hash. */
  findAnnotationsByHash(fileHash: string): Promise<PartAnnotations | null>;
  /** Newest DXF part of the quote whose name equals the base name (case-insensitive). */
  findPartByBaseName(quoteId: string, base: string): Promise<ExistingPart | null>;
  /** Newest PDF uploaded to the quote whose base name matches. */
  findPdfByBaseName(quoteId: string, base: string): Promise<IntakeFile | null>;
  insertPart(row: PartInsert): Promise<{ id: string }>;
  updatePart(id: string, patch: PartPatch): Promise<void>;
  nextItemPosition(quoteId: string): Promise<number>;
  insertItem(row: { quoteId: string; partId: string; position: number; qty: number }): Promise<{ id: string }>;
};

export type IntakeDeps = {
  analyse(text: string, options: AnalyzeOptions): Promise<PartGeometry>;
  applyAnnotations(geometry: PartGeometry, annotations: PartAnnotations, options: AnalyzeOptions): Promise<PartGeometry>;
  toSvg(geometry: PartGeometry, annotations: PartAnnotations): string;
  /** Text of a PDF; throws on an unreadable file (caught here). */
  extractPdfText(bytes: Uint8Array): Promise<string>;
  /** AI pre-fill; null when no API key (→ heuristics). Never throws. */
  prefill(input: { pdfBytes: Uint8Array; text: string; partName: string; locale: "pl" | "en" }): Promise<Suggestions | null>;
  heuristics(text: string, partName: string): Suggestions;
  /** Bytes of an object already in Storage (the companion PDF). */
  download(storagePath: string): Promise<Uint8Array>;
  /** Density of a material code from the rate snapshot (mass for a PDF re-triage). */
  densityFor(materialCode: string | null): number | null;
  db: IntakeDb;
  /** Server re-pricing; must not throw (wrap it). */
  reprice(quoteId: string): Promise<void>;
  blankMarginMm: number;
  locale: "pl" | "en";
  toleranceMm?: number;
};

export type IntakeResult =
  | {
      kind: "dxf";
      partId: string;
      itemId: string;
      name: string;
      triage: Triage;
      healing: HealingReport;
      partCount: number;
      thumbnailSvg: string;
      companion: { fileId: string; name: string } | null;
      restoredAnnotations: boolean;
      suggestionsSource: Suggestions["source"] | null;
    }
  | {
      kind: "pdf";
      partId: string | null;
      name: string;
      attachedTo: string | null;
      hasText: boolean;
      suggestionsSource: Suggestions["source"] | null;
    }
  | { kind: "step"; partId: string; itemId: string; name: string };

export type IntakeInput = {
  quoteId: string;
  file: IntakeFile;
  buffer: Uint8Array;
  kind: IntakeKind;
  actor: string;
  deps: IntakeDeps;
};

function hasAnnotations(a: PartAnnotations | null): a is PartAnnotations {
  if (!a) return false;
  return (
    Object.keys(a.entities).length > 0 ||
    a.bends.length > 0 ||
    a.welds.length > 0 ||
    a.roll !== null ||
    a.scale !== null ||
    Object.keys(a.threads).length > 0 ||
    a.unitsConfirmed ||
    a.forming !== null ||
    a.deletedEntityIds.length > 0 ||
    a.mirrored
  );
}

async function safeText(deps: IntakeDeps, bytes: Uint8Array): Promise<string | null> {
  try {
    const text = await deps.extractPdfText(bytes);
    return text.trim().length > 0 ? text : "";
  } catch (error) {
    console.error("[intake] pdf text extraction failed", error);
    return null;
  }
}

async function suggestionsFor(deps: IntakeDeps, bytes: Uint8Array, text: string, partName: string): Promise<Suggestions> {
  try {
    const ai = await deps.prefill({ pdfBytes: bytes, text, partName, locale: deps.locale });
    if (ai) return ai;
  } catch (error) {
    console.error("[intake] ai prefill failed", error);
  }
  return deps.heuristics(text, partName);
}

async function repriceQuietly(deps: IntakeDeps, quoteId: string): Promise<void> {
  try {
    await deps.reprice(quoteId);
  } catch (error) {
    console.error("[intake] reprice failed", quoteId, error);
  }
}

export async function processUploadedFile(input: IntakeInput): Promise<IntakeResult> {
  switch (input.kind) {
    case "dxf":
      return processDxf(input);
    case "pdf":
      return processPdf(input);
    case "step":
      return processStep(input);
  }
}

async function processDxf(input: IntakeInput): Promise<Extract<IntakeResult, { kind: "dxf" }>> {
  const { deps, quoteId, file } = input;
  const name = baseName(file.originalName);
  const text = decodeDxfBytes(input.buffer);

  // 1. Companion PDF already in the quote.
  const companion = await deps.db.findPdfByBaseName(quoteId, name);
  let pdfBytes: Uint8Array | null = null;
  let pdfText: string | null = null;
  if (companion) {
    try {
      pdfBytes = await deps.download(companion.storagePath);
      pdfText = await safeText(deps, pdfBytes);
    } catch (error) {
      console.error("[intake] companion download failed", companion.storagePath, error);
    }
  }

  // 2. Analyse.
  const options: AnalyzeOptions = {
    toleranceMm: deps.toleranceMm ?? INTAKE_TOLERANCE_MM,
    blankMarginMm: deps.blankMarginMm,
    name,
    pdfText,
  };
  let geometry = await deps.analyse(text, options);

  // 3. Restore annotations stored against the same file hash.
  const restored = await deps.db.findAnnotationsByHash(file.sha256);
  const annotations = hasAnnotations(restored) ? restored : { ...EMPTY_ANNOTATIONS };
  const restoredAnnotations = hasAnnotations(restored);
  if (restoredAnnotations) geometry = await deps.applyAnnotations(geometry, annotations, options);

  // 4. Thumbnail + suggestions.
  const thumbnailSvg = deps.toSvg(geometry, annotations);
  let suggestions: Suggestions | null = null;
  if (companion && pdfBytes && pdfText !== null) {
    suggestions = await suggestionsFor(deps, pdfBytes, pdfText, name);
  }

  // 5. Rows.
  const part = await deps.db.insertPart({
    quoteId,
    name,
    source: "dxf",
    fileId: file.id,
    fileHash: file.sha256,
    geometry,
    annotations,
    triage: geometry.triage,
    thumbnailSvg,
    pdfFileId: companion?.id ?? null,
    pdfText,
    aiSuggestions: suggestions,
  });
  const position = await deps.db.nextItemPosition(quoteId);
  const item = await deps.db.insertItem({ quoteId, partId: part.id, position, qty: 1 });
  await repriceQuietly(deps, quoteId);

  return {
    kind: "dxf",
    partId: part.id,
    itemId: item.id,
    name,
    triage: geometry.triage,
    healing: geometry.healing,
    partCount: geometry.partCount,
    thumbnailSvg,
    companion: companion ? { fileId: companion.id, name: companion.originalName } : null,
    restoredAnnotations,
    suggestionsSource: suggestions?.source ?? null,
  };
}

async function processPdf(input: IntakeInput): Promise<Extract<IntakeResult, { kind: "pdf" }>> {
  const { deps, quoteId, file } = input;
  const name = baseName(file.originalName);
  const text = (await safeText(deps, input.buffer)) ?? "";

  const part = await deps.db.findPartByBaseName(quoteId, name);
  if (!part) {
    return { kind: "pdf", partId: null, name, attachedTo: null, hasText: text.length > 0, suggestionsSource: null };
  }

  const suggestions = await suggestionsFor(deps, input.buffer, text, name);
  const patch: PartPatch = { pdfFileId: file.id, pdfText: text, aiSuggestions: suggestions };

  // The forming hint from the PDF is part of triage — re-run it.
  if (part.geometry) {
    try {
      const geometry = await deps.applyAnnotations(part.geometry, part.annotations, {
        toleranceMm: part.geometry.healing.toleranceMm,
        blankMarginMm: deps.blankMarginMm,
        thicknessMm: part.thicknessMm,
        densityKgM3: deps.densityFor(part.materialCode),
        name: part.name,
        pdfText: text,
      });
      patch.geometry = geometry;
      patch.triage = geometry.triage;
      patch.thumbnailSvg = deps.toSvg(geometry, part.annotations);
    } catch (error) {
      console.error("[intake] re-triage after pdf attach failed", part.id, error);
    }
  }
  await deps.db.updatePart(part.id, patch);
  await repriceQuietly(deps, quoteId);

  return {
    kind: "pdf",
    partId: part.id,
    name,
    attachedTo: part.name,
    hasText: text.length > 0,
    suggestionsSource: suggestions.source,
  };
}

async function processStep(input: IntakeInput): Promise<Extract<IntakeResult, { kind: "step" }>> {
  const { deps, quoteId, file } = input;
  const name = baseName(file.originalName);
  const part = await deps.db.insertPart({
    quoteId,
    name,
    source: "step",
    fileId: file.id,
    fileHash: file.sha256,
    geometry: null,
    annotations: { ...EMPTY_ANNOTATIONS },
    triage: null,
    thumbnailSvg: null,
    pdfFileId: null,
    pdfText: null,
    aiSuggestions: null,
  });
  const position = await deps.db.nextItemPosition(quoteId);
  const item = await deps.db.insertItem({ quoteId, partId: part.id, position, qty: 1 });
  await repriceQuietly(deps, quoteId);
  return { kind: "step", partId: part.id, itemId: item.id, name };
}
