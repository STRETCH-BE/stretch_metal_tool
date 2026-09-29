/**
 * Pricing engine — the quote-level shipping line (assembly mode,
 * docs/assembly-mode-design.md §2 / §4 ShippingInput).
 * File path: /lib/pricing/shipping.ts
 *
 * Sources:
 *   manual  the cost the user typed (ShippingInput.costEur) — as typed;
 *           null → nothing to charge → amber shipping.missing;
 *   table   shipping_rates: the first band of the destination country
 *           (ISO-2, case-insensitive) with max_kg ≥ the gross mass — the
 *           mass the user typed (grossKg), else the one computed from the
 *           parts + packaging allowance; no band for the country / mass →
 *           amber shipping.missing, no line.
 * No shipping input at all: nothing is charged, and a customer ABROAD
 * (customerCountry ≠ the home country) gets amber shipping.missing —
 * the owner ships every foreign order; a domestic customer may collect.
 * The line (id "quote:shipping", type "shipping", label
 * OPERATION_LABELS.shipping, driver = kg) is a pass-through: cost = price,
 * outside every margin, included in subtotalPrice, and VAT is computed on
 * a net total that includes it. RateRef.table is a closed union, so the
 * band is recorded as table "manual" with key "shipping_rates/<CC>/<maxKg>"
 * (or "shipping/manual") and its numbers in `values`.
 */

import { OPERATION_LABELS } from "./labels";
import type { Flag, OperationLine, ShippingInput, ShippingRate } from "./types";
import { normaliseCountry } from "./vat";

export type ShippingContext = {
  /** ISO-2 of the customer; null when unknown. */
  customerCountry: string | null;
  /** ISO-2 of the company (JobRates.homeCountry). */
  homeCountry: string;
  /** JobRates.placeholder — recorded on the line's rateRef. */
  placeholder?: boolean;
};

export type ShippingResult = { line: OperationLine | null; flags: Flag[] };

/** The first band (smallest max_kg) of the country that carries the mass; null when none does. */
export function pickShippingBand(rates: readonly ShippingRate[], countryCode: string, grossKg: number): ShippingRate | null {
  const country = normaliseCountry(countryCode);
  if (!country) return null;
  const bands = rates.filter((r) => normaliseCountry(r.countryCode) === country).sort((a, b) => a.maxKg - b.maxKg);
  return bands.find((b) => grossKg <= b.maxKg + 1e-9) ?? null;
}

function missing(countryCode: string | null, grossKg: number): Flag {
  return {
    code: "shipping.missing",
    severity: "amber",
    partId: null,
    itemId: null,
    params: { countryCode: countryCode ?? "", grossKg },
    overridable: true,
  };
}

function line(costEur: number, grossKg: number, key: string, values: OperationLine["rateRef"]["values"], details: OperationLine["details"]): OperationLine {
  return {
    id: "quote:shipping",
    type: "shipping",
    label: OPERATION_LABELS.shipping,
    driverQty: grossKg,
    driverUnit: "kg",
    rateRef: { table: "manual", key, values },
    unitCost: costEur,
    setupShare: 0,
    auto: true,
    notes: null,
    details,
  };
}

/**
 * The shipping line for the quote (see the header). `computedGrossKg` is
 * the gross mass from the parts + packaging allowance, used when the input
 * carries no mass of its own.
 */
export function shippingLine(
  input: ShippingInput | null | undefined,
  rates: readonly ShippingRate[],
  computedGrossKg: number,
  ctx: ShippingContext
): ShippingResult {
  const placeholder = ctx.placeholder ?? false;
  const customer = normaliseCountry(ctx.customerCountry);
  const home = normaliseCountry(ctx.homeCountry) ?? "PL";

  if (!input) {
    const abroad = customer !== null && customer !== home;
    return { line: null, flags: abroad ? [missing(customer, computedGrossKg)] : [] };
  }

  const country = normaliseCountry(input.countryCode) ?? customer;
  const grossKg = input.grossKg !== null && Number.isFinite(input.grossKg) && input.grossKg > 0 ? input.grossKg : computedGrossKg;
  const massSource = grossKg === input.grossKg ? "typed" : "computed";

  if (input.source === "manual") {
    if (input.costEur === null || !Number.isFinite(input.costEur) || input.costEur < 0) {
      return { line: null, flags: [missing(country, grossKg)] };
    }
    return {
      line: line(
        input.costEur,
        grossKg,
        "shipping/manual",
        { countryCode: country, costEur: input.costEur, carrier: input.carrier, source: "manual", placeholder: false },
        { countryCode: country, grossKg, massSource, carrier: input.carrier, source: "manual", extraLeadDays: input.extraLeadDays, maxKg: null }
      ),
      flags: [],
    };
  }

  if (!country) return { line: null, flags: [missing(null, grossKg)] };
  const band = pickShippingBand(rates, country, grossKg);
  if (!band) return { line: null, flags: [missing(country, grossKg)] };
  const carrier = input.carrier ?? band.carrier;
  return {
    line: line(
      band.priceEur,
      grossKg,
      `shipping_rates/${country}/${band.maxKg}`,
      { countryCode: country, maxKg: band.maxKg, priceEur: band.priceEur, carrier: band.carrier, source: "table", placeholder },
      { countryCode: country, grossKg, massSource, carrier, source: "table", extraLeadDays: input.extraLeadDays, maxKg: band.maxKg }
    ),
    flags: [],
  };
}
