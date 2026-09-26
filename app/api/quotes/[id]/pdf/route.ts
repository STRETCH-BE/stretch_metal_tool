/**
 * GET /api/quotes/[id]/pdf?locale=pl|en&ops=1 — the quote PDF as a
 * download ("SM-2026-0001.pdf"). Any signed-in role may export a quote it
 * can see (RLS); the document never contains cost or margin.
 * File path: /app/api/quotes/[id]/pdf/route.ts
 *
 * Node runtime (react-pdf + font files from disk), never cached, 60 s
 * budget for large multi-part quotes. `ops` overrides the quote's
 * show_operations_on_pdf setting for this export only; `locale` falls
 * back to the customer's preferred locale, then Polish.
 */

import { NextResponse } from "next/server";
import { ALL_ROLES, assertRole } from "@/lib/auth";
import { renderQuotePdf } from "@/lib/pdf/render";
import { getQuoteBundle } from "@/lib/quotes/queries";
import { quotePdfFileName, resolveQuoteLocale } from "@/lib/quotes/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { session, error } = await assertRole(ALL_ROLES);
  if (error) return error;
  const { id } = await context.params;
  const bundle = await getQuoteBundle(id);
  if (!bundle) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const url = new URL(request.url);
  const locale = resolveQuoteLocale(url.searchParams.get("locale"), bundle.customer?.preferred_locale ?? null);
  const opsParam = url.searchParams.get("ops");
  const showOperations = opsParam === null ? bundle.quote.show_operations_on_pdf : opsParam === "1" || opsParam === "true";

  const pdf = await renderQuotePdf(bundle, {
    locale,
    showOperations,
    preparedBy: session.profile.full_name?.trim() || session.profile.email,
  });
  const fileName = quotePdfFileName(bundle.quote, locale);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
