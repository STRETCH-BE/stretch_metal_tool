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
 * Storage and answered with 415 { error: code }. A files row that already
 * exists for this id or path was not written by this flow (the id is the
 * fresh ticket's) and answers 409 { error: "conflict" } without touching
 * it. Everything else runs through lib/parts/intake.ts with the real
 * deps (lib/parts/intake-deps.ts). The files row starts as
 * intake_status = processing; the orchestrator moves it on, so a client
 * that lost this response (504) polls GET /api/files/[id]/status and
 * finishes with POST /api/files/[id]/resume-intake.
 */

import { NextResponse, type NextRequest } from "next/server";
import { DxfFormatError } from "@/lib/geometry";
import { accessErrorResponse, requireQuoteWriter } from "@/lib/parts/access";
import { completeBodySchema } from "@/lib/parts/schema";
import { MAX_FILE_BYTES, mimeForKind, validateSniffedFile } from "@/lib/files/sniff";
import { downloadFile, insertFileRow, parseStoragePath, removeFile, sha256 } from "@/lib/files/storage";
import { processUploadedFile } from "@/lib/parts/intake";
import { createIntakeDeps } from "@/lib/parts/intake-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A 45-part IFC needs well over the 60 s default: parts are stored in
// parallel (lib/parts/intake.ts) but the model itself takes seconds to
// read. Needs Fluid compute on the Vercel project (README "Deploy checklist").
export const maxDuration = 300;

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

  const { supabase, session } = writer;
  const deps = await createIntakeDeps(writer);

  const [byId, byPath] = await Promise.all([
    supabase.from("files").select("id").eq("id", fileId).maybeSingle(),
    supabase.from("files").select("id").eq("storage_path", path).maybeSingle(),
  ]);
  if (byId.error || byPath.error) {
    console.error("[files/complete] files lookup failed", byId.error ?? byPath.error);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
  if (byId.data || byPath.data) return NextResponse.json({ error: "conflict" }, { status: 409 });

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
      quoteId,
      intakeStatus: "processing",
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
