/**
 * Assembly-mode settings — the shared, pure contract of the admin settings
 * pages: the seven tables, their URL slugs, the error codes, the action
 * result / form state shapes and the enum option lists.
 * File path: /lib/admin/settings-types.ts
 *
 * Pure (no Next, no Supabase): imported by content/admin.ts (labels keyed
 * by table), the client forms, the server reads and the server actions.
 * Table keys are camelCase identifiers (content keys), slugs are the
 * kebab-case URL segments (`weld-speeds`), mapped one-to-one here so the
 * route map (lib/routes.ts adminSettingsTable) never sees a content key.
 * Design: docs/assembly-mode-design.md §2 "Admin settings tables", §5.
 */

import type { JobSetupCodeDb, WeldProcessDb } from "@/lib/db/types";

export const SETTINGS_TABLES = ["company", "vat", "packaging", "shipping", "setups", "assembly", "weldSpeeds"] as const;

export type SettingsTable = (typeof SETTINGS_TABLES)[number];

/** URL segment of every settings page (routes.adminSettingsTable(slug)). */
export const SETTINGS_TABLE_SLUGS: Record<SettingsTable, string> = {
  company: "company",
  vat: "vat",
  packaging: "packaging",
  shipping: "shipping",
  setups: "setups",
  assembly: "assembly",
  weldSpeeds: "weld-speeds",
};

/** Database table behind every settings page (audit `entity`, missing-table notices). */
export const SETTINGS_DB_TABLES: Record<SettingsTable, string> = {
  company: "company_settings",
  vat: "vat_rates",
  packaging: "packaging_rates",
  shipping: "shipping_rates",
  setups: "job_setup_rates",
  assembly: "assembly_rates",
  weldSpeeds: "weld_speeds",
};

export function isSettingsTable(value: unknown): value is SettingsTable {
  return typeof value === "string" && (SETTINGS_TABLES as readonly string[]).includes(value);
}

/** Settings table for a URL slug, null for an unknown one (→ notFound). */
export function settingsTableFromSlug(slug: string): SettingsTable | null {
  const found = SETTINGS_TABLES.find((table) => SETTINGS_TABLE_SLUGS[table] === slug);
  return found ?? null;
}

export const JOB_SETUP_CODES: readonly JobSetupCodeDb[] = ["laser_nest", "press_brake", "roll", "weld_fitup"];
export const WELD_SPEED_PROCESSES: readonly WeldProcessDb[] = ["mig_mag", "tig", "laser", "mma"];

export function isJobSetupCode(value: unknown): value is JobSetupCodeDb {
  return typeof value === "string" && (JOB_SETUP_CODES as readonly string[]).includes(value);
}

/**
 * Error codes of the settings actions — keys of content.admin.settings.errors.
 *   forbidden    · not an admin session
 *   validation   · zod refused the input (`field` names the first column)
 *   duplicate    · unique key hit (shipping country+max_kg, weld process+thickness)
 *   notFound     · delete / update of a row that no longer exists
 *   missingTable · the assembly-mode migration is not applied (42P01 / PGRST205)
 *   db           · any other database error (`message` carries the text)
 */
export type SettingsErrorCode = "forbidden" | "validation" | "duplicate" | "notFound" | "missingTable" | "db";

export type SettingsActionResult =
  | { ok: true }
  | { ok: false; error: SettingsErrorCode; field?: string; message?: string };

/** Upper bound (inclusive) of the company margins — the product rule "margins 0–90". */
export const SETTINGS_MARGIN_MAX_PCT = 90;

/** Markers that mark a company_settings value as still unconfirmed (design doc §5 `company_placeholders`). */
export const COMPANY_SETTINGS_PLACEHOLDER_MARKERS: readonly string[] = ["000-000", "PL00", "XXXX", "[CONFIRM]"];

/** The editable text columns of company_settings, in form order. */
export const COMPANY_TEXT_FIELDS = [
  "brand",
  "legal_name",
  "street",
  "postal_code",
  "city",
  "country",
  "phone",
  "email",
  "website",
  "nip",
  "regon",
  "krs",
  "bank_name",
  "iban_pln",
  "iban_eur",
  "swift",
] as const;

export type CompanyTextField = (typeof COMPANY_TEXT_FIELDS)[number];

/** The editable numeric columns of assembly_rates, in form order. */
export const ASSEMBLY_RATE_FIELDS = [
  "labour_rate_eur_h",
  "gas_wire_eur_h",
  "tack_seconds",
  "fitup_min_per_part",
  "deburr_min_per_part",
  "handling_min_per_assembly",
  "distortion_factor",
  "step_bend_seconds_per_hit",
  "roll_min_per_m",
] as const;

export type AssemblyRateField = (typeof ASSEMBLY_RATE_FIELDS)[number];

/* ─── Action inputs (lib/admin/settings-actions.ts) ─────────
 * Numbers may be the user's text ("1,5") or a number; the actions parse
 * and validate them. Optional ids select "update this row" over the
 * natural-key upsert. */

export type CompanySettingsInput = Record<CompanyTextField, string> & {
  oss_active: boolean | string;
  assembly_margin_pct: number | string;
  subcontract_margin_pct: number | string;
};

export type VatRateInput = { country: string; rate_pct: number | string };

export type PackagingRateInput = {
  code: string;
  name: string;
  max_side_mm: number | string;
  max_mass_kg: number | string;
  price_eur: number | string;
  position?: number | string | null;
};

export type ShippingRateInput = {
  id?: string | null;
  country: string;
  max_kg: number | string;
  price_eur: number | string;
  carrier?: string | null;
  position?: number | string | null;
};

export type JobSetupRateInput = { code: string; cost_eur: number | string; name?: string | null };

export type AssemblyRatesInput = Record<AssemblyRateField, number | string>;

export type WeldSpeedInput = { id?: string | null; process: string; thickness_mm: number | string; speed_mm_min: number | string };

/** Company settings fields whose value still carries a placeholder marker. */
export function companySettingsPlaceholderFields(row: Partial<Record<CompanyTextField, string | null>>): CompanyTextField[] {
  return COMPANY_TEXT_FIELDS.filter((field) => {
    const value = row[field];
    return typeof value === "string" && COMPANY_SETTINGS_PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
  });
}
