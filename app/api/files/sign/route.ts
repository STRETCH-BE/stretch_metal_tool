/**
 * POST /api/files/sign — issues a signed upload url for one file of a
 * quote. Body { quoteId, fileName, size } → { fileId, path, token,
 * signedUrl, kind }.
 * File path: /app/api/files/sign/route.ts
 *
 * Checks, in order: session with a write role + can_edit_quote + editable
 * quote (lib/parts/access.ts), then extension whitelist / 25 MB / DWG
 * (lib/files/sniff.ts — a .dwg answers 400 { error: "dwg" } so the UI
 * shows "save as DXF" with the guide link). No file bytes pass through
 * here: the browser uploads to Storage with the ticket.
 */

import { NextResponse, type NextRequest } from "next/server";
import { accessErrorResponse, requireQuoteWriter } from "@/lib/parts/access";
import { signBodySchema } from "@/lib/parts/schema";
import { validateUploadRequest } from "@/lib/files/sniff";
import { createUploadTicket } from "@/lib/files/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = signBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { quoteId, fileName, size } = parsed.data;

  try {
    await requireQuoteWriter(quoteId);
  } catch (error) {
    const response = accessErrorResponse(error);
    if (response) return response;
    console.error("[files/sign] access check failed", error);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }

  const validation = validateUploadRequest({ fileName, size });
  if (!validation.ok) return NextResponse.json({ error: validation.code }, { status: 400 });

  try {
    const ticket = await createUploadTicket(quoteId, fileName);
    return NextResponse.json({ ...ticket, kind: validation.kind });
  } catch (error) {
    console.error("[files/sign] ticket failed", error);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
