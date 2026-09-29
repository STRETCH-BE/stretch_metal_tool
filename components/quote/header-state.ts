/**
 * Quote header form state — the pure part of the builder's header
 * (derivation from the bundle, the currency ↔ fx rule, the assembly-mode
 * fields — customer reference, contact person, shipping, price scale —
 * and the mapping back to the server-action input). No React, so the
 * rules are unit tested in test/quotes/header-state.test.ts and
 * test/ui/header-state-assembly.test.ts.
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
 *
 * Shipping: `shipping` null = no shipping line (collection). The editor
 * keeps the typed gross mass / cost as null when the user asks for the
 * computed mass / the carrier table (ShippingInput semantics). Price
 * scale: `priceScaleEnabled` false posts [] (the stored list is cleared);
 * true posts the parsed quantities. Both, plus customer reference and
 * contact person, are always sent by headerToInput — the server keeps a
 * column only when the key is OMITTED, and the builder always knows the
 * full header.
 */

import type { CurrencyCode } from "@/lib/db/types";
import type { ShippingInput } from "@/lib/pricing/types";
import { fxRateValidFor, normalisePriceScale, parseShipping, type QuoteHeaderInput } from "@/lib/quotes/schema";
import type { QuoteBundle } from "@/lib/quotes/types";

export type ShippingState = {
  /** ISO-2 destination (upper case). */
  countryCode: string;
  /** Typed gross mass; null = computed from the parts + packaging. */
  grossKg: number | null;
  /** Typed cost; null with source "table" = the shipping_rates band. */
  costEur: number | null;
  source: "manual" | "table";
  carrier: string;
  extraLeadDays: number;
};

export type HeaderState = {
  customerId: string;
  currency: CurrencyCode;
  /** EUR→PLN rate used when currency is PLN (see file header). */
  fxRate: number;
  marginPct: number;
  validityDays: number;
  /** Promised lead time in working days (drives the market lead-time multiplier). */
  leadTimeDays: number;
  leadTimeText: string;
  paymentTermsText: string;
  notes: string;
  showOperationsOnPdf: boolean;
  weldingSeparate: boolean;
  /** Assembly mode (docs/assembly-mode-design.md §2 quotes). */
  customerReference: string;
  contactPerson: string;
  shipping: ShippingState | null;
  priceScaleEnabled: boolean;
  priceScale: number[];
};

/** The stored rate when it is a real EUR→PLN rate, else the default. */
export function seedFxRate(storedFxRate: number | string | null | undefined, fxEurPln: number): number {
  const stored = Number(storedFxRate);
  return Number.isFinite(stored) && fxRateValidFor("PLN", stored) ? stored : fxEurPln;
}

export function shippingFromInput(input: ShippingInput | null): ShippingState | null {
  if (!input) return null;
  return {
    countryCode: input.countryCode.toUpperCase(),
    grossKg: input.grossKg,
    costEur: input.source === "manual" ? input.costEur : null,
    source: input.source,
    carrier: input.carrier ?? "",
    extraLeadDays: Number.isFinite(input.extraLeadDays) ? Math.max(0, Math.round(input.extraLeadDays)) : 0,
  };
}

/** A fresh shipping block for the "add shipping" toggle: the customer's country, computed mass, carrier table. */
export function defaultShippingState(customerCountry: string | null | undefined): ShippingState {
  return {
    countryCode: (customerCountry ?? "PL").toUpperCase(), // [CONFIRM] home country default when the quote has no customer
    grossKg: null,
    costEur: null,
    source: "table",
    carrier: "",
    extraLeadDays: 0,
  };
}

export function shippingToInput(state: ShippingState | null): ShippingInput | null {
  if (!state) return null;
  const manual = state.source === "manual";
  return {
    countryCode: state.countryCode.trim().toUpperCase(),
    grossKg: state.grossKg !== null && Number.isFinite(state.grossKg) && state.grossKg > 0 ? state.grossKg : null,
    costEur: manual && state.costEur !== null && Number.isFinite(state.costEur) && state.costEur >= 0 ? state.costEur : null,
    source: state.source,
    carrier: state.carrier.trim() === "" ? null : state.carrier.trim(),
    extraLeadDays: Number.isFinite(state.extraLeadDays) ? Math.max(0, Math.round(state.extraLeadDays)) : 0,
  };
}

/** A manual shipping block that has no cost yet cannot be saved (the server schema needs a number). */
export function shippingInvalid(state: ShippingState | null): boolean {
  if (!state) return false;
  if (state.countryCode.trim().length !== 2) return true;
  if (state.source === "manual" && (state.costEur === null || !Number.isFinite(state.costEur) || state.costEur < 0)) return true;
  return false;
}

export function headerFromBundle(bundle: QuoteBundle, fxEurPln: number): HeaderState {
  const q = bundle.quote;
  const priceScale = normalisePriceScale(q.price_scale ?? []);
  return {
    customerId: q.customer_id ?? "",
    currency: q.currency,
    fxRate: seedFxRate(q.fx_rate, fxEurPln),
    marginPct: Number(q.margin_pct) || 0,
    validityDays: Number(q.validity_days) || 30,
    leadTimeDays: Number(q.lead_time_days) > 0 ? Number(q.lead_time_days) : 11, // [CONFIRM] default promised lead time
    leadTimeText: q.lead_time_text ?? "",
    paymentTermsText: q.payment_terms_text ?? "",
    notes: q.notes ?? "",
    showOperationsOnPdf: q.show_operations_on_pdf,
    weldingSeparate: q.welding_separate,
    customerReference: q.customer_reference ?? "",
    contactPerson: q.contact_person ?? "",
    shipping: shippingFromInput(parseShipping(q.shipping ?? null)),
    priceScaleEnabled: priceScale.length > 0,
    priceScale,
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

/** The price scale the quote is priced with: [] when the toggle is off. */
export function effectivePriceScale(header: Pick<HeaderState, "priceScaleEnabled" | "priceScale">): number[] {
  return header.priceScaleEnabled ? normalisePriceScale(header.priceScale) : [];
}

export function headerToInput(header: HeaderState): QuoteHeaderInput {
  return {
    customerId: header.customerId || null,
    currency: header.currency,
    fxRate: effectiveFxRate(header),
    marginPct: header.marginPct,
    validityDays: header.validityDays,
    leadTimeDays: header.leadTimeDays,
    leadTimeText: header.leadTimeText,
    paymentTermsText: header.paymentTermsText,
    notes: header.notes,
    showOperationsOnPdf: header.showOperationsOnPdf,
    weldingSeparate: header.weldingSeparate,
    customerReference: header.customerReference.trim() === "" ? null : header.customerReference.trim(),
    contactPerson: header.contactPerson.trim() === "" ? null : header.contactPerson.trim(),
    shipping: shippingToInput(header.shipping),
    priceScale: effectivePriceScale(header),
  };
}
