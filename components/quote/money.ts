/**
 * Money helpers for the builder: EUR engine amounts → quote currency text.
 * File path: /components/quote/money.ts
 */

import { formatMoney, toQuoteCurrency, type Locale } from "@/lib/format";

export type MoneyFormatter = (eur: number) => string;

export function makeMoney(currency: "PLN" | "EUR", fxRate: number, locale: Locale): MoneyFormatter {
  const fx = Number.isFinite(fxRate) && fxRate > 0 ? fxRate : 1;
  return (eur: number) => formatMoney(toQuoteCurrency(eur, currency, fx), currency, locale);
}
