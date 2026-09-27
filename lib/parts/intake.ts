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
 * it up. STEP / IFC: the model is read (lib/geometry/step): a flat sheet
 * becomes a flat pattern like a DXF, a bent part is unfolded (thumbnail,
 * triage, thickness written to the part); a multi-body STEP or an IFC file
 * is split into one part per body / element, each stored as its own STEP
 * file with the occurrence count as quantity; what cannot be read gets a
 * red_step_manual geometry whose triage details pre-fill the quick part.
 *
 * The PDF re-triage goes through lib/parts/reanalyse.ts: parts.geometry
 * is the ANNOTATED geometry and applyAnnotations is not idempotent for
 * scale / mirror, so the base is re-derived (stored geometry when the
 * annotations are base-equivalent, else the file is parsed again) and the
 * annotations are applied once. Companion PDFs are only trusted when
 * their uploader may edit the quote (lib/parts/quote-editor.ts).
 *
 * Nothing from the AI is ever applied: suggestions are stored on the
 * part and shown as amber chips.
 */

import type {
  AnalyzeOptions,
  HealingReport,
  ModelPart,
  PartAnnotations,
  PartGeometry,
  SplitModel,
  Triage,
} from "@/lib/geometry/types";
import { EMPTY_ANNOTATIONS } from "@/lib/geometry/types";
import { decodeDxfBytes } from "@/lib/geometry/parse";
import { decodeStepBytes } from "@/lib/geometry/step/part21";
import type { Suggestions } from "@/lib/ai/types";
import { baseName } from "@/lib/files/sniff";
import { isBaseEquivalent, reanalysePart, THUMBNAIL_SIZE, type ReanalyseDeps } from "./reanalyse";

export { THUMBNAIL_SIZE };

export const INTAKE_TOLERANCE_MM = 0.01;

export type IntakeKind = "dxf" | "pdf" | "step" | "ifc";

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
  /** Measured sheet thickness (STEP); omitted / null leaves parts.thickness_mm unset. */
  thicknessMm?: number | null;
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
  /** Storage key of the part's DXF (re-parsed when the annotations scale / mirror / delete). */
  storagePath: string | null;
  fileHash: string | null;
};

export type IntakeDb = {
  /** Latest non-empty annotations of any DXF part (source = dxf only) with this file hash. */
  findAnnotationsByHash(fileHash: string): Promise<PartAnnotations | null>;
  /** Newest DXF part of the quote whose name equals the base name (case-insensitive). */
  findPartByBaseName(quoteId: string, base: string): Promise<ExistingPart | null>;
  /**
   * Newest PDF filed under the quote whose base name matches AND whose
   * uploader may edit the quote (admin or its sales owner) — see
   * lib/parts/quote-editor.ts.
   */
  findPdfByBaseName(quoteId: string, base: string): Promise<IntakeFile | null>;
  insertPart(row: PartInsert): Promise<{ id: string }>;
  updatePart(id: string, patch: PartPatch): Promise<void>;
  nextItemPosition(quoteId: string): Promise<number>;
  insertItem(row: { quoteId: string; partId: string; position: number; qty: number }): Promise<{ id: string }>;
};

export type IntakeDeps = {
  analyse(text: string, options: AnalyzeOptions): Promise<PartGeometry>;
  /** STEP text → PartGeometry (flat pattern, or red_step_manual with the model facts). */
  analyseStep(text: string, options: AnalyzeOptions): Promise<PartGeometry>;
  /** STEP / IFC text → its parts (assemblies split, IFC elements rewritten as STEP), each analysed. */
  splitModel(text: string, options: AnalyzeOptions): Promise<SplitModel>;
  /** Store a derived per-part STEP file under the quote (Storage object + files row). */
  saveDerivedFile(input: { quoteId: string; name: string; bytes: Uint8Array; kind: "step" }): Promise<IntakeFile>;
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
  | {
      kind: "step";
      partId: string;
      itemId: string;
      name: string;
      triage: Triage;
      healing: HealingReport;
      /** True when the model became a flat pattern (entities, thumbnail): flat sheet or unfolded. */
      flat: boolean;
      /** Sheet thickness measured from the solid (written to parts.thickness_mm), or null. */
      thicknessMm: number | null;
      thumbnailSvg: string | null;
      partCount: number;
      restoredAnnotations: boolean;
    }
  | {
      /** A multi-body STEP or an IFC file: one part (and quote item) per body / element. */
      kind: "assembly";
      name: string;
      format: "step" | "ifc";
      parts: AssemblyPartResult[];
    };

export type AssemblyPartResult = {
  partId: string;
  itemId: string;
  name: string;
  /** Placements of the part in the assembly = quote item quantity. */
  qty: number;
  triage: Triage;
  flat: boolean;
  thicknessMm: number | null;
  thumbnailSvg: string | null;
  /** Representation items that could not be converted (IFC). */
  warnings: string[];
};

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
    case "ifc":
      return processIfc(input);
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

  // The forming hint from the PDF is part of triage — re-run it on the BASE
  // geometry (never on the stored, already annotated one).
  if (part.geometry) {
    try {
      const result = await retriageWithPdf(deps, { ...part, geometry: part.geometry }, text);
      patch.geometry = result.geometry;
      patch.triage = result.geometry.triage;
      patch.thumbnailSvg = result.thumbnailSvg;
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

/**
 * reanalysePart over the intake deps. The "cache" is the part itself: when
 * its annotations are base-equivalent (no scale / mirror / deletions) the
 * stored geometry IS the base and the file is not parsed again; otherwise
 * the DXF is downloaded and analysed with the stored healing tolerance.
 */
async function retriageWithPdf(deps: IntakeDeps, part: ExistingPart & { geometry: PartGeometry }, pdfText: string) {
  const reanalyseDeps: ReanalyseDeps = {
    analyse: deps.analyse,
    analyseStep: deps.analyseStep,
    applyAnnotations: deps.applyAnnotations,
    toSvg: (geometry, annotations) => deps.toSvg(geometry, annotations),
    download: deps.download,
    findCachedGeometry: async () => (isBaseEquivalent(part.annotations) ? part.geometry : null),
  };
  return reanalysePart(
    {
      id: part.id,
      source: "dxf",
      name: part.name,
      storagePath: part.storagePath,
      fileHash: part.fileHash,
      geometry: part.geometry,
      annotations: part.annotations,
      pdfText,
      thicknessMm: part.thicknessMm,
      densityKgM3: deps.densityFor(part.materialCode),
    },
    part.annotations,
    { toleranceMm: part.geometry.healing.toleranceMm, blankMarginMm: deps.blankMarginMm },
    reanalyseDeps
  );
}

async function processStep(input: IntakeInput): Promise<IntakeResult> {
  const { deps, file } = input;
  const name = baseName(file.originalName);
  const text = decodeStepBytes(input.buffer);
  const options: AnalyzeOptions = {
    toleranceMm: deps.toleranceMm ?? INTAKE_TOLERANCE_MM,
    blankMarginMm: deps.blankMarginMm,
    name,
  };
  // One solid: the uploaded file is the part's file. Several: one part per
  // solid, each with its own STEP file split out of the upload.
  const split = await deps.splitModel(text, options);
  if (split.parts.length === 1 && split.parts[0].stepText === null) {
    return storeStepPart(input, name, file, split.parts[0].geometry, options);
  }
  const parts = await storeModelParts(input, name, split);
  return { kind: "assembly", name, format: "step", parts };
}

/** IFC: every element becomes a part with a STEP file of its geometry; the .ifc stays as the upload. */
async function processIfc(input: IntakeInput): Promise<Extract<IntakeResult, { kind: "assembly" }>> {
  const { deps, file } = input;
  const name = baseName(file.originalName);
  const options: AnalyzeOptions = {
    toleranceMm: deps.toleranceMm ?? INTAKE_TOLERANCE_MM,
    blankMarginMm: deps.blankMarginMm,
    name,
  };
  const split = await deps.splitModel(decodeStepBytes(input.buffer), options);
  const parts = await storeModelParts(input, name, split);
  return { kind: "assembly", name, format: "ifc", parts };
}

/** A single STEP part: annotations restored by hash, thumbnail, measured thickness, one item. */
async function storeStepPart(
  input: IntakeInput,
  name: string,
  file: IntakeFile,
  analysed: PartGeometry,
  options: AnalyzeOptions
): Promise<Extract<IntakeResult, { kind: "step" }>> {
  const { deps, quoteId } = input;
  let geometry = analysed;
  const flat = geometry.entities.length > 0;

  // Annotations stored against the same file hash (flat patterns only —
  // a manual STEP part has no entities to attach them to).
  const restored = flat ? await deps.db.findAnnotationsByHash(file.sha256) : null;
  const annotations = hasAnnotations(restored) ? restored : { ...EMPTY_ANNOTATIONS };
  const restoredAnnotations = hasAnnotations(restored);
  if (restoredAnnotations) geometry = await deps.applyAnnotations(geometry, annotations, options);

  // The measured sheet thickness is written to the part so pricing and the
  // material panel start from it (the user can still change it).
  const thumbnailSvg = flat ? deps.toSvg(geometry, annotations) : null;
  const thicknessMm = geometry.material.thicknessMm;
  const part = await deps.db.insertPart({
    quoteId,
    name,
    source: "step",
    fileId: file.id,
    fileHash: file.sha256,
    geometry,
    annotations,
    triage: geometry.triage,
    thumbnailSvg,
    pdfFileId: null,
    pdfText: null,
    aiSuggestions: null,
    thicknessMm,
  });
  const position = await deps.db.nextItemPosition(quoteId);
  const item = await deps.db.insertItem({ quoteId, partId: part.id, position, qty: 1 });
  await repriceQuietly(deps, quoteId);
  return {
    kind: "step",
    partId: part.id,
    itemId: item.id,
    name,
    triage: geometry.triage,
    healing: geometry.healing,
    flat,
    thicknessMm,
    thumbnailSvg,
    partCount: geometry.partCount,
    restoredAnnotations,
  };
}

/**
 * Parts of a split model: each gets its derived STEP file (or, without
 * geometry, the upload itself), a part row with the measured thickness and
 * a quote item with the occurrence count as quantity. One re-price at the end.
 */
async function storeModelParts(input: IntakeInput, uploadName: string, split: SplitModel): Promise<AssemblyPartResult[]> {
  const { deps, quoteId, file } = input;
  const out: AssemblyPartResult[] = [];
  const used = new Map<string, number>();
  for (const modelPart of split.parts) {
    const partName = uniqueName(modelPart.name || uploadName, used);
    let partFile: IntakeFile = file;
    if (modelPart.stepText !== null) {
      partFile = await deps.saveDerivedFile({
        quoteId,
        name: `${partName}.step`,
        bytes: new TextEncoder().encode(modelPart.stepText),
        kind: "step",
      });
    }
    out.push(await storeSplitPart(input, partName, partFile, modelPart));
  }
  await repriceQuietly(deps, quoteId);
  return out;
}

async function storeSplitPart(input: IntakeInput, name: string, file: IntakeFile, modelPart: ModelPart): Promise<AssemblyPartResult> {
  const { deps, quoteId } = input;
  const geometry = modelPart.geometry;
  const flat = geometry.entities.length > 0;
  const annotations = { ...EMPTY_ANNOTATIONS };
  const thumbnailSvg = flat ? deps.toSvg(geometry, annotations) : null;
  const thicknessMm = geometry.material.thicknessMm;
  const part = await deps.db.insertPart({
    quoteId,
    name,
    source: "step",
    fileId: file.id,
    fileHash: file.sha256,
    geometry,
    annotations,
    triage: geometry.triage,
    thumbnailSvg,
    pdfFileId: null,
    pdfText: null,
    aiSuggestions: null,
    thicknessMm,
  });
  const position = await deps.db.nextItemPosition(quoteId);
  const item = await deps.db.insertItem({ quoteId, partId: part.id, position, qty: Math.max(1, modelPart.occurrences) });
  return {
    partId: part.id,
    itemId: item.id,
    name,
    qty: Math.max(1, modelPart.occurrences),
    triage: geometry.triage,
    flat,
    thicknessMm,
    thumbnailSvg,
    warnings: modelPart.warnings,
  };
}

function uniqueName(name: string, used: Map<string, number>): string {
  const base = name.trim() || "part";
  const n = (used.get(base) ?? 0) + 1;
  used.set(base, n);
  return n === 1 ? base : `${base} (${n})`;
}
