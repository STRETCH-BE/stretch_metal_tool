/**
 * VAT summary model — the pure part of components/quote/vat-summary.tsx (kept in its own file so the .ts / .tsx names do not shadow each other):
 * turns a priced quote into the net / shipping / VAT / gross rows shown
 * under the totals and decides whether a gross line is shown at all.
 * Unit tested in test/ui/vat-summary.test.ts.
 * File path: /components/quote/vat-summary-model.ts
 *
 * Rules (docs/assembly-mode-design.md §3.4): net = the engine's
 * subtotalPrice (shipping already inside it, shown as its own line);
 * when `pricing.vat` is null (no customer type / country known) only the
 * net is shown with the "unknown" note; when the rate is above 0 the VAT
 * amount and the gross follow; at 0 % the mode note (reverse charge /
 * export / none) replaces them. Amounts are EUR engine truth — the
 * component converts them with the quote's money formatter.
 */

import type { OperationLine, PricedQuote, VatMode, VatResult } from "@/lib/pricing/types";

export type VatSummaryModel = {
  /** Net total including the shipping line (EUR). */
  netEur: number;
  /** Shipping line inside the net, or null when the quote has none. */
  shippingEur: number | null;
  /** null = VAT unknown (no customer type / country). */
  vat: { mode: VatMode; ratePct: number; countryCode: string | null; amountEur: number; grossEur: number } | null;
  /** True when a VAT amount and a gross total are shown. */
  showGross: boolean;
  /** True when the 0 % / unknown note is shown instead of the gross. */
  showNote: boolean;
};

export type VatSummaryInput = Pick<PricedQuote, "subtotalPrice"> & {
  shipping?: Pick<OperationLine, "unitCost"> | null;
  vat?: VatResult | null;
};

export function vatSummaryModel(pricing: VatSummaryInput): VatSummaryModel {
  const shippingEur = pricing.shipping ? pricing.shipping.unitCost : null;
  const vat = pricing.vat ?? null;
  if (!vat) {
    return { netEur: pricing.subtotalPrice, shippingEur, vat: null, showGross: false, showNote: true };
  }
  const showGross = vat.ratePct > 0;
  return {
    netEur: vat.netTotal,
    shippingEur,
    vat: { mode: vat.mode, ratePct: vat.ratePct, countryCode: vat.countryCode, amountEur: vat.vatAmount, grossEur: vat.grossTotal },
    showGross,
    showNote: !showGross,
  };
}

export type VatSummaryCopy = {
  net: string;
  shipping: string;
  /** `{rate}` placeholder. */
  rate: string;
  amount: string;
  gross: string;
  modes: Record<VatMode, string>;
  unknown: string;
};

export type VatSummaryRow = { key: "net" | "shipping" | "vat" | "gross"; label: string; value: string; emphasis?: boolean };

/**
 * Rows + note ready to render; `money` converts EUR to the quote currency
 * text and `percent` formats the rate (both locale-aware, injected so the
 * helper stays free of React and Intl setup).
 */
export function vatSummaryRows(
  model: VatSummaryModel,
  copy: VatSummaryCopy,
  money: (eur: number) => string,
  percent: (pct: number) => string,
  interpolate: (template: string, params: Record<string, string | number>) => string
): { rows: VatSummaryRow[]; note: string | null } {
  const rows: VatSummaryRow[] = [{ key: "net", label: copy.net, value: money(model.netEur), emphasis: !model.showGross }];
  if (model.shippingEur !== null) rows.push({ key: "shipping", label: copy.shipping, value: money(model.shippingEur) });
  if (model.vat && model.showGross) {
    rows.push({ key: "vat", label: interpolate(copy.rate, { rate: percent(model.vat.ratePct) }), value: money(model.vat.amountEur) });
    rows.push({ key: "gross", label: copy.gross, value: money(model.vat.grossEur), emphasis: true });
  }
  const note = model.vat ? (model.showNote ? copy.modes[model.vat.mode] : null) : copy.unknown;
  return { rows, note };
}
