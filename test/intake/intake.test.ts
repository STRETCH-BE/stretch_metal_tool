/**
 * Intake orchestrator (lib/parts/intake.ts) with the customer fixtures
 * and an in-memory DB: DXF → part + item (green, pierces, threads, bend
 * lines, thumbnail), PDF companion before / after the DXF (text +
 * heuristic suggestions attached, triage re-run on the BASE geometry),
 * STEP stub, a re-upload of the same DXF restoring the earlier
 * annotations (DXF parts only — never a quick part's), and companions
 * filed by a user who cannot edit the quote being ignored.
 * File path: /test/intake/intake.test.ts
 */
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { analyzeDxfSync, applyAnnotationsSync, geometryToSvg, quickPart } from "@/lib/geometry";
import { EMPTY_ANNOTATIONS, type PartAnnotations, type PartGeometry } from "@/lib/geometry/types";
import { heuristicSuggestions } from "@/lib/ai/heuristics";
import { sha256 } from "@/lib/files/storage";
import {
  processUploadedFile,
  THUMBNAIL_SIZE,
  type ExistingPart,
  type IntakeDb,
  type IntakeDeps,
  type IntakeFile,
  type PartInsert,
  type PartPatch,
} from "@/lib/parts/intake";
import { baseNamesMatch } from "@/lib/files/sniff";
import { canEditQuoteAs } from "@/lib/parts/quote-editor";
import type { UserRole } from "@/lib/db/types";

const DXF_200005 = new Uint8Array(fs.readFileSync("test/fixtures/200005.dxf"));
const DXF_200164 = new Uint8Array(fs.readFileSync("test/fixtures/200164.dxf"));
const PDF_TEXT_200005 = fs.readFileSync("test/fixtures/200005.pdf.txt", "utf8");
const FAKE_PDF = new Uint8Array(Buffer.from("%PDF-1.4 fake companion bytes"));
const QUOTE = "11111111-1111-4111-8111-111111111111";
const OWNER = "user-1";
/** Profiles the memory DB knows (uploader checks mirror SQL can_edit_quote). */
const USERS: Record<string, UserRole> = { [OWNER]: "sales", "user-b": "sales", "admin-1": "admin", "viewer-1": "viewer" };

type PartRecord = Omit<PartInsert, "source"> & {
  source: "dxf" | "step" | "manual";
  id: string;
  thicknessMm: number | null;
  materialCode: string | null;
  createdAt: number;
};
type FileRecord = IntakeFile & { kind: "dxf" | "pdf" | "step"; quoteId: string; bytes: Uint8Array; uploadedBy: string };

/** In-memory IntakeDb + file store mirroring the production queries. */
function memoryDb() {
  const parts: PartRecord[] = [];
  const items: { id: string; quoteId: string; partId: string; position: number; qty: number }[] = [];
  const files: FileRecord[] = [];
  let seq = 0;
  const db: IntakeDb = {
    async findAnnotationsByHash(fileHash) {
      // Production: parts where file_hash = ? AND source = 'dxf', newest first.
      const rows = parts.filter((p) => p.fileHash === fileHash && p.source === "dxf").sort((a, b) => b.createdAt - a.createdAt);
      const empty = JSON.stringify(EMPTY_ANNOTATIONS);
      return rows.find((p) => JSON.stringify(p.annotations) !== empty)?.annotations ?? null;
    },
    async findPartByBaseName(quoteId, base): Promise<ExistingPart | null> {
      const row = parts
        .filter((p) => p.quoteId === quoteId && p.source === "dxf" && baseNamesMatch(p.name, base))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        geometry: row.geometry,
        annotations: row.annotations,
        thicknessMm: row.thicknessMm,
        materialCode: row.materialCode,
        storagePath: files.find((f) => f.id === row.fileId)?.storagePath ?? null,
        fileHash: row.fileHash,
      };
    },
    async findPdfByBaseName(quoteId, base) {
      // Production: kind = pdf, storage_path under the quote, base name match, uploader may edit the quote.
      const row = files
        .filter((f) => f.quoteId === quoteId && f.kind === "pdf" && baseNamesMatch(f.originalName, base))
        .filter((f) => canEditQuoteAs({ created_by: OWNER }, { id: f.uploadedBy, role: USERS[f.uploadedBy] }))
        .at(-1);
      return row ? { id: row.id, originalName: row.originalName, storagePath: row.storagePath, sha256: row.sha256 } : null;
    },
    async insertPart(row) {
      const id = `part-${++seq}`;
      parts.push({ ...row, id, thicknessMm: null, materialCode: null, createdAt: seq });
      return { id };
    },
    async updatePart(id, patch: PartPatch) {
      const row = parts.find((p) => p.id === id);
      if (!row) throw new Error("no part");
      Object.assign(row, patch);
    },
    async nextItemPosition(quoteId) {
      return items.filter((i) => i.quoteId === quoteId).reduce((max, i) => Math.max(max, i.position), 0) + 1;
    },
    async insertItem(row) {
      const id = `item-${++seq}`;
      items.push({ id, ...row });
      return { id };
    },
  };
  const addFile = (name: string, kind: FileRecord["kind"], bytes: Uint8Array, uploadedBy: string = OWNER): IntakeFile => {
    const id = `file-${++seq}`;
    const record: FileRecord = { id, originalName: name, storagePath: `quotes/${QUOTE}/${id}/${name}`, sha256: sha256(bytes), kind, quoteId: QUOTE, bytes, uploadedBy };
    files.push(record);
    return { id, originalName: name, storagePath: record.storagePath, sha256: record.sha256 };
  };
  /** A quick part that replaced a red DXF part: source manual, file_id kept, hash as given. */
  const addManualPart = (name: string, fileId: string, fileHash: string | null, annotations: PartAnnotations, geometry: PartGeometry) => {
    const id = `part-${++seq}`;
    parts.push({
      id,
      quoteId: QUOTE,
      name,
      source: "manual",
      fileId,
      fileHash: fileHash ?? "",
      geometry,
      annotations,
      triage: geometry.triage,
      thumbnailSvg: null,
      pdfFileId: null,
      pdfText: null,
      aiSuggestions: null,
      thicknessMm: 2,
      materialCode: null,
      createdAt: seq,
    });
    return id;
  };
  return { db, parts, items, files, addFile, addManualPart };
}

function makeDeps(store: ReturnType<typeof memoryDb>, overrides: Partial<IntakeDeps> = {}): IntakeDeps {
  const reprice = vi.fn(async () => undefined);
  const download = vi.fn(async (path: string) => {
    const file = store.files.find((f) => f.storagePath === path);
    if (!file) throw new Error(`no object ${path}`);
    return file.bytes;
  });
  return {
    analyse: async (text, options) => analyzeDxfSync(text, options),
    applyAnnotations: async (geometry, annotations, options) => applyAnnotationsSync(geometry, annotations, options),
    toSvg: (geometry, annotations) => geometryToSvg(geometry, annotations, { ...THUMBNAIL_SIZE, theme: "light" }),
    extractPdfText: async () => PDF_TEXT_200005,
    prefill: async () => null,
    heuristics: heuristicSuggestions,
    download,
    densityFor: () => 7850,
    db: store.db,
    reprice,
    blankMarginMm: 10,
    locale: "pl",
    ...overrides,
  };
}

async function uploadDxf(store: ReturnType<typeof memoryDb>, deps: IntakeDeps, name: string, bytes: Uint8Array) {
  const file = store.addFile(name, "dxf", bytes);
  return processUploadedFile({ quoteId: QUOTE, file, buffer: bytes, kind: "dxf", actor: "user-1", deps });
}

describe("processUploadedFile — DXF", () => {
  it("200005.dxf → green part with 26 pierces, M8 ×8 + M10x1 ×6 and a thumbnail", async () => {
    const store = memoryDb();
    const deps = makeDeps(store);
    const result = await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    expect(result.kind).toBe("dxf");
    if (result.kind !== "dxf") return;
    expect(result.name).toBe("200005");
    expect(result.triage.state).toBe("green");
    expect(result.restoredAnnotations).toBe(false);
    expect(result.companion).toBeNull();
    expect(result.thumbnailSvg.startsWith("<svg")).toBe(true);
    expect(result.thumbnailSvg).toContain("<path");

    const part = store.parts.find((p) => p.id === result.partId)!;
    expect(part.source).toBe("dxf");
    expect(part.fileHash).toBe(sha256(DXF_200005));
    const geometry = part.geometry as PartGeometry;
    expect(geometry.measures.pierces).toBe(26);
    expect(geometry.measures.holes).toHaveLength(25);
    const threads = geometry.measures.holes.map((h) => h.thread?.size ?? null);
    expect(threads.filter((s) => s === "M8")).toHaveLength(8);
    expect(threads.filter((s) => s === "M10x1")).toHaveLength(6);
    expect(Math.abs(geometry.measures.cutLengthMm - 2224.5)).toBeLessThan(0.2);
    expect(part.triage?.state).toBe("green");
    expect(part.pdfFileId).toBeNull();

    const item = store.items.find((i) => i.partId === result.partId)!;
    expect(item.qty).toBe(1);
    expect(item.position).toBe(1);
    expect(deps.reprice).toHaveBeenCalledWith(QUOTE);
  });

  it("200164.dxf → green with 4 bend lines (1 up, 3 down); the second item takes position 2", async () => {
    const store = memoryDb();
    const deps = makeDeps(store);
    await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    const result = await uploadDxf(store, deps, "200164.dxf", DXF_200164);
    if (result.kind !== "dxf") throw new Error("expected dxf");
    expect(result.triage.state).toBe("green");
    const geometry = store.parts.find((p) => p.id === result.partId)!.geometry as PartGeometry;
    expect(geometry.measures.bendLines).toHaveLength(4);
    expect(geometry.measures.bendLines.filter((b) => b.direction === "up")).toHaveLength(1);
    expect(geometry.measures.bendLines.filter((b) => b.direction === "down")).toHaveLength(3);
    expect(geometry.measures.pierces).toBe(33);
    expect(store.items.find((i) => i.partId === result.partId)!.position).toBe(2);
  });

  it("restores the annotations of an earlier part with the same file hash on re-upload", async () => {
    const store = memoryDb();
    const deps = makeDeps(store);
    const first = await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    if (first.kind !== "dxf") throw new Error("expected dxf");
    const firstPart = store.parts.find((p) => p.id === first.partId)!;
    const m8Loop = (firstPart.geometry as PartGeometry).measures.holes.find((h) => h.thread?.size === "M8")!.loopId;
    const edited: PartAnnotations = { ...EMPTY_ANNOTATIONS, threads: { [m8Loop]: "M12" }, forming: "flat", unitsConfirmed: true };
    await store.db.updatePart(first.partId, { annotations: edited });

    const second = await uploadDxf(store, deps, "copy of the same file.dxf", DXF_200005);
    if (second.kind !== "dxf") throw new Error("expected dxf");
    expect(second.restoredAnnotations).toBe(true);
    const secondPart = store.parts.find((p) => p.id === second.partId)!;
    expect(secondPart.annotations).toEqual(edited);
    const hole = (secondPart.geometry as PartGeometry).measures.holes.find((h) => h.loopId === m8Loop)!;
    expect(hole.thread?.size).toBe("M12");
  });

  it("never restores the annotations of a quick part that replaced a red part with the same hash (source manual)", async () => {
    // Review finding: a replaced part kept file_id/file_hash; its synthetic
    // rectangle bends must not become "drawn" bends on the real drawing.
    const store = memoryDb();
    const deps = makeDeps(store);
    const quick = quickPart({ name: "200005", lengthMm: 500, widthMm: 220, thicknessMm: 15, densityKgM3: 7850, holes: [], bends: [{ lengthMm: 220, angleDeg: 90, count: 2 }], roll: null });
    expect(quick.annotations.bends).toHaveLength(2);
    const redDxf = store.addFile("200005.dxf", "dxf", DXF_200005);
    store.addManualPart("200005", redDxf.id, redDxf.sha256, quick.annotations, quick.geometry);

    const result = await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    if (result.kind !== "dxf") throw new Error("expected dxf");
    expect(result.restoredAnnotations).toBe(false);
    const part = store.parts.find((p) => p.id === result.partId)!;
    expect(part.annotations).toEqual(EMPTY_ANNOTATIONS);
    expect((part.geometry as PartGeometry).measures.bendLines).toHaveLength(0);
    // The hash lookup still works for a real DXF part with the same hash.
    await store.db.updatePart(result.partId, { annotations: { ...EMPTY_ANNOTATIONS, forming: "flat" } });
    const again = await uploadDxf(store, deps, "200005 (2).dxf", DXF_200005);
    if (again.kind !== "dxf") throw new Error("expected dxf");
    expect(again.restoredAnnotations).toBe(true);
  });
});

describe("processUploadedFile — PDF companion", () => {
  it("attaches a PDF uploaded after the DXF: text, heuristic suggestions, triage re-run", async () => {
    const store = memoryDb();
    const deps = makeDeps(store);
    const dxf = await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    if (dxf.kind !== "dxf") throw new Error("expected dxf");

    const pdfFile = store.addFile("200005.pdf", "pdf", FAKE_PDF);
    const result = await processUploadedFile({ quoteId: QUOTE, file: pdfFile, buffer: FAKE_PDF, kind: "pdf", actor: "user-1", deps });
    expect(result.kind).toBe("pdf");
    if (result.kind !== "pdf") return;
    expect(result.partId).toBe(dxf.partId);
    expect(result.attachedTo).toBe("200005");
    expect(result.hasText).toBe(true);
    expect(result.suggestionsSource).toBe("heuristic");

    const part = store.parts.find((p) => p.id === dxf.partId)!;
    expect(part.pdfFileId).toBe(pdfFile.id);
    expect(part.pdfText).toBe(PDF_TEXT_200005);
    expect(part.aiSuggestions?.material).toBe("S355");
    expect(part.aiSuggestions?.thicknessMm).toBe(15);
    expect(part.aiSuggestions?.threads.map((t) => t.size).sort()).toEqual(["M10x1", "M8"]);
    expect(part.triage?.state).toBe("green");
    expect(deps.reprice).toHaveBeenCalledTimes(2);
  });

  it("keeps an unmatched PDF for later and a DXF uploaded afterwards picks it up", async () => {
    const store = memoryDb();
    const deps = makeDeps(store);
    const pdfFile = store.addFile("200005.PDF", "pdf", FAKE_PDF);
    const pdf = await processUploadedFile({ quoteId: QUOTE, file: pdfFile, buffer: FAKE_PDF, kind: "pdf", actor: "user-1", deps });
    if (pdf.kind !== "pdf") throw new Error("expected pdf");
    expect(pdf.partId).toBeNull();
    expect(pdf.attachedTo).toBeNull();
    expect(store.parts).toHaveLength(0);
    expect(deps.reprice).not.toHaveBeenCalled();

    const dxf = await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    if (dxf.kind !== "dxf") throw new Error("expected dxf");
    expect(dxf.companion).toEqual({ fileId: pdfFile.id, name: "200005.PDF" });
    expect(dxf.suggestionsSource).toBe("heuristic");
    const part = store.parts.find((p) => p.id === dxf.partId)!;
    expect(part.pdfFileId).toBe(pdfFile.id);
    expect(part.pdfText).toBe(PDF_TEXT_200005);
    expect(part.aiSuggestions?.material).toBe("S355");
  });

  it("prefers the AI suggestions when the prefill dep answers", async () => {
    const store = memoryDb();
    const ai = { ...heuristicSuggestions(PDF_TEXT_200005, "200005"), source: "ai" as const, model: "claude-test", quantity: 25 };
    const deps = makeDeps(store, { prefill: async () => ai });
    store.addFile("200005.pdf", "pdf", FAKE_PDF);
    const dxf = await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    if (dxf.kind !== "dxf") throw new Error("expected dxf");
    expect(dxf.suggestionsSource).toBe("ai");
    expect(store.parts[0].aiSuggestions?.quantity).toBe(25);
  });

  it("survives an unreadable PDF (no text, no suggestions from it)", async () => {
    const store = memoryDb();
    const deps = makeDeps(store, {
      extractPdfText: async () => {
        throw new Error("encrypted");
      },
    });
    await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    const pdfFile = store.addFile("200005.pdf", "pdf", FAKE_PDF);
    const result = await processUploadedFile({ quoteId: QUOTE, file: pdfFile, buffer: FAKE_PDF, kind: "pdf", actor: "user-1", deps });
    if (result.kind !== "pdf") throw new Error("expected pdf");
    expect(result.hasText).toBe(false);
    expect(store.parts[0].pdfFileId).toBe(pdfFile.id);
    expect(store.parts[0].pdfText).toBe("");
  });
});

describe("processUploadedFile — PDF re-triage uses the base geometry", () => {
  const SCALE = { factor: 2, from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, measuredMm: 1, realMm: 2 };
  const OPTIONS = { toleranceMm: 0.01, blankMarginMm: 10 };

  it("does not scale a calibrated part twice: bbox stays 1000 mm and the DXF is re-parsed", async () => {
    const store = memoryDb();
    const deps = makeDeps(store);
    const dxf = await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    if (dxf.kind !== "dxf") throw new Error("expected dxf");
    const part = store.parts.find((p) => p.id === dxf.partId)!;
    const base = part.geometry as PartGeometry;
    // What saveAnnotations stores after calibrating to factor 2: the ANNOTATED geometry.
    const scaled: PartAnnotations = { ...EMPTY_ANNOTATIONS, scale: SCALE };
    const stored = applyAnnotationsSync(base, scaled, OPTIONS);
    expect(stored.measures.bbox.width).toBeCloseTo(1000, 3);
    expect(stored.measures.cutLengthMm).toBeCloseTo(4449, 0);
    await store.db.updatePart(dxf.partId, { geometry: stored, annotations: scaled });
    (deps.download as ReturnType<typeof vi.fn>).mockClear();

    const pdfFile = store.addFile("200005.pdf", "pdf", FAKE_PDF);
    const result = await processUploadedFile({ quoteId: QUOTE, file: pdfFile, buffer: FAKE_PDF, kind: "pdf", actor: OWNER, deps });
    if (result.kind !== "pdf") throw new Error("expected pdf");
    expect(result.partId).toBe(dxf.partId);
    const after = store.parts.find((p) => p.id === dxf.partId)!.geometry as PartGeometry;
    expect(after.measures.bbox.width).toBeCloseTo(1000, 3);
    expect(after.measures.cutLengthMm).toBeCloseTo(4449, 0);
    expect(after.measures.pierces).toBe(26);
    expect(store.parts.find((p) => p.id === dxf.partId)!.annotations.scale).toEqual(SCALE);
    // Non base-equivalent annotations → the file was downloaded and analysed again.
    expect(deps.download).toHaveBeenCalledWith(store.files.find((f) => f.id === part.fileId)!.storagePath);
  });

  it("does not flip a mirrored part back", async () => {
    const store = memoryDb();
    const deps = makeDeps(store);
    const dxf = await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    if (dxf.kind !== "dxf") throw new Error("expected dxf");
    const base = store.parts.find((p) => p.id === dxf.partId)!.geometry as PartGeometry;
    const mirrored: PartAnnotations = { ...EMPTY_ANNOTATIONS, mirrored: true };
    const stored = applyAnnotationsSync(base, mirrored, OPTIONS);
    expect(stored.measures.bbox.minX).not.toBeCloseTo(base.measures.bbox.minX, 3);
    await store.db.updatePart(dxf.partId, { geometry: stored, annotations: mirrored });

    const pdfFile = store.addFile("200005.pdf", "pdf", FAKE_PDF);
    await processUploadedFile({ quoteId: QUOTE, file: pdfFile, buffer: FAKE_PDF, kind: "pdf", actor: OWNER, deps });
    const after = store.parts.find((p) => p.id === dxf.partId)!.geometry as PartGeometry;
    expect(after.measures.bbox.minX).toBeCloseTo(stored.measures.bbox.minX, 3);
    expect(after.measures.bbox.maxX).toBeCloseTo(stored.measures.bbox.maxX, 3);
  });

  it("uses the stored geometry as base when the annotations are base-equivalent (no re-parse)", async () => {
    const store = memoryDb();
    const deps = makeDeps(store);
    const dxf = await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    if (dxf.kind !== "dxf") throw new Error("expected dxf");
    const m8Loop = (store.parts[0].geometry as PartGeometry).measures.holes.find((h) => h.thread?.size === "M8")!.loopId;
    await store.db.updatePart(dxf.partId, { annotations: { ...EMPTY_ANNOTATIONS, threads: { [m8Loop]: "M12" }, unitsConfirmed: true } });
    (deps.download as ReturnType<typeof vi.fn>).mockClear();

    const pdfFile = store.addFile("200005.pdf", "pdf", FAKE_PDF);
    await processUploadedFile({ quoteId: QUOTE, file: pdfFile, buffer: FAKE_PDF, kind: "pdf", actor: OWNER, deps });
    expect(deps.download).not.toHaveBeenCalled();
    const after = store.parts[0].geometry as PartGeometry;
    expect(after.measures.bbox.width).toBeCloseTo(500, 3);
    expect(after.measures.holes.find((h) => h.loopId === m8Loop)!.thread?.size).toBe("M12");
    expect(store.parts[0].pdfText).toBe(PDF_TEXT_200005);
  });
});

describe("processUploadedFile — companion PDFs and who filed them", () => {
  it("ignores a PDF filed under the quote by a sales user who cannot edit it", async () => {
    // Review finding: files rows carry no quote_id; any can_write user can
    // insert a row (and an object) under another owner's quote folder.
    const store = memoryDb();
    const deps = makeDeps(store);
    store.addFile("200005.pdf", "pdf", FAKE_PDF, "user-b");
    store.addFile("200005.pdf", "pdf", FAKE_PDF, "viewer-1");
    const dxf = await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    if (dxf.kind !== "dxf") throw new Error("expected dxf");
    expect(dxf.companion).toBeNull();
    expect(dxf.suggestionsSource).toBeNull();
    const part = store.parts.find((p) => p.id === dxf.partId)!;
    expect(part.pdfFileId).toBeNull();
    expect(part.pdfText).toBeNull();
    expect(part.aiSuggestions).toBeNull();
  });

  it("accepts a PDF filed by the quote owner or an admin", async () => {
    const store = memoryDb();
    const deps = makeDeps(store);
    store.addFile("200005.pdf", "pdf", FAKE_PDF, "user-b");
    const byAdmin = store.addFile("200005.pdf", "pdf", FAKE_PDF, "admin-1");
    const dxf = await uploadDxf(store, deps, "200005.dxf", DXF_200005);
    if (dxf.kind !== "dxf") throw new Error("expected dxf");
    expect(dxf.companion?.fileId).toBe(byAdmin.id);

    const byOwner = store.addFile("200164.pdf", "pdf", FAKE_PDF, OWNER);
    const second = await uploadDxf(store, deps, "200164.dxf", DXF_200164);
    if (second.kind !== "dxf") throw new Error("expected dxf");
    expect(second.companion?.fileId).toBe(byOwner.id);
  });
});

describe("processUploadedFile — STEP", () => {
  it("creates a part without geometry and an item, prefilled by name", async () => {
    const store = memoryDb();
    const deps = makeDeps(store);
    const bytes = new Uint8Array(Buffer.from("ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n"));
    const file = store.addFile("bracket-01.step", "step", bytes);
    const result = await processUploadedFile({ quoteId: QUOTE, file, buffer: bytes, kind: "step", actor: "user-1", deps });
    expect(result).toMatchObject({ kind: "step", name: "bracket-01" });
    const part = store.parts[0];
    expect(part.source).toBe("step");
    expect(part.geometry).toBeNull();
    expect(part.triage).toBeNull();
    expect(part.annotations).toEqual(EMPTY_ANNOTATIONS);
    expect(store.items).toHaveLength(1);
    expect(deps.reprice).toHaveBeenCalledTimes(1);
  });
});
