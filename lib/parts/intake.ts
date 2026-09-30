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
 *
 * Split models (multi-body STEP, IFC) store their parts in PARALLEL
 * (MODEL_PART_CONCURRENCY at a time through a local pool): the names are
 * computed up front in split order, the item positions are read ONCE and
 * assigned start + index, the results come back in split order and the
 * quote is re-priced once. A part that fails is collected (the others
 * finish) and reported on the assembly result; the upload's files row
 * tracks the run (intake_status processing → done | partial | failed,
 * parts_expected / parts_done) so the client can poll after a 504 and
 * resume: `resumeIntake` skips the parts already stored for the same
 * source file and part name (parts.source_file_id) and stores the rest.
 */

import type {
  AnalyzeOptions,
  BendTableLookup,
  HardwareNameRule,
  HealingReport,
  ModelPart,
  PartAnnotations,
  PartGeometry,
  SheetReport,
  SplitModel,
  Triage,
} from "@/lib/geometry/types";
import type { ExtraOperation } from "@/lib/pricing/types";
import { referenceBodyVerdict } from "@/lib/pricing/reference-body";
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
  /** The upload the part came from (the .ifc / .step itself for split parts, else = fileId); resume keys on it. */
  sourceFileId: string | null;
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
  /** Production DXF of a STEP sheet part (files row, kind export_dxf). */
  flatFileId?: string | null;
};

export type PartPatch = Partial<
  Pick<PartInsert, "geometry" | "annotations" | "triage" | "thumbnailSvg" | "pdfFileId" | "pdfText" | "aiSuggestions" | "flatFileId">
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

/** Where the intake of an uploaded file stands (files.intake_status). */
export type IntakeStatus = "processing" | "done" | "partial" | "failed";

export type IntakeProgress = {
  intakeStatus: IntakeStatus;
  partsExpected: number | null;
  partsDone: number | null;
  intakeError: string | null;
};

/** A part already stored from an upload (parts.source_file_id), as much as the resume result needs. */
export type StoredSourcePart = {
  id: string;
  itemId: string | null;
  name: string;
  qty: number;
  triage: Triage | null;
  thicknessMm: number | null;
  thumbnailSvg: string | null;
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
  insertItem(row: { quoteId: string; partId: string; position: number; qty: number; extras?: ExtraOperation[] }): Promise<{ id: string }>;
  /** Pins the bend-table version the quote's STEP flat patterns were unfolded with (first intake only). */
  pinBendTableVersion(quoteId: string, versionId: string): Promise<void>;
  /** Progress of the upload's intake on its files row; only the given fields change. */
  updateFileIntake(fileId: string, patch: Partial<IntakeProgress>): Promise<void>;
  /** Parts (with their quote item) stored from this upload, any order. */
  findPartsBySourceFile(sourceFileId: string): Promise<StoredSourcePart[]>;
};

export type IntakeDeps = {
  analyse(text: string, options: AnalyzeOptions): Promise<PartGeometry>;
  /** STEP text → PartGeometry (flat pattern, or red_step_manual with the model facts). */
  analyseStep(text: string, options: AnalyzeOptions): Promise<PartGeometry>;
  /** STEP / IFC text → its parts (assemblies split, IFC elements rewritten as STEP), each analysed. */
  splitModel(text: string, options: AnalyzeOptions): Promise<SplitModel>;
  /** Store a derived file under the quote (Storage object + files row): a per-part STEP, or the production DXF of a sheet part. */
  saveDerivedFile(input: { quoteId: string; name: string; bytes: Uint8Array; kind: "step" | "export_dxf" }): Promise<IntakeFile>;
  /**
   * STEP sheet parts: the bend-table version to unfold with (rows + id, or
   * null → DIN formula), the hardware name rules and the material family
   * assumed before a material is chosen (the DIN seed is mild steel).
   */
  sheet?: {
    bendTable: { versionId: string | null; rows: BendTableLookup["rows"] };
    hardwareNames: readonly HardwareNameRule[];
    defaultMaterialFamily: string;
    /** Flat laser bed length of the machine park (reference-body rule: a block longer than the bed); null when unknown. */
    laserBedLengthMm?: number | null;
  };
  /** Production DXF text of a sheet part (lib/geometry/export-dxf.ts writeProductionDxf). */
  writeProductionDxf?(geometry: PartGeometry, annotations: PartAnnotations, title: string): string;
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
      /** Stored parts in split order — on a resume the ones stored earlier included. */
      parts: AssemblyPartResult[];
      /** Parts the model holds (= parts.length + failed.length). */
      expected: number;
      /** Parts that could not be stored in this run (the others were; the quote was re-priced). */
      failed: AssemblyPartFailure[];
      intakeStatus: "done" | "partial";
      /** Resume only: parts found already stored and skipped. */
      skipped: number;
    };

export type AssemblyPartFailure = { name: string; error: string };

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
  /** Suspected CAD reference body (red geometry.reference_body): offered for removal in one action. */
  referenceBody: boolean;
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

/** Options every STEP / IFC analysis gets: the bend table, the hardware rules and the drawing text. */
function sheetOptions(deps: IntakeDeps, drawingText: string | null): Pick<AnalyzeOptions, "bendTable" | "hardwareNames" | "drawingText"> {
  const sheet = deps.sheet;
  if (!sheet) return { drawingText };
  return {
    bendTable: { materialFamily: sheet.defaultMaterialFamily, rows: sheet.bendTable.rows },
    hardwareNames: sheet.hardwareNames,
    drawingText,
  };
}

/** Quote-item extras for the hardware and countersinks the model holds: one feature line per code with its count. */
export function hardwareExtras(sheet: SheetReport | undefined): ExtraOperation[] {
  if (!sheet || !sheet.isSheetMetal) return [];
  const counts = new Map<string, number>();
  for (const h of sheet.hardware) {
    const code = h.featureCode ?? `${h.kind}_${(h.size ?? "unknown").toLowerCase().replace(/×/g, "x")}`;
    counts.set(code, (counts.get(code) ?? 0) + h.qty);
  }
  for (const c of sheet.countersinks) {
    const code = c.featureCode ?? "csk_unknown";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return Array.from(counts, ([code, count]) => ({ type: "feature", code, count }));
}

/** Whether the part's body hints make it a suspected reference body (the same rule the pricing flags use). */
export function isSuspectedReferenceBody(deps: IntakeDeps, geometry: PartGeometry): boolean {
  return referenceBodyVerdict(geometry.sheet?.bodyHints, deps.sheet?.laserBedLengthMm ?? null)?.severity === "red";
}

/** Companion drawing (PDF with the same base name) text for a model, or null. */
async function drawingTextFor(deps: IntakeDeps, quoteId: string, name: string): Promise<string | null> {
  const companion = await deps.db.findPdfByBaseName(quoteId, name);
  if (!companion) return null;
  try {
    return await safeText(deps, await deps.download(companion.storagePath));
  } catch (error) {
    console.error("[intake] companion pdf unreadable", companion.id, error);
    return null;
  }
}

/** Writes the production DXF of a sheet part as a derived file and links it to the part; never throws. */
async function storeProductionDxf(deps: IntakeDeps, quoteId: string, partId: string, name: string, geometry: PartGeometry, annotations: PartAnnotations): Promise<string | null> {
  if (!deps.writeProductionDxf || !geometry.sheet?.isSheetMetal || geometry.entities.length === 0) return null;
  try {
    const text = deps.writeProductionDxf(geometry, annotations, name);
    const file = await deps.saveDerivedFile({ quoteId, name: `${name}_flat.dxf`, bytes: new TextEncoder().encode(text), kind: "export_dxf" });
    await deps.db.updatePart(partId, { flatFileId: file.id });
    return file.id;
  } catch (error) {
    console.error("[intake] production dxf failed", partId, error);
    return null;
  }
}

async function pinBendTableQuietly(deps: IntakeDeps, quoteId: string): Promise<void> {
  const versionId = deps.sheet?.bendTable.versionId ?? null;
  if (!versionId) return;
  try {
    await deps.db.pinBendTableVersion(quoteId, versionId);
  } catch (error) {
    console.error("[intake] bend table pin failed", quoteId, error);
  }
}

async function repriceQuietly(deps: IntakeDeps, quoteId: string): Promise<void> {
  try {
    await deps.reprice(quoteId);
  } catch (error) {
    console.error("[intake] reprice failed", quoteId, error);
  }
}

/** Parts of a split model stored at the same time (each = derived file + part row + item row). */
export const MODEL_PART_CONCURRENCY = 6;

/**
 * Runs `worker` over `items` with at most `limit` in flight, in order of
 * start. The worker must not throw (errors are the caller's to collect).
 */
export async function runPool<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function progressQuietly(deps: IntakeDeps, fileId: string, patch: Partial<IntakeProgress>): Promise<void> {
  try {
    await deps.db.updateFileIntake(fileId, patch);
  } catch (error) {
    console.error("[intake] progress update failed", fileId, error);
  }
}

/** Thrown by resumeIntake when the upload's single part is already stored (nothing to resume). */
export class IntakeAlreadyDoneError extends Error {
  constructor() {
    super("intake already done");
    this.name = "IntakeAlreadyDoneError";
  }
}

export async function processUploadedFile(input: IntakeInput): Promise<IntakeResult> {
  return runIntake(input, []);
}

/**
 * Re-runs the intake of an upload whose first run did not finish (a 504
 * mid-way): parts already stored for the file (same source file and part
 * name) are kept, the missing ones are stored, the quote is re-priced.
 * Single-part uploads that are already stored throw IntakeAlreadyDoneError.
 */
export async function resumeIntake(input: IntakeInput): Promise<IntakeResult> {
  const existing = await input.deps.db.findPartsBySourceFile(input.file.id);
  return runIntake(input, existing);
}

async function runIntake(input: IntakeInput, existing: StoredSourcePart[]): Promise<IntakeResult> {
  const { deps, file } = input;
  try {
    let result: IntakeResult;
    switch (input.kind) {
      case "dxf":
        if (existing.length > 0) throw new IntakeAlreadyDoneError();
        result = await processDxf(input);
        break;
      case "pdf":
        if (existing.length > 0) throw new IntakeAlreadyDoneError();
        result = await processPdf(input);
        break;
      case "step":
        result = await processStep(input, existing);
        break;
      case "ifc":
        result = await processIfc(input, existing);
        break;
    }
    if (result.kind !== "assembly") {
      await progressQuietly(deps, file.id, { intakeStatus: "done", partsExpected: 1, partsDone: 1, intakeError: null });
    }
    return result;
  } catch (error) {
    if (error instanceof IntakeAlreadyDoneError) {
      await progressQuietly(deps, file.id, { intakeStatus: "done", partsExpected: 1, partsDone: 1, intakeError: null });
    } else {
      await progressQuietly(deps, file.id, { intakeStatus: "failed", intakeError: errorMessage(error) });
    }
    throw error;
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
    sourceFileId: file.id,
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

async function processStep(input: IntakeInput, existing: StoredSourcePart[]): Promise<IntakeResult> {
  const { deps, file, quoteId } = input;
  const name = baseName(file.originalName);
  const text = decodeStepBytes(input.buffer);
  const drawingText = await drawingTextFor(deps, quoteId, name);
  const options: AnalyzeOptions = {
    toleranceMm: deps.toleranceMm ?? INTAKE_TOLERANCE_MM,
    blankMarginMm: deps.blankMarginMm,
    name,
    pdfText: drawingText,
    ...sheetOptions(deps, drawingText),
  };
  await pinBendTableQuietly(deps, quoteId);
  // One solid: the uploaded file is the part's file. Several: one part per
  // solid, each with its own STEP file split out of the upload.
  const split = await deps.splitModel(text, options);
  if (split.parts.length === 1 && split.parts[0].stepText === null) {
    if (existing.length > 0) throw new IntakeAlreadyDoneError();
    return storeStepPart(input, name, file, split.parts[0].geometry, options);
  }
  return { kind: "assembly", name, format: "step", ...(await storeModelParts(input, name, split, existing)) };
}

/** IFC: every element becomes a part with a STEP file of its geometry; the .ifc stays as the upload. */
async function processIfc(input: IntakeInput, existing: StoredSourcePart[]): Promise<Extract<IntakeResult, { kind: "assembly" }>> {
  const { deps, file, quoteId } = input;
  const name = baseName(file.originalName);
  const options: AnalyzeOptions = {
    toleranceMm: deps.toleranceMm ?? INTAKE_TOLERANCE_MM,
    blankMarginMm: deps.blankMarginMm,
    name,
    ...sheetOptions(deps, null),
  };
  await pinBendTableQuietly(deps, quoteId);
  const split = await deps.splitModel(decodeStepBytes(input.buffer), options);
  return { kind: "assembly", name, format: "ifc", ...(await storeModelParts(input, name, split, existing)) };
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
    sourceFileId: file.id,
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
  const item = await deps.db.insertItem({ quoteId, partId: part.id, position, qty: 1, extras: hardwareExtras(geometry.sheet) });
  await storeProductionDxf(deps, quoteId, part.id, name, geometry, annotations);
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

type StoredModelParts = Pick<Extract<IntakeResult, { kind: "assembly" }>, "parts" | "expected" | "failed" | "intakeStatus" | "skipped">;

/**
 * Parts of a split model: each gets its derived STEP file (or, without
 * geometry, the upload itself), a part row with the measured thickness and
 * a quote item with the occurrence count as quantity. Names are fixed up
 * front (split order, uniqueName), the item positions are read once and
 * assigned start + index of the parts stored in this run, the parts are
 * stored MODEL_PART_CONCURRENCY at a time, the results come back in split
 * order. Parts in `existing` (a resume) are skipped and echoed from the
 * rows. A failing part is collected; the others finish and the quote is
 * re-priced once at the end.
 */
async function storeModelParts(input: IntakeInput, uploadName: string, split: SplitModel, existing: StoredSourcePart[]): Promise<StoredModelParts> {
  const { deps, quoteId, file } = input;
  const used = new Map<string, number>();
  const names = split.parts.map((modelPart) => uniqueName(modelPart.name || uploadName, used));
  const existingByName = new Map(existing.map((p) => [p.name, p] as const));
  const todo = names.map((_, index) => index).filter((index) => !existingByName.has(names[index]));
  const skipped = names.length - todo.length;

  let done = skipped;
  await progressQuietly(deps, file.id, { intakeStatus: "processing", partsExpected: names.length, partsDone: done, intakeError: null });

  const start = await deps.db.nextItemPosition(quoteId);
  const stored = new Map<number, AssemblyPartResult>();
  const failed: AssemblyPartFailure[] = [];
  await runPool(todo, MODEL_PART_CONCURRENCY, async (index, order) => {
    const modelPart = split.parts[index];
    const partName = names[index];
    try {
      let partFile: IntakeFile = file;
      if (modelPart.stepText !== null) {
        partFile = await deps.saveDerivedFile({
          quoteId,
          name: `${partName}.step`,
          bytes: new TextEncoder().encode(modelPart.stepText),
          kind: "step",
        });
      }
      stored.set(index, await storeSplitPart(input, partName, partFile, modelPart, start + order));
      done += 1;
      await progressQuietly(deps, file.id, { partsDone: done });
    } catch (error) {
      console.error("[intake] part failed", file.id, partName, error);
      failed.push({ name: partName, error: errorMessage(error) });
    }
  });
  await repriceQuietly(deps, quoteId);

  const intakeStatus = failed.length === 0 ? "done" : "partial";
  await progressQuietly(deps, file.id, {
    intakeStatus,
    partsExpected: names.length,
    partsDone: done,
    intakeError: failed.length === 0 ? null : failed.map((f) => `${f.name}: ${f.error}`).join("; "),
  });

  const parts: AssemblyPartResult[] = [];
  names.forEach((name, index) => {
    const fresh = stored.get(index);
    if (fresh) {
      parts.push(fresh);
      return;
    }
    const kept = existingByName.get(name);
    if (kept) parts.push(fromStoredPart(deps, kept, split.parts[index]));
  });
  return { parts, expected: names.length, failed, intakeStatus, skipped };
}

/** An already stored part echoed into the assembly result (triage / thumbnail from the row, warnings from the model). */
function fromStoredPart(deps: IntakeDeps, row: StoredSourcePart, modelPart: ModelPart): AssemblyPartResult {
  return {
    partId: row.id,
    itemId: row.itemId ?? "",
    name: row.name,
    qty: row.qty,
    triage: row.triage ?? modelPart.geometry.triage,
    flat: row.thumbnailSvg !== null,
    thicknessMm: row.thicknessMm,
    thumbnailSvg: row.thumbnailSvg,
    warnings: modelPart.warnings,
    referenceBody: isSuspectedReferenceBody(deps, modelPart.geometry),
  };
}

async function storeSplitPart(input: IntakeInput, name: string, file: IntakeFile, modelPart: ModelPart, position: number): Promise<AssemblyPartResult> {
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
    sourceFileId: input.file.id,
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
  const item = await deps.db.insertItem({ quoteId, partId: part.id, position, qty: Math.max(1, modelPart.occurrences), extras: hardwareExtras(geometry.sheet) });
  await storeProductionDxf(deps, quoteId, part.id, name, geometry, annotations);
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
    referenceBody: isSuspectedReferenceBody(deps, geometry),
  };
}

function uniqueName(name: string, used: Map<string, number>): string {
  const base = name.trim() || "part";
  const n = (used.get(base) ?? 0) + 1;
  used.set(base, n);
  return n === 1 ? base : `${base} (${n})`;
}
