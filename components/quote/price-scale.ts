/**
 * Price scale editor helpers — the pure part of components/quote/
 * price-scale-editor.tsx: the default quantity set, parsing the typed
 * list ("20, 50, 100") and formatting it back. Unit tested in
 * test/ui/price-scale.test.ts.
 * File path: /components/quote/price-scale.ts
 *
 * Parsing is forgiving about separators (comma, semicolon, whitespace,
 * Polish "1 000" grouping is NOT supported — a space separates values),
 * strict about the values: positive whole numbers only, duplicates
 * dropped, sorted ascending, capped at PRICE_SCALE_MAX (the server
 * schema's limit) so the header can never post a list the server rejects.
 * The default set is the owner's request from the second RFQ
 * (docs/assembly-mode-design.md §1).
 */

import { PRICE_SCALE_MAX, normalisePriceScale } from "@/lib/quotes/schema";

/** The quantities offered by the toggle before the user edits them. */
export const DEFAULT_PRICE_SCALE: readonly number[] = [20, 50, 100, 200, 500, 1000]; // [CONFIRM] default price-scale quantities

export type PriceScaleParse = {
  /** Valid quantities: positive integers, unique, ascending, at most PRICE_SCALE_MAX. */
  values: number[];
  /** Tokens that were not positive whole numbers (shown in the field error). */
  invalid: string[];
  /** True when more than PRICE_SCALE_MAX distinct quantities were typed (the extra ones are dropped). */
  truncated: boolean;
};

const SEPARATORS = /[,;\s]+/;

/** "20, 50, 100" → { values: [20, 50, 100], invalid: [] }; "20, abc, 0, 50" → invalid ["abc", "0"]. */
export function parsePriceScaleText(text: string): PriceScaleParse {
  const tokens = text.split(SEPARATORS).map((t) => t.trim()).filter((t) => t.length > 0);
  const valid: number[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    if (!/^\+?\d+$/.test(token)) {
      invalid.push(token);
      continue;
    }
    const n = Number(token);
    if (!Number.isSafeInteger(n) || n <= 0) {
      invalid.push(token);
      continue;
    }
    valid.push(n);
  }
  const unique = normalisePriceScale(valid);
  const truncated = unique.length > PRICE_SCALE_MAX;
  return { values: truncated ? unique.slice(0, PRICE_SCALE_MAX) : unique, invalid, truncated };
}

/** [20, 50] → "20, 50" (the field text; plain digits so it re-parses). */
export function formatPriceScale(values: readonly number[]): string {
  return values.map((v) => String(v)).join(", ");
}

/** True when the two lists hold the same quantities in the same order. */
export function samePriceScale(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
