/**
 * Live pricing preview — the client-side mirror of lib/quotes/reprice.ts.
 * Runs the same pure priceQuote() on the bundle rows with the user's
 * unsaved edits (quantities, extras, scrap, margin, currency/fx, seams)
 * so the builder can show numbers instantly; the server result replaces
 * it after every save (never persisted from here — Step 12).
 * File path: /components/quote/preview.ts
 *
 * `QuoteDraft` is the minimal editable state; `draftFromBundle` derives
 * it from the server bundle and `isDraftDirty` tells the UI to label the
 * numbers as "preview". Pricing errors (PricingError from bad input) are
 * returned, not thrown, so a half-typed number never crashes the page.
 */

import type { QuoteItemRow } from "@/lib/db/types";
import { isPricingError } from "@/lib/pricing/errors";
import { priceQuote } from "@/lib/pricing/price-quote";
import type { ExtraOperation, MachinePark, PricedQuote, RateSnapshot } from "@/lib/pricing/types";
import { buildQuoteInput, hasPriceableContent, toJson } from "@/lib/quotes/mapper";
import { parseExtras } from "@/lib/quotes/schema";
import type { QuoteBundle, WeldingOnlyBlock } from "@/lib/quotes/types";

export type QuoteDraft = {
  marginPct: number;
  currency: "PLN" | "EUR";
  fxRate: number;
  qtyById: Record<string, number>;
  extrasById: Record<string, ExtraOperation[]>;
  scrapById: Record<string, number | null>;
  welding: WeldingOnlyBlock | null;
};

export function draftFromBundle(bundle: QuoteBundle): QuoteDraft {
  const qtyById: Record<string, number> = {};
  const extrasById: Record<string, ExtraOperation[]> = {};
  const scrapById: Record<string, number | null> = {};
  for (const item of bundle.items) {
    qtyById[item.id] = Number(item.qty);
    extrasById[item.id] = parseExtras(item.extras);
    scrapById[item.id] = item.scrap_pct === null ? null : Number(item.scrap_pct);
  }
  return {
    marginPct: Number(bundle.quote.margin_pct),
    currency: bundle.quote.currency,
    fxRate: Number(bundle.quote.fx_rate) || 1,
    qtyById,
    extrasById,
    scrapById,
    welding: bundle.weldingOnly ? structuredClone(bundle.weldingOnly) : null,
  };
}

export function isDraftDirty(draft: QuoteDraft, bundle: QuoteBundle): boolean {
  return JSON.stringify(draft) !== JSON.stringify(draftFromBundle(bundle));
}

export type PreviewResult = { priced: PricedQuote | null; error: string | null };

/** Apply the draft to the bundle rows and price them with the same engine the server uses. */
export function computePreview(
  bundle: QuoteBundle,
  rates: RateSnapshot | null,
  machines: MachinePark,
  draft: QuoteDraft
): PreviewResult {
  if (!rates) return { priced: null, error: null };
  const items: QuoteItemRow[] = bundle.items.map((item) => ({
    ...item,
    qty: draft.qtyById[item.id] ?? Number(item.qty),
    extras: toJson(draft.extrasById[item.id] ?? parseExtras(item.extras)),
    scrap_pct: item.id in draft.scrapById ? draft.scrapById[item.id] : item.scrap_pct,
  }));
  const quote = {
    type: bundle.quote.type,
    margin_pct: draft.marginPct,
    welding_only: draft.welding ? toJson(draft.welding) : null,
  };
  try {
    const input = buildQuoteInput({ quote, customer: bundle.customer, items, parts: bundle.parts, rates });
    if (!hasPriceableContent(input)) return { priced: null, error: null };
    return { priced: priceQuote(input, rates, machines), error: null };
  } catch (error) {
    if (isPricingError(error)) return { priced: null, error: error.message };
    return { priced: null, error: error instanceof Error ? error.message : String(error) };
  }
}
