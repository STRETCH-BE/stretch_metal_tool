/**
 * Pricing engine — priceQuote: the one entry point the server (and the
 * client preview) call. Pure, deterministic; build prompt Step 9.
 * File path: /lib/pricing/price-quote.ts
 *
 * Per item: unitCost = Σ operations.unitCost, unitPrice = unitCost /
 * (1 − margin), batch = unit × qty. Margin is on PRICE (input.marginPct,
 * resolved by the caller with resolveMarginPct); markupPct is the
 * equivalent markup on cost for the UI, inputMarginPct records the margin
 * the run used (the same number here; market mode keeps them apart).
 *
 * Welding-only block (input.weldingOnly, priced whenever present): each
 * seam = effective length × qty × €/mm, one setup per process used,
 * handling = weldHandlingPerPart × partsCount, then the largest minOrder
 * among the processes used — a shortfall becomes a "weld_min_order" line
 * and a green weld.min_order_applied flag. The block has no per-part
 * quantity, so its lines are lot lines (unitCost = line total).
 * MinOrder is compared with COST (rate tables are cost tables; margin is
 * applied afterwards).
 *
 * totalsByType: each line's cost goes to its OperationType bucket minus
 * its setupShare, which goes to the "setup" bucket, so Σ buckets =
 * subtotalCost exactly. Prices per bucket use the same margin.
 *
 * Invalid input throws PricingError: qty ≤ 0, margin ≥ 100 % or non-finite,
 * an item whose part is missing, and (validate.ts) any NaN / Infinity /
 * negative user number in an extra, an annotation or a welding-only seam.
 * No rounding anywhere.
 *
 * Pricing mode: everything above is COST mode (rates.general.pricingMode
 * "cost"). A version in "market" mode (its tables are selling prices)
 * is delegated to lib/pricing/market.ts, which reuses this cost pricer on
 * options.costRates to compute the margin. The welding-only block lives in
 * welding-block.ts, shared by both.
 */

import { PricingError } from "./errors";
import { evaluateQuoteFlags } from "./feasibility";
import { priceMarketQuote } from "./market";
import { buildItemOperations } from "./operations";
import { priceWeldingOnly } from "./welding-block";
import { PRICING_ENGINE_VERSION } from "./version";
import {
  marginToMarkup,
  priceFromCost,
  type Flag,
  type MachinePark,
  type OperationLine,
  type OperationType,
  type PricedItem,
  type PricedQuote,
  type PriceQuoteOptions,
  type QuoteInput,
  type RateSnapshot,
  type TotalsByType,
} from "./types";

/** Explicit override → customer-class margin → default margin. */
export function resolveMarginPct(
  rates: RateSnapshot,
  customerClass: string | null,
  override: number | null | undefined
): number {
  if (override !== null && override !== undefined && Number.isFinite(override)) return override;
  if (customerClass) {
    const byClass = rates.general.marginByClass[customerClass];
    if (typeof byClass === "number" && Number.isFinite(byClass)) return byClass;
  }
  return rates.general.defaultMarginPct;
}

function assertMargin(marginPct: number): void {
  if (!Number.isFinite(marginPct) || marginPct >= 100) {
    throw new PricingError("invalid_margin", `margin must be a finite percentage below 100, got ${String(marginPct)}`, {
      marginPct: Number.isFinite(marginPct) ? marginPct : String(marginPct),
    });
  }
}

function addTotal(totals: TotalsByType, type: OperationType, cost: number, marginPct: number): void {
  const bucket = totals[type] ?? { cost: 0, price: 0 };
  bucket.cost += cost;
  bucket.price = priceFromCost(bucket.cost, marginPct);
  totals[type] = bucket;
}

function accumulate(totals: TotalsByType, operations: OperationLine[], qty: number, marginPct: number): void {
  for (const op of operations) {
    const setup = op.setupShare * qty;
    const base = op.unitCost * qty - setup;
    if (op.type === "setup") {
      addTotal(totals, "setup", op.unitCost * qty, marginPct);
      continue;
    }
    addTotal(totals, op.type, base, marginPct);
    if (setup !== 0) addTotal(totals, "setup", setup, marginPct);
  }
}

/**
 * Price a whole quote from its parts, items, rate snapshot and machine
 * park. Cost mode unless the version says "market" (see file header).
 */
export function priceQuote(
  input: QuoteInput,
  rates: RateSnapshot,
  machines: MachinePark,
  options: PriceQuoteOptions = {}
): PricedQuote {
  if (rates.general.pricingMode === "market") {
    return priceMarketQuote(input, rates, machines, { costRates: options.costRates ?? null, priceCost: priceCostQuote });
  }
  return priceCostQuote(input, rates, machines);
}

/** The cost-mode pricer: unitCost = Σ operations, unitPrice = cost ÷ (1 − margin). */
export function priceCostQuote(input: QuoteInput, rates: RateSnapshot, machines: MachinePark): PricedQuote {
  const marginPct = input.marginPct;
  assertMargin(marginPct);
  const partsById = new Map(input.parts.map((p) => [p.id, p] as const));

  const items: PricedItem[] = input.items.map((item) => {
    if (!Number.isFinite(item.qty) || item.qty <= 0) {
      throw new PricingError("invalid_qty", `item ${item.id}: qty must be > 0, got ${String(item.qty)}`, {
        itemId: item.id,
        qty: Number.isFinite(item.qty) ? item.qty : String(item.qty),
      });
    }
    const part = partsById.get(item.partId);
    if (!part) {
      throw new PricingError("missing_part", `item ${item.id} refers to unknown part ${item.partId}`, {
        itemId: item.id,
        partId: item.partId,
      });
    }
    const { operations, flags } = buildItemOperations(part, item, rates, machines);
    const unitCost = operations.reduce((sum, op) => sum + op.unitCost, 0);
    const unitPrice = priceFromCost(unitCost, marginPct);
    return {
      itemId: item.id,
      partId: part.id,
      qty: item.qty,
      operations,
      unitCost,
      unitPrice,
      batchCost: unitCost * item.qty,
      batchPrice: unitPrice * item.qty,
      flags,
    };
  });

  const weldingBlock = input.weldingOnly ? priceWeldingOnly(input.weldingOnly, rates, marginPct) : null;
  const welding: PricedQuote["welding"] = weldingBlock
    ? {
        operations: weldingBlock.operations,
        cost: weldingBlock.cost,
        price: weldingBlock.price,
        minOrderApplied: weldingBlock.minOrderApplied,
      }
    : null;

  const totalsByType: TotalsByType = {};
  for (const item of items) accumulate(totalsByType, item.operations, item.qty, marginPct);
  if (welding) accumulate(totalsByType, welding.operations, 1, marginPct);

  const subtotalCost = items.reduce((sum, i) => sum + i.batchCost, 0) + (welding?.cost ?? 0);
  const subtotalPrice = items.reduce((sum, i) => sum + (i.batchPrice ?? 0), 0) + (welding?.price ?? 0);

  const allOperations = [...items.flatMap((i) => i.operations), ...(welding?.operations ?? [])];
  const usesPlaceholderRates = allOperations.some((op) => op.rateRef.values.placeholder === true);

  const flags: Flag[] = [
    ...items.flatMap((i) => i.flags),
    ...(weldingBlock?.flags ?? []),
    ...evaluateQuoteFlags({ items, welding }),
  ];

  return {
    items,
    welding,
    totalsByType,
    subtotalCost,
    subtotalPrice,
    marginPct,
    markupPct: marginToMarkup(marginPct),
    inputMarginPct: marginPct,
    flags,
    usesPlaceholderRates,
    rateVersionId: rates.versionId,
    engineVersion: PRICING_ENGINE_VERSION,
    pricingMode: "cost",
    costRateVersionId: null,
    leadTimeDays: input.leadTimeDays ?? null,
    leadTimeMultiplier: 1,
    quoteLines: [],
  };
}
