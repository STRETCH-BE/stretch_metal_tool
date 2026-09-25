/**
 * Server-side re-pricing of a quote — CONTRACT STUB replaced by the quote
 * builder build step (wave 2). Callers (part page after annotation/material
 * changes, quantity edits, send) must use this and never price on the
 * client for persistence.
 * File path: /lib/quotes/reprice.ts
 *
 * Real implementation: load the quote, its items and parts, the rate
 * snapshot pinned by quotes.rate_version_id (or the active version, which
 * is then pinned), the machine park; run priceQuote() from lib/pricing;
 * persist quote_items.unit_cost/unit_price/flags, replace the operations
 * rows, and write quotes.pricing/flags/subtotal_cost/subtotal_price/
 * priced_at. Returns the PricedQuote or null when the quote has no items.
 */

import type { PricedQuote } from "@/lib/pricing/types";

export async function repriceQuote(
  quoteId: string
): Promise<PricedQuote | null> {
  void quoteId;
  return null;
}
