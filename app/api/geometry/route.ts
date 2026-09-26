/**
 * POST /api/geometry — re-analyse a DXF part from its stored file with a
 * (new) healing tolerance, preserving annotations. Body { partId,
 * toleranceMm? } → { triage, fromCache }.
 * File path: /app/api/geometry/route.ts
 *
 * Thin wrapper over the reanalysePart server action (lib/parts/actions.ts),
 * which holds the access check, the SHA-256 cache (another part with the
 * same file hash + tolerance and base-equivalent annotations is copied
 * instead of re-parsed), applyAnnotations and the re-price.
 */

import { NextResponse, type NextRequest } from "next/server";
import { geometryBodySchema } from "@/lib/parts/schema";
import { reanalysePart, type ActionErrorCode } from "@/lib/parts/actions";
import { DEFAULT_TOLERANCE_MM } from "@/lib/geometry/heal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS: Partial<Record<ActionErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_id: 404,
  locked: 409,
  validation: 400,
  no_geometry: 409,
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = geometryBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const result = await reanalysePart(parsed.data.partId, parsed.data.toleranceMm ?? DEFAULT_TOLERANCE_MM);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500 });
  return NextResponse.json(result.data);
}
