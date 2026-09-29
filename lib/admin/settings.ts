/**
 * Assembly-mode settings reads for the admin pages: the company row, VAT
 * rates, packaging, shipping bands, job setups, the assembly labour row
 * and weld speeds, plus the per-table overview (row and placeholder
 * counts) for the settings index and the admin dashboard card.
 * File path: /lib/admin/settings.ts
 *
 * Server only; takes the caller's client (RLS server client as the admin,
 * or the service-role client from an action). Every read is tolerant of
 * the table not existing yet — the deployed database may predate the
 * assembly-mode migration — and returns `missing: true` with empty data
 * so the page can say "run the migration" instead of crashing (the same
 * PGRST205 / 42P01 codes lib/rates/load.ts treats as "not migrated").
 * Numeric columns are normalised with Number(): PostgREST may serialise
 * `numeric` as a string. Placeholder detection for company_settings
 * (which has no `placeholder` column) is the marker rule of the design
 * doc §5 (companySettingsPlaceholderFields).
 */

import type {
  AssemblyRatesRow,
  CompanySettingsRow,
  JobSetupRateRow,
  PackagingRateRow,
  ShippingRateRow,
  VatRateRow,
  WeldSpeedRow,
} from "@/lib/db/types";
import type { AdminClient } from "@/lib/admin/rates";
import {
  companySettingsPlaceholderFields,
  SETTINGS_DB_TABLES,
  SETTINGS_TABLES,
  type SettingsTable,
} from "@/lib/admin/settings-types";

export type { SettingsTable } from "@/lib/admin/settings-types";

const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

type DbError = { message: string; code?: string } | null;

/** True for "relation does not exist" / PostgREST "table not in schema cache". */
export function isMissingTableError(error: { code?: string | null; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true;
  return typeof error.message === "string" && /does not exist|schema cache/i.test(error.message);
}

export type SettingsRows<T> = { rows: T[]; missing: boolean };
export type SettingsRow<T> = { row: T | null; missing: boolean };

async function rowsOf<T>(query: PromiseLike<{ data: unknown; error: DbError }>, table: string): Promise<SettingsRows<T>> {
  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return { rows: [], missing: true };
    throw new Error(`${table}: ${error.message}`);
  }
  return { rows: ((data ?? []) as T[]), missing: false };
}

function n(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/* ─── Company settings (single row id = 1) ───────────────── */

export async function getCompanySettings(supabase: AdminClient): Promise<SettingsRow<CompanySettingsRow>> {
  const { rows, missing } = await rowsOf<CompanySettingsRow>(
    supabase.from("company_settings").select("*").eq("id", 1).limit(1),
    "company_settings"
  );
  const row = rows[0];
  return {
    row: row
      ? { ...row, assembly_margin_pct: n(row.assembly_margin_pct), subcontract_margin_pct: n(row.subcontract_margin_pct), oss_active: Boolean(row.oss_active) }
      : null,
    missing,
  };
}

/* ─── VAT rates ──────────────────────────────────────────── */

export async function listVatRates(supabase: AdminClient): Promise<SettingsRows<VatRateRow>> {
  const result = await rowsOf<VatRateRow>(supabase.from("vat_rates").select("*").order("country"), "vat_rates");
  return { ...result, rows: result.rows.map((r) => ({ ...r, country: String(r.country).toUpperCase(), rate_pct: n(r.rate_pct) })) };
}

/* ─── Packaging rates ────────────────────────────────────── */

export async function listPackagingRates(supabase: AdminClient): Promise<SettingsRows<PackagingRateRow>> {
  const result = await rowsOf<PackagingRateRow>(
    supabase.from("packaging_rates").select("*").order("position").order("max_mass_kg"),
    "packaging_rates"
  );
  return {
    ...result,
    rows: result.rows.map((r) => ({
      ...r,
      max_side_mm: n(r.max_side_mm),
      max_mass_kg: n(r.max_mass_kg),
      price_eur: n(r.price_eur),
      position: n(r.position),
      placeholder: Boolean(r.placeholder),
    })),
  };
}

/* ─── Shipping rates ─────────────────────────────────────── */

export async function listShippingRates(supabase: AdminClient): Promise<SettingsRows<ShippingRateRow>> {
  const result = await rowsOf<ShippingRateRow>(
    supabase.from("shipping_rates").select("*").order("country").order("max_kg"),
    "shipping_rates"
  );
  return {
    ...result,
    rows: result.rows.map((r) => ({
      ...r,
      country: String(r.country).toUpperCase(),
      max_kg: n(r.max_kg),
      price_eur: n(r.price_eur),
      position: n(r.position),
      placeholder: Boolean(r.placeholder),
    })),
  };
}

/* ─── Job setup rates ────────────────────────────────────── */

export async function listJobSetupRates(supabase: AdminClient): Promise<SettingsRows<JobSetupRateRow>> {
  const result = await rowsOf<JobSetupRateRow>(supabase.from("job_setup_rates").select("*").order("code"), "job_setup_rates");
  return { ...result, rows: result.rows.map((r) => ({ ...r, cost_eur: n(r.cost_eur), placeholder: Boolean(r.placeholder) })) };
}

/* ─── Assembly rates (single row id = 1) ─────────────────── */

export async function getAssemblyRates(supabase: AdminClient): Promise<SettingsRow<AssemblyRatesRow>> {
  const { rows, missing } = await rowsOf<AssemblyRatesRow>(
    supabase.from("assembly_rates").select("*").eq("id", 1).limit(1),
    "assembly_rates"
  );
  const row = rows[0];
  return {
    row: row
      ? {
          ...row,
          labour_rate_eur_h: n(row.labour_rate_eur_h),
          gas_wire_eur_h: n(row.gas_wire_eur_h),
          tack_seconds: n(row.tack_seconds),
          fitup_min_per_part: n(row.fitup_min_per_part),
          deburr_min_per_part: n(row.deburr_min_per_part),
          handling_min_per_assembly: n(row.handling_min_per_assembly),
          distortion_factor: n(row.distortion_factor),
          step_bend_seconds_per_hit: n(row.step_bend_seconds_per_hit),
          roll_min_per_m: n(row.roll_min_per_m),
          placeholder: Boolean(row.placeholder),
        }
      : null,
    missing,
  };
}

/* ─── Weld speeds ────────────────────────────────────────── */

export async function listWeldSpeeds(supabase: AdminClient): Promise<SettingsRows<WeldSpeedRow>> {
  const result = await rowsOf<WeldSpeedRow>(
    supabase.from("weld_speeds").select("*").order("process").order("thickness_mm"),
    "weld_speeds"
  );
  return {
    ...result,
    rows: result.rows.map((r) => ({ ...r, thickness_mm: n(r.thickness_mm), speed_mm_min: n(r.speed_mm_min), placeholder: Boolean(r.placeholder) })),
  };
}

/* ─── Overview (index page + dashboard card) ─────────────── */

export type SettingsTableSummary = {
  table: SettingsTable;
  dbTable: string;
  /** null = the table does not exist (migration not applied). */
  rowCount: number | null;
  /** Rows still marked placeholder (company: fields carrying a marker). */
  placeholderCount: number;
  singleRow: boolean;
};

export type SettingsOverview = {
  tables: SettingsTableSummary[];
  /** True when at least one settings table is missing. */
  missing: boolean;
  /** Placeholder rows over every table that exists. */
  placeholderCount: number;
};

export async function loadSettingsOverview(supabase: AdminClient): Promise<SettingsOverview> {
  const [company, vat, packaging, shipping, setups, assembly, weldSpeeds] = await Promise.all([
    getCompanySettings(supabase),
    listVatRates(supabase),
    listPackagingRates(supabase),
    listShippingRates(supabase),
    listJobSetupRates(supabase),
    getAssemblyRates(supabase),
    listWeldSpeeds(supabase),
  ]);

  const countPlaceholders = (rows: { placeholder: boolean }[]) => rows.filter((r) => r.placeholder).length;

  const byTable: Record<SettingsTable, Omit<SettingsTableSummary, "table" | "dbTable">> = {
    company: {
      rowCount: company.missing ? null : company.row ? 1 : 0,
      placeholderCount: company.row ? companySettingsPlaceholderFields(company.row).length : 0,
      singleRow: true,
    },
    vat: { rowCount: vat.missing ? null : vat.rows.length, placeholderCount: 0, singleRow: false },
    packaging: { rowCount: packaging.missing ? null : packaging.rows.length, placeholderCount: countPlaceholders(packaging.rows), singleRow: false },
    shipping: { rowCount: shipping.missing ? null : shipping.rows.length, placeholderCount: countPlaceholders(shipping.rows), singleRow: false },
    setups: { rowCount: setups.missing ? null : setups.rows.length, placeholderCount: countPlaceholders(setups.rows), singleRow: false },
    assembly: {
      rowCount: assembly.missing ? null : assembly.row ? 1 : 0,
      placeholderCount: assembly.row?.placeholder ? 1 : 0,
      singleRow: true,
    },
    weldSpeeds: { rowCount: weldSpeeds.missing ? null : weldSpeeds.rows.length, placeholderCount: countPlaceholders(weldSpeeds.rows), singleRow: false },
  };

  const tables = SETTINGS_TABLES.map((table) => ({ table, dbTable: SETTINGS_DB_TABLES[table], ...byTable[table] }));
  return {
    tables,
    missing: tables.some((t) => t.rowCount === null),
    placeholderCount: tables.reduce((sum, t) => sum + t.placeholderCount, 0),
  };
}
