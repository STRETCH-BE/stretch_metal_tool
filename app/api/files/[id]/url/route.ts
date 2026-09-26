/**
 * GET /api/files/[id]/url — redirects to a 10-minute signed read url of a
 * stored file (original DXF/PDF/STEP download links).
 * File path: /app/api/files/[id]/url/route.ts
 *
 * Any signed-in role may read (files_select policy); the row is looked
 * up through RLS, the url is signed with the admin client and the
 * response is never cached.
 */

import { NextResponse, type NextRequest } from "next/server";
import { assertRole, ALL_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signedReadUrl } from "@/lib/files/storage";
import { isUuid } from "@/lib/parts/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await assertRole(ALL_ROLES);
  if (auth.error) return auth.error;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const supabase = await createClient();
  const { data: file, error } = await supabase.from("files").select("id, storage_path").eq("id", id).maybeSingle();
  if (error) {
    console.error("[files/url] select failed", error);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const url = await signedReadUrl(file.storage_path);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store, private" } });
  } catch (err) {
    console.error("[files/url] sign failed", err);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
