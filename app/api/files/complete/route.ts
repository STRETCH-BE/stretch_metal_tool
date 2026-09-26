/**
 * POST /api/files/complete — the browser finished uploading to Storage:
 * download the object server-side, sniff its type, hash it, write the
 * files row and run the intake (part + item, PDF companion, STEP stub).
 * Body { quoteId, fileId, path, originalName, size } → IntakeResult +
 * { fileId, kind }.
 * File path: /app/api/files/complete/route.ts
 *
 * The path must be the one the sign route issued for this quote and file
 * id (lib/files/storage.ts parseStoragePath), so a client cannot point
 * the intake at someone else's object. Rejected files (DWG, binary DXF,
 * unknown bytes, extension/bytes mismatch, oversize) are removed from
 * Storage and answered with 415 { error: code }. Everything else runs
 * through lib/parts/intake.ts with the real deps.
 */

import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { geometryEngine, geometryToSvg, DxfFormatError } from "@/lib/geometry";
import { extractPdfText } from "@/lib/pdf-text";
import { prefillFromPdf } from "@/lib/ai/prefill";
import { heuristicSuggestions } from "@/lib/ai/heuristics";
import { repriceQuote } from "@/lib/quotes/reprice";
import { accessErrorResponse, requireQuoteWriter } from "@/lib/parts/access";
import { completeBodySchema } from "@/lib/parts/schema";
import { MAX_FILE_BYTES, mimeForKind, validateSniffedFile } from "@/lib/files/sniff";
import { downloadFile, insertFileRow, parseStoragePath, removeFile, sha256 } from "@/lib/files/storage";
import { processUploadedFile, THUMBNAIL_SIZE, type IntakeDeps } from "@/lib/parts/intake";
import { createIntakeDb } from "@/lib/parts/intake-db";
import { loadRatesInfo } from "@/lib/parts/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = completeBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { quoteId, fileId, path, originalName } = parsed.data;

  let writer: Awaited<ReturnType<typeof requireQuoteWriter>>;
  try {
    writer = await requireQuoteWriter(quoteId);
  } catch (error) {
    const response = accessErrorResponse(error);
    if (response) return response;
    console.error("[files/complete] access check failed", error);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }

  const parsedPath = parseStoragePath(path);
  if (!parsedPath || parsedPath.quoteId !== quoteId.toLowerCase() || parsedPath.fileId !== fileId.toLowerCase()) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = await downloadFile(path);
  } catch (error) {
    console.error("[files/complete] download failed", path, error);
    return NextResponse.json({ error: "not_uploaded" }, { status: 409 });
  }
  if (buffer.byteLength > MAX_FILE_BYTES || buffer.byteLength === 0) {
    await removeFile(path);
    return NextResponse.json({ error: buffer.byteLength === 0 ? "empty" : "size" }, { status: 415 });
  }

  const sniffed = validateSniffedFile(buffer, originalName);
  if (!sniffed.ok) {
    await removeFile(path);
    return NextResponse.json({ error: sniffed.code, sniffed: sniffed.sniffed }, { status: 415 });
  }

  const { supabase, session, quote } = writer;
  const rates = await loadRatesInfo(supabase, quote.rate_version_id);
  const deps: IntakeDeps = {
    analyse: (text, options) => geometryEngine.analyzeDxf(text, options),
    applyAnnotations: (geometry, annotations, options) => geometryEngine.applyAnnotations(geometry, annotations, options),
    toSvg: (geometry, annotations) => geometryToSvg(geometry, annotations, { ...THUMBNAIL_SIZE, theme: "light" }),
    extractPdfText: async (bytes) => (await extractPdfText(bytes)).text,
    prefill: (input) => (env.hasAi() ? prefillFromPdf(input) : Promise.resolve(null)),
    heuristics: heuristicSuggestions,
    download: async (storagePath) => new Uint8Array(await downloadFile(storagePath)),
    densityFor: (code) =>
      code ? (rates.materials.find((m) => m.code.toLowerCase() === code.toLowerCase())?.densityKgM3 ?? null) : null,
    db: createIntakeDb(supabase),
    reprice: async (id) => {
      await repriceQuote(id);
    },
    blankMarginMm: rates.blankMarginMm,
    locale: session.profile.locale,
  };

  let fileRowId: string | null = null;
  try {
    const hash = sha256(buffer);
    const row = await insertFileRow(supabase, {
      id: fileId,
      storagePath: path,
      originalName,
      mime: mimeForKind(sniffed.kind),
      size: buffer.byteLength,
      sha256: hash,
      kind: sniffed.kind,
      uploadedBy: session.user.id,
    });
    fileRowId = row.id;
    const result = await processUploadedFile({
      quoteId,
      file: { id: row.id, originalName: row.original_name, storagePath: row.storage_path, sha256: row.sha256 },
      buffer: new Uint8Array(buffer),
      kind: sniffed.kind,
      actor: session.user.id,
      deps,
    });
    return NextResponse.json({ fileId: row.id, ...result });
  } catch (error) {
    if (error instanceof DxfFormatError) {
      await removeFile(path);
      if (fileRowId) await supabase.from("files").delete().eq("id", fileRowId);
      return NextResponse.json({ error: "unknown_type", sniffed: "unknown" }, { status: 415 });
    }
    console.error("[files/complete] intake failed", error);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
