/**
 * Company profile for the quote PDF and the export guard — the
 * `company_settings` row (admin-edited, docs/assembly-mode-design.md §2)
 * merged over the static defaults of lib/site-config.ts, plus the
 * placeholder check both the PDF footer note and the `company_placeholders`
 * export reason use.
 * File path: /lib/pdf/company.ts
 *
 * Pure (types + site-config only): imported by lib/pdf/view-model.ts on the
 * server AND by lib/quotes/send-guard.ts, which the quote builder (a client
 * component) also runs, so nothing here may touch react-pdf, Next or
 * Supabase.
 *
 * Merge rule: a company_settings column wins when it is set (non-blank
 * after trimming); the migration seeds most text columns with '' so a blank
 * means "not entered yet" and the site-config value stands in. `country`
 * falls back to PL. A missing row (table empty or not migrated) is the
 * plain site-config profile — exactly what the PDF printed before.
 *
 * Placeholders: any profile field containing one of
 * COMPANY_PLACEHOLDER_MARKERS ("000-000", "PL00", "XXXX", "[CONFIRM]") is
 * unconfirmed company data — the PDF prints the red footer note and the
 * export guard refuses the document (design §5).
 */

import type { CompanySettingsRow } from "@/lib/db/types";
import { siteConfig, type Locale } from "@/lib/site-config";

export type CompanyProfile = {
  brand: string;
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  /** ISO-2. */
  country: string;
  phone: string;
  email: string;
  /** With or without the scheme, as stored; `companyWebLabel` strips it for print. */
  website: string;
  nip: string;
  regon: string;
  krs: string;
  bankName: string;
  ibanPln: string;
  ibanEur: string;
  swift: string;
};

export const COMPANY_PLACEHOLDER_MARKERS: readonly string[] = ["000-000", "PL00", "XXXX", "[CONFIRM]"];

/** The site-config values the profile falls back to. */
export function defaultCompanyProfile(): CompanyProfile {
  return {
    brand: siteConfig.displayName,
    legalName: siteConfig.legalName,
    street: siteConfig.contact.address.street,
    postalCode: siteConfig.contact.address.postalCode,
    city: siteConfig.contact.address.city,
    country: siteConfig.contact.address.country,
    phone: siteConfig.contact.phoneDisplay,
    email: siteConfig.contact.email,
    website: siteConfig.websiteUrl,
    nip: siteConfig.legal.nip,
    regon: siteConfig.legal.regon,
    krs: siteConfig.legal.krs,
    bankName: siteConfig.legal.bankName,
    ibanPln: siteConfig.legal.ibanPln,
    ibanEur: siteConfig.legal.ibanEur,
    swift: siteConfig.legal.swift,
  };
}

function pick(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}

/** company_settings merged over the site-config defaults (see the header). */
export function resolveCompanyProfile(company: CompanySettingsRow | null | undefined): CompanyProfile {
  const base = defaultCompanyProfile();
  if (!company) return base;
  return {
    brand: pick(company.brand, base.brand),
    legalName: pick(company.legal_name, base.legalName),
    street: pick(company.street, base.street),
    postalCode: pick(company.postal_code, base.postalCode),
    city: pick(company.city, base.city),
    country: pick(company.country, base.country).toUpperCase(),
    phone: pick(company.phone, base.phone),
    email: pick(company.email, base.email),
    website: pick(company.website, base.website),
    nip: pick(company.nip, base.nip),
    regon: pick(company.regon, base.regon),
    krs: pick(company.krs, base.krs),
    bankName: pick(company.bank_name, base.bankName),
    ibanPln: pick(company.iban_pln, base.ibanPln),
    ibanEur: pick(company.iban_eur, base.ibanEur),
    swift: pick(company.swift, base.swift),
  };
}

/** Profile fields that still carry a placeholder marker (empty = confirmed data). */
export function companyPlaceholderFields(profile: CompanyProfile): (keyof CompanyProfile)[] {
  const out: (keyof CompanyProfile)[] = [];
  for (const key of Object.keys(profile) as (keyof CompanyProfile)[]) {
    const value = profile[key];
    if (COMPANY_PLACEHOLDER_MARKERS.some((marker) => value.includes(marker))) out.push(key);
  }
  return out;
}

export function hasCompanyPlaceholders(profile: CompanyProfile): boolean {
  return companyPlaceholderFields(profile).length > 0;
}

/** Street, "postal city", country name — the lines printed in the header and footer. */
export function companyAddressLines(profile: CompanyProfile, locale: Locale): string[] {
  const country = profile.country === "PL" ? (locale === "pl" ? "Polska" : "Poland") : profile.country;
  return [profile.street, `${profile.postalCode} ${profile.city}`.trim(), country].filter((line) => line.length > 0);
}

/** Website without the scheme ("stretchmetal.pl"). */
export function companyWebLabel(profile: CompanyProfile): string {
  return profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
