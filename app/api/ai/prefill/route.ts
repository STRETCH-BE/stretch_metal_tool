/**
 * POST /api/ai/prefill — runs the PDF pre-fill for a part and stores the
 * suggestion object. Body { partId } → { source: "ai" | "heuristic",
 * aiAvailable, suggestions }.
 * File path: /app/api/ai/prefill/route.ts
 *
 * 409 { error: "no_pdf" } when the part has no PDF companion. Without
 * ANTHROPIC_API_KEY (env.hasAi() false) the heuristics run and the
 * answer says source "heuristic" so the UI can show the no-key notice.
 * Nothing is applied to the part.
 */

import { NextResponse, type NextRequest } from "next/server";
import { accessErrorResponse, requirePartWriter } from "@/lib/parts/access";
import { prefillBodySchema } from "@/lib/parts/schema";
import { prefillPartSuggestions } from "@/lib/parts/prefill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = prefillBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { supabase, part, session } = await requirePartWriter(parsed.data.partId);
    if (!part.pdf_file_id) return NextResponse.json({ error: "no_pdf" }, { status: 409 });
    const { data: pdf, error } = await supabase.from("files").select("*").eq("id", part.pdf_file_id).maybeSingle();
    if (error) throw new Error(`files select: ${error.message}`);
    if (!pdf || pdf.kind !== "pdf") return NextResponse.json({ error: "no_pdf" }, { status: 409 });
    const outcome = await prefillPartSuggestions(supabase, part, pdf, session.profile.locale);
    return NextResponse.json({ source: outcome.suggestions.source, aiAvailable: outcome.aiAvailable, suggestions: outcome.suggestions });
  } catch (error) {
    const response = accessErrorResponse(error);
    if (response) return response;
    console.error("[ai/prefill] failed", error);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
