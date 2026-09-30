/**
 * GET /api/quotes/[id]/pdf?locale=pl|en&ops=1&parts=1 — the quote PDF as
 * a download ("SM-2026-0001.pdf"). Any signed-in role may export a quote
 * it can see (RLS); the document never contains cost or margin.
 * File path: /app/api/quotes/[id]/pdf/route.ts
 *
 * Node runtime (react-pdf; the fonts are embedded in lib/pdf/fonts-data.ts
 * so nothing is read from disk at runtime), never cached, 60 s budget for
 * large multi-part quotes. `ops` overrides the quote's
 * show_operations_on_pdf setting for this export only; `parts=1` adds the
 * "Parts of assembly …" appendix listing the members of every welded
 * assembly (off by default — an assembly is one line on the quote);
 * `locale` falls back to the customer's preferred locale, then Polish.
 *
 * Export guard (docs/assembly-mode-design.md §5): before rendering, the
 * route runs lib/quotes/send-guard.ts exportBlockReasons on the bundle —
 * no / incomplete customer, missing customer type, placeholder company
 * data, unresolved forming — and answers 422 with JSON
 * `{ error: "export_blocked", reasons, message }` for EVERY status, drafts
 * included. `message` is the localized reason list (content.quote.send
 * .reasons) so the builder's toast, which shows `message`, tells the user
 * what to fix; `reasons` lets a client map them itself.
 *
 * A render failure answers 500 with JSON `{ error: "pdf_failed", message }`
 * and is logged with the quote id. The quote builder fetches this route
 * with fetch() and shows that message in a toast — a bare <a download>
 * would only show "Failed — server problem" in the browser's download
 * bar, which is what hid the production failure from the user.
 */

import { NextResponse } from "next/server";
import { getContent } from "@/content";
import { ALL_ROLES, assertRole } from "@/lib/auth";
import { renderQuotePdf } from "@/lib/pdf/render";
import { QuoteAccessError } from "@/lib/quotes/access";
import { getQuoteBundle } from "@/lib/quotes/queries";
import { repriceQuote } from "@/lib/quotes/reprice";
import { exportBlockReasons } from "@/lib/quotes/send-guard";
import { isPricingStale, isQuoteEditable, quotePdfFileName, resolveQuoteLocale } from "@/lib/quotes/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function flagParam(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === "1" || value === "true";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { session, error } = await assertRole(ALL_ROLES);
  if (error) return error;
  const { id } = await context.params;
  let bundle = await getQuoteBundle(id);
  if (!bundle) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A draft whose stored pricing is stale (engine, rates, header, or the
  // customer edited since — VAT follows the customer) is re-priced first,
  // like the send action does; a reader without edit rights gets the stored
  // snapshot.
  if (isQuoteEditable(bundle.quote.status) && isPricingStale(bundle.quote, bundle.pricing, bundle.customer?.updated_at ?? null)) {
    try {
      await repriceQuote(id);
      bundle = (await getQuoteBundle(id)) ?? bundle;
    } catch (repriceError) {
      if (!(repriceError instanceof QuoteAccessError)) console.warn(`[pdf] re-price before export failed for quote ${id}`, repriceError);
    }
  }

  const url = new URL(request.url);
  const locale = resolveQuoteLocale(url.searchParams.get("locale"), bundle.customer?.preferred_locale ?? null);
  const showOperations = flagParam(url.searchParams.get("ops"), bundle.quote.show_operations_on_pdf);
  const showAssemblyParts = flagParam(url.searchParams.get("parts"), false);

  const blocked = exportBlockReasons(bundle);
  if (blocked.length > 0) {
    const reasonText = getContent(locale).quote.builder.send.reasons;
    const message = blocked.map((reason) => reasonText[reason]).join("; ");
    return NextResponse.json({ error: "export_blocked", reasons: blocked, message }, { status: 422 });
  }

  let pdf: Buffer;
  try {
    pdf = await renderQuotePdf(bundle, {
      locale,
      showOperations,
      showAssemblyParts,
      preparedBy: session.profile.full_name?.trim() || session.profile.email,
    });
  } catch (renderError) {
    console.error(`[pdf] render failed for quote ${id}`, renderError);
    const message = renderError instanceof Error ? renderError.message : String(renderError);
    return NextResponse.json({ error: "pdf_failed", message }, { status: 500 });
  }
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
