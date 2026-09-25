/**
 * Customer country codes — ISO 3166-1 alpha-2 validation + localized names.
 * File path: /lib/customers/countries.ts
 *
 * The product rule is "Poland → PLN, every other country → EUR", so a
 * customer may come from ANY country: the DB column is a plain char(2)
 * and validation accepts every ISO 3166-1 alpha-2 code (plus XK, the
 * user-assigned code the EU and most carriers use for Kosovo). A curated
 * subset with hand-written PL/EN names lives in content.quote.customers
 * .countries and is shown at the top of the country select; every other
 * code is labelled through Intl.DisplayNames (browser + Node), falling
 * back to the bare code. Pure module: no Next, no Supabase — usable from
 * server components, client components and unit tests alike.
 */

import type { Locale } from "@/lib/site-config";

/** ISO 3166-1 alpha-2 (249 officially assigned codes) + XK (Kosovo). */
export const ALL_COUNTRY_CODES: readonly string[] = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW",
  "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT",
  "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS",
  "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW",
  "XK",
];

const COUNTRY_SET: ReadonlySet<string> = new Set(ALL_COUNTRY_CODES);

/** Trim + upper-case; "" for null/undefined. */
export function normalizeCountryCode(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/** True for an already-normalized ISO 3166-1 alpha-2 code (or XK). */
export function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value) && COUNTRY_SET.has(value);
}

const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

function displayNames(locale: Locale): Intl.DisplayNames | null {
  const cached = displayNamesCache.get(locale);
  if (cached !== undefined) return cached;
  let instance: Intl.DisplayNames | null = null;
  try {
    if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
      instance = new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
    }
  } catch {
    instance = null;
  }
  displayNamesCache.set(locale, instance);
  return instance;
}

/**
 * Localized country name: `overrides[code]` (the content dictionary) →
 * Intl.DisplayNames → the code itself. Never throws; "" for an empty code.
 */
export function countryName(
  code: string | null | undefined,
  locale: Locale,
  overrides?: Readonly<Record<string, string>>
): string {
  const normalized = normalizeCountryCode(code);
  if (!normalized) return "";
  const override = overrides?.[normalized];
  if (override) return override;
  try {
    return displayNames(locale)?.of(normalized) ?? normalized;
  } catch {
    // RangeError for a malformed code (e.g. "1A") — show what we have.
    return normalized;
  }
}

/** Codes sorted by their localized name (collation of `locale`). */
export function sortCountryCodesByName(
  codes: readonly string[],
  locale: Locale,
  overrides?: Readonly<Record<string, string>>
): string[] {
  const collator = new Intl.Collator(locale);
  return [...codes]
    .map((code) => ({ code, name: countryName(code, locale, overrides) }))
    .sort((a, b) => collator.compare(a.name, b.name) || a.code.localeCompare(b.code))
    .map((entry) => entry.code);
}
