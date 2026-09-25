/**
 * Default quote currency by customer country — the one business rule the
 * customers module owns (product decision, Step 2): Poland → PLN, every
 * other country → EUR. Changeable per quote; the quote stores its own
 * currency and fx rate, so this is only the starting value.
 * File path: /lib/customers/currency.ts
 */

import type { CurrencyCode } from "@/lib/db/types";

export const HOME_COUNTRY = "PL";

/** "PLN" for Poland, "EUR" otherwise. Case-insensitive, tolerant of whitespace. */
export function defaultCurrencyForCountry(
  country: string | null | undefined
): CurrencyCode {
  const code = (country ?? "").trim().toUpperCase();
  return code === HOME_COUNTRY ? "PLN" : "EUR";
}
