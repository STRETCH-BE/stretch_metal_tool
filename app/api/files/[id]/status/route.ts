/**
 * GET /api/files/[id]/status — where the intake of an upload stands:
 * { intakeStatus, partsExpected, partsDone, intakeError }. The upload
 * client polls it after the complete request timed out (504) while the
 * server may still be storing parts.
 * File path: /app/api/files/[id]/status/route.ts
 *
 * Any signed-in role may read (files_select policy); never cached.
 */

import { NextResponse, type NextRequest } from "next/server";
import { assertRole, ALL_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/parts/schema";
import type { IntakeStatusDb } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type FileStatusResponse = {
  intakeStatus: IntakeStatusDb | null;
  partsExpected: number | null;
  partsDone: number | null;
  intakeError: string | null;
};

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await assertRole(ALL_ROLES);
  if (auth.error) return auth.error;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const supabase = await createClient();
  const { data: file, error } = await supabase
    .from("files")
    .select("id, intake_status, parts_expected, parts_done, intake_error")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[files/status] select failed", error);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body: FileStatusResponse = {
    intakeStatus: file.intake_status,
    partsExpected: file.parts_expected,
    partsDone: file.parts_done,
    intakeError: file.intake_error,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store, private" } });
}
