/**
 * Quote header form state — the pure part of the builder's header
 * (derivation from the bundle, the currency ↔ fx rule and the mapping
 * back to the server-action input). No React, so the rules are unit
 * tested in test/quotes/header-state.test.ts.
 * File path: /components/quote/header-state.ts
 *
 * `fxRate` in the state is always the EUR→PLN rate the quote WOULD use
 * when its currency is PLN: for a PLN quote the stored rate; for an EUR
 * quote (stored fx_rate = 1, the EUR sentinel) or a PLN quote with a
 * nonsensical stored rate the environment default (`fxEurPln`, passed by
 * the page from defaultFxEurPln()). Seeding the default here is what
 * makes an EUR → PLN switch in the header produce PLN prices at the real
 * rate instead of the EUR numbers (fx 1 kept from the stored row). The
 * value actually saved/previewed is `effectiveFxRate`: 1 for EUR, the
 * state's rate for PLN; the server schema rejects PLN with a rate ≤ 1.
 */

import type { CurrencyCode } from "@/lib/db/types";
import { fxRateValidFor, type QuoteHeaderInput } from "@/lib/quotes/schema";
import type { QuoteBundle } from "@/lib/quotes/types";

export type HeaderState = {
  customerId: string;
  currency: CurrencyCode;
  /** EUR→PLN rate used when currency is PLN (see file header). */
  fxRate: number;
  marginPct: number;
  validityDays: number;
  leadTimeText: string;
  paymentTermsText: string;
  notes: string;
  showOperationsOnPdf: boolean;
  weldingSeparate: boolean;
};

/** The stored rate when it is a real EUR→PLN rate, else the default. */
export function seedFxRate(storedFxRate: number | string | null | undefined, fxEurPln: number): number {
  const stored = Number(storedFxRate);
  return Number.isFinite(stored) && fxRateValidFor("PLN", stored) ? stored : fxEurPln;
}

export function headerFromBundle(bundle: QuoteBundle, fxEurPln: number): HeaderState {
  const q = bundle.quote;
  return {
    customerId: q.customer_id ?? "",
    currency: q.currency,
    fxRate: seedFxRate(q.fx_rate, fxEurPln),
    marginPct: Number(q.margin_pct) || 0,
    validityDays: Number(q.validity_days) || 30,
    leadTimeText: q.lead_time_text ?? "",
    paymentTermsText: q.payment_terms_text ?? "",
    notes: q.notes ?? "",
    showOperationsOnPdf: q.show_operations_on_pdf,
    weldingSeparate: q.welding_separate,
  };
}

/** The rate the quote is priced with: 1 for EUR, the header's rate for PLN. */
export function effectiveFxRate(header: Pick<HeaderState, "currency" | "fxRate">): number {
  return header.currency === "EUR" ? 1 : header.fxRate;
}

/** True when the header cannot be saved because the PLN rate is not a real EUR→PLN rate. */
export function headerFxInvalid(header: Pick<HeaderState, "currency" | "fxRate">): boolean {
  return !fxRateValidFor(header.currency, effectiveFxRate(header));
}

export function headerToInput(header: HeaderState): QuoteHeaderInput {
  return {
    customerId: header.customerId || null,
    currency: header.currency,
    fxRate: effectiveFxRate(header),
    marginPct: header.marginPct,
    validityDays: header.validityDays,
    leadTimeText: header.leadTimeText,
    paymentTermsText: header.paymentTermsText,
    notes: header.notes,
    showOperationsOnPdf: header.showOperationsOnPdf,
    weldingSeparate: header.weldingSeparate,
  };
}
