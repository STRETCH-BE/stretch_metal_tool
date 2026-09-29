/**
 * Job rates — the admin-edited settings tables (company settings, VAT
 * rates, packaging, shipping, job setups, assembly labour, weld speeds)
 * mapped from their DB rows to the engine's JobRates contract.
 * File path: /lib/pricing/job-rates.ts
 *
 * Pure: no Next, no Supabase, no env (lib/rates/load.ts loadJobRates reads
 * the rows and calls rowsToJobRates). Numeric columns arrive as strings
 * from PostgREST, hence Loose<> + num(). A missing single-row table
 * (company_settings, assembly_rates) or an empty list falls back to
 * JOB_RATE_DEFAULTS — the seeded calibration placeholders of migration
 * 20260930100000_assembly_mode.sql — and marks the rates as placeholder,
 * so the quote carries the rates.placeholder flag until the admin
 * confirms them. Design: docs/assembly-mode-design.md §2.
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
import type { WeldProcess } from "@/lib/geometry/types";
import { num, type Loose } from "./snapshot";
import type { JobRates, JobSetupCode } from "./types";

export type JobRateRows = {
  company: Loose<CompanySettingsRow> | null;
  vat: Loose<VatRateRow>[];
  packaging: Loose<PackagingRateRow>[];
  shipping: Loose<ShippingRateRow>[];
  setups: Loose<JobSetupRateRow>[];
  assembly: Loose<AssemblyRatesRow> | null;
  weldSpeeds: Loose<WeldSpeedRow>[];
};

/** The seeded calibration placeholders (see the migration) — used when a table is empty. */
export const JOB_RATE_DEFAULTS: JobRates = {
  setups: { laser_nest: 17.5, press_brake: 23.33, roll: 23.33, weld_fitup: 12.5 },
  assembly: {
    labourRateEurH: 25,
    gasWireEurH: 8,
    tackSeconds: 60,
    fitupMinPerPart: 6,
    deburrMinPerPart: 1.5,
    handlingMinPerAssembly: 10,
    distortionFactor: 1.3,
    stepBendSecondsPerHit: 25,
    rollMinPerM: 6,
  },
  weldSpeeds: [
    { process: "mig_mag", thicknessMm: 1, speedMmMin: 150 },
    { process: "mig_mag", thicknessMm: 2, speedMmMin: 120 },
    { process: "mig_mag", thicknessMm: 3, speedMmMin: 100 },
    { process: "mig_mag", thicknessMm: 4, speedMmMin: 80 },
    { process: "mig_mag", thicknessMm: 6, speedMmMin: 60 },
    { process: "tig", thicknessMm: 1, speedMmMin: 60 },
    { process: "tig", thicknessMm: 2, speedMmMin: 50 },
    { process: "tig", thicknessMm: 3, speedMmMin: 40 },
    { process: "laser", thicknessMm: 1, speedMmMin: 400 },
    { process: "laser", thicknessMm: 2, speedMmMin: 300 },
    { process: "laser", thicknessMm: 3, speedMmMin: 250 },
    { process: "mma", thicknessMm: 3, speedMmMin: 60 },
    { process: "mma", thicknessMm: 6, speedMmMin: 45 },
  ],
  packaging: [
    { code: "carton", name: "Carton", maxSideMm: 400, maxMassKg: 5, priceEur: 2.75, position: 1 },
    { code: "carton_foam", name: "Carton with foam", maxSideMm: 600, maxMassKg: 15, priceEur: 6.5, position: 2 },
    { code: "crate", name: "Wooden crate", maxSideMm: 1200, maxMassKg: 60, priceEur: 24, position: 3 },
    { code: "pallet", name: "Pallet", maxSideMm: 3000, maxMassKg: 1000, priceEur: 36.78, position: 4 },
  ],
  shipping: [
    ...bands("PL", [9, 18, 45, 120]),
    ...bands("DE", [15, 35, 90, 260]),
    ...bands("AT", [15, 35, 90, 260]),
    ...bands("NL", [15, 35, 90, 260]),
    ...bands("BE", [15, 35, 90, 260]),
    ...bands("FR", [15, 35, 90, 260]),
    ...bands("FI", [20, 45, 120, 320]),
  ],
  vatRates: { PL: 23, FI: 25.5, BE: 21, NL: 21, DE: 19, AT: 20, FR: 20 },
  ossActive: false,
  assemblyMarginPct: 30,
  subcontractMarginPct: 15,
  homeCountry: "PL",
  placeholder: true,
};

function bands(country: string, prices: [number, number, number, number]): JobRates["shipping"] {
  const kgs = [5, 30, 100, 1000] as const;
  return kgs.map((maxKg, i) => ({ countryCode: country, maxKg, priceEur: prices[i], carrier: i < 2 ? "courier" : "pallet" }));
}

const SETUP_CODES: JobSetupCode[] = ["laser_nest", "press_brake", "roll", "weld_fitup"];
const WELD_PROCESSES: WeldProcess[] = ["mig_mag", "tig", "laser", "mma"];

function isSetupCode(value: unknown): value is JobSetupCode {
  return typeof value === "string" && (SETUP_CODES as string[]).includes(value);
}

function isWeldProcess(value: unknown): value is WeldProcess {
  return typeof value === "string" && (WELD_PROCESSES as string[]).includes(value);
}

function truthy(value: unknown): boolean {
  return value === true || value === "true";
}

/** DB rows → JobRates; empty tables fall back to the seeded defaults (placeholder). */
export function rowsToJobRates(rows: JobRateRows): JobRates {
  let placeholder = false;
  const setups: Record<JobSetupCode, number> = { ...JOB_RATE_DEFAULTS.setups };
  const seenSetups = new Set<JobSetupCode>();
  for (const r of rows.setups) {
    if (!isSetupCode(r.code)) continue;
    setups[r.code] = num(r.cost_eur, `job_setup_rates.${r.code}.cost_eur`);
    seenSetups.add(r.code);
    if (truthy(r.placeholder)) placeholder = true;
  }
  if (seenSetups.size < SETUP_CODES.length) placeholder = true;

  const a = rows.assembly;
  const assembly = a
    ? {
        labourRateEurH: num(a.labour_rate_eur_h, "assembly_rates.labour_rate_eur_h"),
        gasWireEurH: num(a.gas_wire_eur_h, "assembly_rates.gas_wire_eur_h"),
        tackSeconds: num(a.tack_seconds, "assembly_rates.tack_seconds"),
        fitupMinPerPart: num(a.fitup_min_per_part, "assembly_rates.fitup_min_per_part"),
        deburrMinPerPart: num(a.deburr_min_per_part, "assembly_rates.deburr_min_per_part"),
        handlingMinPerAssembly: num(a.handling_min_per_assembly, "assembly_rates.handling_min_per_assembly"),
        distortionFactor: num(a.distortion_factor, "assembly_rates.distortion_factor"),
        stepBendSecondsPerHit: num(a.step_bend_seconds_per_hit, "assembly_rates.step_bend_seconds_per_hit"),
        rollMinPerM: num(a.roll_min_per_m, "assembly_rates.roll_min_per_m"),
      }
    : { ...JOB_RATE_DEFAULTS.assembly };
  if (!a || truthy(a.placeholder)) placeholder = true;

  const weldSpeeds = rows.weldSpeeds
    .filter((r) => isWeldProcess(r.process))
    .map((r) => ({
      process: r.process as WeldProcess,
      thicknessMm: num(r.thickness_mm, "weld_speeds.thickness_mm"),
      speedMmMin: num(r.speed_mm_min, "weld_speeds.speed_mm_min"),
    }))
    .sort((x, y) => x.process.localeCompare(y.process) || x.thicknessMm - y.thicknessMm);
  if (weldSpeeds.length === 0) placeholder = true;
  if (rows.weldSpeeds.some((r) => truthy(r.placeholder))) placeholder = true;

  const packaging = rows.packaging
    .map((r) => ({
      code: String(r.code),
      name: String(r.name ?? r.code),
      maxSideMm: num(r.max_side_mm, "packaging_rates.max_side_mm"),
      maxMassKg: num(r.max_mass_kg, "packaging_rates.max_mass_kg"),
      priceEur: num(r.price_eur, "packaging_rates.price_eur"),
      position: num(r.position ?? 0, "packaging_rates.position"),
    }))
    .sort((x, y) => x.position - y.position || x.maxMassKg - y.maxMassKg);
  if (packaging.length === 0) placeholder = true;
  if (rows.packaging.some((r) => truthy(r.placeholder))) placeholder = true;

  const shipping = rows.shipping
    .map((r) => ({
      countryCode: String(r.country).toUpperCase(),
      maxKg: num(r.max_kg, "shipping_rates.max_kg"),
      priceEur: num(r.price_eur, "shipping_rates.price_eur"),
      carrier: r.carrier ? String(r.carrier) : null,
    }))
    .sort((x, y) => x.countryCode.localeCompare(y.countryCode) || x.maxKg - y.maxKg);
  if (rows.shipping.some((r) => truthy(r.placeholder))) placeholder = true;

  const vatRates: Record<string, number> = {};
  for (const r of rows.vat) vatRates[String(r.country).toUpperCase()] = num(r.rate_pct, `vat_rates.${r.country}`);
  const vat = Object.keys(vatRates).length > 0 ? vatRates : { ...JOB_RATE_DEFAULTS.vatRates };

  const c = rows.company;
  return {
    setups,
    assembly,
    weldSpeeds: weldSpeeds.length > 0 ? weldSpeeds : JOB_RATE_DEFAULTS.weldSpeeds.map((w) => ({ ...w })),
    packaging: packaging.length > 0 ? packaging : JOB_RATE_DEFAULTS.packaging.map((p) => ({ ...p })),
    shipping: shipping.length > 0 ? shipping : JOB_RATE_DEFAULTS.shipping.map((s) => ({ ...s })),
    vatRates: vat,
    ossActive: c ? truthy(c.oss_active) : JOB_RATE_DEFAULTS.ossActive,
    assemblyMarginPct: c ? num(c.assembly_margin_pct, "company_settings.assembly_margin_pct") : JOB_RATE_DEFAULTS.assemblyMarginPct,
    subcontractMarginPct: c ? num(c.subcontract_margin_pct, "company_settings.subcontract_margin_pct") : JOB_RATE_DEFAULTS.subcontractMarginPct,
    homeCountry: c && c.country ? String(c.country).toUpperCase() : JOB_RATE_DEFAULTS.homeCountry,
    placeholder,
  };
}

/** Effective weld speed for a process at a thickness: the smallest thickness ≥ t of the process, else its largest; null when the process has no row. */
export function weldSpeedFor(rates: Pick<JobRates, "weldSpeeds">, process: WeldProcess, thicknessMm: number): number | null {
  const rows = rates.weldSpeeds.filter((w) => w.process === process).sort((a, b) => a.thicknessMm - b.thicknessMm);
  if (rows.length === 0) return null;
  return (rows.find((w) => w.thicknessMm >= thicknessMm - 1e-6) ?? rows[rows.length - 1]).speedMmMin;
}
