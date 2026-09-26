/**
 * POST /api/quotes/[id]/price — server-side re-pricing on demand
 * (the builder calls it to replace a local preview with the persisted
 * result). Returns the PricedQuote (EUR) or `null` when there is nothing
 * to price. Write roles only; ownership AND editability are enforced
 * inside repriceQuote (a sent / won / lost quote answers 409 `locked` and
 * keeps its stored prices — Step 2, Step 14.5). Every successful call is
 * audit-logged as "quote.reprice": it rewrites operations, flags and
 * priced_at, which must be as visible as any other quote change.
 * File path: /app/api/quotes/[id]/price/route.ts
 */

import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { assertRole, WRITE_ROLES } from "@/lib/auth";
import { isPricingError } from "@/lib/pricing/errors";
import { QuoteAccessError } from "@/lib/quotes/access";
import { repriceQuote } from "@/lib/quotes/reprice";

const ACCESS_STATUS: Record<QuoteAccessError["code"], number> = {
  unauthenticated: 401,
  forbidden: 403,
  notFound: 404,
  locked: 409,
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { session, error } = await assertRole(WRITE_ROLES);
  if (error) return error;
  const { id } = await context.params;
  try {
    const priced = await repriceQuote(id);
    await logAudit({
      actor: session.user.id,
      action: "quote.reprice",
      entity: "quotes",
      entityId: id,
      after: {
        source: "api",
        priced: priced !== null,
        rate_version_id: priced?.rateVersionId ?? null,
        subtotal_price_eur: priced?.subtotalPrice ?? null,
        flags: priced?.flags.length ?? 0,
      },
    });
    return NextResponse.json({ priced }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof QuoteAccessError) {
      return NextResponse.json({ error: err.code }, { status: ACCESS_STATUS[err.code] });
    }
    if (isPricingError(err)) {
      return NextResponse.json({ error: err.code, message: err.message, details: err.details ?? null }, { status: 422 });
    }
    console.error("[api/quotes/price]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
