/**
 * POST /api/files/[id]/resume-intake — finish the intake of an upload
 * whose first run did not complete (the complete route was cut off by
 * the platform timeout, or some parts failed): parts already stored for
 * the file (parts.source_file_id + name) are kept, the missing ones are
 * stored, the quote is re-priced. Answers the same IntakeResult +
 * { fileId } as the complete route; the assembly result lists every part
 * (stored earlier or now) and `skipped`.
 * File path: /app/api/files/[id]/resume-intake/route.ts
 *
 * Same access as the complete route: the file's quote must be editable
 * by the caller (requireQuoteWriter). Only uploads (dxf / pdf / step /
 * ifc kinds with a quote) can be resumed; a single-part upload that is
 * already stored answers 409 { error: "intake_done" }.
 */

import { NextResponse, type NextRequest } from "next/server";
import { DxfFormatError } from "@/lib/geometry";
import { assertRole, ALL_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { accessErrorResponse, requireQuoteWriter } from "@/lib/parts/access";
import { isUuid } from "@/lib/parts/schema";
import { downloadFile } from "@/lib/files/storage";
import { IntakeAlreadyDoneError, resumeIntake, type IntakeKind } from "@/lib/parts/intake";
import { createIntakeDeps } from "@/lib/parts/intake-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Same budget as the complete route (README "Deploy checklist": Fluid compute).
export const maxDuration = 300;

const RESUMABLE_KINDS: readonly string[] = ["dxf", "pdf", "step", "ifc"];

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await assertRole(ALL_ROLES);
  if (auth.error) return auth.error;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const reader = await createClient();
  const { data: file, error } = await reader
    .from("files")
    .select("id, quote_id, storage_path, original_name, sha256, kind")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[files/resume-intake] select failed", error);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
  if (!file || !file.quote_id || !RESUMABLE_KINDS.includes(file.kind)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let writer: Awaited<ReturnType<typeof requireQuoteWriter>>;
  try {
    writer = await requireQuoteWriter(file.quote_id);
  } catch (err) {
    const response = accessErrorResponse(err);
    if (response) return response;
    console.error("[files/resume-intake] access check failed", err);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }

  let buffer: Buffer;
  try {
    buffer = await downloadFile(file.storage_path);
  } catch (err) {
    console.error("[files/resume-intake] download failed", file.storage_path, err);
    return NextResponse.json({ error: "not_uploaded" }, { status: 409 });
  }

  try {
    const deps = await createIntakeDeps(writer);
    const result = await resumeIntake({
      quoteId: file.quote_id,
      file: { id: file.id, originalName: file.original_name, storagePath: file.storage_path, sha256: file.sha256 },
      buffer: new Uint8Array(buffer),
      kind: file.kind as IntakeKind,
      actor: writer.session.user.id,
      deps,
    });
    return NextResponse.json({ fileId: file.id, ...result });
  } catch (err) {
    if (err instanceof IntakeAlreadyDoneError) return NextResponse.json({ error: "intake_done" }, { status: 409 });
    if (err instanceof DxfFormatError) return NextResponse.json({ error: "unknown_type", sniffed: "unknown" }, { status: 415 });
    console.error("[files/resume-intake] intake failed", err);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
