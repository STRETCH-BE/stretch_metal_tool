/**
 * Assembly-mode settings reads with the fake Supabase: a table the database
 * lacks (42P01 / PGRST205) reads as `missing: true` with empty data instead
 * of throwing, numeric strings from PostgREST are normalised to numbers,
 * any other error still throws, and the overview counts rows and
 * placeholders per table (company: fields with a placeholder marker).
 * File path: /test/admin/settings-queries.test.ts
 */
import { describe, expect, it } from "vitest";
import { fakeClient } from "./fake-supabase";
import type { AdminClient } from "@/lib/admin/rates";
import {
  getAssemblyRates,
  getCompanySettings,
  isMissingTableError,
  listJobSetupRates,
  listPackagingRates,
  listShippingRates,
  listVatRates,
  listWeldSpeeds,
  loadSettingsOverview,
} from "@/lib/admin/settings";

const MISSING = { message: 'relation "public.x" does not exist', code: "42P01" };
const NOT_IN_CACHE = { message: "Could not find the table 'public.weld_speeds' in the schema cache", code: "PGRST205" };

function client(tables: Parameters<typeof fakeClient>[0]): AdminClient {
  return fakeClient(tables) as unknown as AdminClient;
}

describe("isMissingTableError", () => {
  it("recognises both Postgres and PostgREST codes and the message forms", () => {
    expect(isMissingTableError(MISSING)).toBe(true);
    expect(isMissingTableError(NOT_IN_CACHE)).toBe(true);
    expect(isMissingTableError({ message: "relation does not exist" })).toBe(true);
    expect(isMissingTableError({ message: "permission denied", code: "42501" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe("settings reads", () => {
  it("return missing: true and empty data when the table does not exist", async () => {
    const supabase = client({
      company_settings: { list: { data: null, error: MISSING } },
      vat_rates: { list: { data: null, error: MISSING } },
      packaging_rates: { list: { data: null, error: NOT_IN_CACHE } },
      shipping_rates: { list: { data: null, error: MISSING } },
      job_setup_rates: { list: { data: null, error: MISSING } },
      assembly_rates: { list: { data: null, error: MISSING } },
      weld_speeds: { list: { data: null, error: NOT_IN_CACHE } },
    });
    expect(await getCompanySettings(supabase)).toEqual({ row: null, missing: true });
    expect(await listVatRates(supabase)).toEqual({ rows: [], missing: true });
    expect(await listPackagingRates(supabase)).toEqual({ rows: [], missing: true });
    expect(await listShippingRates(supabase)).toEqual({ rows: [], missing: true });
    expect(await listJobSetupRates(supabase)).toEqual({ rows: [], missing: true });
    expect(await getAssemblyRates(supabase)).toEqual({ row: null, missing: true });
    expect(await listWeldSpeeds(supabase)).toEqual({ rows: [], missing: true });
  });

  it("throw on any other database error", async () => {
    const supabase = client({ vat_rates: { list: { data: null, error: { message: "permission denied", code: "42501" } } } });
    await expect(listVatRates(supabase)).rejects.toThrow(/vat_rates: permission denied/);
  });

  it("normalise numeric strings and upper-case country codes", async () => {
    const supabase = client({
      vat_rates: { list: { data: [{ country: "fi", rate_pct: "25.50", updated_by: null, updated_at: "2026-09-30" }] } },
      weld_speeds: { list: { data: [{ id: "w1", process: "mig_mag", thickness_mm: "2.000", speed_mm_min: "120.00", placeholder: true }] } },
      assembly_rates: { list: { data: [{ id: 1, labour_rate_eur_h: "25.0000", gas_wire_eur_h: "8", tack_seconds: "60", fitup_min_per_part: "6", deburr_min_per_part: "1.50", handling_min_per_assembly: "10", distortion_factor: "1.300", step_bend_seconds_per_hit: "25", roll_min_per_m: "6", placeholder: true }] } },
      company_settings: { list: { data: [{ id: 1, brand: "STRETCHMETAL", legal_name: "Alto", country: "PL", oss_active: false, assembly_margin_pct: "30.00", subcontract_margin_pct: "15.00" }] } },
    });
    const vat = await listVatRates(supabase);
    expect(vat.missing).toBe(false);
    expect(vat.rows[0]).toMatchObject({ country: "FI", rate_pct: 25.5 });
    const speeds = await listWeldSpeeds(supabase);
    expect(speeds.rows[0]).toMatchObject({ thickness_mm: 2, speed_mm_min: 120, placeholder: true });
    const assembly = await getAssemblyRates(supabase);
    expect(assembly.row).toMatchObject({ labour_rate_eur_h: 25, deburr_min_per_part: 1.5, distortion_factor: 1.3, placeholder: true });
    const company = await getCompanySettings(supabase);
    expect(company.row).toMatchObject({ assembly_margin_pct: 30, subcontract_margin_pct: 15, oss_active: false });
  });
});

describe("loadSettingsOverview", () => {
  it("counts rows and placeholders per table and flags missing tables", async () => {
    const supabase = client({
      company_settings: { list: { data: [{ id: 1, brand: "STRETCHMETAL", legal_name: "Alto Design", nip: "PL00 [CONFIRM]", iban_pln: "PL00 XXXX", country: "PL", assembly_margin_pct: 30, subcontract_margin_pct: 15, oss_active: false }] } },
      vat_rates: { list: { data: [{ country: "PL", rate_pct: 23 }, { country: "FI", rate_pct: 25.5 }] } },
      packaging_rates: { list: { data: [{ code: "carton", placeholder: true, max_side_mm: 400, max_mass_kg: 5, price_eur: 2.75, position: 1 }, { code: "pallet", placeholder: false, max_side_mm: 3000, max_mass_kg: 1000, price_eur: 36.78, position: 4 }] } },
      shipping_rates: { list: { data: null, error: MISSING } },
      job_setup_rates: { list: { data: [{ code: "laser_nest", cost_eur: 17.5, placeholder: false }] } },
      assembly_rates: { list: { data: [{ id: 1, labour_rate_eur_h: 25, gas_wire_eur_h: 8, tack_seconds: 60, fitup_min_per_part: 6, deburr_min_per_part: 1.5, handling_min_per_assembly: 10, distortion_factor: 1.3, step_bend_seconds_per_hit: 25, roll_min_per_m: 6, placeholder: true }] } },
      weld_speeds: { list: { data: [] } },
    });
    const overview = await loadSettingsOverview(supabase);
    expect(overview.missing).toBe(true);
    // company: nip + iban_pln carry markers; packaging: carton; assembly: the row
    expect(overview.placeholderCount).toBe(4);
    const byTable = Object.fromEntries(overview.tables.map((t) => [t.table, t]));
    expect(byTable.company).toMatchObject({ dbTable: "company_settings", rowCount: 1, placeholderCount: 2, singleRow: true });
    expect(byTable.vat).toMatchObject({ rowCount: 2, placeholderCount: 0 });
    expect(byTable.packaging).toMatchObject({ rowCount: 2, placeholderCount: 1 });
    expect(byTable.shipping).toMatchObject({ dbTable: "shipping_rates", rowCount: null, placeholderCount: 0 });
    expect(byTable.setups).toMatchObject({ rowCount: 1, placeholderCount: 0 });
    expect(byTable.assembly).toMatchObject({ rowCount: 1, placeholderCount: 1, singleRow: true });
    expect(byTable.weldSpeeds).toMatchObject({ rowCount: 0, placeholderCount: 0 });
    expect(overview.tables.map((t) => t.table)).toEqual(["company", "vat", "packaging", "shipping", "setups", "assembly", "weldSpeeds"]);
  });
});
