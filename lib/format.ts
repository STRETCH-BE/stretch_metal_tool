/**
 * Pure, environment-free formatting + locale helpers.
 * File path: /lib/format.ts
 *
 * Safe to import from client components, the pricing preview, the PDF
 * template and tests: nothing here touches next/headers or the database.
 * lib/i18n.ts re-exports everything below and adds the server-only locale
 * resolution (getLocale / getPublicLocale).
 *
 * Formatting: Polish uses a non-breaking space as thousands separator and
 * a comma decimal ("1 234,56"); English "1,234.56". Money is rounded to
 * 0.01 here, at the display boundary only — engines never round.
 */

import { siteConfig, type Locale } from "@/lib/site-config";

export type { Locale };
export const LOCALES: readonly Locale[] = siteConfig.locales;
export const LOCALE_COOKIE = "locale";

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/** Pure resolver: profile → cookie → Accept-Language → default. */
export function resolveLocale(input: {
  profileLocale?: string | null;
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(input.profileLocale)) return input.profileLocale;
  if (isLocale(input.cookieLocale)) return input.cookieLocale;
  const header = input.acceptLanguage?.toLowerCase() ?? "";
  for (const part of header.split(",")) {
    const tag = part.trim().split(";")[0];
    if (tag.startsWith("pl")) return "pl";
    if (tag.startsWith("en")) return "en";
  }
  return siteConfig.defaultLocale;
}

const INTL_TAG: Record<Locale, string> = { pl: "pl-PL", en: "en-GB" };

export function intlTag(locale: Locale): string {
  return INTL_TAG[locale];
}

export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {}
): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(INTL_TAG[locale], {
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

/** Length in mm with 1 decimal (2 224,5). */
export function formatMm(value: number, locale: Locale, digits = 1): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatKg(value: number, locale: Locale, digits = 3): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPercent(
  value: number,
  locale: Locale,
  digits = 1
): string {
  return `${formatNumber(value, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
}

/** Money already converted to `currency`; rounds to 0.01 for display. */
export function formatMoney(
  value: number,
  currency: "PLN" | "EUR",
  locale: Locale
): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(INTL_TAG[locale], {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.round(value * 100) / 100);
}

/** EUR amount → quote currency using the quote's stored fx rate. */
export function toQuoteCurrency(
  eur: number,
  currency: "PLN" | "EUR",
  fxRate: number
): number {
  return currency === "EUR" ? eur : eur * fxRate;
}

export function formatDate(
  value: string | Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...options,
  }).format(date);
}

export function formatDateTime(value: string | Date, locale: Locale): string {
  return formatDate(value, locale, { hour: "2-digit", minute: "2-digit" });
}

/** "{count} lines" style interpolation for content templates. */
export function interpolate(
  template: string,
  params: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`
  );
}
