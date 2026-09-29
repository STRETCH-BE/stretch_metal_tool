/**
 * Site-wide configuration — single source of truth.
 * File path: /lib/site-config.ts
 *
 * Import from here, never hardcode brand or company data in components,
 * PDF templates or emails. Mirrors the stretch_metal website file; the
 * quoting tool adds the legal/bank block printed in the quote PDF footer.
 *
 * Every value marked [CONFIRM] is a placeholder awaiting confirmation by
 * the owner — grep for "[CONFIRM]" to find them all in one pass:
 *   grep -rn "\[CONFIRM\]" lib content supabase env.example
 */

export const siteConfig = {
  name: "StretchMetal",
  /** Wordmark as rendered in the logo lockup. */
  displayName: "STRETCHMETAL",
  /** Application name shown in the tab strip and PDF metadata. */
  appName: "StretchMetal Quote",
  /** The legal entity behind the brand ("Stretchmetal by Alto Design Sp. z o.o."). */
  legalName: "Alto Design Sp. z o.o.",
  parent: "Stretchgroup",
  tagline: "Stal. Cięta. Spawana. Malowana.",
  taglineEn: "Steel. Cut. Welded. Coated.",

  // [CONFIRM] app domain — read from env, this fallback assumed
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://quote.stretchmetal.pl",
  /** Public marketing site — linked from the export guide and PDF footer. */
  websiteUrl: "https://stretchmetal.pl", // [CONFIRM] domain

  locales: ["pl", "en"] as const,
  defaultLocale: "pl" as const,

  contact: {
    // Belgian contact number (as on the website)
    phone: "+32485483035",
    phoneDisplay: "+32 485 48 30 35",
    email: "info@stretchmetal.pl",
    address: {
      street: "ul. Legionów 59",
      city: "Częstochowa",
      postalCode: "42-200",
      region: "Śląskie",
      country: "PL",
    },
    // [CONFIRM] opening hours
    hours: "Mo-Fr 08:00-16:00",
  },

  /**
   * Company registration + bank data printed in the quote PDF footer, as
   * given by the owner on 29 Sep 2026. One bank account was given: it is
   * printed for PLN and EUR quotes alike until a separate EUR account exists.
   */
  legal: {
    /** EU VAT number (NIP 573-291-17-03). */
    nip: "PL5732911703",
    regon: "383390837",
    krs: "0000786996",
    bankName: "ING Bank Śląski",
    ibanPln: "PL05 1050 1142 1000 0090 3188 9240",
    ibanEur: "PL05 1050 1142 1000 0090 3188 9240",
    swift: "INGBPLPW",
  },

  /** Quote defaults that are policy (not rates) — rates live in the DB. */
  quoteDefaults: {
    validityDays: 30,
    numberPrefix: "SM",
    /** EUR→PLN fallback when the env var is missing (see env.example). */
    fxEurPlnFallback: 4.3, // [CONFIRM] exchange rate default
  },

  /** Sister brands inside the Stretchgroup. */
  group: {
    belgium: { name: "STRETCH", url: "https://stretchplafond.be" }, // [CONFIRM] .be domain
    poland: { name: "Stretch Sufit", url: "https://altodesign.pl" },
  },
} as const;

export type Locale = (typeof siteConfig.locales)[number];

/** Default EUR→PLN rate: env first, then the site-config fallback. */
export function defaultFxEurPln(): number {
  const raw = process.env.EXCHANGE_RATE_EUR_PLN_DEFAULT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : siteConfig.quoteDefaults.fxEurPlnFallback;
}
