/**
 * Pricing engine — the price scale: the quote re-priced at every extra
 * quantity of QuoteInput.priceScale (assembly mode,
 * docs/assembly-mode-design.md §3 "Price scale").
 * File path: /lib/pricing/scale.ts
 *
 * For each quantity q (positive, finite, de-duplicated, ascending) a copy
 * of the input is priced with EVERY loose item at qty q and EVERY assembly
 * at qty q (its members at q × qtyPerAssembly), so the set-ups and order
 * charges are spread over q and the unit price falls with the quantity.
 * The copy carries priceScale [] so the pricer never recurses. Subjects =
 * loose items (in input order) then assemblies (position order); a
 * refused / unpriceable subject reports unitPrice and total null at that
 * quantity. The pricer is injected (price-quote.ts passes priceQuote with
 * the same rates, machines and options), which keeps this module free of
 * the pricing modes.
 */

import { partitionItems, memberQty } from "./assembly";
import type { PriceScale, PriceScaleEntry, PricedQuote, QuoteInput } from "./types";

/** The quantities a scale runs for: positive finite numbers, unique, ascending. */
export function scaleQuantities(priceScale: readonly number[] | null | undefined): number[] {
  const set = new Set<number>();
  for (const q of priceScale ?? []) if (Number.isFinite(q) && q > 0) set.add(q);
  return [...set].sort((a, b) => a - b);
}

/** The input with every loose item and assembly at quantity q (members at q × qtyPerAssembly) and no scale of its own. */
export function scaledInput(input: QuoteInput, qty: number): QuoteInput {
  const assemblies = (input.assemblies ?? []).map((a) => ({ ...a, qty }));
  const byId = new Map(assemblies.map((a) => [a.id, a] as const));
  const items = input.items.map((item) => {
    const assembly = item.assemblyId ? byId.get(item.assemblyId) : undefined;
    return { ...item, qty: assembly ? memberQty(assembly, item) : qty };
  });
  return { ...input, items, assemblies, priceScale: [] };
}

/** Unit price and total of every loose item and assembly at each quantity of input.priceScale. */
export function priceScale(input: QuoteInput, priceFn: (input: QuoteInput) => PricedQuote): PriceScale[] {
  const quantities = scaleQuantities(input.priceScale);
  if (quantities.length === 0) return [];
  const { loose, assemblies } = partitionItems(input);
  const subjects: PriceScale[] = [
    ...loose.map((item) => ({ subjectId: item.id, kind: "item" as const, entries: [] as PriceScaleEntry[] })),
    ...assemblies.map((a) => ({ subjectId: a.id, kind: "assembly" as const, entries: [] as PriceScaleEntry[] })),
  ];
  const byId = new Map(subjects.map((s) => [`${s.kind}:${s.subjectId}`, s] as const));
  for (const qty of quantities) {
    const priced = priceFn(scaledInput(input, qty));
    for (const item of priced.items) {
      byId.get(`item:${item.itemId}`)?.entries.push({ qty, unitPrice: item.unitPrice, total: item.batchPrice });
    }
    for (const assembly of priced.assemblies) {
      byId.get(`assembly:${assembly.assemblyId}`)?.entries.push({ qty, unitPrice: assembly.unitPrice, total: assembly.batchPrice });
    }
  }
  return subjects;
}
