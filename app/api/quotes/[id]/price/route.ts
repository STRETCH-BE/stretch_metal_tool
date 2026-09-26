/**
 * POST /api/quotes/[id]/price — server-side re-pricing on demand
 * (the builder calls it to replace a local preview with the persisted
 * result). Returns the PricedQuote (EUR) or `null` when there is nothing
 * to price. Write roles only; ownership is enforced inside repriceQuote.
 * File path: /app/api/quotes/[id]/price/route.ts
 */

import { NextResponse } from "next/server";
import { assertRole, WRITE_ROLES } from "@/lib/auth";
import { isPricingError } from "@/lib/pricing/errors";
import { QuoteAccessError } from "@/lib/quotes/access";
import { repriceQuote } from "@/lib/quotes/reprice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await assertRole(WRITE_ROLES);
  if (error) return error;
  const { id } = await context.params;
  try {
    const priced = await repriceQuote(id);
    return NextResponse.json({ priced }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof QuoteAccessError) {
      const status = err.code === "notFound" ? 404 : err.code === "forbidden" ? 403 : 401;
      return NextResponse.json({ error: err.code }, { status });
    }
    if (isPricingError(err)) {
      return NextResponse.json({ error: err.code, message: err.message, details: err.details ?? null }, { status: 422 });
    }
    console.error("[api/quotes/price]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
