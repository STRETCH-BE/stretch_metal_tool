/**
 * Pricing engine — VAT on the quote's net total (assembly mode,
 * docs/assembly-mode-design.md §3.4). Pure: the rates come from
 * JobRates.vatRates (admin table vat_rates), the OSS switch and the home
 * country from company_settings via JobRates.
 * File path: /lib/pricing/vat.ts
 *
 * The owner's rule (29 Sep 2026): the RATE follows the VAT number and the
 * country; the customer type only decides how the PDF presents it.
 *   - no customer at all (type, country and VAT id all unknown) → null
 *     (the export guard blocks the PDF);
 *   - no country (but a customer) → mode "none", 0 %;
 *   - country = home (PL), with or without a VAT id → "pl_domestic", the
 *     home row of vat_rates (23 %);
 *   - abroad WITH a VAT id → 0 %: "reverse_charge" inside the EU (WDT,
 *     art. 138 Directive 2006/112/EC), "export" outside it — the mode
 *     decides the note the PDF prints;
 *   - abroad WITHOUT a VAT id → "b2c_domestic" at the home rate (23 %),
 *     except a B2C customer in another EU country while OSS is active →
 *     "b2c_oss" at the destination's row; a destination the table does
 *     not list falls back to the home rate (b2c_domestic, no flag — the
 *     admin sees the missing row in the table, and 23 % is never too low
 *     against the seeded EU rows above it; noted in the notes file);
 *   - a B2B customer abroad without a VAT id also gets amber
 *     customer.vat_id_missing (overridable): the quote is right at 23 %,
 *     the flag says a VAT id would make it 0 %.
 * A VAT id counts when it is non-empty after trimming; country codes are
 * ISO-2, compared case-insensitively. EU membership is a fact, not a rate,
 * so the member list is a constant here. Amounts: vat = net × rate / 100,
 * gross = net + vat, unrounded EUR like every engine number.
 */

import type { CustomerType, Flag, JobRates, VatMode, VatResult } from "./types";

/** ISO-2 codes of the EU member states (Greece also as "EL", the VAT-id prefix). */
export const EU_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "EL", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export type VatInput = {
  customerType: CustomerType | null;
  /** ISO-2 of the customer's address. */
  customerCountry: string | null;
  customerVatId: string | null;
  /** Net total the VAT is computed on (EUR): items + assemblies + quote lines + shipping. */
  netTotalEur: number;
};

export type VatComputation = { vat: VatResult; flags: Flag[] };

/** Trimmed upper-case ISO-2, or null when empty. */
export function normaliseCountry(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase() ?? "";
  return c === "" ? null : c;
}

export function isEuCountry(code: string | null | undefined): boolean {
  const c = normaliseCountry(code);
  return c !== null && EU_COUNTRY_CODES.has(c);
}

/** A VAT id counts when it is non-empty after trimming. */
export function hasVatId(vatId: string | null | undefined): boolean {
  return (vatId?.trim() ?? "") !== "";
}

function rateFor(rates: Pick<JobRates, "vatRates">, country: string): number | null {
  const rate = rates.vatRates[country] ?? rates.vatRates[country.toLowerCase()];
  return typeof rate === "number" && Number.isFinite(rate) ? rate : null;
}

function result(mode: VatMode, ratePct: number, countryCode: string | null, netTotal: number): VatResult {
  const vatAmount = (netTotal * ratePct) / 100;
  return { mode, ratePct, countryCode, netTotal, vatAmount, grossTotal: netTotal + vatAmount };
}

/**
 * VAT for the quote per the rule in the header. Returns null only when no
 * customer is known at all (no type, no country, no VAT id).
 */
export function computeVat(
  input: VatInput,
  rates: Pick<JobRates, "vatRates" | "ossActive" | "homeCountry">
): VatComputation | null {
  const country = normaliseCountry(input.customerCountry);
  const vatId = hasVatId(input.customerVatId);
  if (input.customerType === null && country === null && !vatId) return null;

  const net = input.netTotalEur;
  const home = normaliseCountry(rates.homeCountry) ?? "PL";
  const homeRow = rateFor(rates, home);
  const homeRate = homeRow ?? 0;
  const flags: Flag[] = [];
  // The home rate is the fallback of every taxed mode; without its row the
  // quote would silently print 0 % — red, not overridable, until the admin
  // restores the row in vat_rates.
  const homeFlags: Flag[] =
    homeRow === null ? [{ code: "vat.no_rate", severity: "red", partId: null, itemId: null, params: { countryCode: home }, overridable: false }] : [];

  if (country === null) return { vat: result("none", 0, null, net), flags };
  if (country === home) return { vat: result("pl_domestic", homeRate, home, net), flags: [...flags, ...homeFlags] };

  const eu = EU_COUNTRY_CODES.has(country);
  if (vatId) return { vat: result(eu ? "reverse_charge" : "export", 0, null, net), flags };

  if (input.customerType === "b2c" && eu && rates.ossActive) {
    const destination = rateFor(rates, country);
    if (destination !== null) return { vat: result("b2c_oss", destination, country, net), flags };
    // Destination not in vat_rates: the home rate applies, amber until the row exists (design §3.4).
    flags.push({ code: "vat.no_rate", severity: "amber", partId: null, itemId: null, params: { countryCode: country, fallbackPct: homeRate }, overridable: true });
    return { vat: result("b2c_domestic", homeRate, home, net), flags: [...flags, ...homeFlags] };
  }

  if (input.customerType === "b2b") {
    flags.push({
      code: "customer.vat_id_missing",
      severity: "amber",
      partId: null,
      itemId: null,
      params: { countryCode: country, ratePct: homeRate },
      overridable: true,
    });
  }
  return { vat: result("b2c_domestic", homeRate, home, net), flags: [...flags, ...homeFlags] };
}
