"use client";

/**
 * VatSummary — net / shipping / VAT / gross rows under the quote totals
 * (docs/assembly-mode-design.md §3.4): the VAT rate and amount plus the
 * gross when the rate is above 0, the 0 % mode note (reverse charge /
 * export / none) otherwise, the "unknown" note when the engine could not
 * determine VAT (no customer type / country), and the placeholder-rates
 * chip when any rate used is still a [CONFIRM] guess.
 * File path: /components/quote/vat-summary.tsx
 *
 * Numbers come from PricedQuote (server snapshot or preview) through the
 * pure model in components/quote/vat-summary.ts; amounts are converted
 * with the builder's money formatter (quote currency).
 */

import { useContent } from "@/components/providers/locale";
import { PlaceholderBadge } from "@/components/ui/placeholder-badge";
import { formatPercent, interpolate } from "@/lib/format";
import { countryName } from "@/lib/customers/countries";
import type { PricedQuote } from "@/lib/pricing/types";
import type { MoneyFormatter } from "./money";
import { vatSummaryModel, vatSummaryRows } from "./vat-summary-model";

export type VatSummaryProps = {
  pricing: Pick<PricedQuote, "subtotalPrice" | "shipping" | "vat" | "usesPlaceholderRates">;
  money: MoneyFormatter;
};

export function VatSummary({ pricing, money }: VatSummaryProps) {
  const c = useContent();
  const t = c.quote.builder.vat;
  const model = vatSummaryModel(pricing);
  const { rows, note } = vatSummaryRows(model, t, money, (pct) => formatPercent(pct, c.locale, pct % 1 === 0 ? 0 : 1), interpolate);
  const country = model.vat?.countryCode ?? null;

  return (
    <section aria-label={t.title} className="mt-3 border-t border-border pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="panel-title">{t.title}</span>
        {pricing.usesPlaceholderRates && <PlaceholderBadge />}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className={row.key === "shipping" ? "pl-3 text-text-faint" : "text-text-muted"}>
              {row.label}
              {row.key === "vat" && country && model.vat?.mode === "b2c_oss" && (
                <span className="ml-2 text-text-faint">{interpolate(t.countryNote, { country: countryName(country, c.locale, c.quote.customers.countries) })}</span>
              )}
            </dt>
            <dd className={`num money ${row.emphasis ? "text-[15px] font-bold" : ""} ${row.key === "shipping" ? "text-text-faint" : ""}`.trim()}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-2 text-[11.5px] text-text-faint">{note}</p>}
    </section>
  );
}
